import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme';

// Web only: a full-screen notice shown in place of the app, with one action.
export default function BootNotice({ message, detail, actionLabel, onAction }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      <Pressable style={styles.button} accessibilityRole="button" onPress={onAction}>
        <Text style={styles.buttonLabel}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
      gap: 16,
      backgroundColor: colors.background,
    },
    message: {
      fontSize: 20,
      textAlign: 'center',
      color: colors.text,
    },
    detail: {
      fontSize: 14,
      textAlign: 'center',
      color: colors.textMuted,
    },
    button: {
      marginTop: 8,
      paddingVertical: 12,
      paddingHorizontal: 28,
      borderRadius: 24,
      backgroundColor: colors.primary,
    },
    buttonLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.primaryOnPrimary,
    },
  });
