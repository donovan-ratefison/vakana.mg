import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';

const FAB_SIZE = 56;
const TARGET_SIZE = 64;
const HOLD_DURATION_MS = 350;
const MIN_DRAG_DISTANCE = 25;
const TAP_MOVE_THRESHOLD = 6;

// Each target is positioned relative to the bottom-right of the screen.
// `right`/`bottom` are computed so the target's *center* sits at (FAB center + dx, FAB center + dy).
// FAB center is at (24 + FAB_SIZE/2 = 52, 24 + FAB_SIZE/2 = 52) from bottom-right.
// target right/bottom = 20 - dx (or dy), since (52 - dx) - TARGET_SIZE/2 = 20 - dx with TARGET_SIZE=64.
const TARGETS = [
  {
    id: 'camera',
    icon: 'camera-outline',
    label: 'Photo',
    dx: -80,
    dy: -80,
    angleMin: -160,
    angleMax: -112.5,
  },
  {
    id: 'mic',
    icon: 'mic-outline',
    label: 'Voice',
    dx: 0,
    dy: -110,
    angleMin: -112.5,
    angleMax: -65,
  },
];

function getActiveTarget(dx, dy) {
  const dist = Math.hypot(dx, dy);
  if (dist < MIN_DRAG_DISTANCE) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  for (const t of TARGETS) {
    if (angle >= t.angleMin && angle <= t.angleMax) return t.id;
  }
  return null;
}

export default function DragFab({ onPress, onCamera, onMic }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [dragMode, setDragMode] = useState(false);
  const [activeTarget, setActiveTarget] = useState(null);

  const dragModeRef = useRef(false);
  const tapTimer = useRef(null);
  const pendingTapRef = useRef(false);

  useEffect(() => () => clearTimeout(tapTimer.current), []);

  const enterDragMode = () => {
    dragModeRef.current = true;
    setDragMode(true);
  };

  const exitDragMode = () => {
    dragModeRef.current = false;
    setDragMode(false);
    setActiveTarget(null);
    Animated.spring(pan, {
      toValue: { x: 0, y: 0 },
      useNativeDriver: false,
      friction: 7,
      tension: 80,
    }).start();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          pendingTapRef.current = true;
          tapTimer.current = setTimeout(() => {
            pendingTapRef.current = false;
            enterDragMode();
          }, HOLD_DURATION_MS);
        },
        onPanResponderMove: (_, g) => {
          if (dragModeRef.current) {
            pan.setValue({ x: g.dx, y: g.dy });
            const next = getActiveTarget(g.dx, g.dy);
            setActiveTarget((cur) => (cur === next ? cur : next));
          } else if (Math.hypot(g.dx, g.dy) > TAP_MOVE_THRESHOLD) {
            // moved before long-press fired: cancel tap and don't enter drag mode
            clearTimeout(tapTimer.current);
            pendingTapRef.current = false;
          }
        },
        onPanResponderRelease: (_, g) => {
          clearTimeout(tapTimer.current);
          if (dragModeRef.current) {
            const target = getActiveTarget(g.dx, g.dy);
            exitDragMode();
            if (target === 'camera') onCamera?.();
            else if (target === 'mic') onMic?.();
          } else if (pendingTapRef.current) {
            pendingTapRef.current = false;
            onPress?.();
          }
        },
        onPanResponderTerminate: () => {
          clearTimeout(tapTimer.current);
          pendingTapRef.current = false;
          if (dragModeRef.current) exitDragMode();
        },
      }),
    [onPress, onCamera, onMic]
  );

  return (
    <>
      {dragMode && (
        <View style={styles.backdrop} pointerEvents="none">
          {TARGETS.map((t) => {
            const right = 20 - t.dx;
            const bottom = 20 - t.dy;
            const isActive = activeTarget === t.id;
            return (
              <View
                key={t.id}
                style={[
                  styles.target,
                  { right, bottom },
                  isActive && styles.targetActive,
                ]}
              >
                <Ionicons
                  name={t.icon}
                  size={26}
                  color={isActive ? colors.primaryOnPrimary : colors.primary}
                />
                <Text
                  style={[styles.targetLabel, isActive && styles.targetLabelActive]}
                >
                  {t.label}
                </Text>
              </View>
            );
          })}
          <Text style={styles.hint}>Drag toward an action</Text>
        </View>
      )}

      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.fab,
          {
            transform: [
              { translateX: pan.x },
              { translateY: pan.y },
            ],
          },
        ]}
        accessibilityLabel="New entry. Long-press, then drag to add a photo or a voice note."
      >
        <Ionicons name="add" size={32} color={colors.primaryOnPrimary} />
      </Animated.View>
    </>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.35)',
    },
    fab: {
      position: 'absolute',
      right: 24,
      bottom: 24,
      width: FAB_SIZE,
      height: FAB_SIZE,
      borderRadius: FAB_SIZE / 2,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      zIndex: 2,
    },
    target: {
      position: 'absolute',
      width: TARGET_SIZE,
      height: TARGET_SIZE,
      borderRadius: TARGET_SIZE / 2,
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: colors.border,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 1,
    },
    targetActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
      transform: [{ scale: 1.1 }],
    },
    targetLabel: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '600',
      marginTop: 2,
    },
    targetLabelActive: {
      color: colors.primaryOnPrimary,
    },
    hint: {
      position: 'absolute',
      bottom: 100,
      alignSelf: 'center',
      color: '#fff',
      fontSize: 13,
      backgroundColor: 'rgba(0,0,0,0.5)',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
    },
  });
