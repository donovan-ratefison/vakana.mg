import React, { useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import BeadView from './BeadView';
import { readBead } from '../beads/types';
import { isPrivate, MASKED_TITLE } from '../utils/privacy';
import { useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// The inbound half of the mention primitive: the read-only "Mentioned by"
// list: every entry whose editor cross-references this thread. Mirrors
// CommentsDrawer's sheet chrome (backdrop / sheet / handle / heading /
// scrolled list) so the two count-chip → drawer affordances feel like one
// gesture, but this drawer has no composer: a backlink is something you
// read and walk to, not something you write here. Rows are deliberately
// lean (bead + title + date, tap to open) because a mention is "a
// footnote, not a chapter"; delete/comment from a backlink would be
// ambiguous (which side?), so the gesture is open-the-source only.
//
// Presentational: the parent owns the query (the screen's focus-reload
// keeps it fresh) and the navigation. `entries` carries bead_* +
// is_private so the row renders the live bead and masks private titles.
export default function MentionedByDrawer({
  visible,
  entries = [],
  onClose,
  onOpenEntry,
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
          style={[
            styles.sheet,
            { paddingBottom: Math.max(16, insets.bottom + 8) },
          ]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          <Text style={styles.heading}>Mentioned by</Text>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
          >
            {entries.length === 0 ? (
              <Text style={styles.emptyText}>
                No entries mention this thread yet.
              </Text>
            ) : null}

            {entries.map((e) => {
              const bead = readBead(e);
              const masked = isPrivate(e);
              return (
                <TouchableOpacity
                  key={e.id}
                  style={styles.row}
                  activeOpacity={0.7}
                  onPress={() => onOpenEntry?.(e.id)}
                  accessibilityLabel={`Open ${
                    masked ? 'private entry' : e.title || 'untitled entry'
                  }`}
                >
                  <BeadView bead={bead} size={18} />
                  <View style={styles.rowBody}>
                    <Text
                      style={[styles.rowTitle, masked && styles.rowTitleMasked]}
                      numberOfLines={1}
                    >
                      {masked ? MASKED_TITLE : e.title || 'Untitled'}
                    </Text>
                    <Text style={styles.rowDate}>{e.date}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
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
      // Fixed height (not maxHeight): the list ScrollView is flex:1, so it
      // needs a bounded parent or it collapses to zero and the drawer looks
      // empty. Mirrors CommentsDrawer's structure; shorter since there's no
      // composer row to leave room for.
      height: '60%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
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
      marginBottom: 8,
    },
    list: {
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    emptyText: {
      color: colors.textFaint,
      fontSize: 14,
      fontStyle: 'italic',
      textAlign: 'center',
      paddingVertical: 20,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowBody: {
      flex: 1,
    },
    rowTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    rowTitleMasked: {
      color: colors.textMuted,
      fontStyle: 'italic',
      fontWeight: '400',
    },
    rowDate: {
      color: colors.textFaint,
      fontSize: 12,
      marginTop: 2,
    },
  });
