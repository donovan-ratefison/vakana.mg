import React, { useMemo, useState, forwardRef, useImperativeHandle } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import PhotoViewer from './PhotoViewer';
import { persistMediaUris } from '../services/mediaStore';
import { useTheme } from '../theme';

// Picks images from camera or library and hands them to the parent for
// persistence. When `onAddPhotos` is provided, the parent persists
// directly (e.g., EntryEditor INSERTs into entry_photos right away), so
// the photos survive a fast back-tap that would normally outrun the
// debounced auto-save.
//
// During the picker call AND the parent's persist promise, a modal busy
// overlay shows ("Picking photos…" → "Saving N photos…"). The Modal's
// onRequestClose is a no-op so hardware back is consumed while the work
// is in flight, so users don't accidentally lose a 10-photo import to a
// stray gesture during native re-encoding.
function PhotoPicker({ photos, onPhotosChange, onAddPhotos, hideWhenEmpty = false }, ref) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [viewerIndex, setViewerIndex] = useState(null);
  const viewerOpen = viewerIndex !== null;
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');

  // Camera capture is the only path that genuinely needs a runtime
  // permission. Gallery picking does NOT: it goes through the OS photo
  // picker (Android Photo Picker / iOS PHPicker), which brokers access
  // per-selection and needs no app-held permission. The two were
  // previously gated by one shared check that demanded camera AND
  // library; that made the very first gallery import fail because the
  // user (reasonably) denied a surprise camera prompt, and it only
  // started working once camera was later granted via Take photo.
  const requestCameraPermission = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Camera permission needed',
        'Give camera access to take a photo. You can import from your gallery without camera access.'
      );
      return false;
    }
    return true;
  };

  // Either persist via the parent's onAddPhotos (preferred: direct DB
  // INSERT) or fall back to state-only via onPhotosChange. Picker URIs
  // point into the OS-cleanable cache. Copy them into the vault's
  // attachment store first so the DB only ever sees durable URIs.
  const commitAddedPhotos = async (newUris) => {
    if (!newUris || newUris.length === 0) return;
    const stored = await persistMediaUris(newUris, 'photo');
    if (onAddPhotos) {
      await onAddPhotos(stored);
    } else {
      onPhotosChange([...photos, ...stored]);
    }
  };

  const takePhoto = async () => {
    if (busy) return;
    if (!(await requestCameraPermission())) return;
    setBusyLabel('Capturing photo…');
    setBusy(true);
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.7,
      });
      if (!result.canceled && result.assets?.[0]) {
        setBusyLabel('Saving photo…');
        await commitAddedPhotos([result.assets[0].uri]);
      }
    } catch (e) {
      Alert.alert('Camera failed', e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickImage = async () => {
    if (busy) return;
    // No permission gate: launchImageLibraryAsync routes through the OS
    // photo picker, which grants per-selection access itself.
    setBusyLabel('Picking photos…');
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.7,
        allowsMultipleSelection: true,
      });
      if (!result.canceled && result.assets?.length) {
        const newUris = result.assets.map((a) => a.uri);
        setBusyLabel(
          `Saving ${newUris.length} photo${newUris.length === 1 ? '' : 's'}…`
        );
        await commitAddedPhotos(newUris);
      }
    } catch (e) {
      Alert.alert('Pick failed', e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = (index) => {
    Alert.alert(
      'Remove photo',
      'Remove this photo from the entry?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            onPhotosChange(photos.filter((_, i) => i !== index)),
        },
      ]
    );
  };

  useImperativeHandle(ref, () => ({ takePhoto, pickImage }), [takePhoto, pickImage]);

  if (hideWhenEmpty && photos.length === 0) {
    return (
      <Modal
        visible={busy}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.busyBackdrop}>
          <View style={styles.busyCard}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.busyText}>{busyLabel}</Text>
            <Text style={styles.busyHint}>Wait. Do not exit yet.</Text>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.photoGrid}>
        {photos.map((uri, index) => (
          <TouchableOpacity
            key={`${uri}-${index}`}
            style={styles.photoContainer}
            onPress={() => setViewerIndex(index)}
            onLongPress={() => removePhoto(index)}
            delayLongPress={400}
          >
            <Image source={{ uri }} style={styles.photo} />
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.hint}>Tap a photo to view it. Long-press a photo to remove it.</Text>

      <PhotoViewer
        photos={photos}
        initialIndex={viewerIndex ?? 0}
        visible={viewerOpen}
        onClose={() => setViewerIndex(null)}
      />

      <Modal
        visible={busy}
        transparent
        animationType="fade"
        // Consume hardware back so the user can't drop the import mid-flight.
        // The system picker takes seconds to re-encode large photos and
        // an accidental back gesture loses everything.
        onRequestClose={() => {}}
      >
        <View style={styles.busyBackdrop}>
          <View style={styles.busyCard}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.busyText}>{busyLabel}</Text>
            <Text style={styles.busyHint}>Wait. Do not exit yet.</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default forwardRef(PhotoPicker);

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { marginBottom: 12 },
    photoGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    photoContainer: { position: 'relative' },
    photo: { width: 80, height: 80, borderRadius: 8 },
    hint: {
      color: colors.textFaint,
      fontSize: 12,
      marginTop: 4,
    },
    busyBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    busyCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingHorizontal: 24,
      paddingVertical: 20,
      alignItems: 'center',
      gap: 10,
      minWidth: 220,
    },
    busyText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
    },
    busyHint: {
      color: colors.textMuted,
      fontSize: 12,
      textAlign: 'center',
    },
  });
