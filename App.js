import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import * as Font from 'expo-font';
import { Caveat_400Regular } from '@expo-google-fonts/caveat';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import LockScreen from './src/screens/LockScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import AppNavigator from './src/navigation/AppNavigator';
import { initDatabase, closeDatabase } from './src/database/db';
import {
  backfillAutoThreadsIfNeeded,
  resyncAutoThreadTimeOrderIfNeeded,
} from './src/services/autoThread';
import { rehydrateScheduledNotifications } from './src/services/reminders';
import { rescueAndSweepMedia } from './src/services/mediaStore';
import { rehydrateCommentReminderNotifications } from './src/services/comments';
import { initNotificationResponseHandling } from './src/utils/notificationRouting';

// Register the notification-tap listeners at module load, before React
// mounts: a cold-start tap must be captured even though the PIN gate
// delays navigation until HomeScreen exists to consume it.
initNotificationResponseHandling();
import { ThemeProvider, useTheme } from './src/theme';
import { LockContext } from './src/lock';
import { VaultContext } from './src/vault';
import { ensureRegistry, setCurrentVault } from './src/utils/vaults';
import {
  getAutoLock,
  setAutoLock as persistAutoLock,
  autoLockGraceMs,
  getOnboardingSeen,
} from './src/utils/preferences';
import { warn } from './src/utils/log';

SplashScreen.preventAutoHideAsync();

function AppShell() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isReady, setIsReady] = useState(false);
  // vaultEpoch is bumped on switch to force a clean re-mount of the
  // navigator subtree (and a re-init of the DB against the new vault file).
  const [vaultEpoch, setVaultEpoch] = useState(0);
  // Auto-lock preference ('off' | 'immediate' | '1m' | '5m' | '15m'). Held in
  // state so the Settings screen (via LockContext) updates it live; mirrored
  // into refs the AppState listener reads without re-subscribing.
  const [autoLock, setAutoLockState] = useState('off');
  // null = still reading the marker; true = show the intro slides. App-level,
  // loaded once (not per vaultEpoch): the slides answer "what is this app",
  // which doesn't change when the vault does.
  const [showOnboarding, setShowOnboarding] = useState(null);
  const { colors, resolved, ready: themeReady } = useTheme();

  const autoLockRef = useRef('off');
  autoLockRef.current = autoLock;
  const isUnlockedRef = useRef(false);
  isUnlockedRef.current = isUnlocked;
  // Wall-clock at the moment we last went to the *background* (not the
  // transient 'inactive' iOS state), or null while foregrounded.
  const backgroundedAtRef = useRef(null);

  useEffect(() => {
    getAutoLock().then(setAutoLockState);
    getOnboardingSeen().then((seen) => setShowOnboarding(!seen));
  }, []);

  // Re-engage the lock when returning from the background past the chosen
  // grace window. Keyed off the definitive 'background' state so a transient
  // 'inactive' (control center, an incoming call, the app-switcher peek)
  // never re-locks. No-ops when auto-lock is off or the app is already locked.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        backgroundedAtRef.current = Date.now();
      } else if (next === 'active') {
        const at = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (at == null || !isUnlockedRef.current) return;
        const grace = autoLockGraceMs(autoLockRef.current);
        if (grace == null) return; // 'off'
        if (Date.now() - at >= grace) setIsUnlocked(false);
      }
    });
    return () => sub.remove();
  }, []);

  const setAutoLock = useCallback(async (value) => {
    setAutoLockState(value);
    await persistAutoLock(value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function prepare() {
      try {
        await ensureRegistry();
        // Load the Caveat handwriting font at runtime. It was only ever
        // declared via the expo-font config plugin (native builds), so in
        // Expo Go / any client without the embedded asset every
        // `fontFamily: 'Caveat_400Regular'` (thread-list titles, section
        // pendants, …) silently fell back to the system font. Own catch
        // so a font failure can never block boot: it degrades to
        // the system font instead of hanging on the spinner. Gated by
        // `isReady`, so nothing renders Caveat before it's registered.
        await Font.loadAsync({ Caveat_400Regular }).catch(() => {});
        await initDatabase();
        await backfillAutoThreadsIfNeeded();
        // Re-stamp existing auto-thread bead positions into the time-aware
        // encoding (v0.67.0). One-shot, marker-gated; no-ops thereafter.
        await resyncAutoThreadTimeOrderIfNeeded();
        // The tutorial deliberately does NOT plant itself here any more
        // (v0.77.0). Vakana is a memory palace and the beads are the
        // user's; auto-seeding furnished it with six notes that weren't
        // theirs and made deleting someone else's entries the first act
        // the app asked of them. It is opt-in from Settings → Pro Tips,
        // and the empty list invites the reader into the guide instead,
        // which only became a real alternative once the guide opened in
        // ~75ms and became searchable (v0.76.1). See
        // docs/architecture/interactive-tutorial.md § Revision.
        // Re-arm OS notifications on EVERY boot, not just vault switches
        // (v0.86.1). The passes are idempotent now (each checks what is
        // actually live with the OS and only schedules what's missing),
        // so the old double-up concern is gone. This is also the repair
        // path for the raw-Date scheduling break: every device that ran
        // the broken versions has reminders with notification_id NULL,
        // and this pass heals them on first launch of the fixed build.
        await rehydrateScheduledNotifications();
        await rehydrateCommentReminderNotifications();
        // Fire-and-forget: migrate any attachment URIs still pointing at
        // the OS-cleanable cache into documentDirectory while their bytes
        // are readable, then sweep store files no row references. Not
        // awaited: a big first-run migration must not hold the splash,
        // and the pass is safe to interrupt (it re-runs next launch; the
        // sweep is age-gated against racing a fresh attach).
        rescueAndSweepMedia();
      } catch (e) {
        console.error('Database init error:', e?.message || e, e);
      } finally {
        if (!cancelled) setIsReady(true);
      }
    }
    prepare();
    return () => {
      cancelled = true;
    };
  }, [vaultEpoch]);

  const switchVault = useCallback(async (vaultId) => {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (e) {
      warn('App.switchVault.cancelNotifications', e);
    }
    await closeDatabase();
    await setCurrentVault(vaultId);
    setIsUnlocked(false);
    setIsReady(false);
    setVaultEpoch((e) => e + 1);
  }, []);

  // The splash stays up until the DB, the persisted theme, AND the
  // onboarding marker are in. Hiding on DB-ready alone let a stored dark
  // theme paint a light first frame (the cold-start white flash), and the
  // onboarding read must resolve before we choose between slides and lock
  // screen. hideAsync is idempotent.
  useEffect(() => {
    if (isReady && themeReady && showOnboarding !== null) {
      SplashScreen.hideAsync();
    }
  }, [isReady, themeReady, showOnboarding]);

  const lockValue = useMemo(
    () => ({ lock: () => setIsUnlocked(false), autoLock, setAutoLock }),
    [autoLock, setAutoLock]
  );

  const vaultValue = useMemo(
    () => ({ switchVault }),
    [switchVault]
  );

  if (!isReady || !themeReady || showOnboarding === null) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // First launch: the intro slides come BEFORE the PIN gate. Asking a
  // stranger to invent a PIN before answering "what is this app" was the
  // field-tested way to lose them by the third tap.
  if (showOnboarding) {
    return <OnboardingScreen onDone={() => setShowOnboarding(false)} />;
  }

  if (!isUnlocked) {
    return (
      <LockScreen key={`lock-${vaultEpoch}`} onUnlock={() => setIsUnlocked(true)} />
    );
  }

  return (
    <VaultContext.Provider value={vaultValue}>
      <LockContext.Provider value={lockValue}>
        <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
        <AppNavigator key={`nav-${vaultEpoch}`} />
      </LockContext.Provider>
    </VaultContext.Provider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* KeyboardProvider (react-native-keyboard-controller) feeds the
            exact IME geometry to useKeyboardBottomOffset via native
            WindowInsetsAnimation callbacks: RN's own keyboardDidShow
            events are stale/imprecise under edge-to-edge (see
            hooks/useKeyboardHeight.js). Both translucent flags match our
            app.json edgeToEdgeEnabled so the provider never re-fits the
            window. */}
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
