import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useLock } from '../lock';
import { AUTO_LOCK_OPTIONS } from '../utils/preferences';

const OPTION_LABEL = {
  off: 'Off',
  immediate: 'Immediately',
  '1m': 'After 1 minute',
  '5m': 'After 5 minutes',
  '15m': 'After 15 minutes',
};
const OPTION_ICON = {
  off: 'lock-open-outline',
  immediate: 'flash-outline',
  '1m': 'time-outline',
  '5m': 'time-outline',
  '15m': 'time-outline',
};
const OPTION_HINT = {
  off: 'The app stays unlocked until you lock it manually.',
  immediate: 'The app locks when you leave it.',
  '1m': 'The app locks if you are away for more than one minute.',
  '5m': 'The app locks if you are away for more than five minutes.',
  '15m': 'The app locks if you are away for more than fifteen minutes.',
};

export default function SettingsAutoLockScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { autoLock, setAutoLock } = useLock();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Auto-lock</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionHint}>
          Vakana asks for your PIN again when you come back after you leave the
          app. The timer starts when you switch to another app or lock your
          phone. If you come back before the timer ends, the app stays open.
        </Text>

        <View style={styles.card}>
          {AUTO_LOCK_OPTIONS.map((opt, i) => {
            const active = autoLock === opt;
            return (
              <TouchableOpacity
                key={opt}
                style={[
                  styles.row,
                  i < AUTO_LOCK_OPTIONS.length - 1 && styles.rowDivider,
                ]}
                onPress={() => setAutoLock(opt)}
                activeOpacity={0.7}
              >
                <View style={styles.rowIcon}>
                  <Ionicons
                    name={OPTION_ICON[opt]}
                    size={20}
                    color={colors.primary}
                  />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{OPTION_LABEL[opt]}</Text>
                  <Text style={styles.rowHint}>{OPTION_HINT[opt]}</Text>
                </View>
                {active ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={colors.primary}
                  />
                ) : (
                  <View style={styles.radioOff} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.footnote}>
          Auto-lock only shows the PIN screen again. It does not encrypt your
          notes. It applies to the vault that is open.
        </Text>
      </ScrollView>
    </View>
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
      paddingBottom: 12,
    },
    headerTitle: { fontSize: 22, fontWeight: '700', color: colors.text },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    scrollContent: { padding: 20, paddingBottom: 40 },
    sectionHint: {
      fontSize: 13,
      color: colors.textMuted,
      marginBottom: 16,
      lineHeight: 18,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 14,
      gap: 12,
    },
    rowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rowText: { flex: 1 },
    rowLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
    rowHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    radioOff: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    footnote: {
      fontSize: 12,
      color: colors.textFaint,
      marginTop: 16,
      lineHeight: 17,
    },
  });
