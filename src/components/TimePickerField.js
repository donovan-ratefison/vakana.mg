import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../theme';

// Sibling of DatePickerField: same shape, mode="time". The `date` prop is
// still a full Date (the same Date the date-picker binds to); the picker
// only mutates hours/minutes on the parent's side.
export default function TimePickerField({ date, onDateChange, label }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [show, setShow] = React.useState(false);

  const formatTime = (d) =>
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label || 'Time'}</Text>
      <TouchableOpacity style={styles.timeButton} onPress={() => setShow(true)}>
        <Text style={styles.timeText}>{formatTime(date)}</Text>
      </TouchableOpacity>
      {show && (
        <DateTimePicker
          value={date}
          mode="time"
          display="default"
          onChange={(event, selectedDate) => {
            setShow(false);
            if (selectedDate) onDateChange(selectedDate);
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { marginBottom: 16 },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textMuted,
      marginBottom: 6,
    },
    timeButton: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    timeText: { color: colors.text, fontSize: 16 },
  });
