import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../theme';
import {
  isTutorialPresent,
  reloadTutorial,
  seedTutorial,
  removeTutorial,
} from '../services/tutorialSeed';

const GUIDES = [
  {
    key: 'user-guide',
    label: 'User guide',
    hint: 'Go through each feature and gesture',
    icon: 'compass-outline',
  },
  {
    key: 'possibilities',
    label: 'Possibilities',
    hint: 'Ways to use the app that are possibly new to you',
    icon: 'bulb-outline',
  },
];

export default function SettingsProTipsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [present, setPresent] = useState(null); // null = loading
  const [busy, setBusy] = useState(false);

  // Derive present/absent from the DB on every focus: the tutorial can be
  // (partially) deleted by swiping notes in the list, so a stored flag would
  // drift. See docs/architecture/interactive-tutorial.md.
  const refresh = useCallback(() => {
    let cancelled = false;
    (async () => {
      const p = await isTutorialPresent();
      if (!cancelled) setPresent(p);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(refresh);

  const run = useCallback(
    async (fn) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        setPresent(await isTutorialPresent());
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const onAdd = useCallback(() => {
    run(async () => {
      await seedTutorial();
      Alert.alert(
        'Tutorial added',
        'Six sample notes and a closed thread are at the top of your journal. Go through the chain. Delete it when you are ready.',
        [
          { text: 'Stay here', style: 'cancel' },
          { text: 'Go to journal', onPress: () => navigation.navigate('Home') },
        ]
      );
    });
  }, [run, navigation]);

  const onReload = useCallback(() => {
    Alert.alert(
      'Reload tutorial?',
      'This resets the six sample notes and their thread to the original tour. You lose all changes that you made to them.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reload',
          onPress: () =>
            run(async () => {
              await reloadTutorial();
              Alert.alert(
                'Tutorial reloaded',
                'The tour is back at the top of your journal.',
                [
                  { text: 'Stay here', style: 'cancel' },
                  {
                    text: 'Go to journal',
                    onPress: () => navigation.navigate('Home'),
                  },
                ]
              );
            }),
        },
      ]
    );
  }, [run, navigation]);

  const onRemove = useCallback(() => {
    Alert.alert(
      'Remove tutorial?',
      'This deletes the sample notes and their thread. You can reload them here at any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => run(removeTutorial),
        },
      ]
    );
  }, [run]);

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
        <Text style={styles.headerTitle}>Pro Tips</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Intro slides: the first-launch welcome, replayable on demand */}
        <Text style={styles.sectionLabel}>Intro slides</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate('Onboarding')}
            activeOpacity={0.7}
          >
            <View style={styles.rowIcon}>
              <Ionicons name="play-circle-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Watch the intro again</Text>
              <Text style={styles.rowHint}>
                The six welcome slides from first launch: note, bead, and the
                day that threads itself.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </TouchableOpacity>
        </View>

        {/* Interactive tutorial: the walkable cold-start sample */}
        <Text style={styles.sectionLabel}>Interactive tutorial</Text>
        <View style={styles.card}>
          <View style={styles.tutorialRow}>
            <View style={styles.rowIcon}>
              <Ionicons name="sparkles-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>A 90-second tour in your journal</Text>
              <Text style={styles.rowHint}>
                {present
                  ? 'A sample thread of six numbered beads is in your journal now. Open it and go through the chain. You can remove it or reload it at any time.'
                  : 'This adds a sample thread of six numbered beads to your journal. You learn the gestures when you try them. You can delete all of it.'}
              </Text>
            </View>
          </View>

          <View style={styles.actionsRow}>
            {busy || present === null ? (
              <ActivityIndicator color={colors.primary} style={{ paddingVertical: 6 }} />
            ) : present ? (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnPrimary]}
                  onPress={onReload}
                  activeOpacity={0.8}
                >
                  <Ionicons name="refresh-outline" size={16} color={colors.primaryOnPrimary} />
                  <Text style={[styles.actionText, styles.actionTextPrimary]}>Reload</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnDanger]}
                  onPress={onRemove}
                  activeOpacity={0.8}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  <Text style={[styles.actionText, { color: colors.danger }]}>Remove</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnPrimary]}
                onPress={onAdd}
                activeOpacity={0.8}
              >
                <Ionicons name="add-outline" size={18} color={colors.primaryOnPrimary} />
                <Text style={[styles.actionText, styles.actionTextPrimary]}>
                  Add to my journal
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text style={styles.sectionLabel}>Guides</Text>
        <Text style={styles.intro}>
          Tap a guide to read it. The user guide is the manual. Possibilities
          is a long list of patterns and use cases that other people found
          useful. Both guides are long. Use the search icon to go directly to
          a section.
        </Text>
        <View style={styles.card}>
          {GUIDES.map((g, i) => (
            <TouchableOpacity
              key={g.key}
              style={[styles.row, i < GUIDES.length - 1 && styles.rowDivider]}
              onPress={() =>
                navigation.navigate('SettingsGuideViewer', {
                  guide: g.key,
                  title: g.label,
                })
              }
              activeOpacity={0.7}
            >
              <View style={styles.rowIcon}>
                <Ionicons name={g.icon} size={20} color={colors.primary} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{g.label}</Text>
                <Text style={styles.rowHint}>{g.hint}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </TouchableOpacity>
          ))}
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
    sectionLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 10,
      marginTop: 4,
    },
    intro: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 16 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: 24,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      gap: 12,
    },
    tutorialRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      padding: 14,
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
    rowHint: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
    actionsRow: {
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 14,
      paddingBottom: 14,
      paddingTop: 2,
      minHeight: 36,
      alignItems: 'center',
    },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 9,
      paddingHorizontal: 14,
      borderRadius: 10,
    },
    actionBtnPrimary: { backgroundColor: colors.primary },
    actionBtnDanger: {
      backgroundColor: colors.dangerSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.danger,
    },
    actionText: { fontSize: 14, fontWeight: '600' },
    actionTextPrimary: { color: colors.primaryOnPrimary },
  });
