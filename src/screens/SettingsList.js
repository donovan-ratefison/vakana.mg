import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { getCurrentVault } from '../utils/vaults';
import {
  getLastBackup,
  formatBackupAge,
  isBackupStale,
} from '../services/backup';

// Sub-setting rows for each top-level category. The landing (SettingsScreen)
// shows five category/leaf rows so that About sits above the fold; tapping a
// category opens SettingsCategoryScreen, which renders that category's rows
// from here. Heavy screens (the PIN flow, Backup & Restore, Vaults) stay
// their own screens reached *through* the category sub-menu. They are never
// merged inline, which would re-create the long scroll one level down.
export const SETTINGS_CATEGORIES = {
  appearance: {
    title: 'Appearance',
    rows: [
      {
        key: 'theme',
        icon: 'color-palette-outline',
        label: 'Theme',
        hint: 'Palette and light/dark',
        route: 'SettingsTheme',
      },
      {
        key: 'defaultView',
        icon: 'apps-outline',
        label: 'Default view',
        hint: 'Notes list, Calendar, or Threads on app open',
        route: 'SettingsDefaultView',
      },
    ],
  },
  threads: {
    title: 'Threads & returns',
    rows: [
      {
        key: 'autoThreads',
        icon: 'sparkles-outline',
        label: 'Auto-threads',
        hint: 'System-managed day, week, and month chains',
        route: 'SettingsAutoThreads',
      },
      {
        key: 'threads',
        icon: 'git-network-outline',
        label: 'Quiet threshold',
        hint: 'When a thread becomes quiet',
        route: 'SettingsThreads',
      },
      {
        key: 'wander',
        icon: 'dice-outline',
        label: 'Wander',
        hint: 'Open a random older entry',
        route: 'SettingsWander',
      },
    ],
  },
  vault: {
    title: 'Vault',
    rows: [
      {
        key: 'changePin',
        icon: 'key-outline',
        label: 'Change PIN',
        hint: 'Update the PIN for the current vault',
        route: 'SettingsChangePin',
      },
      {
        key: 'autoLock',
        icon: 'lock-closed-outline',
        label: 'Auto-lock',
        hint: 'Require the PIN again after you leave the app',
        route: 'SettingsAutoLock',
      },
      {
        key: 'backup',
        icon: 'archive-outline',
        label: 'Backup & Restore',
        hint: 'Export or import a full vault',
        route: 'SettingsBackup',
      },
      {
        key: 'vaults',
        icon: 'file-tray-stacked-outline',
        label: 'Vaults',
        hint: 'Manage and switch journals',
        route: 'SettingsVaults',
      },
    ],
  },
};

// Loads the current vault's last-backup status (refreshing on focus) so a
// 'backup' row can show its age, and any row flagged `showBackupStale` (the
// landing's Vault category row) can carry the amber overdue dot up a level.
// Cheap; safe to mount on any settings surface.
export function useBackupStatus(navigation) {
  // undefined = loading (fall back to the static hint), null = never.
  const [lastBackup, setLastBackup] = useState(undefined);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const v = await getCurrentVault();
        const lb = v?.id != null ? await getLastBackup(v.id) : null;
        if (alive) setLastBackup(lb);
      } catch {
        if (alive) setLastBackup(null);
      }
    };
    load();
    // Refresh when returning from the Backup & Restore screen so a just-made
    // backup clears the stale indicator without a remount.
    const unsub = navigation.addListener('focus', load);
    return () => {
      alive = false;
      unsub();
    };
  }, [navigation]);

  const backupHint =
    lastBackup === undefined
      ? null
      : lastBackup
      ? `Backed up ${formatBackupAge(lastBackup.at)}`
      : 'Never backed up';
  const backupStale =
    lastBackup !== undefined &&
    isBackupStale(lastBackup ? lastBackup.at : null);
  return { backupHint, backupStale };
}

// Shared chrome for every settings surface: a back-header with a centered
// title and a single card of tappable rows. Both the landing and each
// category screen render through this so the row geometry, dividers, and the
// backup age/stale treatment stay identical across levels.
export default function SettingsList({ navigation, title, rows }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { backupHint, backupStale } = useBackupStatus(navigation);

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
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          {rows.map((row, i) => {
            const isBackup = row.key === 'backup';
            const hintText = isBackup && backupHint ? backupHint : row.hint;
            // The backup row turns its own hint amber; a category row that
            // merely forwards the nudge (showBackupStale) gets the dot only.
            const showDot = (isBackup || row.showBackupStale) && backupStale;
            return (
              <TouchableOpacity
                key={row.key}
                style={[
                  styles.row,
                  i < rows.length - 1 && styles.rowDivider,
                ]}
                onPress={() => navigation.navigate(row.route, row.params)}
                activeOpacity={0.7}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name={row.icon} size={20} color={colors.primary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Text
                    style={[
                      styles.rowHint,
                      isBackup && backupStale && styles.rowHintStale,
                    ]}
                  >
                    {hintText}
                  </Text>
                </View>
                {showDot ? <View style={styles.staleDot} /> : null}
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textFaint}
                />
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
    headerTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.text,
    },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    scrollContent: { paddingTop: 18, paddingHorizontal: 20, paddingBottom: 40 },
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
    rowHintStale: { color: colors.danger, fontWeight: '600' },
    staleDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.danger,
      marginRight: 4,
    },
  });
