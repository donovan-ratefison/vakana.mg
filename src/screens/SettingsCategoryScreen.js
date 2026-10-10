import React from 'react';
import SettingsList, { SETTINGS_CATEGORIES } from './SettingsList';

// A category sub-menu (Appearance / Threads & returns / Vault). The landing
// passes `route.params.category`; we look the group up and render its rows
// through the shared SettingsList so each row reaches the same leaf screen it
// always did. An unknown key renders an empty titled screen rather than
// crashing (defensive: this should never happen from the landing).
export default function SettingsCategoryScreen({ navigation, route }) {
  const category = SETTINGS_CATEGORIES[route?.params?.category];
  return (
    <SettingsList
      navigation={navigation}
      title={category ? category.title : 'Settings'}
      rows={category ? category.rows : []}
    />
  );
}
