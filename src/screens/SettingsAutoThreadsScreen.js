import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  isAutoThreadEnabled,
  setAutoThreadEnabled,
} from '../services/autoThread';
import { useTheme } from '../theme';

export default function SettingsAutoThreadsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    isAutoThreadEnabled().then((v) => {
      setEnabled(v);
      setLoaded(true);
    });
  }, []);

  const handleToggle = async (next) => {
    setEnabled(next);
    await setAutoThreadEnabled(next);
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
        <Text style={styles.headerTitle}>Auto-threads</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchLabel}>Create auto-threads</Text>
              <Text style={styles.switchHint}>
                {enabled
                  ? 'The app adds new entries to the day, week, and month chains.'
                  : 'The auto-thread system ignores new entries.'}
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

        <Text style={styles.sectionTitle}>What this does</Text>
        <View style={styles.paragraphCard}>
          <Text style={styles.paragraph}>
            Auto-threads are bead chains that the journal builds and manages
            for you. They are in the threads tab with your own threads. There
            are three kinds:
          </Text>

          <View style={styles.kindRow}>
            <View style={[styles.kindBadge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.kindBadgeText, { color: colors.primaryOnPrimary }]}>
                Days
              </Text>
            </View>
            <Text style={styles.kindBody}>
              One thread for each calendar date that has an entry. Each entry
              on that date adds a bead to the chain, also when the entry has no
              bead.
            </Text>
          </View>

          <View style={styles.kindRow}>
            <View style={[styles.kindBadge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.kindBadgeText, { color: colors.primaryOnPrimary }]}>
                Weeks
              </Text>
            </View>
            <Text style={styles.kindBody}>
              One thread for each ISO week (Monday–Sunday). It contains the
              entries that you star as
              <Text style={styles.kindBodyEmph}> Weekly highlight</Text> in the
              meta strip of the editor.
            </Text>
          </View>

          <View style={styles.kindRow}>
            <View style={[styles.kindBadge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.kindBadgeText, { color: colors.primaryOnPrimary }]}>
                Months
              </Text>
            </View>
            <Text style={styles.kindBody}>
              One thread for each calendar month. It contains the entries that
              you star as
              <Text style={styles.kindBodyEmph}> Monthly highlight</Text>. It
              also contains the entries that you promote with the "Promote week
              to month" button in a weekly thread.
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>When it's off</Text>
        <View style={styles.paragraphCard}>
          <Text style={styles.paragraph}>
            The auto-thread system skips new entries. It creates no new chains,
            and it does not update existing auto-threads. Existing auto-threads
            keep the state they had when you set the switch to off.
          </Text>
          <Text style={[styles.paragraph, styles.paragraphSpaced]}>
            Deletion still works. When you delete an entry, the app removes it
            from its auto-threads and deletes an auto-thread that becomes
            empty. When you set the switch to on again, the auto-thread system
            starts again from that moment.
          </Text>
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
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
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
    kindRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      marginTop: 12,
    },
    kindBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
      minWidth: 56,
      alignItems: 'center',
    },
    kindBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.4,
    },
    kindBody: {
      flex: 1,
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 19,
    },
    kindBodyEmph: {
      color: colors.text,
      fontWeight: '600',
    },
  });
