import React, { useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { hapticTap } from '../utils/haptics';
import { useTheme } from '../theme';

// The on-screen numeric keypad shared by the two PIN surfaces: the lock
// screen (`LockScreen.js`) and Settings → Vault → Change PIN
// (`SettingsChangePinScreen.js`). Both used to capture digits with a hidden
// `TextInput` (1×1, `opacity: 0`, `autoFocus`) plus a full-screen touchable
// that re-focused it; Android would not dependably summon a keyboard for an
// invisible field, so a tester could be left staring at dots with no way to
// type. Don't reintroduce a hidden input on either screen, and don't fork
// this grid: one keypad, two callers.
//
// Props:
//   onDigit(d):     called with '0'–'9' when a digit key is pressed
//   onBackspace():  called when the ⌫ key is pressed
//   disabled:       dims the keys and swallows presses (async work in flight)
//   keySize:        optional override; defaults to the width-derived size.
//                   Pass it when the caller needs the keypad's height up
//                   front to lay out whatever sits above it.

// 3×4 keypad. `null` is the empty slot bottom-left, 'back' the backspace key.
const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [null, '0', 'back'],
];

export const PIN_KEYPAD_ROW_GAP = 12;
const PIN_KEYPAD_COLUMN_GAP = 24;

// Sized from the window **width** so the keys can never be pushed off the
// bottom of a small phone (≈360×640): 24px container padding either side,
// 24px between columns. Capped at 60 dp: the first cut used 76 dp keys and
// they dwarfed the 20 dp PIN dots and the wordmark above them; 60 dp is still
// well above the 48 dp touch-target minimum.
export const pinKeySizeForWidth = (width) =>
  Math.min(60, Math.max(52, Math.floor((width - 48 - 2 * PIN_KEYPAD_COLUMN_GAP) / 3)));

export const pinKeypadHeight = (keySize) =>
  keySize * 4 + PIN_KEYPAD_ROW_GAP * 3;

export default function PinKeypad({
  onDigit,
  onBackspace,
  disabled = false,
  keySize: keySizeProp,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const keySize = keySizeProp || pinKeySizeForWidth(width);

  const press = (key) => {
    if (disabled) return;
    hapticTap();
    if (key === 'back') onBackspace?.();
    else onDigit?.(key);
  };

  const renderKey = (key) => {
    if (key === null) {
      return <View key="blank" style={{ width: keySize, height: keySize }} />;
    }
    const isBack = key === 'back';
    return (
      <Pressable
        key={key}
        onPress={() => press(key)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={isBack ? 'Delete' : `Digit ${key}`}
        android_ripple={{
          color: colors.surfaceMuted,
          borderless: true,
          radius: keySize / 2,
        }}
        style={({ pressed }) => [
          styles.key,
          isBack && styles.keyBare,
          { width: keySize, height: keySize, borderRadius: keySize / 2 },
          disabled && styles.keyDisabled,
          pressed && (isBack ? styles.keyBarePressed : styles.keyPressed),
          pressed && styles.keyPressedScale,
        ]}
      >
        {isBack ? (
          <Ionicons name="backspace-outline" size={24} color={colors.textMuted} />
        ) : (
          <Text style={styles.keyLabel}>{key}</Text>
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.keypad}>
      {KEY_ROWS.map((row, i) => (
        <View key={i} style={styles.keyRow}>
          {row.map(renderKey)}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    keypad: {
      alignSelf: 'center',
      gap: PIN_KEYPAD_ROW_GAP,
    },
    keyRow: {
      flexDirection: 'row',
      gap: PIN_KEYPAD_COLUMN_GAP,
    },
    key: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    // The backspace key reads as an action, not a digit: no fill, no border.
    keyBare: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
    },
    keyPressed: {
      backgroundColor: colors.surface,
      borderColor: colors.borderStrong,
    },
    keyBarePressed: {
      backgroundColor: colors.surfaceMuted,
    },
    keyPressedScale: {
      transform: [{ scale: 0.94 }],
    },
    keyDisabled: {
      opacity: 0.4,
    },
    keyLabel: {
      fontSize: 24,
      fontWeight: '500',
      color: colors.text,
    },
  });
