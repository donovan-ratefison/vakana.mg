import React, { useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { formatRule, formatProgress } from '../services/recurrence';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Long-press affordance for a reminder row in the calendar's reminder
// panel (and the recurring-list sheet). Rows: Write entry, Edit,
// Acknowledge, Stop/Resume (recurring only), Delete. The parent owns the
// next-step flows; this sheet is purely a chooser.
//
// "Write entry" is the reminder's primary verb. It routes through the
// exact same path as tapping the fired banner (parent's openReminderEntry),
// so ack-on-content, recurrence-advance, one-shot-terminate, and
// back-out-stays-unfired are all inherited, never reimplemented here.
//
// Also used as the action sheet for a one-shot reminder, in which case the
// Stop/Resume row is hidden.
export default function ReminderActionsSheet({
  visible,
  reminder,
  onWriteEntry,
  onEdit,
  onAck,
  onToggleActive,
  onDelete,
  onClose,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  if (!reminder) return null;

  const isRecurring = !!reminder.recurrence_kind;
  const isActive = reminder.is_active == null || reminder.is_active === 1;
  const ruleLabel = isRecurring
    ? `${formatRule({
        kind: reminder.recurrence_kind,
        every: reminder.recurrence_every || 1,
        scheduledDate: reminder.scheduled_date,
      })}  ·  ${formatProgress({
        fired: reminder.recurrence_fired || 0,
        max: reminder.recurrence_max,
      })}`
    : 'one-shot';

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
          <Text style={styles.heading}>Reminder</Text>
          <Text style={styles.subheading} numberOfLines={1}>
            {reminder.title || reminder.message || 'Untitled reminder'}
          </Text>
          {reminder.title &&
          reminder.message &&
          reminder.message !== reminder.title ? (
            <Text style={styles.messageLine} numberOfLines={3}>
              {reminder.message}
            </Text>
          ) : null}
          <Text style={styles.metaLine} numberOfLines={1}>
            {ruleLabel}
            {isRecurring && !isActive ? '  ·  stopped' : ''}
          </Text>

          {onWriteEntry ? (
            <TouchableOpacity
              style={styles.row}
              onPress={onWriteEntry}
              activeOpacity={0.7}
            >
              <Ionicons
                name="document-text-outline"
                size={20}
                color={colors.primary}
              />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>Write entry</Text>
                <Text style={styles.rowSubtitle}>
                  {isRecurring
                    ? 'Opens a new entry from this reminder. When you write content, the series moves to the next occurrence.'
                    : 'Opens a new entry from this reminder. When you write content, the app marks the reminder as done.'}
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.row}
            onPress={onEdit}
            activeOpacity={0.7}
          >
            <Ionicons name="create-outline" size={20} color={colors.primary} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>Edit</Text>
              <Text style={styles.rowSubtitle}>
                Change the title, message, time, or recurrence rule.
              </Text>
            </View>
          </TouchableOpacity>

          {onAck ? (
            <TouchableOpacity
              style={styles.row}
              onPress={onAck}
              activeOpacity={0.7}
            >
              <Ionicons
                name="checkmark-done-outline"
                size={20}
                color={colors.primary}
              />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>Acknowledge</Text>
                <Text style={styles.rowSubtitle}>
                  {isRecurring
                    ? 'Marks this occurrence as done and moves to the next occurrence.'
                    : 'Marks the reminder as done. It stays struck on its calendar day. You can restore it at any time.'}
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}

          {isRecurring ? (
            <TouchableOpacity
              style={styles.row}
              onPress={onToggleActive}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isActive ? 'pause-outline' : 'play-outline'}
                size={20}
                color={colors.primary}
              />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>
                  {isActive ? 'Stop series' : 'Resume series'}
                </Text>
                <Text style={styles.rowSubtitle}>
                  {isActive
                    ? "The series stops. The counter keeps its value. You can resume the series at any time."
                    : 'Schedules the next occurrence and continues the series.'}
                </Text>
              </View>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.row}
            onPress={onDelete}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { color: colors.danger }]}>
                Delete
              </Text>
              <Text style={styles.rowSubtitle}>
                Permanently deletes the reminder and its comments.
              </Text>
            </View>
          </TouchableOpacity>
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
      marginTop: 2,
    },
    messageLine: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
      paddingHorizontal: 20,
      marginTop: 4,
    },
    metaLine: {
      color: colors.textFaint,
      fontSize: 12,
      paddingHorizontal: 20,
      paddingBottom: 8,
      marginTop: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    rowBody: { flex: 1 },
    rowTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    rowSubtitle: {
      color: colors.textFaint,
      fontSize: 12,
      marginTop: 2,
    },
  });
