import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isPinSet, setPin, verifyPin, attemptPin, getPinLockoutMs } from '../utils/auth';
import usePinLockout from '../hooks/usePinLockout';
import { getCurrentVault } from '../utils/vaults';
import PinKeypad from '../components/PinKeypad';
import { useTheme } from '../theme';

const PIN_LENGTH = 4;

// Three-step PIN change for the currently-active vault. PINs are stored in
// expo-secure-store per vault (see src/utils/auth.js), so this screen acts
// on whichever vault is currently open. Changing another vault's PIN
// requires switching into it first. The UX trade-off is intentional, since
// asking for "old PIN" of a vault you can't enter would be meaningless.
//
// Steps:
//   1. verify:   type the current PIN, validate against SecureStore. This
//                step is rate-limited exactly like the lock screen (same
//                per-vault counter, `attemptPin`). Otherwise it would be an
//                unmetered oracle for the current PIN.
//   2. choose:   type the new PIN
//   3. confirm:  type the new PIN again; must match
//   4. done:     success state, auto-pop after a short delay
//
// If no PIN is set yet for this vault (this shouldn't happen during normal
// use, because the lock screen enforces one on first run), step 1 is
// skipped and the flow starts at "choose".
//
// Digits come from the shared on-screen `PinKeypad`, the same component the
// lock screen uses. There is no `TextInput` here: Android would not reliably
// summon a keyboard for the hidden 1×1 input this screen used to rely on.

export default function SettingsChangePinScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState('loading'); // loading | verify | choose | confirm | done
  const [pin, setPinValue] = useState('');
  const [pendingNewPin, setPendingNewPin] = useState('');
  const [error, setError] = useState('');
  const [vaultName, setVaultName] = useState('');
  const [busy, setBusy] = useState(false);

  const shakeAnim = useRef(new Animated.Value(0)).current;
  // Guards the window between the fourth digit and the async verify/save
  // resolving, so a fast double-tap can't submit the same PIN twice (`busy`
  // is a state update and doesn't take effect within the same tick).
  const submittingRef = useRef(false);
  const { locked: lockoutActive, message: lockoutMessage, startLockout } =
    usePinLockout();
  // The backoff only gates the verify step; choose/confirm aren't guesses.
  const locked = lockoutActive && step === 'verify';

  const refresh = useCallback(async () => {
    const v = await getCurrentVault();
    setVaultName(v?.name || '');
    const hasPin = await isPinSet();
    startLockout(hasPin ? await getPinLockoutMs() : 0);
    setStep(hasPin ? 'verify' : 'choose');
    setPinValue('');
    setPendingNewPin('');
    setError('');
  }, [startLockout]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handlePinChange = async (value) => {
    if (busy || locked || submittingRef.current || step === 'done') return;
    const digits = (value || '').replace(/[^0-9]/g, '').slice(0, PIN_LENGTH);
    setError('');
    setPinValue(digits);

    if (digits.length !== PIN_LENGTH) return;

    submittingRef.current = true;
    setBusy(true);
    try {
      if (step === 'verify') {
        const { ok, lockoutMs } = await attemptPin(digits);
        if (ok) {
          setStep('choose');
          setPinValue('');
        } else {
          startLockout(lockoutMs);
          setError(lockoutMs ? '' : 'Incorrect current PIN');
          triggerShake();
          setPinValue('');
        }
      } else if (step === 'choose') {
        // Disallow setting the same PIN as the current one: a silent
        // "change" that doesn't actually change anything is worse than
        // a clear nudge. Unmetered on purpose: the verify step above has
        // already proven the current PIN.
        if (await verifyPin(digits)) {
          setError('The new PIN must be different from the current PIN.');
          triggerShake();
          setPinValue('');
        } else {
          setPendingNewPin(digits);
          setStep('confirm');
          setPinValue('');
        }
      } else if (step === 'confirm') {
        if (digits === pendingNewPin) {
          await setPin(digits);
          setStep('done');
          setPinValue('');
          // Stay on the success state briefly so the user sees confirmation,
          // then pop back to Settings.
          setTimeout(() => {
            // Re-check navigation in case the user already left.
            if (navigation.isFocused()) navigation.goBack();
          }, 1200);
        } else {
          setError('PINs do not match');
          triggerShake();
          setPendingNewPin('');
          setPinValue('');
          setStep('choose');
        }
      }
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  // The keypad is the only input path on this screen.
  const pressDigit = (digit) => {
    if (busy || locked || submittingRef.current || step === 'done') return;
    if (pin.length >= PIN_LENGTH) return;
    handlePinChange(pin + digit);
  };

  const pressBackspace = () => {
    if (busy || locked || submittingRef.current || pin.length === 0) return;
    setError('');
    setPinValue(pin.slice(0, -1));
  };

  const instruction = (() => {
    if (step === 'verify') return 'Enter your current PIN';
    if (step === 'choose') return 'Choose a new 4-digit PIN';
    if (step === 'confirm') return 'Confirm your new PIN';
    if (step === 'done') return 'PIN changed';
    return '';
  })();

  const subtitle = (() => {
    if (step === 'done') return null;
    if (vaultName) return `Vault: ${vaultName}`;
    return null;
  })();

  const showKeypad = step !== 'loading' && step !== 'done';

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Change PIN</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.body}>
        {step === 'loading' ? null : step === 'done' ? (
          <View style={styles.doneBlock}>
            <View style={styles.checkCircle}>
              <Ionicons name="checkmark" size={36} color={colors.primaryOnPrimary} />
            </View>
            <Text style={styles.doneText}>PIN changed</Text>
            {vaultName ? (
              <Text style={styles.doneSubtle}>{vaultName}</Text>
            ) : null}
          </View>
        ) : (
          <>
            <Text style={styles.instruction}>{instruction}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

            <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
              <View style={styles.dotsContainer}>
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <View
                    key={i}
                    style={[styles.dot, i < pin.length && styles.dotFilled]}
                  />
                ))}
              </View>
            </Animated.View>

            {/* Fixed slot so the keypad doesn't jump when an error appears. */}
            <View style={styles.errorSlot}>
              {(locked && lockoutMessage) || error ? (
                <Text style={styles.errorText}>
                  {(locked && lockoutMessage) || error}
                </Text>
              ) : null}
            </View>

            {step === 'verify' ? (
              <Text style={styles.helperText}>
                If you forgot your PIN, you cannot recover it. Your data stays
                safe in the vault. You can set a new PIN only on a new vault.
              </Text>
            ) : null}
          </>
        )}
      </View>

      {showKeypad ? (
        <PinKeypad
          disabled={busy || locked}
          onDigit={pressDigit}
          onBackspace={pressBackspace}
        />
      ) : null}
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
      fontSize: 18,
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
    // The keypad is pinned below, so the prompt block centres in whatever
    // room is left rather than sitting at a fixed offset that could push the
    // keys off a small screen.
    body: {
      flexGrow: 1,
      flexShrink: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingBottom: 12,
    },
    instruction: {
      fontSize: 18,
      color: colors.text,
      marginBottom: 6,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 13,
      color: colors.textMuted,
      marginBottom: 20,
      textAlign: 'center',
    },
    dotsContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginTop: 12,
      marginBottom: 18,
    },
    dot: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 2,
      borderColor: colors.borderStrong,
      marginHorizontal: 12,
    },
    dotFilled: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    errorSlot: {
      minHeight: 20,
      justifyContent: 'center',
    },
    errorText: {
      color: colors.danger,
      fontSize: 13,
      textAlign: 'center',
    },
    helperText: {
      color: colors.textMuted,
      fontSize: 12,
      textAlign: 'center',
      marginTop: 20,
      paddingHorizontal: 24,
      lineHeight: 18,
    },
    doneBlock: {
      alignItems: 'center',
      gap: 12,
      marginTop: 40,
    },
    checkCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    doneText: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
    },
    doneSubtle: {
      color: colors.textMuted,
      fontSize: 13,
    },
  });
