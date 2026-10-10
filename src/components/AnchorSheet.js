import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import YearMonthPicker from './YearMonthPicker';
import { getDb } from '../database/db';
import { useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Anchor kinds shown in the chip row. Matches ThreadComposerScreen's set
// exactly. 'week' is intentionally absent because week anchors are
// owned by auto-week threads, which are read-only.
const ANCHOR_KINDS = [
  { key: 'none', label: 'None' },
  { key: 'day', label: 'Day' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'time', label: 'Time' },
];

const pad2 = (n) => (n < 10 ? `0${n}` : `${n}`);
const toISODate = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toHM = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

// Bottom-sheet anchor picker. Hydrates from the thread row on open,
// commits the chosen kind/date/time on Save, and calls onChange so the
// parent can refresh. Cancel discards local edits.
export default function AnchorSheet({ visible, thread, onChange, onClose }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [kind, setKind] = useState('none');
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  // Hydrate from thread row on each open. Mirrors the composer's
  // edit-mode initial-load branch, condensed.
  useEffect(() => {
    if (!visible || !thread) return;
    setKind(thread.anchor_kind || 'none');
    const ad = thread.anchor_date;
    if (thread.anchor_kind === 'day' && ad) {
      const [y, m, d] = ad.split('-').map(Number);
      setDate(new Date(y, (m || 1) - 1, d || 1));
    } else if (thread.anchor_kind === 'month' && ad) {
      const [y, m] = ad.split('-').map(Number);
      setDate(new Date(y, (m || 1) - 1, 1));
    } else if (thread.anchor_kind === 'year' && ad) {
      setDate(new Date(Number(ad), 0, 1));
    } else if (thread.anchor_kind === 'time') {
      if (ad) {
        const [y, m, d] = ad.split('-').map(Number);
        setDate(new Date(y, (m || 1) - 1, d || 1));
      }
      if (thread.anchor_time) {
        const [hh, mm] = thread.anchor_time.split(':').map(Number);
        const tm = new Date();
        tm.setHours(hh || 0, mm || 0, 0, 0);
        setTime(tm);
      }
    } else {
      setDate(new Date());
      setTime(new Date());
    }
  }, [visible, thread]);

  const handleSave = async () => {
    const db = getDb();
    if (!db || !thread) return;
    let anchorDateValue = null;
    let anchorTimeValue = null;
    if (kind === 'day') anchorDateValue = toISODate(date);
    else if (kind === 'month')
      anchorDateValue = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
    else if (kind === 'year') anchorDateValue = `${date.getFullYear()}`;
    else if (kind === 'time') {
      anchorDateValue = toISODate(date);
      anchorTimeValue = toHM(time);
    }
    const kindForDb = kind === 'none' ? null : kind;
    await db.runAsync(
      `UPDATE threads
          SET anchor_kind = ?, anchor_date = ?, anchor_time = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
      [kindForDb, anchorDateValue, anchorTimeValue, thread.id]
    );
    onChange?.();
    onClose?.();
  };

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
          <View style={styles.headerRow}>
            <Text style={styles.title}>Anchor</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.chipRow}>
            {ANCHOR_KINDS.map((k) => {
              const selected = kind === k.key;
              return (
                <TouchableOpacity
                  key={k.key}
                  onPress={() => setKind(k.key)}
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

          {kind === 'day' ? (
            <TouchableOpacity
              style={styles.anchorButton}
              onPress={() => setShowDatePicker(true)}
            >
              <Text style={styles.anchorButtonText}>{toISODate(date)}</Text>
            </TouchableOpacity>
          ) : null}

          {kind === 'month' ? (
            <TouchableOpacity
              style={styles.anchorButton}
              onPress={() => setShowMonthPicker(true)}
            >
              <Text style={styles.anchorButtonText}>
                {date.toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}
              </Text>
            </TouchableOpacity>
          ) : null}

          {kind === 'year' ? (
            <TouchableOpacity
              style={styles.anchorButton}
              onPress={() => setShowYearPicker(true)}
            >
              <Text style={styles.anchorButtonText}>{date.getFullYear()}</Text>
            </TouchableOpacity>
          ) : null}

          {kind === 'time' ? (
            <View style={styles.timeRow}>
              <TouchableOpacity
                style={[styles.anchorButton, styles.timeBtn]}
                onPress={() => setShowDatePicker(true)}
              >
                <Text style={styles.anchorButtonText}>{toISODate(date)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.anchorButton, styles.timeBtn]}
                onPress={() => setShowTimePicker(true)}
              >
                <Text style={styles.anchorButtonText}>{toHM(time)}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {showDatePicker && (
            <DateTimePicker
              value={date}
              mode="date"
              display="default"
              onChange={(e, d) => {
                setShowDatePicker(false);
                if (d) setDate(d);
              }}
            />
          )}

          {showTimePicker && (
            <DateTimePicker
              value={time}
              mode="time"
              display="default"
              onChange={(e, t) => {
                setShowTimePicker(false);
                if (t) setTime(t);
              }}
            />
          )}

          <YearMonthPicker
            visible={showYearPicker}
            mode="year"
            initialDate={date}
            onClose={() => setShowYearPicker(false)}
            onSelect={(d) => {
              setDate(d);
              setShowYearPicker(false);
            }}
          />

          <YearMonthPicker
            visible={showMonthPicker}
            mode="month"
            initialDate={date}
            onClose={() => setShowMonthPicker(false)}
            onSelect={(d) => {
              setDate(d);
              setShowMonthPicker(false);
            }}
          />

          <View style={styles.actions}>
            <TouchableOpacity onPress={onClose} style={styles.btnGhost}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} style={styles.btnPrimary}>
              <Text style={styles.btnPrimaryText}>Save</Text>
            </TouchableOpacity>
          </View>
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
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
      paddingHorizontal: 20,
      paddingBottom: 24,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      alignSelf: 'center',
      marginBottom: 12,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    title: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
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
      marginTop: 12,
    },
    anchorButtonText: {
      color: colors.text,
      fontSize: 14,
    },
    timeRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 12,
    },
    timeBtn: {
      flex: 1,
      marginTop: 0,
      alignItems: 'center',
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 20,
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
