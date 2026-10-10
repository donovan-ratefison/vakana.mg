import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Modal,
  Dimensions,
  FlatList,
  StatusBar,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function PhotoViewer({ photos, initialIndex, visible, onClose }) {
  const listRef = useRef(null);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const { width, height } = Dimensions.get('window');

  useEffect(() => {
    if (visible) setCurrentIndex(initialIndex);
  }, [visible, initialIndex]);

  const onShow = () => {
    setCurrentIndex(initialIndex);
    setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: initialIndex * width, animated: false });
    }, 0);
  };

  const onMomentumScrollEnd = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width);
    setCurrentIndex(idx);
  };

  const goTo = (idx) => {
    const clamped = Math.max(0, Math.min(photos.length - 1, idx));
    listRef.current?.scrollToOffset({ offset: clamped * width, animated: true });
    setCurrentIndex(clamped);
  };

  const isWeb = Platform.OS === 'web';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onShow={onShow}
      statusBarTranslucent
    >
      <StatusBar hidden />
      <View style={styles.backdrop}>
        <FlatList
          ref={listRef}
          data={photos}
          keyExtractor={(uri, i) => `${uri}-${i}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          initialScrollIndex={initialIndex}
          onMomentumScrollEnd={onMomentumScrollEnd}
          renderItem={({ item }) => (
            <View
              style={{ width, height, justifyContent: 'center', alignItems: 'center' }}
            >
              <Image source={{ uri: item }} style={{ width, height }} resizeMode="contain" />
            </View>
          )}
        />

        {isWeb && photos.length > 1 && (
          <>
            <TouchableOpacity
              style={[styles.navButton, styles.navLeft]}
              onPress={() => goTo(currentIndex - 1)}
              disabled={currentIndex === 0}
            >
              <Ionicons
                name="chevron-back"
                size={28}
                color={currentIndex === 0 ? 'rgba(255,255,255,0.3)' : '#fff'}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.navButton, styles.navRight]}
              onPress={() => goTo(currentIndex + 1)}
              disabled={currentIndex === photos.length - 1}
            >
              <Ionicons
                name="chevron-forward"
                size={28}
                color={currentIndex === photos.length - 1 ? 'rgba(255,255,255,0.3)' : '#fff'}
              />
            </TouchableOpacity>
          </>
        )}

        <View style={styles.topBar} pointerEvents="box-none">
          {photos.length > 1 && (
            <Text style={styles.counter}>
              {currentIndex + 1} / {photos.length}
            </Text>
          )}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            hitSlop={12}
            accessibilityLabel="Close photo viewer"
          >
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  counter: {
    color: '#fff',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 'auto',
  },
  navButton: {
    position: 'absolute',
    top: '50%',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -22,
  },
  navLeft: { left: 16 },
  navRight: { right: 16 },
});
