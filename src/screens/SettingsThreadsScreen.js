import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import {
  loadQuietThreshold,
  saveQuietThreshold,
  QUIET_THRESHOLD_OPTIONS,
  QUIET_DEFAULT_THRESHOLD_DAYS,
} from '../utils/quietThreads';
import {
  clampThresholdDays,
  THRESHOLD_MIN_DAYS,
  THRESHOLD_MAX_DAYS,
} from '../utils/thresholds';

// Mirrors SettingsWanderScreen's selection-derivation pattern: one
// persisted integer, the radio row state is derived. Custom is selected
// whenever the value is not one of the presets.
function isCustomQuietThreshold(days) {
  return !QUIET_THRESHOLD_OPTIONS.some((opt) => opt.days === days);
}

export default function SettingsThreadsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [thresholdDays, setThresholdDays] = useState(QUIET_DEFAULT_THRESHOLD_DAYS);
  const [loaded, setLoaded] = useState(false);
  const [customText, setCustomText] = useState('');
  // UI-state flag: "the user wants the Custom row selected and its input
  // visible". Decoupled from `thresholdDays` so the user can pick Custom
  // even when the current persisted value happens to be a preset.
  const [customRowSelected, setCustomRowSelected] = useState(false);
  const customInputRef = useRef(null);

  useEffect(() => {
    loadQuietThreshold().then((days) => {
      setThresholdDays(days);
      setCustomText(String(days));
      setCustomRowSelected(isCustomQuietThreshold(days));
      setLoaded(true);
    });
  }, []);

  const handlePickPreset = async (days) => {
    setThresholdDays(days);
    setCustomText(String(days));
    setCustomRowSelected(false);
    await saveQuietThreshold(days);
  };

  const handlePickCustom = () => {
    setCustomRowSelected(true);
    setTimeout(() => customInputRef.current?.focus(), 50);
  };

  const commitCustom = async () => {
    const clamped = clampThresholdDays(customText);
    if (clamped == null) {
      setCustomText(String(thresholdDays));
      return;
    }
    setCustomText(String(clamped));
    setThresholdDays(clamped);
    await saveQuietThreshold(clamped);
  };

  const customSelected = customRowSelected || isCustomQuietThreshold(thresholdDays);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Threads</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionHint}>
          A thread that you did not touch for this time or longer goes into a
          QUIET band at the bottom of the threads list. Closed threads have
          their own register (the clasp) and do not go into this band.
        </Text>

        <Text style={styles.sectionTitle}>Quiet threshold</Text>
        <Text style={styles.sectionHintInline}>
          The last-touched time of a thread changes when you add a bead or a
          comment, rename the thread, or put it in a collection. A mention
          does not change it.
        </Text>
        <View style={styles.card}>
          {QUIET_THRESHOLD_OPTIONS.map((opt) => {
            const active = !customSelected && thresholdDays === opt.days;
            return (
              <TouchableOpacity
                key={opt.days}
                style={[styles.row, styles.rowDivider]}
                onPress={() => handlePickPreset(opt.days)}
                activeOpacity={0.7}
                disabled={!loaded}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{opt.label}</Text>
                  {opt.days === QUIET_DEFAULT_THRESHOLD_DAYS ? (
                    <Text style={styles.rowSubLabel}>recommended</Text>
                  ) : null}
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
          <TouchableOpacity
            style={[styles.row, customSelected && styles.rowDivider]}
            onPress={handlePickCustom}
            activeOpacity={0.7}
            disabled={!loaded}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Custom</Text>
            </View>
            {customSelected ? (
              <Ionicons
                name="checkmark-circle"
                size={22}
                color={colors.primary}
              />
            ) : (
              <View style={styles.radioOff} />
            )}
          </TouchableOpacity>
          {customSelected ? (
            <View style={styles.customInputRow}>
              <Text style={styles.customInputLabel}>Days</Text>
              <TextInput
                ref={customInputRef}
                style={styles.customInput}
                value={customText}
                onChangeText={setCustomText}
                onBlur={commitCustom}
                onSubmitEditing={commitCustom}
                keyboardType="number-pad"
                returnKeyType="done"
                maxLength={4}
                placeholder={String(THRESHOLD_MIN_DAYS)}
                placeholderTextColor={colors.placeholder}
                editable={loaded}
                accessibilityLabel={`Custom Quiet threshold in days, between ${THRESHOLD_MIN_DAYS} and ${THRESHOLD_MAX_DAYS}`}
              />
              <Text style={styles.customInputHint}>
                {THRESHOLD_MIN_DAYS}–{THRESHOLD_MAX_DAYS}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>What this does</Text>
        <View style={styles.paragraphCard}>
          <Text style={styles.paragraph}>
            Under User + Recent, a thread moves out of its date band when its
            last touch is older than this threshold. It moves into a section
            at the end of the list with the label <Text style={styles.paragraphCode}>QUIET · {thresholdDays}d+</Text>.
          </Text>
          <Text style={[styles.paragraph, styles.paragraphSpaced]}>
            Quiet is a third state between Live and Closed. Add a bead or a
            comment, or rename the thread, and it goes back into TODAY on
            the next reload.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
    sectionHintInline: {
      fontSize: 12,
      color: colors.textMuted,
      marginBottom: 8,
      marginLeft: 4,
      lineHeight: 16,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginTop: 8,
      marginBottom: 8,
      marginLeft: 4,
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
    rowText: { flex: 1 },
    rowLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
    rowSubLabel: {
      fontSize: 12,
      color: colors.textFaint,
      marginTop: 2,
    },
    radioOff: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    customInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingLeft: 32,
      paddingVertical: 10,
    },
    customInputLabel: {
      fontSize: 14,
      color: colors.textMuted,
      fontWeight: '600',
    },
    customInput: {
      minWidth: 72,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      color: colors.text,
      fontSize: 15,
      textAlign: 'center',
    },
    customInputHint: {
      fontSize: 12,
      color: colors.textFaint,
    },
    paragraphCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    paragraph: {
      fontSize: 14,
      color: colors.text,
      lineHeight: 20,
    },
    paragraphCode: {
      fontWeight: '600',
      color: colors.textMuted,
    },
    paragraphSpaced: { marginTop: 10 },
  });
