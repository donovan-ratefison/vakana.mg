import React, { useMemo } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import HomeScreen from '../screens/HomeScreen';
import EntryEditorScreen from '../screens/EntryEditorScreen';
import DayScreen from '../screens/DayScreen';
import ThreadComposerScreen from '../screens/ThreadComposerScreen';
import ThreadDetailScreen from '../screens/ThreadDetailScreen';
import SettingsScreen from '../screens/SettingsScreen';
import SettingsCategoryScreen from '../screens/SettingsCategoryScreen';
import SettingsThemeScreen from '../screens/SettingsThemeScreen';
import SettingsBackupScreen from '../screens/SettingsBackupScreen';
import SettingsVaultsScreen from '../screens/SettingsVaultsScreen';
import SettingsProTipsScreen from '../screens/SettingsProTipsScreen';
import SettingsGuideViewerScreen from '../screens/SettingsGuideViewerScreen';
import SettingsAboutScreen from '../screens/SettingsAboutScreen';
import SettingsChangePinScreen from '../screens/SettingsChangePinScreen';
import SettingsAutoLockScreen from '../screens/SettingsAutoLockScreen';
import SettingsAutoThreadsScreen from '../screens/SettingsAutoThreadsScreen';
import SettingsDefaultViewScreen from '../screens/SettingsDefaultViewScreen';
import SettingsWanderScreen from '../screens/SettingsWanderScreen';
import SettingsThreadsScreen from '../screens/SettingsThreadsScreen';
import ThreadArticleComposerScreen from '../screens/ThreadArticleComposerScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import { useTheme } from '../theme';

const Stack = createStackNavigator();

export default function AppNavigator() {
  const { colors, resolved } = useTheme();

  const navTheme = useMemo(() => {
    const base = resolved === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: resolved === 'dark',
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.background,
        text: colors.text,
        border: colors.border,
        notification: colors.primary,
      },
    };
  }, [colors, resolved]);

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '600' },
          headerBackTitleVisible: false,
          headerTruncatedBackTitle: '',
          // Tighten stack transitions globally. RN Stack's default is
          // ~300-500ms which feels laggy on every navigate. 150ms keeps
          // a perceptible motion cue without the lag. Applies to every
          // current and future screen via screenOptions inheritance.
          transitionSpec: {
            open: { animation: 'timing', config: { duration: 150 } },
            close: { animation: 'timing', config: { duration: 150 } },
          },
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="EntryEditor"
          component={EntryEditorScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Day"
          component={DayScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="ThreadComposer"
          component={ThreadComposerScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="ThreadDetail"
          component={ThreadDetailScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingsCategory"
          component={SettingsCategoryScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingsTheme"
          component={SettingsThemeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingsBackup"
          component={SettingsBackupScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingsVaults"
          component={SettingsVaultsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingsProTips"
          component={SettingsProTipsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingsGuideViewer"
          component={SettingsGuideViewerScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingsAbout"
          component={SettingsAboutScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingsChangePin"
          component={SettingsChangePinScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingsAutoLock"
          component={SettingsAutoLockScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingsAutoThreads"
          component={SettingsAutoThreadsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingsDefaultView"
          component={SettingsDefaultViewScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingsWander"
          component={SettingsWanderScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingsThreads"
          component={SettingsThreadsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="ThreadArticleComposer"
          component={ThreadArticleComposerScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
