import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { getDb } from '../database/db';
import {
  cancelNotification,
  requestNotificationPermissions,
  schedulePromptNotification,
} from '../utils/notifications';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';
import { formatDateStr } from '../utils/dateString';
import { resolveAnchorDay } from '../services/recurrence';
import { useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Reusable bottom-sheet for creating *or editing* a scheduled reminder.
// Lives in a Modal; the backdrop takes `paddingBottom: keyboardInset` so the
// form stays visible above the soft keyboard. (There is no
// KeyboardAvoidingView here: under edge-to-edge it cannot lift an Android
// sheet; see hooks/useKeyboardHeight.js.)
//
// Props:
//   visible: boolean
//   defaultDate: Date. Pre-fill value for the date picker (e.g., calendar's visible month)
//   initial: row | null. When set, the form runs in *edit* mode and the
//            row is updated on save instead of inserted. recurrence_fired is
//            preserved (the cursor isn't reset just because the rule changed).
//   onClose: () => void
//   onSaved: () => void. Fired after the reminder is persisted + scheduled

const KIND_OPTIONS = [
  { key: null,    label: 'None'  },
  { key: 'day',   label: 'Day'   },
  { key: 'week',  label: 'Week'  },
  { key: 'month', label: 'Month' },
  { key: 'year',  label: 'Year'  },
];

function unitNoun(kind, n) {
  if (!kind) return '';
  if (n === 1) return kind;
  return kind + 's';
}

function parseDateOnly(s) {
  // 'YYYY-MM-DD' → JS Date in local time at 00:00.
  if (!s) return new Date();
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function parseTimeOnly(s) {
  // 'HH:MM' → JS Date today at that time. (We only use h/m from it.)
  const [hh, mm] = (s || '00:00').split(':').map(Number);
  const d = new Date();
  d.setHours(hh || 0, mm || 0, 0, 0);
  return d;
}

export default function ReminderFormSheet({
  visible,
  defaultDate,
  initial,
  onClose,
  onSaved,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();

  const isEdit = initial != null;

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [date, setDate] = useState(() => defaultDate || new Date());
  const [time, setTime] = useState(() => new Date());
  const [recurrenceKind, setRecurrenceKind] = useState(null); // null|'day'|'week'|'month'|'year'
  const [recurrenceEvery, setRecurrenceEvery] = useState('1');
  // Stored as string for input convenience; '' means "forever".
  const [recurrenceMax, setRecurrenceMax] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Reset / hydrate the form on open. When `initial` is set we hydrate from
  // the row; otherwise we use the default-date hint and clean defaults.
  useEffect(() => {
    if (!visible) return;
    if (initial) {
      setTitle(initial.title || '');
      setMessage(initial.message || '');
      setDate(parseDateOnly(initial.scheduled_date));
      setTime(parseTimeOnly(initial.scheduled_time));
      setRecurrenceKind(initial.recurrence_kind || null);
      setRecurrenceEvery(String(initial.recurrence_every || 1));
      setRecurrenceMax(
        initial.recurrence_max == null ? '' : String(initial.recurrence_max)
      );
    } else {
      setTitle('');
      setMessage('');
      setDate(defaultDate || new Date());
      setTime(new Date());
      setRecurrenceKind(null);
      setRecurrenceEvery('1');
      setRecurrenceMax('');
    }
  }, [visible, defaultDate, initial]);

  const handleSave = async () => {
    if (!title.trim() && !message.trim()) {
      Alert.alert('Empty', 'Add a title or a message for the reminder.');
      return;
    }

    const granted = await requestNotificationPermissions();
    if (!granted) {
      Alert.alert(
        'Permission Required',
        'Enable notifications to schedule reminders.'
      );
      return;
    }

    const dateStr = formatDateStr(date);
    const timeStr = time.toTimeString().slice(0, 5);

    // Normalize recurrence inputs.
    const everyN = Math.max(1, parseInt(recurrenceEvery, 10) || 1);
    const maxN = recurrenceMax.trim() === ''
      ? null
      : Math.max(1, parseInt(recurrenceMax, 10) || 1);
    const kind = recurrenceKind;

    const db = getDb();
    if (!db) return;

    if (isEdit) {
      // Editing an existing reminder. Cancel the old OS notification (if
      // any) and reschedule for the new date/time. recurrence_fired is
      // preserved: editing the rule doesn't reset the cursor.
      if (initial.notification_id) {
        await cancelNotification(initial.notification_id);
      }
      // The anchor is read from the row, not from `initial`: the callers
      // that open this form don't all select the column. An untouched date
      // keeps the stored anchor (the cursor may be sitting on a clamped
      // day); a newly picked date re-anchors.
      const prev = await db.getFirstAsync(
        `SELECT scheduled_date, recurrence_anchor_day
           FROM scheduled_prompts WHERE id = ?`,
        [initial.id]
      );
      const anchorDay = resolveAnchorDay({
        kind,
        date: dateStr,
        prevDate: prev?.scheduled_date,
        prevAnchorDay: prev?.recurrence_anchor_day,
      });
      const notificationId = await schedulePromptNotification(
        title.trim() || 'Journal Reminder',
        message.trim() || 'Time to write in your journal!',
        dateStr,
        timeStr,
        { kind: 'reminder', reminderId: initial.id }
      );
      await db.runAsync(
        `UPDATE scheduled_prompts
            SET title = ?, message = ?,
                scheduled_date = ?, scheduled_time = ?,
                notification_id = ?,
                recurrence_kind = ?,
                recurrence_every = ?,
                recurrence_max = ?,
                recurrence_anchor_day = ?,
                acknowledged_at = NULL,
                is_active = 1
          WHERE id = ?`,
        [
          title.trim(),
          message.trim(),
          dateStr,
          timeStr,
          notificationId,
          kind,
          everyN,
          maxN,
          anchorDay,
          initial.id,
        ]
      );
    } else {
      // Insert BEFORE scheduling (v0.87.0): the OS notification's tap
      // payload needs the row id, which only exists after the INSERT.
      // A crash between the two leaves notification_id NULL, which is exactly
      // what the every-boot rehydrate pass repairs.
      const result = await db.runAsync(
        `INSERT INTO scheduled_prompts
          (title, message, scheduled_date, scheduled_time, notification_id,
           recurrence_kind, recurrence_every, recurrence_max,
           recurrence_anchor_day)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [
          title.trim(),
          message.trim(),
          dateStr,
          timeStr,
          kind,
          everyN,
          maxN,
          resolveAnchorDay({ kind, date: dateStr }),
        ]
      );
      const reminderId = result.lastInsertRowId;
      const notificationId = await schedulePromptNotification(
        title.trim() || 'Journal Reminder',
        message.trim() || 'Time to write in your journal!',
        dateStr,
        timeStr,
        { kind: 'reminder', reminderId }
      );
      if (notificationId) {
        await db.runAsync(
          `UPDATE scheduled_prompts SET notification_id = ? WHERE id = ?`,
          [notificationId, reminderId]
        );
      }
    }

    onSaved?.();
    onClose?.();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.backdrop, keyboardInset > 0 && { paddingBottom: keyboardInset }]}
        onPress={onClose}
      >
        <Pressable
          style={[
            styles.sheet,
            keyboardInset === 0 && { paddingBottom: insets.bottom },
          ]}
          onPress={() => {}}
        >
            <View style={styles.handle} />
            <ScrollView
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.formTitle}>
                {isEdit ? 'Edit Reminder' : 'New Reminder'}
              </Text>

              <TextInput
                style={styles.input}
                placeholder="Title (optional)"
                placeholderTextColor={colors.placeholder}
                value={title}
                onChangeText={setTitle}
              />

              <TextInput
                style={[styles.input, styles.messageInput]}
                placeholder="Message / Prompt"
                placeholderTextColor={colors.placeholder}
                value={message}
                onChangeText={setMessage}
                multiline
              />

              <View style={styles.row}>
                <TouchableOpacity
                  style={styles.pickerBtn}
                  onPress={() => setShowDatePicker(true)}
                >
                  <Text style={styles.pickerText}>
                    {date.toLocaleDateString()}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.pickerBtn}
                  onPress={() => setShowTimePicker(true)}
                >
                  <Text style={styles.pickerText}>
                    {time.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </TouchableOpacity>
              </View>

              {showDatePicker && (
                <DateTimePicker
                  value={date}
                  mode="date"
                  display="default"
                  minimumDate={isEdit ? undefined : new Date()}
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

              <View style={styles.section}>
                <View style={styles.sectionLabelRow}>
                  <Ionicons
                    name="repeat-outline"
                    size={14}
                    color={colors.textMuted}
                  />
                  <Text style={styles.sectionLabel}>Repeat</Text>
                </View>
                <View style={styles.kindRow}>
                  {KIND_OPTIONS.map((opt) => {
                    const active = recurrenceKind === opt.key;
                    return (
                      <TouchableOpacity
                        key={String(opt.key)}
                        style={[
                          styles.kindChip,
                          active && styles.kindChipOn,
                        ]}
                        onPress={() => setRecurrenceKind(opt.key)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.kindChipText,
                            active && styles.kindChipTextOn,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {recurrenceKind ? (
                  <View style={styles.recurrenceConfig}>
                    <View style={styles.recurrenceFieldRow}>
                      <Text style={styles.recurrenceFieldLabel}>Every</Text>
                      <TextInput
                        style={styles.recurrenceNumberInput}
                        value={recurrenceEvery}
                        onChangeText={setRecurrenceEvery}
                        keyboardType="number-pad"
                        maxLength={3}
                      />
                      <Text style={styles.recurrenceFieldUnit}>
                        {unitNoun(recurrenceKind, parseInt(recurrenceEvery, 10) || 1)}
                      </Text>
                    </View>
                    <View style={styles.recurrenceFieldRow}>
                      <Text style={styles.recurrenceFieldLabel}>Stop after</Text>
                      <TextInput
                        style={styles.recurrenceNumberInput}
                        value={recurrenceMax}
                        onChangeText={setRecurrenceMax}
                        keyboardType="number-pad"
                        maxLength={4}
                        placeholder="∞"
                        placeholderTextColor={colors.placeholder}
                      />
                      <Text style={styles.recurrenceFieldUnit}>
                        {recurrenceMax.trim() === '' ? 'forever' : 'fires'}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>

              <View style={styles.actions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleSave}
                >
                  <Text style={styles.saveBtnText}>
                    {isEdit ? 'Save' : 'Schedule'}
                  </Text>
                </TouchableOpacity>
              </View>
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
      maxHeight: '90%',
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
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
      paddingBottom: 24,
    },
    formTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 12,
    },
    input: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      padding: 12,
      color: colors.text,
      fontSize: 15,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    messageInput: {
      minHeight: 60,
      textAlignVertical: 'top',
    },
    row: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 12,
    },
    pickerBtn: {
      flex: 1,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      padding: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    pickerText: {
      color: colors.text,
      fontSize: 14,
    },
    section: {
      marginBottom: 16,
    },
    sectionLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 8,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    kindRow: {
      flexDirection: 'row',
      gap: 6,
      flexWrap: 'wrap',
    },
    kindChip: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    kindChipOn: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    kindChipText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    kindChipTextOn: {
      color: colors.primaryOnPrimary,
    },
    recurrenceConfig: {
      marginTop: 10,
      gap: 8,
    },
    recurrenceFieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    recurrenceFieldLabel: {
      color: colors.textMuted,
      fontSize: 13,
      width: 90,
    },
    recurrenceNumberInput: {
      width: 64,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
      color: colors.text,
      fontSize: 14,
      textAlign: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    recurrenceFieldUnit: {
      color: colors.textMuted,
      fontSize: 13,
    },
    actions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 4,
    },
    cancelBtn: {
      flex: 1,
      backgroundColor: colors.surfaceMuted,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    cancelBtnText: {
      color: colors.textMuted,
      fontSize: 16,
    },
    saveBtn: {
      flex: 1,
      backgroundColor: colors.primary,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
    },
    saveBtnText: {
      color: colors.primaryOnPrimary,
      fontSize: 16,
      fontWeight: '600',
    },
  });
