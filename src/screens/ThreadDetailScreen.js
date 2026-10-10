import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  Pressable,
  Image,
  Animated,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BeadView from '../components/BeadView';
import BeadChain from '../components/BeadChain';
import VerticalBeadChain from '../components/VerticalBeadChain';
import LoopBeadChain from '../components/LoopBeadChain';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import CollectionPickerSheet from '../components/CollectionPickerSheet';
import CommentsDrawer from '../components/CommentsDrawer';
import AnchorSheet from '../components/AnchorSheet';
import DateTimePicker from '@react-native-community/datetimepicker';
import BeadPickerModal from '../components/BeadPickerModal';
import ThreadExportSheet from '../components/ThreadExportSheet';
import { getDb } from '../database/db';
import { readBead, DEFAULT_BEAD } from '../beads/types';
import {
  countComments,
  PARENT_THREAD,
} from '../services/comments';
import { deleteThreads } from '../services/threads';
import { loadCollectionsForThread } from '../services/collections';
import { loadMentioningEntriesForThread } from '../services/threadMembership';
import {
  syncAutoBeadForEntry,
  promoteAutoWeekToMonth,
} from '../services/autoThread';
import { useTheme } from '../theme';
import MarkdownText from '../components/MarkdownText';
import MentionedByDrawer from '../components/MentionedByDrawer';
import {
  useKeyboardInset,
  useKeyboardBottomOffset,
  dismissKeyboardThen,
} from '../hooks/useKeyboardHeight';
import { createEditHistory } from '../services/editHistory';
import EditHistorySheet from '../components/EditHistorySheet';
import { isPrivate, MASKED_TITLE } from '../utils/privacy';
import { hapticClasp, hapticTap } from '../utils/haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const AUTO_KINDS = new Set(['auto_day', 'auto_week', 'auto_month']);
const isAutoKind = (kind) => AUTO_KINDS.has(kind);

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function autoBannerCopy(kind) {
  switch (kind) {
    case 'auto_day':
      return "Auto-thread of the day. The chain follows the entries on this date. Open a bead to act on its entry.";
    case 'auto_week':
      return "Auto-thread of the week. Each entry that you star as a weekly highlight goes here. Use 'Promote week to month' at the end of the week.";
    case 'auto_month':
      return "Auto-thread of the month. Entries that you promote to monthly highlight go here.";
    default:
      return '';
  }
}

const CHAIN_BEAD_SIZE = 44;
// Loop view starts from a smaller bead than the linear chain (a ring
// crowds where a line has the whole width to breathe); LoopBeadChain
// shrinks it further, adaptively, when the chain is long.
const LOOP_BEAD_SIZE = 30;

const pad = (n) => n.toString().padStart(2, '0');
const formatTimestamp = (d) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
  `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const isoDate = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function anchorLabel(thread) {
  if (!thread) return '';
  const { anchor_kind, anchor_date, anchor_time } = thread;
  if (!anchor_kind || anchor_kind === 'none') return 'No anchor';
  switch (anchor_kind) {
    case 'day':
      return anchor_date ? `Day · ${anchor_date}` : 'Day';
    case 'week': {
      if (!anchor_date) return 'Week';
      const [y, m, d] = anchor_date.split('-').map(Number);
      const dt = new Date(y, (m || 1) - 1, d || 1);
      return `Week of ${dt.getDate()} ${MONTH_NAMES[dt.getMonth()]} ${dt.getFullYear()}`;
    }
    case 'month': {
      if (!anchor_date) return 'Month';
      const [y, m] = anchor_date.split('-');
      const d = new Date(Number(y), Number(m) - 1, 1);
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    case 'year':
      return anchor_date ? `Year · ${anchor_date}` : 'Year';
    case 'time':
      return anchor_date && anchor_time
        ? `${anchor_date} · ${anchor_time}`
        : 'Time';
    default:
      return 'No anchor';
  }
}

export default function ThreadDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const threadId = route.params?.threadId;
  const initialAutoOpenComments = route.params?.autoOpenComments ?? false;
  const [thread, setThread] = useState(null);
  const [chain, setChain] = useState([]);
  const [threadCollections, setThreadCollections] = useState([]);
  const [previewEntryId, setPreviewEntryId] = useState(null);
  const [collectionPickerVisible, setCollectionPickerVisible] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [mentionedBy, setMentionedBy] = useState([]);
  const [mentionedByVisible, setMentionedByVisible] = useState(false);
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  // Default to the horizontal beaded-line view; users opt-in to vertical
  // per session via the toggle next to the Chain label. No persistence:
  // matches the filters-collapse pattern in HomeScreen.
  const [chainOrientation, setChainOrientation] = useState('horizontal');

  // Scrub the rosary: drag horizontally along the chain to fan through its
  // entries bead-by-bead *in order* (a rosary is counted in order), reusing the
  // preview drawer; each bead clicks past with a haptic tap. A "sequence scrub"
  // (drag distance → index steps), so it's independent of the chain's wrapping
  // layout. Refs keep the handlers stable + free of stale closures; the
  // PanGestureHandler's activeOffsetX claims only horizontal pans, so vertical
  // page-scrolling and individual bead taps pass straight through.
  const liveChain = useMemo(() => chain.filter((tb) => tb.entry_id), [chain]);
  const liveChainRef = useRef([]);
  liveChainRef.current = liveChain;
  const previewEntryIdRef = useRef(null);
  previewEntryIdRef.current = previewEntryId;
  const scrubStartRef = useRef(0);
  const scrubIdxRef = useRef(-1);
  const SCRUB_STEP = 26; // px of drag per bead
  const onScrubState = useCallback((e) => {
    if (e.nativeEvent.state === State.BEGAN) {
      const lc = liveChainRef.current;
      const cur = lc.findIndex(
        (tb) => tb.entry_id === previewEntryIdRef.current
      );
      scrubStartRef.current = cur >= 0 ? cur : 0;
      scrubIdxRef.current = scrubStartRef.current;
    }
  }, []);
  const onScrubEvent = useCallback((e) => {
    const lc = liveChainRef.current;
    const n = lc.length;
    if (!n) return;
    const steps = Math.round(e.nativeEvent.translationX / SCRUB_STEP);
    const idx = Math.max(0, Math.min(n - 1, scrubStartRef.current + steps));
    if (idx !== scrubIdxRef.current) {
      scrubIdxRef.current = idx;
      setPreviewEntryId(lc[idx].entry_id);
      hapticTap(); // each bead clicks past, like a rosary
    }
  }, []);

  // Thread-walk context handed to the editor so it can offer header
  // prev/next through this thread's chain order. Only the live (non-null
  // entry_id) beads, in position order; undefined for chains of <2 so a
  // single-entry thread shows no walker.
  const threadWalkParam = useMemo(() => {
    if (!thread) return undefined;
    const ids = chain.map((tb) => tb.entry_id).filter((id) => id != null);
    if (ids.length < 2) return undefined;
    return { threadId, threadName: thread.name, entryIds: ids };
  }, [chain, thread, threadId]);
  // Currently expanded bead key in the vertical view (null = no bubble).
  // Lifted here for the accordion and so bead-adding flows can close it.
  // NOT closed on scroll: the bubble is absolute-positioned *inside the
  // chain*, so it scrolls with its bead. Closing it on scroll made a
  // long expanded note unreadable (scrolling to the rest closed it).
  const [expandedKey, setExpandedKey] = useState(null);
  const scrollRef = useRef(null);
  const fabPulse = useRef(new Animated.Value(1)).current;

  // Editable fields. Hydrated from the thread row inside load(); a
  // debounced effect writes them back. Mirrors EntryEditorScreen's
  // auto-save pattern: loadedRef gates the effect until the initial
  // hydration is done, skipNextSaveRef absorbs the load-induced setter
  // round so reopening a thread doesn't trigger a no-op write.
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const loadedRef = useRef(false);
  const skipNextSaveRef = useRef(false);

  // S15 undo/redo, thread edition: the same session-only history tree the
  // entry editor carries, over name + description (mapped onto the
  // service's {title, content} snapshot shape). Seeded lazily by the
  // capture effect on first hydration (NOT in load(): load re-runs on
  // every focus, and re-seeding there would wipe the session history each
  // time you hop into an entry and come back). One asymmetry vs the entry
  // editor: this screen's auto-save timer captures name/description in
  // its effect closure at schedule time, so a pending save can never fire
  // with previewed text, so no historyPreviewRef freeze is needed here.
  // Restore/close instead flush explicitly (see the handlers).
  const historyRef = useRef(null);
  if (historyRef.current == null) historyRef.current = createEditHistory();
  const historySkipRef = useRef(false);
  const [historySheetVisible, setHistorySheetVisible] = useState(false);
  const preRestoreSnapshotRef = useRef(null);
  // True once any preview applied this sheet-session; gates the
  // close-without-restore flush so an idle open/close never writes.
  const historyPreviewedRef = useRef(false);
  // Cancel handle for an open waiting on the keyboard to leave (mirrors the
  // entry editor); cancelled on unmount so it never fires into a dead screen.
  const pendingHistoryOpenRef = useRef(null);
  useEffect(
    () => () => {
      pendingHistoryOpenRef.current?.();
      pendingHistoryOpenRef.current = null;
    },
    []
  );
  const [nameFocused, setNameFocused] = useState(false);

  // Save-state readout for name/description, mirroring the entry editor's
  // (editor-autosave.md §13: derived, never asserted). A thread on this
  // screen always exists on disk, so the resting state is 'saved';
  // 'dirty' = edits still in memory, 'saving' = the UPDATE is in flight.
  // Auto-threads never editable → the slot renders empty for them.
  // 'error' = the last write threw; sticky until a write succeeds (tap the
  // readout, or keep editing: the next debounce is the retry).
  const [savingState, setSavingState] = useState('saved');
  const lastSaveFailedRef = useRef(false);
  const savedAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (savingState !== 'saved') return;
    savedAnim.setValue(0);
    Animated.timing(savedAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [savingState]);

  // Bottom-sheet visibility state for the in-place edit affordances.
  const [anchorSheetVisible, setAnchorSheetVisible] = useState(false);
  const [beadActionTarget, setBeadActionTarget] = useState(null);
  const [fabSheetVisible, setFabSheetVisible] = useState(false);
  const [exportSheetVisible, setExportSheetVisible] = useState(false);
  const [closedDatePickerVisible, setClosedDatePickerVisible] =
    useState(false);
  // When the export sheet sends the user into "Customize layout" (the
  // composer), remember which format they were on so we can reopen the
  // sheet on that detail panel when they come back.
  const [exportInitialFormat, setExportInitialFormat] = useState(null);
  const pendingExportReturnRef = useRef(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  // Section-label prompt. `target` holds the thread_beads row being
  // labelled (or relabelled); `draft` is the current text in the
  // single-line input. null target = prompt is closed.
  const [sectionPromptTarget, setSectionPromptTarget] = useState(null);
  const [sectionPromptDraft, setSectionPromptDraft] = useState('');

  // Description editing: focus-aware swap mirrors the entry editor.
  // When blurred and non-empty, the source text is replaced by a
  // rendered Markdown view; tapping it re-focuses the TextInput with
  // the cursor restored (or at end-of-content on first edit).
  const [descriptionFocused, setDescriptionFocused] = useState(false);
  const [descriptionPendingSelection, setDescriptionPendingSelection] =
    useState(null);
  const descriptionInputRef = useRef(null);
  const descriptionLastSelectionRef = useRef({ start: 0, end: 0 });
  const wasDescriptionFocusedRef = useRef(false);
  // Loop default is applied ONCE per mount (closed threads and auto
  // week/month rings open in Loop view), then the user owns the choice.
  // `load` runs on every focus, so without this guard a manual switch to
  // Beaded line/Stacked would snap back to Loop on every navigation.
  const loopInitRef = useRef(false);

  // Keyboard-aware scroll for the multiline description: the same hand-rolled
  // approach as EntryEditorScreen (edge-to-edge nullifies adjustResize, so
  // KeyboardAvoidingView won't shift the layout on Android). Refs hold the
  // latest measured layout so the keyboard-show effect can re-scroll with
  // the up-to-date cursor without re-firing every keystroke.
  const keyboardInset = useKeyboardInset();
  // Exact IME top edge for the pinned undo bar (see useKeyboardHeight:
  // the derived inset can float a pinned view above the keyboard).
  const keyboardBottomOffset = useKeyboardBottomOffset();
  const scrollViewportHRef = useRef(0);
  const descInputYRef = useRef(0);
  const descContentHRef = useRef(0);
  const scrollDescToCursorRef = useRef(() => {});
  scrollDescToCursorRef.current = () => {
    const vp = scrollViewportHRef.current;
    const h = descContentHRef.current;
    if (vp <= 0 || h <= 0 || !scrollRef.current) return;
    const sel = descriptionLastSelectionRef.current || { start: 0 };
    const len = description.length;
    const ratio = len > 0 ? Math.min(1, (sel.start ?? 0) / len) : 1;
    // Description input's y within the scroll content + the cursor's
    // approximate offset into it.
    const cursorY = descInputYRef.current + ratio * h;
    const visibleH = Math.max(120, vp - keyboardInset);
    // Cursor lands ~80px above the keyboard top.
    const targetY = Math.max(0, cursorY - visibleH + 80);
    scrollRef.current.scrollTo({ y: targetY, animated: false });
  };
  // Re-scroll once the keyboard has finished animating up: onSelectionChange
  // fired before the viewport shrank.
  useEffect(() => {
    if (keyboardInset > 0) {
      const t = setTimeout(() => scrollDescToCursorRef.current(), 60);
      return () => clearTimeout(t);
    }
  }, [keyboardInset]);

  const load = useCallback(async () => {
    const db = getDb();
    if (!db || threadId == null) return;
    const t = await db.getFirstAsync('SELECT * FROM threads WHERE id = ?', [
      threadId,
    ]);
    setThread(t || null);
    // Hydrate the editable fields and tell the auto-save effect to skip
    // the resulting state-update round. Without this guard, reopening
    // (or refocusing) a thread would immediately re-save its current
    // contents and bump updated_at on every navigation.
    if (t) {
      skipNextSaveRef.current = true;
      setName(t.name || '');
      setDescription(t.description || '');
      loadedRef.current = true;
    }
    // Default view, applied once per mount: a closed loop, and the
    // intrinsically-cyclical auto week/month rings, open in Loop view.
    // Everything else (open user threads, auto_day) stays Beaded line.
    // After this the user owns the orientation (see loopInitRef note).
    if (t && !loopInitRef.current) {
      loopInitRef.current = true;
      if (t.closed_at || t.kind === 'auto_week' || t.kind === 'auto_month') {
        setChainOrientation('loop');
      }
    }
    setThreadCollections(await loadCollectionsForThread(threadId));
    const beads = await db.getAllAsync(
      `SELECT tb.*,
              e.bead_shape, e.bead_pattern, e.bead_mood, e.bead_glyph,
              e.title AS entry_title,
              e.content AS entry_content,
              e.is_private AS entry_is_private,
              (SELECT COUNT(*) FROM comments
                 WHERE parent_kind = 'entry' AND parent_id = tb.entry_id)
                AS entry_comment_count
         FROM thread_beads tb
         LEFT JOIN entries e ON e.id = tb.entry_id
         WHERE tb.thread_id = ?
         ORDER BY tb.position ASC`,
      [threadId]
    );
    setChain(beads);
    setCommentCount(await countComments(PARENT_THREAD, threadId));
    // Inbound mentions (the "@ N" backlink chip). Runs on every focus via
    // the same listener as the rest of load(), so adding/removing a
    // mention from an entry elsewhere reflects here on return.
    setMentionedBy(await loadMentioningEntriesForThread(threadId));
  }, [threadId]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [load, navigation]);

  // Returning from the "Customize layout" composer: resume the export
  // flow by reopening the sheet on the format the user left from, so
  // they land back on Share / Save to device, not on the thread.
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      const fmt = pendingExportReturnRef.current;
      if (fmt) {
        pendingExportReturnRef.current = null;
        setExportInitialFormat(fmt);
        setExportSheetVisible(true);
      }
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    // Banner-tap path: HomeScreen passes autoOpenComments when the user
    // taps a comment-reminder banner whose parent is this thread.
    if (initialAutoOpenComments) setCommentsVisible(true);
  }, [initialAutoOpenComments]);

  // Debounced auto-save for name + description. Auto-threads are
  // derived state; we never write back to their name/description from
  // here. The skip flag absorbs the round of setters that load() fires
  // when hydrating from the row, so reopening a thread doesn't trigger
  // a redundant UPDATE.
  useEffect(() => {
    if (!loadedRef.current) return;
    if (isAutoKind(thread?.kind)) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    // A failed write stays visible as 'error': more typing must not
    // repaint it as an ordinary pending edit; the debounce is the retry.
    setSavingState(lastSaveFailedRef.current ? 'error' : 'dirty');
    const handle = setTimeout(() => {
      persistThreadFields(name, description);
    }, 1000);
    return () => clearTimeout(handle);
  }, [name, description, threadId, thread?.kind]);

  // S15 history capture: the same parallel-effect pattern as the entry editor
  // (docs/architecture/editor-autosave.md §14), nodes on the same 1s pause
  // as auto-save. First run with an empty tree seeds the root instead of
  // recording (that's the once-per-mount hydration; load() itself never
  // touches the history, so returning from an entry keeps the session tree).
  useEffect(() => {
    if (!loadedRef.current) return;
    if (isAutoKind(thread?.kind)) return;
    if (historyRef.current.size() === 0) {
      historyRef.current.reset({ title: name, content: description });
      return;
    }
    if (historySkipRef.current) {
      historySkipRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      historyRef.current.record({ title: name, content: description });
    }, 1000);
    return () => clearTimeout(timer);
  }, [name, description, thread?.kind]);

  // Direct write for the two restore paths where the setters would no-op
  // (buffer already shows the target) and the save effect therefore never
  // fires. Takes explicit values, so no closure-staleness risk.
  // Also the auto-save timer's body (it passes the values its effect
  // closed over at schedule time, so nothing here reads live state).
  const persistThreadFields = async (n, d) => {
    if (threadId == null) return;
    const db = getDb();
    setSavingState('saving');
    try {
      if (!db) throw new Error('database not ready');
      await db.runAsync(
        `UPDATE threads
            SET name = ?, description = ?, updated_at = datetime('now')
          WHERE id = ?`,
        [n.trim() || 'Untitled', d.trim(), threadId]
      );
      lastSaveFailedRef.current = false;
      setSavingState('saved');
    } catch (err) {
      console.error('Thread save failed:', err?.message || err);
      // Edits are still only in memory: a state of its own, since 'dirty'
      // looks exactly like a pending debounce.
      lastSaveFailedRef.current = true;
      setSavingState('error');
    }
  };

  const applyHistorySnapshot = (snap) => {
    if (!snap) return;
    historySkipRef.current = true;
    setName(snap.title);
    setDescription(snap.content);
  };
  const handleUndo = () =>
    applyHistorySnapshot(
      historyRef.current.undo({ title: name, content: description })
    );
  const handleRedo = () =>
    applyHistorySnapshot(
      historyRef.current.redo({ title: name, content: description })
    );

  // Open only once the IME has actually left the screen: a dialog created
  // mid-hide can be sized against a transient garbage inset and land below
  // the screen (v0.88.4; see `dismissKeyboardThen` in useKeyboardHeight).
  const openHistorySheet = () => {
    if (pendingHistoryOpenRef.current || historySheetVisible) return;
    historyRef.current.record({ title: name, content: description });
    preRestoreSnapshotRef.current = { title: name, content: description };
    historyPreviewedRef.current = false;
    pendingHistoryOpenRef.current = dismissKeyboardThen(
      () => {
        pendingHistoryOpenRef.current = null;
        setHistorySheetVisible(true);
      },
      { keyboardUp: keyboardBottomOffset > 0 }
    );
  };

  // Preview: swap the buffer without recording and without scheduling a
  // save of the previewed text. (A save timer already pending from typing
  // holds its own closure values, so it can only ever write real text.)
  const previewHistorySnapshot = (snap) => {
    if (!snap) return;
    if (snap.title === name && snap.content === description) return;
    historyPreviewedRef.current = true;
    skipNextSaveRef.current = true;
    historySkipRef.current = true;
    setName(snap.title);
    setDescription(snap.content);
  };

  const restoreFromHistory = (nodeId) => {
    const snap = historyRef.current.jumpTo(nodeId);
    setHistorySheetVisible(false);
    if (!snap) return;
    if (snap.title !== name || snap.content !== description) {
      historySkipRef.current = true;
      setName(snap.title);
      setDescription(snap.content); // save effect persists the restore
    } else {
      persistThreadFields(snap.title, snap.content);
    }
  };

  // Close without restoring: revert any preview (the save effect re-runs
  // and re-persists). The direct flush runs only if a preview happened and
  // the user previewed their way back to the pre-open text: the preview's
  // dep change cleared any pending tail-save, and no setter will re-fire
  // the effect. An idle open/close stays a pure no-op (no updated_at bump).
  const closeHistorySheet = () => {
    setHistorySheetVisible(false);
    const pre = preRestoreSnapshotRef.current;
    if (pre && (pre.title !== name || pre.content !== description)) {
      historySkipRef.current = true;
      setName(pre.title);
      setDescription(pre.content);
    } else if (historyPreviewedRef.current) {
      persistThreadFields(name, description);
    }
  };

  // Bar chrome mirrors EntryEditorScreen: exists only while one of the two
  // text fields has the keyboard up, never for auto-threads (read-only).
  const undoBarVisible =
    !isAutoKind(thread?.kind) &&
    keyboardBottomOffset > 0 &&
    (nameFocused || descriptionFocused);
  const canUndo =
    undoBarVisible &&
    historyRef.current.canUndo({ title: name, content: description });
  const canRedo =
    undoBarVisible &&
    historyRef.current.canRedo({ title: name, content: description });
  const canOpenHistory =
    undoBarVisible && (historyRef.current.size() > 1 || canUndo);

  // Same label/icon mapping as EntryEditorScreen's readout.
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

  const handleDelete = () => {
    Alert.alert('Delete thread', 'Do you want to delete this thread? You will lose the beads in it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const db = getDb();
          if (!db) return;
          // Comments (polymorphic, no FK) + the row, in one transaction.
          await deleteThreads([threadId]);
          navigation.goBack();
        },
      },
    ]);
  };

  // Close / reopen the loop. Inline UPDATE to match the established
  // thread-row mutation pattern in this screen (rename/delete are inline
  // too: `threads` has no service; the invariant here is just a
  // timestamp). No prompt: closing is a quiet statement, the gesture is
  // the commit. Reversible: cycles recur. Auto rings have no gesture
  // (their loop is intrinsic, derived from `kind`).
  const handleToggleLoop = useCallback(async () => {
    const db = getDb();
    if (!db || !thread || isAutoKind(thread.kind)) return;
    const closing = !thread.closed_at;
    if (closing) hapticClasp(); // the clasp closing the loop
    try {
      await db.runAsync(
        `UPDATE threads
            SET closed_at = ${closing ? "datetime('now')" : 'NULL'},
                updated_at = datetime('now')
          WHERE id = ?`,
        [threadId]
      );
      if (closing) setChainOrientation('loop');
      await load();
    } catch (err) {
      Alert.alert('Could not update', err?.message || String(err));
    }
  }, [thread, threadId, load]);

  // Tap the clasp on a closed loop -> pick a new close date. The clasp's
  // date IS closed_at (what the clasp label shows); auto rings have no
  // closed_at so they never reach here. Stored in SQLite space form at
  // midday so the date is stable regardless of timezone slicing.
  const onClosedDateChange = useCallback(
    async (event, selected) => {
      setClosedDatePickerVisible(false);
      if (event?.type === 'dismissed' || !selected) return;
      const db = getDb();
      if (!db || !thread || isAutoKind(thread.kind) || !thread.closed_at) {
        return;
      }
      try {
        await db.runAsync(
          `UPDATE threads
              SET closed_at = ?, updated_at = datetime('now')
            WHERE id = ?`,
          [`${isoDate(selected)} 12:00:00`, threadId]
        );
        await load();
      } catch (err) {
        Alert.alert('Could not update', err?.message || String(err));
      }
    },
    [thread, threadId, load]
  );

  // Reachability is decided by entry_id alone: the FK is ON DELETE SET NULL,
  // so a non-null entry_id guarantees the source entry still exists. The
  // `isLive` flag passed by the chain only describes whether the entry has a
  // *custom* bead; an auto-thread placeholder bead has no live bead but is
  // still fully reachable, and tapping it should open the entry.
  const handleTapBead = (tb) => {
    if (tb.entry_id) {
      setPreviewEntryId(tb.entry_id);
    } else {
      Alert.alert(
        'No longer linked',
        'The source entry was deleted.'
      );
    }
  };

  // Long-press = open the per-bead action sheet (move / open / remove).
  // Auto-threads can't honor structural changes because their chain is
  // derived (from the day's entries, or from highlight state for the
  // week / month threads). We surface that explicitly instead of
  // showing a sheet whose actions are all disabled.
  const handleLongPressBead = (tb) => {
    if (isAutoKind(thread?.kind)) {
      const msg =
        thread.kind === 'auto_day'
          ? "Beads on auto-day threads come from the day's entries. To remove this bead, delete its source entry."
          : "Beads on weekly and monthly auto-threads come from highlighted entries. To remove this bead, change the entry's highlight in the editor.";
      Alert.alert('Auto-managed', msg);
      return;
    }
    setBeadActionTarget(tb);
  };

  // Swap the position of two adjacent rows in thread_beads. The chain
  // is loaded ORDER BY position ASC, so this is enough to reorder:
  // we don't have to rewrite every row's position like the composer
  // does on full-chain commit.
  const moveBead = async (tb, delta) => {
    const db = getDb();
    if (!db) return;
    const idx = chain.findIndex((c) => c.id === tb.id);
    const targetIdx = idx + delta;
    if (idx < 0 || targetIdx < 0 || targetIdx >= chain.length) return;
    const other = chain[targetIdx];
    try {
      // Three-step swap to dodge any UNIQUE constraint on (thread_id,
      // position): bounce one row to -1 first, then settle. Wrapped in a
      // transaction so a crash mid-swap can't strand a bead at -1.
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          'UPDATE thread_beads SET position = -1 WHERE id = ?',
          [tb.id]
        );
        await db.runAsync(
          'UPDATE thread_beads SET position = ? WHERE id = ?',
          [tb.position, other.id]
        );
        await db.runAsync(
          'UPDATE thread_beads SET position = ? WHERE id = ?',
          [other.position, tb.id]
        );
        await db.runAsync(
          `UPDATE threads SET updated_at = datetime('now') WHERE id = ?`,
          [threadId]
        );
      });
      await load();
    } catch (err) {
      Alert.alert('Could not move', err?.message || String(err));
    }
  };

  // Write the section label for a single thread_beads row. Empty /
  // whitespace-only string clears it (column goes to NULL). Used by
  // the prompt-confirm path; clearing from the action sheet bypasses
  // the prompt entirely.
  const writeSectionLabel = async (tb, label) => {
    const db = getDb();
    if (!db || !tb) return;
    const cleaned = (label || '').trim();
    try {
      await db.runAsync(
        `UPDATE thread_beads SET section_label = ? WHERE id = ?`,
        [cleaned ? cleaned : null, tb.id]
      );
      await db.runAsync(
        `UPDATE threads SET updated_at = datetime('now') WHERE id = ?`,
        [threadId]
      );
      await load();
    } catch (err) {
      Alert.alert('Could not update section', err?.message || String(err));
    }
  };

  const openSectionPrompt = (tb) => {
    setSectionPromptTarget(tb);
    setSectionPromptDraft(tb?.section_label || '');
  };

  const removeBead = (tb) => {
    Alert.alert(
      'Remove bead from thread?',
      'The source entry stays. Only the link from this thread is removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const db = getDb();
            if (!db) return;
            try {
              await db.runAsync('DELETE FROM thread_beads WHERE id = ?', [tb.id]);
              await db.runAsync(
                `UPDATE threads SET updated_at = datetime('now') WHERE id = ?`,
                [threadId]
              );
              await load();
            } catch (err) {
              Alert.alert('Could not remove', err?.message || String(err));
            }
          },
        },
      ]
    );
  };

  // Quick-add: spawn a new entry (today's date, default bead, draft title)
  // and snapshot its bead onto this thread in one tap. The user can tap
  // the new bead afterwards to write content: the editor's normal
  // auto-save flow takes over from there. Auto-day threads are excluded
  // because their chain is derived from the day's entries; a manual
  // append would break the placeholder invariant.
  // End-of-week curation: every entry currently on this week thread gets
  // bumped to tier 2 so the month thread picks them up too. The week
  // thread itself stays in place: promotion is additive, not a move.
  const handlePromoteWeek = () => {
    if (!thread || thread.kind !== 'auto_week') return;
    Alert.alert(
      'Promote week to month?',
      "Each entry that you starred as a weekly highlight on this thread also goes to the auto-thread of the month.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Promote',
          onPress: async () => {
            try {
              const n = await promoteAutoWeekToMonth(threadId);
              await load();
              if (n === 0) {
                Alert.alert(
                  'Already promoted',
                  "These entries were already at monthly highlight. Nothing changed."
                );
              }
            } catch (err) {
              Alert.alert('Could not promote', err?.message || String(err));
            }
          },
        },
      ]
    );
  };

  // Append an existing beaded entry to the end of this thread's chain.
  // Mirrors the composer's chain-commit logic: we snapshot whatever
  // the entry currently looks like so the chain reads coherently even
  // if the source entry's bead changes or the entry is deleted later.
  const handlePickExistingBead = async (entry) => {
    const db = getDb();
    if (!db || !thread || isAutoKind(thread.kind)) return;
    const bead = readBead(entry);
    if (!bead) return;
    try {
      const posRow = await db.getFirstAsync(
        'SELECT COALESCE(MAX(position), -1) AS maxPos FROM thread_beads WHERE thread_id = ?',
        [threadId]
      );
      const nextPos = (posRow?.maxPos ?? -1) + 1;
      await db.runAsync(
        `INSERT INTO thread_beads
          (thread_id, entry_id, position, snapshot_shape, snapshot_pattern, snapshot_mood, snapshot_glyph)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          threadId,
          entry.id,
          nextPos,
          bead.shape,
          bead.pattern,
          bead.mood,
          bead.glyph || '',
        ]
      );
      await db.runAsync(
        `UPDATE threads SET updated_at = datetime('now') WHERE id = ?`,
        [threadId]
      );
      await load();
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd?.({ animated: true });
      });
    } catch (err) {
      Alert.alert('Could not add bead', err?.message || String(err));
    }
  };

  const handleQuickAddBead = async () => {
    if (quickAddBusy || !thread || isAutoKind(thread.kind)) return;
    const db = getDb();
    if (!db) return;
    setQuickAddBusy(true);
    try {
      const now = new Date();
      const dateStr = isoDate(now);
      const draftTitle = `Draft ${formatTimestamp(now)}`;
      const result = await db.runAsync(
        `INSERT INTO entries
           (title, content, date, bead_shape, bead_pattern, bead_mood, bead_glyph)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          draftTitle,
          '',
          dateStr,
          DEFAULT_BEAD.shape,
          DEFAULT_BEAD.pattern,
          DEFAULT_BEAD.mood,
          DEFAULT_BEAD.glyph,
        ]
      );
      const entryId = result.lastInsertRowId;

      const posRow = await db.getFirstAsync(
        'SELECT COALESCE(MAX(position), -1) AS maxPos FROM thread_beads WHERE thread_id = ?',
        [threadId]
      );
      const nextPos = (posRow?.maxPos ?? -1) + 1;
      await db.runAsync(
        `INSERT INTO thread_beads
          (thread_id, entry_id, position, snapshot_shape, snapshot_pattern, snapshot_mood, snapshot_glyph)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          threadId,
          entryId,
          nextPos,
          DEFAULT_BEAD.shape,
          DEFAULT_BEAD.pattern,
          DEFAULT_BEAD.mood,
          DEFAULT_BEAD.glyph,
        ]
      );
      await db.runAsync(
        `UPDATE threads SET updated_at = datetime('now') WHERE id = ?`,
        [threadId]
      );

      // Today's auto-thread should also reflect the new entry.
      await syncAutoBeadForEntry({ id: entryId, date: dateStr });

      await load();

      // Confirmation: scroll the chain so the new bead is in view, and
      // give the FAB a brief pulse so the tap feels acknowledged.
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd?.({ animated: true });
      });
      Animated.sequence([
        Animated.timing(fabPulse, {
          toValue: 1.18,
          duration: 110,
          useNativeDriver: true,
        }),
        Animated.spring(fabPulse, {
          toValue: 1,
          friction: 4,
          useNativeDriver: true,
        }),
      ]).start();
    } catch (err) {
      Alert.alert('Could not add bead', err?.message || String(err));
    } finally {
      setQuickAddBusy(false);
    }
  };

  if (!thread) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backWrap}
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={22} color={colors.primary} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Thread not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backWrap}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        {!isAutoKind(thread.kind) ? (
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
            onPress={() => persistThreadFields(name, description)}
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
        ) : (
          <View style={styles.savingStatus} />
        )}
        <View style={styles.headerActions}>
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
          <TouchableOpacity
            onPress={() => setExportSheetVisible(true)}
            style={styles.headerBtn}
            hitSlop={8}
            accessibilityLabel="Export thread"
          >
            <Ionicons name="share-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
          {isAutoKind(thread.kind) ? null : (
            <TouchableOpacity
              onPress={handleToggleLoop}
              style={styles.headerBtn}
              hitSlop={8}
              accessibilityLabel={
                thread.closed_at
                  ? 'Reopen this loop'
                  : 'Close the loop (mark this thread a completed cycle)'
              }
            >
              <Ionicons
                name={thread.closed_at ? 'ellipse' : 'ellipse-outline'}
                size={20}
                color={colors.primary}
              />
            </TouchableOpacity>
          )}
          {isAutoKind(thread.kind) ? null : (
            <TouchableOpacity
              onPress={handleDelete}
              style={styles.headerBtn}
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Sticky title block: mirrors EntryEditorScreen's pattern so
          the thread name + meta strip stay visible while the chain
          scrolls. Sits between the header bar and the scrollable
          body; chain orientation pill, description, and chain itself
          all live in the scroll. */}
      <View style={styles.stickyTitleBlock}>
        <TextInput
          style={styles.title}
          value={name}
          onChangeText={setName}
          onFocus={() => setNameFocused(true)}
          onBlur={() => setNameFocused(false)}
          placeholder="Untitled"
          placeholderTextColor={colors.placeholder}
          editable={!isAutoKind(thread.kind)}
          multiline={false}
          accessibilityLabel="Thread name"
        />
        <View style={styles.metaStrip}>
          <TouchableOpacity
            style={styles.metaItem}
            onPress={() => {
              if (isAutoKind(thread.kind)) {
                Alert.alert(
                  'Auto-managed',
                  "An auto-thread anchors itself to a date. You cannot change its anchor."
                );
                return;
              }
              setAnchorSheetVisible(true);
            }}
            accessibilityLabel={`Anchor: ${anchorLabel(thread)}. Tap to change.`}
            hitSlop={6}
          >
            <Ionicons
              name="calendar-outline"
              size={13}
              color={colors.textMuted}
            />
            <Text style={styles.metaText} numberOfLines={1}>
              {anchorLabel(thread)}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.metaItem}
            onPress={() => setCollectionPickerVisible(true)}
            accessibilityLabel={
              threadCollections.length === 0
                ? 'No collections. Tap to add.'
                : `In collections: ${threadCollections.map((c) => c.name).join(', ')}. Tap to change.`
            }
            hitSlop={6}
          >
            <Ionicons
              name="folder-outline"
              size={13}
              color={colors.textMuted}
            />
            <Text style={styles.metaText} numberOfLines={1}>
              {threadCollections.length === 0
                ? 'No collection'
                : threadCollections.map((c) => c.name).join(' · ')}
            </Text>
          </TouchableOpacity>
          {/* Bead-count chip: tappable on user threads (jumps to
              Home pre-scoped to this thread via the pinned-thread
              pill); informational on auto-threads. The icon swap
              (list-outline ↔ ellipse-outline) is the affordance
              signal, the same idiom as funnel-outline ↔ funnel for
              filter-on; without it the count reads as pure
              metadata. Reuses the metaStrip chip slot rather than
              adding a sibling button, which keeps the orientation pill
              (Beaded line / Stacked / Loop) purely about
              chain-walking modes. */}
          {!isAutoKind(thread.kind) ? (
            <TouchableOpacity
              style={styles.metaItem}
              onPress={() =>
                // `pinNonce` is a per-tap idempotency token consumed by
                // HomeScreen: only navigations whose nonce hasn't been
                // seen before pin the thread. Without it, the route's
                // `pinThreadId` can re-present itself on focus return
                // (after a Settings round-trip, for example) and the
                // consumer effect would re-pin a thread the user has
                // already dismissed via the pill's ×.
                navigation.navigate('Home', {
                  pinThreadId: thread.id,
                  pinNonce: Date.now(),
                })
              }
              accessibilityLabel={`${chain.length} ${
                chain.length === 1 ? 'bead' : 'beads'
              }. Tap to read as a list on Home.`}
              hitSlop={6}
            >
              <Ionicons
                name="list-outline"
                size={13}
                color={colors.textMuted}
              />
              <Text style={styles.metaText}>
                {chain.length} {chain.length === 1 ? 'bead' : 'beads'}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.metaItem}>
              <Ionicons
                name="ellipse-outline"
                size={13}
                color={colors.textMuted}
              />
              <Text style={styles.metaText}>
                {chain.length} {chain.length === 1 ? 'bead' : 'beads'}
              </Text>
            </View>
          )}
          {/* Inbound mentions ("@ N"). Hidden at zero: no chrome for the
              common/auto-thread case; the @ glyph ties it to the
              user-facing "Mentions". Tap → the read-only Mentioned-by
              drawer (same count-chip → drawer idiom as comments). */}
          {mentionedBy.length > 0 ? (
            <TouchableOpacity
              style={styles.metaItem}
              onPress={() => setMentionedByVisible(true)}
              accessibilityLabel={`Mentioned by ${mentionedBy.length} ${
                mentionedBy.length === 1 ? 'entry' : 'entries'
              }. Tap to view.`}
              hitSlop={6}
            >
              <Ionicons name="at-outline" size={13} color={colors.textMuted} />
              <Text style={styles.metaText}>{mentionedBy.length}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.body,
          // +88 clears the undo bar while it's up (same as the editor).
          { paddingBottom: keyboardInset + (undoBarVisible ? 88 : 40) },
        ]}
        onLayout={(e) => {
          scrollViewportHRef.current = e.nativeEvent.layout.height;
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {isAutoKind(thread.kind) ? (
          thread.description ? (
            <View style={styles.descriptionReadWrap}>
              <MarkdownText>{thread.description}</MarkdownText>
            </View>
          ) : null
        ) : !descriptionFocused && description && description.trim().length > 0 ? (
          <TouchableOpacity
            style={styles.descriptionReadWrap}
            activeOpacity={1}
            onPress={() => {
              const clamp = (v) =>
                Math.max(0, Math.min(description.length, v ?? 0));
              const ls = descriptionLastSelectionRef.current;
              const sel =
                wasDescriptionFocusedRef.current && ls && typeof ls.start === 'number'
                  ? { start: clamp(ls.start), end: clamp(ls.end ?? ls.start) }
                  : { start: description.length, end: description.length };
              setDescriptionPendingSelection(sel);
              setDescriptionFocused(true);
              requestAnimationFrame(() => {
                descriptionInputRef.current?.focus();
                requestAnimationFrame(() =>
                  setDescriptionPendingSelection(null)
                );
              });
            }}
            accessibilityLabel="Tap to edit description"
          >
            <MarkdownText>{description}</MarkdownText>
          </TouchableOpacity>
        ) : (
          <TextInput
            ref={descriptionInputRef}
            style={styles.descriptionInput}
            value={description}
            onChangeText={setDescription}
            onFocus={() => {
              setDescriptionFocused(true);
              wasDescriptionFocusedRef.current = true;
            }}
            onBlur={() => setDescriptionFocused(false)}
            onLayout={(e) => {
              descInputYRef.current = e.nativeEvent.layout.y;
            }}
            onContentSizeChange={(e) => {
              descContentHRef.current =
                e?.nativeEvent?.contentSize?.height || 0;
            }}
            onSelectionChange={(e) => {
              const sel = e?.nativeEvent?.selection;
              if (!sel) return;
              descriptionLastSelectionRef.current = sel;
              if (keyboardInset > 0) scrollDescToCursorRef.current();
            }}
            selection={descriptionPendingSelection || undefined}
            placeholder="What is this thread about?"
            placeholderTextColor={colors.placeholder}
            multiline
            textAlignVertical="top"
            scrollEnabled={false}
            accessibilityLabel="Thread description"
          />
        )}

        {isAutoKind(thread.kind) ? (
          <View style={styles.autoBanner}>
            <Ionicons
              name="sparkles-outline"
              size={14}
              color={colors.textMuted}
            />
            <Text style={styles.autoBannerText}>
              {autoBannerCopy(thread.kind)}
            </Text>
          </View>
        ) : null}

        {thread.kind === 'auto_week' && chain.length > 0 ? (
          <TouchableOpacity
            style={styles.promoteRow}
            onPress={handlePromoteWeek}
            activeOpacity={0.7}
            accessibilityLabel="Promote this week's highlights to monthly"
          >
            <Ionicons name="arrow-up-circle-outline" size={16} color={colors.primary} />
            <Text style={styles.promoteRowText}>Promote week to month</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.chainHeader}>
          <View style={styles.orientationPill}>
            <TouchableOpacity
              onPress={() => {
                if (chainOrientation === 'horizontal') return;
                setExpandedKey(null);
                setChainOrientation('horizontal');
              }}
              style={[
                styles.orientationCell,
                chainOrientation === 'horizontal' &&
                  styles.orientationCellActive,
              ]}
              accessibilityLabel="Show chain as a beaded line"
              hitSlop={4}
            >
              <Text
                style={[
                  styles.orientationCellText,
                  chainOrientation === 'horizontal' &&
                    styles.orientationCellTextActive,
                ]}
              >
                Beaded line
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (chainOrientation === 'vertical') return;
                setExpandedKey(null);
                setChainOrientation('vertical');
              }}
              style={[
                styles.orientationCell,
                chainOrientation === 'vertical' &&
                  styles.orientationCellActive,
              ]}
              accessibilityLabel="Show chain stacked vertically"
              hitSlop={4}
            >
              <Text
                style={[
                  styles.orientationCellText,
                  chainOrientation === 'vertical' &&
                    styles.orientationCellTextActive,
                ]}
              >
                Stacked
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                if (chainOrientation === 'loop') return;
                setExpandedKey(null);
                setChainOrientation('loop');
              }}
              style={[
                styles.orientationCell,
                chainOrientation === 'loop' &&
                  styles.orientationCellActive,
              ]}
              accessibilityLabel="Show chain as a closed loop"
              hitSlop={4}
            >
              <Text
                style={[
                  styles.orientationCellText,
                  chainOrientation === 'loop' &&
                    styles.orientationCellTextActive,
                ]}
              >
                Loop
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <PanGestureHandler
          activeOffsetX={[-14, 14]}
          failOffsetY={[-12, 12]}
          onGestureEvent={onScrubEvent}
          onHandlerStateChange={onScrubState}
        >
          <View collapsable={false}>
        {chain.length === 0 ? (
          <Text style={styles.chainEmpty}>No beads in this thread.</Text>
        ) : chainOrientation === 'horizontal' ? (
          <BeadChain
            beadSize={CHAIN_BEAD_SIZE}
            connectorColor={colors.borderStrong}
            capColor={colors.borderStrong}
            items={chain.map((tb) => {
              const live = readBead({
                bead_shape: tb.bead_shape,
                bead_pattern: tb.bead_pattern,
                bead_mood: tb.bead_mood,
                bead_glyph: tb.bead_glyph,
              });
              const fallback = {
                shape: tb.snapshot_shape,
                pattern: tb.snapshot_pattern,
                mood: tb.snapshot_mood,
                glyph: tb.snapshot_glyph,
              };
              const display = live || fallback;
              const isLive = Boolean(live && tb.entry_id);
              return {
                key: String(tb.id),
                bead: display,
                faded: !isLive,
                sectionLabel: tb.section_label || null,
                hasComments: (tb.entry_comment_count || 0) > 0,
                onTap: () => handleTapBead(tb),
                onLongPress: () => handleLongPressBead(tb),
              };
            })}
          />
        ) : chainOrientation === 'loop' ? (
          <LoopBeadChain
            beadSize={LOOP_BEAD_SIZE}
            connectorColor={colors.borderStrong}
            capColor={colors.borderStrong}
            jointColor={colors.primary}
            closed={
              Boolean(thread.closed_at) ||
              thread.kind === 'auto_week' ||
              thread.kind === 'auto_month'
            }
            claspLabel={
              thread.closed_at && !isAutoKind(thread.kind)
                ? `Closed · ${String(thread.closed_at).slice(0, 10)}`
                : thread.anchor_kind && thread.anchor_kind !== 'none'
                  ? anchorLabel(thread)
                  : null
            }
            onClaspPress={
              thread.closed_at && !isAutoKind(thread.kind)
                ? () => setClosedDatePickerVisible(true)
                : undefined
            }
            items={chain.map((tb) => {
              const live = readBead({
                bead_shape: tb.bead_shape,
                bead_pattern: tb.bead_pattern,
                bead_mood: tb.bead_mood,
                bead_glyph: tb.bead_glyph,
              });
              const fallback = {
                shape: tb.snapshot_shape,
                pattern: tb.snapshot_pattern,
                mood: tb.snapshot_mood,
                glyph: tb.snapshot_glyph,
              };
              const display = live || fallback;
              const isLive = Boolean(live && tb.entry_id);
              return {
                key: String(tb.id),
                bead: display,
                faded: !isLive,
                sectionLabel: tb.section_label || null,
                hasComments: (tb.entry_comment_count || 0) > 0,
                onTap: () => handleTapBead(tb),
                onLongPress: () => handleLongPressBead(tb),
              };
            })}
          />
        ) : (
          <VerticalBeadChain
            items={chain.map((tb) => {
              const live = readBead({
                bead_shape: tb.bead_shape,
                bead_pattern: tb.bead_pattern,
                bead_mood: tb.bead_mood,
                bead_glyph: tb.bead_glyph,
              });
              const fallback = {
                shape: tb.snapshot_shape,
                pattern: tb.snapshot_pattern,
                mood: tb.snapshot_mood,
                glyph: tb.snapshot_glyph,
              };
              const display = live || fallback;
              const isLive = Boolean(live && tb.entry_id);
              return {
                key: String(tb.id),
                entryId: tb.entry_id,
                bead: display,
                faded: !isLive,
                tb,
                sectionLabel: tb.section_label || null,
                hasComments: (tb.entry_comment_count || 0) > 0,
                entry: {
                  title: tb.entry_title,
                  content: tb.entry_content,
                  is_private: tb.entry_is_private,
                  commentCount: tb.entry_comment_count || 0,
                },
              };
            })}
            expandedKey={expandedKey}
            onChangeExpanded={setExpandedKey}
            onOpenEntry={(entryId) =>
              navigation.navigate('EntryEditor', {
                entryId,
                threadWalk: threadWalkParam,
              })
            }
            onLongPressItem={(item) => handleLongPressBead(item.tb)}
          />
        )}
          </View>
        </PanGestureHandler>
      </ScrollView>

      {!isAutoKind(thread.kind) ? (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.fabWrap, { transform: [{ scale: fabPulse }] }]}
        >
          <TouchableOpacity
            onPress={() => setFabSheetVisible(true)}
            disabled={quickAddBusy}
            activeOpacity={0.85}
            accessibilityLabel="Add a bead to this thread"
            style={[styles.fab, quickAddBusy && styles.fabDisabled]}
          >
            <Ionicons name="add" size={28} color={colors.primaryOnPrimary} />
          </TouchableOpacity>
        </Animated.View>
      ) : null}

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

      <EditHistorySheet
        visible={historySheetVisible}
        history={historyRef.current}
        onPreview={previewHistorySnapshot}
        onRestore={restoreFromHistory}
        onClose={closeHistorySheet}
      />

      <EntryPreviewDrawer
        entryId={previewEntryId}
        onClose={() => setPreviewEntryId(null)}
        onOpen={(id) => {
          setPreviewEntryId(null);
          navigation.navigate('EntryEditor', {
            entryId: id,
            threadWalk: threadWalkParam,
          });
        }}
      />

      <CollectionPickerSheet
        visible={collectionPickerVisible}
        thread={thread}
        onChange={load}
        onClose={() => setCollectionPickerVisible(false)}
      />

      <ThreadExportSheet
        visible={exportSheetVisible}
        threadId={threadId}
        initialFormat={exportInitialFormat}
        onClose={() => {
          setExportSheetVisible(false);
          setExportInitialFormat(null);
        }}
        onCustomizeLayout={(format) => {
          pendingExportReturnRef.current = format;
          setExportSheetVisible(false);
          navigation.navigate('ThreadArticleComposer', { threadId });
        }}
      />

      <CommentsDrawer
        visible={commentsVisible}
        parentKind={PARENT_THREAD}
        parentId={threadId}
        parentLabel={thread?.name || 'Thread'}
        onClose={() => {
          setCommentsVisible(false);
          load();
        }}
        onCommentsChanged={load}
      />

      <MentionedByDrawer
        visible={mentionedByVisible}
        entries={mentionedBy}
        onClose={() => setMentionedByVisible(false)}
        onOpenEntry={(entryId) => {
          setMentionedByVisible(false);
          navigation.navigate('EntryEditor', { entryId });
        }}
      />

      <AnchorSheet
        visible={anchorSheetVisible}
        thread={thread}
        onChange={load}
        onClose={() => setAnchorSheetVisible(false)}
      />

      {closedDatePickerVisible && thread?.closed_at ? (
        <DateTimePicker
          value={(() => {
            const d = new Date(String(thread.closed_at).replace(' ', 'T'));
            return Number.isNaN(d.getTime()) ? new Date() : d;
          })()}
          mode="date"
          onChange={onClosedDateChange}
        />
      ) : null}

      <BeadActionSheet
        target={beadActionTarget}
        chain={chain}
        orientation={chainOrientation}
        onClose={() => setBeadActionTarget(null)}
        onMove={(tb, delta) => {
          setBeadActionTarget(null);
          moveBead(tb, delta);
        }}
        onOpen={(tb) => {
          setBeadActionTarget(null);
          if (tb.entry_id) {
            setPreviewEntryId(tb.entry_id);
          } else {
            Alert.alert(
              'No longer linked',
              'The source entry was deleted.'
            );
          }
        }}
        onRemove={(tb) => {
          setBeadActionTarget(null);
          removeBead(tb);
        }}
        onMarkSection={(tb) => {
          setBeadActionTarget(null);
          openSectionPrompt(tb);
        }}
        onRenameSection={(tb) => {
          setBeadActionTarget(null);
          openSectionPrompt(tb);
        }}
        onClearSection={(tb) => {
          setBeadActionTarget(null);
          writeSectionLabel(tb, '');
        }}
      />

      <SectionLabelPrompt
        target={sectionPromptTarget}
        draft={sectionPromptDraft}
        onChangeDraft={setSectionPromptDraft}
        onCancel={() => setSectionPromptTarget(null)}
        onConfirm={() => {
          const tb = sectionPromptTarget;
          setSectionPromptTarget(null);
          writeSectionLabel(tb, sectionPromptDraft);
        }}
      />

      <FabChooserSheet
        visible={fabSheetVisible}
        busy={quickAddBusy}
        onClose={() => setFabSheetVisible(false)}
        onQuickAdd={() => {
          setFabSheetVisible(false);
          handleQuickAddBead();
        }}
        onPickExisting={() => {
          setFabSheetVisible(false);
          setPickerVisible(true);
        }}
      />

      <BeadPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onPick={(entry) => {
          setPickerVisible(false);
          handlePickExistingBead(entry);
        }}
      />
    </View>
  );
}

function BeadActionSheet({
  target,
  chain,
  orientation,
  onClose,
  onMove,
  onOpen,
  onRemove,
  onMarkSection,
  onRenameSection,
  onClearSection,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeActionSheetStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const visible = target != null;
  const idx = useMemo(
    () => (target ? chain.findIndex((c) => c.id === target.id) : -1),
    [target, chain]
  );
  const isFirst = idx <= 0;
  const isLast = idx < 0 || idx >= chain.length - 1;

  const vertical = orientation === 'vertical';
  const moveBackIcon = vertical ? 'arrow-up' : 'arrow-back';
  const moveFwdIcon = vertical ? 'arrow-down' : 'arrow-forward';
  const moveBackLabel = vertical ? 'Move up' : 'Move left';
  const moveFwdLabel = vertical ? 'Move down' : 'Move right';

  if (!target) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom + 8) }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          <TouchableOpacity
            style={[styles.row, isFirst && styles.rowDisabled]}
            disabled={isFirst}
            onPress={() => onMove(target, -1)}
          >
            <Ionicons
              name={moveBackIcon}
              size={18}
              color={isFirst ? colors.textFaint : colors.text}
            />
            <Text
              style={[
                styles.rowText,
                isFirst && styles.rowTextDisabled,
              ]}
            >
              {moveBackLabel}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.row, isLast && styles.rowDisabled]}
            disabled={isLast}
            onPress={() => onMove(target, 1)}
          >
            <Ionicons
              name={moveFwdIcon}
              size={18}
              color={isLast ? colors.textFaint : colors.text}
            />
            <Text
              style={[
                styles.rowText,
                isLast && styles.rowTextDisabled,
              ]}
            >
              {moveFwdLabel}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => onOpen(target)}>
            <Ionicons
              name="open-outline"
              size={18}
              color={colors.text}
            />
            <Text style={styles.rowText}>Open source entry</Text>
          </TouchableOpacity>
          <View style={styles.separator} />
          {target.section_label ? (
            <>
              <TouchableOpacity
                style={styles.row}
                onPress={() => onRenameSection(target)}
              >
                <Ionicons
                  name="bookmark"
                  size={18}
                  color={colors.text}
                />
                <Text style={styles.rowText}>Rename section header</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.row}
                onPress={() => onClearSection(target)}
              >
                <Ionicons
                  name="bookmark-outline"
                  size={18}
                  color={colors.textMuted}
                />
                <Text style={styles.rowText}>Clear section header</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={styles.row}
              onPress={() => onMarkSection(target)}
            >
              <Ionicons
                name="bookmark-outline"
                size={18}
                color={colors.text}
              />
              <Text style={styles.rowText}>Mark as section header</Text>
            </TouchableOpacity>
          )}
          <View style={styles.separator} />
          <TouchableOpacity
            style={styles.row}
            onPress={() => onRemove(target)}
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
            <Text style={[styles.rowText, styles.rowTextDanger]}>
              Remove from thread
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Tiny center-card modal that collects (or edits) a section label for a
// thread_beads row. Confirm with empty input → still confirms (the
// parent's writeSectionLabel treats empty as clear), which gives users
// a one-tap way to remove the label from the prompt itself. Visual is
// the same card-style as YearMonthPicker so it reads as a sibling
// affordance.
function SectionLabelPrompt({ target, draft, onChangeDraft, onCancel, onConfirm }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makePromptStyles(colors), [colors]);
  const keyboardInset = useKeyboardInset();
  const visible = target != null;
  const isRename = visible && !!target?.section_label;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable
        style={[
          styles.backdrop,
          keyboardInset > 0 && { paddingBottom: keyboardInset },
        ]}
        onPress={onCancel}
      >
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>
            {isRename ? 'Rename section' : 'Name this section'}
          </Text>
          <Text style={styles.subtitle}>
            This bead is the start of the section in the chain.
          </Text>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={onChangeDraft}
            placeholder="Section name"
            placeholderTextColor={colors.placeholder}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={onConfirm}
          />
          <View style={styles.actions}>
            <TouchableOpacity onPress={onCancel} style={styles.btnGhost}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onConfirm} style={styles.btnPrimary}>
              <Text style={styles.btnPrimaryText}>Save</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makePromptStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    card: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
    },
    title: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 4,
    },
    subtitle: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
      marginBottom: 12,
    },
    input: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 15,
      borderWidth: 1,
      borderColor: colors.border,
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 16,
    },
    btnGhost: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 8,
    },
    btnGhostText: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '600',
    },
    btnPrimary: {
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.primary,
    },
    btnPrimaryText: {
      color: colors.primaryOnPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
  });

function FabChooserSheet({ visible, busy, onClose, onQuickAdd, onPickExisting }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeActionSheetStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom + 8) }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          <TouchableOpacity
            style={[styles.row, busy && styles.rowDisabled]}
            disabled={busy}
            onPress={onQuickAdd}
          >
            <Ionicons name="add-circle-outline" size={18} color={colors.text} />
            <View style={styles.rowTextStack}>
              <Text style={styles.rowText}>Quick-add new entry</Text>
              <Text style={styles.rowSubText}>
                Make a draft entry for today and add it to this thread.
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={onPickExisting}>
            <Ionicons name="albums-outline" size={18} color={colors.text} />
            <View style={styles.rowTextStack}>
              <Text style={styles.rowText}>Pick an existing bead</Text>
              <Text style={styles.rowSubText}>
                Add an entry that already has a bead to the end of the chain.
              </Text>
            </View>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeActionSheetStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
      paddingBottom: 24,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      alignSelf: 'center',
      marginBottom: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    rowDisabled: {
      opacity: 0.4,
    },
    rowText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '500',
    },
    rowTextDisabled: {
      color: colors.textFaint,
    },
    rowTextDanger: {
      color: colors.danger,
    },
    rowTextStack: {
      flex: 1,
    },
    rowSubText: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 2,
    },
    separator: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 4,
      marginHorizontal: 20,
    },
  });

function EntryPreviewDrawer({ entryId, onClose, onOpen }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeDrawerStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [entry, setEntry] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [voiceNotes, setVoiceNotes] = useState([]);

  useEffect(() => {
    if (entryId == null) {
      setEntry(null);
      setPhotos([]);
      setVoiceNotes([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const db = getDb();
      if (!db) return;
      const e = await db.getFirstAsync(
        'SELECT * FROM entries WHERE id = ?',
        [entryId]
      );
      if (cancelled) return;
      setEntry(e || null);
      const ph = await db.getAllAsync(
        'SELECT uri FROM entry_photos WHERE entry_id = ?',
        [entryId]
      );
      const vn = await db.getAllAsync(
        'SELECT uri, duration FROM entry_voice_notes WHERE entry_id = ?',
        [entryId]
      );
      if (cancelled) return;
      setPhotos(ph);
      setVoiceNotes(vn);
    })();
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const visible = entryId != null;
  const bead = entry ? readBead(entry) : null;
  const priv = isPrivate(entry);
  const previewTitle = priv ? MASKED_TITLE : entry?.title || 'Untitled';
  const excerpt = priv
    ? ''
    : (entry?.content || '').replace(/\s+/g, ' ').trim();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          {entry ? (
            <>
            <ScrollView
              style={styles.sheetScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.sheetContent}
            >
              <View style={styles.headerRow}>
                {bead ? <BeadView bead={bead} size={32} /> : null}
                <View style={styles.headerInfo}>
                  <Text style={styles.previewDate}>{entry.date}</Text>
                  <Text
                    style={[
                      styles.previewTitle,
                      priv && { fontStyle: 'italic', color: colors.textMuted },
                    ]}
                    numberOfLines={1}
                  >
                    {previewTitle}
                  </Text>
                </View>
              </View>

              {excerpt ? (
                <Text style={styles.previewContent} numberOfLines={6}>
                  {excerpt}
                </Text>
              ) : (
                <Text style={styles.previewEmpty}>No content</Text>
              )}

              {photos.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.photoStrip}
                >
                  {photos.map((p, i) => (
                    <Image
                      key={i}
                      source={{ uri: p.uri }}
                      style={styles.photoThumb}
                    />
                  ))}
                </ScrollView>
              ) : null}

              {voiceNotes.length > 0 ? (
                <View style={styles.metaRow}>
                  <Ionicons
                    name="mic-outline"
                    size={14}
                    color={colors.textMuted}
                  />
                  <Text style={styles.metaText}>
                    {voiceNotes.length} voice note
                    {voiceNotes.length === 1 ? '' : 's'}
                  </Text>
                </View>
              ) : null}

            </ScrollView>
            <View style={styles.sheetFooter}>
              <TouchableOpacity
                style={styles.openBtn}
                onPress={() => onOpen(entry.id)}
              >
                <Text style={styles.openBtnText}>Open note</Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.primaryOnPrimary}
                />
              </TouchableOpacity>
            </View>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
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
      paddingBottom: 16,
    },
    backWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      width: 60,
    },
    backText: {
      color: colors.primary,
      fontSize: 16,
      marginLeft: 2,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    headerBtn: {
      padding: 4,
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
    body: {
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 60,
    },
    // Sticky region containing the thread name + meta strip. Mirrors
    // EntryEditorScreen's stickyHeader pattern so the title stays
    // visible while the chain scrolls. Hairline at the bottom marks
    // the boundary between sticky header and scrollable body.
    stickyTitleBlock: {
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '700',
      marginBottom: 6,
      // No visible chrome: the title reads as plain text until the
      // user taps it; then the OS cursor is the only affordance change.
      paddingVertical: 0,
      paddingHorizontal: 0,
    },
    metaStrip: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 12,
      marginBottom: 0,
    },
    metaItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      maxWidth: 220,
    },
    metaText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '500',
    },
    description: {
      color: colors.textMuted,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 16,
    },
    descriptionReadWrap: {
      marginBottom: 16,
    },
    descriptionInput: {
      // Always-rendered editable description on user threads. No
      // visible chrome: placeholder text invites a tap; once typed,
      // it auto-grows like a normal multiline TextInput.
      color: colors.textMuted,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 16,
      paddingVertical: 0,
      paddingHorizontal: 0,
      textAlignVertical: 'top',
    },
    autoBanner: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'flex-start',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      padding: 10,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    autoBannerText: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 18,
    },
    promoteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
      paddingVertical: 8,
      paddingHorizontal: 14,
      marginBottom: 16,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    promoteRowText: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '700',
    },
    chainHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
      marginBottom: 12,
    },
    // iOS-style two-cell segmented control. The pill is the outer
    // surface (faint background, rounded); each cell is a borderless
    // tab that fills with primary when active. Same colors as the
    // anchor chips in AnchorSheet so the toggle reads as part of the
    // same UI vocabulary.
    orientationPill: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 2,
      gap: 2,
    },
    orientationCell: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 14,
    },
    orientationCellActive: {
      backgroundColor: colors.primary,
    },
    orientationCellText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    orientationCellTextActive: {
      color: colors.primaryOnPrimary,
    },
    chainEmpty: {
      color: colors.textFaint,
      fontSize: 13,
      fontStyle: 'italic',
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 16,
    },
    // Save-state readout: the same recipe as EntryEditorScreen's; flex:1 fills
    // the band between Back and the header actions.
    savingStatus: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 20,
      marginLeft: 12,
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
    // S15 keyboard accessory bar: the same recipe as EntryEditorScreen:
    // absolutely positioned, `bottom` set inline to keyboardBottomOffset.
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
    fabWrap: {
      position: 'absolute',
      right: 22,
      bottom: 28,
    },
    fab: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 5,
    },
    fabDisabled: { opacity: 0.55 },
  });

const makeDrawerStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      // Grow with content up to a cap (was a fixed 33%, which clipped the
      // Open button on tall notes). The scrollable region shrinks within
      // this cap; the footer button is pinned outside it, always reachable.
      maxHeight: '85%',
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
    },
    // flexShrink lets the scroll area give up space to the pinned footer
    // when content exceeds the sheet's maxHeight (instead of pushing the
    // button off-screen). Short notes keep a compact sheet (no forced grow).
    sheetScroll: {
      flexShrink: 1,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      alignSelf: 'center',
      marginBottom: 8,
    },
    sheetContent: {
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    // Pinned footer holding the Open button. It sits below the ScrollView so
    // it stays visible no matter how tall the note's text + photos are.
    sheetFooter: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 20,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 12,
    },
    headerInfo: {
      flex: 1,
    },
    previewDate: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    previewTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
      marginTop: 2,
    },
    previewContent: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 12,
    },
    previewEmpty: {
      color: colors.textFaint,
      fontSize: 13,
      fontStyle: 'italic',
      marginBottom: 12,
    },
    photoStrip: {
      gap: 6,
      paddingVertical: 4,
      marginBottom: 12,
    },
    photoThumb: {
      width: 64,
      height: 64,
      borderRadius: 8,
      marginRight: 6,
      backgroundColor: colors.surfaceMuted,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 12,
    },
    metaText: {
      color: colors.textMuted,
      fontSize: 13,
    },
    openBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.primary,
      paddingVertical: 12,
      borderRadius: 10,
      marginTop: 4,
    },
    openBtnText: {
      color: colors.primaryOnPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
  });
