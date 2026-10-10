// Thread → "walk the thread" slide deck. A self-contained `.zip`
// (one inlined index.html + assets/) that opens offline as a walkable
// deck: one station per bead, the bead chain as the spine you click to
// walk, sections as chapter dividers, and your comments as the speaker
// notes only the presenter sees.
//
// This is the Memory-Palace pillar made walkable: the medium *is* the
// loci mechanism the system already believes in. Build contract:
// docs/architecture/slide-export.md. It is NOT a presentation tool: the
// value is the primitive composition (chain-as-spine, comments-as-notes,
// sections-as-dividers, mood-as-accent), not slides.
//
// One-way and terminal, like the Org bridge: the entry is the source of
// truth, re-export is the edit. No options at export time: the deck
// ships both cappuccino palettes and the person opening it toggles.

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import MarkdownIt from 'markdown-it';
import JSZip from 'jszip';
import { getArticleData, slugify } from './threadArticles';
import { renderBeadSvg, renderChainSvg } from '../beads/svg';
import { MOOD_BY_KEY } from '../beads/types';
import { isPrivate, MASKED_TITLE } from '../utils/privacy';

// Same config threadArticles.renderHtml uses, so a body renders
// identically in the HTML export and the deck. html:false keeps
// untrusted entry text from injecting markup.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 'YYYY-MM-DD' → '12 May 2026' without touching the timezone (the value
// is a date the user chose, not an instant).
function formatDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return ymd ? escapeHtml(ymd) : '';
  const [, y, mo, d] = m;
  const name = MONTHS[Number(mo) - 1] || '';
  return `${Number(d)} ${name} ${y}`;
}

// Absolute wall-clock time for a comment. The deck is a static
// artifact; "3h ago" goes stale the moment it is opened later. Mirrors
// threadArticles.formatCommentTime's fallback behaviour.
function formatCommentTime(createdAt) {
  if (!createdAt) return '';
  const iso =
    createdAt.replace(' ', 'T') + (createdAt.endsWith('Z') ? '' : 'Z');
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return escapeHtml(createdAt);
  const d = new Date(t);
  const mo = MONTHS[d.getMonth()].slice(0, 3);
  const h24 = d.getHours();
  const hours = h24 % 12 || 12;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${mo} ${d.getDate()}, ${d.getFullYear()} · ${hours}:${mins} ${ampm}`;
}

// Resize + raw base64 (no data: prefix, for JSZip { base64:true }).
// Mirrors threadArticles.prepPhotoRawBase64 (module-private there) and
// orgExport's photoBase64. A modest budget keeps the archive sane.
async function prepPhotoRawBase64(uri, maxWidth = 1600, compress = 0.82) {
  try {
    const r = await manipulateAsync(uri, [{ resize: { width: maxWidth } }], {
      compress,
      format: SaveFormat.JPEG,
      base64: true,
    });
    return r?.base64 || null;
  } catch {
    return null;
  }
}

function photoAssetName(entryId, i) {
  return `photo-${entryId}-${i + 1}.jpg`;
}

// Which bead to draw for a section. Mirrors the in-app `thread_beads`
// render rule (docs/architecture/beads-and-threads.md): show the LIVE
// entry bead while the entry still exists and carries one; fall back to
// the frozen `thread_beads` snapshot (orphaned / never-beaded), then a
// neutral default. The deck must match what the user sees on screen:
// rendering only the snapshot (as the Org *archive* does) made stale /
// NULL-snapshot rows export as gray default beads.
function effectiveBead(s) {
  const e = s && s.entry;
  if (e && e.bead_shape) {
    return {
      shape: e.bead_shape,
      pattern: e.bead_pattern,
      mood: e.bead_mood,
      glyph: e.bead_glyph || '',
    };
  }
  const b = s && s.bead;
  if (b && b.shape) return b;
  return { shape: 'round', pattern: 'solid', mood: 'slate', glyph: '' };
}

// The thread's lived color: the most-used bead mood among the visible
// beads drives the deck's single accent. Not a picked swatch: the deck
// is colored by what you lived.
function dominantAccent(visible) {
  const counts = {};
  for (const s of visible) {
    const m = effectiveBead(s).mood;
    if (m) counts[m] = (counts[m] || 0) + 1;
  }
  let best = -1;
  let mood = 'slate';
  for (const [k, v] of Object.entries(counts)) {
    if (v > best) {
      best = v;
      mood = k;
    }
  }
  return (MOOD_BY_KEY[mood] || MOOD_BY_KEY.slate).color;
}

function notesHtml(comments) {
  const list = (comments || []).filter((c) => (c.body || '').trim());
  if (list.length === 0) return '';
  const items = list
    .map((c) => {
      const meta = [formatCommentTime(c.created_at), c.resolved_at ? 'resolved' : null]
        .filter(Boolean)
        .join(' · ');
      return (
        `<div class="note${c.resolved_at ? ' resolved' : ''}">` +
        `<time>${escapeHtml(meta)}</time>` +
        `<p>${escapeHtml(c.body)}</p></div>`
      );
    })
    .join('');
  return `<div class="slide-notes" hidden>${items}</div>`;
}

function starPip(tier) {
  if (tier === 2) return '<span class="pip pip2" aria-hidden="true">★</span>';
  if (tier === 1) return '<span class="pip pip1" aria-hidden="true">★</span>';
  return '';
}

// One <section.slide>. `kind` ∈ title|divider|content. Notes ride inside
// the slide (hidden); the engine mirrors the active slide's notes into a
// drawer when the presenter toggles them.
function titleSlide(data, visible) {
  // Raw thread, not the HTML article composition. The deck is "walk the
  // thread as it is": the composer's title/subtitle/intro is an
  // HTML/PDF-only presentation concern and is intentionally ignored.
  const t = (data.thread.name || 'Untitled').trim();
  const sub = (data.thread.description || '').trim();
  const intro = '';
  const anchor =
    data.thread.anchor_date && data.thread.kind !== 'user'
      ? `<p class="anchor">${escapeHtml(data.thread.name)}</p>`
      : '';
  const chain =
    visible.length > 0
      ? `<img class="chain" src="assets/chain.svg" alt="The bead chain of this thread" />`
      : '';
  return (
    `<section class="slide title" data-kind="title">` +
    `<div class="wrap">` +
    `<h1>${escapeHtml(t)}</h1>` +
    (sub ? `<p class="subtitle">${escapeHtml(sub)}</p>` : '') +
    chain +
    (intro ? `<div class="intro">${md.render(intro)}</div>` : '') +
    anchor +
    `</div>` +
    // Thread-level comments are the margins of the whole thread.
    notesHtml(data.threadComments) +
    `</section>`
  );
}

function dividerSlide(label) {
  return (
    `<section class="slide divider" data-kind="divider">` +
    `<div class="wrap"><span class="chapter-kicker">Chapter</span>` +
    `<h2>${escapeHtml(label)}</h2></div>` +
    `</section>`
  );
}

function contentSlide(s, idx) {
  const entry = s.entry;
  const isOrphan = !entry;
  const priv = entry && isPrivate(entry);

  // Raw entry title: the composer's per-bead title override is an
  // HTML-article concern; the deck exports the thread as it is.
  let title;
  if (isOrphan) title = '(removed entry)';
  else if (priv) title = MASKED_TITLE;
  else title = (entry.title || 'Untitled').trim();

  const date = entry && !priv ? formatDate(entry.date) : '';
  const tier = entry ? Number(entry.highlight_tier) || 0 : 0;

  let bodyHtml = '';
  let photosHtml = '';
  let notes = '';
  if (priv) {
    bodyHtml = `<p class="private-note">Private. This entry is not in this deck.</p>`;
  } else if (!isOrphan) {
    // Full entry body, verbatim: no composer lead/override.
    const body = (entry.content || '').trim();
    bodyHtml = body ? md.render(body) : '';
    const photos = s.photos || [];
    if (photos.length > 0) {
      const primary = `<img class="photo-primary" src="assets/${photoAssetName(
        entry.id,
        0
      )}" alt="" loading="lazy" />`;
      const rest =
        photos.length > 1
          ? `<div class="photo-strip">` +
            photos
              .slice(1)
              .map(
                (_, i) =>
                  `<img src="assets/${photoAssetName(
                    entry.id,
                    i + 1
                  )}" alt="" loading="lazy" />`
              )
              .join('') +
            `</div>`
          : '';
      photosHtml = `<figure class="media">${primary}${rest}</figure>`;
    }
    notes = notesHtml(s.comments);
  }

  // Photo side alternates by slide index for rhythm (the user asked for
  // "left or right"); CSS owns the actual placement. The bead is
  // deliberately NOT shown on the slide body. It lives on the walkable
  // spine; the chapter break is carried by the preceding divider slide.
  const sideClass = photosHtml ? (idx % 2 === 0 ? ' has-media left' : ' has-media right') : '';

  return (
    `<section class="slide content${sideClass}" data-kind="content">` +
    `<div class="body">` +
    `<header><h2>${escapeHtml(title)}${starPip(tier)}</h2>` +
    (date ? `<p class="date">${escapeHtml(date)}</p>` : '') +
    `</header>` +
    `<div class="prose">${bodyHtml}</div>` +
    `</div>` +
    photosHtml +
    notes +
    `</section>`
  );
}

// The walkable spine: every visible bead, current lit, click to walk
// there. Built inline (no per-frame asset fetch); section beads wear a
// gold ring (parity with the in-app pendant/ring).
function spineHtml(visible, slideIndexByBead) {
  const btns = visible
    .map((s) => {
      const ring = s.sectionLabel ? ' section' : '';
      const i = slideIndexByBead.get(s.beadId);
      const label = escapeHtml(
        (s.entry && !isPrivate(s.entry) && s.entry.title) || 'bead'
      );
      return (
        `<button class="spine-bead${ring}" data-goto="${i}" ` +
        `title="${label}" aria-label="Go to ${label}">` +
        renderBeadSvg(effectiveBead(s)) +
        `</button>`
      );
    })
    .join('');
  return `<nav class="spine" aria-label="The thread. Click a bead to go to it.">${btns}</nav>`;
}

function deckCss(accent) {
  // Cappuccino light/dark from src/theme.js, verbatim, so the deck wears
  // the app's own skin. The single accent is the thread's lived mood.
  return `
:root{
  --bg:#f5ead5; --surface:#ebe0c9; --text:#2b1d14; --muted:#6b513c;
  --faint:#a89378; --border:#d6c5a7; --strong:#bba47e; --accent:${accent};
  --serif:'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,'Times New Roman',serif;
  --sans:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
}
html[data-theme="dark"]{
  --bg:#1c1310; --surface:#2a1f1a; --text:#ebe0c9; --muted:#a89378;
  --faint:#6b513c; --border:#3d2e25; --strong:#5a4536;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--text);font-family:var(--sans);
  -webkit-font-smoothing:antialiased;overflow:hidden}
#deck{height:100vh;width:100vw}
.slide{display:none;height:100vh;width:100vw;padding:6vh 8vw 14vh;
  flex-direction:column;justify-content:center;align-items:center;
  text-align:center;animation:fade .45s ease}
.slide.active{display:flex}
@keyframes fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.wrap{max-width:60ch}
h1{font-family:var(--serif);font-weight:600;font-size:clamp(2.2rem,6vw,4.4rem);
  line-height:1.1;letter-spacing:-.01em}
.title .subtitle{font-family:var(--serif);font-style:italic;color:var(--muted);
  font-size:clamp(1.1rem,2.4vw,1.6rem);margin-top:1.2rem}
.title .chain{max-width:min(90vw,820px);height:auto;margin:3rem auto 0;display:block;
  filter:drop-shadow(0 1px 0 var(--border))}
.title .intro{margin-top:2rem;color:var(--muted);font-size:1.05rem;line-height:1.7}
.title .anchor{margin-top:1.6rem;color:var(--faint);font-size:.85rem;
  text-transform:uppercase;letter-spacing:.18em}
.divider{background:var(--surface)}
.divider .chapter-kicker{display:block;color:var(--accent);font-size:.8rem;
  text-transform:uppercase;letter-spacing:.32em;margin-bottom:1.4rem}
.divider h2{font-family:var(--serif);font-size:clamp(2rem,5.5vw,3.8rem);
  font-weight:600;line-height:1.15}
.content{flex-direction:column;text-align:left;align-items:stretch;
  max-width:980px;margin:0 auto}
.content .body{max-width:62ch;margin:0 auto;width:100%}
.content h2{font-family:var(--serif);font-weight:600;
  font-size:clamp(1.7rem,3.6vw,2.7rem);line-height:1.2}
.content .date{color:var(--faint);font-size:.82rem;margin-top:.5rem;
  text-transform:uppercase;letter-spacing:.14em}
.content .prose{margin-top:1.5rem;font-size:1.12rem;line-height:1.75;
  color:var(--text)}
.content .prose p{margin:0 0 1rem}
.content .prose .lead{font-family:var(--serif);font-style:italic;
  font-size:1.25rem;color:var(--muted)}
.content .prose ul,.content .prose ol{margin:0 0 1rem 1.4em}
.content .prose li{margin:.35rem 0}
.content .prose blockquote{border-left:3px solid var(--accent);
  padding-left:1rem;color:var(--muted);font-style:italic;margin:0 0 1rem}
.content .prose code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  background:var(--surface);padding:.12em .4em;border-radius:4px;font-size:.92em}
.content .prose pre{background:var(--surface);padding:1rem;border-radius:8px;
  overflow:auto;margin:0 0 1rem}
.content .prose pre code{background:none;padding:0}
.content .prose a{color:var(--accent);text-underline-offset:3px}
.content .prose hr{border:none;border-top:1px solid var(--border);margin:1.6rem 0}
.media{margin:2rem auto 0;max-width:62ch}
.media .photo-primary{width:100%;height:auto;border-radius:10px;
  border:1px solid var(--border);display:block}
.photo-strip{display:flex;gap:.6rem;margin-top:.6rem;flex-wrap:wrap}
.photo-strip img{height:96px;width:auto;border-radius:6px;
  border:1px solid var(--border)}
@media(min-width:900px){
  .content.has-media{flex-direction:row;align-items:center;gap:4vw;
    text-align:left}
  .content.has-media .body{margin:0;flex:1 1 50%}
  .content.has-media .media{margin:0;flex:1 1 46%;max-width:46%}
  .content.has-media.right{flex-direction:row-reverse}
}
.pip{color:var(--accent);font-size:.6em;vertical-align:super;margin-left:.4rem}
.pip2{text-shadow:0 0 0 var(--accent),0 0 6px var(--accent)}
.private-note{color:var(--faint);font-style:italic}
.spine{position:fixed;left:0;right:0;bottom:0;height:9vh;min-height:56px;
  display:flex;align-items:center;gap:.5rem;overflow-x:auto;
  padding:0 1.2rem;background:var(--surface);
  border-top:1px solid var(--border);scrollbar-width:thin}
.spine-bead{flex:0 0 auto;width:30px;height:30px;padding:0;border:none;
  background:none;cursor:pointer;opacity:.4;transition:opacity .2s,transform .2s;
  border-radius:50%}
.spine-bead svg{width:100%;height:100%;display:block}
.spine-bead:hover{opacity:.8;transform:translateY(-2px)}
.spine-bead.section{box-shadow:0 0 0 2px #c9a14e}
.spine-bead.current{opacity:1;transform:scale(1.3) translateY(-3px);
  box-shadow:0 0 0 2px var(--accent)}
.hud{position:fixed;top:1rem;right:1.1rem;display:flex;align-items:center;
  gap:.4rem;color:var(--muted);font-size:.78rem;
  font-variant-numeric:tabular-nums}
.hud button{font:inherit;color:var(--muted);background:none;border:none;
  cursor:pointer;padding:.3rem .45rem;border-radius:6px;line-height:1}
.hud button:hover{background:var(--surface);color:var(--text)}
.counter{margin-right:.3rem;letter-spacing:.05em}
.notes-drawer{position:fixed;left:0;right:0;bottom:9vh;max-height:42vh;
  overflow-y:auto;background:var(--surface);border-top:2px solid var(--accent);
  padding:1.2rem 8vw;display:none}
body.notes-on .notes-drawer{display:block}
.notes-drawer .note{max-width:62ch;margin:0 auto 1rem;
  border-left:2px solid var(--border);padding-left:1rem}
.notes-drawer .note.resolved p{text-decoration:line-through;opacity:.55}
.notes-drawer time{display:block;color:var(--faint);font-size:.72rem;
  text-transform:uppercase;letter-spacing:.12em;margin-bottom:.25rem}
.notes-drawer p{font-family:var(--serif);font-style:italic;color:var(--muted);
  line-height:1.6;white-space:pre-wrap}
.notes-drawer .empty{text-align:center;color:var(--faint);font-style:italic}
.notes-title{max-width:62ch;margin:0 auto .8rem;color:var(--accent);
  font-size:.72rem;text-transform:uppercase;letter-spacing:.22em}
@media print{.spine,.hud,.notes-drawer{display:none!important}
  .slide{display:flex!important;page-break-after:always;height:auto;
    min-height:90vh}}
`;
}

// The engine: arrows/space/Home-End, click a spine bead, swipe, theme +
// notes + fullscreen toggles, #n deep-link. No deps. Degrades: with JS
// off, .no-js shows every slide as a readable scroll.
// The three empty `catch(e){}` inside are silent on purpose: this code runs
// in the viewer's browser, where history/localStorage throw on file:// and
// in sandboxed previews. The deck must degrade, not break.
function deckJs() {
  return `
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide'));
  var beads=[].slice.call(document.querySelectorAll('.spine-bead'));
  var drawer=document.getElementById('notes-drawer');
  var counter=document.getElementById('counter');
  var i=0;
  function clamp(n){return Math.max(0,Math.min(slides.length-1,n));}
  function syncNotes(){
    var s=slides[i], n=s&&s.querySelector('.slide-notes');
    drawer.innerHTML='<div class="notes-title">Speaker notes</div>'+
      (n?n.innerHTML:'<p class="empty">No margins on this station.</p>');
  }
  function show(n,push){
    i=clamp(n);
    slides.forEach(function(s,k){s.classList.toggle('active',k===i);});
    beads.forEach(function(b){
      b.classList.toggle('current',Number(b.dataset.goto)===i);
    });
    var cur=beads.filter(function(b){return Number(b.dataset.goto)===i;})[0];
    if(cur&&cur.scrollIntoView)cur.scrollIntoView({inline:'center',block:'nearest'});
    if(counter)counter.textContent=(i+1)+' / '+slides.length;
    syncNotes();
    if(push!==false){
      try{history.replaceState(null,'','#'+(i+1));}catch(e){}
    }
  }
  function next(){show(i+1);}
  function prev(){show(i-1);}
  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown'){e.preventDefault();next();}
    else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();prev();}
    else if(e.key==='Home'){e.preventDefault();show(0);}
    else if(e.key==='End'){e.preventDefault();show(slides.length-1);}
    else if(e.key==='t'||e.key==='T'){toggleTheme();}
    else if(e.key==='s'||e.key==='S'){toggleNotes();}
    else if(e.key==='f'||e.key==='F'){toggleFs();}
  });
  beads.forEach(function(b){
    b.addEventListener('click',function(){show(Number(b.dataset.goto));});
  });
  var deck=document.getElementById('deck'),x0=null;
  deck.addEventListener('touchstart',function(e){x0=e.touches[0].clientX;},{passive:true});
  deck.addEventListener('touchend',function(e){
    if(x0===null)return;
    var dx=e.changedTouches[0].clientX-x0;
    if(Math.abs(dx)>50){dx<0?next():prev();}
    x0=null;
  },{passive:true});
  function applyTheme(t){
    document.documentElement.setAttribute('data-theme',t);
    try{localStorage.setItem('vakana-deck-theme',t);}catch(e){}
  }
  function toggleTheme(){
    applyTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark');
  }
  function toggleNotes(){document.body.classList.toggle('notes-on');}
  function toggleFs(){
    if(!document.fullscreenElement&&document.documentElement.requestFullscreen)
      document.documentElement.requestFullscreen();
    else if(document.exitFullscreen)document.exitFullscreen();
  }
  var saved;try{saved=localStorage.getItem('vakana-deck-theme');}catch(e){}
  applyTheme(saved||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
  document.getElementById('btn-theme').addEventListener('click',toggleTheme);
  document.getElementById('btn-notes').addEventListener('click',toggleNotes);
  document.getElementById('btn-fs').addEventListener('click',toggleFs);
  window.addEventListener('hashchange',function(){
    var n=parseInt(location.hash.slice(1),10);
    if(!isNaN(n))show(n-1);
  });
  document.body.classList.remove('no-js');
  var start=parseInt(location.hash.slice(1),10);
  show(isNaN(start)?0:start-1,false);
})();
`;
}

function renderDeckHtml(data) {
  // Every bead, as-is: the HTML article's hidden-bead curation is NOT
  // applied (the deck is a fidelity export of the whole thread, like
  // the Org bridge; the composer is an HTML/PDF-only concern).
  const visible = data.sections;
  const accent = dominantAccent(visible);
  const title = (data.thread.name || 'Untitled').trim();

  // Build the ordered slide list and remember which slide index each
  // bead lands on (a divider may sit before it) so the spine can walk
  // straight to the station, not the chapter card.
  const slides = [titleSlide(data, visible)];
  const slideIndexByBead = new Map();
  let idx = 0; // 0 = title slide
  for (const s of visible) {
    if (s.sectionLabel) {
      idx += 1;
      slides.push(dividerSlide(s.sectionLabel));
    }
    idx += 1;
    slideIndexByBead.set(s.beadId, idx);
    slides.push(contentSlide(s, idx));
  }

  const head =
    `<!doctype html><html lang="en" class="no-js">` +
    `<head><meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />` +
    `<title>${escapeHtml(title)}</title>` +
    `<style>${deckCss(accent)}</style></head>`;

  const hud =
    `<div class="hud">` +
    `<span class="counter" id="counter"></span>` +
    `<button id="btn-notes" title="Speaker notes (s)">Notes</button>` +
    `<button id="btn-theme" title="Light / dark (t)">Theme</button>` +
    `<button id="btn-fs" title="Fullscreen (f)">⤢</button>` +
    `</div>`;

  return (
    head +
    `<body class="no-js">` +
    `<main id="deck">${slides.join('')}</main>` +
    spineHtml(visible, slideIndexByBead) +
    hud +
    `<div class="notes-drawer" id="notes-drawer"></div>` +
    `<script>${deckJs()}</script>` +
    `</body></html>`
  );
}

// Assemble the `.zip`: one inlined index.html + assets/ (chain.svg,
// bead-<id>.svg per station, copied photo bytes). Sequential photo prep
// so peak memory stays at one prepped photo (same as Org/MD). Returns
// the cache uri + a missing[] of any attachment evicted from disk.
async function buildThreadSlidesZip(threadId) {
  const data = await getArticleData(threadId);
  if (!data) throw new Error('Thread not found');

  // The zip/folder name is the THREAD's. The deck never reads the
  // article-composer composition (title/subtitle/intro/hidden/overrides
  // are HTML/PDF-only). It is a fidelity export of the whole thread,
  // like the Org bridge, which it now matches for naming too.
  const slug =
    slugify(data.thread.name) || `thread-${data.thread.id}`;

  const visible = data.sections; // every bead, no article curation

  const zip = new JSZip();
  const root = zip.folder(slug);
  root.file('index.html', renderDeckHtml(data));

  const assets = root.folder('assets');
  const missing = [];

  if (visible.length > 0) {
    assets.file('chain.svg', renderChainSvg(visible.map(effectiveBead)));
  }
  for (const s of visible) {
    assets.file(`bead-${s.beadId}.svg`, renderBeadSvg(effectiveBead(s)));
  }

  for (const s of visible) {
    if (!s.entry || isPrivate(s.entry)) continue;
    const photos = s.photos || [];
    for (let i = 0; i < photos.length; i++) {
      const name = photoAssetName(s.entry.id, i);
      const b64 = await prepPhotoRawBase64(photos[i]);
      if (b64) assets.file(name, b64, { base64: true });
      else missing.push(name);
    }
  }

  const zb64 = await zip.generateAsync({ type: 'base64' });
  const filename = `${slug}.zip`;
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, zb64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return {
    uri,
    filename,
    mimeType: 'application/zip',
    UTI: 'public.zip-archive',
    missing,
  };
}

/**
 * Build and **share** the slide deck `.zip` (OS share sheet; no
 * transport, no sync; one-way and terminal like the Org bridge).
 * @returns {Promise<{ uri, filename, missing:string[] }>}
 */
export async function exportThreadSlides(threadId) {
  const a = await buildThreadSlidesZip(threadId);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(a.uri, {
    mimeType: a.mimeType,
    dialogTitle: 'Share thread as a slide deck',
    UTI: a.UTI,
  });
  return { uri: a.uri, filename: a.filename, missing: a.missing };
}

/**
 * Build and **save to device**. Android: SAF folder pick + byte copy.
 * iOS: share sheet ("Save to Files"). Mirrors
 * orgExport.saveThreadOrgToDevice. Still local, no transport.
 * @returns {Promise<{ uri, filename, missing:string[] }>}
 */
export async function saveThreadSlidesToDevice(threadId) {
  const a = await buildThreadSlidesZip(threadId);
  if (Platform.OS === 'android') {
    const perms =
      await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perms.granted) throw new Error('Folder permission was denied');
    const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
      perms.directoryUri,
      a.filename,
      a.mimeType
    );
    const b64 = await FileSystem.readAsStringAsync(a.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.writeAsStringAsync(fileUri, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { uri: fileUri, filename: a.filename, missing: a.missing };
  }
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(a.uri, {
    mimeType: a.mimeType,
    dialogTitle: 'Save thread slide deck',
    UTI: a.UTI,
  });
  return { uri: a.uri, filename: a.filename, missing: a.missing };
}
