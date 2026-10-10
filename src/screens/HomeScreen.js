import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  SectionList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  Modal,
  Pressable,
  Dimensions,
  useWindowDimensions,
  Platform,
  StatusBar,
  Keyboard,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { Swipeable } from 'react-native-gesture-handler';
import EntryCard from '../components/EntryCard';
import BeadView from '../components/BeadView';
import DragFab from '../components/DragFab';
import QuickVoiceModal from '../components/QuickVoiceModal';
import CalendarMonth from '../components/CalendarMonth';
import ThreadsList from '../components/ThreadsList';
import ReminderFormSheet from '../components/ReminderFormSheet';
import CommentsDrawer from '../components/CommentsDrawer';
import FuseSheet from '../components/FuseSheet';
import BatchThreadPicker from '../components/BatchThreadPicker';
import BatchCollectionPicker from '../components/BatchCollectionPicker';
import RecurringReminderListSheet from '../components/RecurringReminderListSheet';
import ReminderActionsSheet from '../components/ReminderActionsSheet';
import { getDb } from '../database/db';
import { syncAutoBeadForEntry } from '../services/autoThread';
import { deleteEntries } from '../services/entries';
import { deleteThreads } from '../services/threads';
import {
  acknowledgeReminder as acknowledgeReminderById,
  setReminderActive,
  restoreReminder,
} from '../services/reminders';
import { computeMissedCount, formatRule } from '../services/recurrence';
import { addEntriesToThread } from '../services/entryFusion';
import { loadAnchoredThreads as loadAnchoredThreadsSvc } from '../services/anchoredThreads';
import {
  loadThreadCountsForEntries,
  loadBeadThreadNamesForEntries,
} from '../services/threadMembership';
import { loadAttachmentsForEntries } from '../services/attachments';
import { persistMediaUri } from '../services/mediaStore';
import { getBackupNudge, snoozeBackupNudge } from '../services/backup';
import { getCurrentVault } from '../utils/vaults';
import { groupIntoBands } from '../utils/timeBands';
import ViewIcon from '../components/ViewIcon';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';
import { listBeadPresets } from '../services/beadPresets';
import {
  getImportFolderUri,
  pickImportFolder,
  importFromFolder,
  importFromUrl,
} from '../services/noteImport';
import {
  loadCommentCounts,
  loadCommentPreviews,
  removeCommentsForParent,
  loadFiredCommentReminders,
  loadPendingCommentReminders,
  loadCommentRemindersWithLabels,
  loadDoneCommentRemindersWithLabels,
  acknowledgeCommentReminder,
  isInlineCommentsVisible,
  setInlineCommentsVisible,
  PARENT_ENTRY,
  PARENT_THREAD,
  PARENT_REMINDER,
} from '../services/comments';
import { addThreadToCollection } from '../services/collections';
import { cancelNotification } from '../utils/notifications';
import { setNotificationRouteConsumer } from '../utils/notificationRouting';
import { hapticTap } from '../utils/haptics';
import { formatDateStr } from '../utils/dateString';
import { getDefaultHomeView } from '../utils/preferences';
import { loadWanderSettings } from '../utils/wander';
import { ACTION_TYPES, MOODS, PATTERNS, SHAPE_GEOMETRY, readBead } from '../beads/types';
import { useTheme } from '../theme';
import MarkdownInline from '../components/MarkdownInline';
import { useLock } from '../lock';
import { warn } from '../utils/log';

const VIEW_ORDER = ['list', 'calendar', 'threads'];
const VIEW_LABEL = { list: 'Beads', calendar: 'Calendar', threads: 'Threads' };
// The three primary views carry their Malagasy names as the title, with the
// English label as a small epithet below. These are the system's own words for what
// each view *is* in the language that bore the metaphor:
//   Vakana:      the atom (beads)
//   Tetiandro:   the place (calendar / book of days)
//   Tohivakana:  the stringing (threads of beads)
// This is the heritage pillar made structural in the running app rather than
// living only in the name/essays.
// list and threads carry a *density-bearing* subtitle: when the view's
// current count is ≥1, the subtitle prefixes it (`15 Beads of life`)
// and follows the count's pluralization (`1 Bead of life`). The count
// tracks the **applied filter**: entries.length for list (loadEntries
// already writes the filtered set), and ThreadsList's reported count
// for threads (lifted up via `onCountChange`). When count is 0 (or
// loading), the plural form alone reads (*let absence read*, the
// same suppression rule the echo chip uses). Calendar stays static:
// "Book of days" doesn't take a leading number naturally, and the
// calendar isn't filter-responsive in the same shape as list/threads.
const VIEW_TITLE = {
  list:     { title: 'Vakana',     singular: 'Bead of life',  plural: 'Beads of life' },
  calendar: { title: 'Tetiandro',  subtitle: 'Book of days' },
  threads:  { title: 'Tohivakana', singular: 'Thread of life', plural: 'Threads of life' },
};

const subtitleFor = (view, listCount, threadsCount) => {
  const meta = VIEW_TITLE[view] || VIEW_TITLE.list;
  if (meta.subtitle) return meta.subtitle;
  const n =
    view === 'list' ? listCount : view === 'threads' ? threadsCount : 0;
  if (!n) return meta.plural;
  return `${n} ${n === 1 ? meta.singular : meta.plural}`;
};

const pad = (n) => n.toString().padStart(2, '0');
const formatTimestamp = (d) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
  `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

const isoDate = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Compare emoji glyphs ignoring the variation selectors U+FE0F (emoji) /
// U+FE0E (text), plus NFC: a keycap like "5️⃣" can be stored as 5+U+FE0F+U+20E3
// or 5+U+20E3, so a raw === silently fails even when they look identical. Used
// by BOTH the bead-pin match and the pill-divergence check so they agree.
// Otherwise a match sets the pill and divergence immediately clears it.
const normGlyph = (g) =>
  [...(g || '').normalize('NFC')]
    .filter((c) => {
      const cp = c.codePointAt(0);
      return cp !== 0xfe0f && cp !== 0xfe0e;
    })
    .join('');

// Time-band grouping moved to ../utils/timeBands (shared with the threads
// list so the two surfaces band identically). `groupIntoBands(entries)`
// keeps working: the util's default accessor is `item.date`.

// How much of each entry's body the list query fetches. The card clamps
// its excerpt to a single line, so this is generous headroom; it exists
// so the list never pays to marshal full note bodies. See the SELECT in
// loadEntries for why truncating here is safe.
const LIST_EXCERPT_CHARS = 240;

export default function HomeScreen({ navigation, route }) {
  const { colors } = useTheme();
  const { lock } = useLock();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Bottom inset for the nav bar. A 3-button Android navigation bar (~48dp)
  // is taller than the static 24 that clears a gesture handle. Without this
  // the tabs sit underneath it (Redmi Note 11 report, v0.77.1).
  const insets = useSafeAreaInsets();
  // Lifts the import sheet clear of the IME. Its URL field is the last
  // control in the sheet, so the keyboard covered it outright.
  const keyboardInset = useKeyboardInset();
  // Bottom-sheet height cap, in pixels rather than the '85%' the stylesheet
  // used to carry. See the `sheet` style for why the percentage form opened
  // the Filters sheet at a third of its height.
  const { height: windowHeight } = useWindowDimensions();
  const sheetMaxHeight = Math.round(windowHeight * 0.85);
  // Body opacity for the tab-switch crossfade in jumpToView.
  // Horizontal offset of the body wrapper during a bottom-nav view switch
  // (0 = at rest). Driven by jumpToView's two-phase slide.
  const bodySlide = useRef(new Animated.Value(0)).current;

  const [entries, setEntries] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  // Debounced mirror: the reload trigger. The TextInput stays bound to
  // searchQuery (instant); reloads no longer fire per keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  // N12 filters: bead shape × mood × pattern × glyph. AND between facets,
  // OR within a facet. Ephemeral: never persisted. The filter only ever
  // surfaces what was already encoded into a bead; it adds no metadata
  // layer.
  const [shapeFilter, setShapeFilter] = useState([]);
  const [moodFilter, setMoodFilter] = useState([]);
  const [patternFilter, setPatternFilter] = useState([]);
  // Glyph is the only unbounded facet (user-authored per entry), so it
  // gets a searchable list inside the Filters sheet, not a fixed control.
  const [glyphFilter, setGlyphFilter] = useState([]);
  const [glyphsInUse, setGlyphsInUse] = useState([]); // [{ glyph, count }]
  const [glyphSearch, setGlyphSearch] = useState('');
  // The "Unwoven only" lens: entries with no user-thread connection of
  // either verb (no thread_beads row AND no entry_thread_links row, both
  // restricted to kind='user', which matches the noise-exclusion invariant in
  // services/threadMembership.js). Ephemeral like the bead facets, never
  // persisted. AND-composes with the other facets.
  const [unwoven, setUnwoven] = useState(false);
  // The positive half of the same Connection cut: entries that point at
  // another user thread through a mention. Mutually exclusive with
  // `unwoven` (which requires *no* mention): turning either on clears the
  // other, since both together can only ever yield an empty list.
  const [mentionsOthers, setMentionsOthers] = useState(false);
  // Capture lenses. Deliberately two flags rather than one "has media":
  // a voice-only entry is the one thing text search can never reach
  // (search covers title + content + comments, and a recording has none of
  // the three), and collapsing it into a generic attachment filter hides
  // exactly that. Ephemeral, AND-composed, like every other facet.
  const [hasPhoto, setHasPhoto] = useState(false);
  const [hasVoice, setHasVoice] = useState(false);
  // Synced during render and read through inside loadEntries. These four
  // are booleans, so flipping one is precisely the single-dep flip that
  // the React 19/Hermes quirk in v0.63.1/v0.63.2's CHANGELOG can drop.
  // Also, `unwoven` shipped missing from loadEntries' useCallback deps
  // entirely, which pinned its clause to the first render's `false`. The
  // ref is the suspenders (same pattern as homePinnedThreadIdRef); the
  // reload effect keeps all four in its trigger list as the belt.
  const lensRef = useRef(null);
  lensRef.current = { unwoven, mentionsOthers, hasPhoto, hasVoice };
  // Saved beads, as quick lenses at the top of the Filters sheet.
  const [beadPresets, setBeadPresets] = useState([]);
  // Synced each render so handlers frozen by React.memo (e.g. the memoised
  // entry row's bead-long-press) read the *current* presets, not a stale
  // capture from before listBeadPresets() loaded. See handleBeadLongPress.
  const beadPresetsRef = useRef(beadPresets);
  beadPresetsRef.current = beadPresets;
  // All filter facets live in one bottom sheet; the funnel icon in the
  // search row opens it. The funnel turns primary-colored and shows an
  // active-facet count badge when any filter is on, so users know filters
  // are applied without an inline summary row taking list space.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Fired-reminder banner stack is collapsed by default behind the header
  // bell icon. Reset each session (no persistence). Count of pending items
  // is shown as a badge on the bell so users still get the signal without
  // the banners eating vertical space.
  const [bannersOpen, setBannersOpen] = useState(false);
  // Wander: opt-in chance-return primitive (peer to Bell). The dice icon
  // sits immediately left of the bell when (a) the user enabled the
  // feature in Settings → Wander, AND (b) a cheap probe found at least
  // one eligible entry (older than `wanderThresholdDays`, not private).
  // Both must be true; both must have loaded. Until both have resolved
  // the icon is hidden: we don't want a flicker during boot.
  // `wanderReady` flips true after the *first* settings load completes;
  // pool re-probes happen whenever settings or the entry set change.
  const [wanderEnabled, setWanderEnabled] = useState(false);
  const [wanderThresholdDays, setWanderThresholdDays] = useState(180);
  const [wanderReady, setWanderReady] = useState(false);
  const [wanderPoolNonEmpty, setWanderPoolNonEmpty] = useState(false);
  // Settings / Lock / Select live behind a 3-dot overflow in the header
  // instead of being four flat icons in a row. Visible state only: no
  // persistence.
  const [overflowMenuVisible, setOverflowMenuVisible] = useState(false);
  // Measured position of the ⋮ icon so the popover can anchor pixel-perfectly
  // below it instead of guessing offsets.
  const [overflowAnchor, setOverflowAnchor] = useState({ top: 100, right: 16 });
  const overflowAnchorRef = useRef(null);
  // Bell popover anchor, measured the same ⋮-style way so the fired-reminder
  // banners render as a tooltip overlay under the bell instead of inline
  // (where they shoved the search row + list down). `iconCenterX` positions
  // the tail under the bell; the card itself is near-full-width.
  const [bellAnchor, setBellAnchor] = useState({ top: 100, iconCenterX: 0 });
  const bellAnchorRef = useRef(null);
  // SectionList ref so A2 (bead-long-press → filter) can scroll the list
  // to the top after the filter applies. The new scope's first row
  // would otherwise be off-screen if the user was deep in the list.
  const sectionListRef = useRef(null);
  const [refreshing, setRefreshing] = useState(false);
  const [voiceVisible, setVoiceVisible] = useState(false);
  // Note import (the capture bridge: docs/architecture/note-import.md).
  const [importSheetVisible, setImportSheetVisible] = useState(false);
  const [importFolderUri, setImportFolderUriState] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importNotice, setImportNotice] = useState(null); // { imported, skipped }
  const [importUrl, setImportUrl] = useState('');
  // Once-per-focus, non-reentrant guard for the silent folder scan.
  const importScanRef = useRef({ running: false, lastAt: 0 });
  const [view, setView] = useState('list'); // 'list' | 'calendar' | 'threads'
  // Density readout for the threads-view subtitle ("5 Threads of life").
  // ThreadsList owns the filtered list; the count is lifted up via
  // `onCountChange` and consumed by `subtitleFor` in the header block.
  // List view reads `entries.length` directly (already filter-responsive
  // after loadEntries). Calendar view has a static subtitle and ignores
  // both counts.
  const [threadsCount, setThreadsCount] = useState(0);
  const [entriesByDate, setEntriesByDate] = useState({});
  // Representative bead per day → the calendar renders the day's bead in its
  // cell (the calendar IS the memory-palace; a day reads as the bead it holds).
  const [beadsByDate, setBeadsByDate] = useState({});
  const [anchoredThreads, setAnchoredThreads] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [reminderSheetVisible, setReminderSheetVisible] = useState(false);
  const [reminderCommentsFor, setReminderCommentsFor] = useState(null);
  // Entry the swipe-right gesture is targeting. Drives the CommentsDrawer
  // mount that lives at the screen root so it can survive the row unmounting
  // (e.g., if the user changes filters while the drawer is open).
  const [entryCommentsFor, setEntryCommentsFor] = useState(null);
  const [reminderCommentCounts, setReminderCommentCounts] = useState({});
  const [firedCommentReminders, setFiredCommentReminders] = useState([]);
  // Live comment-reminders (pending + fired) surfaced in the calendar's
  // bottom panel alongside scheduled_prompts. Same liveness window as the
  // banner stack: anything not yet acked.
  const [calendarCommentReminders, setCalendarCommentReminders] = useState([]);
  const [doneCommentReminders, setDoneCommentReminders] = useState([]);
  // Recurrence chrome state.
  const [reminderActionsTarget, setReminderActionsTarget] = useState(null);
  // False until the first loadEntries result lands. Gates the list's
  // empty state so it never renders (or lingers) before the data answered.
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [reminderEditTarget, setReminderEditTarget] = useState(null);
  const [recurringListVisible, setRecurringListVisible] = useState(false);
  // Inline comment previews (toggle in the list/threads headers). Persisted
  // in expo-secure-store; default off so existing users don't see lists
  // suddenly bloom with comment text.
  const [inlineComments, setInlineCommentsLocal] = useState(false);

  useEffect(() => {
    isInlineCommentsVisible().then(setInlineCommentsLocal);
  }, []);

  // Apply the user's preferred startup view once on mount. Loaded async from
  // secure-store; until it resolves we stay on the default 'list'.
  // Skip the read entirely when the route arrives with a `pinThreadId`:
  // `pinThreadScope` (line 1446) forces `view='list'` synchronously so the
  // pinned-thread pill can render, and a late-arriving `setView(default)`
  // from this async would otherwise land *after* that, clobbering 'list'
  // back to e.g. 'threads' and hiding the pill (and the captured scope it
  // controls). The "Read as list" navigation contract has to win.
  useEffect(() => {
    if (route?.params?.pinThreadId != null) return;
    getDefaultHomeView().then(setView);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);

  const toggleInlineComments = async () => {
    const next = !inlineComments;
    await setInlineCommentsVisible(next);
    setInlineCommentsLocal(next);
  };
  // Increments at the exact moment the next pending reminder is due so the
  // fired-banner derivation re-evaluates without needing a state change to
  // reminders. Belt for the suspenders of the OS notification listener
  // (which never fires on Android Expo Go).
  const [tick, setTick] = useState(0);

  // Multi-select state: a flat Set of entry ids and the modal toggles for
  // the consolidation actions (fuse / thread batch picker). Entering select
  // mode replaces the header chrome with an action bar, disables swipe +
  // long-press on rows, and hides the FAB. Tap a row in this mode toggles
  // selection; nothing else.
  const [selectMode, setSelectMode] = useState(false);
  // Which list the current selection lives on. Drives the select-mode
  // header chrome (entry: Fuse / Thread-batch / Delete; thread:
  // Add-to-collection / Delete). Kept *after* exit so the closing header
  // doesn't briefly flicker to the other context's chrome.
  const [selectionContext, setSelectionContext] = useState('entry');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Tick incremented after any batch op that mutates threads, so the
  // ThreadsList component reloads. ThreadsList has its own focus-reload,
  // but we're still on the threads view after a batch, so no focus event
  // fires. A simple prop tick is enough.
  const [threadsRefreshTick, setThreadsRefreshTick] = useState(0);
  const bumpThreadsRefresh = useCallback(
    () => setThreadsRefreshTick((n) => n + 1),
    []
  );
  const [batchCollectionPickerVisible, setBatchCollectionPickerVisible] =
    useState(false);
  const [fuseSheetVisible, setFuseSheetVisible] = useState(false);
  const [batchThreadPickerVisible, setBatchThreadPickerVisible] = useState(false);
  // In-memory dismissed entry-id set for the burst banner. Burst clusters
  // age out naturally inside ~30 min so persistent storage is unnecessary;
  // re-launching the app re-evaluates the cluster cleanly.
  const [dismissedBurstIds, setDismissedBurstIds] = useState(() => new Set());
  // Backup nudge: null, or { never, ageText } when the strip should show.
  // Derivation (stale + unbacked-up writes + not snoozed) lives in
  // services/backup.js; this is display state only.
  const [backupNudge, setBackupNudge] = useState(null);

  // Request-id guard for `loadEntries`. Multiple loadEntries calls can be
  // in flight when navigation lands here with `route.params.pinThreadId`:
  // the focus listener fires `loadEntries()` synchronously (closed over
  // the pre-pin state: `homePinnedThreadId` is still null), then the
  // consumer effect sets the pin → firing effect dispatches a second
  // `loadEntries()` (with the new pin). Both queries run on expo-sqlite's
  // single connection and interleave; the *unfiltered* one usually has
  // more rows / more enrichment and finishes LAST, so its `setEntries`
  // would otherwise overwrite the filtered one. The ref bumps on each
  // call; only the call whose id still matches at completion time is
  // allowed to write.
  const loadEntriesReqRef = useRef(0);

  const loadEntries = useCallback(async () => {
    const reqId = ++loadEntriesReqRef.current;
    const db = getDb();
    if (!db) return;

    const wheres = [];
    const params = [];

    const q = debouncedQuery;
    if (q) {
      // Search title + body + the entry's comments. The EXISTS keeps the
      // overall query a SELECT FROM entries so DISTINCT isn't needed.
      wheres.push(
        `(title LIKE ? OR content LIKE ? OR EXISTS (
            SELECT 1 FROM comments c
             WHERE c.parent_kind = 'entry'
               AND c.parent_id = entries.id
               AND c.body LIKE ?
          ))`
      );
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (shapeFilter.length) {
      const placeholders = shapeFilter.map(() => '?').join(', ');
      wheres.push(`bead_shape IN (${placeholders})`);
      params.push(...shapeFilter);
    }
    if (moodFilter.length) {
      const placeholders = moodFilter.map(() => '?').join(', ');
      wheres.push(`bead_mood IN (${placeholders})`);
      params.push(...moodFilter);
    }
    if (patternFilter.length) {
      const placeholders = patternFilter.map(() => '?').join(', ');
      wheres.push(`bead_pattern IN (${placeholders})`);
      params.push(...patternFilter);
    }
    if (glyphFilter.length) {
      const placeholders = glyphFilter.map(() => '?').join(', ');
      wheres.push(`bead_glyph IN (${placeholders})`);
      params.push(...glyphFilter);
    }
    // Thread-scope pin: entries that belong to a specific thread's chain.
    // Triggered by ThreadDetailScreen's "As list" button (navigate('Home',
    // { pinThreadId })). The clause AND-composes with the facet filters and
    // search text so refining within a thread is the natural read. Uses
    // the existing idx_thread_beads_thread index: one subquery, no join.
    //
    // Read through `homePinnedThreadIdRef.current`, not the closure: the
    // X-on-pill handler syncs the ref synchronously before calling
    // loadEntries directly, so the cleared pin is honored even if the
    // dep-driven effect at ~881 fails to re-fire under the React 19/Hermes
    // single-dep-flip quirk that v0.63.1's CHANGELOG documents.
    const pinId = homePinnedThreadIdRef.current;
    if (pinId != null) {
      wheres.push(
        `id IN (SELECT entry_id FROM thread_beads WHERE thread_id = ? AND entry_id IS NOT NULL)`
      );
      params.push(pinId);
    }
    // Unwoven lens: entries with no chain bead AND no mention pointing at
    // any user thread. Mention counts as wovenness (it is the
    // cross-reference verb of the same primitive), so a mentioned-only
    // entry is filtered out. Auto-threads excluded so the lens isn't drowned
    // by the auto_day membership every entry has by definition. Same
    // invariant as services/threadMembership.js#loadThreadCountsForEntries.
    // Indexes idx_thread_beads_entry and idx_entry_thread_links_entry make
    // each NOT EXISTS O(log n) per row.
    const lenses = lensRef.current;
    if (lenses.unwoven) {
      wheres.push(
        `NOT EXISTS (
           SELECT 1 FROM thread_beads tb
            JOIN threads t ON t.id = tb.thread_id
            WHERE tb.entry_id = entries.id AND t.kind = 'user'
         )
         AND NOT EXISTS (
           SELECT 1 FROM entry_thread_links etl
            JOIN threads t ON t.id = etl.thread_id
            WHERE etl.entry_id = entries.id AND t.kind = 'user'
         )`
      );
    }
    // Mentions lens: the positive half of the Unwoven cut, so it mirrors
    // the same clause: the mention verb only, user threads only (an
    // auto-thread is never the target of a mention anyway, but the join
    // keeps the two halves textually symmetric). idx_entry_thread_links_entry
    // makes it O(log n) per row.
    if (lenses.mentionsOthers) {
      wheres.push(
        `EXISTS (
           SELECT 1 FROM entry_thread_links etl
            JOIN threads t ON t.id = etl.thread_id
            WHERE etl.entry_id = entries.id AND t.kind = 'user'
         )`
      );
    }
    // Capture lenses: idx_entry_photos_entry / idx_entry_voice_notes_entry
    // cover both. Both on = entries carrying photo AND voice, which is the
    // AND-composition every other facet already follows.
    if (lenses.hasPhoto) {
      wheres.push(
        `EXISTS (SELECT 1 FROM entry_photos p WHERE p.entry_id = entries.id)`
      );
    }
    if (lenses.hasVoice) {
      wheres.push(
        `EXISTS (SELECT 1 FROM entry_voice_notes v WHERE v.entry_id = entries.id)`
      );
    }

    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    // Explicit column list with a TRUNCATED body. `SELECT *` marshalled
    // every entry's full `content` across the bridge on every focus
    // (~230-400ms for 283 rows), purely to feed a one-line excerpt
    // (EntryCard clamps it to numberOfLines={1}). LIST_EXCERPT_CHARS is
    // far more than one line can show, so the visible result is
    // identical. Safe because nothing writes a list row's content back:
    // every navigation into the editor passes `entryId` only (the editor
    // re-reads the row), and Fuse takes ids and re-reads via
    // loadFusePreview / fuseEntries. If you ever pass a list row's
    // `content` to a writer, this truncation becomes data loss. Read
    // the full row from the DB instead.
    const rows = await db.getAllAsync(
      `SELECT id, title, substr(content, 1, ${LIST_EXCERPT_CHARS}) AS content,
              date, time, created_at, updated_at,
              bead_shape, bead_pattern, bead_mood, bead_glyph,
              highlight_tier, is_private
         FROM entries ${where} ORDER BY date DESC, updated_at DESC`,
      params
    );

    // Batched (2 queries total, not 2 per entry: see attachments.js).
    const attachments = await loadAttachmentsForEntries(rows.map((r) => r.id));
    const enriched = rows.map((entry) => ({
      ...entry,
      photos: attachments[entry.id]?.photos ?? [],
      voiceNotes: attachments[entry.id]?.voiceNotes ?? [],
    }));

    // Batch the comment counts in a single query rather than N queries.
    const ids = enriched.map((e) => e.id);
    const counts = await loadCommentCounts(PARENT_ENTRY, ids);
    const previews = inlineComments
      ? await loadCommentPreviews(PARENT_ENTRY, ids, 2)
      : {};
    const threadCounts = await loadThreadCountsForEntries(ids);
    // Only when a bead filter is on: the disambiguation strip ("whose bead
    // is this?") is dead weight in the normal chronological list, so don't
    // pay the extra query there. Recomputed from the filter arrays (already
    // deps) rather than the render-scope `filterActive` to avoid a stale
    // closure.
    const filtersOn =
      shapeFilter.length > 0 ||
      moodFilter.length > 0 ||
      patternFilter.length > 0 ||
      glyphFilter.length > 0;
    const beadThreadNames = filtersOn
      ? await loadBeadThreadNamesForEntries(ids)
      : null;
    for (const e of enriched) {
      e.commentCount = counts[e.id] ?? 0;
      e.commentsPreview = previews[e.id] || [];
      e.threadCount = threadCounts[e.id] ?? 0;
      if (beadThreadNames) e.beadThreadNames = beadThreadNames[e.id] || [];
    }

    // Drop the write if a newer loadEntries has been dispatched while we
    // were enriching. Otherwise a stale unfiltered result can overwrite
    // a fresh filtered one (see `loadEntriesReqRef` comment).
    if (reqId !== loadEntriesReqRef.current) return;
    setEntries(enriched);
    setEntriesLoaded(true);
  }, [
    debouncedQuery,
    shapeFilter,
    moodFilter,
    patternFilter,
    glyphFilter,
    inlineComments,
    // The four lens booleans (unwoven / mentionsOthers / hasPhoto /
    // hasVoice) are deliberately NOT in deps either. They're read through
    // `lensRef.current`, so a flip can't be lost to a stale memoised
    // callback. The reload effect below lists all four.
    // `homePinnedThreadId` deliberately NOT in deps: loadEntries reads
    // it via `homePinnedThreadIdRef.current` (synced during render at
    // line 1473 and synchronously in the X-on-pill handler) so a single-
    // dep flip can't be lost by the React 19/Hermes effect-dep quirk
    // documented in v0.63.1's CHANGELOG. The pin's effect at ~881 keeps
    // it in its trigger list as a belt; the ref read is the suspenders.
  ]);

  // Distinct non-empty glyphs in use, frequency-ordered, for the glyph
  // filter sheet. Surfaces only what was encoded: no metadata layer.
  const loadGlyphsInUse = useCallback(async () => {
    const db = getDb();
    if (!db) return;
    const rows = await db.getAllAsync(
      `SELECT bead_glyph AS glyph, COUNT(*) AS count
         FROM entries
        WHERE bead_glyph IS NOT NULL AND bead_glyph != ''
        GROUP BY bead_glyph
        ORDER BY count DESC, bead_glyph ASC`
    );
    setGlyphsInUse(rows);
  }, []);

  // Saved beads, recency-ordered, for the Filters sheet shortcut strip.
  // The sheet only *consumes* presets (authoring/deleting lives in
  // BeadComposer); here a preset just pre-fills the four facets.
  const loadPresets = useCallback(async () => {
    setBeadPresets(await listBeadPresets());
  }, []);

  // Wander: reload the user's settings (enabled + threshold). Runs on
  // mount and on every focus, so a change in Settings → Wander is
  // reflected the moment the user returns to Home. After settings load,
  // `wanderReady` flips true; the icon's render gate also checks
  // `wanderEnabled` and `wanderPoolNonEmpty` so it never appears during
  // boot.
  const loadWanderPrefs = useCallback(async () => {
    const s = await loadWanderSettings();
    setWanderEnabled(s.enabled);
    setWanderThresholdDays(s.thresholdDays);
    setWanderReady(true);
  }, []);

  // Wander: cheap probe to decide whether to render the dice icon.
  // We never *need* the count; one-row LIMIT 1 is all the icon's
  // visibility depends on. Runs when (a) settings change, (b) the
  // entry set changes (a delete/insert might empty or fill the pool),
  // or (c) focus. The query mirrors the tap-time pick so the
  // visibility signal matches reality.
  const probeWanderPool = useCallback(async () => {
    if (!wanderEnabled) {
      setWanderPoolNonEmpty(false);
      return;
    }
    const db = getDb();
    if (!db) return;
    try {
      const row = await db.getFirstAsync(
        `SELECT 1 AS x FROM entries
          WHERE date <= date('now', ?)
            AND is_private = 0
          LIMIT 1`,
        [`-${wanderThresholdDays} days`]
      );
      setWanderPoolNonEmpty(!!row);
    } catch {
      setWanderPoolNonEmpty(false);
    }
  }, [wanderEnabled, wanderThresholdDays]);

  // Wander tap: pick one eligible entry uniformly at random and open
  // it. No anti-repetition memory (true random is more honest for v1
  // and avoids hidden state). If the probe said pool was non-empty
  // but the pick returns nothing (the user deleted the last eligible
  // entry between probe and tap, a rare race), silently no-op rather
  // than showing an error toast.
  const handleWanderTap = useCallback(async () => {
    const db = getDb();
    if (!db) return;
    try {
      const row = await db.getFirstAsync(
        `SELECT id FROM entries
          WHERE date <= date('now', ?)
            AND is_private = 0
          ORDER BY RANDOM()
          LIMIT 1`,
        [`-${wanderThresholdDays} days`]
      );
      if (!row || row.id == null) return;
      navigation.push('EntryEditor', { entryId: row.id });
    } catch {
      // Silent: Wander is a low-stakes lens. If the DB hiccups, we
      // just don't navigate.
    }
  }, [wanderThresholdDays, navigation]);

  const loadEntryCounts = useCallback(async () => {
    const db = getDb();
    if (!db) return;
    const rows = await db.getAllAsync(
      `SELECT date, COUNT(*) AS count FROM entries GROUP BY date`
    );
    const map = {};
    for (const r of rows) map[r.date] = r.count;
    setEntriesByDate(map);
    // One representative bead per day for the calendar-as-beads render: the
    // day's *highlighted* bead first (tier desc), else its latest beaded entry.
    // Strictly one per cell (load-bearing decision 4): a day holds several
    // beads, the cell never claims to show "the" bead (the +N badge admits it).
    const beadRows = await db.getAllAsync(
      `SELECT date, bead_shape, bead_pattern, bead_mood, bead_glyph
         FROM entries
        WHERE bead_shape IS NOT NULL AND bead_shape != ''
        ORDER BY date, highlight_tier DESC, created_at DESC`
    );
    const beadMap = {};
    for (const r of beadRows) {
      if (beadMap[r.date]) continue; // first row per date = representative
      beadMap[r.date] = {
        shape: r.bead_shape,
        pattern: r.bead_pattern || 'solid',
        mood: r.bead_mood || 'slate',
        glyph: r.bead_glyph || '',
      };
    }
    setBeadsByDate(beadMap);
  }, []);

  const loadAnchoredThreads = useCallback(async () => {
    // Reads via the service so the band's "what counts as anchored"
    // definition lives in one place (anchoredThreads.js) shared with
    // the Day view, so they can't drift.
    setAnchoredThreads(await loadAnchoredThreadsSvc());
  }, []);

  // Stale-request guard, same class as loadEntriesReqRef: the focus
  // listener's secondary loads run this concurrently with user actions,
  // and an in-flight call that SELECTed *before* an acknowledge could
  // land its setReminders *after* the ack's own reload, resurrecting the
  // acked banner as a ghost. Observed 2026-08-30 through the
  // notification-tap → action-sheet → Acknowledge flow, whose timing puts
  // the ack squarely inside the focus-load window (the banner's × "worked"
  // only because those taps happened outside it). Latest dispatch wins;
  // stale results are dropped whole.
  const loadRemindersReqRef = useRef(0);
  const loadReminders = useCallback(async () => {
    const reqId = ++loadRemindersReqRef.current;
    const db = getDb();
    if (!db) return;
    const rows = await db.getAllAsync(
      `SELECT id, title, message, scheduled_date, scheduled_time,
              notification_id, acknowledged_at, is_active,
              recurrence_kind, recurrence_every, recurrence_max,
              recurrence_fired, recurrence_anchor_day
         FROM scheduled_prompts
        ORDER BY scheduled_date ASC, scheduled_time ASC`
    );
    const counts = await loadCommentCounts(
      PARENT_REMINDER,
      rows.map((r) => r.id)
    );
    if (reqId !== loadRemindersReqRef.current) {
      console.log('loadReminders: dropped stale result');
      return;
    }
    setReminders(rows);
    setReminderCommentCounts(counts);
  }, []);

  // Acknowledged or stopped reminders disappear from the calendar panel,
  // the day-cell bells, and the fired-banner stack: they're done business.
  // A recurring series is "active" while is_active = 1 *and* its cursor
  // hasn't been acked; one-shots use acknowledged_at alone.
  const activeReminders = useMemo(
    () =>
      reminders.filter(
        (r) => !r.acknowledged_at && (r.is_active == null || r.is_active === 1)
      ),
    [reminders]
  );

  // Acked one-shot reminders. The row was never deleted: it just left
  // the active list. We surface these as struck "done" markers on their
  // calendar day (panel + Day view) so an ack off the banner is no
  // longer oblivion; recurring acked rows are managed via the recurring
  // sheet, so they're excluded here.
  const doneReminders = useMemo(
    () => reminders.filter((r) => r.acknowledged_at && !r.recurrence_kind),
    [reminders]
  );

  const firedReminders = useMemo(() => {
    const now = Date.now();
    return activeReminders
      .filter((r) => {
        if (!r.scheduled_date || !r.scheduled_time) return false;
        const t = Date.parse(`${r.scheduled_date}T${r.scheduled_time}:00`);
        return Number.isFinite(t) && t <= now;
      })
      .sort((a, b) => {
        const ka = `${a.scheduled_date} ${a.scheduled_time || ''}`;
        const kb = `${b.scheduled_date} ${b.scheduled_time || ''}`;
        return ka.localeCompare(kb);
      });
    // tick is intentional: forces re-evaluation when a scheduled-time timer fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReminders, tick]);

  const pendingBannerCount =
    firedReminders.length + firedCommentReminders.length;

  // The popover is deliberately *not* auto-closed when the count hits 0:
  // acking the last banner leaves the empty state in place, which confirms
  // the dismissal instead of yanking the card away mid-gesture.

  // Refresh fired comment-reminders on tick / mount / refresh events. The
  // banner stack derives from this list directly (no useMemo over reminders:
  // comments live in a separate table). The calendar panel uses a wider
  // window (pending + fired) so users see *upcoming* self-pings too, not
  // just ones already due.
  // Same stale-request guard as loadReminders: comment-reminder acks
  // race the focus-driven refresh identically.
  const refreshFiredReqRef = useRef(0);
  const refreshFiredCommentReminders = useCallback(async () => {
    const reqId = ++refreshFiredReqRef.current;
    const [fired, all, done] = await Promise.all([
      loadFiredCommentReminders(),
      loadCommentRemindersWithLabels(),
      loadDoneCommentRemindersWithLabels(),
    ]);
    if (reqId !== refreshFiredReqRef.current) {
      console.log('refreshFiredCommentReminders: dropped stale result');
      return;
    }
    setFiredCommentReminders(fired);
    setCalendarCommentReminders(all);
    setDoneCommentReminders(done);
  }, []);
  useEffect(() => {
    refreshFiredCommentReminders();
  }, [refreshFiredCommentReminders, tick]);

  // Schedule a precise timeout for the next not-yet-fired reminder so the
  // banner appears at exactly the right moment, independent of the OS
  // notification path (which Expo Go on Android can't deliver). Considers
  // both calendar reminders (scheduled_prompts) and comment-reminders so
  // whichever fires first wakes the tick.
  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    (async () => {
      const now = Date.now();
      const reminderTimes = activeReminders
        .map((r) => {
          if (!r.scheduled_date || !r.scheduled_time) return NaN;
          return Date.parse(`${r.scheduled_date}T${r.scheduled_time}:00`);
        })
        .filter((t) => Number.isFinite(t) && t > now);
      const pendingComments = await loadPendingCommentReminders();
      if (cancelled) return;
      const commentTimes = pendingComments
        .map((c) => Date.parse(c.remind_at))
        .filter((t) => Number.isFinite(t) && t > now);
      const all = [...reminderTimes, ...commentTimes];
      if (all.length === 0) return;
      const nextAt = Math.min(...all);
      const id = setTimeout(() => setTick((n) => n + 1), nextAt - now + 200);
      cleanup = () => clearTimeout(id);
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [activeReminders, tick]);

  const acknowledgeReminder = async (reminder) => {
    hapticTap(); // done business
    // Recurrence-aware ack. For one-shot reminders this still just sets
    // acknowledged_at; for a series it advances the cursor (catching up
    // any missed occurrences) and reschedules the next OS notification.
    await acknowledgeReminderById(reminder.id);
    await loadReminders();
  };

  const handleRestoreReminder = async (reminder) => {
    // Bring a done one-shot back from its calendar day (panel / Day view).
    await restoreReminder(reminder.id);
    await loadReminders();
  };

  const openCommentReminder = (c) => {
    // Tap the banner → navigate to parent and auto-open the comments
    // drawer there. Per N15: tap alone does NOT acknowledge: the user
    // has to actually engage by editing or adding content.
    if (c.parent_kind === PARENT_ENTRY) {
      navigation.navigate('EntryEditor', {
        entryId: c.parent_id,
        autoOpenComments: true,
      });
    } else if (c.parent_kind === PARENT_THREAD) {
      navigation.navigate('ThreadDetail', {
        threadId: c.parent_id,
        autoOpenComments: true,
      });
    }
  };

  const dismissCommentReminder = async (c) => {
    hapticTap(); // done business
    // Explicit × on the banner → ack the single fired comment-reminder.
    // Distinct from the implicit content-edit path which acks every fired
    // self-ping for that parent at once.
    await acknowledgeCommentReminder(c.id);
    await refreshFiredCommentReminders();
  };

  const openReminderEntry = (reminder) => {
    // Don't acknowledge on tap, only when the user actually writes content.
    // EntryEditor consumes `reminderId` to clear the banner once it auto-saves
    // a non-empty entry. Tapping the banner and backing out leaves the
    // reminder in place so the user gets nudged again.
    navigation.navigate('EntryEditor', {
      entryId: null,
      prefillTitle: reminder.title || 'Journal Reminder',
      reminderId: reminder.id,
    });
  };

  // Notification tap → in-app destination, with the banner rule intact:
  // tap does NOT acknowledge; only engaging with content does (N15).
  // A reminder tap opens the ReminderActionsSheet (the same options as
  // long-pressing the reminder: write / edit / done / stop / delete)
  // rather than jumping straight into a new note; the maker's call
  // (2026-08-30): the notification announces, the user decides. A
  // comment-reminder tap still goes straight to its parent. HomeScreen
  // is the consumer because it mounts only after unlock + DB init. A
  // cold-start tap waits in notificationRouting until then. A payload
  // whose row no longer exists (deleted reminder, or a different vault
  // is open) resolves to a silent no-op.
  useEffect(() => {
    return setNotificationRouteConsumer(async (route) => {
      try {
        if (route.kind === 'reminder' && route.reminderId != null) {
          const db = getDb();
          if (!db) return;
          // The payload id is a HINT, not the truth: it was baked at
          // schedule time, and a row edited/deleted/re-created since (or
          // a zombie notification from the stale-notification_id era that
          // delete couldn't cancel) can leave it pointing at a row that
          // is no longer the live fired one. Acking that stale row is a
          // silent no-op while the banner stays lit (observed 2026-08-30).
          // Resolve against the ACTIVE list; when the payload row isn't
          // active, fall back to what the banner actually shows: the
          // newest fired active reminder (same derivation as the bell).
          const rows = await db.getAllAsync(
            `SELECT * FROM scheduled_prompts
              WHERE acknowledged_at IS NULL
                AND (is_active IS NULL OR is_active = 1)`
          );
          let row = rows.find((r) => r.id === route.reminderId) || null;
          if (!row) {
            const now = Date.now();
            row =
              rows
                .filter((r) => {
                  const t = Date.parse(
                    `${r.scheduled_date}T${r.scheduled_time || '00:00'}:00`
                  );
                  return Number.isFinite(t) && t <= now;
                })
                .sort((a, b) =>
                  `${b.scheduled_date} ${b.scheduled_time || ''}`.localeCompare(
                    `${a.scheduled_date} ${a.scheduled_time || ''}`
                  )
                )[0] || null;
          }
          if (!row) return;
          // Surface Home in its CALENDAR view, the reminder's home
          // surface (the maker's call, 2026-08-30), popping any stacked
          // screens first. The sheet itself opens on a delay: an Android
          // Modal presented while the pop transition is still running
          // flashes and is torn down with it (same race family as the
          // attach-sheet → picker note in EntryEditorScreen; observed
          // here when tapping a notification from inside a note). 400ms
          // clears the stack's 150ms transition with margin; on a cold
          // start there's no transition and the delay is imperceptible.
          navigation.navigate('Home');
          setView('calendar');
          setTimeout(() => setReminderActionsTarget(row), 400);
        } else if (route.kind === 'comment' && route.parentId != null) {
          openCommentReminder({
            parent_kind: route.parentKind,
            parent_id: route.parentId,
          });
        }
      } catch (e) {
        console.warn('Notification route failed:', e?.message || e);
      }
    });
  }, []);

  // While the app is foregrounded, refresh reminders whenever a notification
  // fires so the new fired reminder pops into the banner immediately.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => {
      loadReminders();
    });
    return () => sub.remove();
  }, [loadReminders]);

  const handleReminderLongPress = (reminder) => {
    setReminderActionsTarget(reminder);
  };

  const handleReminderEdit = () => {
    const target = reminderActionsTarget;
    setReminderActionsTarget(null);
    setReminderEditTarget(target);
  };

  const handleReminderToggleActive = async () => {
    const target = reminderActionsTarget;
    if (!target) return;
    setReminderActionsTarget(null);
    await setReminderActive(target.id, !target.is_active);
    await loadReminders();
  };

  const handleDeleteReminder = async (reminder) => {
    Alert.alert('Delete reminder', 'Delete this scheduled reminder?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await cancelNotification(reminder.notification_id);
          await removeCommentsForParent(PARENT_REMINDER, reminder.id);
          const db = getDb();
          if (!db) return;
          await db.runAsync('DELETE FROM scheduled_prompts WHERE id = ?', [
            reminder.id,
          ]);
          loadReminders();
        },
      },
    ]);
  };

  // Silent pull-on-focus folder scan (note-import.md §4.4). Pull, not
  // push: no background watcher (the OS limit that also made a
  // phone-server fragile). Non-reentrant + ~1.5s debounce so rapid
  // focus toggling never thrashes or double-imports; the ledger is the
  // real idempotency backbone, this guard just avoids redundant work.
  const runFolderScanOnFocus = useCallback(async () => {
    const uri = await getImportFolderUri();
    setImportFolderUriState(uri || null);
    if (!uri) return;
    const g = importScanRef.current;
    const now = Date.now();
    if (g.running || now - g.lastAt < 1500) return;
    g.running = true;
    g.lastAt = now;
    try {
      const res = await importFromFolder(uri);
      if (res && res.imported > 0) {
        setImportNotice(res);
        await loadEntries();
        await loadEntryCounts();
      }
    } catch (e) {
      console.warn('folder scan failed:', e?.message || e);
    } finally {
      importScanRef.current.running = false;
    }
  }, [loadEntries, loadEntryCounts]);

  // Explicit scan invoked from the import sheet (vs the silent focus
  // scan). Surfaces the count even when zero so the action feels
  // answered. Shares the same service + ledger as the focus scan.
  const runImportScan = useCallback(
    async (uri) => {
      if (!uri || importBusy) return;
      setImportBusy(true);
      try {
        const res = await importFromFolder(uri);
        setImportNotice(res);
        if (res && res.imported > 0) {
          await loadEntries();
          await loadEntryCounts();
        }
      } catch (e) {
        console.warn('import scan failed:', e?.message || e);
        setImportNotice({ imported: 0, skipped: 0, error: true });
      } finally {
        setImportBusy(false);
      }
    },
    [importBusy, loadEntries, loadEntryCounts]
  );

  const chooseImportFolder = useCallback(async () => {
    const { granted, uri } = await pickImportFolder();
    if (granted && uri) {
      setImportFolderUriState(uri);
      await runImportScan(uri);
    }
  }, [runImportScan]);

  const runUrlImport = useCallback(async () => {
    const u = importUrl.trim();
    if (!u || importBusy) return;
    setImportBusy(true);
    try {
      const res = await importFromUrl(u);
      setImportNotice(res);
      if (res && res.imported > 0) {
        setImportUrl('');
        await loadEntries();
        await loadEntryCounts();
      }
    } catch (e) {
      console.warn('url import failed:', e?.message || e);
      setImportNotice({ imported: 0, skipped: 0, error: true });
    } finally {
      setImportBusy(false);
    }
  }, [importUrl, importBusy, loadEntries, loadEntryCounts]);

  // Focus listener uses `focusHandlersRef` (declared here, populated after
  // all loaders are declared, see the assignment near the end of the
  // component body) to hold the latest handler functions so it never
  // closes over stale references. Why this ref pattern:
  //
  // The original implementation listed `loadEntries`, `loadPinnedThread`,
  // etc. directly in this useEffect's dep array, but several of those
  // useCallbacks are declared *after* this useEffect in the component
  // body (TDZ). Even setting TDZ aside, React 19/Hermes's effect dep
  // comparison failed to re-register this listener when a single state
  // change (X-on-pill: homePinnedThreadId 2 → null) flipped only one
  // dep's identity. The listener kept a stale closure over the pre-X
  // state, so the next focus event (Settings round-trip) fired the *old*
  // loaders, re-pinning the dismissed thread (via the old loadPinnedThread
  // closing over T1) and re-filtering entries by it (via the old loadEntries
  // closing over T1). Pill resurrected, filter resurrected. Proven via
  // PIN-DEBUG logs that showed no `focus useEffect RE-REGISTERING` log
  // between the X tap and the resurrection.
  //
  // The ref pattern sidesteps the dep-comparison machinery: the listener
  // is registered once (only re-binds on `navigation`/`route` identity
  // change, which is rare), and every focus event reads the latest
  // function references through the ref. Mutating ref.current during
  // render is allowed (refs don't trigger re-renders).
  const focusHandlersRef = useRef(null);
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      const h = focusHandlersRef.current;
      if (!h) return;
      // The list is what the user came back to see, so `loadEntries` gets
      // the single SQLite connection to itself. expo-sqlite serializes on
      // that connection, so firing all ten loaders together made
      // loadEntries' own stages queue behind the other nine: the list
      // SELECT measured ~394ms and the batched attachment fetch ~290ms,
      // almost entirely queue wait. The same two dropped to 16ms and
      // 8ms once the others were moved behind them, with no change to
      // either query. Everything in `secondary` feeds chrome (banners,
      // chips, the reminder stack); none of it is worth delaying the
      // list for.
      const entriesDone = Promise.resolve(h.loadEntries()).catch(() => {});
      const secondary = () => {
        h.loadEntryCounts();
        h.loadAnchoredThreads();
        h.loadReminders();
        h.refreshFiredCommentReminders();
        h.loadGlyphsInUse();
        h.loadPresets();
        h.loadPinnedThread();
        h.loadBackupNudge();
        h.runFolderScanOnFocus();
        // Wander settings may have changed in Settings → Wander while we
        // were off-screen; reload them. The pool re-probe is chained off
        // settings state via its own effect so we don't double-fire here.
        h.loadWanderPrefs();
      };
      // Chained off `loadEntries` COMPLETING, not off the interaction
      // queue. `InteractionManager.runAfterInteractions` was the obvious
      // idiom and measured useless here: with no interaction handle
      // outstanding at focus time it fires on the very next tick, so all
      // nine secondary loads still raced the list query. Awaiting the
      // promise is what actually frees the connection. The `once` guard
      // plus the timer keep the chrome from being held hostage if
      // loadEntries ever hangs.
      let ran = false;
      const once = () => {
        if (ran) return;
        ran = true;
        secondary();
      };
      entriesDone.then(once, once);
      setTimeout(once, 2000);
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    const h = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 250);
    return () => clearTimeout(h);
  }, [searchQuery]);

  useEffect(() => {
    loadEntries();
  }, [
    debouncedQuery,
    shapeFilter,
    moodFilter,
    patternFilter,
    glyphFilter,
    unwoven,
    mentionsOthers,
    hasPhoto,
    hasVoice,
    inlineComments,
    homePinnedThreadId,
  ]);

  // Glyph set changes rarely (only when beads are edited elsewhere); the
  // focus listener refreshes it on return. This mount-only run guarantees
  // the Glyph chip appears on first visit too. Same story for the backup
  // nudge: the initial focus event can fire before the listener registers.
  useEffect(() => {
    loadGlyphsInUse();
    loadPresets();
    loadBackupNudge();
  }, [loadGlyphsInUse, loadPresets, loadBackupNudge]);

  // Wander: mount-only settings load so the first focus event isn't
  // the only path that fills wanderEnabled / wanderThresholdDays. Without
  // this the icon would stay gated for a render tick while focus dispatches.
  useEffect(() => {
    loadWanderPrefs();
  }, [loadWanderPrefs]);

  // Wander pool probe: re-runs when settings change (enabled/threshold)
  // or when the entry set changes (insert/delete might flip the pool's
  // emptiness). The probe is a one-row LIMIT 1, so re-running on every
  // entries reload is cheap. Threshold changes are picked up automatically
  // because the probe's deps include thresholdDays via the callback.
  useEffect(() => {
    if (!wanderReady) return;
    probeWanderPool();
  }, [wanderReady, probeWanderPool, entries]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadEntries();
    setRefreshing(false);
  };

  // View switching is a plain state change: the bottom nav (jumpToView) is
  // the only switcher. Swipe-to-change-view (the body pan) and the header-flick
  // cycle were removed once the bottom nav landed; row Swipeables and the
  // calendar month-swipe are separate gestures and unaffected.
  const jumpToView = (i) => {
    const targetView = VIEW_ORDER[i];
    if (targetView === view) return;
    // Directional two-phase slide, mirroring the stack's push/pop motion
    // (AppNavigator's 150ms horizontal transitions): moving to a tab on the
    // right, the body exits left and the new view enters from the right;
    // moving left, the reverse. Two phases because the three views are NOT
    // three parallel containers (list chrome is many sibling blocks, the
    // calendar stays mounted behind display:none). Only one view tree
    // exists at a time, so it slides out, swaps at the edge, and slides
    // back in. 75+75ms keeps tab switches as light as the old crossfade.
    // Replaces the 70ms opacity crossfade that first killed the hard cut.
    const dir = i > VIEW_ORDER.indexOf(view) ? 1 : -1;
    const w = Dimensions.get('window').width;
    Animated.timing(bodySlide, {
      toValue: -dir * w,
      duration: 75,
      useNativeDriver: true,
    }).start(() => {
      setView(targetView);
      bodySlide.setValue(dir * w);
      Animated.timing(bodySlide, {
        toValue: 0,
        duration: 75,
        useNativeDriver: true,
      }).start();
    });
  };

  const createQuickEntry = async ({ photoUri, voiceNote }) => {
    const db = getDb();
    if (!db) return;
    // Camera/recorder URIs live in the OS-cleanable cache. Copy them into the
    // vault's attachment store before they hit the DB.
    if (photoUri) photoUri = await persistMediaUri(photoUri, 'photo');
    if (voiceNote) {
      voiceNote = {
        ...voiceNote,
        uri: await persistMediaUri(voiceNote.uri, 'voice'),
      };
    }
    const now = new Date();
    const dateStr = formatDateStr(now);
    // Title prefix reflects what triggered the quick-add. Photos and voice
    // notes get distinct prefixes so the list scans well; the default
    // "Draft" stays for any future quick path that doesn't carry an asset.
    const stamp = formatTimestamp(now);
    const draftTitle = photoUri
      ? `Photo ${stamp}`
      : voiceNote
      ? `Record ${stamp}`
      : `Draft ${stamp}`;
    const result = await db.runAsync(
      'INSERT INTO entries (title, content, date) VALUES (?, ?, ?)',
      [draftTitle, '', dateStr]
    );
    const id = result.lastInsertRowId;
    if (photoUri) {
      await db.runAsync(
        'INSERT INTO entry_photos (entry_id, uri) VALUES (?, ?)',
        [id, photoUri]
      );
    }
    if (voiceNote) {
      await db.runAsync(
        'INSERT INTO entry_voice_notes (entry_id, uri, duration) VALUES (?, ?, ?)',
        [id, voiceNote.uri, voiceNote.duration]
      );
    }
    // N11: quick-add entries land in their date's auto-thread too.
    await syncAutoBeadForEntry({ id, date: dateStr });
    await Promise.all([loadEntries(), loadEntryCounts()]);
  };

  const handleQuickPhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Quick photo needs the camera permission.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) {
      await createQuickEntry({ photoUri: result.assets[0].uri });
    }
  };

  const handleVoiceSave = async ({ uri, duration }) => {
    setVoiceVisible(false);
    await createQuickEntry({ voiceNote: { uri, duration } });
  };

  // Long-press an entry → enter select mode with that entry already
  // checked. Replaces the prior quick-chain shortcut: the user picks the
  // thread target from the standard batch picker (which has search +
  // chain previews), and the picker handles N=1 the same as N>1.
  const handleLongPressEntry = (entry) => {
    enterSelectMode([entry.id]);
  };

  const handleDeleteEntry = async (entry) => {
    const db = getDb();
    if (!db) return;
    // Auto-bead strip + comment cascade + row delete, one transaction.
    await deleteEntries([entry.id]);
    await Promise.all([loadEntries(), loadEntryCounts()]);
  };

  // --- Multi-select mode ---------------------------------------------------

  const enterSelectMode = useCallback(
    (preselectIds = [], context = 'entry') => {
      setSelectMode(true);
      setSelectionContext(context);
      setSelectedIds(new Set(preselectIds.map((n) => Number(n))));
    },
    []
  );

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    // selectionContext is intentionally NOT reset. This keeps the header chrome
    // stable through the closing animation.
  }, []);

  const toggleSelected = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const n = Number(id);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }, []);

  const selectionArray = useMemo(
    () => Array.from(selectedIds).map((n) => Number(n)),
    [selectedIds]
  );

  const handleBatchDelete = () => {
    if (selectionArray.length === 0) return;
    Alert.alert(
      `Delete ${selectionArray.length} entries`,
      'Delete the selected entries permanently?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const db = getDb();
            if (!db) return;
            // One transaction for the whole batch: all-or-nothing.
            await deleteEntries(selectionArray);
            exitSelectMode();
            await Promise.all([loadEntries(), loadEntryCounts()]);
          },
        },
      ]
    );
  };

  // --- Thread-context batch handlers --------------------------------------
  //
  // Symmetric with the entry-context ones above: a long-press on a thread
  // card enters select mode (thread context) with that thread pre-checked.
  // The select-mode header then offers Add-to-collection and Delete; tap
  // additional thread cards to extend the selection. Auto-threads in the
  // selection are silently skipped on delete (they are derived state: the
  // prune-on-empty rule removes them when their last entry goes), but the
  // collection picker is the one metadata edit always allowed on auto kinds.
  const handleLongPressThread = useCallback(
    (thread) => {
      if (!thread) return;
      enterSelectMode([thread.id], 'thread');
    },
    [enterSelectMode]
  );

  const handleBatchDeleteThreads = () => {
    if (selectionArray.length === 0) return;
    Alert.alert(
      `Delete ${selectionArray.length} thread${selectionArray.length === 1 ? '' : 's'}`,
      'Delete the selected user threads permanently? The app does not delete the auto-threads in the selection. An auto-thread comes from its entries.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const db = getDb();
            if (!db) return;
            const placeholders = selectionArray.map(() => '?').join(',');
            const userRows = await db.getAllAsync(
              `SELECT id FROM threads WHERE id IN (${placeholders}) AND kind = 'user'`,
              selectionArray
            );
            // Comments + thread rows in one transaction (FKs cascade the rest).
            await deleteThreads(userRows.map((r) => r.id));
            exitSelectMode();
            bumpThreadsRefresh();
          },
        },
      ]
    );
  };

  const handleBatchAddThreadsToCollection = async (collection) => {
    if (!collection || selectionArray.length === 0) return;
    setBatchCollectionPickerVisible(false);
    // Sequential to keep service-layer invariants (idempotent UPSERT,
    // collection-membership uniqueness) honest under any future change.
    for (const tid of selectionArray) {
      await addThreadToCollection(tid, collection.id);
    }
    exitSelectMode();
    bumpThreadsRefresh();
  };

  const handleBatchPickThread = async (thread) => {
    if (!thread || selectionArray.length === 0) return;
    setBatchThreadPickerVisible(false);
    try {
      await addEntriesToThread(selectionArray, thread.id);
    } catch (e) {
      Alert.alert('Could not thread', e?.message || String(e));
      return;
    }
    exitSelectMode();
    await Promise.all([loadEntries(), loadEntryCounts()]);
  };

  const handleBatchCreateThread = () => {
    if (selectionArray.length === 0) return;
    setBatchThreadPickerVisible(false);
    const ids = [...selectionArray];
    exitSelectMode();
    navigation.navigate('ThreadComposer', {
      threadId: null,
      prefilledEntryIds: ids,
    });
  };

  const handleFused = async (newId) => {
    setFuseSheetVisible(false);
    exitSelectMode();
    await Promise.all([loadEntries(), loadEntryCounts()]);
    if (newId != null) {
      navigation.navigate('EntryEditor', { entryId: newId });
    }
  };

  // --- Quick-capture burst detection --------------------------------------
  //
  // Surface a banner when ≥ 3 quick-capture entries (titles matching
  // `Photo YYYYMMDDHHMMSS` or `Record YYYYMMDDHHMMSS`) have landed in the
  // last 30 minutes. The user can tap to enter select-mode pre-loaded
  // with all of them and the FuseSheet open, or × to dismiss for the
  // session.
  const QUICK_TITLE_RE = /^(Photo|Record) \d{14}$/;
  const burstCluster = useMemo(() => {
    if (selectMode) return null; // banner is a select-mode entry point
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const candidates = entries.filter((e) => {
      if (!QUICK_TITLE_RE.test(e.title || '')) return false;
      const ca = e.created_at;
      if (!ca) return false;
      const iso = ca.includes('T') ? ca : ca.replace(' ', 'T') + 'Z';
      const t = new Date(iso);
      if (isNaN(t.getTime())) return false;
      return t >= cutoff;
    });
    if (candidates.length < 3) return null;
    // Skip if every member is already dismissed; reappears when new
    // captures roll in alongside the dismissed ones.
    const allDismissed = candidates.every((c) => dismissedBurstIds.has(c.id));
    if (allDismissed) return null;
    return candidates;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, dismissedBurstIds, selectMode, tick]);

  const handleBurstTap = () => {
    if (!burstCluster || burstCluster.length === 0) return;
    enterSelectMode(burstCluster.map((c) => c.id));
    setFuseSheetVisible(true);
  };

  const handleBurstDismiss = () => {
    if (!burstCluster) return;
    setDismissedBurstIds((prev) => {
      const next = new Set(prev);
      for (const c of burstCluster) next.add(c.id);
      return next;
    });
  };

  // Backup nudge: refreshed with the other chrome on focus, so making a
  // backup (Settings round-trip) clears the strip immediately on return.
  const loadBackupNudge = useCallback(async () => {
    try {
      const v = await getCurrentVault();
      const nudge = v?.id != null ? await getBackupNudge(v.id) : null;
      setBackupNudge(nudge?.show ? nudge : null);
    } catch {
      setBackupNudge(null);
    }
  }, []);

  const handleBackupNudgeTap = () => {
    navigation.navigate('SettingsBackup');
  };

  const handleBackupNudgeDismiss = async () => {
    setBackupNudge(null);
    try {
      const v = await getCurrentVault();
      if (v?.id != null) await snoozeBackupNudge(v.id);
    } catch (e) {
      warn('Home.backupNudgeDismiss', e);
    }
  };

  const filterActive =
    shapeFilter.length > 0 ||
    moodFilter.length > 0 ||
    patternFilter.length > 0 ||
    glyphFilter.length > 0 ||
    unwoven ||
    mentionsOthers ||
    hasPhoto ||
    hasVoice;
  // Number of facets (not values) with a selection. Drives the small
  // badge on the funnel so the user knows filters are on without an
  // inline summary row. Connection and Capture each count once however
  // many of their lenses are lit, matching the facets-not-values rule.
  const activeFacetCount =
    (shapeFilter.length > 0 ? 1 : 0) +
    (moodFilter.length > 0 ? 1 : 0) +
    (patternFilter.length > 0 ? 1 : 0) +
    (glyphFilter.length > 0 ? 1 : 0) +
    (unwoven || mentionsOthers ? 1 : 0) +
    (hasPhoto || hasVoice ? 1 : 0);
  const toggleShape = (s) =>
    setShapeFilter((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  const toggleMood = (m) =>
    setMoodFilter((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    );
  const togglePattern = (p) =>
    setPatternFilter((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  const toggleGlyph = (g) =>
    setGlyphFilter((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    );
  const clearFilters = () => {
    setShapeFilter([]);
    setMoodFilter([]);
    setPatternFilter([]);
    setGlyphFilter([]);
    setUnwoven(false);
    setMentionsOthers(false);
    setHasPhoto(false);
    setHasVoice(false);
    setHomeAppliedPresetId(null);
    setHomeAnonBead(null);
  };

  // A saved bead is just a {shape,pattern,mood,glyph} tuple, so applying
  // it as a lens = replacing the four facet selections with that bead's
  // attributes. Same pre-fill mechanic as the composer's applyPreset:
  // the sheet stays open so the user can loosen a facet (e.g. drop the
  // pattern for a broader match) before tapping Done. Glyph is only
  // constrained if the preset actually carries one: an empty glyph
  // would otherwise mean "entries with no glyph", not "any glyph".
  const applyPresetFilter = (p) => {
    setShapeFilter(p.shape ? [p.shape] : []);
    setMoodFilter(p.mood ? [p.mood] : []);
    setPatternFilter(p.pattern ? [p.pattern] : []);
    setGlyphFilter(p.glyph ? [p.glyph] : []);
  };

  // Promote the current filtered result into the existing multi-select →
  // batch-thread-picker flow: a query becomes a curated chain. Reuses the
  // shipped select-mode machinery; no new batch code.
  const selectAllFiltered = useCallback(() => {
    const ids = entries.map((e) => e.id);
    if (ids.length === 0) return;
    enterSelectMode(ids);
  }, [entries, enterSelectMode]);

  // Glyph sheet list, filtered by the in-sheet search box. Substring match
  // on the glyph itself (glyphs can be multi-char emoji / short marks).
  const visibleGlyphs = useMemo(() => {
    const q = glyphSearch.trim().toLowerCase();
    if (!q) return glyphsInUse;
    return glyphsInUse.filter((row) =>
      String(row.glyph).toLowerCase().includes(q)
    );
  }, [glyphsInUse, glyphSearch]);

  // The preset captured as a pill above the search bar (null when
  // nothing is pinned). The pill is the canonical applied-filter
  // surface: manual facet edits in the Filters sheet don't claim a
  // name (no pill renders), and any divergence from the preset's
  // exact 4 facets detaches the pill silently (see the useEffect
  // below).
  const [homeAppliedPresetId, setHomeAppliedPresetId] = useState(null);

  // Anonymous-bead scope: the third sibling of `homeAppliedPresetId` /
  // `homePinnedThreadId`. Set when a bead long-press matches NO saved
  // preset (so there's no name to claim): we still capture the bead so a
  // removable "Bead · N" pill renders above the search row. Without it the
  // filter would apply with no inline × and the only escape would be the
  // funnel sheet's "Clear all", the exact gap behind "I can't remove the
  // filter". Holds the normalised {shape,pattern,mood,glyph} tuple from
  // `readBead`. Mutex with the other two pills: every site that pins a
  // preset or a thread clears it; the divergence effect (below) detaches
  // it when the facets are edited away from the bead in the Filters sheet.
  const [homeAnonBead, setHomeAnonBead] = useState(null);

  // Thread-pinned scope: the sibling of `homeAppliedPresetId` for the
  // *other* kind of pill (a thread, not a bead-preset). Triggered by
  // ThreadDetailScreen's "As list" button which navigates here with
  // `route.params.pinThreadId`. Mutex with the bead-pill: pinning one
  // clears the other. The thread row is loaded into `homePinnedThread`
  // so the pill can render its name + the auto-detach effect can drop
  // the pin if the thread was deleted out from under us.
  const [homePinnedThreadId, setHomePinnedThreadId] = useState(null);
  const [homePinnedThread, setHomePinnedThread] = useState(null);

  // The preset object for the captured pill, derived. Drives the
  // pill render block above the search row.
  const pinnedPreset = useMemo(() => {
    if (homeAppliedPresetId == null) return null;
    return beadPresets.find((p) => p.id === homeAppliedPresetId) || null;
  }, [beadPresets, homeAppliedPresetId]);

  // Hydrate the pinned-thread row. Runs on id change and from the
  // focus listener so a rename in ThreadDetail propagates back here.
  // If the row is missing (deleted), drop the pin, the same shape as the
  // preset-deletion detach in the effect below.
  //
  // Stale-async guard via `pinnedThreadLoadGenRef`: the X-on-pill handler
  // (line ~2068) clears `homePinnedThreadId` synchronously and the pill
  // renders off `homePinnedThread`, not the id. Without this guard, a
  // V_old invocation in flight (e.g. fired by the focus listener after a
  // Settings round-trip) would complete its `await` *after* the X-driven
  // V_new has written `null` and overwrite the row back into place. The
  // pill would re-render but `homePinnedThreadId` is null, so another X
  // tap is a no-op (useCallback identity doesn't change) and the pill is
  // permanently stuck until the user pins a *different* thread (which
  // does change the id, breaking the deadlock). Bumping a generation
  // counter and gating the late write fixes it without changing the
  // public shape.
  // `loadPinnedThread` reads `homePinnedThreadId` via a ref, not closure
  // capture, so its useCallback has stable identity for the entire
  // component lifetime. Why this matters:
  //
  // The focus listener useEffect (line ~830) lists `loadPinnedThread` in
  // its deps and is declared *before* this useCallback, so at registration
  // time `loadPinnedThread` is in the temporal dead zone. Combined with
  // however React 19/Hermes handles that, the focus listener never re-
  // registered when `loadPinnedThread`'s identity changed on state updates,
  // so it kept a stale closure: after X-on-pill cleared the id, the listener
  // still held the V_T1 loadPinnedThread (closure over the old id) and on
  // every subsequent focus event re-loaded the dismissed thread back into
  // `homePinnedThread`, resurrecting the pill (proven via PIN-DEBUG logs
  // showing focus event firing with stale `homePinnedThreadId=2` after X).
  //
  // The ref pattern sidesteps the dep-change machinery: loadPinnedThread
  // is one stable function for the whole component lifetime, the listener's
  // closure capture of it is fine, and the function always reads the latest
  // id from `homePinnedThreadIdRef`. State→ref sync happens synchronously
  // during render (refs don't trigger re-renders, so this is allowed and
  // idiomatic, see Dan Abramov's "Making setInterval Declarative" post).
  // A separate effect fires `loadPinnedThread()` when the id changes, so
  // the normal "id changed → re-hydrate row" flow still works.
  const homePinnedThreadIdRef = useRef(null);
  homePinnedThreadIdRef.current = homePinnedThreadId;
  const pinnedThreadLoadGenRef = useRef(0);
  const loadPinnedThread = useCallback(async () => {
    const gen = ++pinnedThreadLoadGenRef.current;
    const currentId = homePinnedThreadIdRef.current;
    if (currentId == null) {
      setHomePinnedThread(null);
      return;
    }
    const db = getDb();
    if (!db) return;
    const row = await db.getFirstAsync(
      'SELECT id, name, kind FROM threads WHERE id = ?',
      [currentId]
    );
    if (gen !== pinnedThreadLoadGenRef.current) return;
    // Drop the late row if the user dismissed the pin (or pinned a
    // different thread) while we were awaiting. Otherwise the stale
    // row would resurrect the cleared pill.
    if (homePinnedThreadIdRef.current !== currentId) return;
    if (!row) {
      setHomePinnedThreadId(null);
      setHomePinnedThread(null);
      return;
    }
    setHomePinnedThread(row);
  }, []);

  // Re-hydrate the pinned thread row whenever the id changes. The effect
  // depends on `homePinnedThreadId` (the state) not `loadPinnedThread`
  // (now stable), so it fires reliably on every state transition,
  // including the X-on-pill T1→null transition where the dep-chain via
  // loadPinnedThread was failing.
  useEffect(() => {
    loadPinnedThread();
  }, [homePinnedThreadId, loadPinnedThread]);

  // Populate the focus-listener handler ref *after* all the loader
  // useCallbacks above have been declared. The assignment runs during
  // render on every render (refs don't trigger re-renders), so by the
  // time any focus event fires (always post-commit), the ref holds the
  // latest function references, eliminating the stale-closure bug
  // that resurrected dismissed pins/filters across Settings round-trips.
  // See the ref declaration and useEffect that consumes it earlier in
  // the component body for the full rationale.
  focusHandlersRef.current = {
    loadEntries,
    loadEntryCounts,
    loadAnchoredThreads,
    loadReminders,
    refreshFiredCommentReminders,
    loadGlyphsInUse,
    loadPresets,
    loadPinnedThread,
    loadBackupNudge,
    runFolderScanOnFocus,
    loadWanderPrefs,
  };

  // Mutex helper. Either pin clears the other side (and the four facet
  // arrays the bead-pin claims) so the user is always in exactly one
  // captured scope, never two stacked. Multi-pill stacking is the named
  // v1 non-goal in `beads-and-threads.md §Entry-list filter chrome`.
  // Also forces `view='list'`: the pinned-thread pill is gated to list
  // view (the captured scope is meaningless on the threads/calendar tabs,
  // and the pill is the only X-affordance for the pin), so a user whose
  // default view is `threads` would otherwise silently pin without ever
  // seeing the pill or the filtered entries. The "Read as list" gesture
  // is literally named *list*, so honor that regardless of preference.
  const pinThreadScope = useCallback((threadId) => {
    setHomeAppliedPresetId(null);
    setHomeAnonBead(null);
    setShapeFilter([]);
    setMoodFilter([]);
    setPatternFilter([]);
    setGlyphFilter([]);
    setSearchQuery('');
    setHomePinnedThreadId(threadId);
    setView('list');
  }, []);

  // A2: Long-press the bead aperture on an EntryCard → set as filter.
  // Same effect as picking the bead through the Filters sheet or (when
  // the bead matches a saved preset) through the preset strip. The inner
  // bead Pressable wins the RN gesture arena over the card-level long-
  // press, so multi-select still works when the user long-presses
  // anywhere else on the card. Facet normalisation mirrors
  // beadPresets.normTuple (pattern→solid, mood→slate, glyph→''); the
  // `readBead()` from the row already applies these defaults, and
  // presets are stored normalised at create-time, so a direct tuple
  // equality is normTuple-equivalent. The thread-pin is mutex with the
  // bead-pin, so we clear it (mirrors the preset-strip onPress at the
  // search-row typeahead).
  const handleBeadLongPress = useCallback(
    (entry) => {
      const bead = readBead(entry);
      if (!bead) return;
      hapticTap(); // the filter engaging
      // Glyph compared via the shared normGlyph (variation-selector tolerant).
      const match = beadPresetsRef.current.find(
        (p) =>
          p.shape === bead.shape &&
          (p.pattern || 'solid') === bead.pattern &&
          (p.mood || 'slate') === bead.mood &&
          normGlyph(p.glyph) === normGlyph(bead.glyph)
      );
      setHomePinnedThreadId(null);
      if (match) {
        // Pinning a preset reproduces the preset-strip path exactly:
        // four facets, then claim the name. The pill renders above the
        // search row from `homeAppliedPresetId` → `pinnedPreset`. Clear any
        // anonymous-bead pin (mutex: the name claim supersedes it).
        setShapeFilter([match.shape]);
        setMoodFilter([match.mood || 'slate']);
        setPatternFilter([match.pattern || 'solid']);
        // Filter by the *bead's* glyph, not the preset's: they normalise-equal
        // but can differ in raw encoding (variation selector), and the entries
        // carry the bead's encoding. Chip still claims the preset name/id.
        setGlyphFilter(bead.glyph ? [bead.glyph] : []);
        setHomeAppliedPresetId(match.id);
        setHomeAnonBead(null);
      } else {
        // Anonymous bead: no saved preset matches, so there's no name to
        // claim. Set the four facets directly AND capture the bead in
        // `homeAnonBead` so a removable "Bead · N" pill renders above the
        // search row (mirrors the named pill; the × is the inline escape).
        // Empty glyph = "any glyph" (an empty filter array), matching the
        // applyPresetFilter convention above.
        setHomeAppliedPresetId(null);
        setShapeFilter([bead.shape]);
        setPatternFilter([bead.pattern || 'solid']);
        setMoodFilter([bead.mood || 'slate']);
        if (bead.glyph) {
          setGlyphFilter([bead.glyph]);
        } else {
          setGlyphFilter([]);
        }
        setHomeAnonBead(bead);
      }
      // Clear text search so the new scope reads cleanly; mirrors the
      // preset-strip behaviour.
      setSearchQuery('');
    },
    // Stable identity (reads presets via beadPresetsRef) so the memoised row's
    // frozen onBeadLongPress closure always resolves the current presets.
    []
  );

  // Consume `route.params.pinThreadId` exactly once per (pinNonce). The
  // nonce is a per-tap token set by the caller (ThreadDetailScreen's
  // beads-chip tap, line ~834). Why a nonce instead of clearing via
  // `setParams({pinThreadId: undefined})`: under React Navigation v7,
  // route.params can re-present on focus return (e.g., after a Settings
  // round-trip) in ways that make a value-only guard unreliable: the
  // user would dismiss the pill with × and find it resurrected on the
  // next focus event. A nonce makes the consume idempotent regardless
  // of how RN's state restoration treats params: a fresh tap mints a
  // fresh nonce, a stale revival carries the already-consumed one.
  const lastConsumedPinNonceRef = useRef(null);
  useEffect(() => {
    const incoming = route?.params?.pinThreadId;
    const nonce = route?.params?.pinNonce;
    if (incoming == null || nonce == null) return;
    if (lastConsumedPinNonceRef.current === nonce) return;
    lastConsumedPinNonceRef.current = nonce;
    pinThreadScope(incoming);
  }, [route?.params?.pinThreadId, route?.params?.pinNonce, pinThreadScope]);

  // Home-search preset typeahead: the suggestion-strip half of the
  // three-position search-row contract: scope-pill ABOVE the input
  // (captured filter state, see `pinnedPreset` and the pill render
  // block below), text input in the MIDDLE (substantive content
  // search; runs within the pinned scope when a pill is pinned),
  // suggestion strip BELOW (this: transient, prefix-driven). The
  // strip surfaces presets whose name prefix-matches the typed search;
  // tapping one pins the preset as a pill above the search bar and
  // clears the text. The strip is hidden while a pill is pinned: the
  // pill is the canonical applied-filter surface, the strip is purely
  // a summoner; they never coexist. This is the encode⇄retrieve
  // symmetry the constitution names: the same named bead that stamps
  // an entry now also holds the list of every entry with that bead.
  const visibleHomePresets = useMemo(() => {
    // Hidden while EITHER bead pill is pinned (named or anonymous): the
    // pill is the canonical applied-filter surface and the text input is
    // content-search-within-scope, so the summoner strip would be noise.
    if (homeAppliedPresetId != null || homeAnonBead != null) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return beadPresets.filter((p) =>
      (p.name || '').toLowerCase().startsWith(q)
    );
  }, [beadPresets, searchQuery, homeAppliedPresetId, homeAnonBead]);

  // Pill lifecycle: the pinned pill detaches when (a) the user taps ×
  // on the pill (handled inline in the pill render block), (b) the
  // four facet arrays diverge from the preset's exact 4 facets (this
  // effect, typically a Filters-sheet edit), or (c) the preset is
  // deleted out from under us. Search-text changes do NOT touch the
  // pill: the pill is the canonical applied-filter surface, the text
  // input is content search within the pinned scope (if any).
  // Divergence drops only the name-claim; the facets themselves stay
  // applied (the user did just edit them).
  useEffect(() => {
    if (homeAppliedPresetId == null) return;
    const preset = beadPresets.find((p) => p.id === homeAppliedPresetId);
    if (!preset) {
      setHomeAppliedPresetId(null);
      return;
    }
    const exactly = (arr, val) =>
      val ? arr.length === 1 && arr[0] === val : arr.length === 0;
    // Glyph compared via normGlyph (variation-selector tolerant). It must match
    // how handleBeadLongPress matched the preset, or the pill we just set would
    // be seen as "diverged" and cleared the instant it appears.
    const glyphMatches = preset.glyph
      ? glyphFilter.length === 1 &&
        normGlyph(glyphFilter[0]) === normGlyph(preset.glyph)
      : glyphFilter.length === 0;
    const matches =
      exactly(shapeFilter, preset.shape) &&
      exactly(moodFilter, preset.mood) &&
      exactly(patternFilter, preset.pattern) &&
      glyphMatches;
    if (!matches) {
      setHomeAppliedPresetId(null);
    }
  }, [
    homeAppliedPresetId,
    beadPresets,
    shapeFilter,
    moodFilter,
    patternFilter,
    glyphFilter,
  ]);

  // Anonymous-bead pill lifecycle: the parallel of the preset divergence
  // effect above, for the unnamed pill. Detaches `homeAnonBead` when the
  // facet arrays no longer describe exactly that one bead (the user
  // loosened a facet in the Filters sheet, or the × cleared them). The
  // facets that remain stay applied; only the pill claim drops. Glyph is
  // compared via normGlyph so the pill we just set (which filters by the
  // bead's raw glyph encoding) isn't read as "diverged" from its own
  // normalised tuple the instant it appears. Mood/pattern are always
  // present on a `readBead` tuple, so a plain length===1 + equality holds.
  useEffect(() => {
    if (homeAnonBead == null) return;
    const glyphMatches = homeAnonBead.glyph
      ? glyphFilter.length === 1 &&
        normGlyph(glyphFilter[0]) === normGlyph(homeAnonBead.glyph)
      : glyphFilter.length === 0;
    const matches =
      shapeFilter.length === 1 &&
      shapeFilter[0] === homeAnonBead.shape &&
      moodFilter.length === 1 &&
      moodFilter[0] === homeAnonBead.mood &&
      patternFilter.length === 1 &&
      patternFilter[0] === homeAnonBead.pattern &&
      glyphMatches;
    if (!matches) {
      setHomeAnonBead(null);
    }
  }, [homeAnonBead, shapeFilter, moodFilter, patternFilter, glyphFilter]);

  // A1: Same-date prior-years band. Surfaces entries from prior years
  // sharing today's MM-DD as a SectionList section above TODAY. Renders
  // only when the list is unscoped: any active search, filter, pinned
  // bead, or pinned thread suppresses it because a "same-date" surface
  // over a filtered view would be incoherent. Computed at render from
  // the already-loaded `entries`; no extra query.
  //
  // Feb 29 falls out naturally: on a non-leap year today's MM-DD is
  // 02-28 / 03-01 and any 02-29 entry simply does not match: no band.
  // De-dup: any entry pulled into the prior-years band is filtered out
  // of the regular bands below so an entry never appears twice (e.g., a
  // Jan-2-of-last-year entry that would otherwise also bucket into the
  // "January <last-year>" band).
  const priorYearsScopeOk =
    !filterActive &&
    !debouncedQuery &&
    homePinnedThreadId == null &&
    homeAppliedPresetId == null;

  const priorYearsEntries = useMemo(() => {
    if (!priorYearsScopeOk) return [];
    const today = new Date();
    const todayY = today.getFullYear();
    const todayMmDd = `${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const matches = entries.filter((e) => {
      if (!e.date || typeof e.date !== 'string') return false;
      const [y, m, d] = e.date.split('-');
      if (!y || !m || !d) return false;
      if (Number(y) >= todayY) return false; // strictly prior years
      return `${m}-${d}` === todayMmDd;
    });
    // Year-descending: most recent prior year first. `entries` already
    // arrives newest-first, so this is normally a no-op; sort anyway so
    // the section's contract is local and not load-bearing on caller
    // order.
    matches.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return matches;
  }, [entries, priorYearsScopeOk]);

  const sections = useMemo(() => {
    if (priorYearsEntries.length === 0) {
      return groupIntoBands(entries);
    }
    const priorIds = new Set(priorYearsEntries.map((e) => e.id));
    const rest = entries.filter((e) => !priorIds.has(e.id));
    const bands = groupIntoBands(rest);
    return [
      {
        title: 'On this day · prior years',
        data: priorYearsEntries,
      },
      ...bands,
    ];
  }, [entries, priorYearsEntries]);

  const renderEmpty = () => {
    // Never claim emptiness before the first load has answered. This is
    // also the fix for a lingering-overlap artifact: on a notification
    // cold start the route consumer pushes EntryEditor almost immediately,
    // and if the empty guide mounted in the pre-load instant, the
    // SectionList could keep it rendered OVER the rows that arrived while
    // the screen was covered (it only reconciled away on a view-switch
    // remount). Rendering null until `entriesLoaded` means the guide
    // never mounts during that window at all.
    if (!entriesLoaded) return null;
    // Scope-aware empty state. When a pill is pinned the user has a
    // visible × control on the pill itself, so name it as the relax
    // path. (Without this branch the pinned case would fall into the
    // generic filterActive copy below, which tells the user to "open
    // the funnel" even though the pill above carries the relax
    // affordance.) Branches: thread-pin → bead-pin → filter-only →
    // search → nothing-yet. Thread first because it's the broader
    // scope when both could match (mutex makes "both" impossible, but
    // the order encodes precedence anyway).
    if (homePinnedThread) {
      if (searchQuery) {
        return (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              No entries in{' '}
              <Text style={styles.emptyTextEmphasis}>
                {homePinnedThread.name || 'this thread'}
              </Text>
              {' '}match "{searchQuery}"
            </Text>
            <Text style={styles.emptySubtext}>
              To see more entries, tap × on the thread or clear the search.
            </Text>
          </View>
        );
      }
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            No entries in{' '}
            <Text style={styles.emptyTextEmphasis}>
              {homePinnedThread.name || 'this thread'}
            </Text>
            {' '}yet
          </Text>
          <Text style={styles.emptySubtext}>
            Tap × on the thread to remove the filter, or add a new entry to this thread.
          </Text>
        </View>
      );
    }
    if (pinnedPreset) {
      if (searchQuery) {
        return (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              No entries in{' '}
              <Text style={styles.emptyTextEmphasis}>{pinnedPreset.name}</Text>
              {' '}match "{searchQuery}"
            </Text>
            <Text style={styles.emptySubtext}>
              To see more entries, tap × on the bead or clear the search.
            </Text>
          </View>
        );
      }
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            No entries with{' '}
            <Text style={styles.emptyTextEmphasis}>{pinnedPreset.name}</Text>
            {' '}yet
          </Text>
          <Text style={styles.emptySubtext}>
            Tap × on the bead to remove the filter, or make a new entry with this bead.
          </Text>
        </View>
      );
    }
    if (homeAnonBead) {
      // Same shape as the pinnedPreset branch, but the bead has no name.
      // Point at the pill's × (the inline relax path) rather than the
      // funnel's "Clear all" the generic filterActive branch would offer.
      if (searchQuery) {
        return (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              No entries with this bead match "{searchQuery}"
            </Text>
            <Text style={styles.emptySubtext}>
              To see more entries, tap × on the bead or clear the search.
            </Text>
          </View>
        );
      }
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No entries with this bead yet</Text>
          <Text style={styles.emptySubtext}>
            Tap × on the bead to remove the filter, or make a new entry with this bead.
          </Text>
        </View>
      );
    }
    if (filterActive) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No entries match</Text>
          <Text style={styles.emptySubtext}>
            To see all your entries again, open the Filters sheet and tap "Clear all".
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {searchQuery ? 'No entries found' : 'No journal entries yet'}
        </Text>
        <Text style={styles.emptySubtext}>
          {searchQuery
            ? 'Try a different search term'
            : 'Tap the + button to create your first entry'}
        </Text>
        {/* The cold-start door, and the replacement for the tutorial that
            used to plant itself here (v0.77.0, see
            docs/architecture/interactive-tutorial.md § Revision). Shown
            ONLY on a genuinely empty journal, never over a search or
            filter miss, and gone for good once the first entry exists,
            so it is an empty state doing its job, not new chrome. */}
        {!searchQuery ? (
          <>
            <Text style={styles.emptyGuidePrompt}>New here?</Text>
            <View style={styles.emptyGuideRow}>
              {/* Icons and labels deliberately mirror Settings → Pro Tips →
                  Guides, so whichever surface you meet first teaches the
                  other. Guide first (how it works), Possibilities second
                  (what it's for), though on an empty journal the second
                  is arguably the livelier question. */}
              <TouchableOpacity
                style={styles.emptyGuideLink}
                onPress={() =>
                  navigation.navigate('SettingsGuideViewer', {
                    guide: 'user-guide',
                    title: 'User guide',
                  })
                }
                accessibilityLabel="Read the user guide"
              >
                <Ionicons
                  name="compass-outline"
                  size={15}
                  color={colors.primary}
                />
                <Text style={styles.emptyGuideLinkText}>User guide</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.emptyGuideLink}
                onPress={() =>
                  navigation.navigate('SettingsGuideViewer', {
                    guide: 'possibilities',
                    title: 'Possibilities',
                  })
                }
                accessibilityLabel="Read Possibilities: ways to use the app"
              >
                <Ionicons
                  name="bulb-outline"
                  size={15}
                  color={colors.primary}
                />
                <Text style={styles.emptyGuideLinkText}>Possibilities</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {selectMode ? (
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={exitSelectMode}
            accessibilityLabel="Cancel selection"
          >
            <Ionicons name="close" size={22} color={colors.primary} />
          </TouchableOpacity>
          <Text style={styles.selectCountText}>
            {selectionArray.length} selected
          </Text>
          <View style={styles.headerActions}>
            {selectionContext === 'entry' ? (
              <>
                <TouchableOpacity
                  style={[
                    styles.iconButton,
                    selectionArray.length < 2 && styles.iconButtonDisabled,
                  ]}
                  onPress={() => selectionArray.length >= 2 && setFuseSheetVisible(true)}
                  accessibilityLabel="Fuse selected entries"
                  disabled={selectionArray.length < 2}
                >
                  <Ionicons
                    name="flask-outline"
                    size={20}
                    color={
                      selectionArray.length >= 2 ? colors.primary : colors.textFaint
                    }
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.iconButton,
                    selectionArray.length === 0 && styles.iconButtonDisabled,
                  ]}
                  onPress={() =>
                    selectionArray.length > 0 && setBatchThreadPickerVisible(true)
                  }
                  accessibilityLabel="Thread selected entries"
                  disabled={selectionArray.length === 0}
                >
                  <Ionicons
                    name="git-branch-outline"
                    size={20}
                    color={
                      selectionArray.length > 0 ? colors.primary : colors.textFaint
                    }
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.iconButton,
                    selectionArray.length === 0 && styles.iconButtonDisabled,
                  ]}
                  onPress={() =>
                    selectionArray.length > 0 && handleBatchDelete()
                  }
                  accessibilityLabel="Delete selected entries"
                  disabled={selectionArray.length === 0}
                >
                  <Ionicons
                    name="trash-outline"
                    size={20}
                    color={
                      selectionArray.length > 0 ? colors.danger : colors.textFaint
                    }
                  />
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Thread-context batch chrome: Add-to-collection + Delete.
                    No Fuse (notes-specific). The folder icon mirrors the
                    metadata-line icon on ThreadDetail and the per-thread
                    collection picker; Delete shares its destructive
                    iconography with the entry case. */}
                <TouchableOpacity
                  style={[
                    styles.iconButton,
                    selectionArray.length === 0 && styles.iconButtonDisabled,
                  ]}
                  onPress={() =>
                    selectionArray.length > 0 &&
                    setBatchCollectionPickerVisible(true)
                  }
                  accessibilityLabel="Add selected threads to a collection"
                  disabled={selectionArray.length === 0}
                >
                  <Ionicons
                    name="folder-outline"
                    size={20}
                    color={
                      selectionArray.length > 0 ? colors.primary : colors.textFaint
                    }
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.iconButton,
                    selectionArray.length === 0 && styles.iconButtonDisabled,
                  ]}
                  onPress={() =>
                    selectionArray.length > 0 && handleBatchDeleteThreads()
                  }
                  accessibilityLabel="Delete selected threads"
                  disabled={selectionArray.length === 0}
                >
                  <Ionicons
                    name="trash-outline"
                    size={20}
                    color={
                      selectionArray.length > 0 ? colors.danger : colors.textFaint
                    }
                  />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.headerCol}>
          <View style={styles.headerTopRow}>
            <View style={styles.headerLeftGroup}>
              {/* Decorative view-sigil: the current view's icon in a round
                  chip beside the title. Not a button; switching is the bottom
                  nav. Mirrors the view shown in the title. */}
              <View style={styles.viewSigil}>
                <ViewIcon view={view} size={20} color={colors.primary} />
              </View>
              <View style={styles.headerTitleBlock}>
                <Text style={styles.headerTitle}>
                  {(VIEW_TITLE[view] || VIEW_TITLE.list).title}
                </Text>
                <Text style={styles.headerSubtitle}>
                  {subtitleFor(view, entries.length, threadsCount)}
                </Text>
              </View>
            </View>
          <View style={styles.headerActions}>
            {/* Wander: chance-return primitive, peer to the Bell. Sits
                immediately left of the bell. Only renders when the user
                opted in (`wanderEnabled`), settings finished loading
                (`wanderReady`), AND a non-empty eligible pool exists.
                See docs/architecture/navigation-and-shell.md. */}
            {wanderReady && wanderEnabled && wanderPoolNonEmpty && view === 'list' ? (
              <TouchableOpacity
                style={styles.iconButton}
                onPress={handleWanderTap}
                accessibilityLabel="Wander: open a random older entry"
              >
                <Ionicons
                  name="dice-outline"
                  size={20}
                  color={colors.textFaint}
                />
              </TouchableOpacity>
            ) : null}
            <View ref={bellAnchorRef} collapsable={false}>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => {
                  // Toggle closed if already open; otherwise measure the bell
                  // ⋮-style and open the popover anchored under it. The bell
                  // always opens. With nothing fired the popover carries an
                  // empty state, because a tap that does nothing at all reads
                  // as a broken button. The collapsable={false} wrapper is
                  // load-bearing for the same Android view-flatten reason the
                  // ⋮ anchor documents.
                  if (bannersOpen) {
                    setBannersOpen(false);
                    return;
                  }
                  bellAnchorRef.current?.measureInWindow?.((x, y, w, h) => {
                    const sbAdjust =
                      Platform.OS === 'android'
                        ? StatusBar.currentHeight || 0
                        : 0;
                    setBellAnchor({
                      top: y + h + 4 + sbAdjust,
                      iconCenterX: x + w / 2,
                    });
                    setBannersOpen(true);
                  });
                }}
                accessibilityLabel={
                  pendingBannerCount > 0
                    ? `Reminders, ${pendingBannerCount} fired. Tap to ${
                        bannersOpen ? 'hide' : 'show'
                      }.`
                    : `Reminders. Tap to ${bannersOpen ? 'hide' : 'show'}.`
                }
              >
                <Ionicons
                  name={
                    pendingBannerCount > 0 || bannersOpen
                      ? 'notifications'
                      : 'notifications-outline'
                  }
                  size={20}
                  color={
                    pendingBannerCount > 0 ? colors.primary : colors.textFaint
                  }
                />
                {pendingBannerCount > 0 ? (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>
                      {pendingBannerCount > 9 ? '9+' : pendingBannerCount}
                    </Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            </View>
            <View ref={overflowAnchorRef} collapsable={false}>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => {
                  // Measure the ⋮ icon's screen-space rect so the popover
                  // anchors right below it. The ref is on a
                  // collapsable={false} wrapper on purpose: Android
                  // view-flattening (more aggressive in a release/Fabric
                  // build than in Expo Go) was collapsing the touchable,
                  // so measureInWindow returned ~0 and the popover jumped
                  // to the top of the screen over the button. A real
                  // backing view returns true edge-to-edge window coords,
                  // which line up with the statusBarTranslucent Modal.
                  overflowAnchorRef.current?.measureInWindow?.(
                    (x, y, w, h) => {
                      const screenW = Dimensions.get('window').width;
                      // measureInWindow reports Y in *content* space
                      // (origin below the status bar), but the overflow
                      // Modal renders edge-to-edge from the physical top
                      // (react-native-edge-to-edge forces this, which is why
                      // statusBarTranslucent is a no-op here). Verified on
                      // device: y=13.23 + StatusBar=46.77 = the header's
                      // 60 paddingTop. Add the status-bar height back on
                      // Android so the popover lands below the ⋮, not
                      // over it. iOS measureInWindow is already physical.
                      const sbAdjust =
                        Platform.OS === 'android'
                          ? StatusBar.currentHeight || 0
                          : 0;
                      setOverflowAnchor({
                        top: y + h + 4 + sbAdjust,
                        right: screenW - (x + w),
                        iconCenterX: x + w / 2,
                      });
                      setOverflowMenuVisible(true);
                    }
                  );
                }}
                accessibilityLabel="More actions"
              >
                <Ionicons
                  name="ellipsis-vertical"
                  size={20}
                  color={colors.primary}
                />
              </TouchableOpacity>
            </View>
          </View>
          </View>
        </View>
      )}

      {/* Fired-reminder banners no longer render inline here. They're a
          bell-anchored popover overlay (the notifications Modal near the
          bottom of this component) so opening them doesn't reflow the search
          row + list. */}

      {/* Body wrapper. View switching is a show/hide via the bottom nav
          (no body-swipe gesture). jumpToView runs a directional two-phase
          slide over this wrapper on tab change, echoing the stack's
          horizontal push/pop. Row Swipeables and the calendar's own
          month-swipe are unaffected. */}
          <Animated.View
            style={[styles.bodyWrap, { transform: [{ translateX: bodySlide }] }]}
          >
      {/* Scope-pill row: top of the three-position search-row
          contract (pill above / input in / suggestion strip below).
          Either a thread-pin or a bead-preset-pin renders here, never
          both (mutex enforced in the pin setters). The pill's × is its
          own lifecycle control: search-text changes don't touch the
          pill. The pill chrome reuses the existing `presetChip` +
          `presetChipSelected` geometry; `pinnedPill` just nudges the
          right padding so the × has room. */}
      {view === 'list' && homePinnedThread ? (
        <View style={styles.pinnedPillWrap}>
          <View
            style={[
              styles.presetChip,
              styles.presetChipSelected,
              styles.pinnedPill,
            ]}
          >
            {/* Thread avatar: a chain glyph, not a `BeadView`. A thread
                isn't a bead: rendering its first bead would conflate
                locus (where) with content (what). */}
            <Ionicons
              name="git-network-outline"
              size={16}
              color={colors.primaryOnPrimary}
            />
            <Text
              style={[styles.presetChipText, styles.presetChipTextSelected]}
              numberOfLines={1}
            >
              {homePinnedThread.name || 'Untitled thread'}
              <Text style={styles.pinnedPillCount}>
                {' · '}{entries.length}
              </Text>
            </Text>
            <TouchableOpacity
              onPress={() => {
                setHomePinnedThreadId(null);
                // Sync the ref *immediately*, before React commits the
                // setHomePinnedThreadId update. `loadEntries` reads the
                // pin through `homePinnedThreadIdRef.current` (see the
                // matching read inside `loadEntries`), so the direct
                // call below queries without the thread clause and
                // setEntries lands the unfiltered set in the same gesture.
                // setTimeout-on-next-tick is unreliable here because
                // React's render commit can race the macrotask; reading
                // through a ref takes the timing question off the table.
                // The dep-driven effect at ~881 stays as a belt for other
                // entry-points that flip the pin (mutex setters,
                // pinThreadScope on Read-as-list), but the X handler's
                // direct call is what makes the dismissal feel atomic.
                homePinnedThreadIdRef.current = null;
                loadEntries();
              }}
              hitSlop={8}
              style={styles.pinnedPillRemove}
              accessibilityLabel={`Remove ${
                homePinnedThread.name || 'thread'
              } filter`}
            >
              <Ionicons
                name="close"
                size={14}
                color={colors.primaryOnPrimary}
              />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {view === 'list' && pinnedPreset ? (
        <View style={styles.pinnedPillWrap}>
          <View
            style={[
              styles.presetChip,
              styles.presetChipSelected,
              styles.pinnedPill,
            ]}
          >
            <BeadView
              bead={{
                shape: pinnedPreset.shape,
                pattern: pinnedPreset.pattern,
                mood: pinnedPreset.mood,
                glyph: pinnedPreset.glyph,
              }}
              size={20}
            />
            {/* The pill name carries a live density readout as a
                lighter-weight inline span: "morning ritual · 47".
                The count is `entries.length`, the actual current
                view, so it shrinks live as the user refines with the
                text input and returns to the bead's total when the
                input is cleared. Inline so numberOfLines={1} handles
                the long-name+long-count overflow case naturally. */}
            <Text
              style={[styles.presetChipText, styles.presetChipTextSelected]}
              numberOfLines={1}
            >
              {pinnedPreset.name}
              <Text style={styles.pinnedPillCount}>
                {' · '}{entries.length}
              </Text>
            </Text>
            <TouchableOpacity
              onPress={() => {
                setShapeFilter([]);
                setMoodFilter([]);
                setPatternFilter([]);
                setGlyphFilter([]);
                setHomeAppliedPresetId(null);
              }}
              hitSlop={8}
              style={styles.pinnedPillRemove}
              accessibilityLabel={`Remove ${pinnedPreset.name} filter`}
            >
              <Ionicons
                name="close"
                size={14}
                color={colors.primaryOnPrimary}
              />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {view === 'list' && homeAnonBead ? (
        <View style={styles.pinnedPillWrap}>
          <View
            style={[
              styles.presetChip,
              styles.presetChipSelected,
              styles.pinnedPill,
            ]}
          >
            <BeadView
              bead={{
                shape: homeAnonBead.shape,
                pattern: homeAnonBead.pattern,
                mood: homeAnonBead.mood,
                glyph: homeAnonBead.glyph,
              }}
              size={20}
            />
            {/* No preset name to claim, so the pill reads a neutral "Bead"
                with the same live density readout as the named pill
                ("Bead · 47"). The count is `entries.length` (the current
                view), so it shrinks live as the text input refines and
                returns to the bead's total when the input is cleared. */}
            <Text
              style={[styles.presetChipText, styles.presetChipTextSelected]}
              numberOfLines={1}
            >
              Bead
              <Text style={styles.pinnedPillCount}>
                {' · '}{entries.length}
              </Text>
            </Text>
            <TouchableOpacity
              onPress={() => {
                setShapeFilter([]);
                setMoodFilter([]);
                setPatternFilter([]);
                setGlyphFilter([]);
                setHomeAnonBead(null);
              }}
              hitSlop={8}
              style={styles.pinnedPillRemove}
              accessibilityLabel="Remove bead filter"
            >
              <Ionicons
                name="close"
                size={14}
                color={colors.primaryOnPrimary}
              />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {view === 'list' && (
        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={16}
            color={colors.textFaint}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder={
              homePinnedThread
                ? 'Search within this thread…'
                : pinnedPreset || homeAnonBead
                  ? 'Search within this bead…'
                  : 'Search entries…'
            }
            placeholderTextColor={colors.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              hitSlop={8}
              style={styles.searchClear}
            >
              <Ionicons
                name="close-circle"
                size={16}
                color={colors.textFaint}
              />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            onPress={() => setFiltersOpen(true)}
            style={styles.searchInlineToggle}
            accessibilityLabel={`Filters. ${
              activeFacetCount > 0
                ? `${activeFacetCount} facet${
                    activeFacetCount === 1 ? '' : 's'
                  } active`
                : 'none active'
            }. Tap to open.`}
            hitSlop={6}
          >
            <Ionicons
              name={filterActive ? 'funnel' : 'funnel-outline'}
              size={16}
              color={filterActive ? colors.primary : colors.textFaint}
            />
            {activeFacetCount > 0 ? (
              <View style={styles.funnelBadge}>
                <Text style={styles.funnelBadgeText}>{activeFacetCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={toggleInlineComments}
            style={styles.searchInlineToggle}
            accessibilityLabel={`Inline comments are ${inlineComments ? 'visible' : 'hidden'}. Tap to toggle.`}
            hitSlop={6}
          >
            <Ionicons
              name={inlineComments ? 'chatbubbles' : 'chatbubbles-outline'}
              size={16}
              color={inlineComments ? colors.primary : colors.textFaint}
            />
          </TouchableOpacity>
        </View>
      )}

      {/* Saved-bead typeahead, tied to the home search bar. Only renders
          on the list view and only when typing prefix-matches a preset
          name (so the strip is silent by default and the list keeps its
          height). Tapping a chip applies that preset's four-facet bead
          filter and dismisses the keyboard so the user sees their narrow
          result immediately. The current filter's matching preset (if
          any) is highlighted so it's obvious which lens is in force. */}
      {view === 'list' && visibleHomePresets.length > 0 ? (
        <View style={styles.homePresetWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.homePresetStrip}
          >
          {/* The strip is hidden while a pill is pinned (see
              `visibleHomePresets`), so the chip here is always
              unselected: tapping pins the preset as a pill above the
              search bar and clears the text. The pill owns lifecycle
              from there; the strip is purely a summoner. */}
          {visibleHomePresets.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={styles.presetChip}
              onPress={() => {
                setHomePinnedThreadId(null);
                applyPresetFilter(p);
                setHomeAppliedPresetId(p.id);
                setSearchQuery('');
                Keyboard.dismiss();
              }}
              activeOpacity={0.7}
              accessibilityLabel={`Pin saved bead ${p.name} as filter`}
            >
              <BeadView
                bead={{
                  shape: p.shape,
                  pattern: p.pattern,
                  mood: p.mood,
                  glyph: p.glyph,
                }}
                size={20}
              />
              <Text style={styles.presetChipText} numberOfLines={1}>
                {p.name}
              </Text>
            </TouchableOpacity>
          ))}
          </ScrollView>
        </View>
      ) : null}

      {/* N12 filters live entirely in the Filters sheet (funnel icon).
          No inline pill bar: the notes list keeps full height; the
          funnel carries an active-facet count badge when filters are on.
          The Saved-beads strip that used to live in the Filters sheet
          moved up to the search bar typeahead above (v0.56.0): preset
          lookup follows where the typing already is. */}

      {/* Calendar stays mounted (hidden via display:none when inactive) so
          switching to it is instant: it's the heaviest view to build. The
          React.memo on CalendarMonth keeps it from re-rendering while hidden.
          List/Threads are untouched: they still mount on demand, so none of
          their filter chrome is affected. */}
      <View style={view === 'calendar' ? { flex: 1 } : { display: 'none' }}>
        <CalendarMonth
          entriesByDate={entriesByDate}
          beadsByDate={beadsByDate}
          anchoredThreads={anchoredThreads}
          reminders={activeReminders}
          doneReminders={doneReminders}
          commentReminders={calendarCommentReminders}
          doneCommentReminders={doneCommentReminders}
          onVisit={(dateStr) => navigation.navigate('Day', { dateStr })}
          onCreate={(dateStr) =>
            navigation.navigate('EntryEditor', { entryId: null, dateStr })
          }
          onOpenThread={(threadId) =>
            navigation.navigate('ThreadDetail', { threadId })
          }
          onDeleteReminder={handleDeleteReminder}
          onRestoreReminder={handleRestoreReminder}
          onLongPressReminder={handleReminderLongPress}
          onOpenRecurringList={() => setRecurringListVisible(true)}
          onOpenReminderComments={(r) => setReminderCommentsFor(r)}
          onOpenCommentReminder={openCommentReminder}
          reminderCommentCounts={reminderCommentCounts}
        />
      </View>

      {view === 'threads' && (
        <ThreadsList
          navigation={navigation}
          onOpenThread={(threadId) =>
            navigation.navigate('ThreadDetail', { threadId })
          }
          inlineComments={inlineComments}
          onToggleInlineComments={toggleInlineComments}
          selectMode={selectMode && selectionContext === 'thread'}
          selectedIds={selectedIds}
          onLongPressThread={handleLongPressThread}
          onSelectToggleThread={toggleSelected}
          refreshTick={threadsRefreshTick}
          onCountChange={setThreadsCount}
        />
      )}

      {view === 'list' && burstCluster ? (
        <BurstBanner
          count={burstCluster.length}
          styles={styles}
          colors={colors}
          onTap={handleBurstTap}
          onDismiss={handleBurstDismiss}
        />
      ) : null}

      {view === 'list' &&
      backupNudge &&
      !burstCluster &&
      !importNotice &&
      !selectMode ? (
        <BackupNudgeStrip
          nudge={backupNudge}
          styles={styles}
          colors={colors}
          onTap={handleBackupNudgeTap}
          onDismiss={handleBackupNudgeDismiss}
        />
      ) : null}

      {view === 'list' && importNotice ? (
        <TouchableOpacity
          style={styles.burstBanner}
          onPress={() => setImportNotice(null)}
          activeOpacity={0.85}
          accessibilityLabel={`${importNotice.imported} notes imported. Tap to dismiss.`}
        >
          <Ionicons name="download-outline" size={16} color={colors.primary} />
          <View style={styles.burstText}>
            <Text style={styles.burstTitle}>
              {importNotice.imported}{' '}
              {importNotice.imported === 1 ? 'note' : 'notes'} imported
            </Text>
            <Text style={styles.burstSubtitle}>
              The notes are drafts. Add a bead or a thread when you are ready.
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setImportNotice(null)}
            hitSlop={10}
            style={styles.burstDismiss}
            accessibilityLabel="Dismiss"
          >
            <Ionicons name="close" size={16} color={colors.textFaint} />
          </TouchableOpacity>
        </TouchableOpacity>
      ) : null}

      {view === 'list' && (
        <SectionList
          ref={sectionListRef}
          sections={sections}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <SwipeableEntryRow
              entry={item}
              colors={colors}
              styles={styles}
              inlineComments={inlineComments}
              selectMode={selectMode}
              selected={selectedIds.has(item.id)}
              onSelectToggle={() => toggleSelected(item.id)}
              onPress={() =>
                navigation.navigate('EntryEditor', { entryId: item.id })
              }
              onDelete={handleDeleteEntry}
              onComment={(e) => setEntryCommentsFor(e)}
              onLongPress={() => handleLongPressEntry(item)}
              onBeadLongPress={() => {
                handleBeadLongPress(item);
                // Scroll the list to the top so the new filter scope's
                // first match is visible. Guard with try/catch since
                // empty-list scrollToLocation throws on some platforms.
                try {
                  sectionListRef.current?.scrollToLocation({
                    sectionIndex: 0,
                    itemIndex: 0,
                    viewPosition: 0,
                    animated: true,
                  });
                } catch (_) {}
              }}
              onOpenThread={(threadId) =>
                navigation.navigate('ThreadDetail', { threadId })
              }
            />
          )}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
            </View>
          )}
          stickySectionHeadersEnabled
          // Virtualization was running on defaults, and `windowSize: 21`
          // meant ~66 EntryCards mounted on every list update, measured
          // at ~440ms of render on a 284-entry journal. 11 halves that
          // while keeping ~5 screens of buffer either side: 7 measured
          // faster still but left a visible fill-in when scrolling, and
          // deferring the secondary loaders freed enough budget to buy
          // the smoothness back.
          // NOTE: deliberately NOT setting removeClippedSubviews: it
          // crashed sticky section headers on the threads list, and this
          // list has stickySectionHeadersEnabled too.
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={11}
          contentContainerStyle={
            sections.length === 0 ? styles.emptyList : styles.listContent
          }
          ListEmptyComponent={renderEmpty}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        />
      )}

      {view === 'list' && !selectMode && (
        <DragFab
          onPress={() => navigation.navigate('EntryEditor', { entryId: null })}
          onCamera={handleQuickPhoto}
          onMic={() => setVoiceVisible(true)}
        />
      )}

      {view === 'calendar' && (
        <TouchableOpacity
          style={styles.threadFab}
          onPress={() => setReminderSheetVisible(true)}
          accessibilityLabel="New reminder"
        >
          <Ionicons name="add" size={32} color={colors.primaryOnPrimary} />
        </TouchableOpacity>
      )}
          </Animated.View>

      {/* Bottom navigation: the view switcher (WhatsApp/Material pattern).
          Sits below the sliding body, so the FAB (inside the body) floats just
          above it. Hidden in multi-select, where the header is repurposed. */}
      {!selectMode && (
        <View
          style={[
            styles.bottomNav,
            // Real system inset wins over the static 24: a 3-button Android
            // nav bar (~48dp) otherwise covers the tab row entirely.
            { paddingBottom: Math.max(insets.bottom + 6, 24) },
          ]}
        >
          {VIEW_ORDER.map((key, i) => {
            const active = VIEW_ORDER.indexOf(view) === i;
            return (
              <Pressable
                key={key}
                onPress={() => jumpToView(i)}
                style={styles.navItem}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${VIEW_LABEL[key]} view`}
              >
                <ViewIcon
                  view={key}
                  size={22}
                  color={active ? colors.primary : colors.textMuted}
                />
                <Text style={[styles.navLabel, active && styles.navLabelActive]}>
                  {VIEW_LABEL[key]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <QuickVoiceModal
        visible={voiceVisible}
        onSave={handleVoiceSave}
        onCancel={() => setVoiceVisible(false)}
      />

      {/* Note import: the capture bridge. A plain bottom sheet (NOT an
          anchored popover) so the edge-to-edge measureInWindow status-bar
          gotcha never applies. docs/architecture/note-import.md §4.4.
          The URL field sits at the bottom of the sheet, so the backdrop
          takes `paddingBottom: keyboardInset` to lift the whole sheet
          clear of the IME (edge-to-edge nullifies adjustResize, see
          hooks/useKeyboardHeight.js). Body scrolls because the lifted
          sheet is shorter than its content. Dismiss lives in a *sibling*
          strip above a plain-View sheet rather than an ancestor Pressable:
          an ancestor claims the touch responder and the ScrollView can
          then only steal a pan from a descendant button, never from empty
          space (the bug BeadComposer.js:443 documents). */}
      <Modal
        visible={importSheetVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImportSheetVisible(false)}
      >
        <View
          style={[
            styles.sheetBackdrop,
            keyboardInset > 0 && { paddingBottom: keyboardInset },
          ]}
        >
          <Pressable
            style={styles.sheetBackdropDismiss}
            onPress={() => setImportSheetVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
          <View
            style={[
              styles.sheet,
              { maxHeight: sheetMaxHeight },
              keyboardInset === 0 && {
                paddingBottom: Math.max(20, insets.bottom + 8),
              },
            ]}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Import notes</Text>
            <ScrollView
              style={styles.sheetScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.sheetHint}>
                Write notes on your computer, then organize them here. Choose a
                folder that a sync tool keeps in sync (Syncthing, a cloud
                drive). Vakana imports new .org / .md / .txt notes as drafts. An Org
                datetree becomes one entry for each day. No data leaves your
                devices.
              </Text>
              {importFolderUri ? (
                <Text style={styles.importPath} numberOfLines={1}>
                  {(() => {
                    try {
                      return decodeURIComponent(importFolderUri)
                        .split('tree/')
                        .pop()
                        .split(':')
                        .pop();
                    } catch {
                      return importFolderUri;
                    }
                  })()}
                </Text>
              ) : (
                <Text style={styles.importPathMuted}>
                  No folder chosen yet.
                </Text>
              )}

              <TouchableOpacity
                style={styles.importBtn}
                onPress={chooseImportFolder}
                disabled={importBusy}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="folder-open-outline"
                  size={18}
                  color={colors.primary}
                />
                <Text style={styles.importBtnText}>
                  {importBusy
                    ? 'Importing…'
                    : importFolderUri
                    ? 'Change synced folder…'
                    : 'Choose synced folder…'}
                </Text>
              </TouchableOpacity>

              {importFolderUri ? (
                <TouchableOpacity
                  style={styles.importBtnSecondary}
                  onPress={() => runImportScan(importFolderUri)}
                  disabled={importBusy}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="refresh-outline"
                    size={18}
                    color={colors.text}
                  />
                  <Text style={styles.importBtnSecondaryText}>
                    {importBusy ? 'Scanning…' : 'Scan now'}
                  </Text>
                </TouchableOpacity>
              ) : null}

              <Text style={styles.importUrlLabel}>Or pull from a URL</Text>
              <View style={styles.importUrlRow}>
                <TextInput
                  style={styles.importInput}
                  value={importUrl}
                  onChangeText={setImportUrl}
                  placeholder="https://…  a gist raw, a self-host, a paste"
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  editable={!importBusy}
                  returnKeyType="go"
                  onSubmitEditing={runUrlImport}
                />
                <TouchableOpacity
                  style={styles.importUrlBtn}
                  onPress={runUrlImport}
                  disabled={importBusy || !importUrl.trim()}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="cloud-download-outline"
                    size={18}
                    color={colors.primaryOnPrimary}
                  />
                </TouchableOpacity>
              </View>
              <Text style={styles.sheetHint}>
                You choose the host of the URL. The content is only as private as
                that host. The synced folder is the private path.
              </Text>

              {importNotice ? (
                <Text style={styles.importResult}>
                  {importNotice.error
                    ? 'The import failed. Check the source, then try again.'
                    : `Imported ${importNotice.imported} · skipped ${importNotice.skipped}`}
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ReminderFormSheet
        visible={reminderSheetVisible}
        onClose={() => setReminderSheetVisible(false)}
        onSaved={loadReminders}
      />

      <ReminderFormSheet
        visible={reminderEditTarget != null}
        initial={reminderEditTarget}
        onClose={() => setReminderEditTarget(null)}
        onSaved={loadReminders}
      />

      <ReminderActionsSheet
        visible={reminderActionsTarget != null}
        reminder={reminderActionsTarget}
        onWriteEntry={() => {
          // Reuse the exact banner path so ack-on-content / recurrence
          // advance / back-out-stays-unfired are inherited, not duplicated.
          const target = reminderActionsTarget;
          setReminderActionsTarget(null);
          if (target) openReminderEntry(target);
        }}
        onEdit={handleReminderEdit}
        onAck={() => {
          const target = reminderActionsTarget;
          setReminderActionsTarget(null);
          if (target) acknowledgeReminder(target);
        }}
        onToggleActive={handleReminderToggleActive}
        onDelete={() => {
          const target = reminderActionsTarget;
          setReminderActionsTarget(null);
          if (target) handleDeleteReminder(target);
        }}
        onClose={() => setReminderActionsTarget(null)}
      />

      <RecurringReminderListSheet
        visible={recurringListVisible}
        onClose={() => setRecurringListVisible(false)}
        onSelect={(r) => {
          setRecurringListVisible(false);
          setReminderActionsTarget(r);
        }}
      />

      <CommentsDrawer
        visible={entryCommentsFor != null}
        parentKind={PARENT_ENTRY}
        parentId={entryCommentsFor?.id ?? null}
        parentLabel={entryCommentsFor?.title || 'Entry'}
        onClose={() => {
          setEntryCommentsFor(null);
          loadEntries();
        }}
        onCommentsChanged={loadEntries}
        onPromoteToThreadCompose={({ originEntryId, newEntryId, originTitle }) => {
          setEntryCommentsFor(null);
          navigation.navigate('ThreadComposer', {
            threadId: null,
            prefilledEntryIds: [originEntryId, newEntryId],
            prefillName: `(From:) ${originTitle || 'Entry'}`,
          });
        }}
      />

      <FuseSheet
        visible={fuseSheetVisible}
        entryIds={selectionArray}
        onClose={() => setFuseSheetVisible(false)}
        onFused={handleFused}
      />

      <BatchThreadPicker
        visible={batchThreadPickerVisible}
        entryCount={selectionArray.length}
        onPick={handleBatchPickThread}
        onCreateNew={handleBatchCreateThread}
        onClose={() => setBatchThreadPickerVisible(false)}
      />

      <BatchCollectionPicker
        visible={batchCollectionPickerVisible}
        threadCount={selectionArray.length}
        onPick={handleBatchAddThreadsToCollection}
        onClose={() => setBatchCollectionPickerVisible(false)}
      />

      <Modal
        visible={filtersOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFiltersOpen(false)}
      >
        {/* Lifted clear of the IME the same way BeadComposer's sheet is:
            the glyph facet carries a TextInput and edge-to-edge makes
            adjustResize a no-op, so without this the keyboard covers the
            glyph list. Only correct now that `sheetScroll` can shrink:
            padding here reduces the sheet's available height, and before
            v0.80.3 the body answered less space by overflowing further. */}
        <Pressable
          style={[
            styles.sheetBackdrop,
            keyboardInset > 0 && { paddingBottom: keyboardInset },
          ]}
          onPress={() => setFiltersOpen(false)}
        >
          <Pressable
            style={[
              styles.sheet,
              { maxHeight: sheetMaxHeight },
              keyboardInset === 0 && {
                paddingBottom: Math.max(20, insets.bottom + 8),
              },
            ]}
            onPress={() => {}}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Filters</Text>
            <Text style={styles.sheetHint}>
              Filter entries by bead, by connection and by capture type.
              The filter uses AND between facets and OR between the choices in
              a facet. The app does not save the filters.
            </Text>
            <ScrollView
              style={styles.sheetScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Saved-beads strip moved out of the Filters sheet in
                  v0.56.0: the typeahead under the home search bar above
                  is the new preset entry point, where the user is already
                  typing. The bead facets below still narrow per attribute. */}

              {/* Connection: the two coarse cuts of the same axis, above
                  the bead facets. Mention counts as woven, so Unwoven is
                  the "no thread connection of either verb" view and
                  Mentions is its positive half; they're mutually exclusive
                  because both together can only ever be empty. Each
                  AND-composes with the bead facets (e.g. unwoven + a saved
                  bead = unwoven entries carrying that bead). The shipped
                  Select-all-N→thread footer turns finding into weaving in
                  the same motion. */}
              <Text style={styles.facetLabel}>Connection</Text>
              <TouchableOpacity
                style={[styles.lensRow, unwoven && styles.lensRowOn]}
                onPress={() => {
                  setUnwoven((v) => !v);
                  setMentionsOthers(false);
                }}
                activeOpacity={0.7}
                accessibilityLabel={`Unwoven only filter${unwoven ? ', on' : ', off'}`}
              >
                <Ionicons
                  name={unwoven ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={unwoven ? colors.primary : colors.textMuted}
                />
                <View style={styles.lensBody}>
                  <Text style={styles.lensTitle}>Unwoven only</Text>
                  <Text style={styles.lensSubtitle}>
                    entries with no thread and no mention
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.lensRow, mentionsOthers && styles.lensRowOn]}
                onPress={() => {
                  setMentionsOthers((v) => !v);
                  setUnwoven(false);
                }}
                activeOpacity={0.7}
                accessibilityLabel={`Mentions a thread filter${
                  mentionsOthers ? ', on' : ', off'
                }`}
              >
                <Ionicons
                  name={mentionsOthers ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={mentionsOthers ? colors.primary : colors.textMuted}
                />
                <View style={styles.lensBody}>
                  <Text style={styles.lensTitle}>Mentions a thread</Text>
                  <Text style={styles.lensSubtitle}>
                    entries that point at another thread
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Capture: reach the entries the search bar can't. Search
                  covers title + content + comments; a voice-only entry has
                  none of the three, and a photo-only one saved under a
                  `Draft <timestamp>` title is just as unreachable. Two
                  lenses, not one "has media", so that gap stays legible.
                  These AND together like every other facet. */}
              <Text style={styles.facetLabel}>Capture</Text>
              <TouchableOpacity
                style={[styles.lensRow, hasPhoto && styles.lensRowOn]}
                onPress={() => setHasPhoto((v) => !v)}
                activeOpacity={0.7}
                accessibilityLabel={`Has a photo filter${hasPhoto ? ', on' : ', off'}`}
              >
                <Ionicons
                  name={hasPhoto ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={hasPhoto ? colors.primary : colors.textMuted}
                />
                <View style={styles.lensBody}>
                  <Text style={styles.lensTitle}>Has a photo</Text>
                  <Text style={styles.lensSubtitle}>
                    entries with at least one image
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.lensRow, hasVoice && styles.lensRowOn]}
                onPress={() => setHasVoice((v) => !v)}
                activeOpacity={0.7}
                accessibilityLabel={`Has a voice note filter${
                  hasVoice ? ', on' : ', off'
                }`}
              >
                <Ionicons
                  name={hasVoice ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={hasVoice ? colors.primary : colors.textMuted}
                />
                <View style={styles.lensBody}>
                  <Text style={styles.lensTitle}>Has a voice note</Text>
                  <Text style={styles.lensSubtitle}>
                    recordings that text search cannot find
                  </Text>
                </View>
              </TouchableOpacity>

              <Text style={styles.facetLabel}>Shape</Text>
              <View style={styles.facetWrap}>
                {ACTION_TYPES.map((t) => {
                  const on = shapeFilter.includes(t.shape);
                  return (
                    <TouchableOpacity
                      key={t.shape}
                      style={[styles.facetItem, on && styles.facetItemOn]}
                      onPress={() => toggleShape(t.shape)}
                      activeOpacity={0.7}
                      accessibilityLabel={`${SHAPE_GEOMETRY[t.shape] || t.shape}${on ? ', selected' : ''}`}
                    >
                      <BeadView
                        bead={{
                          shape: t.shape,
                          pattern: 'solid',
                          mood: 'slate',
                          glyph: '',
                        }}
                        size={26}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.facetLabel}>Mood</Text>
              <View style={styles.facetWrap}>
                {MOODS.map((m) => {
                  const on = moodFilter.includes(m.key);
                  return (
                    <TouchableOpacity
                      key={m.key}
                      style={[styles.facetItem, on && styles.facetItemOn]}
                      onPress={() => toggleMood(m.key)}
                      activeOpacity={0.7}
                      accessibilityLabel={`${m.label}${on ? ', selected' : ''}`}
                    >
                      <BeadView
                        bead={{
                          shape: 'round',
                          pattern: 'solid',
                          mood: m.key,
                          glyph: '',
                        }}
                        size={26}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.facetLabel}>Pattern</Text>
              <View style={styles.facetWrap}>
                {PATTERNS.map((p) => {
                  const on = patternFilter.includes(p.key);
                  return (
                    <TouchableOpacity
                      key={p.key}
                      style={[styles.facetItem, on && styles.facetItemOn]}
                      onPress={() => togglePattern(p.key)}
                      activeOpacity={0.7}
                      accessibilityLabel={`${p.label}${on ? ', selected' : ''}`}
                    >
                      <BeadView
                        bead={{
                          shape: 'square',
                          pattern: p.key,
                          mood: 'slate',
                          glyph: '',
                        }}
                        size={26}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.facetLabel}>
                Glyph{glyphsInUse.length > 0 ? ` (${glyphsInUse.length})` : ''}
              </Text>
              {glyphsInUse.length === 0 ? (
                <Text style={styles.glyphEmpty}>
                  No bead has a glyph yet. Add a glyph to a bead. Then you can
                  filter by that glyph here.
                </Text>
              ) : (
                <>
                  {/* Sibling of the rows below, NOT a FlatList header. */}
                  <TextInput
                    style={styles.glyphSearchInput}
                    placeholder="Search glyphs…"
                    placeholderTextColor={colors.placeholder}
                    value={glyphSearch}
                    onChangeText={setGlyphSearch}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  {visibleGlyphs.length === 0 ? (
                    <Text style={styles.glyphEmpty}>
                      No glyph matches that search.
                    </Text>
                  ) : (
                    visibleGlyphs.map((row) => {
                      const on = glyphFilter.includes(row.glyph);
                      return (
                        <TouchableOpacity
                          key={row.glyph}
                          style={[styles.glyphRow, on && styles.glyphRowOn]}
                          onPress={() => toggleGlyph(row.glyph)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.glyphGlyph}>{row.glyph}</Text>
                          <Text style={styles.glyphCount}>
                            {row.count} {row.count === 1 ? 'bead' : 'beads'}
                          </Text>
                          <Ionicons
                            name={on ? 'checkmark-circle' : 'ellipse-outline'}
                            size={20}
                            color={on ? colors.primary : colors.textFaint}
                          />
                        </TouchableOpacity>
                      );
                    })
                  )}
                </>
              )}
              <View style={{ height: 8 }} />
            </ScrollView>

            <View style={styles.sheetFooter}>
              {filterActive && entries.length > 0 ? (
                <TouchableOpacity
                  style={styles.selectAllBtn}
                  onPress={() => {
                    selectAllFiltered();
                    setFiltersOpen(false);
                  }}
                  activeOpacity={0.85}
                  accessibilityLabel={`Select all ${entries.length} filtered entries to add to a thread`}
                >
                  <Ionicons
                    name="git-branch-outline"
                    size={16}
                    color={colors.primaryOnPrimary}
                  />
                  <Text style={styles.selectAllBtnText}>
                    Select all {entries.length} → thread
                  </Text>
                </TouchableOpacity>
              ) : null}
              <View style={styles.sheetFooterRow}>
                {filterActive ? (
                  <TouchableOpacity
                    onPress={clearFilters}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.clearAllText}>Clear all</Text>
                  </TouchableOpacity>
                ) : (
                  <View />
                )}
                <TouchableOpacity
                  style={styles.doneBtn}
                  onPress={() => setFiltersOpen(false)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.doneText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <CommentsDrawer
        visible={reminderCommentsFor != null}
        parentKind={PARENT_REMINDER}
        parentId={reminderCommentsFor?.id ?? null}
        parentLabel={reminderCommentsFor?.title || 'Reminder'}
        // Comment-reminders on a reminder's own comments don't make sense
        // (compound case explicitly skipped per the N15 spec).
        allowReminders={false}
        onClose={() => {
          setReminderCommentsFor(null);
          loadReminders();
        }}
        onCommentsChanged={loadReminders}
      />

      <Modal
        visible={overflowMenuVisible}
        transparent
        // measureInWindow returns the ⋮ in full edge-to-edge window
        // coords (incl. the status-bar strip); without this the Modal's
        // content is inset below the status bar and the popover shifts
        // up onto the button. Matches PhotoViewer's full-window Modal.
        statusBarTranslucent
        animationType="none"
        onRequestClose={() => setOverflowMenuVisible(false)}
      >
        <Pressable
          style={styles.overflowBackdrop}
          onPress={() => setOverflowMenuVisible(false)}
        >
          <View
            style={[
              styles.overflowAnchor,
              { top: overflowAnchor.top, right: overflowAnchor.right },
            ]}
            pointerEvents="box-none"
          >
            <View style={styles.overflowTail} />
            <Pressable style={styles.overflowMenu} onPress={() => {}}>
            {view === 'list' ? (
              <TouchableOpacity
                style={styles.overflowItem}
                onPress={() => {
                  setOverflowMenuVisible(false);
                  enterSelectMode();
                }}
              >
                <Ionicons
                  name="checkmark-circle-outline"
                  size={18}
                  color={colors.primary}
                />
                <Text style={styles.overflowItemText}>Select entries</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.overflowItem}
              onPress={() => {
                setOverflowMenuVisible(false);
                setImportSheetVisible(true);
              }}
            >
              <Ionicons
                name="download-outline"
                size={18}
                color={colors.primary}
              />
              <Text style={styles.overflowItemText}>Import notes…</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.overflowItem}
              onPress={() => {
                setOverflowMenuVisible(false);
                lock();
              }}
            >
              <Ionicons
                name="lock-closed-outline"
                size={18}
                color={colors.primary}
              />
              <Text style={styles.overflowItemText}>Lock app</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.overflowItem}
              onPress={() => {
                setOverflowMenuVisible(false);
                navigation.navigate('Settings');
              }}
            >
              <Ionicons
                name="settings-outline"
                size={18}
                color={colors.primary}
              />
              <Text style={styles.overflowItemText}>Settings</Text>
            </TouchableOpacity>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Notifications popover: the fired-reminder banner stack as a
          bell-anchored tooltip overlay (the ⋮-menu pattern: transparent
          backdrop, measured anchor, rotated tail). Wider than the ⋮ menu and
          the banners wrap (no truncation), and the inner list scrolls when it
          would overflow the screen. Opens whether or not anything has fired:
          with an empty count it shows the quiet empty state instead. */}
      <Modal
        visible={bannersOpen}
        transparent
        statusBarTranslucent
        animationType="none"
        onRequestClose={() => setBannersOpen(false)}
      >
        <Pressable
          style={styles.overflowBackdrop}
          onPress={() => setBannersOpen(false)}
        >
          <View
            style={[styles.notifAnchor, { top: bellAnchor.top }]}
            pointerEvents="box-none"
          >
            <View
              style={[
                styles.notifTail,
                { marginLeft: Math.max(0, bellAnchor.iconCenterX - 18) },
              ]}
            />
            <Pressable style={styles.notifCard} onPress={() => {}}>
              <ScrollView
                style={{
                  maxHeight:
                    Dimensions.get('window').height - bellAnchor.top - 24,
                }}
                contentContainerStyle={styles.notifScrollContent}
                showsVerticalScrollIndicator
              >
                {pendingBannerCount === 0 ? (
                  <View style={styles.notifEmpty}>
                    <Text style={styles.notifEmptyText}>
                      No reminders have fired.
                    </Text>
                    <Text style={styles.notifEmptyHint}>
                      Reminders and comment-reminders show here at their scheduled
                      time.
                    </Text>
                  </View>
                ) : null}
                {firedReminders.map((r) => (
                  <ReminderBanner
                    key={`r-${r.id}`}
                    reminder={r}
                    styles={styles}
                    colors={colors}
                    onTap={() => {
                      setBannersOpen(false);
                      setReminderActionsTarget(r);
                    }}
                    onDismiss={() => acknowledgeReminder(r)}
                  />
                ))}
                {firedCommentReminders.map((c) => (
                  <CommentReminderBanner
                    key={`c-${c.id}`}
                    comment={c}
                    styles={styles}
                    colors={colors}
                    onTap={() => {
                      setBannersOpen(false);
                      openCommentReminder(c);
                    }}
                    onDismiss={() => dismissCommentReminder(c)}
                  />
                ))}
              </ScrollView>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// Memoized so an unrelated HomeScreen state change (opening the bell banner,
// the ⋮ menu, etc.) doesn't re-render every visible row. Each row draws a
// bead SVG, so re-rendering the whole visible list on every tap was the
// fraction-second hitch felt on the List view. The comparator re-renders only
// when a display/behaviour prop changes; the inline handler closures it
// ignores are staleness-resilient (they act via stable setters / refs / args).
const SwipeableEntryRow = React.memo(function SwipeableEntryRow({
  entry,
  colors,
  styles,
  onPress,
  onDelete,
  onComment,
  onLongPress,
  onBeadLongPress,
  onOpenThread,
  inlineComments,
  selectMode = false,
  selected = false,
  onSelectToggle,
}) {
  const ref = React.useRef(null);

  // In select mode the row is a plain pressable with a leading checkbox.
  // Swipe and long-press are intentionally disabled so the user can sweep
  // through the list selecting without accidentally triggering destructive
  // gestures or the add-to-thread flow.
  if (selectMode) {
    return (
      <View style={styles.selectRow}>
        <TouchableOpacity
          style={styles.checkboxTouch}
          onPress={onSelectToggle}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.checkbox,
              selected && styles.checkboxFilled,
            ]}
          >
            {selected ? (
              <Ionicons
                name="checkmark"
                size={14}
                color={colors.primaryOnPrimary}
              />
            ) : null}
          </View>
        </TouchableOpacity>
        <View style={styles.selectRowBody}>
          <EntryCard
            entry={entry}
            onPress={onSelectToggle}
            onLongPress={onSelectToggle}
            onOpenThread={onOpenThread}
            inlineCommentsDefault={inlineComments}
          />
        </View>
      </View>
    );
  }

  const renderLeftAction = () => (
    <View style={[styles.swipeAction, styles.swipeActionComment, styles.swipeActionLeft]}>
      <Ionicons name="chatbubble-ellipses" size={22} color="#fff" />
      <Text style={styles.swipeActionText}>Comment</Text>
    </View>
  );
  const renderRightAction = () => (
    <View style={[styles.swipeAction, styles.swipeActionRight]}>
      <Ionicons name="trash" size={22} color="#fff" />
      <Text style={styles.swipeActionText}>Delete</Text>
    </View>
  );

  // Swipe-right (revealing left action) opens the comments drawer
  // immediately: the gesture *is* the commit. Swipe-left (revealing right
  // action) keeps the existing delete-with-confirmation flow because the
  // outcome is destructive.
  const handleOpen = (direction) => {
    if (direction === 'left') {
      ref.current?.close();
      onComment?.(entry);
      return;
    }
    Alert.alert('Delete entry', 'Delete this entry permanently?', [
      {
        text: 'Cancel',
        style: 'cancel',
        onPress: () => ref.current?.close(),
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          ref.current?.close();
          await onDelete(entry);
        },
      },
    ]);
  };

  return (
    <Swipeable
      ref={ref}
      renderLeftActions={renderLeftAction}
      renderRightActions={renderRightAction}
      friction={2}
      leftThreshold={60}
      rightThreshold={60}
      onSwipeableOpen={handleOpen}
    >
      <EntryCard
        entry={entry}
        onPress={onPress}
        onLongPress={onLongPress}
        onBeadLongPress={onBeadLongPress}
        onOpenThread={onOpenThread}
        inlineCommentsDefault={inlineComments}
      />
    </Swipeable>
  );
}, (a, b) =>
  a.entry === b.entry &&
  a.selected === b.selected &&
  a.selectMode === b.selectMode &&
  a.inlineComments === b.inlineComments &&
  a.colors === b.colors &&
  a.styles === b.styles);

// Small banner offering to fuse-or-thread a fresh burst of quick captures.
// Tap → enter select mode pre-selected and open the FuseSheet. × dismisses
// for the session (the cluster ages out within ~30 min anyway).
function BurstBanner({ count, styles, colors, onTap, onDismiss }) {
  return (
    <TouchableOpacity
      style={styles.burstBanner}
      onPress={onTap}
      activeOpacity={0.85}
      accessibilityLabel={`${count} recent quick captures. Tap to fuse or thread them.`}
    >
      <Ionicons name="flask-outline" size={16} color={colors.primary} />
      <View style={styles.burstText}>
        <Text style={styles.burstTitle}>
          {count} new quick captures
        </Text>
        <Text style={styles.burstSubtitle}>
          Tap to fuse them into one entry or to thread them.
        </Text>
      </View>
      <TouchableOpacity
        onPress={onDismiss}
        hitSlop={10}
        style={styles.burstDismiss}
        accessibilityLabel="Dismiss"
      >
        <Ionicons name="close" size={16} color={colors.textFaint} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// One-line backup nudge, deliberately quieter than the burst banner: no
// title/subtitle pair, hairline border, muted text. Shows only when the
// vault is stale AND holds unbacked-up writes (services/backup.js owns the
// derivation); tap opens Backup & Restore, × snoozes for a week. Yields the
// banner slot to burst/import notices: never two banners stacked.
function BackupNudgeStrip({ nudge, styles, colors, onTap, onDismiss }) {
  const text = nudge.never
    ? 'This vault has no backup. Make a backup.'
    : `Last backup ${nudge.ageText}. Make a new backup.`;
  return (
    <TouchableOpacity
      style={styles.backupNudge}
      onPress={onTap}
      activeOpacity={0.85}
      accessibilityLabel={`${text} Tap to open Backup and Restore.`}
    >
      <Ionicons name="cloud-offline-outline" size={15} color={colors.textMuted} />
      <Text style={styles.backupNudgeText} numberOfLines={1}>
        {text}
      </Text>
      <TouchableOpacity
        onPress={onDismiss}
        hitSlop={10}
        style={styles.burstDismiss}
        accessibilityLabel="Dismiss backup reminder for a week"
      >
        <Ionicons name="close" size={15} color={colors.textFaint} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function ReminderBanner({ reminder, styles, colors, onTap, onDismiss }) {
  const t = Date.parse(
    `${reminder.scheduled_date}T${reminder.scheduled_time || '00:00'}:00`
  );
  const fired = Number.isFinite(t) ? new Date(t) : null;
  const ago = fired
    ? fired.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';
  // Recurrence catchup. If a series fired multiple times since the user
  // last looked, surface the count in the banner subtitle so the ack feels
  // honest ("3 due since you last looked") instead of pretending only the
  // most recent occurrence happened.
  const missed = computeMissedCount(
    reminder.scheduled_date,
    reminder.scheduled_time,
    reminder.recurrence_kind,
    reminder.recurrence_every || 1,
    new Date(),
    reminder.recurrence_anchor_day
  );
  return (
    <View style={styles.bannerRow}>
      <TouchableOpacity
        style={styles.bannerTapZone}
        onPress={onTap}
        activeOpacity={0.7}
      >
        <Ionicons
          name={reminder.recurrence_kind ? 'repeat' : 'notifications'}
          size={16}
          color={colors.primaryOnPrimary}
          style={{ marginRight: 8 }}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>
            {reminder.title || 'Journal Reminder'}
          </Text>
          {reminder.message ? (
            <Text style={styles.bannerMessage}>
              {reminder.message}
            </Text>
          ) : null}
          <Text style={styles.bannerMeta}>
            {ago}
            {missed > 1
              ? `  ·  ${missed} due since you last looked`
              : reminder.recurrence_kind
              ? `  ·  ${formatRule({
                  kind: reminder.recurrence_kind,
                  every: reminder.recurrence_every || 1,
                  scheduledDate: reminder.scheduled_date,
                })}`
              : ''}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onDismiss}
        style={styles.bannerClose}
        hitSlop={8}
        accessibilityLabel="Dismiss reminder"
      >
        <Ionicons name="close" size={18} color={colors.primaryOnPrimary} />
      </TouchableOpacity>
    </View>
  );
}

// Banner for a comment-reminder. Distinct icon (chatbubble) so the user
// can tell self-pings from prompt-reminders at a glance. Body copy reads
// "<parent name> · <comment body>" so the user knows immediately what
// they're being pinged about.
function CommentReminderBanner({ comment, styles, colors, onTap, onDismiss }) {
  const at = comment.remind_at ? new Date(comment.remind_at) : null;
  const ago = at
    ? at.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';
  return (
    <View style={styles.bannerRow}>
      <TouchableOpacity
        style={styles.bannerTapZone}
        onPress={onTap}
        activeOpacity={0.7}
      >
        <Ionicons
          name="chatbubble-ellipses"
          size={16}
          color={colors.primaryOnPrimary}
          style={{ marginRight: 8 }}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>
            {comment.parent_label || 'Comment reminder'}
          </Text>
          <MarkdownInline style={styles.bannerMessage}>
            {comment.body}
          </MarkdownInline>
          <Text style={styles.bannerMeta}>{ago}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onDismiss}
        style={styles.bannerClose}
        hitSlop={8}
        accessibilityLabel="Dismiss comment reminder"
      >
        <Ionicons name="close" size={18} color={colors.primaryOnPrimary} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 60,
      paddingBottom: 12,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    bodyWrap: {
      // The animated body wrapper takes the remaining vertical space below
      // the header (and banners). flex:1 is load-bearing: without it the
      // wrapper shrinks to content and the SectionList loses its scroll
      // viewport.
      flex: 1,
    },
    headerTitleBlock: {
      // Vertical stack: Malagasy name + epithet underneath. The parent row
      // is alignItems:center so the cycle-view icon sits centered against
      // the whole block.
      flexDirection: 'column',
      justifyContent: 'center',
    },
    headerTitle: {
      fontSize: 28,
      fontWeight: 'bold',
      color: colors.text,
    },
    headerSubtitle: {
      // The English epithet: faint, italic, tucked under the Malagasy
      // name so the language is the title and the gloss is the marginalia.
      fontSize: 11,
      fontStyle: 'italic',
      color: colors.textFaint,
      marginTop: -2,
      letterSpacing: 0.3,
    },
    headerActions: {
      flexDirection: 'row',
      gap: 6,
    },
    // ── Title + description on top, segmented-control view-switcher below ──
    headerCol: {
      paddingHorizontal: 20,
      paddingTop: 58,
      paddingBottom: 10,
    },
    headerTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    headerLeftGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flexShrink: 1,
    },
    viewSigil: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    bottomNav: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
      paddingTop: 8,
      paddingBottom: 24, // floor; the render site raises it to the live safe-area inset
    },
    navItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
      paddingVertical: 2,
    },
    navLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textMuted,
    },
    navLabelActive: {
      color: colors.primary,
      fontWeight: '700',
    },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    bellBadge: {
      position: 'absolute',
      top: 2,
      right: 2,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: colors.primary,
      paddingHorizontal: 4,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1.5,
      borderColor: colors.surfaceMuted,
    },
    bellBadgeText: {
      color: colors.primaryOnPrimary,
      fontSize: 9,
      fontWeight: '700',
      lineHeight: 11,
    },
    overflowBackdrop: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    // Anchor positioned absolutely at the measured ⋮ icon coords so the
    // tail lines up with the icon regardless of device or status bar.
    overflowAnchor: {
      position: 'absolute',
      alignItems: 'flex-end',
    },
    // Small rotated square tail. Sits half-overlapping the bubble's top
    // edge so it reads as a single tooltip pointing at the ⋮ icon. The
    // marginRight of 12 centers the tail under the icon (icon width 36 →
    // center at 18 from right edge → tail half-width 6 + marginRight 12 = 18).
    overflowTail: {
      width: 12,
      height: 12,
      marginRight: 12,
      marginBottom: -6,
      backgroundColor: colors.surface,
      borderLeftWidth: 1,
      borderTopWidth: 1,
      borderColor: colors.border,
      transform: [{ rotate: '45deg' }],
      zIndex: 2,
    },
    overflowMenu: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      minWidth: 180,
      paddingVertical: 4,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    overflowItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    overflowItemText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '500',
    },
    // Notifications popover (bell-anchored). Near-full-width with 12px side
    // margins so banner text never has to truncate. Wider than the ⋮ menu.
    notifAnchor: {
      position: 'absolute',
      left: 12,
      right: 12,
    },
    // Rotated-square tail pointing up at the bell. Mirrors overflowTail, but
    // positioned by marginLeft (the card is near-full-width, so the tail can't
    // hug the right edge: it sits under the measured bell center). marginBottom
    // -6 overlaps the card's top edge so they read as one tooltip.
    notifTail: {
      width: 12,
      height: 12,
      marginBottom: -6,
      backgroundColor: colors.surface,
      borderLeftWidth: 1,
      borderTopWidth: 1,
      borderColor: colors.border,
      transform: [{ rotate: '45deg' }],
      zIndex: 2,
    },
    notifCard: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      // Clip the scroll view to the rounded corners.
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    notifScrollContent: {
      padding: 8,
      gap: 6,
    },
    // Nothing has fired: a compact two-line note, not a tall empty panel.
    notifEmpty: {
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 4,
    },
    notifEmptyText: {
      color: colors.textMuted,
      fontSize: 14,
      fontStyle: 'italic',
    },
    notifEmptyHint: {
      color: colors.textFaint,
      fontSize: 12,
      fontStyle: 'italic',
      lineHeight: 17,
    },
    // Variant of iconButton for the view-cycle button: a primary-colored
    // hairline ring + a soft "glow" via shadow draws the eye and tells the
    // user "this is the thing you can tap to switch views." The other icon
    // buttons (settings, lock, multi-select) stay neutral so the cycle
    // button isn't lost in the row.
    viewCycleButton: {
      borderWidth: 1.5,
      borderColor: colors.primary,
      shadowColor: colors.primary,
      shadowOpacity: 0.35,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 0 },
      // Android: elevation gives a real shadow; the color is only honored on
      // API 28+, falls back to gray below. That's acceptable: the border
      // already carries the invitation; the glow is the bonus.
      elevation: 3,
    },
    iconButtonDisabled: {
      opacity: 0.45,
    },
    selectCountText: {
      flex: 1,
      textAlign: 'center',
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    selectRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
    },
    checkboxTouch: {
      width: 32,
      height: 32,
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: colors.borderStrong,
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkboxFilled: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    selectRowBody: {
      flex: 1,
    },
    burstBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 20,
      marginBottom: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surfaceMuted,
    },
    burstText: {
      flex: 1,
    },
    backupNudge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 20,
      marginBottom: 8,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    backupNudgeText: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 12,
    },
    burstTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    burstSubtitle: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 1,
    },
    burstDismiss: {
      padding: 4,
    },
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 20,
      marginBottom: 12,
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchIcon: { marginRight: 8 },
    searchInput: {
      flex: 1,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 15,
    },
    searchClear: { padding: 4 },
    searchInlineToggle: {
      width: 30,
      height: 30,
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: 4,
    },
    funnelBadge: {
      position: 'absolute',
      top: 2,
      right: 2,
      minWidth: 14,
      height: 14,
      borderRadius: 7,
      paddingHorizontal: 3,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    funnelBadgeText: {
      color: colors.primaryOnPrimary,
      fontSize: 9,
      fontWeight: '800',
      lineHeight: 12,
    },
    sheetBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    // Fills the dim space above a sheet as a *sibling* of it, so tapping
    // out still closes while the sheet's own ScrollView keeps the touch
    // responder. Used where the sheet body scrolls (import); the sheets
    // whose backdrop is itself the Pressable don't need it.
    sheetBackdropDismiss: {
      flex: 1,
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 20,
      // NO `maxHeight: '85%'` here: the cap is passed in as pixels from
      // `sheetMaxHeight`. A percentage has to resolve against the parent's
      // height, and inside a Modal that height is not definite on the first
      // layout pass, so the cap came out far too small and the sheet opened
      // at roughly a third of its size. It corrected itself the moment
      // anything forced a second pass (focusing the glyph search did it),
      // which is the tell. Harmless while a sheet's content fit under the
      // cap and the cap never applied. v0.80.0's extra rows made the
      // Filters sheet depend on it for the first time (v0.80.4).
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: 12,
    },
    sheetTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    sheetHint: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 4,
      marginBottom: 8,
    },
    importPath: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
      marginTop: 6,
    },
    importPathMuted: {
      color: colors.textMuted,
      fontSize: 13,
      fontStyle: 'italic',
      marginTop: 6,
    },
    importBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 12,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surfaceMuted,
    },
    importBtnText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '700',
    },
    importBtnSecondary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 10,
      paddingVertical: 11,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    importBtnSecondaryText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    importUrlLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 18,
      marginBottom: 6,
    },
    importUrlRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    importInput: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    importUrlBtn: {
      width: 44,
      height: 44,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    importResult: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 12,
      textAlign: 'center',
    },
    // Scrolling body of a bottom sheet, between a fixed header and a fixed
    // footer inside a `maxHeight: '85%'` container.
    //
    // `flexShrink: 1` is load-bearing and NOT redundant: React Native
    // defaults `flexShrink` to **0** (CSS defaults it to 1). With
    // `flexGrow: 0` alone the ScrollView sizes to its full content height
    // and refuses to give any back, so once header + content + footer
    // exceed 85% the children overflow the clamped sheet and are clipped:
    // the footer disappears, the lower facets are unreachable, and the
    // ScrollView never scrolls because it believes it already has room for
    // everything. It looks like the sheet "went short". This was latent
    // until v0.80.0's Connection + Capture rows pushed the Filters sheet's
    // content past the cap (v0.80.3). `flexGrow: 0` stays so a short body
    // still shrink-wraps instead of claiming the full height.
    sheetScroll: {
      flexGrow: 0,
      flexShrink: 1,
    },
    facetLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 14,
      marginBottom: 8,
    },
    facetWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 8,
    },
    facetItem: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: 5,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: 'transparent',
      backgroundColor: colors.surface,
    },
    facetItemOn: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceMuted,
    },
    // Checkbox-row lens inside the Filters sheet. Shared by the Connection
    // group (Unwoven / Mentions) and the Capture group (photo / voice).
    // Was `unwoven*` when Unwoven was the only one.
    lensRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: 'transparent',
      backgroundColor: colors.surface,
    },
    lensRowOn: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceMuted,
    },
    lensBody: {
      flex: 1,
    },
    lensTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    lensSubtitle: {
      color: colors.textFaint,
      fontSize: 12,
      marginTop: 2,
    },
    // Outer wrap for the home-search preset typeahead. marginHorizontal
    // matches the search bar above so chips align with it; marginBottom
    // sits the strip just above the SectionList / banners that follow.
    // Explicit `height` is load-bearing: horizontal ScrollViews in a
    // column-flex parent occasionally take more vertical space than
    // their content needs (Android in particular), which made the
    // chips-centered-within-tall-container look like a gap between the
    // strip and the SectionList after v0.57.0 stopped the stretching.
    // Capping at 40 (chip 34 + border 2 + contentContainer paddingVertical
    // 4) pins the strip to exactly its content.
    homePresetWrap: {
      marginHorizontal: 20,
      marginBottom: 8,
      height: 40,
    },
    homePresetStrip: {
      flexDirection: 'row',
      // Explicit cross-axis alignment so the chips can't stretch
      // vertically when the post-tap layout reflow gives the ScrollView
      // more available height than the chips need. Default RN flex
      // alignItems is 'stretch', and that's what made the chips grow
      // ugly after a tap applied the filter (entries list shrank,
      // keyboard dismissed, body wrap re-measured, the ScrollView's
      // own height followed, and the chips stretched to fill it).
      alignItems: 'center',
      gap: 6,
      paddingVertical: 2,
      paddingRight: 12,
    },
    presetChip: {
      flexDirection: 'row',
      alignItems: 'center',
      // Belt-and-suspenders against cross-axis stretch: even if the
      // contentContainer's alignItems were ever changed, alignSelf
      // pins this chip to its natural height.
      alignSelf: 'flex-start',
      gap: 7,
      paddingLeft: 6,
      paddingRight: 10,
      paddingVertical: 7,
      // Hardened against the Android clipping bug v0.55.0 closed in the
      // picker. The same chip lives in two surfaces now (this strip + the
      // BeadPickerModal), and both honor the same vertical floor +
      // disabled font-padding so descenders never crop regardless of
      // ScrollView measuring pressure.
      minHeight: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      maxWidth: 170,
    },
    presetChipSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    presetChipText: {
      color: colors.text,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '600',
      flexShrink: 1,
      includeFontPadding: false,
    },
    presetChipTextSelected: {
      color: colors.primaryOnPrimary,
    },
    // Scope-pill row above the search bar. The pill itself reuses the
    // presetChip + presetChipSelected geometry; pinnedPill just nudges
    // the right padding so the × button has room without doubling up
    // with the chip's intrinsic paddingRight (10) of presetChip.
    pinnedPillWrap: {
      marginHorizontal: 20,
      marginBottom: 8,
      flexDirection: 'row',
      alignItems: 'center',
    },
    pinnedPill: {
      paddingRight: 4,
      maxWidth: '90%',
    },
    pinnedPillRemove: {
      width: 22,
      height: 22,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 2,
    },
    // Lighter than the name (regular vs semibold) so the count reads
    // as metadata, not a second word. Same color as the name though:
    // dimming it further on the primary background hurts legibility.
    pinnedPillCount: {
      fontWeight: '400',
      color: colors.primaryOnPrimary,
    },
    glyphSearchInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: colors.text,
      backgroundColor: colors.surfaceMuted,
      marginBottom: 8,
    },
    glyphEmpty: {
      color: colors.textFaint,
      fontSize: 13,
      paddingVertical: 16,
    },
    glyphRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    glyphRowOn: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceMuted,
    },
    glyphGlyph: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '700',
      minWidth: 32,
      textAlign: 'center',
    },
    glyphCount: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 12,
    },
    sheetFooter: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 12,
      marginTop: 8,
      gap: 10,
    },
    selectAllBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 11,
      borderRadius: 10,
      backgroundColor: colors.primary,
    },
    selectAllBtnText: {
      color: colors.primaryOnPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    sheetFooterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    clearAllText: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: '600',
    },
    doneBtn: {
      paddingVertical: 8,
      paddingHorizontal: 22,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    doneText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    sectionHeader: {
      backgroundColor: colors.background,
      paddingTop: 12,
      paddingBottom: 4,
      paddingHorizontal: 20,
    },
    sectionHeaderText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    listContent: {
      // No horizontal inset: entry rows go edge to edge (the inset moved into
      // EntryCard's own padding). Section headers re-add their own inset below.
      paddingBottom: 100,
    },
    emptyList: {
      flexGrow: 1,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 40,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 8,
    },
    emptySubtext: {
      color: colors.textFaint,
      fontSize: 14,
      textAlign: 'center',
    },
    // Empty-journal reading invitation. Quiet on purpose (an offer, not a
    // call to action): the first thing a new reader should feel invited to
    // do is write, and the guides are there if they'd rather look first.
    emptyGuidePrompt: {
      color: colors.textFaint,
      fontSize: 13,
      marginTop: 22,
      marginBottom: 8,
    },
    emptyGuideRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 8,
    },
    emptyGuideLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    emptyGuideLinkText: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '600',
    },
    // Used for the inline preset name in the pill-aware empty states.
    // Primary color ties it visually to the pill above (same color
    // ribbon: the pill is primary-bg, this is primary-fg), so the
    // reader's eye connects "the bead you pinned" to "the bead named
    // here."
    emptyTextEmphasis: {
      color: colors.primary,
      fontWeight: '700',
    },
    threadFab: {
      position: 'absolute',
      right: 24,
      bottom: 24,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
    },
    bannerRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      backgroundColor: colors.primary,
      borderRadius: 10,
      overflow: 'hidden',
    },
    bannerTapZone: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    bannerTitle: {
      color: colors.primaryOnPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    bannerMessage: {
      color: colors.primaryOnPrimary,
      fontSize: 12,
      opacity: 0.9,
      marginTop: 1,
    },
    bannerMeta: {
      color: colors.primaryOnPrimary,
      fontSize: 11,
      opacity: 0.75,
      marginTop: 2,
    },
    bannerClose: {
      paddingHorizontal: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    swipeAction: {
      // Flat full-height block to match the flat rows. The old radius +
      // bottom margin were tuned to the rounded cards-with-gaps; behind a
      // flat, square, edge-to-edge row they revealed a rounded, slightly
      // short panel. Dropping both makes the action fill the row's height
      // with square corners, so the swipe reads as part of the flat list.
      width: 96,
      backgroundColor: colors.danger,
      justifyContent: 'center',
      alignItems: 'center',
    },
    swipeActionLeft: {
      marginRight: 4,
    },
    swipeActionRight: {
      marginLeft: 4,
    },
    swipeActionComment: {
      // Override base swipeAction's danger background: comment is a
      // creative action, not a destructive one, so it gets the primary hue.
      backgroundColor: colors.primary,
    },
    swipeActionText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '600',
      marginTop: 2,
    },
  });
