// Fixed-size 1080 × 1350 (Instagram portrait) card rendered off-screen
// and captured to PNG by `react-native-view-shot`. Two variants:
//
//   - withNotes=false → bead+title+date as the post head, single
//     polaroid photo (the one the user picked), body excerpt, footer.
//   - withNotes=true  → same head + single polaroid, shorter excerpt,
//     up to 3 iMessage-style reply bubbles below, footer.
//
// Only ONE photo is ever rendered: the user picks which via the photo
// picker before the card is built. We tried filmstrip/stacked-edge
// presentations for the others, but view-shot's Android capture path
// produced washed-out / bleached secondary images that we couldn't
// reliably fix; the single-photo card is simpler and always renders
// cleanly.
//
// The main polaroid is tilted ~-1.5° for a hand-pinned scrapbook feel.
//
// Visual identity mirrors the HTML "storyboard" template (cream page,
// no inner card backdrop, iMessage-style reply bubbles); the photo
// uses a postcard-style polaroid frame for the scrapbook feel.
//
// Rendered at logical 540 × 675 pt; the caller passes width: 1080,
// height: 1350 to view-shot so the output bitmap is exactly Instagram
// portrait on every device DPR.

import React, {
  forwardRef,
  useMemo,
  useEffect,
  useCallback,
  useState,
} from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BeadView from './BeadView';

const CARD_WIDTH = 540;
const CARD_HEIGHT = 675;

const COLORS = {
  background: '#f5ead5',
  ink: '#2a1d04',
  inkBody: '#2a1f10',
  inkMuted: '#8a7a5a',
  accent: '#b89248',
  avatarBg: '#d8c6a5',
  polaroidBorder: '#ffffff',
};

function formatDate(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyy_mm_dd);
  if (!m) return yyyy_mm_dd;
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function normalizeBody(content) {
  // Collapse runs of spaces/tabs but keep newlines so paragraph breaks
  // survive in the card. No char cap: the body Text shows the full
  // entry; `pickBodyFont` shrinks the font only as much as the
  // available box demands.
  return (content || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Available height for the body text, derived from the rest of the card
// layout (header / optional photo / optional notes block). Factored as a
// pure function of layout state so `pickBodyFont` can use the largest
// font that fits: no shrinking just because the entry is "long" if
// there's actually room for it. Constants mirror the styles below.
function computeBodyBoxHeight({ hasPhoto, withNotes, notesCount }) {
  // post is flex:1 inside the 633pt-tall card inner; assume ~591pt for
  // post height, minus its 12+10pt vertical padding = 569pt content.
  const POST_CONTENT = 569;
  const HEADER = 52;            // avatar 40 + postHead paddingBottom 12
  const POLAROID_LARGE = 358;   // 300pt photo + frame + wrap paddingBottom
  const POLAROID_SMALL = 298;
  const REPLIES_BASE = 49;      // repliesPad 26 + header row + label margin
  // Per-note reserve: ~2 lines + padding. Notes are usually short, so
  // reserving for 3-line maxes wastes body room; the post container's
  // `overflow: hidden` catches the rare 3-line note.
  const NOTE_RESERVE = 40;
  const REPLIES_EMPTY = 52;
  let h = POST_CONTENT - HEADER;
  if (hasPhoto) h -= withNotes ? POLAROID_SMALL : POLAROID_LARGE;
  if (withNotes) {
    h -= notesCount === 0
      ? REPLIES_EMPTY
      : REPLIES_BASE + NOTE_RESERVE * Math.min(notesCount, 3);
  }
  return Math.max(40, h);
}

// Font ladder: ~chars-per-line is empirical for the 460pt-wide body box.
// Stay biased slightly conservative (smaller cpl => more estimated lines
// => earlier step-down) so we don't overflow into the footer area.
const FONT_CANDIDATES = [
  { fontSize: 14, lineHeight: 20, cpl: 48 },
  { fontSize: 13, lineHeight: 18, cpl: 52 },
  { fontSize: 12, lineHeight: 17, cpl: 56 },
  { fontSize: 11, lineHeight: 16, cpl: 60 },
  { fontSize: 10, lineHeight: 14, cpl: 64 },
  { fontSize: 9, lineHeight: 13, cpl: 72 },
  { fontSize: 8, lineHeight: 12, cpl: 80 },
  { fontSize: 7, lineHeight: 11, cpl: 90 },
];

function estimateBodyLines(text, cpl) {
  // Newlines force a line break: paragraph spacing must be counted.
  const paragraphs = text.split('\n');
  let lines = 0;
  for (const p of paragraphs) lines += Math.max(1, Math.ceil(p.length / cpl));
  return lines;
}

function pickBodyFont(text, boxHeight) {
  for (const c of FONT_CANDIDATES) {
    const lines = estimateBodyLines(text, c.cpl);
    if (lines * c.lineHeight <= boxHeight) {
      return { fontSize: c.fontSize, lineHeight: c.lineHeight };
    }
  }
  const last = FONT_CANDIDATES[FONT_CANDIDATES.length - 1];
  return { fontSize: last.fontSize, lineHeight: last.lineHeight };
}

const EntryCardForExport = forwardRef(function EntryCardForExport(
  {
    entry,
    bead,
    photoUris = [],
    mainPhotoIndex = 0,
    comments = [],
    withNotes = false,
    onReady,
  },
  ref
) {
  const styles = useMemo(() => makeStyles(), []);
  const title = ((entry?.title || '').trim()) || 'Untitled';
  const dateLabel = formatDate(entry?.date);
  const notes = withNotes ? comments.slice(0, 3) : [];

  // Pick the main photo based on the user's selection. Up to two extra
  // photos peek from behind the main polaroid as physical stacked
  // cards. Cap at 2 so the stack stays legible.
  const safeIndex =
    photoUris.length > 0
      ? Math.max(0, Math.min(mainPhotoIndex, photoUris.length - 1))
      : 0;
  const mainPhoto = photoUris[safeIndex] || null;
  const otherPhotos = photoUris.filter((_, i) => i !== safeIndex);
  const edgePhotos = otherPhotos.slice(0, 2);

  // Full body text, no char cap. Compute the actual body box height
  // from the layout (photo + notes both eat into it) and pick the
  // LARGEST font that lets the entry fit; only shrinks when the box
  // genuinely can't hold the default size.
  const body = normalizeBody(entry?.content);
  const realNotesCount = withNotes ? Math.min(notes.length, 3) : 0;
  const bodyBoxHeight = computeBodyBoxHeight({
    hasPhoto: !!mainPhoto,
    withNotes,
    notesCount: realNotesCount,
  });
  const bodyFont = pickBodyFont(body, bodyBoxHeight);

  // Total images we'll mount: main + each edge photo. onReady fires
  // after every image's onLoad/onError so view-shot doesn't capture
  // before the photos decode.
  const expectedImages = (mainPhoto ? 1 : 0) + edgePhotos.length;
  const [loadedCount, setLoadedCount] = useState(0);

  useEffect(() => {
    if (expectedImages === 0 && onReady) onReady();
  }, [expectedImages, onReady]);

  useEffect(() => {
    if (expectedImages > 0 && loadedCount >= expectedImages && onReady) {
      onReady();
    }
  }, [loadedCount, expectedImages, onReady]);

  const handleImageDone = useCallback(() => {
    setLoadedCount((c) => c + 1);
  }, []);

  return (
    <View ref={ref} style={styles.card} collapsable={false}>
      <View style={styles.post}>
        <View style={styles.postHead}>
          <View style={styles.avatar}>
            {bead ? <BeadView bead={bead} size={32} /> : null}
          </View>
          <View style={styles.byline}>
            <Text style={styles.author} numberOfLines={2}>
              {title}
            </Text>
            {dateLabel ? (
              <Text style={styles.meta} numberOfLines={1}>
                {dateLabel}
              </Text>
            ) : null}
          </View>
        </View>

        {mainPhoto ? (
          <View style={styles.polaroidWrap}>
            <View style={styles.polaroidStage}>
              {/* Edge cards: real photos rendered as stacked polaroids
                  behind the main one. fadeDuration={0} avoids the
                  Android image-fade-in / view-shot interaction that
                  used to bleach them at capture time. */}
              {edgePhotos[1] ? (
                <View
                  style={[
                    styles.polaroid,
                    styles.polaroidEdge,
                    styles.edgeFar,
                  ]}
                  // Render to an offscreen texture so Android composites
                  // the rotated view with bilinear filtering. This smooths
                  // the otherwise-jagged rotated edges.
                  renderToHardwareTextureAndroid
                >
                  <Image
                    source={{ uri: edgePhotos[1] }}
                    style={styles.polaroidPhoto}
                    resizeMode="cover"
                    fadeDuration={0}
                    onLoad={handleImageDone}
                    onError={handleImageDone}
                  />
                </View>
              ) : null}
              {edgePhotos[0] ? (
                <View
                  style={[
                    styles.polaroid,
                    styles.polaroidEdge,
                    styles.edgeNear,
                  ]}
                  renderToHardwareTextureAndroid
                >
                  <Image
                    source={{ uri: edgePhotos[0] }}
                    style={styles.polaroidPhoto}
                    resizeMode="cover"
                    fadeDuration={0}
                    onLoad={handleImageDone}
                    onError={handleImageDone}
                  />
                </View>
              ) : null}
              <View
                style={[
                  styles.polaroid,
                  withNotes ? styles.polaroidSmall : styles.polaroidLarge,
                  styles.polaroidMain,
                ]}
                renderToHardwareTextureAndroid
              >
                <Image
                  source={{ uri: mainPhoto }}
                  style={styles.polaroidPhoto}
                  resizeMode="cover"
                  fadeDuration={0}
                  onLoad={handleImageDone}
                  onError={handleImageDone}
                />
              </View>
            </View>
          </View>
        ) : null}

        {body ? (
          <Text style={[styles.body, bodyFont]}>
            {body}
          </Text>
        ) : null}

        {withNotes ? (
          <View style={styles.replies}>
            {notes.length > 0 ? (
              <>
                <View style={styles.repliesHeader}>
                  <Ionicons
                    name="chatbubble-outline"
                    size={11}
                    color={COLORS.inkMuted}
                  />
                  <Text style={styles.repliesLabel}>
                    {notes.length === 1 ? '1 NOTE' : `${notes.length} NOTES`}
                  </Text>
                </View>
                {notes.map((c, i) => (
                  <View
                    key={c.id}
                    style={[styles.reply, i > 0 && styles.replyDivided]}
                  >
                    <Text
                      style={[
                        styles.replyBody,
                        c.resolved_at && styles.replyBodyResolved,
                      ]}
                      numberOfLines={3}
                    >
                      {(c.body || '').trim()}
                    </Text>
                  </View>
                ))}
              </>
            ) : (
              <Text style={styles.repliesEmpty}>No notes yet.</Text>
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.footerLogo}
          resizeMode="contain"
          fadeDuration={0}
        />
        <Text style={styles.footerText}>VAKANA</Text>
      </View>
    </View>
  );
});

const makeStyles = () =>
  StyleSheet.create({
    card: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      backgroundColor: COLORS.background,
      paddingHorizontal: 24,
      paddingTop: 26,
      paddingBottom: 16,
    },
    // The post is the visible "card": a translucent off-white over
    // the cream page so it reads slightly brighter than the
    // background. Hairline border keeps the edge defined; boxShadow
    // (RN 0.76+ CSS-spec, captured by view-shot) drops a soft shadow
    // beneath. The legacy shadow* + elevation are kept as fallbacks
    // for older renderers.
    post: {
      flex: 1,
      backgroundColor: 'rgba(255, 255, 255, 0.55)',
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(60, 46, 31, 0.18)',
      paddingTop: 12,
      paddingBottom: 10,
      overflow: 'hidden',
      boxShadow: '0px 6px 14px rgba(0, 0, 0, 0.22)',
      shadowColor: '#000',
      shadowOpacity: 0.22,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    postHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: COLORS.avatarBg,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    byline: {
      flex: 1,
      minWidth: 0,
    },
    author: {
      color: COLORS.ink,
      fontSize: 17,
      fontWeight: '700',
      lineHeight: 21,
    },
    meta: {
      color: COLORS.inkMuted,
      fontSize: 12,
      marginTop: 2,
    },
    polaroidWrap: {
      alignItems: 'center',
      paddingHorizontal: 16,
      // Extra bottom padding: the polaroid is rotated -1.5° (and the
      // edge cards farther) so the corners visually extend below the
      // layout box. 28px clearance keeps body text well clear.
      paddingBottom: 28,
    },
    polaroidStage: {
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Base polaroid frame: white card with a hairline light-gray
    // border + a light drop shadow underneath. boxShadow (RN 0.76+
    // CSS-spec) is what view-shot tends to honor on Android; shadow*
    // and elevation are fallbacks for older renderers / iOS.
    polaroid: {
      backgroundColor: COLORS.polaroidBorder,
      paddingTop: 8,
      paddingHorizontal: 8,
      paddingBottom: 22,
      // Slightly rounder than before (was 2). Curves anti-alias more
      // gracefully than straight pixel-aligned edges when the parent is
      // rotated. This fixes the sawtooth look on Android.
      borderRadius: 4,
      borderWidth: 1,
      borderColor: '#c9beac',
      overflow: 'hidden',
      boxShadow: '0px 3px 8px rgba(0, 0, 0, 0.18)',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    polaroidMain: {
      transform: [{ rotate: '-1.5deg' }],
      position: 'relative',
      zIndex: 10,
      elevation: 10,
    },
    polaroidLarge: {
      width: 400,
    },
    polaroidSmall: {
      width: 320,
    },
    polaroidPhoto: {
      width: '100%',
      aspectRatio: 4 / 3,
    },
    // Edge cards: real photos behind the main one. Same width so they
    // read as identical photos seen from camera-stacked perspective.
    polaroidEdge: {
      position: 'absolute',
      top: 0,
      width: 320,
    },
    edgeNear: {
      transform: [{ rotate: '4deg' }, { translateX: 18 }, { translateY: 8 }],
      zIndex: 2,
      elevation: 5,
    },
    edgeFar: {
      transform: [{ rotate: '-6deg' }, { translateX: -22 }, { translateY: 14 }],
      zIndex: 1,
      elevation: 2,
    },
    body: {
      color: COLORS.inkBody,
      fontSize: 14,
      lineHeight: 20,
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    replies: {
      paddingHorizontal: 16,
      paddingTop: 16,
      marginTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(60, 46, 31, 0.20)',
    },
    repliesHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 8,
    },
    repliesLabel: {
      fontSize: 10,
      letterSpacing: 1.5,
      color: COLORS.inkMuted,
      fontWeight: '700',
    },
    // Magazine-style note treatment: each note is an italicized
    // excerpt separated from the next by a hairline rule. No bullets,
    // no bg cards: typography carries the hierarchy.
    reply: {
      paddingVertical: 8,
    },
    replyDivided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(60, 46, 31, 0.20)',
    },
    replyBody: {
      color: COLORS.inkBody,
      fontSize: 12,
      lineHeight: 17,
      fontStyle: 'italic',
    },
    replyBodyResolved: {
      color: COLORS.inkMuted,
      textDecorationLine: 'line-through',
    },
    repliesEmpty: {
      color: COLORS.inkMuted,
      fontSize: 12,
      fontStyle: 'italic',
      paddingBottom: 6,
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 8,
    },
    footerLogo: {
      width: 26,
      height: 26,
      borderRadius: 6,
    },
    footerText: {
      color: COLORS.ink,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 4,
    },
  });

export default EntryCardForExport;
export { CARD_WIDTH, CARD_HEIGHT };
