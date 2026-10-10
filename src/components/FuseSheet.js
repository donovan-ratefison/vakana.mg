import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BeadView from './BeadView';
import BeadComposer from './BeadComposer';
import {
  loadFusePreview,
  fuseEntries,
} from '../services/entryFusion';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';
import { useTheme } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Fully-destructive fusion preview sheet. Caller passes the array of
// source entry ids; on confirm we run `fuseEntries`, the sources are
// deleted, and the new entry's id is handed back via `onFused(newId)`.
//
// The fused bead is the alchemy result: shape/pattern/mood = majority
// vote across the contributors, glyph blank. Tap the big bead to open
// the BeadComposer and override before confirming.

export default function FuseSheet({
  visible,
  entryIds,
  onClose,
  onFused,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();

  const [preview, setPreview] = useState(null);
  const [title, setTitle] = useState('');
  const [bead, setBead] = useState(null);
  const [beadComposerOpen, setBeadComposerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const ids = useMemo(() => (Array.isArray(entryIds) ? entryIds : []), [entryIds]);

  useEffect(() => {
    if (!visible) return;
    setPreview(null);
    setTitle('');
    setBead(null);
    setBeadComposerOpen(false);
    if (ids.length < 2) return;
    let cancelled = false;
    (async () => {
      const data = await loadFusePreview(ids);
      if (cancelled) return;
      if (!data) {
        Alert.alert('Could not load entries', 'Some of the selected entries are no longer available.');
        onClose?.();
        return;
      }
      setPreview(data);
      setTitle(data.titleDefault);
      setBead(data.fusedBead);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, ids, onClose]);

  const handleConfirm = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const newId = await fuseEntries(ids, { title, bead });
      onFused?.(newId);
    } catch (e) {
      Alert.alert('Fusion failed', e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const sourceBeads = preview?.sources.map((s) =>
    s.bead_shape
      ? {
          shape: s.bead_shape,
          pattern: s.bead_pattern || 'solid',
          mood: s.bead_mood || 'slate',
          glyph: s.bead_glyph || '',
        }
      : null
  ) || [];

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
            keyboardInset === 0 && { paddingBottom: insets.bottom },
          ]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.heading}>Fuse entries</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          {!preview ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.alchemyBlock}>
                <View style={styles.reagentRow}>
                  {sourceBeads.map((b, i) => (
                    <View key={i} style={styles.reagentSlot}>
                      {b ? <BeadView bead={b} size={20} /> : null}
                    </View>
                  ))}
                </View>
                <View style={styles.alchemyArrow}>
                  <View style={styles.alchemyLine} />
                  <Ionicons name="flask-outline" size={16} color={colors.textFaint} />
                  <View style={styles.alchemyLine} />
                </View>
                <TouchableOpacity
                  style={styles.fusedBeadWrap}
                  onPress={() => setBeadComposerOpen(true)}
                  activeOpacity={0.7}
                  accessibilityLabel="Edit fused bead"
                >
                  <BeadView bead={bead} size={56} />
                  <Text style={styles.fusedHint}>tap to edit</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Title</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder={preview.titleDefault || 'Title'}
                placeholderTextColor={colors.textFaint}
                maxLength={200}
              />

              <Text style={styles.fieldLabel}>Date</Text>
              <Text style={styles.fieldValue}>
                {preview.dateDefault || '–'}{'   '}
                <Text style={styles.fieldValueFaint}>
                  (earliest of {preview.sources.length} sources)
                </Text>
              </Text>

              {preview.photos.length > 0 ? (
                <>
                  <Text style={styles.fieldLabel}>
                    Photos ({preview.photos.length})
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.photoStrip}
                  >
                    {preview.photos.map((uri, i) => (
                      <Image key={i} source={{ uri }} style={styles.photoThumb} />
                    ))}
                  </ScrollView>
                </>
              ) : null}

              {preview.voiceNotes.length > 0 ? (
                <>
                  <Text style={styles.fieldLabel}>
                    Voice notes ({preview.voiceNotes.length})
                  </Text>
                  <View style={styles.voiceList}>
                    {preview.voiceNotes.map((v, i) => (
                      <View key={i} style={styles.voiceRow}>
                        <Ionicons
                          name="mic-outline"
                          size={14}
                          color={colors.textMuted}
                        />
                        <Text style={styles.voiceText}>
                          {Math.round(v.duration || 0)}s
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              {preview.bodyDefault ? (
                <>
                  <Text style={styles.fieldLabel}>Combined body</Text>
                  <View style={styles.bodyBox}>
                    <Text style={styles.bodyText} numberOfLines={8}>
                      {preview.bodyDefault}
                    </Text>
                  </View>
                </>
              ) : null}

              <View style={styles.warningBlock}>
                <Ionicons
                  name="warning-outline"
                  size={14}
                  color={colors.danger}
                />
                <Text style={styles.warningText}>
                  The fusion replaces {preview.sources.length} entries with 1 entry.
                  The comments move to the new entry. You cannot undo the fusion.
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.confirmBtn, busy && styles.confirmBtnDisabled]}
                onPress={handleConfirm}
                disabled={busy}
                activeOpacity={0.8}
              >
                {busy ? (
                  <ActivityIndicator color={colors.primaryOnPrimary} />
                ) : (
                  <>
                    <Ionicons
                      name="flask-outline"
                      size={16}
                      color={colors.primaryOnPrimary}
                    />
                    <Text style={styles.confirmBtnText}>
                      Fuse {preview.sources.length} entries
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>

      <BeadComposer
        visible={beadComposerOpen}
        initial={bead}
        defaultGlyph=""
        onSave={(payload) => {
          setBead(payload);
        }}
        onRemove={() => {
          // "Remove" inside the BeadComposer here means "reset to the
          // computed alchemy default". Fusion always has a bead.
          if (preview?.fusedBead) setBead(preview.fusedBead);
          setBeadComposerOpen(false);
        }}
        onCancel={() => setBeadComposerOpen(false)}
      />
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
      maxHeight: '90%',
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      alignSelf: 'center',
      marginBottom: 8,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    heading: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    loading: {
      paddingVertical: 40,
      alignItems: 'center',
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingBottom: 24,
    },
    alchemyBlock: {
      alignItems: 'center',
      paddingVertical: 12,
      gap: 8,
    },
    reagentRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 6,
    },
    reagentSlot: {
      minWidth: 22,
      height: 22,
      justifyContent: 'center',
      alignItems: 'center',
    },
    alchemyArrow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 2,
    },
    alchemyLine: {
      width: 30,
      height: 1,
      backgroundColor: colors.borderStrong,
    },
    fusedBeadWrap: {
      alignItems: 'center',
      gap: 4,
    },
    fusedHint: {
      color: colors.textFaint,
      fontSize: 10,
      fontStyle: 'italic',
    },
    fieldLabel: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 14,
      marginBottom: 6,
    },
    fieldValue: {
      color: colors.text,
      fontSize: 14,
    },
    fieldValueFaint: {
      color: colors.textFaint,
      fontSize: 12,
      fontStyle: 'italic',
    },
    input: {
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: colors.text,
      fontSize: 15,
    },
    photoStrip: {
      gap: 6,
      paddingVertical: 4,
    },
    photoThumb: {
      width: 56,
      height: 56,
      borderRadius: 6,
    },
    voiceList: {
      gap: 4,
    },
    voiceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    voiceText: {
      color: colors.textMuted,
      fontSize: 12,
    },
    bodyBox: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      padding: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    bodyText: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 18,
    },
    warningBlock: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginTop: 16,
      padding: 10,
      backgroundColor: colors.dangerSoft,
      borderRadius: 8,
    },
    warningText: {
      flex: 1,
      color: colors.danger,
      fontSize: 12,
      lineHeight: 16,
    },
    confirmBtn: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 6,
      marginTop: 14,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: colors.primary,
    },
    confirmBtnDisabled: {
      opacity: 0.5,
    },
    confirmBtnText: {
      color: colors.primaryOnPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
  });
