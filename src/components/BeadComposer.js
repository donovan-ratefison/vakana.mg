import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Pressable,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BeadView from './BeadView';
import {
  ACTION_TYPES,
  SHAPE_GEOMETRY,
  PATTERNS,
  MOODS,
  DEFAULT_BEAD,
} from '../beads/types';
import {
  listBeadPresets,
  createBeadPreset,
  deleteBeadPreset,
  touchBeadPreset,
  countEntriesWithBead,
  reshapeBeadAcrossHistory,
} from '../services/beadPresets';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';
import { hapticPlace } from '../utils/haptics';
import { useTheme } from '../theme';

// Shapes carry NO prescribed meaning: Vakana is a personal encoding
// system, not a fixed taxonomy. We don't render "Task / Encounter / …";
// the user decides what a circle means to them. Screen readers still
// need a distinguishable announcement, so we expose the *geometry*
// (neutral, descriptive) via the shared `SHAPE_GEOMETRY` map rather
// than the old semantic labels on ACTION_TYPES.

// Past this many saved beads the wrapped chip grid stops being faster to
// scan than a search box (the UI-minimalism rule: no chrome for marginal
// value, and a handful of chips needs no filter). Lowered from 8 in v0.80.0:
// the grid is now height-capped, so the search box needs to appear
// *before* the cap starts hiding rows, not after.
const SEARCH_THRESHOLD = 5;

// Height cap on the saved-bead grid. Without it the wrapped grid grows
// without bound and pushes `Compose new` (and the footer) off the bottom
// of the sheet. The whole sheet is one ScrollView, so a long preset
// vocabulary buries the composer. Roughly four rows of chips; past that
// the grid scrolls in place and the controls below stay reachable.
const PRESET_GRID_MAX_HEIGHT = 184;

// Normalise a bead tuple the way readBead() does, so identity comparisons
// (current entry vs the bead being reshaped) don't trip on null↔default.
function sameBead(a, b) {
  if (!a || !b) return false;
  return (
    a.shape === b.shape &&
    (a.pattern || 'solid') === (b.pattern || 'solid') &&
    (a.mood || 'slate') === (b.mood || 'slate') &&
    (a.glyph || '') === (b.glyph || '')
  );
}

export default function BeadComposer({
  visible,
  initial,
  defaultGlyph = '',
  onSave,
  onRemove,
  onCancel,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Keeps Remove/Done above a 3-button Android nav bar (edge-to-edge modal).
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();

  const [shape, setShape] = useState(DEFAULT_BEAD.shape);
  const [pattern, setPattern] = useState(DEFAULT_BEAD.pattern);
  const [mood, setMood] = useState(DEFAULT_BEAD.mood);
  const [glyph, setGlyph] = useState('');

  // Saved beads (named presets). The list refreshes each time the sheet
  // opens so recency order settles without re-sorting under the user's
  // finger mid-session.
  const [presets, setPresets] = useState([]);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetQuery, setPresetQuery] = useState('');

  // The sheet has three faces, not three components: Pick (saved beads
  // are the body; this is the collapsed default), Compose (the four facet
  // pickers, opt-in via the `Compose new` accordion), and Reshape (a
  // global query-replace over one saved bead). `composing` expands the
  // Compose accordion in place; `reshapeTarget` is non-null only in
  // Reshape mode and hides Pick entirely.
  const [composing, setComposing] = useState(false);
  const [reshapeTarget, setReshapeTarget] = useState(null);
  const [reshapeName, setReshapeName] = useState('');
  // True once the user has picked a saved bead this session (or an
  // existing bead was passed in). Gates the preview + the Pick footer so
  // collapsed Pick isn't blind, without fabricating a phantom default
  // bead when nothing is chosen yet.
  const [hasPicked, setHasPicked] = useState(false);

  // Suppresses the auto-save that would otherwise fire from the four state
  // setters used to populate the form when the sheet first opens.
  const justOpenedRef = useRef(false);
  // Reshape mode edits a *saved bead globally*, not this entry's bead. So
  // the live-commit must be hard-gated while it's active (read from a ref
  // so the effect's deps don't grow). Set synchronously before the setters
  // that load the preset into the form.
  const reshapeRef = useRef(false);
  // Captures the latest onSave / initial / defaultGlyph so the open-reset
  // effect can key on `visible` alone (it must NOT re-run when our own
  // live-commit echoes a new `initial` back mid-session: that re-fired
  // the reset and thrashed UI state).
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const defaultGlyphRef = useRef(defaultGlyph);
  defaultGlyphRef.current = defaultGlyph;

  const loadPresets = async () => {
    try {
      setPresets(await listBeadPresets());
    } catch {
      // Presets are a convenience layer: never block bead composing.
      // With zero presets `showCompose` falls back to the composer, so
      // there's nothing to decide here.
    }
  };

  // Reset local form to `initial` (or defaults) every time the sheet opens,
  // so reopening after a cancelled edit doesn't keep stale picks. Reshape
  // is entered via long-press while the sheet is already open, so this
  // effect never runs mid-reshape. But clearing it here guarantees a
  // clean slate on the next open.
  //
  // Glyph behavior: for an existing bead, mirror whatever it currently has
  // (including empty: the user may have chosen no glyph). For a new bead,
  // pre-fill with `defaultGlyph` so the suggested initial is visible and
  // CLEARABLE. Saving the field empty must persist as empty, not silently
  // fall back to the suggestion.
  useEffect(() => {
    if (!visible) return;
    const initialBead = initialRef.current;
    justOpenedRef.current = true;
    const base = initialBead || DEFAULT_BEAD;
    setShape(base.shape || DEFAULT_BEAD.shape);
    setPattern(base.pattern || DEFAULT_BEAD.pattern);
    setMood(base.mood || DEFAULT_BEAD.mood);
    setGlyph(initialBead ? initialBead.glyph || '' : defaultGlyphRef.current || '');
    reshapeRef.current = false;
    setReshapeTarget(null);
    setReshapeName('');
    setSavingPreset(false);
    setPresetName('');
    setPresetQuery('');
    // Always land collapsed (Pick). The composer is opt-in via `Compose
    // new`; with zero presets `showCompose` reveals it anyway. Editing an
    // existing bead no longer auto-expands. The preview + selected chip
    // show what's set, and you open the composer only to tweak.
    setComposing(false);
    setHasPicked(Boolean(initialBead));
    loadPresets();
  }, [visible]);

  // Live-commit on every attribute change. The parent's auto-save then
  // debounces and persists. Skip the very first run after the sheet opens
  // (state was just set from `initial`) and stay fully silent in Reshape
  // mode (those edits target a saved bead, not this entry).
  useEffect(() => {
    if (!visible) return;
    if (justOpenedRef.current) {
      justOpenedRef.current = false;
      return;
    }
    if (reshapeRef.current) return;
    if (!shape) return;
    onSaveRef.current({ shape, pattern, mood, glyph });
  }, [shape, pattern, mood, glyph, visible]);

  // Pre-fills, never stamps (S14's original load-bearing rule, retained).
  // Tapping a saved bead loads its four facets into the composer and
  // reveals it so the user can tweak before committing. It never closes
  // the sheet under them. Routing through the four setters lets the
  // existing live-commit effect persist it a beat later (the app has no
  // manual Save anywhere: everything is autosave + a manual *Done* that
  // only closes); the sheet deliberately stays open.
  const pickPreset = (p) => {
    setHasPicked(true);
    setShape(p.shape || DEFAULT_BEAD.shape);
    setPattern(p.pattern || DEFAULT_BEAD.pattern);
    setMood(p.mood || DEFAULT_BEAD.mood);
    setGlyph(p.glyph || '');
    touchBeadPreset(p.id); // fire-and-forget; reorders on next open
    // Stays collapsed on purpose: the live-commit effect persists it, the
    // preview + selected chip confirm it, and *Done* closes. Expand only
    // to tweak.
  };

  const handleSavePreset = async () => {
    const name = presetName.trim();
    if (!name || !shape) return;
    await createBeadPreset({ name, shape, pattern, mood, glyph });
    setPresetName('');
    setSavingPreset(false);
    loadPresets();
  };

  // Long-press a chip → the saved-bead actions. Reshape and Delete both
  // hang off the existing long-press affordance: no new per-chip chrome.
  const openPresetMenu = (p) => {
    Alert.alert(p.name, undefined, [
      {
        text: 'Reshape across history…',
        onPress: () => enterReshape(p),
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => confirmDeletePreset(p),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const confirmDeletePreset = (p) => {
    Alert.alert('Delete saved bead', `Remove "${p.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteBeadPreset(p.id);
          loadPresets();
        },
      },
    ]);
  };

  const enterReshape = (p) => {
    // Gate the live-save BEFORE the setters fire (the effect runs after
    // this render; reshapeRef must already be true by then).
    reshapeRef.current = true;
    setReshapeTarget({
      presetId: p.id,
      name: p.name,
      from: {
        shape: p.shape,
        pattern: p.pattern || 'solid',
        mood: p.mood || 'slate',
        glyph: p.glyph || '',
      },
    });
    setReshapeName(p.name);
    setShape(p.shape || DEFAULT_BEAD.shape);
    setPattern(p.pattern || DEFAULT_BEAD.pattern);
    setMood(p.mood || DEFAULT_BEAD.mood);
    setGlyph(p.glyph || '');
  };

  const runReshape = async (rewritePast) => {
    const target = reshapeTarget;
    if (!target) return;
    const to = { shape, pattern, mood, glyph };
    await reshapeBeadAcrossHistory({
      presetId: target.presetId,
      name: reshapeName,
      from: target.from,
      to,
      rewritePast,
    });
    // If the entry whose bead we're editing happens to be one of the rows
    // we just rewrote, its in-memory bead is now stale and the editor's
    // next autosave would write the old tuple back. Adopt the new one.
    if (rewritePast && sameBead(initialRef.current, target.from)) {
      onSaveRef.current(to);
    }
    reshapeRef.current = false;
    setReshapeTarget(null);
    onCancel?.();
  };

  const handleReshapePress = async () => {
    if (!reshapeTarget || !shape) return;
    const count = await countEntriesWithBead(reshapeTarget.from);
    const label = reshapeTarget.name;
    if (count > 0) {
      Alert.alert(
        `Reshape “${label}”`,
        `This bead is on ${count} past entr${
          count === 1 ? 'y' : 'ies'
        }. You cannot undo this change.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Future use only', onPress: () => runReshape(false) },
          {
            text: `Also rewrite ${count}`,
            style: 'destructive',
            onPress: () => runReshape(true),
          },
        ]
      );
    } else {
      Alert.alert(
        `Reshape “${label}”`,
        'No past entries use this bead. Only future use changes.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Reshape', onPress: () => runReshape(false) },
        ]
      );
    }
  };

  const previewBead = { shape, pattern, mood, glyph };
  const canSave = Boolean(shape);
  const inReshape = Boolean(reshapeTarget);
  // With zero presets there is nothing to pick, so the composer is the
  // only thing the sheet can show. Never let Pick collapse to an empty
  // sheet (e.g. after deleting the last saved bead while not composing).
  const showCompose = composing || presets.length === 0;
  // Something is actually selected (existing bead, or picked this
  // session): show the preview and the collapsed-Pick footer only then,
  // so a fresh entry with nothing chosen doesn't read as already-beaded.
  const hasSelection = Boolean(initial) || hasPicked;
  const reshapeDirty =
    inReshape &&
    (!sameBead(previewBead, reshapeTarget.from) ||
      reshapeName.trim() !== reshapeTarget.name);

  const q = presetQuery.trim().toLowerCase();
  const filteredPresets = q
    ? presets.filter((p) => (p.name || '').toLowerCase().includes(q))
    : presets;

  const handleDone = () => {
    if (!canSave) return;
    hapticPlace(); // the bead settling onto the cord
    // Don't .slice(): code-unit slicing corrupts multi-codepoint emoji (ZWJ sequences).
    // The TextInput's maxLength already caps the input. The bead is already
    // committed live; this just closes the sheet.
    onSaveRef.current({ shape, pattern, mood, glyph });
    onCancel?.();
  };

  // Facet pickers (shared by Compose and Reshape).
  const renderFacets = () => (
    <>
      <Text style={styles.sectionLabel}>Shape</Text>
      <View style={styles.typeRow}>
        {ACTION_TYPES.map((t) => {
          const selected = t.shape === shape;
          return (
            <TouchableOpacity
              key={t.shape}
              onPress={() => setShape(t.shape)}
              style={[styles.typeButton, selected && styles.typeButtonSelected]}
              accessibilityLabel={SHAPE_GEOMETRY[t.shape] || t.shape}
            >
              <BeadView
                bead={{ shape: t.shape, pattern: 'solid', mood, glyph: '' }}
                size={28}
              />
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>Pattern</Text>
      <View style={styles.patternRow}>
        {PATTERNS.map((p) => {
          const selected = p.key === pattern;
          return (
            <TouchableOpacity
              key={p.key}
              onPress={() => setPattern(p.key)}
              style={[styles.swatch, selected && styles.swatchSelected]}
              accessibilityLabel={p.label}
            >
              <BeadView
                bead={{ shape: 'square', pattern: p.key, mood, glyph: '' }}
                size={28}
              />
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>Mood</Text>
      <View style={styles.moodRow}>
        {MOODS.map((m) => {
          const selected = m.key === mood;
          return (
            <TouchableOpacity
              key={m.key}
              onPress={() => setMood(m.key)}
              style={[
                styles.moodDot,
                { backgroundColor: m.color },
                selected && styles.moodDotSelected,
              ]}
              accessibilityLabel={m.label}
            />
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>Glyph</Text>
      <View style={styles.glyphRow}>
        <TextInput
          style={styles.glyphInput}
          value={glyph}
          onChangeText={setGlyph}
          placeholder={defaultGlyph || 'Aa'}
          placeholderTextColor={colors.textFaint}
          maxLength={8}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {glyph.length > 0 ? (
          <TouchableOpacity
            onPress={() => setGlyph('')}
            style={styles.glyphClear}
            hitSlop={8}
            accessibilityLabel="Clear glyph"
          >
            <Ionicons name="close-circle" size={18} color={colors.textFaint} />
          </TouchableOpacity>
        ) : null}
      </View>
    </>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View
        style={[styles.backdrop, keyboardInset > 0 && { paddingBottom: keyboardInset }]}
      >
        {/* Tap-to-dismiss lives ONLY in the dim strip above the sheet.
            Wrapping the ScrollView in a Pressable (the old pattern) made
            the Pressable claim the touch responder, so the ScrollView
            could only steal the pan from a descendant button, not from
            empty space. A sibling dismiss area + a plain View sheet keeps
            tap-outside-to-close while letting the scroll work anywhere. */}
        <Pressable
          style={styles.backdropDismiss}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View style={styles.sheet}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.sheetContent,
              { paddingBottom: 32 + insets.bottom },
            ]}
          >
            {inReshape ? (
              /* ---------- Reshape: a global query-replace on one bead ---------- */
              <>
                <Text style={styles.reshapeTitle}>Reshape a saved bead</Text>
                <Text style={styles.reshapeHint}>
                  {`This changes the look of "${reshapeTarget.name}" in each place where you use it. You then select if past entries change too.`}
                </Text>

                <View style={styles.previewWrap}>
                  <BeadView bead={previewBead} size={64} />
                </View>

                <Text style={styles.sectionLabel}>Name</Text>
                <TextInput
                  style={styles.reshapeNameInput}
                  value={reshapeName}
                  onChangeText={setReshapeName}
                  placeholder="Name this bead"
                  placeholderTextColor={colors.textFaint}
                  maxLength={40}
                />

                {renderFacets()}

                <View style={styles.footer}>
                  <TouchableOpacity onPress={onCancel} style={styles.btnGhost}>
                    <Text style={styles.btnGhostText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleReshapePress}
                    disabled={!canSave || !reshapeDirty}
                    style={[
                      styles.btnPrimary,
                      (!canSave || !reshapeDirty) && styles.btnPrimaryDisabled,
                    ]}
                  >
                    <Text style={styles.btnPrimaryText}>
                      Reshape across history…
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              /* ---------- Pick (body) + Compose (accordion) ---------- */
              <>
                {showCompose || hasSelection ? (
                  <View style={styles.previewWrap}>
                    <BeadView bead={previewBead} size={64} />
                  </View>
                ) : null}

                {presets.length > 0 ? (
                  <>
                    <Text style={styles.sectionLabel}>Saved beads</Text>
                    {presets.length > SEARCH_THRESHOLD ? (
                      <View style={styles.searchContainer}>
                        <Ionicons
                          name="search"
                          size={18}
                          color={colors.textMuted}
                          style={styles.searchIcon}
                        />
                        <TextInput
                          style={styles.searchInput}
                          placeholder="Search saved beads…"
                          placeholderTextColor={colors.placeholder}
                          value={presetQuery}
                          onChangeText={setPresetQuery}
                          autoCorrect={false}
                          autoCapitalize="none"
                        />
                        {presetQuery ? (
                          <TouchableOpacity
                            onPress={() => setPresetQuery('')}
                            style={styles.searchClear}
                            hitSlop={8}
                            accessibilityLabel="Clear search"
                          >
                            <Ionicons
                              name="close"
                              size={18}
                              color={colors.textMuted}
                            />
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : null}

                    {filteredPresets.length > 0 ? (
                      /* Nested vertical scroll inside the sheet's own
                         ScrollView. `nestedScrollEnabled` is what makes
                         Android hand the pan to the inner view; the cap
                         keeps `Compose new` and the footer on screen no
                         matter how large the preset vocabulary gets.
                         Below the cap the ScrollView just wraps the grid
                         at its natural height and never scrolls. */
                      <ScrollView
                        style={styles.presetGridScroll}
                        contentContainerStyle={styles.presetGrid}
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator
                      >
                        {filteredPresets.map((p) => {
                          const selected =
                            hasSelection && sameBead(p, previewBead);
                          return (
                          <TouchableOpacity
                            key={p.id}
                            style={[
                              styles.presetChip,
                              selected && styles.presetChipSelected,
                            ]}
                            onPress={() => pickPreset(p)}
                            onLongPress={() => openPresetMenu(p)}
                            delayLongPress={400}
                            accessibilityLabel={`Apply saved bead ${p.name}${
                              selected ? ' (currently selected)' : ''
                            }. Long-press to reshape or delete.`}
                          >
                            <BeadView
                              bead={{
                                shape: p.shape,
                                pattern: p.pattern,
                                mood: p.mood,
                                glyph: p.glyph,
                              }}
                              size={26}
                            />
                            <Text style={styles.presetChipText} numberOfLines={1}>
                              {p.name}
                            </Text>
                          </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    ) : (
                      <Text style={styles.presetEmpty}>
                        No saved bead matches “{presetQuery.trim()}”.
                      </Text>
                    )}

                    <TouchableOpacity
                      style={styles.composeToggle}
                      onPress={() => setComposing((c) => !c)}
                      accessibilityLabel={
                        composing
                          ? 'Collapse the composer and go back to saved beads'
                          : 'Compose a new bead'
                      }
                    >
                      <Ionicons
                        name={composing ? 'chevron-up' : 'add'}
                        size={18}
                        color={colors.primary}
                      />
                      <Text style={styles.composeToggleText}>
                        {composing ? 'Collapse' : 'Compose new'}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : null}

                {!showCompose ? (
                  /* Collapsed Pick: Done is reachable without expanding.
                     A pick already live-committed, so Done just closes.
                     It deliberately does NOT stamp (avoids a default bead
                     on a fresh entry where nothing was chosen). */
                  <View style={styles.footer}>
                    <TouchableOpacity
                      onPress={onCancel}
                      style={styles.btnPrimary}
                    >
                      <Text style={styles.btnPrimaryText}>Done</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                {showCompose ? (
                  <>
                    {renderFacets()}

                    <View style={styles.presetSaveBlock}>
                      {savingPreset ? (
                        <View style={styles.presetNameRow}>
                          <TextInput
                            style={styles.presetNameInput}
                            value={presetName}
                            onChangeText={setPresetName}
                            placeholder="Name this bead (e.g. Morning run)"
                            placeholderTextColor={colors.textFaint}
                            maxLength={40}
                            autoFocus
                            returnKeyType="done"
                            onSubmitEditing={handleSavePreset}
                          />
                          <TouchableOpacity
                            onPress={handleSavePreset}
                            disabled={!presetName.trim()}
                            style={[
                              styles.presetNameConfirm,
                              !presetName.trim() && styles.btnPrimaryDisabled,
                            ]}
                            accessibilityLabel="Save preset"
                          >
                            <Ionicons
                              name="checkmark"
                              size={18}
                              color={colors.primaryOnPrimary}
                            />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          onPress={() => setSavingPreset(true)}
                          disabled={!canSave}
                          hitSlop={8}
                        >
                          <Text
                            style={[
                              styles.presetSaveLink,
                              !canSave && styles.presetSaveLinkDisabled,
                            ]}
                          >
                            + Save this bead
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    <View style={styles.footer}>
                      {initial ? (
                        <TouchableOpacity
                          onPress={onRemove}
                          style={styles.btnDanger}
                        >
                          <Text style={styles.btnDangerText}>Remove</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity
                        onPress={handleDone}
                        disabled={!canSave}
                        style={[
                          styles.btnPrimary,
                          !canSave && styles.btnPrimaryDisabled,
                        ]}
                      >
                        <Text style={styles.btnPrimaryText}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : null}
              </>
            )}
          </ScrollView>
        </View>
      </View>
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
    // Fills the dim space above the sheet; the only tap-to-close target,
    // and it never underlaps the sheet (sibling, not ancestor).
    backdropDismiss: {
      flex: 1,
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '90%',
      borderWidth: 1,
      borderColor: colors.border,
    },
    sheetContent: {
      padding: 20,
      paddingBottom: 32,
    },
    previewWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      minHeight: 90,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 12,
      marginBottom: 8,
    },
    // Shape buttons mirror the pattern swatches exactly (same box, gap
    // and selected ring) so the two rows read as one harmonious system
    // now that shapes carry no label.
    typeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    typeButton: {
      width: 44,
      height: 44,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    typeButtonSelected: {
      borderColor: colors.primary,
      borderWidth: 2,
    },
    patternRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    swatch: {
      width: 44,
      height: 44,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    swatchSelected: {
      borderColor: colors.primary,
      borderWidth: 2,
    },
    moodRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    moodDot: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    moodDotSelected: {
      borderColor: colors.primary,
    },
    glyphRow: {
      position: 'relative',
    },
    glyphInput: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      paddingRight: 36,
      color: colors.text,
      fontSize: 16,
    },
    glyphClear: {
      position: 'absolute',
      right: 8,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
      width: 24,
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 8,
      marginTop: 20,
    },
    btnDanger: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.dangerSoft,
    },
    btnDangerText: {
      color: colors.danger,
      fontSize: 14,
      fontWeight: '600',
    },
    btnGhost: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    btnGhostText: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '600',
    },
    btnPrimary: {
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.primary,
    },
    btnPrimaryDisabled: {
      opacity: 0.4,
    },
    btnPrimaryText: {
      color: colors.primaryOnPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    // Search bar: deliberately the same chrome as the notes/threads
    // search bars (HomeScreen `searchContainer`) so the surfaces stay
    // visually harmonised.
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: 10,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 10,
    },
    searchIcon: { marginRight: 8 },
    searchInput: {
      flex: 1,
      paddingVertical: 9,
      color: colors.text,
      fontSize: 15,
    },
    searchClear: { padding: 4 },
    // `flexGrow: 0` so the ScrollView shrink-wraps a short grid instead of
    // claiming the cap's full height when there are only a few chips.
    presetGridScroll: {
      flexGrow: 0,
      maxHeight: PRESET_GRID_MAX_HEIGHT,
    },
    presetGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      paddingBottom: 4,
    },
    presetChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      maxWidth: 180,
    },
    presetChipSelected: {
      borderColor: colors.primary,
      borderWidth: 2,
    },
    presetChipText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
      flexShrink: 1,
    },
    presetEmpty: {
      color: colors.textFaint,
      fontSize: 12,
      lineHeight: 17,
      paddingBottom: 4,
    },
    composeToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 16,
      paddingVertical: 6,
    },
    composeToggleText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '700',
    },
    presetSaveBlock: {
      marginTop: 16,
    },
    presetSaveLink: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '700',
    },
    presetSaveLinkDisabled: {
      color: colors.textFaint,
    },
    presetNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    presetNameInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 9,
      color: colors.text,
      fontSize: 14,
    },
    presetNameConfirm: {
      width: 38,
      height: 38,
      borderRadius: 8,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    // Same chrome as presetNameInput but standalone (no row), so it must
    // not carry the row's `flex: 1` (would grow vertically here).
    reshapeNameInput: {
      alignSelf: 'stretch',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 9,
      color: colors.text,
      fontSize: 14,
    },
    reshapeTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
      marginBottom: 6,
    },
    reshapeHint: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
    },
  });
