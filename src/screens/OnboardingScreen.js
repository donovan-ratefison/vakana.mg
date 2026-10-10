import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BeadView from '../components/BeadView';
import { setOnboardingSeen } from '../utils/preferences';
import { useTheme } from '../theme';

// First-launch intro slides (v0.78.0). Design contract:
// docs/architecture/onboarding-slides.md. The blend:
// the app's own palette and card chrome, glossy beads with emoji glyphs,
// Caveat for the slide chrome (headlines, labels, date, thread name) while
// note cards keep the app's real note face so the slides show exactly what
// the user meets one tap later.
//
// Rendered two ways:
// - Standalone from App.js before the PIN gate on first launch (`onDone`
//   prop set; finishing stamps the seen-marker).
// - As a stack screen from Settings → Pro Tips → "Watch the intro again"
//   (no `onDone`; finishing pops back, marker untouched).

const GOLD = '#C9A24A'; // BeadChain's string color

const SHIFT_X = -60; // slide-4 chain glide
const SHIFT_SCALE = 0.86; // slide-4 zoom-out (top-anchored via translateY comp)

const BEAD_IDEA = { shape: 'round', mood: 'ocean', pattern: 'solid', glyph: '💡' };
const BEAD_MOM = { shape: 'round', mood: 'rose', pattern: 'solid', glyph: '👩' };
const BEAD_MEET = { shape: 'lozenge', mood: 'forest', pattern: 'solid', glyph: '🤝' };

const CANDIDATES = [
  { shape: 'square', mood: 'forest', pattern: 'solid', glyph: '' },
  { shape: 'round', mood: 'sun', pattern: 'solid', glyph: '' },
  { shape: 'lozenge', mood: 'ember', pattern: 'solid', glyph: '' },
  { shape: 'oval', mood: 'plum', pattern: 'solid', glyph: '' },
];

// Slide 5's hand-strung thread. Trophy on charcoal: the gold emoji is
// invisible on ember (maker call).
const OWN_THREAD = [
  { shape: 'round', mood: 'sun', pattern: 'solid', glyph: '💡' },
  { shape: 'lozenge', mood: 'forest', pattern: 'solid', glyph: '🤝' },
  { shape: 'round', mood: 'ocean', pattern: 'solid', glyph: '🔧' },
  { shape: 'round', mood: 'rose', pattern: 'solid', glyph: '👩' },
  { shape: 'square', mood: 'charcoal', pattern: 'solid', glyph: '🏆' },
  { shape: 'round', mood: 'plum', pattern: 'solid', glyph: '🥂' },
];

const NOTES = [
  'Got an awesome idea. The details…',
  'I used Mom’s money to buy some parts…',
  'Ask a buddy to help me build this. He agreed',
];

const DAY_CHAIN = [BEAD_IDEA, BEAD_MOM, BEAD_MEET];

const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
];

function todayPendant() {
  const d = new Date();
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const SLIDE_COUNT = 6;
const DAY_PAGE = 4;
const OWN_PAGE = 5;

export default function OnboardingScreen({ navigation, onDone }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const scrollRef = useRef(null);
  const [page, setPage] = useState(0);

  // ---- slide 4 (day thread) animation state ----
  // chain rows: bead / link / bead / link / bead / joint
  const chainAnims = useRef(
    Array.from({ length: 6 }, () => new Animated.Value(0))
  ).current;
  const shiftAnim = useRef(new Animated.Value(0)).current;
  const noteAnims = useRef(
    Array.from({ length: 3 }, () => new Animated.Value(0))
  ).current;
  // Measured layout: bead centers within the chain column and the chain's
  // height. Positions are measured, never hardcoded (the prototype proved
  // hand-tuned offsets drift with font metrics).
  const [beadCenters, setBeadCenters] = useState([0, 0, 0]);
  const [chainHeight, setChainHeight] = useState(0);
  const [noteHeights, setNoteHeights] = useState([0, 0, 0]);

  // ---- slide 5 (own thread) animation state ----
  const ownAnims = useRef(
    Array.from({ length: OWN_THREAD.length * 2 - 1 }, () => new Animated.Value(0))
  ).current;
  const tnameAnim = useRef(new Animated.Value(0)).current;

  const runningRef = useRef(null);

  const stopAndReset = useCallback(() => {
    if (runningRef.current) {
      runningRef.current.stop();
      runningRef.current = null;
    }
    chainAnims.forEach((v) => v.setValue(0));
    shiftAnim.setValue(0);
    noteAnims.forEach((v) => v.setValue(0));
    ownAnims.forEach((v) => v.setValue(0));
    tnameAnim.setValue(0);
  }, [chainAnims, shiftAnim, noteAnims, ownAnims, tnameAnim]);

  useEffect(() => {
    stopAndReset();
    let seq = null;
    if (page === DAY_PAGE) {
      const appear = (v, dur = 320) =>
        Animated.timing(v, { toValue: 1, duration: dur, useNativeDriver: true });
      const vanish = (v, dur = 180) =>
        Animated.timing(v, { toValue: 0, duration: dur, useNativeDriver: true });
      seq = Animated.sequence([
        Animated.stagger(140, chainAnims.map((v) => appear(v))),
        Animated.timing(shiftAnim, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
        // One note at a time beside its bead; the last one stays.
        appear(noteAnims[0], 200),
        Animated.delay(750),
        vanish(noteAnims[0]),
        appear(noteAnims[1], 200),
        Animated.delay(750),
        vanish(noteAnims[1]),
        appear(noteAnims[2], 240),
      ]);
    } else if (page === OWN_PAGE) {
      seq = Animated.sequence([
        Animated.stagger(
          70,
          ownAnims.map((v) =>
            Animated.timing(v, { toValue: 1, duration: 260, useNativeDriver: true })
          )
        ),
        Animated.timing(tnameAnim, {
          toValue: 1,
          duration: 320,
          useNativeDriver: true,
        }),
      ]);
    }
    if (seq) {
      runningRef.current = seq;
      seq.start(() => {
        runningRef.current = null;
      });
    }
    return stopAndReset;
  }, [page, chainAnims, shiftAnim, noteAnims, ownAnims, tnameAnim, stopAndReset]);

  const finish = useCallback(async () => {
    if (onDone) {
      await setOnboardingSeen();
      onDone();
    } else if (navigation) {
      navigation.goBack();
    }
  }, [onDone, navigation]);

  const goTo = useCallback(
    (i) => {
      scrollRef.current?.scrollTo({ x: i * width, animated: true });
    },
    [width]
  );

  const onScrollEnd = useCallback(
    (e) => {
      const i = Math.round(e.nativeEvent.contentOffset.x / width);
      setPage(Math.max(0, Math.min(SLIDE_COUNT - 1, i)));
    },
    [width]
  );

  const onBeadLayout = (index) => (e) => {
    const { y, height } = e.nativeEvent.layout;
    const center = y + height / 2;
    setBeadCenters((prev) => {
      if (prev[index] === center) return prev;
      const next = prev.slice();
      next[index] = center;
      return next;
    });
  };

  const onNoteLayout = (index) => (e) => {
    const h = e.nativeEvent.layout.height;
    setNoteHeights((prev) => {
      if (prev[index] === h) return prev;
      const next = prev.slice();
      next[index] = h;
      return next;
    });
  };

  const fadeDrop = (v) => ({
    opacity: v,
    transform: [
      {
        translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }),
      },
    ],
  });

  // Top-anchored glide+zoom: plain scale is center-origin, so compensate the
  // vertical shift to keep the chain's top edge (under the date) in place.
  const chainShiftStyle = {
    transform: [
      {
        translateX: shiftAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, SHIFT_X],
        }),
      },
      {
        translateY: shiftAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -(chainHeight * (1 - SHIFT_SCALE)) / 2],
        }),
      },
      {
        scale: shiftAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [1, SHIFT_SCALE],
        }),
      },
    ],
  };

  const stepLabel = (n) => `STEP ${n} · 5`;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        bounces={false}
      >
        {/* 0 · Welcome */}
        <View style={[styles.slide, { width }]}>
          <View style={styles.art}>
            <Text style={styles.headline}>Welcome to</Text>
            <Image
              source={require('../../assets/splash-icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.body}>
              The Malagasy Knowledge{'\n'}Management System,{'\n'}on your phone.
            </Text>
          </View>
        </View>

        {/* 1 · Take a note */}
        <View style={[styles.slide, { width }]}>
          <Text style={styles.eystep}>{stepLabel(1)}</Text>
          <View style={styles.art}>
            <View style={styles.card}>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>An idea</Text>
                <Text style={styles.cardSnippet}>{NOTES[0]}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.headline}>Take a note</Text>
          <Text style={styles.body}>
            Write what happened today.{'\n'}A thought, a moment, a win.
          </Text>
        </View>

        {/* 2 · Shape its bead */}
        <View style={[styles.slide, { width }]}>
          <Text style={styles.eystep}>{stepLabel(2)}</Text>
          <View style={styles.art}>
            <BeadView bead={BEAD_IDEA} size={76} glossy />
            <Text style={styles.beadLabel}>“having an idea”</Text>
            <View style={styles.candRow}>
              {CANDIDATES.map((b, i) => (
                <BeadView key={i} bead={b} size={i === 3 ? 20 : 26} glossy />
              ))}
            </View>
          </View>
          <Text style={styles.headline}>Shape its bead</Text>
          <Text style={styles.body}>
            Pick a shape, a color, a pattern,{'\n'}a glyph. The bead keeps the
            feeling.{'\n'}You decide what it means.
          </Text>
        </View>

        {/* 3 · A few times a day */}
        <View style={[styles.slide, { width }]}>
          <Text style={styles.eystep}>{stepLabel(3)}</Text>
          <View style={[styles.art, { gap: 12 }]}>
            {[BEAD_IDEA, BEAD_MOM, BEAD_MEET].map((b, i) => (
              <View key={i} style={styles.card}>
                <BeadView bead={b} size={34} glossy />
                <View style={styles.cardText}>
                  <Text style={styles.cardTitle}>
                    {i === 0 ? 'An idea' : i === 1 ? 'Mom' : 'Meeting someone'}
                  </Text>
                  <Text style={styles.cardSnippet}>{NOTES[i]}</Text>
                </View>
              </View>
            ))}
          </View>
          <Text style={styles.headline}>A few times a day</Text>
          <Text style={styles.body}>Each note gets its own bead.</Text>
        </View>

        {/* 4 · Your day threads itself */}
        <View style={[styles.slide, { width }]}>
          <Text style={styles.eystep}>{stepLabel(4)}</Text>
          <View style={styles.art}>
            <Text style={styles.pendant}>{todayPendant()}</Text>
            <View style={styles.stage}>
              <Animated.View
                style={[styles.chainColumn, chainShiftStyle]}
                onLayout={(e) => setChainHeight(e.nativeEvent.layout.height)}
              >
                {DAY_CHAIN.map((b, i) => (
                  <React.Fragment key={i}>
                    <Animated.View
                      style={fadeDrop(chainAnims[i * 2])}
                      onLayout={onBeadLayout(i)}
                    >
                      <BeadView bead={b} size={i === 0 ? 44 : 40} glossy />
                    </Animated.View>
                    {i < DAY_CHAIN.length - 1 ? (
                      <Animated.View
                        style={[styles.link, fadeDrop(chainAnims[i * 2 + 1])]}
                      />
                    ) : null}
                  </React.Fragment>
                ))}
                <Animated.View style={[styles.joint, fadeDrop(chainAnims[5])]} />
              </Animated.View>
              {NOTES.map((text, i) => (
                <Animated.View
                  key={i}
                  onLayout={onNoteLayout(i)}
                  style={[
                    styles.walkNote,
                    {
                      top:
                        beadCenters[i] * SHIFT_SCALE - (noteHeights[i] || 0) / 2,
                      opacity: noteAnims[i],
                      transform: [
                        {
                          translateX: noteAnims[i].interpolate({
                            inputRange: [0, 1],
                            outputRange: [10, 0],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <Text style={styles.walkNoteText}>{text}</Text>
                </Animated.View>
              ))}
            </View>
          </View>
          <Text style={styles.headline}>Your day threads itself</Text>
          <Text style={styles.body}>
            Vakana strings today’s beads into{'\n'}a chain. Walk the chain. Each
            bead{'\n'}opens its note again.
          </Text>
        </View>

        {/* 5 · Or string your own */}
        <View style={[styles.slide, { width }]}>
          <Text style={styles.eystep}>{stepLabel(5)}</Text>
          <View style={styles.art}>
            <Animated.Text style={[styles.threadName, { opacity: tnameAnim }]}>
              My awesome project X
            </Animated.Text>
            <View style={styles.ownRow}>
              {OWN_THREAD.map((b, i) => (
                <React.Fragment key={i}>
                  {i > 0 ? (
                    <Animated.View
                      style={[styles.ownLink, { opacity: ownAnims[i * 2 - 1] }]}
                    />
                  ) : null}
                  {/* Opacity only: a translate/scale animation here would
                      stomp the lozenge's own 45° rotation. */}
                  <Animated.View style={{ opacity: ownAnims[i * 2] }}>
                    <BeadView bead={b} size={28} glossy />
                  </Animated.View>
                </React.Fragment>
              ))}
            </View>
          </View>
          <Text style={styles.headline}>Or string your own</Text>
          <Text style={styles.body}>
            Days thread themselves. You can{'\n'}also string your own
            thread.{'\n'}A story, a project, a habit.
          </Text>
          <TouchableOpacity
            style={styles.begin}
            onPress={finish}
            accessibilityRole="button"
            accessibilityLabel="Begin"
          >
            <Text style={styles.beginText}>Begin</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <TouchableOpacity
        style={[styles.skip, { top: insets.top + 10 }]}
        onPress={() => (page === SLIDE_COUNT - 1 ? finish() : goTo(SLIDE_COUNT - 1))}
        accessibilityRole="button"
        accessibilityLabel="Skip intro"
      >
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      <View style={[styles.dots, { bottom: Math.max(insets.bottom, 14) + 8 }]}>
        {Array.from({ length: SLIDE_COUNT }, (_, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => goTo(i)}
            accessibilityRole="button"
            accessibilityLabel={`Slide ${i + 1}`}
            style={[styles.dot, i === page && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    slide: {
      flex: 1,
      paddingHorizontal: 28,
      paddingTop: 46,
      paddingBottom: 78,
    },
    art: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 0,
    },
    eystep: {
      alignSelf: 'center',
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.8,
      color: colors.textFaint,
      marginBottom: 8,
    },
    headline: {
      fontFamily: 'Caveat_400Regular',
      fontSize: 34,
      lineHeight: 38,
      textAlign: 'center',
      color: colors.primary,
      marginBottom: 4,
    },
    body: {
      fontFamily: 'Caveat_400Regular',
      fontSize: 21,
      lineHeight: 26,
      textAlign: 'center',
      color: colors.textMuted,
    },
    logo: {
      width: 200,
      height: 200,
      marginVertical: 12,
    },
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 14,
      width: 236,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
    },
    cardText: { flex: 1 },
    cardTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    cardSnippet: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
      lineHeight: 16,
    },
    beadLabel: {
      fontFamily: 'Caveat_400Regular',
      fontSize: 21,
      color: colors.primary,
      marginTop: 10,
    },
    candRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 20,
      opacity: 0.5,
    },
    pendant: {
      fontFamily: 'Caveat_400Regular',
      fontSize: 24,
      color: colors.primary,
      textAlign: 'center',
      marginBottom: 10,
    },
    stage: {
      alignSelf: 'stretch',
      height: 236,
    },
    chainColumn: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      alignItems: 'center',
    },
    link: {
      width: 2.5,
      height: 22,
      backgroundColor: GOLD,
    },
    joint: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: GOLD,
      marginTop: 2,
    },
    walkNote: {
      position: 'absolute',
      left: '50%',
      marginLeft: -24,
      width: 150,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
    },
    walkNoteText: {
      fontSize: 11.5,
      lineHeight: 15,
      color: colors.textMuted,
    },
    threadName: {
      fontFamily: 'Caveat_400Regular',
      fontSize: 25,
      color: colors.primary,
      marginBottom: 18,
    },
    ownRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    ownLink: {
      width: 13,
      height: 2.5,
      backgroundColor: GOLD,
    },
    begin: {
      alignSelf: 'center',
      marginTop: 14,
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 34,
    },
    beginText: {
      fontFamily: 'Caveat_400Regular',
      fontSize: 22,
      color: colors.primaryOnPrimary,
    },
    skip: {
      position: 'absolute',
      right: 18,
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    skipText: {
      fontFamily: 'Caveat_400Regular',
      fontSize: 19,
      color: colors.primary,
    },
    dots: {
      position: 'absolute',
      left: 0,
      right: 0,
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.border,
    },
    dotActive: {
      width: 20,
      backgroundColor: colors.primary,
    },
  });
