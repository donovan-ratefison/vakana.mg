import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BeadView from '../components/BeadView';
import { TEMPLATES, saveArticle, getArticleData } from '../services/threadArticles';
import { useTheme } from '../theme';

const SAVE_DEBOUNCE_MS = 800;

function formatDateShort(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyy_mm_dd);
  if (!m) return yyyy_mm_dd;
  const monthsShort = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${monthsShort[Number(m[2]) - 1] || ''} ${Number(m[3])}, ${m[1]}`;
}


export default function ThreadArticleComposerScreen({ navigation, route }) {
  const threadId = route?.params?.threadId;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [loaded, setLoaded] = useState(false);
  const [thread, setThread] = useState(null);
  const [sections, setSections] = useState([]);
  const [photoChoices, setPhotoChoices] = useState([]);

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [intro, setIntro] = useState('');
  const [template, setTemplate] = useState('editorial');
  const [coverPhotoUri, setCoverPhotoUri] = useState(null);
  const [hiddenBeadIds, setHiddenBeadIds] = useState(new Set());
  const [beadOverrides, setBeadOverrides] = useState({});

  const [expandedBeadId, setExpandedBeadId] = useState(null);
  const [savingState, setSavingState] = useState('idle'); // idle | saving | saved

  const savingRef = useRef(false);
  const queuedRef = useRef(false);
  const skipNextSaveRef = useRef(true); // skip the first effect run after load
  const dirtyRef = useRef(false);

  // -------------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------------

  const refresh = useCallback(async () => {
    if (threadId == null) return;
    const data = await getArticleData(threadId);
    if (!data) {
      setLoaded(true);
      return;
    }
    setThread(data.thread);
    setSections(data.sections);

    // De-duplicate the photo choices across sections, preserving order.
    const seen = new Set();
    const choices = [];
    for (const s of data.sections) {
      for (const u of s.photos) {
        if (seen.has(u)) continue;
        seen.add(u);
        choices.push(u);
      }
    }
    setPhotoChoices(choices);

    skipNextSaveRef.current = true;
    setTitle(data.article.title || '');
    setSubtitle(data.article.subtitle || '');
    setIntro(data.article.intro || '');
    setTemplate(data.article.template || 'editorial');
    setCoverPhotoUri(data.article.cover_photo_uri || null);
    setHiddenBeadIds(new Set((data.article.hidden_bead_ids || []).map((n) => Number(n))));
    setBeadOverrides({ ...(data.article.bead_overrides || {}) });

    setLoaded(true);
  }, [threadId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // -------------------------------------------------------------------------
  // Auto-save (same pattern as EntryEditorScreen)
  // -------------------------------------------------------------------------

  const persist = useCallback(async () => {
    if (savingRef.current) {
      queuedRef.current = true;
      return;
    }
    if (threadId == null) return;
    savingRef.current = true;
    dirtyRef.current = false;
    setSavingState('saving');
    try {
      await saveArticle(threadId, {
        title,
        subtitle,
        intro,
        template,
        cover_photo_uri: coverPhotoUri,
        hidden_bead_ids: Array.from(hiddenBeadIds),
        bead_overrides: beadOverrides,
      });
      setSavingState('saved');
    } catch (e) {
      console.warn('Article save failed:', e?.message || e);
      setSavingState('idle');
    } finally {
      savingRef.current = false;
      if (queuedRef.current) {
        queuedRef.current = false;
        persist();
      }
    }
  }, [
    threadId, title, subtitle, intro, template, coverPhotoUri,
    hiddenBeadIds, beadOverrides,
  ]);

  const persistRef = useRef(persist);
  persistRef.current = persist;

  useEffect(() => {
    if (!loaded) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    dirtyRef.current = true;
    setSavingState('idle');
    const t = setTimeout(() => persistRef.current(), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [
    loaded, title, subtitle, intro, template, coverPhotoUri,
    hiddenBeadIds, beadOverrides,
  ]);

  useEffect(() => {
    return () => {
      if (dirtyRef.current) persistRef.current();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Section row helpers
  // -------------------------------------------------------------------------

  const toggleHidden = (beadId) => {
    setHiddenBeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(beadId)) next.delete(beadId);
      else next.add(beadId);
      return next;
    });
  };

  const setOverride = (beadId, field, value) => {
    setBeadOverrides((prev) => {
      const next = { ...prev };
      const key = String(beadId);
      const current = next[key] || {};
      next[key] = { ...current, [field]: value };
      return next;
    });
  };

  // -------------------------------------------------------------------------
  // Done: return to the export sheet
  // -------------------------------------------------------------------------

  // This screen is reached only as the "Customize layout" sub-step of the
  // thread export flow. Leaving it (Done or the back chevron) flushes any
  // in-progress autosave so the reopened HTML/PDF panel exports the latest
  // composition, then pops back to ThreadDetail, which reopens the sheet.
  const finishCustomize = useCallback(async () => {
    if (dirtyRef.current) await persistRef.current();
    if (savingRef.current) {
      while (savingRef.current) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    navigation.goBack();
  }, [navigation]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!loaded) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!thread) {
    return (
      <View style={styles.container}>
        <Header colors={colors} styles={styles} onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Thread not found.</Text>
        </View>
      </View>
    );
  }

  if (sections.length === 0) {
    return (
      <View style={styles.container}>
        <Header colors={colors} styles={styles} onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Ionicons name="git-branch-outline" size={36} color={colors.textFaint} />
          <Text style={styles.emptyHeading}>Empty thread</Text>
          <Text style={styles.emptyText}>
            Add at least one bead to this thread before you compose an article.
          </Text>
        </View>
      </View>
    );
  }

  const visibleSectionsForBanner = sections
    .filter((s) => !hiddenBeadIds.has(s.beadId))
    .map((s) => s.bead);

  const savingLabel =
    savingState === 'saving'
      ? 'Saving…'
      : savingState === 'saved'
      ? 'Saved'
      : '';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header
        colors={colors}
        styles={styles}
        onBack={finishCustomize}
        rightChild={
          <View style={styles.headerRight}>
            <Text style={styles.savingLabel}>{savingLabel}</Text>
            <TouchableOpacity
              onPress={finishCustomize}
              style={styles.doneButton}
              accessibilityLabel="Done: back to export"
              hitSlop={8}
            >
              <Ionicons name="checkmark" size={16} color={colors.primaryOnPrimary} />
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {visibleSectionsForBanner.length > 0 ? (
          <ChainBannerPreview
            beads={visibleSectionsForBanner}
            colors={colors}
          />
        ) : null}

        <Text style={styles.sectionHeading}>Title</Text>
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          placeholder={thread.name}
          placeholderTextColor={colors.textFaint}
          maxLength={200}
        />

        <Text style={styles.sectionHeading}>Subtitle</Text>
        <TextInput
          style={styles.input}
          value={subtitle}
          onChangeText={setSubtitle}
          placeholder="Optional subtitle"
          placeholderTextColor={colors.textFaint}
          maxLength={200}
        />

        <Text style={styles.sectionHeading}>Intro</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={intro}
          onChangeText={setIntro}
          placeholder="A short paragraph that opens the article…"
          placeholderTextColor={colors.placeholder}
          multiline
          textAlignVertical="top"
        />

        <Text style={styles.sectionHeading}>Template</Text>
        <View style={styles.templateRow}>
          {TEMPLATES.map((t) => {
            const active = template === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                onPress={() => setTemplate(t.key)}
                style={[styles.templateChip, active && styles.templateChipActive]}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.templateChipLabel,
                    active && styles.templateChipLabelActive,
                  ]}
                >
                  {t.label}
                </Text>
                <Text
                  style={[
                    styles.templateChipHint,
                    active && styles.templateChipHintActive,
                  ]}
                  numberOfLines={1}
                >
                  {t.hint}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sectionHeading}>Cover photo</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.coverRow}
        >
          <TouchableOpacity
            onPress={() => setCoverPhotoUri(null)}
            style={[
              styles.coverChip,
              coverPhotoUri == null && styles.coverChipActive,
            ]}
            activeOpacity={0.8}
          >
            <Ionicons
              name="link-outline"
              size={16}
              color={coverPhotoUri == null ? colors.primary : colors.textMuted}
            />
            <Text
              style={[
                styles.coverChipLabel,
                coverPhotoUri == null && styles.coverChipLabelActive,
              ]}
            >
              Chain only
            </Text>
          </TouchableOpacity>
          {photoChoices.map((u) => {
            const active = coverPhotoUri === u;
            return (
              <TouchableOpacity
                key={u}
                onPress={() => setCoverPhotoUri(u)}
                style={[styles.coverPhotoFrame, active && styles.coverPhotoFrameActive]}
                activeOpacity={0.8}
              >
                <Image source={{ uri: u }} style={styles.coverPhotoImg} />
                {active ? (
                  <View style={styles.coverPhotoCheck}>
                    <Ionicons name="checkmark" size={14} color={colors.primaryOnPrimary} />
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.sectionsBlock}>
          <Text style={styles.sectionHeading}>Sections</Text>
          <Text style={styles.sectionHint}>
            Use the eye icon to include or hide a section. Tap a section to
            add a section title or a lead paragraph.
          </Text>
          {sections.map((s) => {
            const hidden = hiddenBeadIds.has(s.beadId);
            const expanded = expandedBeadId === s.beadId;
            const override = beadOverrides[String(s.beadId)] || {};
            const titleText =
              (override.title || '').trim() ||
              (s.entry?.title || '').trim() ||
              'Untitled entry';
            const dateText = s.entry?.date ? formatDateShort(s.entry.date) : '';

            return (
              <View
                key={s.beadId}
                style={[styles.sectionRow, hidden && styles.sectionRowHidden]}
              >
                <TouchableOpacity
                  onPress={() =>
                    setExpandedBeadId(expanded ? null : s.beadId)
                  }
                  activeOpacity={0.7}
                  style={styles.sectionRowHead}
                >
                  <BeadView bead={s.bead} size={28} />
                  <View style={styles.sectionRowText}>
                    <Text
                      style={[
                        styles.sectionRowTitle,
                        hidden && styles.sectionRowTitleHidden,
                      ]}
                      numberOfLines={1}
                    >
                      {titleText}
                    </Text>
                    {dateText ? (
                      <Text style={styles.sectionRowDate}>{dateText}</Text>
                    ) : null}
                  </View>
                  <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.textFaint}
                  />
                  <TouchableOpacity
                    onPress={() => toggleHidden(s.beadId)}
                    hitSlop={8}
                    style={styles.eyeButton}
                    accessibilityLabel={hidden ? 'Include section' : 'Hide section'}
                  >
                    <Ionicons
                      name={hidden ? 'eye-off-outline' : 'eye-outline'}
                      size={18}
                      color={hidden ? colors.textFaint : colors.primary}
                    />
                  </TouchableOpacity>
                </TouchableOpacity>

                {expanded ? (
                  <View style={styles.sectionRowBody}>
                    <Text style={styles.fieldLabel}>Section title (optional)</Text>
                    <TextInput
                      style={styles.input}
                      value={override.title || ''}
                      onChangeText={(v) => setOverride(s.beadId, 'title', v)}
                      placeholder={s.entry?.title || 'Section title'}
                      placeholderTextColor={colors.textFaint}
                      maxLength={200}
                    />
                    <Text style={styles.fieldLabel}>Lead paragraph (optional)</Text>
                    <TextInput
                      style={[styles.input, styles.multiline]}
                      value={override.lead || ''}
                      onChangeText={(v) => setOverride(s.beadId, 'lead', v)}
                      placeholder="A short intro for this section…"
                      placeholderTextColor={colors.placeholder}
                      multiline
                      textAlignVertical="top"
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Header({ colors, styles, onBack, rightChild = null }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={onBack}
        style={styles.iconButton}
        accessibilityLabel="Back"
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={22} color={colors.primary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>
        Customize layout
      </Text>
      <View style={styles.headerRightSlot}>{rightChild}</View>
    </View>
  );
}

// Lightweight in-app chain preview using BeadView. The exported HTML uses
// chainSvgString from svgExport.js. Both share the same shape geometry so
// what you see here matches what ships.
function ChainBannerPreview({ beads, colors }) {
  return (
    <View style={previewStyles.wrap}>
      <View
        style={[previewStyles.thread, { backgroundColor: colors.primary }]}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={previewStyles.row}
      >
        {beads.map((b, i) => (
          <View key={i} style={previewStyles.beadWrap}>
            <BeadView bead={b} size={28} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const previewStyles = StyleSheet.create({
  wrap: {
    height: 56,
    justifyContent: 'center',
    marginBottom: 16,
  },
  thread: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 27,
    height: 1.5,
    opacity: 0.4,
  },
  row: {
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 6,
  },
  beadWrap: {
    height: 28,
    justifyContent: 'center',
  },
});

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
      gap: 8,
    },
    emptyHeading: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      marginTop: 8,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 14,
      textAlign: 'center',
    },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
      gap: 8,
    },
    headerTitle: {
      flex: 1,
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
    },
    headerRightSlot: {
      minWidth: 36,
      alignItems: 'flex-end',
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    savingLabel: {
      color: colors.textFaint,
      fontSize: 11,
    },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    doneButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
    },
    doneButtonText: {
      color: colors.primaryOnPrimary,
      fontSize: 13,
      fontWeight: '700',
    },

    scrollContent: {
      paddingHorizontal: 20,
      paddingBottom: 80,
    },

    sectionHeading: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 16,
      marginBottom: 8,
    },
    sectionHint: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: -4,
      marginBottom: 8,
    },

    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 15,
    },
    titleInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    multiline: {
      minHeight: 90,
      textAlignVertical: 'top',
    },

    templateRow: {
      flexDirection: 'row',
      gap: 8,
    },
    templateChip: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    templateChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceMuted,
    },
    templateChipLabel: {
      color: colors.text,
      fontWeight: '700',
      fontSize: 14,
      marginBottom: 2,
    },
    templateChipLabelActive: {
      color: colors.primary,
    },
    templateChipHint: {
      color: colors.textMuted,
      fontSize: 11,
    },
    templateChipHintActive: {
      color: colors.text,
    },

    coverRow: {
      paddingVertical: 4,
      gap: 8,
      alignItems: 'center',
    },
    coverChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      height: 64,
    },
    coverChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceMuted,
    },
    coverChipLabel: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    coverChipLabelActive: {
      color: colors.primary,
    },
    coverPhotoFrame: {
      width: 64,
      height: 64,
      borderRadius: 10,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    coverPhotoFrameActive: {
      borderColor: colors.primary,
    },
    coverPhotoImg: {
      width: '100%',
      height: '100%',
    },
    coverPhotoCheck: {
      position: 'absolute',
      top: 4,
      right: 4,
      backgroundColor: colors.primary,
      width: 20,
      height: 20,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
    },

    sectionsBlock: {
      marginTop: 8,
    },
    sectionRow: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      marginBottom: 8,
      overflow: 'hidden',
    },
    sectionRowHidden: {
      opacity: 0.55,
    },
    sectionRowHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    sectionRowText: {
      flex: 1,
    },
    sectionRowTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    sectionRowTitleHidden: {
      textDecorationLine: 'line-through',
      color: colors.textMuted,
    },
    sectionRowDate: {
      color: colors.textFaint,
      fontSize: 11,
      marginTop: 1,
    },
    eyeButton: {
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    sectionRowBody: {
      paddingHorizontal: 12,
      paddingBottom: 12,
      gap: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: 12,
    },
    fieldLabel: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
  });
