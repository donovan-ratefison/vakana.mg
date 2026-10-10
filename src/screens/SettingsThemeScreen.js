import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, PALETTES, PALETTE_KEYS, THEME_MODES } from '../theme';

const MODE_LABEL = { system: 'System', light: 'Light', dark: 'Dark' };
const MODE_ICON = {
  system: 'phone-portrait-outline',
  light: 'sunny-outline',
  dark: 'moon-outline',
};

export default function SettingsThemeScreen({ navigation }) {
  const { colors, mode, setMode, palette, setPalette, resolved } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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
        <Text style={styles.headerTitle}>Theme</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionTitle}>Mode</Text>
        <View style={styles.segmented}>
          {THEME_MODES.map((m) => {
            const active = mode === m;
            return (
              <TouchableOpacity
                key={m}
                style={[styles.segment, active && styles.segmentActive]}
                onPress={() => setMode(m)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={MODE_ICON[m]}
                  size={16}
                  color={active ? colors.primaryOnPrimary : colors.text}
                />
                <Text
                  style={[
                    styles.segmentText,
                    active && styles.segmentTextActive,
                  ]}
                >
                  {MODE_LABEL[m]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Palette</Text>
        <View style={styles.paletteGrid}>
          {PALETTE_KEYS.map((key) => {
            const def = PALETTES[key];
            const active = palette === key;
            const swatchBg = def.swatch[resolved] || def.swatch.light;
            const swatchAccent = def.accent;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.paletteCard, active && styles.paletteCardActive]}
                onPress={() => setPalette(key)}
                activeOpacity={0.7}
              >
                <View style={[styles.paletteSwatch, { backgroundColor: swatchBg }]}>
                  <View
                    style={[styles.paletteAccent, { backgroundColor: swatchAccent }]}
                  />
                  <View
                    style={[
                      styles.paletteAccent,
                      styles.paletteAccentSecondary,
                      { backgroundColor: swatchAccent, opacity: 0.55 },
                    ]}
                  />
                </View>
                <View style={styles.paletteMeta}>
                  <Text style={styles.paletteLabel}>{def.label}</Text>
                  <Text style={styles.paletteHint} numberOfLines={2}>
                    {def.description}
                  </Text>
                </View>
                {active ? (
                  <View style={styles.paletteCheck}>
                    <Ionicons
                      name="checkmark"
                      size={14}
                      color={colors.primaryOnPrimary}
                    />
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
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
    sectionTitle: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginBottom: 8,
      marginLeft: 4,
    },
    segmented: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 4,
      gap: 4,
      borderWidth: 1,
      borderColor: colors.border,
    },
    segment: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      borderRadius: 9,
      gap: 6,
    },
    segmentActive: { backgroundColor: colors.primary },
    segmentText: { color: colors.text, fontSize: 14, fontWeight: '500' },
    segmentTextActive: { color: colors.primaryOnPrimary, fontWeight: '600' },
    paletteGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    paletteCard: {
      width: '48%',
      flexGrow: 1,
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      position: 'relative',
    },
    paletteCardActive: { borderColor: colors.primary, borderWidth: 2 },
    paletteSwatch: {
      height: 70,
      justifyContent: 'flex-end',
      paddingHorizontal: 10,
      paddingBottom: 10,
      flexDirection: 'row',
      gap: 6,
      alignItems: 'flex-end',
    },
    paletteAccent: { width: 22, height: 22, borderRadius: 11 },
    paletteAccentSecondary: { width: 14, height: 14, borderRadius: 7 },
    paletteMeta: { paddingHorizontal: 12, paddingVertical: 10 },
    paletteLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
    paletteHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    paletteCheck: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
