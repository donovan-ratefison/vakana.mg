import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import {
  loadWanderSettings,
  saveWanderEnabled,
  saveWanderThreshold,
  WANDER_THRESHOLD_OPTIONS,
  clampThresholdDays,
} from '../utils/wander';
import {
  THRESHOLD_MIN_DAYS,
  THRESHOLD_MAX_DAYS,
} from '../utils/thresholds';

// Derive selection state from a single `thresholdDays` integer. If the
// value matches one of the presets exactly → that row is highlighted,
// Custom is unselected. Otherwise → Custom is highlighted and its input
// reveals, prefilled with the current value. This is the only source of
// truth for "which row is on"; there is no separate selected-key state
// that could fall out of sync with the persisted value.
function isCustomThreshold(days) {
  return !WANDER_THRESHOLD_OPTIONS.some((opt) => opt.days === days);
}

export default function SettingsWanderScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [enabled, setEnabled] = useState(false);
  const [thresholdDays, setThresholdDays] = useState(180);
  const [loaded, setLoaded] = useState(false);
  // Local string state for the Custom input. Decoupled from
  // `thresholdDays` so the user can type "1234" without each keystroke
  // re-saving (and so an in-flight empty string doesn't clobber the
  // persisted value). Commits to `thresholdDays` + secure-store on blur
  // / "done", via the same clamp the load path uses.
  const [customText, setCustomText] = useState('');
  // UI-state flag: "the user wants the Custom row selected and its input
  // visible". Decoupled from `thresholdDays` so the user can pick Custom
  // even when the current persisted value happens to be a preset: the
  // input reveals so they can type a non-preset value. Initialised from
  // the loaded value (custom-persisted → Custom shows on entry).
  const [customRowSelected, setCustomRowSelected] = useState(false);
  const customInputRef = useRef(null);

  useEffect(() => {
    loadWanderSettings().then((s) => {
      setEnabled(s.enabled);
      setThresholdDays(s.thresholdDays);
      setCustomText(String(s.thresholdDays));
      setCustomRowSelected(isCustomThreshold(s.thresholdDays));
      setLoaded(true);
    });
  }, []);

  const handleToggle = async (next) => {
    setEnabled(next);
    await saveWanderEnabled(next);
  };

  const handlePickPreset = async (days) => {
    setThresholdDays(days);
    // Re-sync the custom input so tapping Custom afterwards starts
    // fresh from the new value, not the stale prior entry.
    setCustomText(String(days));
    setCustomRowSelected(false);
    await saveWanderThreshold(days);
  };

  const handlePickCustom = () => {
    // Flip the UI to Custom and focus the input on the next tick (after
    // the input has rendered). The persisted value isn't touched until
    // the user actually commits a typed value.
    setCustomRowSelected(true);
    setTimeout(() => customInputRef.current?.focus(), 50);
  };

  const commitCustom = async () => {
    const clamped = clampThresholdDays(customText);
    if (clamped == null) {
      // Non-numeric / empty → restore the prior valid value as the
      // visible text. Persisted value is untouched.
      setCustomText(String(thresholdDays));
      return;
    }
    setCustomText(String(clamped));
    setThresholdDays(clamped);
    await saveWanderThreshold(clamped);
  };

  const customSelected = customRowSelected || isCustomThreshold(thresholdDays);

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
        <Text style={styles.headerTitle}>Wander</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionHint}>
          Wander opens a random entry that is older than the threshold below.
          Wander is a peer to the bell. The bell gives the returns that you
          set. Wander gives the returns that the system selects. Wander never
          opens a private entry.
        </Text>

        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchLabel}>Enable Wander</Text>
              <Text style={styles.switchHint}>
                {enabled
                  ? 'The dice icon appears on the Home header when older entries exist.'
                  : 'Wander is off by default. Turn it on to show the dice icon on the Home header.'}
              </Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={handleToggle}
              disabled={!loaded}
              trackColor={{ false: colors.borderStrong, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Threshold</Text>
        <Text style={styles.sectionHintInline}>
          An entry must be at least this old to enter the Wander pool.
        </Text>
        <View style={styles.card}>
          {WANDER_THRESHOLD_OPTIONS.map((opt) => {
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
          {/* Custom row. When selected, the inline input field reveals
              directly below within the same card: visually unified, not
              a separate floating widget. */}
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
                accessibilityLabel={`Custom Wander threshold in days, between ${THRESHOLD_MIN_DAYS} and ${THRESHOLD_MAX_DAYS}`}
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
            One tap on the dice icon opens a random entry that is older than
            the threshold. Wander does not remember the entries that it
            opened. Each selection is uniformly random, so the same entry can
            open again.
          </Text>
          <Text style={[styles.paragraph, styles.paragraphSpaced]}>
            The icon shows only when the pool is not empty. A new journal has
            no dice icon. A journal in which all entries are newer than the
            threshold also has no dice icon.
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
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    switchText: { flex: 1 },
    switchLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
    switchHint: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
      lineHeight: 16,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginTop: 24,
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
    radioOff: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    // Inline reveal lives inside the same card as the radio rows so the
    // custom value reads as a continuation of the row, not a separate
    // widget. Smaller vertical padding than a row + leading indent to
    // visually subordinate it to the row above.
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
    paragraphSpaced: { marginTop: 10 },
  });
