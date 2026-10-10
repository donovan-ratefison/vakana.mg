import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Animated,
  PanResponder,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import BeadView from '../components/BeadView';
import BeadPickerModal from '../components/BeadPickerModal';
import YearMonthPicker from '../components/YearMonthPicker';
import { getDb } from '../database/db';
import { DEFAULT_BEAD, readBead } from '../beads/types';
import { addThreadToCollection } from '../services/collections';
import { useTheme } from '../theme';

const ANCHOR_KINDS = [
  { key: 'none', label: 'None' },
  { key: 'day', label: 'Day' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'time', label: 'Time' },
];

const CHAIN_ITEM_WIDTH = 86; // bead 36 + handle + arrows + tighter gap; close enough for snap math

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function toISODate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toHM(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export default function ThreadComposerScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const threadId = route.params?.threadId ?? null;
  const prefillCollectionId = route.params?.prefillCollectionId ?? null;
  const prefilledEntryId = route.params?.prefilledEntryId ?? null;
  // Batch prefill from the home multi-select "Thread → Create new thread"
  // path. When present, takes priority over the singular variant.
  const prefilledEntryIds = route.params?.prefilledEntryIds ?? null;
  // Prefilled thread name (used by the comment-promote-and-chain path:
  // CommentsDrawer passes "(From:) <origin entry title>"). Only consumed
  // on first mount in create mode; edits hydrate the name from the row.
  const prefillName = route.params?.prefillName ?? null;

  const isEdit = threadId != null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [anchorKind, setAnchorKind] = useState('none');
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [anchorTime, setAnchorTime] = useState(new Date());
  const [chain, setChain] = useState([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);

  const [draggingIndex, setDraggingIndex] = useState(null);
  const draggingIndexRef = useRef(null);
  const dragX = useRef(new Animated.Value(0)).current;

  const nameInputRef = useRef(null);
  const prefilledLoaded = useRef(false);
  const prefillNameApplied = useRef(false);

  // Apply prefillName once on mount, only in create mode (edit mode hydrates
  // the name from the thread row a few lines below).
  useEffect(() => {
    if (prefillNameApplied.current) return;
    if (isEdit) return;
    if (!prefillName) return;
    prefillNameApplied.current = true;
    setName(prefillName);
  }, [isEdit, prefillName]);

  // Initial load: for edits, pull thread + chain from DB
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = getDb();
      if (!db) return;
      if (isEdit) {
        const t = await db.getFirstAsync(
          'SELECT * FROM threads WHERE id = ?',
          [threadId]
        );
        if (!t || cancelled) return;
        setName(t.name || '');
        setDescription(t.description || '');
        setAnchorKind(t.anchor_kind || 'none');
        if (t.anchor_kind === 'day' && t.anchor_date) {
          const [y, m, d] = t.anchor_date.split('-').map(Number);
          setAnchorDate(new Date(y, m - 1, d));
        } else if (t.anchor_kind === 'month' && t.anchor_date) {
          const [y, m] = t.anchor_date.split('-').map(Number);
          setAnchorDate(new Date(y, m - 1, 1));
        } else if (t.anchor_kind === 'year' && t.anchor_date) {
          setAnchorDate(new Date(Number(t.anchor_date), 0, 1));
        } else if (t.anchor_kind === 'time') {
          if (t.anchor_date) {
            const [y, m, d] = t.anchor_date.split('-').map(Number);
            setAnchorDate(new Date(y, m - 1, d));
          }
          if (t.anchor_time) {
            const [hh, mm] = t.anchor_time.split(':').map(Number);
            const tm = new Date();
            tm.setHours(hh || 0, mm || 0, 0, 0);
            setAnchorTime(tm);
          }
        }
        const beads = await db.getAllAsync(
          `SELECT tb.*, e.bead_shape, e.bead_pattern, e.bead_mood, e.bead_glyph
             FROM thread_beads tb
             LEFT JOIN entries e ON e.id = tb.entry_id
             WHERE tb.thread_id = ?
             ORDER BY tb.position ASC`,
          [threadId]
        );
        if (cancelled) return;
        setChain(
          beads.map((b) => ({
            id: b.id,
            entry_id: b.entry_id,
            snapshot_shape: b.snapshot_shape,
            snapshot_pattern: b.snapshot_pattern,
            snapshot_mood: b.snapshot_mood,
            snapshot_glyph: b.snapshot_glyph,
            bead_shape: b.bead_shape,
            bead_pattern: b.bead_pattern,
            bead_mood: b.bead_mood,
            bead_glyph: b.bead_glyph,
          }))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, threadId]);

  // Pre-fill chain with prefilledEntryId / prefilledEntryIds on first render.
  // The batch variant (plural) takes priority and resolves each entry's bead;
  // entries without a bead get DEFAULT_BEAD materialized onto them so the
  // chain always has a real snapshot to capture, mirroring how
  // `addEntriesToThread` handles the existing-thread path.
  useEffect(() => {
    if (prefilledLoaded.current) return;
    const ids =
      Array.isArray(prefilledEntryIds) && prefilledEntryIds.length > 0
        ? prefilledEntryIds
        : prefilledEntryId != null
        ? [prefilledEntryId]
        : [];
    if (ids.length === 0) return;
    prefilledLoaded.current = true;
    (async () => {
      const db = getDb();
      if (!db) return;
      const placeholders = ids.map(() => '?').join(',');
      const rows = await db.getAllAsync(
        `SELECT id, bead_shape, bead_pattern, bead_mood, bead_glyph, created_at, date
           FROM entries WHERE id IN (${placeholders})`,
        ids
      );
      if (rows.length === 0) return;
      // Sort chronologically so the chain order matches the source order.
      rows.sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        const aCa = a.created_at || '';
        const bCa = b.created_at || '';
        if (aCa === bCa) return a.id - b.id;
        return aCa < bCa ? -1 : 1;
      });
      const additions = [];
      for (const e of rows) {
        let bead = readBead(e);
        if (!bead) {
          // Write DEFAULT_BEAD onto the entry so the snapshot is meaningful.
          await db.runAsync(
            `UPDATE entries
                SET bead_shape = ?, bead_pattern = ?, bead_mood = ?, bead_glyph = ?,
                    updated_at = datetime('now')
              WHERE id = ?`,
            [
              DEFAULT_BEAD.shape,
              DEFAULT_BEAD.pattern,
              DEFAULT_BEAD.mood,
              DEFAULT_BEAD.glyph,
              e.id,
            ]
          );
          bead = { ...DEFAULT_BEAD };
        }
        additions.push({
          entry_id: e.id,
          snapshot_shape: bead.shape,
          snapshot_pattern: bead.pattern,
          snapshot_mood: bead.mood,
          snapshot_glyph: bead.glyph,
          bead_shape: bead.shape,
          bead_pattern: bead.pattern,
          bead_mood: bead.mood,
          bead_glyph: bead.glyph,
        });
      }
      setChain((prev) => [...prev, ...additions]);
      setTimeout(() => nameInputRef.current?.focus(), 250);
    })();
  }, [prefilledEntryId, prefilledEntryIds]);

  const moveItem = (index, delta) => {
    setChain((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const removeItem = (index) => {
    setChain((prev) => prev.filter((_, i) => i !== index));
  };

  const startDrag = (index) => {
    draggingIndexRef.current = index;
    setDraggingIndex(index);
    dragX.setValue(0);
  };

  const onDragMove = (dx) => {
    if (draggingIndexRef.current === null) return;
    dragX.setValue(dx);
  };

  const endDrag = (dx) => {
    const startIdx = draggingIndexRef.current;
    draggingIndexRef.current = null;
    setDraggingIndex(null);
    dragX.setValue(0);
    if (startIdx === null) return;
    const offset = Math.round(dx / CHAIN_ITEM_WIDTH);
    if (offset === 0) return;
    setChain((prev) => {
      const newIdx = Math.max(0, Math.min(prev.length - 1, startIdx + offset));
      if (newIdx === startIdx) return prev;
      const next = [...prev];
      const [moved] = next.splice(startIdx, 1);
      next.splice(newIdx, 0, moved);
      return next;
    });
  };

  const appendBead = (entry) => {
    const bead = readBead(entry);
    if (!bead) return;
    setChain((prev) => [
      ...prev,
      {
        entry_id: entry.id,
        snapshot_shape: bead.shape,
        snapshot_pattern: bead.pattern,
        snapshot_mood: bead.mood,
        snapshot_glyph: bead.glyph,
        bead_shape: bead.shape,
        bead_pattern: bead.pattern,
        bead_mood: bead.mood,
        bead_glyph: bead.glyph,
      },
    ]);
  };

  const handleSave = async () => {
    const db = getDb();
    if (!db) return;
    if (!name.trim()) {
      Alert.alert('Name required', 'Give your thread a name.');
      return;
    }

    let anchorDateValue = null;
    let anchorTimeValue = null;
    if (anchorKind === 'day') {
      anchorDateValue = toISODate(anchorDate);
    } else if (anchorKind === 'month') {
      anchorDateValue = `${anchorDate.getFullYear()}-${pad2(
        anchorDate.getMonth() + 1
      )}`;
    } else if (anchorKind === 'year') {
      anchorDateValue = `${anchorDate.getFullYear()}`;
    } else if (anchorKind === 'time') {
      anchorDateValue = toISODate(anchorDate);
      anchorTimeValue = toHM(anchorTime);
    }

    const kindForDb = anchorKind === 'none' ? null : anchorKind;

    let savedThreadId = threadId;
    // One transaction: the delete-all + re-insert chain commit must never
    // be observable half-done (a crash mid-save would otherwise leave the
    // thread with no beads at all).
    await db.withTransactionAsync(async () => {
      if (isEdit) {
        await db.runAsync(
          `UPDATE threads
              SET name = ?, description = ?, anchor_kind = ?, anchor_date = ?, anchor_time = ?, updated_at = datetime('now')
            WHERE id = ?`,
          [
            name.trim(),
            description.trim(),
            kindForDb,
            anchorDateValue,
            anchorTimeValue,
            threadId,
          ]
        );
        await db.runAsync('DELETE FROM thread_beads WHERE thread_id = ?', [
          threadId,
        ]);
      } else {
        const result = await db.runAsync(
          `INSERT INTO threads (name, description, anchor_kind, anchor_date, anchor_time)
           VALUES (?, ?, ?, ?, ?)`,
          [
            name.trim(),
            description.trim(),
            kindForDb,
            anchorDateValue,
            anchorTimeValue,
          ]
        );
        savedThreadId = result.lastInsertRowId;
        // Auto-assign newly-created thread to the collection the user was
        // filtered into when they tapped FAB → "+ New thread". Nothing to do
        // on edit because membership is managed via the long-press picker.
        if (prefillCollectionId != null && savedThreadId != null) {
          await addThreadToCollection(savedThreadId, prefillCollectionId);
        }
      }

      for (let i = 0; i < chain.length; i++) {
        const c = chain[i];
        // Re-anchor snapshot to the live bead when the entry still exists, so
        // committing the chain catches the snapshot up to any edits made to
        // the underlying entry since it was first added.
        const live = readBead({
          bead_shape: c.bead_shape,
          bead_pattern: c.bead_pattern,
          bead_mood: c.bead_mood,
          bead_glyph: c.bead_glyph,
        });
        const snap = live || {
          shape: c.snapshot_shape,
          pattern: c.snapshot_pattern,
          mood: c.snapshot_mood,
          glyph: c.snapshot_glyph,
        };
        await db.runAsync(
          `INSERT INTO thread_beads
            (thread_id, entry_id, position, snapshot_shape, snapshot_pattern, snapshot_mood, snapshot_glyph)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            savedThreadId,
            c.entry_id ?? null,
            i,
            snap.shape,
            snap.pattern,
            snap.mood,
            snap.glyph || '',
          ]
        );
      }
    });

    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerSide}
          hitSlop={8}
        >
          <Text style={styles.headerSideText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isEdit ? 'Edit thread' : 'New thread'}
        </Text>
        <TouchableOpacity
          onPress={handleSave}
          style={[styles.headerSide, styles.headerSideRight]}
          hitSlop={8}
        >
          <Text style={[styles.headerSideText, styles.headerSave]}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>Name</Text>
        <TextInput
          ref={nameInputRef}
          style={styles.input}
          placeholder="Thread name"
          placeholderTextColor={colors.placeholder}
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.descriptionInput]}
          placeholder="What is this thread about?"
          placeholderTextColor={colors.placeholder}
          value={description}
          onChangeText={setDescription}
          multiline
        />

        <Text style={styles.label}>Beads</Text>
        <View style={styles.chainScroll}>
          {chain.length === 0 ? (
            <Text style={styles.chainEmpty}>No beads yet. Add one below.</Text>
          ) : (
            chain.map((c, i) => (
              <ChainItem
                key={c.id ?? `new-${i}`}
                item={c}
                index={i}
                isLast={i === chain.length - 1}
                isDragging={draggingIndex === i}
                dragX={dragX}
                styles={styles}
                colors={colors}
                onMoveLeft={() => moveItem(i, -1)}
                onMoveRight={() => moveItem(i, 1)}
                onRemove={() => removeItem(i)}
                onDragStart={() => startDrag(i)}
                onDragMove={onDragMove}
                onDragEnd={endDrag}
              />
            ))
          )}
        </View>

        <TouchableOpacity
          style={styles.addBeadBtn}
          onPress={() => setPickerVisible(true)}
        >
          <Ionicons name="add" size={18} color={colors.primary} />
          <Text style={styles.addBeadText}>Add bead</Text>
        </TouchableOpacity>

        <Text style={styles.label}>Anchor</Text>
        <View style={styles.chipRow}>
          {ANCHOR_KINDS.map((k) => {
            const selected = anchorKind === k.key;
            return (
              <TouchableOpacity
                key={k.key}
                onPress={() => setAnchorKind(k.key)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text
                  style={[
                    styles.chipText,
                    selected && styles.chipTextSelected,
                  ]}
                >
                  {k.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {anchorKind === 'day' ? (
          <TouchableOpacity
            style={styles.anchorButton}
            onPress={() => setShowDatePicker(true)}
          >
            <Text style={styles.anchorButtonText}>{toISODate(anchorDate)}</Text>
          </TouchableOpacity>
        ) : null}

        {anchorKind === 'month' ? (
          <TouchableOpacity
            style={styles.anchorButton}
            onPress={() => setShowMonthPicker(true)}
          >
            <Text style={styles.anchorButtonText}>
              {anchorDate.toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric',
              })}
            </Text>
          </TouchableOpacity>
        ) : null}

        {anchorKind === 'year' ? (
          <TouchableOpacity
            style={styles.anchorButton}
            onPress={() => setShowYearPicker(true)}
          >
            <Text style={styles.anchorButtonText}>
              {anchorDate.getFullYear()}
            </Text>
          </TouchableOpacity>
        ) : null}

        {anchorKind === 'time' ? (
          <View style={styles.timeRow}>
            <TouchableOpacity
              style={[styles.anchorButton, styles.timeBtn]}
              onPress={() => setShowDatePicker(true)}
            >
              <Text style={styles.anchorButtonText}>
                {toISODate(anchorDate)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.anchorButton, styles.timeBtn]}
              onPress={() => setShowTimePicker(true)}
            >
              <Text style={styles.anchorButtonText}>{toHM(anchorTime)}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {showDatePicker && (
          <DateTimePicker
            value={anchorDate}
            mode="date"
            display="default"
            onChange={(e, d) => {
              setShowDatePicker(false);
              if (d) setAnchorDate(d);
            }}
          />
        )}

        {showTimePicker && (
          <DateTimePicker
            value={anchorTime}
            mode="time"
            display="default"
            onChange={(e, t) => {
              setShowTimePicker(false);
              if (t) setAnchorTime(t);
            }}
          />
        )}
      </ScrollView>

      <BeadPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onPick={(entry) => {
          appendBead(entry);
          setPickerVisible(false);
        }}
      />

      <YearMonthPicker
        visible={showYearPicker}
        mode="year"
        initialDate={anchorDate}
        onClose={() => setShowYearPicker(false)}
        onSelect={(d) => {
          setAnchorDate(d);
          setShowYearPicker(false);
        }}
      />

      <YearMonthPicker
        visible={showMonthPicker}
        mode="month"
        initialDate={anchorDate}
        onClose={() => setShowMonthPicker(false)}
        onSelect={(d) => {
          setAnchorDate(d);
          setShowMonthPicker(false);
        }}
      />
    </View>
  );
}

// Inline modal: list all beaded entries, filter by title or shape.
function ChainItem({
  item,
  index,
  isLast,
  isDragging,
  dragX,
  styles,
  colors,
  onMoveLeft,
  onMoveRight,
  onRemove,
  onDragStart,
  onDragMove,
  onDragEnd,
}) {
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Claim the gesture as soon as the user touches the handle so the
        // outer horizontal ScrollView doesn't intercept the drag.
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => onDragStart(),
        onPanResponderMove: (_, g) => onDragMove(g.dx),
        onPanResponderRelease: (_, g) => onDragEnd(g.dx),
        onPanResponderTerminate: () => onDragEnd(0),
      }),
    [onDragStart, onDragMove, onDragEnd]
  );

  return (
    <Animated.View
      style={[
        styles.chainItem,
        isDragging && {
          transform: [{ translateX: dragX }, { scale: 1.06 }],
          zIndex: 10,
          elevation: 6,
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
        },
      ]}
    >
      <View {...panResponder.panHandlers} style={styles.chainHandle} hitSlop={6}>
        <Ionicons name="reorder-three-outline" size={16} color={colors.textMuted} />
      </View>
      <BeadView
        bead={
          readBead({
            bead_shape: item.bead_shape,
            bead_pattern: item.bead_pattern,
            bead_mood: item.bead_mood,
            bead_glyph: item.bead_glyph,
          }) || {
            shape: item.snapshot_shape,
            pattern: item.snapshot_pattern,
            mood: item.snapshot_mood,
            glyph: item.snapshot_glyph,
          }
        }
        size={36}
      />
      <View style={styles.chainControls}>
        <TouchableOpacity
          onPress={onMoveLeft}
          disabled={index === 0}
          style={[styles.chainBtn, index === 0 && styles.chainBtnDisabled]}
          hitSlop={4}
        >
          <Ionicons name="chevron-back" size={14} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onRemove} style={styles.chainBtn} hitSlop={4}>
          <Ionicons name="close" size={14} color={colors.danger} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onMoveRight}
          disabled={isLast}
          style={[styles.chainBtn, isLast && styles.chainBtnDisabled]}
          hitSlop={4}
        >
          <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </Animated.View>
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
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerSide: {
      width: 70,
    },
    headerSideRight: {
      alignItems: 'flex-end',
    },
    headerSideText: {
      color: colors.textMuted,
      fontSize: 15,
    },
    headerSave: {
      color: colors.primary,
      fontWeight: '700',
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    body: {
      padding: 20,
      paddingBottom: 60,
    },
    label: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 14,
      marginBottom: 6,
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
    descriptionInput: {
      minHeight: 80,
      textAlignVertical: 'top',
    },
    chainScroll: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingVertical: 8,
      gap: 6,
      alignItems: 'flex-start',
    },
    chainItem: {
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 4,
      backgroundColor: colors.background,
      borderRadius: 8,
    },
    chainHandle: {
      paddingVertical: 2,
      paddingHorizontal: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chainControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 4,
    },
    chainBtn: {
      width: 22,
      height: 22,
      borderRadius: 4,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chainBtnDisabled: {
      opacity: 0.35,
    },
    chainEmpty: {
      color: colors.textFaint,
      fontSize: 13,
      fontStyle: 'italic',
      paddingVertical: 12,
    },
    addBeadBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      marginTop: 4,
    },
    addBeadText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    chipSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    chipTextSelected: {
      color: colors.primaryOnPrimary,
    },
    anchorButton: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: 10,
    },
    anchorButtonText: {
      color: colors.text,
      fontSize: 14,
    },
    timeRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 10,
    },
    timeBtn: {
      flex: 1,
      marginTop: 0,
      alignItems: 'center',
    },
  });

