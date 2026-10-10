import React, { useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Long-press affordance for the collection chip strip. Two rows: Rename
// and Delete. The parent owns the next-step flows (rename opens
// CollectionFormSheet, delete opens an Alert with the thread count) so
// this sheet is purely a chooser: no DB writes happen here.
export default function CollectionActionsSheet({
  visible,
  collection,
  onRename,
  onDelete,
  onClose,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom + 8) }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          <Text style={styles.heading}>Collection</Text>
          <Text style={styles.subheading} numberOfLines={1}>
            {collection?.name || 'Collection'}
          </Text>

          <TouchableOpacity
            style={styles.row}
            onPress={onRename}
            activeOpacity={0.7}
          >
            <Ionicons
              name="create-outline"
              size={20}
              color={colors.primary}
            />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>Rename</Text>
              <Text style={styles.rowSubtitle}>Change the collection name.</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.row}
            onPress={onDelete}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, { color: colors.danger }]}>
                Delete
              </Text>
              <Text style={styles.rowSubtitle}>
                The threads stay. They are no longer in this collection.
              </Text>
            </View>
          </TouchableOpacity>
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
      fontSize: 16,
      fontWeight: '600',
      paddingHorizontal: 20,
      paddingBottom: 8,
      marginTop: 2,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    rowBody: { flex: 1 },
    rowTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    rowSubtitle: {
      color: colors.textFaint,
      fontSize: 12,
      marginTop: 2,
    },
  });
