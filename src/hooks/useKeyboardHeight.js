import { useEffect, useRef, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform } from 'react-native';
import { KeyboardEvents } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Tracks the on-screen keyboard height in pixels (0 when dismissed).
//
// Why we need this: a Modal-based bottom sheet sits at the bottom of the
// screen (backdrop `justifyContent: 'flex-end'`). The Modal does not
// automatically clear the keyboard, so callers add the returned value as
// `paddingBottom` on the backdrop (or `marginBottom` on the sheet) to
// shift the sheet up clear of the keyboard.
//
// Android edge-to-edge nuance: AndroidManifest.xml declares
// `windowSoftInputMode="adjustResize"`, which would normally resize the
// window when the IME shows. But the app runs with `edgeToEdgeEnabled:
// true` (app.json), which calls `setDecorFitsSystemWindows(false)`; on
// Android 11+ that lets the decor view extend behind the IME, so
// `adjustResize` becomes effectively a no-op for keyboard insets and
// content gets covered. Manual padding is the only way to keep the
// composer above the keyboard. Pre-v0.10.0 the hook tracked on Android
// (which caused 2× padding when `adjustResize` was still effective);
// v0.10.0 returned 0 on Android (correct under non-edge-to-edge); v0.13.1
// restores Android tracking now that edge-to-edge has nullified the auto
// resize. Don't re-add the Android short-circuit without also disabling
// edge-to-edge: they're a pair.
//
// This hook returns the raw platform-reported height. Almost every caller
// wants `useKeyboardInset()` below instead. See the nav-bar note there.
export default function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  // Mirrors `height` so `apply` can short-circuit an unchanged value without
  // reading state through a setState updater. See the note in `apply`.
  const heightRef = useRef(0);

  useEffect(() => {
    // iOS exposes Will* events that fire before the animation for smoother
    // tracking; Android only emits the Did* variants.
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    // Android only ever emits Did*: ReactRootView.checkForKeyboardEvents
    // sends exactly `keyboardDidShow` / `keyboardDidHide` and no
    // `keyboardDidChangeFrame`, so there is nothing earlier to listen to.
    // The resulting lag (padding lands after the IME animation finishes, so
    // the composer is briefly buried, then jumps) is inherent to the pure-JS
    // mechanism. `LayoutAnimation.configureNext` below turns that jump into
    // motion on iOS; on Android old-arch it is a documented no-op unless
    // `UIManager.setLayoutAnimationEnabledExperimental(true)` is called, and
    // we deliberately do NOT flip that global: it would change every list
    // and sheet transition in the app. Removing the lag properly needs
    // native IME-progress callbacks (react-native-keyboard-controller),
    // deferred until after on-device testing.
    //
    // `configureNext` is a side effect, so it must NOT live inside a setState
    // updater (React may invoke an updater more than once, and updaters are
    // required to be pure). We compare against a ref instead and schedule the
    // animation just before the setState call.
    const apply = (next) => {
      if (heightRef.current === next) return;
      heightRef.current = next;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setHeight(next);
    };

    const showSub = Keyboard.addListener(showEvent, (e) => {
      apply(e?.endCoordinates?.height || 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => apply(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}

// Android 11+ (API 30) reports the keyboard height with the navigation-bar
// inset ALREADY SUBTRACTED. From ReactRootView.checkForKeyboardEvents:
//
//     int height = imeInsets.bottom - barInsets.bottom;
//
// Under edge-to-edge our windows extend behind that navigation bar, and
// that includes Modal windows, because RN forces every dialog window
// edge-to-edge when the feature flag is on (ReactModalHostView:
// `navigationBarTranslucent get() = field || isEdgeToEdgeFeatureFlagOn`).
// So the IME actually covers `reported height + navigation-bar inset` of
// our layout, and padding by the raw value leaves the bottom-most row
// (the comments composer, the import sheet's URL field) sitting that many
// pixels under the keyboard. That undershoot is the bug this helper fixes.
//
// iOS needs no correction: its keyboard frame already spans to the bottom
// of the screen, home indicator included.
//
// Pre-API-30 Android takes `checkForKeyboardEventsLegacy`, which derives
// the height from the visible display frame and does not subtract the bar,
// so the version gate mirrors the RN branch exactly.
const REPORTS_HEIGHT_MINUS_NAV_BAR =
  Platform.OS === 'android' && Platform.Version >= 30;

// How much of our layout the on-screen keyboard actually covers, in px
// (0 when dismissed). Use this, not the raw hook, for `paddingBottom` on
// a sheet backdrop or for "how much room is left" scroll math.
export function useKeyboardInset() {
  const height = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  if (height <= 0) return 0;
  return REPORTS_HEIGHT_MINUS_NAV_BAR ? height + insets.bottom : height;
}

// Distance from the bottom of the (edge-to-edge, full-screen) window to the
// IME's top edge; 0 when hidden. For pinning a view flush against the
// keyboard (the editor's undo bar).
//
// This is the one keyboard measurement sourced from
// react-native-keyboard-controller (native WindowInsetsAnimation
// callbacks), NOT from RN's Keyboard events, and the distinction is
// load-bearing. Under edge-to-edge, RN's `keyboardDidShow` is
// structurally unreliable: it only re-checks on layout passes (which the
// IME no longer triggers, since the window doesn't resize), its height
// has the nav bar pre-subtracted against a value that can disagree with
// safe-area's, and its `screenY` is synthesized from that same height
// plus a cached visible-frame rather than measured. Instrumented on the
// maker's Redmi (HyperOS, Android 16): window manager said the IME
// covered 985 px while RN reported 1027 px: wrong before any correction,
// and no JS-side formula could reconstruct the truth in both navigation
// modes. Sheets keep `useKeyboardInset` (their padding tolerates
// overshoot and is device-verified); a *pinned* bar shows every error
// pixel as a gap, so it gets the exact native number.
//
// Requires <KeyboardProvider> at the app root (App.js). Values are dp,
// full IME overlap including the nav-bar region. Did* listeners are also
// registered: on Android the IME can resize in place (Gboard growing or
// dropping its suggestion strip) without a fresh Will* pair.
// Dismiss the keyboard, then run `fn` once the IME has actually left the
// screen, never in the same frame the hide begins.
//
// Why this exists (v0.88.4, device-verified on the maker's Redmi/HyperOS):
// an Android `Modal` whose dialog is created while the IME hide animation
// is still in flight can be laid out against transient garbage window
// insets. RN wraps every Modal's content in a `fitsSystemWindows`
// FrameLayout (unless the Modal passes `statusBarTranslucent`); mid-hide
// that wrapper received a *negative* bottom inset, its child came out
// taller than the screen (2772 px screen → 5539 px root), RN fed that
// height to Yoga as the modal's size, and a bottom sheet (`flex-end`)
// landed entirely below the visible screen: present, focused, invisible.
// Sequencing dialog creation after `keyboardDidHide` keeps the two
// animations from overlapping. Pair it with `statusBarTranslucent` on the
// Modal for defence in depth (that removes the inset-padding wrapper).
//
// The RNKC event is the primary signal; the timeout is a fallback only,
// sized past any IME hide animation so a late event can't re-open the
// race. `keyboardUp=false` short-circuits when nothing is showing (no
// hide event would ever arrive). Returns a cancel function. Call it from
// the owner's unmount cleanup so `fn` never fires on a dead screen.
export function dismissKeyboardThen(
  fn,
  { keyboardUp = true, timeoutMs = 600 } = {}
) {
  if (!keyboardUp) {
    Keyboard.dismiss();
    fn();
    return () => {};
  }
  let settled = false;
  let sub = null;
  let timer = null;
  const finish = () => {
    if (settled) return;
    settled = true;
    sub?.remove();
    clearTimeout(timer);
    fn();
  };
  sub = KeyboardEvents.addListener('keyboardDidHide', finish);
  timer = setTimeout(finish, timeoutMs);
  Keyboard.dismiss();
  return () => {
    settled = true;
    sub?.remove();
    clearTimeout(timer);
  };
}

export function useKeyboardBottomOffset() {
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef(0);

  useEffect(() => {
    // Same ref-compare + LayoutAnimation pattern as useKeyboardHeight.
    // See the notes there on updater purity.
    const apply = (next) => {
      if (offsetRef.current === next) return;
      offsetRef.current = next;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setOffset(next);
    };

    const subs = [
      KeyboardEvents.addListener('keyboardWillShow', (e) =>
        apply(e?.height || 0)
      ),
      KeyboardEvents.addListener('keyboardDidShow', (e) =>
        apply(e?.height || 0)
      ),
      KeyboardEvents.addListener('keyboardWillHide', () => apply(0)),
      KeyboardEvents.addListener('keyboardDidHide', () => apply(0)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  return offset;
}
