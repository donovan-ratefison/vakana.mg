import React, { useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Animated, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder,
  useAudioRecorderState,
  useAudioPlayer,
  useAudioPlayerStatus,
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { persistMediaUri } from '../services/mediaStore';
import { useTheme } from '../theme';

const RECORDING_OPTIONS = RecordingPresets.HIGH_QUALITY;
// Hold the screen awake while recording: the user's finger is idle the whole
// take, so inactivity sleep would otherwise dim the screen and cut the
// recording short. Tag-scoped so it can't clobber other keep-awake holders.
const KEEP_AWAKE_TAG = 'vakana-voice-recorder';

const clamp01 = (n) => Math.min(1, Math.max(0, n || 0));
const MAX_IMPORT_BYTES = 50 * 1024 * 1024; // 50 MB cap on imported audio.

// Brief headless load via expo-audio so we can store the imported file's
// duration in seconds. Polls `isLoaded` for up to ~4s, then disposes the
// player. Falls back to 0 if the load doesn't resolve in time: the
// playback path reads duration from its own player anyway.
async function readAudioDuration(uri) {
  try {
    const player = createAudioPlayer({ uri });
    const start = Date.now();
    while (!player.isLoaded && Date.now() - start < 4000) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 50));
    }
    const seconds = Math.round(player.duration || 0);
    player.remove();
    return seconds;
  } catch (err) {
    console.warn('readAudioDuration failed:', err?.message || err);
    return 0;
  }
}

function VoiceRecorder({ recordings, onRecordingsChange, hideWhenEmpty = false }, ref) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 200);

  const [playingIndex, setPlayingIndex] = useState(null);
  const playingUri = playingIndex !== null ? recordings[playingIndex]?.uri : null;
  const player = useAudioPlayer(playingUri ? { uri: playingUri } : null);
  const playerStatus = useAudioPlayerStatus(player);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Scrub state for the active recording's progress bar. seekFraction is the
  // finger position during a drag (null when not dragging), shown optimistically
  // so the thumb tracks the finger even though currentTime lags behind. The
  // PanResponder is created once and reads stable refs (track width, the live
  // player, the active duration) so its handlers never capture stale values.
  const [seekFraction, setSeekFraction] = useState(null);
  const trackWidthRef = useRef(0);
  const playerRef = useRef(null);
  const durationRef = useRef(0);
  const seekFractionRef = useRef(null);
  playerRef.current = player;
  const activeTotal =
    (playerStatus?.duration && playerStatus.duration > 0
      ? playerStatus.duration
      : playingIndex != null
        ? recordings[playingIndex]?.duration || 0
        : 0) || 0;
  durationRef.current = activeTotal;

  const seekPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const f = clamp01(e.nativeEvent.locationX / (trackWidthRef.current || 1));
        seekFractionRef.current = f;
        setSeekFraction(f);
      },
      onPanResponderMove: (e) => {
        const f = clamp01(e.nativeEvent.locationX / (trackWidthRef.current || 1));
        seekFractionRef.current = f;
        setSeekFraction(f);
      },
      onPanResponderRelease: () => {
        const f = seekFractionRef.current;
        if (playerRef.current && f != null) {
          playerRef.current.seekTo(f * (durationRef.current || 0));
        }
        seekFractionRef.current = null;
        setSeekFraction(null);
      },
      onPanResponderTerminate: () => {
        seekFractionRef.current = null;
        setSeekFraction(null);
      },
    })
  ).current;

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

  // Keep the screen awake for the duration of a recording. Driven off
  // isRecording so the lock is released on every stop path (stop button,
  // error, or the component unmounting on nav-away) and never leaks.
  useEffect(() => {
    if (!recorderState.isRecording) return undefined;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [recorderState.isRecording]);

  useEffect(() => {
    if (playingUri && player) {
      player.seekTo(0);
      player.play();
    }
  }, [playingUri]);

  useEffect(() => {
    if (playerStatus?.didJustFinish) {
      setPlayingIndex(null);
    }
  }, [playerStatus?.didJustFinish]);

  const startRecording = async () => {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission Required', 'Give microphone permission to record.');
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  };

  const stopRecording = async () => {
    try {
      const durationMillis = recorderState.durationMillis ?? 0;
      await recorder.stop();
      const uri = recorder.uri;

      if (uri) {
        // The recorder writes into the OS-cleanable cache. Move the take
        // into the vault's attachment store before it enters state.
        const stored = await persistMediaUri(uri, 'voice');
        onRecordingsChange([
          ...recordings,
          { uri: stored, duration: Math.round(durationMillis / 1000) },
        ]);
      }
    } catch (err) {
      console.error('Failed to stop recording', err);
    }
  };

  const togglePlay = async (index) => {
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      // Same row → pause / resume in place (keeps the player mounted so the
      // progress bar stays where it is). A different row → switch; the
      // playingUri effect below restarts playback from 0 on the new player.
      if (playingIndex === index) {
        if (player) {
          if (playerStatus?.playing) player.pause();
          else player.play();
        }
        return;
      }
      setPlayingIndex(index);
    } catch (err) {
      console.error('Failed to play recording', err);
    }
  };

  const removeRecording = (index) => {
    if (playingIndex === index) setPlayingIndex(null);
    onRecordingsChange(recordings.filter((_, i) => i !== index));
  };

  // Pick an existing audio file from the device. The picker copies into the
  // app cache so the URI is stable; the size check rejects files that
  // would bloat the journal (the user is told the cap up front, again on
  // rejection so the number isn't a mystery).
  const importAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      const sizeBytes = asset.size ?? 0;
      if (sizeBytes > MAX_IMPORT_BYTES) {
        const sizeMb = (sizeBytes / 1024 / 1024).toFixed(1);
        Alert.alert(
          'File too large',
          `An audio file must be smaller than 50 MB. The selected file is ${sizeMb} MB.`
        );
        return;
      }

      const duration = await readAudioDuration(asset.uri);
      // copyToCacheDirectory lands the pick in the cache. Store a
      // durable copy, same as a fresh recording.
      const stored = await persistMediaUri(asset.uri, 'voice');
      onRecordingsChange([
        ...recordings,
        { uri: stored, duration },
      ]);
    } catch (err) {
      console.error('Audio import failed:', err);
      Alert.alert('Import failed', 'Could not import the audio file.');
    }
  };

  const formatDuration = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const liveDuration = Math.floor((recorderState.durationMillis ?? 0) / 1000);

  useImperativeHandle(ref, () => ({ startRecording, importAudio }), [startRecording, importAudio]);

  if (hideWhenEmpty && recordings.length === 0 && !recorderState.isRecording) {
    return null;
  }

  return (
    <View style={styles.container}>
      {recorderState.isRecording ? (
        <View style={styles.recorderRow}>
          <TouchableOpacity
            style={[styles.recordButton, styles.recordButtonActive]}
            onPress={stopRecording}
            accessibilityLabel="Stop recording"
          >
            <Ionicons name="stop" size={22} color={colors.primaryOnPrimary} />
          </TouchableOpacity>
          <View style={styles.statusContainer}>
            <Animated.View
              style={[styles.recordingDot, { opacity: pulseAnim }]}
            />
            <Text style={styles.recordingText}>Recording</Text>
            <Text style={styles.timer}>{formatDuration(liveDuration)}</Text>
          </View>
        </View>
      ) : null}

      {recordings.map((rec, index) => {
        const isActive = playingIndex === index;
        const isPlaying = isActive && !!playerStatus?.playing;
        const liveFraction =
          activeTotal > 0
            ? clamp01((playerStatus?.currentTime ?? 0) / activeTotal)
            : 0;
        const fraction = isActive
          ? seekFraction != null
            ? seekFraction
            : liveFraction
          : 0;
        const elapsed = Math.floor(fraction * activeTotal);
        return (
          <View key={index} style={styles.recordingItem}>
            <TouchableOpacity
              style={styles.playButton}
              onPress={() => togglePlay(index)}
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            >
              <Ionicons
                name={isPlaying ? 'pause' : 'play'}
                size={18}
                color={colors.primary}
              />
            </TouchableOpacity>
            {isActive ? (
              <View style={styles.progressArea}>
                <View
                  style={styles.trackHit}
                  onLayout={(e) => {
                    trackWidthRef.current = e.nativeEvent.layout.width;
                  }}
                  {...seekPan.panHandlers}
                >
                  <View style={styles.track}>
                    <View
                      style={[styles.trackFill, { width: `${fraction * 100}%` }]}
                      pointerEvents="none"
                    />
                  </View>
                  <View
                    style={[styles.trackThumb, { left: `${fraction * 100}%` }]}
                    pointerEvents="none"
                  />
                </View>
                <Text style={styles.timeText}>
                  {formatDuration(elapsed)} / {formatDuration(Math.round(activeTotal))}
                </Text>
              </View>
            ) : (
              <Text style={styles.durationText}>
                {formatDuration(rec.duration)}
              </Text>
            )}
            <TouchableOpacity
              onPress={() => removeRecording(index)}
              accessibilityLabel="Remove recording"
              style={styles.removeButton}
            >
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

export default forwardRef(VoiceRecorder);

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { marginBottom: 12 },
    recorderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 10,
      padding: 8,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 4,
    },
    recordButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    recordButtonActive: {
      backgroundColor: colors.danger,
    },
    statusContainer: {
      flex: 1,
      marginLeft: 12,
      flexDirection: 'row',
      alignItems: 'center',
    },
    recordingDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.danger,
      marginRight: 8,
    },
    recordingText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '500',
      flex: 1,
    },
    timer: {
      color: colors.textMuted,
      fontSize: 14,
      fontVariant: ['tabular-nums'],
      minWidth: 40,
      textAlign: 'right',
    },
    recordingItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      padding: 10,
      marginBottom: 6,
    },
    playButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    durationText: {
      color: colors.textMuted,
      flex: 1,
      fontSize: 14,
      fontVariant: ['tabular-nums'],
    },
    progressArea: {
      flex: 1,
      marginRight: 4,
    },
    trackHit: {
      justifyContent: 'center',
      paddingVertical: 8,
    },
    track: {
      height: 5,
      borderRadius: 2.5,
      backgroundColor: colors.border,
      overflow: 'hidden',
    },
    trackFill: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      borderRadius: 2.5,
      backgroundColor: colors.primary,
    },
    trackThumb: {
      position: 'absolute',
      top: '50%',
      width: 12,
      height: 12,
      marginTop: -6,
      marginLeft: -6,
      borderRadius: 6,
      backgroundColor: colors.primary,
      borderWidth: 2,
      borderColor: colors.surface,
    },
    timeText: {
      marginTop: 4,
      color: colors.textMuted,
      fontSize: 11,
      fontVariant: ['tabular-nums'],
    },
    removeButton: {
      padding: 6,
    },
  });
