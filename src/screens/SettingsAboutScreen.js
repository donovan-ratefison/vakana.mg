import React, { useMemo } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
// Version comes from app.json, the file the release ritual bumps.
// package.json's version drifted for four releases (0.77.1 → 0.79.0) and
// this screen displayed the stale value the whole time.
import appJson from '../../app.json';

const AUTHOR = {
  name: 'Donovan Ratefison',
  website: 'https://donovan-ratefison.mg',
};

const APP_WEBSITE = 'https://vakana.mg';

// Every way to support (feedback, sharing, the shop, testing, giving back)
// lives on one web page so it can evolve without an app release. The app stays
// the free, local-first layer; the support story belongs on the website.
const SUPPORT_URL = 'https://vakana.mg/support';

const TAGLINE =
  'Vakana is the Malagasy ancestral practice of beads. This app shows a small part of what the physical Vakana system can do.';

export default function SettingsAboutScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const openUrl = async (url) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('Cannot open this link');
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert('Could not open link', err?.message || String(err));
    }
  };

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
        <Text style={styles.headerTitle}>About</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroCard}>
          <Image
            source={require('../../assets/logo-mark.png')}
            style={styles.heroLogo}
            resizeMode="contain"
          />
          <Text style={styles.version}>v{appJson.expo.version}</Text>
          <Text style={styles.tagline}>{TAGLINE}</Text>
        </View>

        <Text style={styles.sectionTitle}>Author</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => openUrl(AUTHOR.website)}
            activeOpacity={0.7}
          >
            <View style={styles.rowIcon}>
              <Ionicons name="person-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{AUTHOR.name}</Text>
              <Text style={styles.rowHint} numberOfLines={1}>
                {AUTHOR.website}
              </Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.textFaint} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.row, styles.rowDivider]}
            onPress={() => openUrl(APP_WEBSITE)}
            activeOpacity={0.7}
          >
            <View style={styles.rowIcon}>
              <Ionicons name="globe-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Website</Text>
              <Text style={styles.rowHint} numberOfLines={1}>
                {APP_WEBSITE}
              </Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.textFaint} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>
          How can I support
        </Text>
        <Text style={styles.supportIntro}>
          Vakana.mg is free, in the sense of freedom. I build it in my free
          time, and I do it freely. You decide if you give something back, and
          how.
        </Text>
        <TouchableOpacity
          style={styles.supportButton}
          onPress={() => openUrl(SUPPORT_URL)}
          activeOpacity={0.85}
        >
          <Ionicons name="heart-outline" size={18} color={colors.primary} />
          <Text style={styles.supportButtonText}>Support Vakana.mg</Text>
          <Ionicons name="open-outline" size={16} color={colors.textFaint} />
        </TouchableOpacity>
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
    heroCard: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 24,
      marginBottom: 16,
    },
    heroLogo: { width: 180, height: 175, marginBottom: 4 },
    version: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    tagline: {
      marginTop: 12,
      fontSize: 14,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 20,
      paddingHorizontal: 8,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
      color: colors.textMuted,
      textTransform: 'uppercase',
      marginBottom: 8,
      marginLeft: 4,
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
      gap: 12,
      padding: 14,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
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
    rowLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
    rowHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    supportIntro: {
      marginBottom: 12,
      marginLeft: 4,
      fontSize: 13,
      color: colors.text,
      lineHeight: 20,
    },
    supportButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    supportButtonText: {
      flex: 1,
      color: colors.primary,
      fontSize: 15,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
  });
