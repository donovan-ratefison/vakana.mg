import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BeadView from './BeadView';
import MarkdownText from './MarkdownText';
import { readBead } from '../beads/types';
import { isPrivate, MASKED_TITLE } from '../utils/privacy';
import { getDb } from '../database/db';
import { formatTimeLabel } from '../utils/dateString';
import { useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';

// Read-only "peek at another note" sheet (the eye-outline affordance in the
// entry editor). The Emacs side-buffer / org side-window gesture brought into
// Vakana: consult any other note without leaving the draft you're writing.
// The editor never unmounts, so auto-save is untouched and point is kept.
//
// Two layers in one sheet: a searchable list of notes (rows = bead + title +
// date, so you recognise a note by its bead, the way the rest of the app
// reads), and a read-only detail of the tapped note (rendered markdown). It is
// *strictly* read-only: the only way out into editing is the explicit
// "Open fully" button, which the parent wires to navigation.push so a glance
// that turns into an edit stacks an editor (like the echo chip) rather than
// mutating anything here.
//
// Self-contained query (the editor parent has no notes-search of its own):
// mirrors HomeScreen.loadEntries' title/content/comment LIKE search, drops the
// per-row enrichment (no comment/thread counts, because a peek list doesn't need
// them), and excludes the entry being edited. Private notes mask in the list
// and refuse to reveal their body in detail. The peek is never a
// shoulder-surf hole; "Open fully" is the path in.
const RESULT_LIMIT = 60;

// Recently-peeked notes float to the top of the default (no-query) list so
// re-consulting the same reference is one tap, not a re-search. Module-level
// on purpose: the memory survives the sheet closing, navigation, and new
// editor instances across the app session (no schema: a working-session
// convenience that resets on restart). Most-recent first, deduped, capped.
const RECENT_PEEK_CAP = 8;
let recentPeekIds = [];
function rememberPeek(id) {
  recentPeekIds = [id, ...recentPeekIds.filter((x) => x !== id)].slice(
    0,
    RECENT_PEEK_CAP
  );
}

export default function PeekSheet({
  visible,
  currentEntryId,
  onClose,
  onOpenFully,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState([]);
  // How many leading rows are "recently peeked" (no-query default only): the
  // boundary where the "More notes" label goes.
  const [recentCount, setRecentCount] = useState(0);
  const [selected, setSelected] = useState(null);
  const reqRef = useRef(0);

  // Reset when the sheet closes so the next open starts clean (no stale
  // query, back to the list layer). The recently-peeked memory is module-level,
  // so it deliberately survives this reset.
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setDebounced('');
      setSelected(null);
      setRecentCount(0);
    }
  }, [visible]);

  // Debounce the search box ~250ms, matching the two list surfaces.
  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(h);
  }, [query]);

  // Query notes whenever the sheet is open (list layer) and the debounced text
  // changes. reqRef drops a stale result if a newer keystroke's query finishes
  // first. Skipped while a note is open in detail; re-runs when you come back
  // (selected → null), so a note you just peeked floats to the top.
  useEffect(() => {
    if (!visible || selected) return;
    const reqId = ++reqRef.current;
    (async () => {
      const db = getDb();
      if (!db) return;
      const q = debounced;

      if (q) {
        // Search layer: title + body + comments, like HomeScreen. No
        // recently-peeked floating: a search has its own intent.
        const wheres = [];
        const params = [];
        if (currentEntryId != null) {
          wheres.push('id != ?');
          params.push(currentEntryId);
        }
        wheres.push(
          `(title LIKE ? OR content LIKE ? OR EXISTS (
              SELECT 1 FROM comments c
               WHERE c.parent_kind = 'entry'
                 AND c.parent_id = entries.id
                 AND c.body LIKE ?
            ))`
        );
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        const result = await db.getAllAsync(
          `SELECT * FROM entries WHERE ${wheres.join(' AND ')}
            ORDER BY date DESC, updated_at DESC
            LIMIT ${RESULT_LIMIT}`,
          params
        );
        if (reqId !== reqRef.current) return;
        setRows(result);
        setRecentCount(0);
        return;
      }

      // Default layer (no query): recently-peeked notes first (in peek order),
      // then the chronological recents, deduped.
      const peekedIds = recentPeekIds.filter((id) => id !== currentEntryId);
      let peeked = [];
      if (peekedIds.length) {
        const ph = peekedIds.map(() => '?').join(',');
        const prows = await db.getAllAsync(
          `SELECT * FROM entries WHERE id IN (${ph})`,
          peekedIds
        );
        const byId = new Map(prows.map((r) => [r.id, r]));
        peeked = peekedIds.map((id) => byId.get(id)).filter(Boolean);
      }
      const peekedSet = new Set(peeked.map((r) => r.id));
      const wheres = [];
      const params = [];
      if (currentEntryId != null) {
        wheres.push('id != ?');
        params.push(currentEntryId);
      }
      const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
      const dateRows = await db.getAllAsync(
        `SELECT * FROM entries ${where}
          ORDER BY date DESC, updated_at DESC
          LIMIT ${RESULT_LIMIT}`,
        params
      );
      const rest = dateRows.filter((r) => !peekedSet.has(r.id));
      if (reqId !== reqRef.current) return;
      setRows([...peeked, ...rest]);
      setRecentCount(peeked.length);
    })();
  }, [visible, debounced, currentEntryId, selected]);

  const detailPrivate = selected ? isPrivate(selected) : false;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={selected ? () => setSelected(null) : onClose}
    >
      <Pressable
        style={[
          styles.backdrop,
          keyboardInset > 0 && { paddingBottom: keyboardInset },
        ]}
        onPress={onClose}
      >
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom + 8) }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />

          {selected ? (
            // ---- Detail layer: read-only body of the tapped note ----
            <>
              <View style={styles.detailHeader}>
                <TouchableOpacity
                  onPress={() => setSelected(null)}
                  hitSlop={8}
                  accessibilityLabel="Back to results"
                >
                  <Ionicons name="chevron-back" size={22} color={colors.text} />
                </TouchableOpacity>
                <View style={styles.detailHeaderBody}>
                  <Text
                    style={[
                      styles.detailTitle,
                      detailPrivate && styles.detailTitleMasked,
                    ]}
                    numberOfLines={1}
                  >
                    {detailPrivate
                      ? MASKED_TITLE
                      : selected.title || 'Untitled'}
                  </Text>
                  <Text style={styles.detailDate}>
                    {selected.date}
                    {selected.time ? ` · ${formatTimeLabel(selected.time)}` : ''}
                  </Text>
                </View>
                <BeadView bead={readBead(selected)} size={20} />
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.detailBody}
              >
                {detailPrivate ? (
                  <Text style={styles.privateNote}>
                    This entry is private. Open it fully to read it.
                  </Text>
                ) : selected.content ? (
                  <MarkdownText>{selected.content}</MarkdownText>
                ) : (
                  <Text style={styles.privateNote}>No content.</Text>
                )}
              </ScrollView>

              <TouchableOpacity
                style={styles.openFully}
                onPress={() => onOpenFully?.(selected.id)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="open-outline"
                  size={16}
                  color={colors.primary}
                />
                <Text style={styles.openFullyText}>Open fully</Text>
              </TouchableOpacity>
            </>
          ) : (
            // ---- List layer: searchable notes ----
            <>
              <View style={styles.searchRow}>
                <Ionicons name="eye-outline" size={16} color={colors.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Peek at a note…"
                  placeholderTextColor={colors.placeholder}
                  autoFocus
                  returnKeyType="search"
                />
                {query ? (
                  <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                    <Ionicons
                      name="close-circle"
                      size={16}
                      color={colors.textFaint}
                    />
                  </TouchableOpacity>
                ) : null}
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.list}
                keyboardShouldPersistTaps="handled"
              >
                {rows.length === 0 ? (
                  <Text style={styles.emptyText}>
                    {debounced
                      ? 'No notes match.'
                      : 'No other notes to peek at yet.'}
                  </Text>
                ) : null}

                {rows.map((e, i) => {
                  const masked = isPrivate(e);
                  const showRecentLabel =
                    !debounced && recentCount > 0 && i === 0;
                  const showMoreLabel =
                    !debounced &&
                    recentCount > 0 &&
                    i === recentCount &&
                    rows.length > recentCount;
                  return (
                    <React.Fragment key={e.id}>
                      {showRecentLabel ? (
                        <Text style={styles.sectionLabel}>Recently peeked</Text>
                      ) : null}
                      {showMoreLabel ? (
                        <Text style={styles.sectionLabel}>More notes</Text>
                      ) : null}
                    <TouchableOpacity
                      style={styles.row}
                      activeOpacity={0.7}
                      onPress={() => {
                        rememberPeek(e.id);
                        setSelected(e);
                      }}
                      accessibilityLabel={`Peek at ${
                        masked ? 'private entry' : e.title || 'untitled entry'
                      }`}
                    >
                      <BeadView bead={readBead(e)} size={18} />
                      <View style={styles.rowBody}>
                        <Text
                          style={[
                            styles.rowTitle,
                            masked && styles.rowTitleMasked,
                          ]}
                          numberOfLines={1}
                        >
                          {masked ? MASKED_TITLE : e.title || 'Untitled'}
                        </Text>
                        <Text style={styles.rowDate}>{e.date}</Text>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={colors.textFaint}
                      />
                    </TouchableOpacity>
                    </React.Fragment>
                  );
                })}
              </ScrollView>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      // Fixed height (not maxHeight): the inner ScrollView is flex:1 and would
      // collapse to zero under an unbounded parent. Taller than the lean
      // MentionedByDrawer because the detail layer renders a full note body.
      height: '75%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
      paddingBottom: 16,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      alignSelf: 'center',
      marginBottom: 12,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 20,
      marginBottom: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      padding: 0,
    },
    list: {
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 12,
      marginBottom: 4,
    },
    emptyText: {
      color: colors.textFaint,
      fontSize: 14,
      fontStyle: 'italic',
      textAlign: 'center',
      paddingVertical: 20,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowBody: {
      flex: 1,
    },
    rowTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    rowTitleMasked: {
      color: colors.textMuted,
      fontStyle: 'italic',
      fontWeight: '400',
    },
    rowDate: {
      color: colors.textFaint,
      fontSize: 12,
      marginTop: 2,
    },
    detailHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    detailHeaderBody: {
      flex: 1,
    },
    detailTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    detailTitleMasked: {
      color: colors.textMuted,
      fontStyle: 'italic',
      fontWeight: '500',
    },
    detailDate: {
      color: colors.textFaint,
      fontSize: 12,
      marginTop: 2,
    },
    detailBody: {
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 24,
    },
    privateNote: {
      color: colors.textFaint,
      fontSize: 14,
      fontStyle: 'italic',
      paddingVertical: 12,
    },
    openFully: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginHorizontal: 20,
      marginTop: 4,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    openFullyText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
    },
  });
