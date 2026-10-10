import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useTheme } from '../theme';

// Keep the screen awake during the quick capture so inactivity sleep can't
// cut the take short. Tag-scoped; distinct from the editor recorder's tag.
const KEEP_AWAKE_TAG = 'vakana-quick-voice';

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function QuickVoiceModal({ visible, onSave, onCancel }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const [stopping, setStopping] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      startedRef.current = false;
      setStopping(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const { granted } = await requestRecordingPermissionsAsync();
      if (cancelled) return;
      if (!granted) {
        onCancel?.();
        return;
      }
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await recorder.prepareToRecordAsync();
        if (cancelled) return;
        recorder.record();
        startedRef.current = true;
      } catch (err) {
        console.error('Failed to start quick recording', err);
        onCancel?.();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Hold the screen awake while recording; released on every stop path
  // (save, cancel, error, or the modal closing) via the cleanup.
  useEffect(() => {
    if (!recorderState.isRecording) return undefined;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [recorderState.isRecording]);

  useEffect(() => {
    if (!recorderState.isRecording) {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [recorderState.isRecording, pulseAnim]);

  const handleStop = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      const durationMillis = recorderState.durationMillis ?? 0;
      await recorder.stop();
      const uri = recorder.uri;
      startedRef.current = false;
      if (uri) {
        onSave?.({ uri, duration: Math.round(durationMillis / 1000) });
      } else {
        onCancel?.();
      }
    } catch (err) {
      console.error('Failed to stop quick recording', err);
      onCancel?.();
    }
  };

  const handleCancel = async () => {
    if (startedRef.current) {
      // Silent on purpose: cancel may race a recorder that never started
      // or already stopped; the recording is being discarded either way.
      try { await recorder.stop(); } catch {}
      startedRef.current = false;
    }
    onCancel?.();
  };

  const liveDuration = Math.floor((recorderState.durationMillis ?? 0) / 1000);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <TouchableOpacity
            onPress={handleCancel}
            style={styles.cancelButton}
            hitSlop={12}
            accessibilityLabel="Cancel recording"
          >
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.center}>
            <View style={styles.dotRow}>
              <Animated.View style={[styles.dot, { opacity: pulseAnim }]} />
              <Text style={styles.recordingText}>Recording</Text>
            </View>
            <Text style={styles.timer}>{formatDuration(liveDuration)}</Text>
          </View>

          <TouchableOpacity
            onPress={handleStop}
            style={styles.stopButton}
            disabled={stopping || !startedRef.current}
            accessibilityLabel="Stop and save"
          >
            <Ionicons name="stop" size={28} color={colors.primaryOnPrimary} />
          </TouchableOpacity>

          <Text style={styles.hint}>Tap to stop and save</Text>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    sheet: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 24,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    cancelButton: {
      position: 'absolute',
      top: 12,
      right: 12,
      width: 32,
      height: 32,
      justifyContent: 'center',
      alignItems: 'center',
    },
    center: {
      alignItems: 'center',
      marginTop: 8,
      marginBottom: 24,
    },
    dotRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.danger,
      marginRight: 8,
    },
    recordingText: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '500',
      letterSpacing: 0.3,
    },
    timer: {
      color: colors.text,
      fontSize: 36,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    stopButton: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.danger,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 12,
    },
    hint: {
      color: colors.textFaint,
      fontSize: 12,
    },
  });
