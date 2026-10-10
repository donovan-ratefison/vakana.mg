import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Pressable,
} from 'react-native';
import { useTheme } from '../theme';

// Year-or-month picker modal. `mode` is 'year' (year list only) or
// 'month' (year list + month grid). Returns the selected date on
// confirm, set to the first of the month / Jan 1st of the year.
export default function YearMonthPicker({
  visible,
  mode,
  initialDate,
  onClose,
  onSelect,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeYMStyles(colors), [colors]);
  const initialYear = initialDate?.getFullYear() ?? new Date().getFullYear();
  const initialMonth = initialDate?.getMonth() ?? 0;
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);

  useEffect(() => {
    if (!visible) return;
    setYear(initialDate?.getFullYear() ?? new Date().getFullYear());
    setMonth(initialDate?.getMonth() ?? 0);
  }, [visible, initialDate]);

  const yearList = useMemo(() => {
    const cur = new Date().getFullYear();
    const arr = [];
    for (let y = cur + 5; y >= cur - 30; y--) arr.push(y);
    return arr;
  }, []);

  const monthList = useMemo(
    () => [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ],
    []
  );

  const handleConfirm = () => {
    if (mode === 'year') {
      onSelect(new Date(year, 0, 1));
    } else {
      onSelect(new Date(year, month, 1));
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>
            {mode === 'year' ? 'Pick a year' : 'Pick a month'}
          </Text>

          <ScrollView style={styles.yearScroll}>
            {yearList.map((y) => {
              const selected = y === year;
              return (
                <TouchableOpacity
                  key={y}
                  style={[styles.yearRow, selected && styles.yearRowSelected]}
                  onPress={() => setYear(y)}
                >
                  <Text
                    style={[
                      styles.yearText,
                      selected && styles.yearTextSelected,
                    ]}
                  >
                    {y}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {mode === 'month' ? (
            <View style={styles.monthGrid}>
              {monthList.map((label, idx) => {
                const selected = idx === month;
                return (
                  <TouchableOpacity
                    key={label}
                    style={[
                      styles.monthCell,
                      selected && styles.monthCellSelected,
                    ]}
                    onPress={() => setMonth(idx)}
                  >
                    <Text
                      style={[
                        styles.monthText,
                        selected && styles.monthTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity onPress={onClose} style={styles.btnGhost}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleConfirm} style={styles.btnPrimary}>
              <Text style={styles.btnPrimaryText}>OK</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeYMStyles = (colors) =>
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
      marginBottom: 12,
    },
    yearScroll: {
      maxHeight: 220,
    },
    yearRow: {
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 6,
    },
    yearRowSelected: {
      backgroundColor: colors.primary,
    },
    yearText: {
      color: colors.text,
      fontSize: 15,
    },
    yearTextSelected: {
      color: colors.primaryOnPrimary,
      fontWeight: '700',
    },
    monthGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 10,
    },
    monthCell: {
      width: '23%',
      paddingVertical: 10,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
    },
    monthCellSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    monthText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    monthTextSelected: {
      color: colors.primaryOnPrimary,
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
