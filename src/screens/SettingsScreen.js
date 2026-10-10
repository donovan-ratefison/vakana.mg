import React from 'react';
import SettingsList, { SETTINGS_CATEGORIES } from './SettingsList';

// The Settings landing: five rows that fit on one screen so About is always
// above the fold. The first three open a category sub-menu (SettingsCategory)
// holding the grouped settings; Pro Tips and About are leaves. The Vault row
// forwards the backup-overdue dot (showBackupStale) so the nudge that used to
// live on the Backup row stays visible at the landing.
const cat = SETTINGS_CATEGORIES;
const TOP_LEVEL = [
  {
    key: 'appearance',
    icon: 'color-palette-outline',
    label: cat.appearance.title,
    hint: 'Theme and default view',
    route: 'SettingsCategory',
    params: { category: 'appearance' },
  },
  {
    key: 'threads',
    icon: 'git-network-outline',
    label: cat.threads.title,
    hint: 'Auto-threads, quiet threshold, Wander',
    route: 'SettingsCategory',
    params: { category: 'threads' },
  },
  {
    key: 'vault',
    icon: 'shield-checkmark-outline',
    label: cat.vault.title,
    hint: 'PIN, auto-lock, backup, vaults',
    route: 'SettingsCategory',
    params: { category: 'vault' },
    showBackupStale: true,
  },
  {
    key: 'tips',
    icon: 'sparkles-outline',
    label: 'Pro Tips',
    hint: 'User guide and possibilities',
    route: 'SettingsProTips',
  },
  {
    key: 'about',
    icon: 'information-circle-outline',
    label: 'About',
    hint: 'Author and ways to support',
    route: 'SettingsAbout',
  },
];

export default function SettingsScreen({ navigation }) {
  return (
    <SettingsList navigation={navigation} title="Settings" rows={TOP_LEVEL} />
  );
}
