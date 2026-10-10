import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getDb } from '../database/db';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';
import { useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Lightweight create-or-rename collection sheet. If `initial` is null, runs
// in create mode and INSERTs a new row. If `initial` is { id, name }, runs
// in rename mode and UPDATEs that row.
//
// onSubmit(collection) fires after the row write succeeds; the parent uses
// it to refresh its collection list.
export default function CollectionFormSheet({
  visible,
  initial = null,
  onSubmit,
  onClose,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();

  const [name, setName] = useState('');
  const isRename = Boolean(initial?.id);

  useEffect(() => {
    if (visible) setName(initial?.name || '');
  }, [visible, initial]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const db = getDb();
    if (!db) return;
    if (isRename) {
      await db.runAsync(
        `UPDATE thread_collections
            SET name = ?, updated_at = datetime('now')
          WHERE id = ?`,
        [trimmed, initial.id]
      );
      onSubmit?.({ id: initial.id, name: trimmed });
    } else {
      const result = await db.runAsync(
        'INSERT INTO thread_collections (name) VALUES (?)',
        [trimmed]
      );
      onSubmit?.({ id: result.lastInsertRowId, name: trimmed });
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.backdrop, keyboardInset > 0 && { paddingBottom: keyboardInset }]}
        onPress={onClose}
      >
        <Pressable
          style={[
            styles.sheet,
            keyboardInset === 0 && { paddingBottom: Math.max(24, insets.bottom + 8) },
          ]}
          onPress={() => {}}
        >
            <View style={styles.handle} />
            <Text style={styles.heading}>
              {isRename ? 'Rename collection' : 'New collection'}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Name"
              placeholderTextColor={colors.placeholder}
              value={name}
              onChangeText={setName}
              autoFocus
              onSubmitEditing={submit}
              returnKeyType="done"
              maxLength={80}
            />
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={onClose}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  !name.trim() && styles.submitBtnDisabled,
                ]}
                onPress={submit}
                activeOpacity={0.7}
                disabled={!name.trim()}
              >
                <Ionicons
                  name="checkmark"
                  size={18}
                  color={colors.primaryOnPrimary}
                />
                <Text style={styles.submitText}>
                  {isRename ? 'Save' : 'Create'}
                </Text>
              </TouchableOpacity>
            </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
      paddingBottom: 24,
      paddingHorizontal: 20,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      alignSelf: 'center',
      marginBottom: 12,
    },
    heading: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 12,
    },
    input: {
      color: colors.text,
      fontSize: 16,
      paddingVertical: 10,
      paddingHorizontal: 12,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      marginBottom: 16,
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
    },
    cancelBtn: {
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
    },
    cancelText: {
      color: colors.textMuted,
      fontSize: 15,
      fontWeight: '600',
    },
    submitBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      backgroundColor: colors.primary,
    },
    submitBtnDisabled: {
      opacity: 0.5,
    },
    submitText: {
      color: colors.primaryOnPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
  });
