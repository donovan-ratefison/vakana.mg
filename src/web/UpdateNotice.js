import React, { useMemo, useSyncExternalStore } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme';
import { getAction, safeReload, subscribe } from './pwaUpdate';

// Web only: a pill in the free band at the top of every screen, shown while a
// new build waits and the user can be typing. It never takes the focus.
export default function UpdateNotice() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const action = useSyncExternalStore(subscribe, getAction);
  if (action !== 'notice') return null;
  return (
    <View style={styles.band}>
      <View style={styles.pill} aria-live="polite">
        <Text style={styles.text}>New version ready</Text>
        <Pressable style={styles.button} accessibilityRole="button" onPress={safeReload}>
          <Text style={styles.buttonLabel}>Reload</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    // Only the pill takes the clicks: the band lets them through.
    band: {
      position: 'fixed',
      top: 12,
      left: 0,
      right: 0,
      alignItems: 'center',
      pointerEvents: 'box-none',
    },
    pill: {
      height: 36,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingLeft: 14,
      paddingRight: 4,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    text: {
      fontSize: 14,
      color: colors.text,
    },
    button: {
      paddingVertical: 4,
      paddingHorizontal: 12,
      borderRadius: 14,
      backgroundColor: colors.primary,
    },
    buttonLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primaryOnPrimary,
    },
  });
