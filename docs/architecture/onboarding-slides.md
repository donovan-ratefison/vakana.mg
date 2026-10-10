# Onboarding slides (v0.78.0)

The app shows six intro slides at first launch. The slides answer the question
*"c'est quoi?"* before the app asks the user for input. This doc is the
as-built contract.

## The two render paths

`src/screens/OnboardingScreen.js` renders in two contexts. The `onDone` prop
tells the two contexts apart.

- **First launch**: `App.js` renders the screen standalone, **before
  `LockScreen`**, with `onDone` set. The user finishes with Begin, or with Skip
  from the last slide. This writes the seen-marker, and then the PIN gate
  shows. The order is important. Field feedback showed that a new user leaves
  by the third tap if the app asks for a PIN before it explains what it is.
- **Replay**: `Settings → Pro Tips → Watch the intro again` navigates to the
  `Onboarding` stack route (no `onDone`). When the user finishes, the route
  pops. The replay does not change the marker. Thus the replay always works,
  and it never starts the first-launch behavior again.

## The seen-marker

The marker is `vakana_onboarding_seen` in `expo-secure-store`, through
`preferences.js:getOnboardingSeen/setOnboardingSeen`. The marker is
**app-level, not per-vault**, for the same reason as auto-lock: the slides
explain the app, and the app does not change when the vault changes.

`AppShell` loads the marker one time on mount into `showOnboarding` (`null`
during the read). The splash-hide effect waits for the marker, for DB init and
for theme hydration. Thus the first visible frame is the correct one (slides
or lock screen), and the wrong gate never shows for a moment.

An existing install that upgrades to 0.78.0 has no marker, so it shows the
slides one time. This is intentional, because the field testers have these
installs.

## The slides

0. **Welcome**: "Welcome to" above the splash logo, then "The Malagasy
   Knowledge Management System, on your phone." The logo contains the
   Vakana.mg wordmark. Do not repeat the wordmark in text.
1. **Take a note**: one entry card.
2. **Shape its bead**: a glossy hero bead, an example label in quotes, and a
   candidate row. The copy ends with "You decide what it means". The
   bead-meaning rule (mechanics, never meaning) applies here too. Example
   labels are quoted *personal* encodings, never a taxonomy.
3. **A few times a day**: three entry cards with their beads.
4. **Your day threads itself**: the result of the previous steps. The slide
   shows the real date of today (Caveat, fixed and centered). The day chain
   appears bead by bead on the golden thread. Then the chain moves left at
   0.86 scale. Then each note shows beside its bead, one at a time. The last
   note stays.
5. **Or string your own**: a horizontal thread that the user strings by hand
   ("My awesome project X"), and the Begin button.

The slides are in a paged `ScrollView` that the user swipes. A tap on a dot
goes to that slide. Skip (top right) goes to the last slide. On the last
slide, Skip finishes.

## Visual contract (the maker's blend, do not drift)

- The app palette and the card chrome come from `useTheme()` tokens. The
  slides adapt to the theme and the palette as every screen does.
- Beads are real `BeadView`s with `glossy` forced. Emoji glyphs are permitted.
  The trophy is on **charcoal**, because a gold emoji is not visible on ember.
  The handshake is on **forest**, because it is also not visible on ember.
- Caveat (`Caveat_400Regular`) is the font of the slide chrome: headlines,
  body copy, bead label, date, thread name, Skip/Begin. **Note cards use the
  real note face of the app** (system font, EntryCard sizing). Thus the slides
  show exactly what the user sees one tap later.
- Step markers are uppercase `STEP N · 5` eyebrows in the sans face. The
  hand-circled numbers were rejected.
- Copy: no em dashes. Write short, active lines with one instruction in each
  sentence.

## Animation gotchas (both were real bugs in the prototype)

- **Do not hardcode the walk-note positions.** Measure the bead centers with
  `onLayout`, and multiply them by the same 0.86 that scales the chain. RN
  transforms have no transform-origin. To anchor the scale at the top,
  compensate `translateY` with `-(chainHeight × 0.14) / 2`.
- **Do not run a translate or scale animation directly on the lozenge bead.**
  An animation that ends at an identity transform overwrites the 45° rotation
  of the bead and leaves the glyph tilted. Animate a wrapper `Animated.View`.
  Animate only the opacity where the child has its own transform.

Slide animations run from a `useEffect` keyed on the current page. When the
page changes, the effect stops and resets the animations. Thus the animation
plays again correctly when the user returns to a slide.
