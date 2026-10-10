import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  TextInput,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import ThreadCard, { loadThreadPreview } from './ThreadCard';
import CollectionFormSheet from './CollectionFormSheet';
import CollectionFilterSheet from './CollectionFilterSheet';
import CollectionPickerSheet from './CollectionPickerSheet';
import CollectionActionsSheet from './CollectionActionsSheet';
import CommentsDrawer from './CommentsDrawer';
import ExistingThreadsPicker from './ExistingThreadsPicker';
import { getDb } from '../database/db';
import { isAutoThreadEnabled } from '../services/autoThread';
import {
  loadCommentCounts,
  loadCommentPreviews,
  PARENT_THREAD,
} from '../services/comments';
import {
  countThreadsInCollection,
  deleteCollection,
} from '../services/collections';
import {
  groupIntoBands,
  groupIntoAlphaBands,
  isoDateFromSqlDatetime,
} from '../utils/timeBands';
import {
  loadQuietThreshold,
  QUIET_DEFAULT_THRESHOLD_DAYS,
} from '../utils/quietThreads';
import { useTheme } from '../theme';

const KIND_FILTERS = [
  { key: 'user',   label: 'User'   },
  { key: 'days',   label: 'Days'   },
  { key: 'weeks',  label: 'Weeks'  },
  { key: 'months', label: 'Months' },
  { key: 'all',    label: 'All'    },
];

// Filters that target a specific auto-thread kind. The `autoEnabled`
// "auto-thread creation is off" empty-state applies to all of these.
const AUTO_FILTER_KIND = {
  days: 'auto_day',
  weeks: 'auto_week',
  months: 'auto_month',
};

// Threads-list sort preference. 'recent' = updated_at DESC (default, the
// existing behaviour). 'alpha' = name A–Z, which makes a naming convention
// (`Person · …`, `Proj · …`) cluster into legible sub-sections. Only the
// User kind honours 'alpha': auto-thread names are date-formatted, so
// they always stay anchor-date sorted regardless of this toggle.
const SORT_MODE_KEY = 'vakana_threads_sort_mode';

// R2: "Quiet" band. A user thread whose `updated_at` is older than the
// configured threshold AND is not closed (`closed_at IS NULL`) is broken
// out into a tail section labelled `QUIET · {N}d+` at the bottom of the
// User / Recent view. The threshold is user-configurable
// (`Settings → Threads → Quiet threshold`), persisted in expo-secure-store
// via `src/utils/quietThreads.js`, and re-read on mount + focus so a
// change in Settings reflects immediately on return. Default 180 days.
// Derived split only: not a new kindFilter pill, not a schema column.

// True when an SQLite space-separated `updated_at` ('YYYY-MM-DD HH:MM:SS',
// UTC) is older than `thresholdDays`. Returns false for null/garbled
// values (defensive: the schema default always sets it). Closed threads
// (`closed_at IS NOT NULL`) are always excluded by the caller; this helper
// only answers the recency question. Threshold is passed in (rather than
// closed over a module-level constant) so the `sections` useMemo can
// depend on it explicitly.
function isQuietUpdatedAt(updatedAt, thresholdDays) {
  if (!updatedAt || typeof updatedAt !== 'string') return false;
  // SQLite's datetime() output is UTC; appending 'Z' parses it as UTC
  // (mirrors `isoDateFromSqlDatetime` in timeBands.js).
  const t = Date.parse(updatedAt.replace(' ', 'T') + (updatedAt.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(t)) return false;
  return Date.now() - t > thresholdDays * 86400 * 1000;
}

export default function ThreadsList({
  onOpenThread,
  navigation,
  inlineComments = false,
  onToggleInlineComments,
  // Multi-select hooks driven by HomeScreen (long-press a card → enter
  // select mode; tap additional cards → toggle). When `selectMode` is on,
  // the row Swipeable + long-press are bypassed so the user can sweep
  // through the list selecting without triggering Comment/Delete or the
  // collection picker. Reuses the same `selectedIds` Set the entry list
  // uses: HomeScreen owns the state.
  selectMode = false,
  selectedIds = null,
  onLongPressThread,
  onSelectToggleThread,
  // Bumped by HomeScreen after a batch op so this list reloads even when
  // no focus event fires (we're already on the threads view).
  refreshTick = 0,
  // Lifts the *filtered* thread count up so the Home header subtitle can
  // densify ("5 Threads of life"). Fired whenever `threads.length`
  // settles after a load. The count tracks kindFilter / collection /
  // search / sort, exactly the same applied-filter shape the user sees
  // in the list view's count.
  onCountChange,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [threads, setThreads] = useState([]);
  const [collections, setCollections] = useState([]);
  const [kindFilter, setKindFilter] = useState('user');
  // Multi-select collection filter. Empty set = no filter (show all).
  // One-or-more selected = show threads in ANY of them (union). The
  // `Set` identity changes only when the selection actually changes, so
  // a derived stable string key (`collectionKey`) is what feeds effect
  // and useCallback deps, never the Set object.
  const [selectedCollections, setSelectedCollections] = useState(
    () => new Set()
  );
  const [autoEnabled, setAutoEnabledLocal] = useState(true);
  // Quiet-band threshold (R2). Loaded from secure-store on mount + focus
  // so a change made in Settings → Threads reflects on the next return.
  const [quietThresholdDays, setQuietThresholdDays] = useState(
    QUIET_DEFAULT_THRESHOLD_DAYS
  );
  const [collectionFormVisible, setCollectionFormVisible] = useState(false);
  const [collectionSheetVisible, setCollectionSheetVisible] = useState(false);
  const [collectionPickerThread, setCollectionPickerThread] = useState(null);
  const [commentsThread, setCommentsThread] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Debounced mirror of searchQuery: the actual reload trigger. Typing
  // no longer fires a full reload per keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sortMode, setSortMode] = useState('recent');
  const [fabChooserVisible, setFabChooserVisible] = useState(false);
  // Lazy bead-chain previews: list rows paint immediately; each card
  // fetches its own chain on mount (only the ~visible rows, thanks to
  // virtualization) and the result is cached for the screen session so
  // search / sort / scroll-recycle don't re-query. Cleared on focus
  // (a chain may have been edited in ThreadDetail).
  const previewCacheRef = useRef(new Map());
  const inflightRef = useRef(new Set());
  const [previewMap, setPreviewMap] = useState({});
  // Wrong-list guard: the moment the dataset key changes (kind /
  // collection / sort / search) the stale rows are cleared and this
  // flips true so a loading placeholder shows until the new rows land.
  // The previous filter's list never sits under the new pill. It is NOT
  // set on focus/mutation refreshes (same dataset: keep showing it).
  const [filterLoading, setFilterLoading] = useState(true);
  const [existingPickerVisible, setExistingPickerVisible] = useState(false);
  // The collection currently targeted by a long-press gesture in the
  // filter sheet. Drives the rename/delete actions sheet *and* the rename
  // form sheet (the latter mounts whenever `renameTarget` is set).
  const [collectionActionsTarget, setCollectionActionsTarget] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);

  // Stable primitive key for the selection (sorted, comma-joined ids, or
  // '' when nothing is selected). Effects and queries depend on this, not
  // on the Set object: toggling re-runs them; an unrelated re-render
  // (same selection) does not.
  const collectionKey = useMemo(
    () =>
      [...selectedCollections]
        .sort((a, b) => a - b)
        .join(','),
    [selectedCollections]
  );

  const toggleCollection = useCallback((id) => {
    setSelectedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearCollections = useCallback(() => {
    setSelectedCollections((prev) => (prev.size ? new Set() : prev));
  }, []);

  // Re-read on focus too so the empty-state stays in sync if the user
  // toggles the switch in SettingsAutoThreads and comes back. The Quiet
  // threshold (R2) piggybacks on the same focus listener: both are
  // cheap secure-store reads that need a refresh on return-from-Settings.
  useEffect(() => {
    isAutoThreadEnabled().then(setAutoEnabledLocal);
    loadQuietThreshold().then(setQuietThresholdDays);
    if (!navigation) return;
    const unsubscribe = navigation.addListener('focus', () => {
      isAutoThreadEnabled().then(setAutoEnabledLocal);
      loadQuietThreshold().then(setQuietThresholdDays);
    });
    return unsubscribe;
  }, [navigation]);

  // Sort preference is global, not focus-dependent: read it once on mount.
  useEffect(() => {
    SecureStore.getItemAsync(SORT_MODE_KEY)
      .then((v) => {
        if (v === 'alpha' || v === 'recent') setSortMode(v);
      })
      .catch(() => {});
  }, []);

  const toggleSortMode = useCallback(() => {
    setSortMode((m) => {
      const next = m === 'recent' ? 'alpha' : 'recent';
      SecureStore.setItemAsync(SORT_MODE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  // Debounce the search box. The TextInput stays bound to `searchQuery`
  // (instant UI); only `debouncedQuery` feeds the reload.
  useEffect(() => {
    const h = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 250);
    return () => clearTimeout(h);
  }, [searchQuery]);

  // A hard dataset switch (kind / collection / sort) → drop stale rows +
  // show the placeholder before the async reload resolves, so the wrong
  // list never sits under the new pill. Mount + these only, NOT focus
  // (tab return refreshes in place, no blink) and NOT search (typing
  // narrows the current results rather than swapping datasets, so a
  // skeleton flash there would be more jarring than helpful).
  useEffect(() => {
    setThreads([]);
    setFilterLoading(true);
  }, [kindFilter, collectionKey, sortMode]);

  const clearPreviewCache = useCallback(() => {
    previewCacheRef.current.clear();
    inflightRef.current.clear();
    setPreviewMap({});
  }, []);

  // Fetch one thread's chain (once). Cards call this on mount; cache +
  // in-flight set dedupe so a re-mount during scroll-recycle is free.
  const ensurePreview = useCallback(async (threadId) => {
    if (previewCacheRef.current.has(threadId)) return;
    if (inflightRef.current.has(threadId)) return;
    inflightRef.current.add(threadId);
    try {
      const db = getDb();
      if (!db) return;
      const rows = await loadThreadPreview(db, threadId);
      previewCacheRef.current.set(threadId, rows);
      setPreviewMap((prev) => ({ ...prev, [threadId]: rows }));
    } catch {
      // leave uncached so a later mount retries
    } finally {
      inflightRef.current.delete(threadId);
    }
  }, []);

  const loadCollections = useCallback(async () => {
    const db = getDb();
    if (!db) return;
    const rows = await db.getAllAsync(
      'SELECT * FROM thread_collections ORDER BY name COLLATE NOCASE ASC'
    );
    setCollections(rows);
  }, []);

  const loadThreads = useCallback(async () => {
    const db = getDb();
    if (!db) return;

    const wheres = [];
    const params = [];
    let orderBy = 'updated_at DESC';

    if (kindFilter === 'user') {
      wheres.push("kind = 'user'");
      if (sortMode === 'alpha') orderBy = 'name COLLATE NOCASE ASC';
    } else if (AUTO_FILTER_KIND[kindFilter]) {
      wheres.push("kind = ?");
      params.push(AUTO_FILTER_KIND[kindFilter]);
      orderBy = 'anchor_date DESC, updated_at DESC';
    }

    // Union filter: threads in ANY selected collection. Ids come from
    // `collectionKey`, which is built only from real (integer) collection
    // ids, so an inline IN list is injection-safe. A single EXISTS keeps
    // the outer query a plain SELECT FROM threads: no DISTINCT even when
    // a thread sits in several of the selected collections.
    const selIds = collectionKey ? collectionKey.split(',').map(Number) : [];
    if (selIds.length) {
      wheres.push(
        `EXISTS (
           SELECT 1 FROM thread_collection_links l
            WHERE l.thread_id = threads.id
              AND l.collection_id IN (${selIds.join(',')})
         )`
      );
    }

    const q = debouncedQuery;
    if (q) {
      wheres.push('(name LIKE ? OR description LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }

    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    // Cheap rows only: no per-thread chain query here. Bead-chain
    // previews are fetched lazily per visible card (see ensurePreview),
    // so the list paints immediately instead of waiting on N chain
    // queries. Comment counts/previews stay (they're already batched).
    const rows = await db.getAllAsync(
      `SELECT * FROM threads ${where} ORDER BY ${orderBy}`,
      params
    );
    const ids = rows.map((t) => t.id);
    const counts = await loadCommentCounts(PARENT_THREAD, ids);
    const previews = inlineComments
      ? await loadCommentPreviews(PARENT_THREAD, ids, 2)
      : {};
    const enriched = rows.map((t) => ({
      ...t,
      commentCount: counts[t.id] ?? 0,
      commentsPreview: previews[t.id] || [],
    }));
    setThreads(enriched);
    setFilterLoading(false);
  }, [kindFilter, collectionKey, debouncedQuery, sortMode, inlineComments]);

  // Lift the filtered count up to the Home header subtitle. Fires on
  // every settled threads update, including the initial empty-load
  // (0 → header shows the plain `Threads of life`), every kindFilter /
  // collection / sort / search transition, and any refreshTick bump.
  useEffect(() => {
    onCountChange?.(threads.length);
  }, [threads.length, onCountChange]);

  // Collections: mount + focus only. Independent of thread filters, so
  // typing in search or flipping the sort no longer re-queries them.
  useEffect(() => {
    loadCollections();
    if (!navigation) return;
    const unsub = navigation.addListener('focus', loadCollections);
    return unsub;
  }, [loadCollections, navigation]);

  // Threads: mount, filter/sort/debounced-query change, and focus. On
  // focus we also drop the preview cache (a thread's chain may have been
  // edited in ThreadDetail) so visible cards re-fetch lazily. Filter and
  // sort changes do NOT clear it (a chain doesn't change when you filter).
  useEffect(() => {
    loadThreads();
    if (!navigation) return;
    const unsub = navigation.addListener('focus', () => {
      clearPreviewCache();
      loadThreads();
    });
    return unsub;
  }, [loadThreads, clearPreviewCache, navigation]);

  // Parent-driven reload (batch-op completion). Skips the initial mount
  // because loadThreads has already run above; the dep watches the tick
  // not the function so a refreshTick change clears the preview cache too.
  const refreshTickRef = useRef(0);
  useEffect(() => {
    if (refreshTick === refreshTickRef.current) return;
    refreshTickRef.current = refreshTick;
    clearPreviewCache();
    loadThreads();
  }, [refreshTick, clearPreviewCache, loadThreads]);

  const handleCollectionCreated = (col) => {
    setCollectionFormVisible(false);
    loadCollections();
    // Focus the newly-created collection as the sole selection so the
    // user immediately sees the list filtered to it.
    setSelectedCollections(new Set([col.id]));
  };

  const handleRenameCollection = () => {
    // Hand the collection from the actions sheet to the rename form sheet
    // in a single transition. The form's `initial` triggers rename mode.
    const target = collectionActionsTarget;
    setCollectionActionsTarget(null);
    setRenameTarget(target);
  };

  const handleRenameSubmitted = () => {
    setRenameTarget(null);
    loadCollections();
    // The thread list already shows rows from this collection (the filter
    // is sticky), but the chip label needs to refresh (done above).
  };

  const handleDeleteCollection = async () => {
    const target = collectionActionsTarget;
    if (!target?.id) return;
    setCollectionActionsTarget(null);
    const n = await countThreadsInCollection(target.id);
    const body =
      n === 0
        ? 'This collection has no threads. This permanently deletes the collection.'
        : `This removes ${n} thread${n === 1 ? '' : 's'} from this collection. The threads are not deleted.`;
    Alert.alert(`Delete "${target.name}"?`, body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteCollection(target.id);
          // Drop the deleted collection from the selection so the user
          // isn't filtering on a collection that no longer exists.
          setSelectedCollections((prev) => {
            if (!prev.has(target.id)) return prev;
            const next = new Set(prev);
            next.delete(target.id);
            return next;
          });
          await loadCollections();
          await loadThreads();
        },
      },
    ]);
  };

  // Selected collections in the list's display order (name-sorted, since
  // `collections` is loaded ORDER BY name COLLATE NOCASE).
  const selectedCols = collections.filter((c) =>
    selectedCollections.has(c.id)
  );
  const hasCollectionFilter = selectedCols.length > 0;
  // The single active collection, *only* when exactly one is selected.
  // The FAB chooser / ExistingThreadsPicker need an unambiguous target,
  // so with 0 or 2+ selected they fall back to the plain composer.
  const activeCollection =
    selectedCols.length === 1 ? selectedCols[0] : null;
  // Selector label: 0 → "All collections"; 1 → its name; 2+ → "N collections".
  const collectionLabel =
    selectedCols.length === 0
      ? 'All collections'
      : selectedCols.length === 1
        ? selectedCols[0].name
        : `${selectedCols.length} collections`;

  // Chrome is rendered as a sibling above the SectionList rather than via
  // `ListHeaderComponent` because that prop accepts a function whose
  // identity changes every render: the list re-mounts the header on each
  // change, which dismisses the search TextInput's keyboard mid-typing.
  const headerChrome = (
    <View style={styles.headerChromeWrap}>
      {/* Collection selector. Replaces the old horizontally-scrolled pill
          strip (which forced you to swipe through every collection one by
          one): a single row summarising the selection, opening a
          searchable multi-select sheet. Lives above the kind filter so the
          visual hierarchy stays collection ⊃ kind. */}
      <View style={styles.collectionSelector}>
        <TouchableOpacity
          style={styles.collectionSelectorMain}
          onPress={() => setCollectionSheetVisible(true)}
          activeOpacity={0.7}
          accessibilityLabel={
            hasCollectionFilter
              ? `Collection filter: ${collectionLabel}. Tap to change.`
              : 'Filter by collection'
          }
        >
          <Ionicons
            name={hasCollectionFilter ? 'folder' : 'albums-outline'}
            size={15}
            color={hasCollectionFilter ? colors.primary : colors.textMuted}
          />
          <Text
            style={[
              styles.collectionSelectorText,
              hasCollectionFilter && styles.collectionSelectorTextOn,
            ]}
            numberOfLines={1}
          >
            {collectionLabel}
          </Text>
        </TouchableOpacity>
        {hasCollectionFilter ? (
          <TouchableOpacity
            onPress={clearCollections}
            hitSlop={8}
            style={styles.collectionSelectorClear}
            accessibilityLabel="Clear collection filter"
          >
            <Ionicons name="close-circle" size={16} color={colors.textFaint} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={() => setCollectionSheetVisible(true)}
          hitSlop={6}
          accessibilityLabel="Open collection filter"
        >
          <Ionicons name="chevron-down" size={16} color={colors.textFaint} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchContainer}>
        <Ionicons
          name="search"
          size={16}
          color={colors.textFaint}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search name or description…"
          placeholderTextColor={colors.placeholder}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
          autoCapitalize="none"
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
        {kindFilter === 'user' ? (
          <TouchableOpacity
            onPress={toggleSortMode}
            style={styles.searchInlineToggle}
            accessibilityLabel={`Sorted ${sortMode === 'alpha' ? 'A to Z' : 'by most recent'}. Tap to toggle.`}
            hitSlop={6}
          >
            <Ionicons
              name={sortMode === 'alpha' ? 'text' : 'time-outline'}
              size={16}
              color={sortMode === 'alpha' ? colors.primary : colors.textFaint}
            />
          </TouchableOpacity>
        ) : null}
        {onToggleInlineComments ? (
          <TouchableOpacity
            onPress={onToggleInlineComments}
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
        ) : null}
      </View>

      <View style={styles.headerRow}>
        <View style={styles.filters}>
          {KIND_FILTERS.map((f) => {
            const active = kindFilter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.filterChip, active && styles.filterChipOn]}
                onPress={() => setKindFilter(f.key)}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.filterChipText, active && styles.filterChipTextOn]}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );

  const renderEmpty = () => {
    // Dataset is reloading after a filter/sort change: show a quiet
    // placeholder, never the (misleading) "no threads" copy.
    if (filterLoading) {
      return (
        <View style={styles.loadingList}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.loadingRow} />
          ))}
        </View>
      );
    }
    if (searchQuery.trim()) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No threads match</Text>
          <Text style={styles.emptySubtext}>
            Use a different search term, or clear the search to see your threads.
          </Text>
        </View>
      );
    }
    if (hasCollectionFilter) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            {selectedCols.length === 1
              ? `No threads in "${selectedCols[0].name}"`
              : 'No threads in the selected collections'}
          </Text>
          <Text style={styles.emptySubtext}>
            {selectedCols.length === 1
              ? 'Tap + to add a new thread or an existing thread.'
              : 'Tap + to start a new thread, or narrow the selection.'}
          </Text>
        </View>
      );
    }
    if (AUTO_FILTER_KIND[kindFilter] && !autoEnabled) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Auto-thread creation is off</Text>
          <Text style={styles.emptySubtext}>
            To chain your days, turn it on in Settings → Auto-threads.
          </Text>
        </View>
      );
    }
    if (kindFilter === 'days') {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No daily auto-threads yet</Text>
          <Text style={styles.emptySubtext}>
            Add a note. Its day will show here.
          </Text>
        </View>
      );
    }
    if (kindFilter === 'weeks') {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No weekly auto-threads yet</Text>
          <Text style={styles.emptySubtext}>
            Tap ★ Highlight on an entry to start a weekly chain.
          </Text>
        </View>
      );
    }
    if (kindFilter === 'months') {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No monthly auto-threads yet</Text>
          <Text style={styles.emptySubtext}>
            Set the highlight star to monthly, or use "Promote week to month" in a weekly thread.
          </Text>
        </View>
      );
    }
    if (kindFilter === 'user') {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No threads yet</Text>
          <Text style={styles.emptySubtext}>Tap + to start a thread.</Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No threads</Text>
      </View>
    );
  };

  const renderRow = ({ item }) => (
    <SwipeableThreadRow
      thread={item}
      preview={previewMap[item.id]}
      onNeedPreview={ensurePreview}
      colors={colors}
      styles={styles}
      inlineComments={inlineComments}
      // Tap: in select mode → toggle this thread in the selection; otherwise
      // → open the thread. Long-press: in select mode the row is already a
      // plain pressable (selectable) so long-press isn't a separate verb;
      // outside select mode it enters select mode with this thread picked.
      // The pre-existing "long-press → collection picker" gesture is gone
      // intentionally: the single-thread collection edit still has its
      // in-detail metadata-line path; the multi-select Add-to-collection
      // header action subsumes it.
      onOpen={() =>
        selectMode ? onSelectToggleThread?.(item.id) : onOpenThread(item.id)
      }
      onLongPress={() =>
        selectMode ? onSelectToggleThread?.(item.id) : onLongPressThread?.(item)
      }
      onComment={() => setCommentsThread(item)}
      selectMode={selectMode}
      selected={!!selectedIds && selectedIds.has(item.id)}
      onSelectToggle={() => onSelectToggleThread?.(item.id)}
    />
  );

  // Band the list the same way the notes list does (shared util). Only
  // the User kind bands: Recent → "Today / Earlier this week / …" by
  // updated_at; A–Z → first-letter buckets so a name convention reads as
  // sections. Auto kinds (their names are dates, anchor-sorted) render as
  // one unlabelled section. Empty → no sections so ListEmptyComponent shows.
  //
  // R2: Under `user` + `recent`, derived "QUIET · {N}d+" tail band. A
  // thread is *quiet* if `updated_at` is older than `quietThresholdDays`
  // AND it is not closed (`closed_at IS NULL`). The split is a pure JS
  // derivation over the already-loaded set so search/collection filters
  // still apply (the band reflects "of what matched, these are quiet"),
  // and `groupIntoBands` stays general: it never learns about "quiet".
  // No empty band: quiet section is appended only if at least one thread
  // qualifies. The `alpha` branch and auto-kind branches are unaffected.
  // The threshold is state (configured in Settings → Threads) so this
  // memo re-runs when the user changes it and returns to the list.
  const sections = useMemo(() => {
    if (!threads.length) return [];
    if (kindFilter !== 'user') {
      return [{ title: null, data: threads }];
    }
    if (sortMode === 'alpha') {
      return groupIntoAlphaBands(threads, (t) => t.name || 'Untitled');
    }
    const recent = [];
    const quiet = [];
    for (const t of threads) {
      // Closed threads (S17 Loop) keep their natural date band: they
      // have their own visual register (the clasp chip on the card).
      if (
        t.closed_at == null &&
        isQuietUpdatedAt(t.updated_at, quietThresholdDays)
      ) {
        quiet.push(t);
      } else {
        recent.push(t);
      }
    }
    const bands = groupIntoBands(recent, (t) =>
      isoDateFromSqlDatetime(t.updated_at)
    );
    if (quiet.length) {
      // Lowercase `d+` so after the band-header's `textTransform: uppercase`
      // it reads `QUIET · 14D+`. This keeps the units legible for short
      // thresholds where `14d+` would otherwise be ambiguous.
      bands.push({
        title: `QUIET · ${quietThresholdDays}d+`,
        data: quiet,
      });
    }
    return bands;
  }, [threads, kindFilter, sortMode, quietThresholdDays]);

  // FAB tap behavior depends on the selection. The chooser auto-assigns
  // to a single target collection, so it only makes sense with exactly
  // one selected (`activeCollection`). With none or several selected
  // there's no unambiguous target: go straight to the plain composer.
  const handleFabPress = () => {
    if (activeCollection) {
      setFabChooserVisible(true);
    } else {
      navigation?.navigate('ThreadComposer', { threadId: null });
    }
  };

  const handleChooseNew = () => {
    setFabChooserVisible(false);
    navigation?.navigate('ThreadComposer', {
      threadId: null,
      prefillCollectionId: activeCollection ? activeCollection.id : null,
    });
  };

  const handleChooseExisting = () => {
    setFabChooserVisible(false);
    setExistingPickerVisible(true);
  };

  return (
    <>
      <View style={styles.listWrap}>
        {headerChrome}
        <SectionList
          style={styles.listFlex}
          sections={sections}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderRow}
          stickySectionHeadersEnabled
          renderSectionHeader={({ section }) =>
            section.title ? (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>{section.title}</Text>
              </View>
            ) : (
              // Never null with stickySectionHeadersEnabled: Android crashes
              // ("addViewAt … count=0") trying to pin a missing header. The
              // unlabelled auto-thread section gets an empty, zero-height one.
              <View />
            )
          }
          contentContainerStyle={
            threads.length === 0 ? styles.emptyList : styles.listContent
          }
          ListEmptyComponent={renderEmpty}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
        />
      </View>
      <TouchableOpacity
        style={styles.threadFab}
        onPress={handleFabPress}
        accessibilityLabel={
          activeCollection ? 'Add thread to collection' : 'New thread'
        }
      >
        <Ionicons name="add" size={32} color={colors.primaryOnPrimary} />
      </TouchableOpacity>
      <CollectionFormSheet
        visible={collectionFormVisible}
        initial={null}
        onSubmit={handleCollectionCreated}
        onClose={() => setCollectionFormVisible(false)}
      />
      <CollectionFormSheet
        visible={renameTarget != null}
        initial={renameTarget}
        onSubmit={handleRenameSubmitted}
        onClose={() => setRenameTarget(null)}
      />
      <CollectionFilterSheet
        visible={collectionSheetVisible}
        collections={collections}
        selectedIds={selectedCollections}
        onToggle={toggleCollection}
        onClearAll={clearCollections}
        onLongPressCollection={(c) => {
          // Hand off to the existing rename/delete flow. Close this sheet
          // first so the actions sheet isn't stacked on top of it (same
          // close-then-open handoff the rename flow already uses).
          setCollectionSheetVisible(false);
          setCollectionActionsTarget(c);
        }}
        onCreateNew={() => {
          setCollectionSheetVisible(false);
          setCollectionFormVisible(true);
        }}
        onClose={() => setCollectionSheetVisible(false)}
      />
      <CollectionActionsSheet
        visible={collectionActionsTarget != null}
        collection={collectionActionsTarget}
        onRename={handleRenameCollection}
        onDelete={handleDeleteCollection}
        onClose={() => setCollectionActionsTarget(null)}
      />
      <CollectionPickerSheet
        visible={collectionPickerThread != null}
        thread={collectionPickerThread}
        onChange={loadThreads}
        onClose={() => setCollectionPickerThread(null)}
      />
      <CommentsDrawer
        visible={commentsThread != null}
        parentKind={PARENT_THREAD}
        parentId={commentsThread?.id ?? null}
        parentLabel={commentsThread?.name || 'Thread'}
        onClose={() => {
          setCommentsThread(null);
          loadThreads();
        }}
        onCommentsChanged={loadThreads}
      />
      <FabChooserSheet
        visible={fabChooserVisible}
        collection={activeCollection}
        styles={styles}
        colors={colors}
        onChooseNew={handleChooseNew}
        onChooseExisting={handleChooseExisting}
        onClose={() => setFabChooserVisible(false)}
      />
      <ExistingThreadsPicker
        visible={existingPickerVisible}
        collection={activeCollection}
        onChange={loadThreads}
        onClose={() => setExistingPickerVisible(false)}
      />
    </>
  );
}

// Tiny two-option bottom-sheet shown when the user taps the FAB while
// filtered to a specific collection. Disambiguates "create a brand-new
// thread in this collection" vs "pick from threads that exist already".
function FabChooserSheet({
  visible,
  collection,
  styles,
  colors,
  onChooseNew,
  onChooseExisting,
  onClose,
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.chooserBackdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.chooserSheet,
            { paddingBottom: Math.max(24, insets.bottom + 8) },
          ]}
          onPress={() => {}}
        >
          <View style={styles.chooserHandle} />
          <Text style={styles.chooserHeading}>Add to collection</Text>
          <Text style={styles.chooserSubheading} numberOfLines={1}>
            {collection?.name || 'Collection'}
          </Text>

          <TouchableOpacity
            style={styles.chooserRow}
            onPress={onChooseNew}
            activeOpacity={0.7}
          >
            <Ionicons
              name="add-circle-outline"
              size={20}
              color={colors.primary}
            />
            <View style={styles.chooserRowBody}>
              <Text style={styles.chooserRowTitle}>New thread</Text>
              <Text style={styles.chooserRowSubtitle}>
                Create a new thread in this collection.
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.chooserRow}
            onPress={onChooseExisting}
            activeOpacity={0.7}
          >
            <Ionicons
              name="albums-outline"
              size={20}
              color={colors.primary}
            />
            <View style={styles.chooserRowBody}>
              <Text style={styles.chooserRowTitle}>Add existing thread</Text>
              <Text style={styles.chooserRowSubtitle}>
                Select from your existing threads.
              </Text>
            </View>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Swipeable wrapper. Swipe-right reveals a Comment action panel and the
// onSwipeableOpen('left') callback opens the comments drawer immediately.
// The visible action panel is just a hint during the gesture, the gesture
// itself is the commit. Swipe-left has no bound action (threads have no
// list-level delete on this screen).
function SwipeableThreadRow({
  thread,
  preview,
  onNeedPreview,
  colors,
  styles,
  inlineComments,
  onOpen,
  onLongPress,
  onComment,
  selectMode = false,
  selected = false,
  onSelectToggle,
}) {
  const ref = React.useRef(null);

  // In select mode the row is a plain pressable with a leading checkbox.
  // Swipe + long-press-to-collection-picker are intentionally disabled so
  // the user can sweep through the list selecting without triggering the
  // Comment swipe or the (now-replaced) collection picker. Mirrors the
  // entry-side select-row pattern in HomeScreen.
  if (selectMode) {
    return (
      <View style={styles.selectRow}>
        <TouchableOpacity
          style={styles.checkboxTouch}
          onPress={onSelectToggle}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, selected && styles.checkboxFilled]}>
            {selected ? (
              <Ionicons name="checkmark" size={14} color={colors.primaryOnPrimary} />
            ) : null}
          </View>
        </TouchableOpacity>
        <View style={styles.selectRowBody}>
          <ThreadCard
            thread={thread}
            preview={preview}
            onNeedPreview={onNeedPreview}
            onPress={onSelectToggle}
            onLongPress={onSelectToggle}
            inlineCommentsDefault={inlineComments}
          />
        </View>
      </View>
    );
  }

  const renderLeftAction = () => (
    <View style={[styles.swipeAction, styles.swipeActionLeft]}>
      <Ionicons name="chatbubble-ellipses" size={22} color="#fff" />
      <Text style={styles.swipeActionText}>Comment</Text>
    </View>
  );

  const handleOpen = (direction) => {
    if (direction === 'left') {
      ref.current?.close();
      onComment?.();
    }
  };

  return (
    <Swipeable
      ref={ref}
      renderLeftActions={renderLeftAction}
      friction={2}
      leftThreshold={60}
      onSwipeableOpen={handleOpen}
    >
      <ThreadCard
        thread={thread}
        preview={preview}
        onNeedPreview={onNeedPreview}
        onPress={onOpen}
        onLongPress={onLongPress}
        inlineCommentsDefault={inlineComments}
      />
    </Swipeable>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    listWrap: { flex: 1 },
    listFlex: { flex: 1 },
    headerChromeWrap: {
      paddingHorizontal: 20,
    },
    listContent: {
      // Edge-to-edge rows (inset moved into ThreadCard's own padding); the
      // header chrome and section headers keep their own 20px inset.
      paddingBottom: 100,
    },
    emptyList: { flexGrow: 1 },
    loadingList: {
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    loadingRow: {
      height: 64,
      borderRadius: 10,
      backgroundColor: colors.surfaceMuted,
      opacity: 0.5,
      marginBottom: 8,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 40,
      paddingTop: 60,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 8,
      textAlign: 'center',
    },
    emptySubtext: {
      color: colors.textFaint,
      fontSize: 14,
      textAlign: 'center',
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
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 2,
      marginBottom: 6,
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
    chooserBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    chooserSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
      paddingBottom: 24,
    },
    chooserHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      alignSelf: 'center',
      marginBottom: 12,
    },
    chooserHeading: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: 20,
    },
    chooserSubheading: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      paddingHorizontal: 20,
      paddingBottom: 8,
      marginTop: 2,
    },
    chooserRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    chooserRowBody: { flex: 1 },
    chooserRowTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    chooserRowSubtitle: {
      color: colors.textFaint,
      fontSize: 12,
      marginTop: 2,
    },
    swipeAction: {
      // Flat full-height block to match the flat rows (see EntryCard's swipe
      // action): no rounding, no bottom margin (card-era leftovers that
      // showed a rounded, short panel behind the flat row).
      width: 96,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    swipeActionLeft: {
      marginRight: 4,
    },
    swipeActionText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '600',
      marginTop: 2,
    },
    // Select-mode row: matches the entry-side chrome in HomeScreen so the
    // two lists share one visual language for "you are selecting".
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
    collectionSelector: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 6,
      marginBottom: 6,
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    collectionSelectorMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    collectionSelectorText: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '600',
    },
    collectionSelectorTextOn: {
      color: colors.text,
    },
    collectionSelectorClear: { padding: 2 },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: 4,
      paddingBottom: 8,
    },
    filters: {
      flexDirection: 'row',
      gap: 6,
    },
    filterChip: {
      paddingVertical: 4,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    filterChipOn: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    filterChipText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    filterChipTextOn: {
      color: colors.primaryOnPrimary,
    },
    // Mirrors the notes list's band headers exactly so the two surfaces
    // read as one app.
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
  });
