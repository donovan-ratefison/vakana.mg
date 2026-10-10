import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { loadRecurringSeries } from '../services/reminders';
import { formatRule, formatProgress } from '../services/recurrence';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Bottom-sheet that lists every recurring reminder series across all time
// (active and stopped). Tap a row to open the actions sheet on that
// series. That is where stop/resume/delete/edit live. Backdrop dismisses.
//
// Reachable from the calendar's "Recurring (N)" header link.
export default function RecurringReminderListSheet({
  visible,
  onClose,
  onSelect,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [series, setSeries] = useState([]);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      setSeries(await loadRecurringSeries());
    })();
  }, [visible]);

  const formatNextFire = (s) => {
    if (!s.scheduled_date || !s.scheduled_time) return '';
    const dt = new Date(`${s.scheduled_date}T${s.scheduled_time}:00`);
    if (isNaN(dt.getTime())) return '';
    return dt.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
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
          style={[styles.sheet, { paddingBottom: Math.max(16, insets.bottom + 8) }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          <Text style={styles.heading}>Recurring reminders</Text>
          <Text style={styles.subheading}>
            {series.length === 0
              ? 'None yet.'
              : `${series.length} series total`}
          </Text>

          <ScrollView contentContainerStyle={styles.list}>
            {series.length === 0 ? (
              <Text style={styles.emptyText}>
                This list shows your recurring reminders. You can stop them
                here. To create one, tap the + button in the calendar. Then
                set the **Repeat** picker to a value other than None.
              </Text>
            ) : null}

            {series.map((s) => {
              const isActive = s.is_active == null || s.is_active === 1;
              const next = formatNextFire(s);
              return (
                <TouchableOpacity
                  key={s.id}
                  style={styles.row}
                  onPress={() => onSelect?.(s)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={isActive ? 'repeat' : 'repeat-outline'}
                    size={18}
                    color={isActive ? colors.primary : colors.textFaint}
                  />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {s.title || s.message || 'Untitled reminder'}
                    </Text>
                    <Text
                      style={[
                        styles.rowMeta,
                        !isActive && { color: colors.textFaint },
                      ]}
                      numberOfLines={1}
                    >
                      {formatRule({
                        kind: s.recurrence_kind,
                        every: s.recurrence_every || 1,
                        scheduledDate: s.scheduled_date,
                      })}
                      {'  ·  '}
                      {formatProgress({
                        fired: s.recurrence_fired || 0,
                        max: s.recurrence_max,
                      })}
                      {!isActive ? '  ·  stopped' : next ? `  ·  next ${next}` : ''}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.textFaint}
                  />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
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
      maxHeight: '85%',
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
    heading: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: 20,
    },
    subheading: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
      paddingHorizontal: 20,
      paddingBottom: 8,
      marginTop: 2,
    },
    list: {
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 12,
    },
    emptyText: {
      color: colors.textFaint,
      fontSize: 13,
      lineHeight: 19,
      paddingVertical: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowBody: { flex: 1 },
    rowTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    rowMeta: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 2,
    },
  });
