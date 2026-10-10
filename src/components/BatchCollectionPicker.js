import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import {
  loadCollections,
  createCollectionAndAssignThread,
} from '../services/collections';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';

// Batch picker used from the threads' multi-select header action
// "Add N threads to a collection". Pairs with HomeScreen.handleBatchAddThreadsToCollection
// which does the actual N×addThreadToCollection loop.
//
// Deliberately simpler than CollectionPickerSheet (single-thread):
// - No per-collection check-state (we're picking ONE collection to apply
//   to N threads, not editing memberships of a single thread).
// - Single tap on a collection commits and closes; no Done button needed.
// - Inline "+ New collection" reuses createCollectionAndAssignThread(name, null)
//   to create-without-assignment, then surfaces the new collection back to
//   the parent via onPick (same code path as picking an existing one).
//
// Receiver contract: onPick is called with { id, name } once. The parent
// is responsible for closing the sheet and looping over selected threads.
export default function BatchCollectionPicker({
  visible,
  threadCount = 0,
  onPick,
  onClose,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();

  const [collections, setCollections] = useState([]);
  const [creatingName, setCreatingName] = useState(null); // null = idle, '' = composing

  useEffect(() => {
    if (!visible) return;
    setCreatingName(null);
    (async () => setCollections(await loadCollections()))();
  }, [visible]);

  const pickExisting = (c) => {
    onPick?.({ id: c.id, name: c.name });
  };

  const submitNew = async () => {
    const name = (creatingName || '').trim();
    if (!name) {
      setCreatingName(null);
      return;
    }
    // Create the row; pass null threadId so it doesn't assign. The
    // parent's loop adds every selected thread next.
    const newId = await createCollectionAndAssignThread(name, null);
    setCreatingName(null);
    if (newId != null) onPick?.({ id: newId, name });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[
          styles.backdrop,
          keyboardInset > 0 && { paddingBottom: keyboardInset },
        ]}
        onPress={onClose}
      >
        <Pressable
          style={[
            styles.sheet,
            keyboardInset === 0 && {
              paddingBottom: Math.max(16, insets.bottom + 8),
            },
          ]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          <Text style={styles.heading}>Add to collection</Text>
          <Text style={styles.subheading} numberOfLines={1}>
            {threadCount} thread{threadCount === 1 ? '' : 's'} selected
          </Text>

          <ScrollView contentContainerStyle={styles.list}>
            {collections.length === 0 && creatingName === null ? (
              <Text style={styles.emptyText}>
                No collections yet. Create one below.
              </Text>
            ) : null}

            {collections.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={styles.row}
                onPress={() => pickExisting(c)}
                activeOpacity={0.7}
                accessibilityLabel={`Add ${threadCount} thread${threadCount === 1 ? '' : 's'} to ${c.name}`}
              >
                <Ionicons
                  name="folder-outline"
                  size={16}
                  color={colors.textMuted}
                />
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {c.name}
                </Text>
              </TouchableOpacity>
            ))}

            {creatingName === null ? (
              <TouchableOpacity
                style={styles.row}
                onPress={() => setCreatingName('')}
                activeOpacity={0.7}
              >
                <Ionicons name="add" size={20} color={colors.primary} />
                <Text style={styles.rowLabelAccent}>New collection</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.newRow}>
                <TextInput
                  style={styles.newInput}
                  placeholder="Name"
                  placeholderTextColor={colors.placeholder}
                  value={creatingName}
                  onChangeText={setCreatingName}
                  autoFocus
                  onSubmitEditing={submitNew}
                  returnKeyType="done"
                  maxLength={80}
                />
                <TouchableOpacity
                  onPress={submitNew}
                  style={styles.newSubmit}
                  accessibilityLabel="Create collection and assign selected threads"
                >
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setCreatingName(null)}
                  style={styles.newCancel}
                  accessibilityLabel="Cancel new collection"
                >
                  <Ionicons name="close" size={20} color={colors.textFaint} />
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
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
      maxHeight: '80%',
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
      paddingBottom: 16,
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
      paddingHorizontal: 20,
    },
    subheading: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '500',
      paddingHorizontal: 20,
      paddingBottom: 8,
      marginTop: 2,
    },
    list: {
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    emptyText: {
      color: colors.textFaint,
      fontSize: 13,
      fontStyle: 'italic',
      paddingVertical: 12,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowLabel: {
      color: colors.text,
      fontSize: 15,
      flex: 1,
    },
    rowLabelAccent: {
      color: colors.primary,
      fontSize: 15,
      fontWeight: '600',
      flex: 1,
    },
    newRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    newInput: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 8,
    },
    newSubmit: {
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
    },
    newCancel: {
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
