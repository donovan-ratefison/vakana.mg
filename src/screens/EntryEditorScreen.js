import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  View,
  Text,
  TextInput,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
  Modal,
  Pressable,
  Dimensions,
  InteractionManager,
  Keyboard,
} from 'react-native';
import {
  useKeyboardInset,
  useKeyboardBottomOffset,
  dismissKeyboardThen,
} from '../hooks/useKeyboardHeight';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import PhotoPicker from '../components/PhotoPicker';
import VoiceRecorder from '../components/VoiceRecorder';
import BeadView from '../components/BeadView';
import BeadComposer from '../components/BeadComposer';
import AddToThreadOverlay from '../components/AddToThreadOverlay';
import ThreadCard, { loadThreadPreview } from '../components/ThreadCard';
import ThreadPickerSheet from '../components/ThreadPickerSheet';
import CommentsDrawer from '../components/CommentsDrawer';
import EditHistorySheet from '../components/EditHistorySheet';
import PeekSheet from '../components/PeekSheet';
import { readBead } from '../beads/types';
import { getDb } from '../database/db';
import { syncAutoBeadForEntry } from '../services/autoThread';
import { deleteEntries } from '../services/entries';
import { createEditHistory } from '../services/editHistory';
import { acknowledgeReminder as acknowledgeReminderById } from '../services/reminders';
import { getLatestEntryWithBead } from '../services/beadPresets';
import { exportEntryAsMarkdown } from '../services/exportEntry';
import { exportEntryAsHtml } from '../services/exportEntryHtml';
import {
  loadEntryCardData,
  captureAndShareCard,
  prepCardPhotos,
} from '../services/exportEntryCard';
import { TEMPLATES as HTML_TEMPLATES } from '../services/threadArticles';
import EntryCardForExport from '../components/EntryCardForExport';
import {
  parseDateStr,
  formatDateStr,
  formatTimeStr,
  formatTimeLabel,
} from '../utils/dateString';
import {
  countComments,
  acknowledgeFiredCommentRemindersForParent,
  PARENT_ENTRY,
} from '../services/comments';
import { useTheme } from '../theme';
import MarkdownText from '../components/MarkdownText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { warn } from '../utils/log';

const AUTOSAVE_DELAY_MS = 1000;

// Echo-walk escape: show the "back to where I started" pill once this many
// editors are stacked at/below the current one (i.e. after ~2 echo hops).
// One editor = a normal open; two = one hop (back is only 2 taps, tolerable).
const ECHO_PILL_MIN_EDITORS = 3;

const pad = (n) => n.toString().padStart(2, '0');

const formatTimestamp = (d) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
  `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

const formatMetaDate = (d) =>
  d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

// R1 echo chip: compact form ("11 Aug 2025"). The main date chip carries
// the weekday for the entry being edited; the echo chip is a back-pointer
// and a weekday on it would be noise.
const formatEchoDate = (d) =>
  d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const ECHO_LOOKUP_DELAY_MS = 300;

const parseSqliteUtc = (s) => {
  if (!s) return new Date();
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const withZ = /[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z';
  const d = new Date(withZ);
  return isNaN(d.getTime()) ? new Date() : d;
};

const ENTRY_FORMAT_META = {
  md: { label: 'Markdown', hint: 'Plain .md with YAML frontmatter.' },
  html: { label: 'HTML', hint: 'Styled page. Pick a template.' },
  card: { label: 'Card (PNG)', hint: 'Shareable image for messengers.' },
};

export default function EntryEditorScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  // Edge-to-edge nullifies adjustResize, so KeyboardAvoidingView won't shift
  // the layout on Android. We add paddingBottom to the body ScrollView so
  // the typing line stays reachable when the keyboard is up.
  const keyboardInset = useKeyboardInset();
  // Exact IME top edge, for the undo bar only. The derived inset above can
  // overshoot when safe-area and RN disagree about the nav bar (see the
  // hook's notes); on a *pinned* bar that error is a visible gap.
  const keyboardBottomOffset = useKeyboardBottomOffset();

  // Scroll the body so the current cursor sits ~80px above the keyboard.
  // Held in a ref so the keyboard-show effect can call the latest closure
  // without itself depending on content/keyboardInset (which would
  // re-fire every keystroke).
  const scrollToCursorRef = useRef(() => {});
  scrollToCursorRef.current = () => {
    const h = prevContentHeightRef.current;
    if (h <= 0 || !bodyScrollRef.current) return;
    const sel = lastSelectionRef.current;
    const ratio =
      content.length > 0 ? Math.min(1, sel.start / content.length) : 1;
    // contentInput sits at the top of the body with paddingTop:16.
    const cursorY = 16 + ratio * h;
    const windowH = Dimensions.get('window').height;
    const visibleH = Math.max(
      120,
      windowH - stickyHeaderHeight - keyboardInset
    );
    // Target: cursor lands ~80px above the keyboard top within the
    // visible band.
    const targetY = Math.max(0, cursorY - visibleH + 80);
    bodyScrollRef.current.scrollTo({ y: targetY, animated: false });
  };

  // When the keyboard finishes animating up, re-scroll using the latest
  // cursor position: onSelectionChange fired before the layout shrank.
  useEffect(() => {
    if (keyboardInset > 0) {
      // Small delay so the layout has reflected the new paddingBottom.
      const t = setTimeout(() => scrollToCursorRef.current(), 60);
      return () => clearTimeout(t);
    }
  }, [keyboardInset]);

  const initialEntryId = route.params?.entryId ?? null;
  const initialDateStr = route.params?.dateStr ?? null;
  const initialPrefillTitle = route.params?.prefillTitle ?? '';
  const initialReminderId = route.params?.reminderId ?? null;
  const initialAutoOpenComments = route.params?.autoOpenComments ?? false;
  const isEditingInitial = initialEntryId !== null && initialEntryId !== undefined;

  // Thread-walk: when opened from a thread chain, ThreadDetail passes the
  // ordered live entry ids + the thread name, so the header can offer
  // prev/next through the chain (Memory-Palace "walk the thread" brought
  // into the reading flow). Plain per-render derivation (no hook, no state)
  // from the route params + this screen's own entryId. Null when not
  // launched from a thread, when the chain has <2 beads, or when this entry
  // isn't in the passed list.
  const threadWalk = route.params?.threadWalk ?? null;
  const walk = (() => {
    const ids = Array.isArray(threadWalk?.entryIds)
      ? threadWalk.entryIds.map(Number)
      : null;
    if (!ids || ids.length < 2) return null;
    const idx = ids.indexOf(Number(initialEntryId));
    if (idx < 0) return null;
    return {
      index: idx,
      total: ids.length,
      prevId: idx > 0 ? ids[idx - 1] : null,
      nextId: idx < ids.length - 1 ? ids[idx + 1] : null,
      threadName: threadWalk.threadName || '',
    };
  })();

  const [loaded, setLoaded] = useState(!isEditingInitial);
  const [hasSaved, setHasSaved] = useState(isEditingInitial);
  const [title, setTitle] = useState(isEditingInitial ? '' : initialPrefillTitle);
  const [content, setContent] = useState('');
  const [date, setDate] = useState(
    initialDateStr ? parseDateStr(initialDateStr) : new Date()
  );
  // Optional time-of-day ('HH:MM' string) or null for date-only (default).
  // Opt-in via the time chip in the meta strip; promotes the note from
  // day-grained to moment-grained and orders same-day beads on auto-threads.
  const [time, setTime] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [bead, setBead] = useState(null);
  const [highlightTier, setHighlightTier] = useState(0);
  const [isPrivate, setIsPrivate] = useState(false);
  // Focus tracking for the private-mode mask: title is revealed only while
  // the title input is focused, content only while the content input is
  // focused. When both are blurred, both fields are masked.
  const [titleFocused, setTitleFocused] = useState(false);
  const [contentFocused, setContentFocused] = useState(false);
  // When the user taps the rendered-markdown view to resume editing, we
  // briefly drive the TextInput's `selection` prop so the cursor lands
  // where it left off (or at end-of-content on first edit). Cleared on
  // the next frame so the field returns to fully-uncontrolled.
  const [pendingSelection, setPendingSelection] = useState(null);
  // True once the content field has been focused at least this session;
  // gates whether `lastSelectionRef` carries a real cursor or just its
  // initial {0,0} placeholder. First tap-from-rendered defaults to
  // end-of-content if the user has never typed here.
  const wasContentFocusedRef = useRef(false);
  const [beadComposerVisible, setBeadComposerVisible] = useState(false);
  const [addToThreadVisible, setAddToThreadVisible] = useState(false);
  const [threadMemberships, setThreadMemberships] = useState([]);
  const [threadsSheetVisible, setThreadsSheetVisible] = useState(false);
  const [beadMenuVisible, setBeadMenuVisible] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);

  // Echo-walk escape (computed once at mount). Following the echo chip (⤺)
  // pushes a new editor per hop; deep walks make the main list N back-taps
  // away. We read the nav stack directly: the contiguous run of stacked
  // EntryEditor screens at/below this one is the dive; the first non-editor
  // below is the origin (the list / day / thread it began from). No route
  // params to thread: the stack is the source of truth, and this screen's
  // run-below is fixed for its lifetime (later hops mount new screens on top).
  const [echoWalkInfo] = useState(() => {
    try {
      const state = navigation.getState();
      const routes = state?.routes || [];
      const myIndex = state?.index ?? routes.length - 1;
      let i = myIndex;
      while (i >= 0 && routes[i]?.name === 'EntryEditor') i--;
      const origin = i >= 0 ? routes[i] : null;
      const originKind = origin?.name === 'ThreadDetail' ? 'thread' : 'list';
      return {
        editorRun: myIndex - i, // stacked editors incl. me
        popCount: i >= 0 ? myIndex - i : myIndex, // screens to pop to origin
        originKind,
        originThreadId:
          originKind === 'thread' ? origin?.params?.threadId ?? null : null,
      };
    } catch {
      return { editorRun: 1, popCount: 0, originKind: 'list', originThreadId: null };
    }
  });
  // Thread name for the pill label ("Back to «Marathon»"); fetched only when
  // the pill will actually show and the dive began from a thread.
  const [echoOriginName, setEchoOriginName] = useState(null);
  const [attachSheetVisible, setAttachSheetVisible] = useState(false);

  // Closing the attach sheet and launching a native picker activity
  // (camera, image library, document picker) in the same tick is an
  // Android race: the picker Activity is created while this RN Modal's
  // window is still attached and animating out, so it's immediately
  // cancelled and the picker resolves `{ canceled: true }`: "nothing
  // imported". (Camera only seemed to work because its first-run
  // permission dialog incidentally delayed the launch past the modal
  // dismiss.) Defer every attach action until the slide-out animation
  // has finished AND interactions are idle. Don't "simplify" this back
  // into the onPress handlers.
  const ATTACH_SHEET_ANIM_MS = 350;
  const closeAttachThen = (action) => {
    setAttachSheetVisible(false);
    setTimeout(() => {
      InteractionManager.runAfterInteractions(() => action());
    }, ATTACH_SHEET_ANIM_MS);
  };
  const [exportSheetVisible, setExportSheetVisible] = useState(false);
  // Format-first export sheet: null = format list; 'md' | 'html' | 'card'.
  const [exportFormat, setExportFormat] = useState(null);
  const [htmlTemplate, setHtmlTemplate] = useState(
    HTML_TEMPLATES[0]?.key || 'editorial'
  );
  const [cardWithNotes, setCardWithNotes] = useState(false);
  const [exportBusyLabel, setExportBusyLabel] = useState(null);
  // When non-null, an off-screen card is mounted with this data; a
  // useEffect captures it once layout settles, shares, then clears.
  const [cardExport, setCardExport] = useState(null);
  const cardRef = useRef(null);
  // The card calls this when its cover image is decoded (or immediately
  // if there's no image), signalling that view-shot is safe to fire.
  const cardReadyResolverRef = useRef(null);
  // Photo-picker step shown when the entry has 2+ photos so the user
  // can pick which one becomes the card's main polaroid.
  const [cardPhotoPicker, setCardPhotoPicker] = useState(null);
  const photoPickerRef = useRef(null);
  const voiceRecorderRef = useRef(null);
  const titleInputRef = useRef(null);
  const contentInputRef = useRef(null);
  const bodyScrollRef = useRef(null);
  // Latest measured TextInput content height (from onContentSizeChange).
  const prevContentHeightRef = useRef(0);
  // Latest selection from onSelectionChange so the keyboard-show effect
  // can re-scroll using the up-to-date cursor position.
  const lastSelectionRef = useRef({ start: 0, end: 0 });
  // Measured sticky-header height (topBar + titleBlock). Falls back to a
  // sensible default until the first layout pass reports it.
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(150);
  const [linkedThreads, setLinkedThreads] = useState([]);
  const [linkPickerVisible, setLinkPickerVisible] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  // Read-only "peek at another note" sheet. Pure UI state, deliberately NOT
  // in the auto-save dep array, since a peek mutates no entry state and must
  // never trigger a save of the draft underneath it.
  const [peekVisible, setPeekVisible] = useState(false);
  // Save-state indicator. 'idle' = nothing to report (fresh, untouched note);
  // 'dirty' = the user has unsaved edits and the debounce hasn't fired yet;
  // 'saving' = a write is in flight; 'saved' = the DB matches what's on screen.
  // An existing entry starts at 'saved' because the row on disk *is* saved:
  // opening a note must never leave the slot blank and make the user wonder.
  // We keep a visible 'dirty' state rather than an empty slot: the tester's
  // complaint was "you can't tell whether it saved", and a continuously
  // truthful readout answers that at every moment, not only on the pop.
  const [savingState, setSavingState] = useState(isEditingInitial ? 'saved' : 'idle');
  // R1 echo chip: most-recent prior entry with the same bead. Null when
  // no bead is set, the lookup hasn't fired yet, or no prior match exists.
  const [echoEntry, setEchoEntry] = useState(null);

  // Entrance pop for the 'Saved' readout (opacity + scale, native driver).
  const savedAnim = useRef(new Animated.Value(isEditingInitial ? 1 : 0)).current;

  useEffect(() => {
    if (savingState !== 'saved') return;
    savedAnim.setValue(0);
    Animated.timing(savedAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [savingState]);

  const entryIdRef = useRef(initialEntryId);
  const creationTimeRef = useRef(new Date());
  const skipNextSaveRef = useRef(false);
  const savingRef = useRef(false);
  const queuedRef = useRef(false);
  // An override handed to a save that had to queue behind an in-flight one
  // (unmount flush while the history sheet previewed) must survive the
  // re-run, or the queued save would persist the previewed buffer.
  const queuedOverrideRef = useRef(null);
  const dirtyRef = useRef(false);
  // True from a failed save until the next successful one. Drives the
  // sticky 'error' readout (a later keystroke must not repaint it as a
  // mere pending edit) and the leave-guard's "Not saved" prompt.
  const lastSaveFailedRef = useRef(false);
  // Set by the mount-only cleanup. A save that fails after the screen is
  // gone has no readout to land on, so it raises an Alert instead.
  const unmountedRef = useRef(false);
  // "Leave anyway" on the leave-guard prompt: let the re-dispatched
  // navigation action through without another save attempt.
  const leaveAnywayRef = useRef(false);
  // Cleared after the reminder is acknowledged so we only do it once.
  const pendingReminderIdRef = useRef(initialReminderId);

  // S15 undo/redo: session-only history tree over title + content (see
  // services/editHistory.js). Nodes are recorded on the same 1s pause as
  // auto-save, so history states and "Saved" states coincide. For a new
  // entry the root is seeded here; for an existing one, loadEntry seeds
  // after the row is read. historySkipRef mirrors the skipNextSaveRef
  // pattern for the capture effect: set before programmatic
  // setTitle/setContent (loadEntry, undo/redo apply) so those state
  // changes are not recorded as fresh user edits. Undo/redo apply does
  // NOT touch skipNextSaveRef: a restored state must auto-save normally.
  const historyRef = useRef(null);
  if (historyRef.current == null) {
    historyRef.current = createEditHistory();
    if (!isEditingInitial) {
      historyRef.current.reset({ title: initialPrefillTitle, content: '' });
    }
  }
  const historySkipRef = useRef(false);
  // S15 phase 2: the tree sheet. While it is up, tapping a bead previews
  // that state in the buffer WITHOUT persisting it: historyPreviewRef
  // makes save() a no-op for the duration (a pending autosave timer from
  // typing just before the sheet opened would otherwise fire mid-preview
  // and write the previewed old state over the note). preRestoreSnapshotRef
  // holds the text as it stood at open, for the revert-on-close path.
  const [historySheetVisible, setHistorySheetVisible] = useState(false);
  const historyPreviewRef = useRef(false);
  const preRestoreSnapshotRef = useRef(null);
  // Cancel handle for an open that is waiting on the keyboard to leave
  // (see openHistorySheet); cleared on fire, cancelled on unmount.
  const pendingHistoryOpenRef = useRef(null);

  useEffect(() => {
    if (isEditingInitial) loadEntry();
    // Banner-tap path: HomeScreen passes autoOpenComments when the user
    // taps a comment-reminder banner. Open the drawer once the entry is
    // loaded enough that parentId is set.
    if (initialAutoOpenComments && initialEntryId) {
      setCommentsVisible(true);
    }
  }, []);

  // Resolve the origin thread's name for the echo-walk pill label. Only when
  // the pill will show and the dive started from a thread (one cheap query).
  useEffect(() => {
    if (
      echoWalkInfo.originKind !== 'thread' ||
      echoWalkInfo.originThreadId == null ||
      echoWalkInfo.editorRun < ECHO_PILL_MIN_EDITORS
    ) {
      return;
    }
    let cancelled = false;
    (async () => {
      const db = getDb();
      if (!db) return;
      try {
        const row = await db.getFirstAsync(
          'SELECT name FROM threads WHERE id = ?',
          [echoWalkInfo.originThreadId]
        );
        if (!cancelled && row?.name) setEchoOriginName(row.name);
      } catch (e) {
        warn('EntryEditor.echoOriginName', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadEntry = async () => {
    const db = getDb();
    if (!db) return;
    const entry = await db.getFirstAsync('SELECT * FROM entries WHERE id = ?', [
      initialEntryId,
    ]);
    if (!entry) {
      setLoaded(true);
      return;
    }

    creationTimeRef.current = parseSqliteUtc(entry.created_at);

    const photoRows = await db.getAllAsync(
      'SELECT uri FROM entry_photos WHERE entry_id = ?',
      [initialEntryId]
    );
    const voiceRows = await db.getAllAsync(
      'SELECT uri, duration FROM entry_voice_notes WHERE entry_id = ?',
      [initialEntryId]
    );
    const linkRows = await db.getAllAsync(
      `SELECT t.id, t.name, t.updated_at
         FROM entry_thread_links l
         JOIN threads t ON t.id = l.thread_id
         WHERE l.entry_id = ?
         ORDER BY l.position ASC`,
      [initialEntryId]
    );
    const linkedWithPreview = await Promise.all(
      linkRows.map(async (t) => ({
        ...t,
        preview: await loadThreadPreview(db, t.id),
      }))
    );

    skipNextSaveRef.current = true;
    historySkipRef.current = true;
    historyRef.current.reset({
      title: entry.title || '',
      content: entry.content || '',
    });
    setTitle(entry.title || '');
    setContent(entry.content || '');
    setDate(parseDateStr(entry.date));
    setTime(entry.time || null);
    setPhotos(photoRows.map((p) => p.uri));
    setRecordings(voiceRows.map((v) => ({ uri: v.uri, duration: v.duration })));
    setBead(readBead(entry));
    setHighlightTier(Number(entry.highlight_tier ?? 0) || 0);
    setIsPrivate(!!entry.is_private);
    setLinkedThreads(linkedWithPreview);
    setLoaded(true);
    loadThreadMemberships(initialEntryId);
    refreshCommentCount(initialEntryId);
  };

  const refreshCommentCount = async (entryId) => {
    if (!entryId) {
      setCommentCount(0);
      return;
    }
    const n = await countComments(PARENT_ENTRY, entryId);
    setCommentCount(n);
  };

  const loadThreadMemberships = async (entryId) => {
    if (!entryId) {
      setThreadMemberships([]);
      return;
    }
    const db = getDb();
    if (!db) return;
    // DISTINCT: a thread that holds this entry at multiple positions should
    // still count as one membership, not several.
    const rows = await db.getAllAsync(
      `SELECT DISTINCT t.id, t.name, t.updated_at FROM threads t
       JOIN thread_beads tb ON tb.thread_id = t.id
       WHERE tb.entry_id = ?
       ORDER BY t.updated_at DESC`,
      [entryId]
    );
    setThreadMemberships(rows);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (entryIdRef.current) loadThreadMemberships(entryIdRef.current);
      refreshLinkedPreviews();
    });
    return unsubscribe;
  }, [navigation]);

  const refreshLinkedPreviews = async () => {
    const db = getDb();
    if (!db) return;
    setLinkedThreads((prev) => {
      if (prev.length === 0) return prev;
      // Refresh previews in-place; the linked-thread set itself is owned by
      // local state (the user's picks), not the DB until we save.
      Promise.all(
        prev.map(async (t) => ({
          ...t,
          preview: await loadThreadPreview(db, t.id),
        }))
      ).then((updated) => {
        skipNextSaveRef.current = true;
        setLinkedThreads(updated);
      });
      return prev;
    });
  };

  // `opts.force` materializes a row even when the entry is otherwise
  // empty (no title/content/photos/etc). Adding a photo to a not-yet-
  // saved note needs the row to exist *before* the entry_photos INSERT,
  // but at that point `photos` state is still empty (setPhotos runs
  // after the insert), so the normal empty-guard would no-op and the
  // import would silently drop. Callers that already drain in-flight
  // saves use this; default callers keep the old no-op-when-empty.
  const save = async (opts) => {
    const force = opts?.force === true;
    // History-sheet preview must never persist: while the sheet is up the
    // buffer holds whatever bead was tapped, and any save that fires in
    // that window (pending debounce timer, unmount flush) would write the
    // previewed state over the note. Restore/close clear the flag and
    // re-trigger the save path themselves.
    if (historyPreviewRef.current) return;
    if (savingRef.current) {
      queuedRef.current = true;
      if (opts?.override) queuedOverrideRef.current = opts.override;
      return;
    }

    // `opts.override` swaps the text this save persists. It is used only by the
    // unmount flush when the history sheet was previewing: the buffer then
    // holds a previewed state and the pre-open text is what must land.
    const liveTitle = opts?.override?.title ?? title;
    const liveContent = opts?.override?.content ?? content;
    const trimmedTitle = liveTitle.trim();
    const trimmedContent = liveContent.trim();
    // A title that is still exactly the reminder-prefilled value, with
    // nothing else added, is not real content. Counting it let a curiosity
    // tap (banner / "Write entry") mint a titled-but-empty note. Treat that
    // as empty so an abandoned reminder entry is never persisted (the same
    // no-op as the all-empty case). Once the user types anything, the
    // prefilled title is still saved exactly as before.
    const prefill = initialPrefillTitle.trim();
    const titleIsRealContent =
      trimmedTitle.length > 0 && trimmedTitle !== prefill;
    const hasAnything =
      titleIsRealContent ||
      trimmedContent.length > 0 ||
      photos.length > 0 ||
      recordings.length > 0 ||
      linkedThreads.length > 0 ||
      Boolean(bead);

    if (!hasAnything && entryIdRef.current == null && !force) {
      // Nothing to persist and no row exists: the honest readout is silence.
      // Nothing can be lost either, so an earlier failure is moot.
      lastSaveFailedRef.current = false;
      setSavingState('idle');
      return;
    }

    savingRef.current = true;
    dirtyRef.current = false;
    setSavingState('saving');

    try {
      const db = getDb();
      if (!db) throw new Error('database not ready');

      const dateStr = formatDateStr(date);
      const draftTitle = `Draft ${formatTimestamp(creationTimeRef.current)}`;
      const titleToSave = trimmedTitle || draftTitle;

      let id = entryIdRef.current;

      const beadShape = bead?.shape ?? null;
      const beadPattern = bead?.pattern ?? null;
      const beadMood = bead?.mood ?? null;
      const beadGlyph = bead?.glyph ?? null;

      const timeToSave = time || null;

      // One transaction per save: the row write and the wholesale
      // delete+reinsert of attachments/links commit together, so a crash
      // mid-save can never leave an entry stripped of its photos. Also
      // collapses ~3+2N commits (WAL fsyncs) into one on the hottest
      // write path. entryIdRef/hasSaved are only updated after commit:
      // a rollback must not leave the ref pointing at a row that was
      // never persisted (later saves would UPDATE nothing, silently).
      const isFirstSave = id == null;
      await db.withTransactionAsync(async () => {
        if (isFirstSave) {
          const result = await db.runAsync(
            `INSERT INTO entries
               (title, content, date, time, bead_shape, bead_pattern, bead_mood, bead_glyph, highlight_tier, is_private)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [titleToSave, trimmedContent, dateStr, timeToSave, beadShape, beadPattern, beadMood, beadGlyph, highlightTier, isPrivate ? 1 : 0]
          );
          id = result.lastInsertRowId;
        } else {
          await db.runAsync(
            `UPDATE entries
               SET title = ?, content = ?, date = ?, time = ?,
                   bead_shape = ?, bead_pattern = ?, bead_mood = ?, bead_glyph = ?,
                   highlight_tier = ?, is_private = ?,
                   updated_at = datetime('now')
             WHERE id = ?`,
            [titleToSave, trimmedContent, dateStr, timeToSave, beadShape, beadPattern, beadMood, beadGlyph, highlightTier, isPrivate ? 1 : 0, id]
          );
          await db.runAsync('DELETE FROM entry_photos WHERE entry_id = ?', [id]);
          await db.runAsync('DELETE FROM entry_voice_notes WHERE entry_id = ?', [id]);
          await db.runAsync('DELETE FROM entry_thread_links WHERE entry_id = ?', [id]);
        }

        for (const uri of photos) {
          await db.runAsync(
            'INSERT INTO entry_photos (entry_id, uri) VALUES (?, ?)',
            [id, uri]
          );
        }
        for (const rec of recordings) {
          await db.runAsync(
            'INSERT INTO entry_voice_notes (entry_id, uri, duration) VALUES (?, ?, ?)',
            [id, rec.uri, rec.duration]
          );
        }
        for (let i = 0; i < linkedThreads.length; i++) {
          await db.runAsync(
            'INSERT INTO entry_thread_links (entry_id, thread_id, position) VALUES (?, ?, ?)',
            [id, linkedThreads[i].id, i]
          );
        }
      });
      if (isFirstSave) {
        entryIdRef.current = id;
        setHasSaved(true);
      }

      // N11 + N20: keep auto-thread snapshots in sync (day always; week if
      // tier ≥ 1; month if tier ≥ 2). Idempotent: handles date and tier
      // changes by detaching from every auto-thread first.
      await syncAutoBeadForEntry({
        id,
        date: dateStr,
        bead_shape: beadShape,
        bead_pattern: beadPattern,
        bead_mood: beadMood,
        bead_glyph: beadGlyph,
        highlight_tier: highlightTier,
      });

      // N15: editing the parent body counts as content engagement →
      // any fired comment-reminders on this entry clear.
      await acknowledgeFiredCommentRemindersForParent(PARENT_ENTRY, id);

      lastSaveFailedRef.current = false;
      setSavingState('saved');

      // If this entry was opened from a reminder banner, acknowledge that
      // reminder the first time the user's content is non-empty. The title
      // is prefilled from the reminder, so we gate on the body specifically.
      // Recurrence-aware: a recurring series advances the cursor instead of
      // just setting acknowledged_at.
      if (pendingReminderIdRef.current && trimmedContent.length > 0) {
        const rid = pendingReminderIdRef.current;
        pendingReminderIdRef.current = null;
        try {
          await acknowledgeReminderById(rid);
        } catch (e) {
          console.warn('Reminder acknowledge failed:', e?.message || e);
        }
      }
    } catch (err) {
      console.error('Auto-save failed:', err?.message || err, err);
      // The edits are still only in memory. Say so in a state of its own
      // ('dirty' looks exactly like a pending debounce) and re-arm dirtyRef
      // (cleared at the top of this save) so the next debounce, the
      // leave-guard and the unmount flush all retry instead of dropping it.
      lastSaveFailedRef.current = true;
      dirtyRef.current = true;
      setSavingState('error');
      if (unmountedRef.current && !queuedRef.current) {
        // Final flush from a screen that is already gone (auto-lock, deep
        // link): no readout left to show it, so ask. The retry reuses the
        // same opts, so a history-preview override still lands the
        // pre-open text. Skipped when a queued re-run is about to try
        // again anyway (its own failure will ask).
        Alert.alert(
          'Note not saved',
          'Your latest changes to this note could not be saved.',
          [
            { text: 'Discard', style: 'destructive' },
            { text: 'Retry', onPress: () => saveRef.current(opts) },
          ]
        );
      }
    } finally {
      savingRef.current = false;
      if (queuedRef.current) {
        queuedRef.current = false;
        const override = queuedOverrideRef.current;
        queuedOverrideRef.current = null;
        save(override ? { override } : undefined);
      }
    }
  };

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!loaded) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    dirtyRef.current = true;
    // Display-only guard: this effect also runs once at mount for a fresh
    // note, and a blank note has nothing to report: the slot stays empty
    // until there is real content (or a row already exists on disk). The
    // scheduling below is unconditional, exactly as before.
    const editorHasContent =
      hasSaved ||
      (title.trim().length > 0 && title.trim() !== initialPrefillTitle.trim()) ||
      content.trim().length > 0 ||
      photos.length > 0 ||
      recordings.length > 0 ||
      linkedThreads.length > 0 ||
      Boolean(bead);
    // A failed save stays visible as 'error' until a save succeeds: more
    // typing must not repaint it as an ordinary pending edit. The debounce
    // below is the retry.
    setSavingState(
      lastSaveFailedRef.current ? 'error' : editorHasContent ? 'dirty' : 'idle'
    );
    const timer = setTimeout(() => saveRef.current(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [title, content, date, time, photos, recordings, bead, highlightTier, isPrivate, linkedThreads, loaded]);

  // S15 history capture: a node per typing pause, on the same debounce as
  // auto-save so history states and "Saved" states are the same states.
  // Fires only for title/content (attachments, bead, tier etc. are outside
  // undo's scope). An undo/redo apply or loadEntry's setters arrive with
  // historySkipRef set and are not re-recorded; their cleanup still cancels
  // any pending capture from earlier typing (that tail is instead recorded
  // by undo/redo themselves: the uncaptured-tail rule in editHistory).
  useEffect(() => {
    if (!loaded) return;
    if (historySkipRef.current) {
      historySkipRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      historyRef.current.record({ title, content });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [title, content, loaded]);

  // Undo/redo land in state like any edit: the auto-save effect persists
  // the restored text through the normal debounce. `undo`/`redo` always
  // return a snapshot that differs from the live buffer (adjacent
  // duplicates are never recorded), so the setters below always re-render
  // and the capture effect reliably consumes historySkipRef.
  const applyHistorySnapshot = (snap) => {
    if (!snap) return;
    historySkipRef.current = true;
    setTitle(snap.title);
    setContent(snap.content);
  };
  const handleUndo = () =>
    applyHistorySnapshot(historyRef.current.undo({ title, content }));
  const handleRedo = () =>
    applyHistorySnapshot(historyRef.current.redo({ title, content }));

  // --- S15 phase 2: the tree sheet -------------------------------------
  // Open: record the live tail (so the buffer state IS the current node and
  // every bead in the sheet is a real, previewable state), dismiss the
  // keyboard, and only once the IME has actually left the screen freeze the
  // save pipeline and show the sheet. The wait is not cosmetic: a dialog
  // created while the IME hide is still animating can be sized against a
  // transient garbage inset and land below the screen (v0.88.4, see
  // `dismissKeyboardThen`). The freeze is set in the same tick the sheet is
  // shown so no path can leave it set without a sheet to close; the unmount
  // cleanup is the last line of defence.
  const openHistorySheet = () => {
    if (pendingHistoryOpenRef.current || historySheetVisible) return;
    historyRef.current.record({ title, content });
    preRestoreSnapshotRef.current = { title, content };
    pendingHistoryOpenRef.current = dismissKeyboardThen(
      () => {
        pendingHistoryOpenRef.current = null;
        historyPreviewRef.current = true;
        setHistorySheetVisible(true);
      },
      { keyboardUp: keyboardBottomOffset > 0 }
    );
  };

  // Preview: swap the buffer without saving and without recording. Both
  // guards are set, and the equality check keeps a same-state tap from setting
  // guards that no setter run would ever consume.
  const previewHistorySnapshot = (snap) => {
    if (!snap) return;
    if (snap.title === title && snap.content === content) return;
    skipNextSaveRef.current = true;
    historySkipRef.current = true;
    setTitle(snap.title);
    setContent(snap.content);
  };

  // Restore: move the pointer, unfreeze saves, and make sure the restored
  // text lands on disk. If the buffer already shows the target (it was
  // previewed), the setters would no-op, so save directly instead. The
  // closure state at this render is exactly the previewed text.
  const restoreFromHistory = (nodeId) => {
    const snap = historyRef.current.jumpTo(nodeId);
    setHistorySheetVisible(false);
    historyPreviewRef.current = false;
    if (!snap) return;
    if (snap.title !== title || snap.content !== content) {
      historySkipRef.current = true;
      setTitle(snap.title);
      setContent(snap.content);
    } else {
      dirtyRef.current = true;
      saveRef.current();
    }
  };

  // Close without restoring: put the pre-open text back. The revert flows
  // through the normal save effect deliberately (only the history capture
  // is skipped): saving the pre-open text again is idempotent, and it also
  // flushes any tail-save the preview freeze swallowed. Never call
  // saveRef.current() directly from the revert branch: this render's
  // closure still holds the previewed text.
  const closeHistorySheet = () => {
    setHistorySheetVisible(false);
    historyPreviewRef.current = false;
    const pre = preRestoreSnapshotRef.current;
    if (pre && (pre.title !== title || pre.content !== content)) {
      historySkipRef.current = true;
      setTitle(pre.title);
      setContent(pre.content);
    } else if (dirtyRef.current) {
      // Nothing was previewed; the closure text equals the pre-open text,
      // so a direct flush of the swallowed tail-save is safe here.
      saveRef.current();
    }
  };

  // R1 echo lookup: only bead-facet or date changes trigger it (typing
  // in title/body must not). Date is load-bearing because the chip walks
  // strictly backward in time from this entry's locus: shift the date
  // and the "previous occurrence" answer shifts too. Debounced 300ms
  // because BeadComposer can fire facet-set events rapidly while the
  // user is composing. Gated on `loaded` so the initial load's bead
  // setter doesn't flash a stale chip before loadEntry finishes.
  useEffect(() => {
    if (!loaded) return;
    if (!bead || !bead.shape) {
      setEchoEntry(null);
      return;
    }
    let cancelled = false;
    const snapshot = {
      shape: bead.shape,
      pattern: bead.pattern,
      mood: bead.mood,
      glyph: bead.glyph,
    };
    // `date` in editor state is a JS Date; the DB column is a
    // 'YYYY-MM-DD' string, so the cursor must be formatted to that shape.
    // Pass a Date raw and SQLite stringifies it to "Thu May 28 2026 …",
    // which sorts AFTER every '2026-…' row and makes the strictly-older
    // filter match every row (including self).
    const before = { entryId: entryIdRef.current, date: formatDateStr(date) };
    const timer = setTimeout(async () => {
      try {
        const row = await getLatestEntryWithBead(snapshot, before);
        if (!cancelled) setEchoEntry(row);
      } catch (e) {
        if (!cancelled) setEchoEntry(null);
      }
    }, ECHO_LOOKUP_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bead?.shape, bead?.pattern, bead?.mood, bead?.glyph, date, loaded]);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      // A history open still waiting on the keyboard must not fire into a
      // dead screen.
      pendingHistoryOpenRef.current?.();
      pendingHistoryOpenRef.current = null;
      if (historyPreviewRef.current) {
        // Unmounted with the sheet up (auto-lock, deep link): the buffer may
        // hold a previewed state and save() is frozen. Lift the freeze and
        // persist the pre-open text (never the preview) so no tail typed
        // before the open is lost and no previewed state lands on disk.
        historyPreviewRef.current = false;
        const pre = preRestoreSnapshotRef.current;
        dirtyRef.current = true;
        saveRef.current(pre ? { override: pre } : undefined);
        return;
      }
      if (dirtyRef.current) {
        saveRef.current();
      }
    };
  }, []);

  // Block any back-style navigation (chevron, OS back, gesture) until any
  // in-flight save settles and any pending dirty state is flushed. Without
  // this, the upstream screen's `focus` listener (e.g. ThreadDetail's
  // `load()`) can race the editor's UPDATE and re-render with stale beads
  // from the JOIN. preventDefault → await save → dispatch the original
  // action; the dispatch re-fires `beforeRemove` but both refs are clear
  // by then, so it falls through.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (leaveAnywayRef.current) return;
      if (!dirtyRef.current && !savingRef.current) return;
      e.preventDefault();
      (async () => {
        while (savingRef.current) {
          await new Promise((r) => setTimeout(r, 50));
        }
        if (dirtyRef.current) {
          await saveRef.current();
          // A queued re-run may still be settling.
          while (savingRef.current) {
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        if (lastSaveFailedRef.current) {
          // The flush failed: dirtyRef is re-armed, so re-dispatching would
          // loop through this guard forever, and leaving silently would
          // drop the edits. Keep the user here with the 'error' readout and
          // let them choose.
          Alert.alert(
            'Note not saved',
            'Your latest changes could not be saved. If you leave now, you will lose them.',
            [
              { text: 'Stay', style: 'cancel' },
              {
                text: 'Leave anyway',
                style: 'destructive',
                onPress: () => {
                  leaveAnywayRef.current = true;
                  // Accepted loss: the unmount flush must not retry and
                  // raise a second prompt.
                  dirtyRef.current = false;
                  navigation.dispatch(e.data.action);
                },
              },
            ]
          );
          return;
        }
        navigation.dispatch(e.data.action);
      })();
    });
    return sub;
  }, [navigation]);

  const deleteEntry = () => {
    if (!hasSaved || entryIdRef.current == null) {
      navigation.goBack();
      return;
    }

    Alert.alert('Delete Entry', 'Do you want to delete this entry?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          dirtyRef.current = false;
          // Auto-bead strip (the FK is SET NULL, not CASCADE, so no orphan
          // auto-bead snapshots) + comment cascade (polymorphic, no FK) +
          // row delete, all in one transaction (services/entries.js).
          await deleteEntries([entryIdRef.current]);
          navigation.goBack();
        },
      },
    ]);
  };

  // Walk to the previous/next bead in the thread. Persist the entry we're
  // leaving first (mirrors flushAndEnsureEntry's drain) so the chain we came
  // from and the next bead both read fresh state; once the refs are clear the
  // `beforeRemove` guard no-ops, so the replace proceeds without a double
  // flush. `replace` (not push) keeps the stack flat: system-back always
  // returns to the thread, and each bead mounts a fresh editor (clean
  // save/load lifecycle) rather than swapping entryId in place.
  const walkTo = async (targetId) => {
    if (targetId == null) return;
    if (savingRef.current) {
      while (savingRef.current) {
        await new Promise((r) => setTimeout(r, 50));
      }
    } else if (dirtyRef.current) {
      await saveRef.current();
    }
    navigation.replace('EntryEditor', { entryId: targetId, threadWalk });
  };

  // Echo-walk escape: pop the whole stacked editor run in one tap, landing on
  // the surface the dive began from. Drain first (mirrors walkTo) so the
  // beforeRemove save-guard no-ops and the multi-pop doesn't race the autosave.
  const exitEchoWalk = async () => {
    if (savingRef.current) {
      while (savingRef.current) {
        await new Promise((r) => setTimeout(r, 50));
      }
    } else if (dirtyRef.current) {
      await saveRef.current();
    }
    if (echoWalkInfo.popCount > 0) navigation.pop(echoWalkInfo.popCount);
    else navigation.goBack();
  };

  const echoExitVisible =
    echoWalkInfo.editorRun >= ECHO_PILL_MIN_EDITORS && keyboardInset === 0;
  const echoExitLabel =
    echoWalkInfo.originKind === 'thread'
      ? echoOriginName
        ? `Back to ${echoOriginName}`
        : 'Back to thread'
      : 'Back to list';

  const savingLabel =
    savingState === 'saving'
      ? 'Saving…'
      : savingState === 'saved'
      ? 'Saved'
      : savingState === 'dirty'
      ? 'Editing…'
      : savingState === 'error'
      ? 'Not saved. Tap to retry.'
      : '';
  const savingIcon =
    savingState === 'saving'
      ? 'sync-outline'
      : savingState === 'saved'
      ? 'checkmark-circle'
      : savingState === 'dirty'
      ? 'pencil-outline'
      : savingState === 'error'
      ? 'alert-circle-outline'
      : null;

  // Tap-to-retry on the 'error' readout. dirtyRef is already re-armed by
  // the failed save; set it again so a retry is never a no-op.
  const retrySave = () => {
    dirtyRef.current = true;
    saveRef.current();
  };

  const openAddToThread = async () => {
    // The note must exist in the DB before its bead can join a thread.
    // If autosave hasn't fired yet (fresh note), flush now and wait.
    if (!entryIdRef.current) {
      await saveRef.current();
    }
    if (entryIdRef.current) setAddToThreadVisible(true);
  };

  const showBeadMenu = () => {
    if (!bead) return;
    setBeadMenuVisible(true);
  };

  const handleBeadEdit = () => {
    setBeadMenuVisible(false);
    setBeadComposerVisible(true);
  };

  const handleBeadAddToThread = () => {
    setBeadMenuVisible(false);
    openAddToThread();
  };

  const handleBeadRemove = () => {
    setBeadMenuVisible(false);
    setBead(null);
    dirtyRef.current = true;
  };

  const showAllThreads = () => setThreadsSheetVisible(true);

  const openThreadFromSheet = (threadId) => {
    setThreadsSheetVisible(false);
    navigation.navigate('ThreadDetail', { threadId });
  };

  const handleLinkThread = (thread) => {
    setLinkPickerVisible(false);
    setLinkedThreads((prev) => {
      if (prev.some((t) => Number(t.id) === Number(thread.id))) return prev;
      return [...prev, thread];
    });
  };

  const handleUnlinkThread = (threadId) => {
    setLinkedThreads((prev) =>
      prev.filter((t) => Number(t.id) !== Number(threadId))
    );
  };

  const openLinkedThread = (threadId) => {
    navigation.navigate('ThreadDetail', { threadId });
  };

  // Direct-insert path for picker additions. The default debounced save
  // route is fragile here: expo-image-picker re-encoding can take 5–10s on
  // a fresh import, so by the time the auto-save fires the user may have
  // already navigated back. Persist the URIs straight into entry_photos
  // the moment they're available. If a row needs creating first we ride
  // through the existing save() to materialize the entry id.
  const handleAddPhotos = async (newUris) => {
    if (!Array.isArray(newUris) || newUris.length === 0) return;
    if (!entryIdRef.current) {
      // Drain any in-flight save first so the forced save below isn't
      // shunted into the queued path (which would re-run unforced and
      // no-op on a still-empty entry, dropping the import).
      while (savingRef.current) {
        await new Promise((r) => setTimeout(r, 50));
      }
      // force: the entry has no title/content yet and `photos` state is
      // still empty here, so a normal save() would no-op and never mint
      // a row, leaving nothing to attach the photos to.
      await saveRef.current({ force: true });
    }
    if (!entryIdRef.current) return;
    const db = getDb();
    if (!db) return;
    for (const uri of newUris) {
      await db.runAsync(
        'INSERT INTO entry_photos (entry_id, uri) VALUES (?, ?)',
        [entryIdRef.current, uri]
      );
    }
    // Reflect the new URIs in local state so the grid shows them. Skip
    // the resulting auto-save: it would DELETE all entry_photos rows and
    // re-INSERT from state: same final rows, wasted writes.
    skipNextSaveRef.current = true;
    setPhotos((prev) => [...prev, ...newUris]);
  };

  // Make sure the latest edits are on disk before reading from SQLite.
  // savingRef serializes: if a save is in flight, await it; otherwise
  // call save() directly to flush whatever's pending.
  const flushAndEnsureEntry = async () => {
    if (savingRef.current) {
      while (savingRef.current) {
        await new Promise((r) => setTimeout(r, 50));
      }
    } else if (dirtyRef.current) {
      await saveRef.current();
    }
    if (!entryIdRef.current) {
      Alert.alert('Nothing to export', 'Write a title or some content first.');
      return false;
    }
    return true;
  };

  const handleExportMd = async () => {
    setExportSheetVisible(false);
    if (!(await flushAndEnsureEntry())) return;
    setExportBusyLabel('Preparing Markdown…');
    try {
      await exportEntryAsMarkdown(entryIdRef.current);
    } catch (e) {
      Alert.alert('Export failed', e?.message || String(e));
    } finally {
      setExportBusyLabel(null);
    }
  };

  const handleExportHtml = async (template) => {
    setExportSheetVisible(false);
    if (!(await flushAndEnsureEntry())) return;
    setExportBusyLabel('Preparing HTML…');
    try {
      await exportEntryAsHtml(entryIdRef.current, template);
    } catch (e) {
      Alert.alert('Export failed', e?.message || String(e));
    } finally {
      setExportBusyLabel(null);
    }
  };

  const handleExportCard = async (withNotes) => {
    setExportSheetVisible(false);
    if (!(await flushAndEnsureEntry())) return;
    setExportBusyLabel('Loading photos…');
    try {
      const data = await loadEntryCardData(entryIdRef.current);
      if (data.photoUris.length > 1) {
        // Multiple photos: ask the user which one is the hero before
        // we build the card. (Pre-resize happens after the pick so we
        // don't burn manipulator cycles on photos the user might not
        // even include.)
        setExportBusyLabel(null);
        setCardPhotoPicker({ withNotes, data });
        return;
      }
      setExportBusyLabel('Preparing card…');
      const preppedUris = await prepCardPhotos(data.photoUris);
      setCardExport({
        withNotes,
        data: { ...data, photoUris: preppedUris },
        mainPhotoIndex: 0,
      });
    } catch (e) {
      setExportBusyLabel(null);
      Alert.alert('Export failed', e?.message || String(e));
    }
  };

  // Final action on a format's detail panel (entry exports are
  // share-only: no save-to-device path exists for entries).
  const runEntryExport = () => {
    if (exportFormat === 'md') handleExportMd();
    else if (exportFormat === 'html') handleExportHtml(htmlTemplate);
    else if (exportFormat === 'card') handleExportCard(cardWithNotes);
  };

  const handlePickMainPhoto = async (mainPhotoIndex) => {
    const picker = cardPhotoPicker;
    if (!picker) return;
    setCardPhotoPicker(null);
    setExportBusyLabel('Preparing card…');
    try {
      const preppedUris = await prepCardPhotos(picker.data.photoUris);
      setCardExport({
        withNotes: picker.withNotes,
        data: { ...picker.data, photoUris: preppedUris },
        mainPhotoIndex,
      });
    } catch (e) {
      setExportBusyLabel(null);
      Alert.alert('Export failed', e?.message || String(e));
    }
  };

  useEffect(() => {
    if (!cardExport) return undefined;
    let cancelled = false;
    const ready = new Promise((resolve) => {
      cardReadyResolverRef.current = resolve;
    });
    // Hard cap: if onReady never fires (e.g., Image silently stalls)
    // we still go ahead so the user isn't stuck on the busy overlay.
    const timeout = new Promise((resolve) => setTimeout(resolve, 2000));
    const run = async () => {
      await Promise.race([ready, timeout]);
      // Two frames after ready so paint commits before view-shot reads
      // the native view's bounds.
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      if (cancelled) return;
      try {
        await captureAndShareCard(
          cardRef,
          cardExport.data.entry,
          cardExport.withNotes
        );
      } catch (e) {
        if (!cancelled) Alert.alert('Export failed', e?.message || String(e));
      } finally {
        if (!cancelled) {
          setExportBusyLabel(null);
          setCardExport(null);
          cardReadyResolverRef.current = null;
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [cardExport]);


  if (!loaded) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // S15 accessory bar: exists only while the keyboard is up for one of the
  // two text fields (the moment mistakes happen), zero chrome otherwise.
  // The focus gate keeps it from ghosting under Modal-owned keyboards
  // (comments drawer, sheets). Enabled-state is derived per render from
  // the live buffer: text typed inside the current debounce window already
  // counts as undoable (the uncaptured-tail rule records it on demand).
  const undoBarVisible =
    keyboardBottomOffset > 0 && (titleFocused || contentFocused);
  const canUndo =
    undoBarVisible && historyRef.current.canUndo({ title, content });
  const canRedo =
    undoBarVisible && historyRef.current.canRedo({ title, content });
  // The tree is worth opening once there is more than one state to stand
  // on: recorded nodes, or a live tail that opening would record.
  const canOpenHistory =
    undoBarVisible && (historyRef.current.size() > 1 || canUndo);

  return (
    <View style={styles.container}>
      <View
        style={styles.stickyHeader}
        onLayout={(e) => {
          const h = e?.nativeEvent?.layout?.height;
          if (h && Math.abs(h - stickyHeaderHeight) > 1) {
            setStickyHeaderHeight(h);
          }
        }}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.iconWrap}
            accessibilityLabel="Back"
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={22} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.savingStatus}
            accessibilityLiveRegion="polite"
            accessibilityLabel={
              savingState === 'error'
                ? 'Not saved. Double-tap to retry saving.'
                : savingLabel
            }
            accessibilityRole={savingState === 'error' ? 'button' : undefined}
            disabled={savingState !== 'error'}
            onPress={retrySave}
            hitSlop={8}
          >
            {savingIcon ? (
              <Animated.View
                style={[
                  styles.savingStatusInner,
                  savingState === 'saved'
                    ? {
                        opacity: savedAnim,
                        transform: [
                          {
                            scale: savedAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.8, 1],
                            }),
                          },
                        ],
                      }
                    : null,
                ]}
              >
                <Ionicons
                  name={savingIcon}
                  size={14}
                  color={
                    savingState === 'saved'
                      ? colors.primary
                      : savingState === 'error'
                      ? colors.danger
                      : colors.textMuted
                  }
                />
                <Text
                  style={[
                    styles.savingLabel,
                    savingState === 'error' ? styles.savingLabelError : null,
                  ]}
                  numberOfLines={1}
                >
                  {savingLabel}
                </Text>
              </Animated.View>
            ) : null}
          </TouchableOpacity>
          <View style={styles.topBarRight}>
            <TouchableOpacity
              onPress={() => setAttachSheetVisible(true)}
              style={styles.iconWrap}
              accessibilityLabel="Attach photo, voice note, or mention"
              hitSlop={8}
            >
              <Ionicons name="add" size={22} color={colors.primary} />
            </TouchableOpacity>
            {hasSaved ? (
              <TouchableOpacity
                onPress={() => setCommentsVisible(true)}
                style={styles.commentsChip}
                accessibilityLabel={`${commentCount} comment${commentCount === 1 ? '' : 's'}. Tap to open.`}
                hitSlop={6}
              >
                <Ionicons
                  name="chatbubble-outline"
                  size={14}
                  color={colors.primary}
                />
                {commentCount > 0 ? (
                  <Text style={styles.commentsChipText}>{commentCount}</Text>
                ) : null}
              </TouchableOpacity>
            ) : null}
            {hasSaved ? (
              <TouchableOpacity
                onPress={() => {
                  setExportFormat(null);
                  setExportSheetVisible(true);
                }}
                style={styles.iconWrap}
                accessibilityLabel="Export entry"
                hitSlop={8}
              >
                <Ionicons
                  name="share-outline"
                  size={20}
                  color={colors.textFaint}
                />
              </TouchableOpacity>
            ) : null}
            {hasSaved ? (
              <TouchableOpacity
                onPress={deleteEntry}
                style={styles.iconWrap}
                accessibilityLabel="Delete entry"
                hitSlop={8}
              >
                <Ionicons name="trash-outline" size={20} color={colors.textFaint} />
              </TouchableOpacity>
            ) : (
              <View style={styles.iconWrap} />
            )}
          </View>
        </View>

        {walk ? (
          <View style={styles.walkBar}>
            <TouchableOpacity
              style={styles.walkBtn}
              onPress={() => walkTo(walk.prevId)}
              disabled={walk.prevId == null}
              accessibilityLabel="Previous bead in this thread"
              hitSlop={6}
            >
              <Ionicons
                name="chevron-back"
                size={16}
                color={walk.prevId == null ? colors.textFaint : colors.primary}
              />
              <Text
                style={[
                  styles.walkBtnText,
                  walk.prevId == null && styles.walkBtnTextDisabled,
                ]}
              >
                Prev
              </Text>
            </TouchableOpacity>
            <Text style={styles.walkLabel} numberOfLines={1}>
              {walk.index + 1} / {walk.total}
              {walk.threadName ? ` · ${walk.threadName}` : ''}
            </Text>
            <TouchableOpacity
              style={styles.walkBtn}
              onPress={() => walkTo(walk.nextId)}
              disabled={walk.nextId == null}
              accessibilityLabel="Next bead in this thread"
              hitSlop={6}
            >
              <Text
                style={[
                  styles.walkBtnText,
                  walk.nextId == null && styles.walkBtnTextDisabled,
                ]}
              >
                Next
              </Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={walk.nextId == null ? colors.textFaint : colors.primary}
              />
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.titleBlock}>
          {bead ? (
            <TouchableOpacity
              onPress={() => setBeadComposerVisible(true)}
              onLongPress={showBeadMenu}
              accessibilityLabel="Edit bead. Long-press for more actions."
              hitSlop={8}
            >
              <BeadView bead={bead} size={40} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => setBeadComposerVisible(true)}
              style={styles.beadPlaceholder}
              accessibilityLabel="Make a bead"
              hitSlop={8}
            >
              <Ionicons name="aperture-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          )}
          <View style={styles.titleBlockBody}>
            <View style={styles.maskWrapper}>
              <TextInput
                ref={titleInputRef}
                style={styles.titleInput}
                placeholder="Title"
                placeholderTextColor={colors.textFaint}
                value={title}
                onChangeText={setTitle}
                onFocus={() => setTitleFocused(true)}
                onBlur={() => setTitleFocused(false)}
                maxLength={200}
              />
              {isPrivate && !titleFocused ? (
                <TouchableOpacity
                  style={styles.titleMaskOverlay}
                  onPress={() => titleInputRef.current?.focus()}
                  activeOpacity={0.85}
                  accessibilityLabel="Title is masked. Tap to reveal and edit."
                >
                  <Ionicons
                    name="lock-closed"
                    size={14}
                    color={colors.textMuted}
                  />
                  <Text style={styles.titleMaskText}>Tap to edit title</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={styles.metaStrip}>
              {/* Date + optional time read as one chip. Date tap → date
                  picker (one tap, unchanged). The clock glyph is the entire
                  time affordance: faint when unset (tap to add), primary when
                  set (tap to edit), with an × to clear. No separate strip
                  chip: an entry without a time gains only a single quiet
                  glyph beside its date. */}
              <View style={styles.metaDateGroup}>
                <TouchableOpacity
                  style={styles.metaItem}
                  onPress={() => setDatePickerVisible(true)}
                  accessibilityLabel="Change entry date"
                  hitSlop={6}
                >
                  <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
                  <Text style={styles.metaText}>
                    {formatMetaDate(date)}
                    {time ? ` · ${formatTimeLabel(time)}` : ''}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setTimePickerVisible(true)}
                  accessibilityLabel={
                    time
                      ? `Entry time, ${formatTimeLabel(time)}. Tap to change.`
                      : 'Add a time of day to this entry'
                  }
                  hitSlop={8}
                >
                  <Ionicons
                    name={time ? 'time' : 'time-outline'}
                    size={13}
                    color={time ? colors.primary : colors.textFaint}
                  />
                </TouchableOpacity>
                {time ? (
                  <TouchableOpacity
                    onPress={() => setTime(null)}
                    accessibilityLabel="Clear entry time"
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={14} color={colors.textFaint} />
                  </TouchableOpacity>
                ) : null}
              </View>
              <TouchableOpacity
                style={styles.metaItem}
                onPress={() => setHighlightTier((t) => (t + 1) % 3)}
                accessibilityLabel={
                  highlightTier === 0
                    ? 'Mark as highlight. Tap to cycle: weekly, monthly, off.'
                    : highlightTier === 1
                      ? 'Weekly highlight. Tap to promote to monthly.'
                      : 'Monthly highlight. Tap to clear.'
                }
                hitSlop={6}
              >
                <Ionicons
                  name={highlightTier === 0 ? 'star-outline' : 'star'}
                  size={13}
                  color={highlightTier === 0 ? colors.textMuted : colors.primary}
                />
                <Text
                  style={[
                    styles.metaText,
                    highlightTier > 0 && styles.metaTextHighlight,
                  ]}
                >
                  {highlightTier === 0
                    ? 'Highlight'
                    : highlightTier === 1
                      ? 'Weekly highlight'
                      : 'Monthly highlight'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.metaItem}
                onPress={() => setIsPrivate((p) => !p)}
                accessibilityLabel={
                  isPrivate
                    ? 'Private entry. Tap to unmask.'
                    : 'Mark as private. Lists mask the title and the content.'
                }
                hitSlop={6}
              >
                <Ionicons
                  name={isPrivate ? 'lock-closed' : 'lock-open-outline'}
                  size={13}
                  color={isPrivate ? colors.primary : colors.textMuted}
                />
                <Text
                  style={[
                    styles.metaText,
                    isPrivate && styles.metaTextHighlight,
                  ]}
                >
                  {isPrivate ? 'Private' : 'Private'}
                </Text>
              </TouchableOpacity>
              {bead && threadMemberships.length === 1 ? (
                <TouchableOpacity
                  style={styles.metaItem}
                  onPress={() =>
                    navigation.navigate('ThreadDetail', {
                      threadId: threadMemberships[0].id,
                    })
                  }
                  hitSlop={6}
                >
                  <Ionicons
                    name="git-branch-outline"
                    size={13}
                    color={colors.textMuted}
                  />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {threadMemberships[0].name}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {bead && threadMemberships.length >= 2 ? (
                <TouchableOpacity
                  style={styles.metaItem}
                  onPress={showAllThreads}
                  hitSlop={6}
                >
                  <Ionicons
                    name="git-branch-outline"
                    size={13}
                    color={colors.textMuted}
                  />
                  <Text style={styles.metaText}>
                    {threadMemberships.length} threads
                  </Text>
                </TouchableOpacity>
              ) : null}
              {echoEntry ? (
                <TouchableOpacity
                  style={styles.metaItem}
                  onPress={() =>
                    navigation.push('EntryEditor', { entryId: echoEntry.id })
                  }
                  accessibilityLabel={`Echo: open prior entry with this bead from ${formatEchoDate(parseDateStr(echoEntry.date))}`}
                  hitSlop={6}
                >
                  <Ionicons
                    name="return-up-back-outline"
                    size={13}
                    color={colors.textMuted}
                  />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {formatEchoDate(parseDateStr(echoEntry.date))}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {/* Peek: read-only side-buffer onto any other note, without
                  leaving this draft (the editor stays mounted, auto-save
                  untouched). Sits beside Echo: both are "look elsewhere"
                  affordances, distinct from this entry's own attributes. */}
              <TouchableOpacity
                style={styles.metaItem}
                onPress={() => setPeekVisible(true)}
                accessibilityLabel="Peek at another note without leaving this one"
                hitSlop={6}
              >
                <Ionicons
                  name="eye-outline"
                  size={13}
                  color={colors.textMuted}
                />
                <Text style={styles.metaText}>Peek</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        {datePickerVisible && (
          <DateTimePicker
            value={date}
            mode="date"
            display="default"
            onChange={(event, selectedDate) => {
              setDatePickerVisible(false);
              if (selectedDate) setDate(selectedDate);
            }}
          />
        )}
        {timePickerVisible && (
          <DateTimePicker
            value={(() => {
              const d = new Date();
              const mins = time
                ? time.split(':').map(Number)
                : null;
              if (mins) d.setHours(mins[0] || 0, mins[1] || 0, 0, 0);
              return d;
            })()}
            mode="time"
            display="default"
            onChange={(event, selectedTime) => {
              setTimePickerVisible(false);
              // Android reports a 'dismissed' cancel; keep the prior value.
              if (event?.type === 'dismissed') return;
              if (selectedTime) setTime(formatTimeStr(selectedTime));
            }}
          />
        )}
      </View>

      <ScrollView
        ref={bodyScrollRef}
        style={styles.bodyScroll}
        contentContainerStyle={[
          styles.bodyContent,
          // +88 clears the undo bar (44) plus the usual 40-and-change of
          // breathing room; +40 is the pre-bar value, kept when it's hidden.
          { paddingBottom: keyboardInset + (undoBarVisible ? 88 : 40) },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.maskWrapper}>
          {/* While the history sheet previews, even a private note shows its
              rendered body: the buffer is the preview surface, and the user
              got here from inside the unlocked, focused editor. */}
          {(!isPrivate || historySheetVisible) && !contentFocused && content && content.trim().length > 0 ? (
            <TouchableOpacity
              style={styles.contentRenderedWrap}
              onPress={() => {
                const clamp = (v) =>
                  Math.max(0, Math.min(content.length, v ?? 0));
                const ls = lastSelectionRef.current;
                const sel =
                  wasContentFocusedRef.current && ls && typeof ls.start === 'number'
                    ? { start: clamp(ls.start), end: clamp(ls.end ?? ls.start) }
                    : { start: content.length, end: content.length };
                setPendingSelection(sel);
                setContentFocused(true);
                requestAnimationFrame(() => {
                  contentInputRef.current?.focus();
                  requestAnimationFrame(() => setPendingSelection(null));
                });
              }}
              activeOpacity={1}
              accessibilityLabel="Tap to edit content"
            >
              <MarkdownText>{content}</MarkdownText>
            </TouchableOpacity>
          ) : (
            <TextInput
              ref={contentInputRef}
              style={styles.contentInput}
              placeholder="Write your thoughts..."
              placeholderTextColor={colors.placeholder}
              value={content}
              onChangeText={setContent}
              onFocus={() => {
                setContentFocused(true);
                wasContentFocusedRef.current = true;
              }}
              onBlur={() => setContentFocused(false)}
              onContentSizeChange={(e) => {
                // Just track the height: scrolling happens in
                // onSelectionChange so cursor placement (taps) also moves
                // the viewport, not only typing.
                prevContentHeightRef.current =
                  e?.nativeEvent?.contentSize?.height || 0;
              }}
              onSelectionChange={(e) => {
                const sel = e?.nativeEvent?.selection;
                if (!sel) return;
                lastSelectionRef.current = sel;
                scrollToCursorRef.current();
              }}
              multiline
              textAlignVertical="top"
              scrollEnabled={false}
              autoFocus={!isEditingInitial}
              selection={pendingSelection || undefined}
            />
          )}
          {isPrivate && !contentFocused && !historySheetVisible ? (
            <TouchableOpacity
              style={styles.contentMaskOverlay}
              onPress={() => contentInputRef.current?.focus()}
              activeOpacity={0.85}
              accessibilityLabel="Content is masked. Tap to reveal and edit."
            >
              <Ionicons
                name="lock-closed"
                size={18}
                color={colors.textMuted}
              />
              <Text style={styles.contentMaskText}>Tap to read or edit</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <PhotoPicker
          ref={photoPickerRef}
          photos={photos}
          onPhotosChange={setPhotos}
          onAddPhotos={handleAddPhotos}
          hideWhenEmpty
        />

        {linkedThreads.length > 0 ? (
          <View style={styles.linksSection}>
            {linkedThreads.map((t) => (
              <ThreadCard
                key={t.id}
                thread={t}
                onPress={() => openLinkedThread(t.id)}
                onRemove={() => handleUnlinkThread(t.id)}
              />
            ))}
          </View>
        ) : null}

        <VoiceRecorder
          ref={voiceRecorderRef}
          recordings={recordings}
          onRecordingsChange={setRecordings}
          hideWhenEmpty
        />

        <View style={{ height: 40 }} />
      </ScrollView>

      {undoBarVisible ? (
        <View style={[styles.undoBar, { bottom: keyboardBottomOffset }]}>
          <TouchableOpacity
            onPress={handleUndo}
            disabled={!canUndo}
            style={styles.undoBarBtn}
            accessibilityRole="button"
            accessibilityLabel="Undo"
            accessibilityState={{ disabled: !canUndo }}
            hitSlop={8}
          >
            <Ionicons
              name="arrow-undo-outline"
              size={20}
              color={canUndo ? colors.primary : colors.textFaint}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleRedo}
            disabled={!canRedo}
            style={styles.undoBarBtn}
            accessibilityRole="button"
            accessibilityLabel="Redo"
            accessibilityState={{ disabled: !canRedo }}
            hitSlop={8}
          >
            <Ionicons
              name="arrow-redo-outline"
              size={20}
              color={canRedo ? colors.primary : colors.textFaint}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={openHistorySheet}
            disabled={!canOpenHistory}
            style={styles.undoBarBtn}
            accessibilityRole="button"
            accessibilityLabel="Edit history"
            accessibilityState={{ disabled: !canOpenHistory }}
            hitSlop={8}
          >
            <Ionicons
              name="git-network-outline"
              size={20}
              color={canOpenHistory ? colors.textMuted : colors.textFaint}
            />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={() => Keyboard.dismiss()}
            style={styles.undoBarBtn}
            accessibilityRole="button"
            accessibilityLabel="Dismiss keyboard"
            hitSlop={8}
          >
            <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      ) : null}

      {echoExitVisible ? (
        <View style={styles.echoExitWrap} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.echoExitPill}
            onPress={exitEchoWalk}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={echoExitLabel}
          >
            <Ionicons
              name="arrow-undo-outline"
              size={16}
              color={colors.primaryOnPrimary}
            />
            <Text style={styles.echoExitText} numberOfLines={1}>
              {echoExitLabel}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <EditHistorySheet
        visible={historySheetVisible}
        history={historyRef.current}
        onPreview={previewHistorySnapshot}
        onRestore={restoreFromHistory}
        onClose={closeHistorySheet}
      />

      <BeadComposer
        visible={beadComposerVisible}
        initial={bead}
        defaultGlyph={(title || '').trim().slice(0, 1).toUpperCase()}
        onSave={(payload) => {
          // Live-commit from BeadComposer: do NOT close the modal here so the
          // user can keep tweaking; the entry's debounced auto-save persists.
          setBead(payload);
          dirtyRef.current = true;
        }}
        onRemove={() => {
          setBead(null);
          setBeadComposerVisible(false);
          dirtyRef.current = true;
        }}
        onCancel={() => setBeadComposerVisible(false)}
      />

      {bead && entryIdRef.current ? (
        <AddToThreadOverlay
          visible={addToThreadVisible}
          entryId={entryIdRef.current}
          bead={bead}
          onClose={() => setAddToThreadVisible(false)}
          onAdded={() => {
            setAddToThreadVisible(false);
            loadThreadMemberships(entryIdRef.current);
          }}
          onCreateNew={() => {
            setAddToThreadVisible(false);
            navigation.navigate('ThreadComposer', {
              threadId: null,
              prefilledEntryId: entryIdRef.current,
            });
          }}
        />
      ) : null}

      <Modal
        visible={beadMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBeadMenuVisible(false)}
      >
        <Pressable
          style={styles.threadsBackdrop}
          onPress={() => setBeadMenuVisible(false)}
        >
          <Pressable
            style={[styles.threadsSheet, { paddingBottom: insets.bottom }]}
            onPress={() => {}}
          >
            <View style={styles.threadsHandle} />
            <Text style={styles.threadsHeading}>Bead</Text>
            <View style={styles.threadsList}>
              <TouchableOpacity
                style={styles.threadsRow}
                onPress={handleBeadEdit}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="create-outline"
                  size={18}
                  color={colors.primary}
                />
                <Text style={styles.threadsRowText}>Edit bead</Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.textFaint}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.threadsRow}
                onPress={handleBeadAddToThread}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="git-branch-outline"
                  size={18}
                  color={colors.primary}
                />
                <Text style={styles.threadsRowText}>Add to thread</Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.textFaint}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.threadsRow, styles.threadsRowLast]}
                onPress={handleBeadRemove}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={colors.danger}
                />
                <Text style={[styles.threadsRowText, { color: colors.danger }]}>
                  Remove bead
                </Text>
                <View style={{ width: 16 }} />
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={attachSheetVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAttachSheetVisible(false)}
      >
        <Pressable
          style={styles.threadsBackdrop}
          onPress={() => setAttachSheetVisible(false)}
        >
          <Pressable
            style={[styles.threadsSheet, { paddingBottom: insets.bottom }]}
            onPress={() => {}}
          >
            <View style={styles.threadsHandle} />
            <Text style={styles.threadsHeading}>Attach</Text>
            <View style={styles.threadsList}>
              <TouchableOpacity
                style={styles.threadsRow}
                onPress={() =>
                  closeAttachThen(() => photoPickerRef.current?.takePhoto())
                }
                activeOpacity={0.7}
              >
                <Ionicons name="camera-outline" size={18} color={colors.primary} />
                <Text style={styles.threadsRowText}>Take photo</Text>
                <View style={{ width: 16 }} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.threadsRow}
                onPress={() =>
                  closeAttachThen(() => photoPickerRef.current?.pickImage())
                }
                activeOpacity={0.7}
              >
                <Ionicons name="images-outline" size={18} color={colors.primary} />
                <Text style={styles.threadsRowText}>Pick from library</Text>
                <View style={{ width: 16 }} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.threadsRow}
                onPress={() =>
                  closeAttachThen(() =>
                    voiceRecorderRef.current?.startRecording()
                  )
                }
                activeOpacity={0.7}
              >
                <Ionicons name="mic-outline" size={18} color={colors.primary} />
                <Text style={styles.threadsRowText}>Voice note</Text>
                <View style={{ width: 16 }} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.threadsRow}
                onPress={() =>
                  closeAttachThen(() =>
                    voiceRecorderRef.current?.importAudio()
                  )
                }
                activeOpacity={0.7}
              >
                <Ionicons
                  name="musical-notes-outline"
                  size={18}
                  color={colors.primary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.threadsRowText, { flex: undefined }]}>
                    Pick audio file
                  </Text>
                  <Text style={styles.threadsRowSubtext}>Up to 50 MB</Text>
                </View>
                <View style={{ width: 16 }} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.threadsRow, styles.threadsRowLast]}
                onPress={() =>
                  closeAttachThen(() => setLinkPickerVisible(true))
                }
                activeOpacity={0.7}
              >
                <Ionicons
                  name="git-branch-outline"
                  size={18}
                  color={colors.primary}
                />
                <Text style={styles.threadsRowText}>Mention a thread</Text>
                <View style={{ width: 16 }} />
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={exportSheetVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setExportSheetVisible(false)}
      >
        <Pressable
          style={styles.threadsBackdrop}
          onPress={() => setExportSheetVisible(false)}
        >
          <Pressable
            style={[styles.threadsSheet, { paddingBottom: insets.bottom }]}
            onPress={() => {}}
          >
            <View style={styles.threadsHandle} />
            {exportFormat == null ? (
              <>
                <Text style={styles.threadsHeading}>Export entry</Text>
                <View style={styles.threadsList}>
                  <TouchableOpacity
                    style={styles.threadsRow}
                    onPress={() => setExportFormat('md')}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="document-text-outline"
                      size={18}
                      color={colors.primary}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.threadsRowText, { flex: undefined }]}>
                        Markdown
                      </Text>
                      <Text style={styles.threadsRowSubtext}>
                        .md with frontmatter
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={colors.textFaint}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.threadsRow}
                    onPress={() => setExportFormat('html')}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="globe-outline"
                      size={18}
                      color={colors.primary}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.threadsRowText, { flex: undefined }]}>
                        HTML
                      </Text>
                      <Text style={styles.threadsRowSubtext}>
                        Styled page · 5 templates
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={colors.textFaint}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.threadsRow, styles.threadsRowLast]}
                    onPress={() => setExportFormat('card')}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="image-outline"
                      size={18}
                      color={colors.primary}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.threadsRowText, { flex: undefined }]}>
                        Card (PNG)
                      </Text>
                      <Text style={styles.threadsRowSubtext}>
                        Shareable image for messengers
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={colors.textFaint}
                    />
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <View style={styles.threadsList}>
                <TouchableOpacity
                  style={styles.exFmtBack}
                  onPress={() => setExportFormat(null)}
                  activeOpacity={0.7}
                  accessibilityLabel="Back to formats"
                >
                  <Ionicons
                    name="chevron-back"
                    size={20}
                    color={colors.primary}
                  />
                  <Text style={styles.exFmtBackText}>
                    {ENTRY_FORMAT_META[exportFormat].label}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.exFmtHint}>
                  {ENTRY_FORMAT_META[exportFormat].hint}
                </Text>

                {exportFormat === 'html'
                  ? HTML_TEMPLATES.map((t) => (
                      <TouchableOpacity
                        key={t.key}
                        style={styles.threadsRow}
                        onPress={() => setHtmlTemplate(t.key)}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={
                            htmlTemplate === t.key
                              ? 'radio-button-on'
                              : 'radio-button-off'
                          }
                          size={18}
                          color={
                            htmlTemplate === t.key
                              ? colors.primary
                              : colors.textFaint
                          }
                        />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[styles.threadsRowText, { flex: undefined }]}
                          >
                            {t.label}
                          </Text>
                          <Text style={styles.threadsRowSubtext}>{t.hint}</Text>
                        </View>
                      </TouchableOpacity>
                    ))
                  : null}

                {exportFormat === 'card' ? (
                  <TouchableOpacity
                    style={styles.threadsRow}
                    onPress={() => setCardWithNotes((v) => !v)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={cardWithNotes ? 'checkbox' : 'square-outline'}
                      size={18}
                      color={cardWithNotes ? colors.primary : colors.textFaint}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.threadsRowText, { flex: undefined }]}>
                        Include sticky-note comments
                      </Text>
                      <Text style={styles.threadsRowSubtext}>
                        Render comments as notes on the card
                      </Text>
                    </View>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.exFmtAction}
                  onPress={runEntryExport}
                  activeOpacity={0.85}
                  accessibilityLabel={`Share as ${ENTRY_FORMAT_META[exportFormat].label}`}
                >
                  <Ionicons
                    name="share-outline"
                    size={16}
                    color={colors.primaryOnPrimary}
                  />
                  <Text style={styles.exFmtActionText}>Share</Text>
                </TouchableOpacity>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={exportBusyLabel != null}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.exportBusyBackdrop}>
          <View style={styles.exportBusyCard}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.exportBusyText}>{exportBusyLabel}</Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={cardPhotoPicker != null}
        transparent
        animationType="fade"
        onRequestClose={() => setCardPhotoPicker(null)}
      >
        <Pressable
          style={styles.threadsBackdrop}
          onPress={() => setCardPhotoPicker(null)}
        >
          <Pressable
            style={[styles.threadsSheet, { paddingBottom: insets.bottom }]}
            onPress={() => {}}
          >
            <View style={styles.threadsHandle} />
            <Text style={styles.threadsHeading}>Pick the main photo</Text>
            <Text style={styles.cardPickerHint}>
              Only one photo fits on the card. The other photos stay in
              the entry, but they do not show in this export.
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.cardPickerStrip}
            >
              {(cardPhotoPicker?.data.photoUris || []).map((uri, idx) => (
                <TouchableOpacity
                  key={`${uri}-${idx}`}
                  style={styles.cardPickerThumb}
                  onPress={() => handlePickMainPhoto(idx)}
                  activeOpacity={0.7}
                >
                  <Image
                    source={{ uri }}
                    style={styles.cardPickerThumbImage}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {cardExport ? (
        <View
          style={styles.cardExportOffscreen}
          pointerEvents="none"
        >
          <EntryCardForExport
            ref={cardRef}
            entry={cardExport.data.entry}
            bead={cardExport.data.bead}
            photoUris={cardExport.data.photoUris}
            mainPhotoIndex={cardExport.mainPhotoIndex}
            comments={cardExport.data.comments}
            withNotes={cardExport.withNotes}
            onReady={() => cardReadyResolverRef.current?.()}
          />
        </View>
      ) : null}

      <ThreadPickerSheet
        visible={linkPickerVisible}
        excludeThreadIds={linkedThreads.map((t) => t.id)}
        onPick={handleLinkThread}
        onClose={() => setLinkPickerVisible(false)}
      />

      <PeekSheet
        visible={peekVisible}
        currentEntryId={entryIdRef.current}
        onClose={() => setPeekVisible(false)}
        onOpenFully={(id) => {
          setPeekVisible(false);
          navigation.push('EntryEditor', { entryId: id });
        }}
      />

      <CommentsDrawer
        visible={commentsVisible}
        parentKind={PARENT_ENTRY}
        parentId={entryIdRef.current}
        parentLabel={(title || '').trim() || 'Entry'}
        onClose={() => {
          setCommentsVisible(false);
          refreshCommentCount(entryIdRef.current);
        }}
        onCommentsChanged={() => refreshCommentCount(entryIdRef.current)}
        onPromoteToThreadCompose={({ originEntryId, newEntryId, originTitle }) => {
          setCommentsVisible(false);
          navigation.navigate('ThreadComposer', {
            threadId: null,
            prefilledEntryIds: [originEntryId, newEntryId],
            prefillName: `(From:) ${originTitle || 'Entry'}`,
          });
        }}
      />

      <Modal
        visible={threadsSheetVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setThreadsSheetVisible(false)}
      >
        <Pressable
          style={styles.threadsBackdrop}
          onPress={() => setThreadsSheetVisible(false)}
        >
          <Pressable
            style={[styles.threadsSheet, { paddingBottom: insets.bottom }]}
            onPress={() => {}}
          >
            <View style={styles.threadsHandle} />
            <Text style={styles.threadsHeading}>In threads</Text>
            <ScrollView contentContainerStyle={styles.threadsList}>
              {threadMemberships.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.threadsRow}
                  onPress={() => openThreadFromSheet(t.id)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="git-branch-outline"
                    size={16}
                    color={colors.primary}
                  />
                  <Text style={styles.threadsRowText} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.textFaint}
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { justifyContent: 'center', alignItems: 'center' },
    // Sticky region: topBar + titleBlock + date picker. Doesn't scroll:
    // stays at the top while the user writes a long entry.
    stickyHeader: {
      paddingHorizontal: 20,
      paddingTop: 0,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    bodyScroll: { flex: 1 },
    bodyContent: { paddingHorizontal: 20, paddingTop: 16 },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 40,
      paddingBottom: 12,
    },
    iconWrap: {
      width: 32,
      height: 32,
      justifyContent: 'center',
      alignItems: 'center',
    },
    topBarRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    commentsChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    commentsChipText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '600',
    },
    savingStatus: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 20,
      // The 'error' copy is the longest label; let it shrink (ellipsized)
      // before it can push the right-hand icons off a narrow screen.
      flexShrink: 1,
      marginHorizontal: 4,
    },
    savingStatusInner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexShrink: 1,
    },
    savingLabel: {
      color: colors.textMuted,
      fontSize: 13,
      flexShrink: 1,
    },
    savingLabelError: {
      color: colors.danger,
    },
    walkBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingBottom: 10,
      marginTop: -2,
    },
    walkBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 1,
      paddingVertical: 2,
    },
    walkBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.primary,
    },
    walkBtnTextDisabled: {
      color: colors.textFaint,
    },
    walkLabel: {
      flex: 1,
      textAlign: 'center',
      fontSize: 12,
      color: colors.textMuted,
    },
    titleBlock: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 14,
    },
    titleBlockBody: {
      flex: 1,
    },
    metaStrip: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 12,
    },
    metaItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      maxWidth: 220,
    },
    // Date chip + time glyph(s) as one visually-contiguous unit (tighter
    // gap than the strip's 12) so the time reads as part of the date, not a
    // separate strip chip.
    metaDateGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: 260,
    },
    // Floating echo-walk escape. Full-width box-none wrapper centers the pill
    // and lets touches pass through to the content around it.
    echoExitWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 28,
      alignItems: 'center',
    },
    echoExitPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: 280,
      paddingVertical: 9,
      paddingHorizontal: 16,
      borderRadius: 22,
      backgroundColor: colors.primary,
      elevation: 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
    },
    echoExitText: {
      color: colors.primaryOnPrimary,
      fontSize: 13,
      fontWeight: '600',
    },
    // S15 keyboard accessory bar: absolutely positioned; `bottom` is set
    // inline to the live keyboardBottomOffset (the IME's exact top edge,
    // NOT keyboardInset, which can float the bar above the keyboard when
    // safe-area and RN disagree about the nav bar; see useKeyboardHeight).
    undoBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    undoBarBtn: {
      width: 44,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    metaText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '500',
    },
    metaTextHighlight: {
      color: colors.primary,
      fontWeight: '600',
    },
    beadPlaceholder: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    titleInput: {
      fontSize: 20,
      fontWeight: '500',
      color: colors.text,
      paddingTop: 0,
      paddingBottom: 2,
    },
    contentInput: {
      fontSize: 16,
      color: colors.text,
      lineHeight: 24,
      minHeight: 200,
      textAlignVertical: 'top',
      marginBottom: 16,
    },
    contentRenderedWrap: {
      minHeight: 200,
      marginBottom: 16,
    },
    maskWrapper: {
      position: 'relative',
    },
    titleMaskOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.background,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingBottom: 2,
    },
    titleMaskText: {
      color: colors.textMuted,
      fontSize: 16,
      fontStyle: 'italic',
    },
    contentMaskOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 16,
      backgroundColor: colors.background,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingTop: 4,
    },
    contentMaskText: {
      color: colors.textMuted,
      fontSize: 15,
      fontStyle: 'italic',
      lineHeight: 24,
    },
    threadsBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    exportBusyBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    exportBusyCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingHorizontal: 24,
      paddingVertical: 20,
      alignItems: 'center',
      gap: 10,
      minWidth: 200,
    },
    exportBusyText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    // Park the card-for-export off-screen so view-shot can capture it
    // without the user ever seeing it on stage. Top: -10000 keeps it
    // mounted (so it has measurable bounds) but well outside the visible
    // viewport on every device size.
    cardExportOffscreen: {
      position: 'absolute',
      top: -10000,
      left: 0,
    },
    cardPickerHint: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    cardPickerStrip: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 10,
    },
    cardPickerThumb: {
      width: 96,
      height: 96,
      borderRadius: 10,
      backgroundColor: colors.surfaceMuted,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardPickerThumbImage: {
      width: '100%',
      height: '100%',
    },
    threadsSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '70%',
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
    },
    threadsHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      alignSelf: 'center',
      marginBottom: 12,
    },
    threadsHeading: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: 20,
      marginBottom: 4,
    },
    threadsList: {
      paddingHorizontal: 20,
      paddingBottom: 20,
    },
    threadsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    threadsRowLast: {
      borderBottomWidth: 0,
    },
    threadsRowText: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    threadsRowSubtext: {
      color: colors.textFaint,
      fontSize: 12,
      marginTop: 2,
    },
    exFmtBack: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginLeft: -4,
      paddingVertical: 2,
    },
    exFmtBackText: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    exFmtHint: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 2,
      marginBottom: 6,
    },
    exFmtAction: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      marginTop: 16,
      paddingVertical: 13,
      borderRadius: 12,
      backgroundColor: colors.primary,
    },
    exFmtActionText: {
      color: colors.primaryOnPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
    linksSection: {
      marginTop: 4,
      marginBottom: 12,
    },
  });
