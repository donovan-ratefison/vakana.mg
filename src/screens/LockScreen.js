import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ScrollView,
  Image,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  isPinSet,
  setPin,
  attemptPin,
  getPinLockoutMs,
  upgradeLegacyPinRecords,
} from '../utils/auth';
import usePinLockout from '../hooks/usePinLockout';
import { listVaults, getCurrentVaultId, setCurrentVault } from '../utils/vaults';
import { closeDatabase, initDatabase } from '../database/db';
import PinKeypad, {
  pinKeySizeForWidth,
  pinKeypadHeight,
} from '../components/PinKeypad';
import { useTheme } from '../theme';

const PIN_LENGTH = 4;

const LOGO_ASPECT = 214 / 220;

export default function LockScreen({ onUnlock }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [pin, setPinState] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState('check');
  const [error, setError] = useState('');
  const [vaults, setVaults] = useState([]);
  const [currentVaultId, setCurrentVaultId] = useState(null);
  const [busy, setBusy] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  // Guards the window between the fourth digit and the async verify/save
  // resolving, so a fast double-tap can't submit the same PIN twice.
  const submittingRef = useRef(false);
  // Backoff after repeated wrong PINs (per vault, persisted; see utils/auth.js).
  // The countdown reuses the error slot; the keypad is disabled meanwhile.
  const { locked, message: lockoutMessage, startLockout } = usePinLockout();

  const refresh = useCallback(async () => {
    const list = await listVaults();
    const id = await getCurrentVaultId();
    setVaults(list);
    setCurrentVaultId(id);
    const hasPin = await isPinSet();
    startLockout(hasPin ? await getPinLockoutMs() : 0);
    setStep(hasPin ? 'unlock' : 'set');
    setPinState('');
    setConfirmPin('');
    setError('');
  }, [startLockout]);

  useEffect(() => {
    // After the first read, hash any vault's legacy plain-text PIN in place.
    refresh().then(upgradeLegacyPinRecords, () => {});
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
    setError('');
    setPinState(value);

    if (value.length === PIN_LENGTH) {
      submittingRef.current = true;
      try {
        if (step === 'set') {
          setStep('confirm');
          setConfirmPin(value);
          setPinState('');
        } else if (step === 'confirm') {
          if (value === confirmPin) {
            await setPin(value);
            onUnlock();
          } else {
            setError('PINs do not match');
            triggerShake();
            setPinState('');
            setStep('set');
            setConfirmPin('');
          }
        } else if (step === 'unlock') {
          const { ok, lockoutMs } = await attemptPin(value);
          if (ok) {
            onUnlock();
          } else {
            startLockout(lockoutMs);
            setError(lockoutMs ? '' : 'Incorrect PIN');
            triggerShake();
            setPinState('');
          }
        }
      } finally {
        submittingRef.current = false;
      }
    }
  };

  // The keypad is the only input path: there is no OS keyboard on this screen
  // (Android would not reliably summon one for the old hidden TextInput,
  // especially when auto-lock re-showed this screen on foreground).
  const pressDigit = (digit) => {
    // The `>= PIN_LENGTH` guard also covers the window while an async
    // verify/save is in flight: `pin` still holds four digits until it resolves.
    if (busy || locked || submittingRef.current || pin.length >= PIN_LENGTH) return;
    handlePinChange(pin + digit);
  };

  const pressBackspace = () => {
    if (busy || locked || submittingRef.current || pin.length === 0) return;
    setError('');
    setPinState(pin.slice(0, -1));
  };

  // Switch the active vault before PIN entry. The DB has to flip too so
  // auth.js (which reads from current vault id) picks up the new file.
  const switchToVaultPreUnlock = async (vaultId) => {
    if (busy || vaultId === currentVaultId) return;
    setBusy(true);
    try {
      await closeDatabase();
      await setCurrentVault(vaultId);
      await initDatabase();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const getInstruction = () => {
    switch (step) {
      case 'set':
        return 'Create a 4-digit PIN to secure this vault';
      case 'confirm':
        return 'Confirm your PIN';
      case 'unlock':
        return 'Enter your PIN to unlock';
      default:
        return '';
    }
  };

  const showPicker = vaults.length > 1;

  // Everything has to fit without scrolling on a small phone (≈360×640): the
  // keypad is sized from the width, then the artwork takes whatever vertical
  // room is left over rather than pushing the keys off the bottom.
  const keySize = pinKeySizeForWidth(width);
  const chromeHeight = 40 + (showPicker ? 60 : 0) + 38 + 36 + 20;
  const logoRoom =
    height -
    insets.top -
    insets.bottom -
    pinKeypadHeight(keySize) -
    chromeHeight;
  const logoWidth = Math.max(64, Math.min(220, logoRoom));

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <View style={styles.top}>
        <View style={styles.brand}>
          <Image
            source={require('../../assets/logo-mark.png')}
            style={{ width: logoWidth, height: logoWidth * LOGO_ASPECT }}
            resizeMode="contain"
          />
        </View>

        {showPicker ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pickerRow}
            style={styles.pickerScroll}
          >
            {vaults.map((v) => {
              const active = v.id === currentVaultId;
              return (
                <TouchableOpacity
                  key={v.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => switchToVaultPreUnlock(v.id)}
                  activeOpacity={0.7}
                  disabled={busy}
                >
                  <Text
                    style={[styles.chipText, active && styles.chipTextActive]}
                    numberOfLines={1}
                  >
                    {v.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        <Text style={styles.instruction}>{getInstruction()}</Text>

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
          {lockoutMessage || error ? (
            <Text style={styles.errorText}>{lockoutMessage || error}</Text>
          ) : null}
        </View>
      </View>

      <PinKeypad
        keySize={keySize}
        disabled={busy || locked}
        onDigit={pressDigit}
        onBackspace={pressBackspace}
      />
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      // The whole stack (artwork → chips → prompt → dots → keypad) centres
      // as ONE group. The first cut pinned the keypad to the bottom and let
      // the artwork block centre in what was left, which opened a dead band
      // between the dots and the keys.
      justifyContent: 'center',
      backgroundColor: colors.background,
      paddingHorizontal: 24,
    },
    top: {
      flexShrink: 1,
      alignItems: 'center',
      marginBottom: 8,
    },
    brand: {
      alignItems: 'center',
      marginBottom: 8,
      flexShrink: 1,
    },
    pickerScroll: {
      maxHeight: 48,
      marginBottom: 12,
      flexGrow: 0,
      // Stretch so a long chip row scrolls within the screen instead of
      // shrink-wrapping past its edges under the centered column.
      alignSelf: 'stretch',
    },
    pickerRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 4,
      alignItems: 'center',
      // Centre the chips when they fit; `flexGrow` lets the content box fill
      // the stretched ScrollView so `justifyContent` has room to work, and a
      // row wider than the screen still scrolls from its left edge.
      flexGrow: 1,
      justifyContent: 'center',
    },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 18,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      maxWidth: 180,
    },
    chipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipText: { color: colors.text, fontSize: 13, fontWeight: '500' },
    chipTextActive: { color: colors.primaryOnPrimary, fontWeight: '700' },
    instruction: {
      fontSize: 17,
      color: colors.text,
      marginBottom: 20,
      textAlign: 'center',
      paddingHorizontal: 16,
    },
    dotsContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      marginBottom: 16,
    },
    dot: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: colors.borderStrong,
      marginHorizontal: 15,
    },
    dotFilled: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    errorSlot: {
      height: 20,
      justifyContent: 'center',
    },
    errorText: {
      color: colors.danger,
      fontSize: 14,
    },
  });
