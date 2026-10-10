import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import {
  exportArticleMarkdown,
  exportArticleHtml,
  exportArticlePdf,
  saveArticleMarkdownToDevice,
  saveArticleHtmlToDevice,
  saveArticlePdfToDevice,
  getArticleData,
} from '../services/threadArticles';
import { exportThreadOrg, saveThreadOrgToDevice } from '../services/orgExport';
import {
  exportThreadSlides,
  saveThreadSlidesToDevice,
} from '../services/slideExport';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Shared format-first export sheet for a thread. Used from the thread
// view (opens directly: the format prompt is the first thing you see)
// and from the article composer (its own Export button). Self-contained:
// given a threadId it drives every format itself; Org ignores the
// composition entirely, MD/HTML/PDF read the saved article/defaults.
//
// Props:
//   visible, threadId, onClose
//   onBeforeArticleExport?  async () => boolean. The composer passes a
//       flush+guard (persist in-progress edits, abort if all beads
//       hidden). Omitted from the thread view (no unsaved composer
//       state there). Not called for Org.
//   templateLabel?          string. The composer passes its live template
//       label so HTML/PDF show it read-only. Omitted elsewhere.
//   onCustomizeLayout?      (format) => void. The thread view passes
//       navigate-to-composer so HTML/PDF can deep-curate. Receives the
//       format the user was on so the caller can reopen the sheet there
//       on return. Omitted inside the composer (you're already there).
//   initialFormat?          'org'|'md'|'html'|'pdf'. When set, the sheet
//       opens straight on that format's detail panel instead of the
//       format list. Used to resume the flow after "Customize layout".
const FORMAT_META = {
  org: {
    label: 'Org (Emacs)',
    hint: 'A .zip file for Emacs. It contains an org-datetree, roam links and bead SVGs.',
  },
  md: { label: 'Markdown', hint: 'A .zip file. It contains the .md file and the photo and voice assets.' },
  html: { label: 'HTML', hint: 'A self-contained page with embedded photos.' },
  pdf: { label: 'PDF', hint: 'A document that is ready to print.' },
  slides: {
    label: 'Slides',
    hint: 'A deck with one station for each bead. The bead chain is the spine. Your comments are the speaker notes. The viewer selects light or dark mode.',
  },
};

export default function ThreadExportSheet({
  visible,
  threadId,
  onClose,
  onBeforeArticleExport,
  templateLabel,
  onCustomizeLayout,
  initialFormat,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const [exportFormat, setExportFormat] = useState(null);
  const [exportingKind, setExportingKind] = useState(null);
  const [orgOpts, setOrgOpts] = useState({
    includePrivate: true,
    includeVakanaEl: true,
    reproducible: false,
  });
  const [mdMultiFile, setMdMultiFile] = useState(false);

  // Reopen on the format list by default, or jump straight to a format's
  // detail panel when the caller resumes the flow (return from "Customize
  // layout"). Never a stale panel from the previous open.
  useEffect(() => {
    if (visible) setExportFormat(initialFormat ?? null);
  }, [visible, initialFormat]);

  const exportOrg = async (mode) => {
    onClose();
    setExportingKind('org');
    try {
      const fn = mode === 'save' ? saveThreadOrgToDevice : exportThreadOrg;
      const { missing } = await fn(threadId, orgOpts);
      if (missing && missing.length) {
        Alert.alert(
          mode === 'save' ? 'Saved' : 'Exported',
          `${missing.length} attachment${missing.length === 1 ? ' was' : 's were'} not available. The export skipped the missing attachments.`
        );
      }
    } catch (e) {
      Alert.alert(
        mode === 'save' ? 'Save failed' : 'Export failed',
        e?.message || String(e)
      );
    } finally {
      setExportingKind(null);
    }
  };

  const exportSlides = async (mode) => {
    onClose();
    setExportingKind('slides');
    try {
      const fn = mode === 'save' ? saveThreadSlidesToDevice : exportThreadSlides;
      const { missing } = await fn(threadId);
      if (missing && missing.length) {
        Alert.alert(
          mode === 'save' ? 'Saved' : 'Exported',
          `${missing.length} attachment${missing.length === 1 ? ' was' : 's were'} not available. The export skipped the missing attachments.`
        );
      }
    } catch (e) {
      Alert.alert(
        mode === 'save' ? 'Save failed' : 'Export failed',
        e?.message || String(e)
      );
    } finally {
      setExportingKind(null);
    }
  };

  const exportArticle = async (kind, mode) => {
    onClose();
    // Composer passes a flush+guard; it returns false to abort (e.g.
    // every bead hidden). The thread view omits it: nothing to flush,
    // but still guard against an all-hidden article so Share/Save can't
    // emit an empty document.
    if (onBeforeArticleExport) {
      const ok = await onBeforeArticleExport();
      if (!ok) return;
    } else {
      try {
        const data = await getArticleData(threadId);
        if (data) {
          const hidden = new Set(
            (data.article?.hidden_bead_ids || []).map(Number)
          );
          const visible = (data.sections || []).filter(
            (s) => !hidden.has(s.beadId)
          );
          if (visible.length === 0) {
            Alert.alert(
              'Nothing to export',
              'Every section is hidden. Before you export, include at least one bead in "Customize layout".'
            );
            return;
          }
        }
      } catch {
        // Fall through: the export call will surface its own error.
      }
    }
    setExportingKind(kind);
    try {
      let res;
      const mdOpts = { multiFile: mdMultiFile };
      if (mode === 'save') {
        if (kind === 'md') res = await saveArticleMarkdownToDevice(threadId, mdOpts);
        else if (kind === 'html') await saveArticleHtmlToDevice(threadId);
        else if (kind === 'pdf') await saveArticlePdfToDevice(threadId);
      } else if (kind === 'md') res = await exportArticleMarkdown(threadId, mdOpts);
      else if (kind === 'html') await exportArticleHtml(threadId);
      else if (kind === 'pdf') await exportArticlePdf(threadId);
      // Markdown ships a zip with bundled assets; report any attachment
      // that was evicted from disk and skipped (same as Org).
      if (kind === 'md' && res?.missing?.length) {
        Alert.alert(
          mode === 'save' ? 'Saved' : 'Exported',
          `${res.missing.length} attachment${res.missing.length === 1 ? ' was' : 's were'} not available. The export skipped the missing attachments.`
        );
      }
    } catch (e) {
      Alert.alert(
        mode === 'save' ? 'Save failed' : 'Export failed',
        e?.message || String(e)
      );
    } finally {
      setExportingKind(null);
    }
  };

  const runExport = (mode) => {
    if (exportFormat === 'org') exportOrg(mode);
    else if (exportFormat === 'slides') exportSlides(mode);
    else if (exportFormat) exportArticle(exportFormat, mode);
  };

  const customize = () => {
    const fmt = exportFormat;
    onClose();
    onCustomizeLayout?.(fmt);
  };

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <Pressable style={styles.sheetBackdrop} onPress={onClose}>
          <Pressable
            style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom + 8) }]}
            onPress={() => {}}
          >
            <View style={styles.sheetHandle} />
            {exportFormat == null ? (
              <>
                <Text style={styles.sheetHeading}>Export thread</Text>
                <SheetRow
                  styles={styles}
                  colors={colors}
                  icon="git-branch-outline"
                  label="Org (Emacs) · .zip"
                  hint="org-datetree · roam links · bead SVGs"
                  onPress={() => setExportFormat('org')}
                />
                <SheetRow
                  styles={styles}
                  colors={colors}
                  icon="document-text-outline"
                  label="Markdown"
                  hint="A self-contained folder for Obsidian, a repository or a vault"
                  onPress={() => setExportFormat('md')}
                />
                <SheetRow
                  styles={styles}
                  colors={colors}
                  icon="globe-outline"
                  label="HTML"
                  hint="A self-contained page with embedded photos"
                  onPress={() => setExportFormat('html')}
                />
                <SheetRow
                  styles={styles}
                  colors={colors}
                  icon="document-outline"
                  label="PDF"
                  hint="Ready to print and to share"
                  onPress={() => setExportFormat('pdf')}
                />
                <SheetRow
                  styles={styles}
                  colors={colors}
                  icon="albums-outline"
                  label="Slides"
                  hint="A deck of the thread: the bead chain is the spine, the comments are speaker notes"
                  onPress={() => setExportFormat('slides')}
                  last
                />
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.sheetBack}
                  onPress={() => setExportFormat(null)}
                  activeOpacity={0.7}
                  accessibilityLabel="Back to formats"
                >
                  <Ionicons
                    name="chevron-back"
                    size={20}
                    color={colors.primary}
                  />
                  <Text style={styles.sheetBackText}>
                    {FORMAT_META[exportFormat].label}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.sheetFormatHint}>
                  {FORMAT_META[exportFormat].hint}
                </Text>

                {exportFormat === 'org' ? (
                  <>
                    <Text style={styles.sheetSubheading}>Options</Text>
                    <OrgToggle
                      styles={styles}
                      colors={colors}
                      label="Include private entries"
                      hint="When off, the export has a masked stub without the body and photos"
                      value={orgOpts.includePrivate}
                      onToggle={() =>
                        setOrgOpts((o) => ({
                          ...o,
                          includePrivate: !o.includePrivate,
                        }))
                      }
                    />
                    <OrgToggle
                      styles={styles}
                      colors={colors}
                      label="Include vakana.el"
                      hint="Optional Emacs helper. It does not use the network."
                      value={orgOpts.includeVakanaEl}
                      onToggle={() =>
                        setOrgOpts((o) => ({
                          ...o,
                          includeVakanaEl: !o.includeVakanaEl,
                        }))
                      }
                    />
                    <OrgToggle
                      styles={styles}
                      colors={colors}
                      label="Reproducible"
                      hint="Omits the export time and version. The output is stable in git."
                      value={orgOpts.reproducible}
                      onToggle={() =>
                        setOrgOpts((o) => ({
                          ...o,
                          reproducible: !o.reproducible,
                        }))
                      }
                    />
                  </>
                ) : exportFormat === 'md' ? (
                  <>
                    <Text style={styles.sheetSubheading}>Options</Text>
                    <OrgToggle
                      styles={styles}
                      colors={colors}
                      label="One file per bead"
                      hint="Makes one file for each bead and an index.md file with links to them"
                      value={mdMultiFile}
                      onToggle={() => setMdMultiFile((v) => !v)}
                    />
                  </>
                ) : exportFormat === 'html' || exportFormat === 'pdf' ? (
                  <>
                    {templateLabel ? (
                      <Text style={styles.sheetTemplateNote}>
                        Template: {templateLabel}. Change it in the composer.
                      </Text>
                    ) : null}
                    {onCustomizeLayout ? (
                      <TouchableOpacity
                        style={styles.sheetRow}
                        onPress={customize}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name="options-outline"
                          size={20}
                          color={colors.primary}
                        />
                        <View style={styles.sheetRowText}>
                          <Text style={styles.sheetRowLabel}>
                            Customize layout
                          </Text>
                          <Text style={styles.sheetRowHint}>
                            Cover, intro, hidden beads, template
                          </Text>
                        </View>
                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={colors.textFaint}
                        />
                      </TouchableOpacity>
                    ) : null}
                  </>
                ) : null}

                <View style={styles.sheetActions}>
                  <TouchableOpacity
                    style={[styles.sheetActionBtn, styles.sheetActionPrimary]}
                    onPress={() => runExport('share')}
                    activeOpacity={0.85}
                    accessibilityLabel={`Share as ${FORMAT_META[exportFormat].label}`}
                  >
                    <Ionicons
                      name="share-outline"
                      size={16}
                      color={colors.primaryOnPrimary}
                    />
                    <Text style={styles.sheetActionPrimaryText}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.sheetActionBtn, styles.sheetActionGhost]}
                    onPress={() => runExport('save')}
                    activeOpacity={0.85}
                    accessibilityLabel={`Save ${FORMAT_META[exportFormat].label} to device`}
                  >
                    <Ionicons
                      name="download-outline"
                      size={16}
                      color={colors.primary}
                    />
                    <Text style={styles.sheetActionGhostText}>
                      Save to device
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.sheetSaveHint}>
                  {Platform.OS === 'android'
                    ? 'With Save, you select a folder.'
                    : 'Save opens the share sheet. Then tap "Save to Files".'}
                </Text>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!exportingKind} transparent animationType="fade">
        <View style={styles.exportingOverlay} pointerEvents="auto">
          <View style={styles.exportingCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.exportingText}>
              Preparing {(exportingKind || '').toUpperCase()}…
            </Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

function SheetRow({ styles, colors, icon, label, hint, onPress, last }) {
  return (
    <TouchableOpacity
      style={[styles.sheetRow, last && styles.sheetRowLast]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={icon} size={20} color={colors.primary} />
      <View style={styles.sheetRowText}>
        <Text style={styles.sheetRowLabel}>{label}</Text>
        <Text style={styles.sheetRowHint}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

function OrgToggle({ styles, colors, label, hint, value, onToggle }) {
  return (
    <TouchableOpacity
      style={styles.orgToggleRow}
      onPress={onToggle}
      activeOpacity={0.7}
      accessibilityLabel={`${label}. ${value ? 'On' : 'Off'}. Tap to toggle.`}
    >
      <Ionicons
        name={value ? 'checkbox' : 'square-outline'}
        size={18}
        color={value ? colors.primary : colors.textFaint}
      />
      <View style={styles.sheetRowText}>
        <Text style={styles.orgToggleText}>{label}</Text>
        <Text style={styles.sheetRowHint}>{hint}</Text>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    sheetBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
      paddingHorizontal: 20,
      paddingBottom: 24,
    },
    sheetHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      alignSelf: 'center',
      marginBottom: 12,
    },
    sheetHeading: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    sheetSubheading: {
      color: colors.textFaint,
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 12,
      marginBottom: 2,
    },
    sheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    sheetRowLast: {
      borderBottomWidth: 0,
    },
    sheetRowText: {
      flex: 1,
    },
    sheetRowLabel: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    sheetRowHint: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 1,
    },
    sheetBack: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginLeft: -4,
      paddingVertical: 2,
      marginBottom: 2,
    },
    sheetBackText: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    sheetFormatHint: {
      color: colors.textMuted,
      fontSize: 12,
      marginBottom: 6,
    },
    sheetTemplateNote: {
      color: colors.textMuted,
      fontSize: 13,
      paddingVertical: 14,
    },
    sheetActions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 16,
    },
    sheetActionBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      paddingVertical: 13,
      borderRadius: 12,
    },
    sheetActionPrimary: {
      backgroundColor: colors.primary,
    },
    sheetActionPrimaryText: {
      color: colors.primaryOnPrimary,
      fontSize: 15,
      fontWeight: '700',
    },
    sheetActionGhost: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    sheetActionGhostText: {
      color: colors.primary,
      fontSize: 15,
      fontWeight: '700',
    },
    sheetSaveHint: {
      color: colors.textFaint,
      fontSize: 11,
      textAlign: 'center',
      marginTop: 8,
    },
    orgToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingLeft: 4,
    },
    orgToggleText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    exportingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.35)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    exportingCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingHorizontal: 20,
      paddingVertical: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    exportingText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
  });
