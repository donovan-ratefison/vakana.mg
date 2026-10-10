import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useVault } from '../vault';
import {
  exportCurrentVault,
  shareBackup,
  pickBackupFile,
  restoreFromZip,
  recordBackup,
  getLastBackup,
  formatBackupAge,
  isBackupStale,
  BACKUP_MODE_DATA_ONLY,
  BACKUP_MODE_FULL,
  BACKUP_MODE_MEDIA_ONLY,
} from '../services/backup';
import { getCurrentVault } from '../utils/vaults';

const STAGE_LABEL = {
  'reading-db': 'Reading database…',
  'staging-photos': 'Staging photos…',
  'staging-voice': 'Staging voice notes…',
  'compressing': 'Compressing archive…',
  'reading-zip': 'Reading backup…',
  'closing-db': 'Preparing vault…',
  'extracting-photos': 'Restoring photos…',
  'extracting-voice': 'Restoring voice notes…',
  'rewriting-uris': 'Re-linking attachments…',
  'done': 'Done',
};

const EXPORT_MODES = [
  {
    key: BACKUP_MODE_FULL,
    icon: 'archive-outline',
    label: 'Full backup',
    hint: 'The database, all photos and all voice notes. The export streams natively, so memory use does not increase with size.',
  },
  {
    key: BACKUP_MODE_DATA_ONLY,
    icon: 'document-text-outline',
    label: 'Data-only backup',
    hint: 'The database only, without media. It is small and fast, and it always works. It protects your data in the worst case.',
  },
  {
    key: BACKUP_MODE_MEDIA_ONLY,
    icon: 'images-outline',
    label: 'Media-only backup',
    hint: 'Photos and voice notes, without the database. Use it to archive the large files separately.',
  },
];

export default function SettingsBackupScreen({ navigation }) {
  const { colors } = useTheme();
  const { switchVault } = useVault();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  // undefined = still loading (render nothing), null = never backed up.
  const [lastBackup, setLastBackup] = useState(undefined);

  const refreshLastBackup = async (vaultId) => {
    try {
      const id = vaultId ?? (await getCurrentVault())?.id;
      setLastBackup(id != null ? await getLastBackup(id) : null);
    } catch {
      setLastBackup(null);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const v = await getCurrentVault();
        const lb = v?.id != null ? await getLastBackup(v.id) : null;
        if (alive) setLastBackup(lb);
      } catch {
        if (alive) setLastBackup(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleExport = async (mode) => {
    if (busy) return;
    setBusy(true);
    setStage('reading-db');
    setLastResult(null);
    try {
      const result = await exportCurrentVault({
        mode,
        onProgress: ({ stage }) => setStage(stage),
      });
      setLastResult({
        kind: 'export',
        mode,
        skipped: result.manifest.skipped?.length || 0,
        photos: result.manifest.photos.length,
        voice: result.manifest.voice.length,
        filename: result.filename,
      });
      try {
        await shareBackup(result.uri);
        // Share sheet completed without throwing: the best proxy we have
        // for "the user produced a backup" (the API can't confirm a save).
        // recordBackup self-guards: media-only is a no-op.
        await recordBackup(result.vaultId, mode);
        await refreshLastBackup(result.vaultId);
      } catch (err) {
        // Sharing unavailable: the zip only sits in ephemeral cache, so we
        // deliberately do NOT record it as a backup.
        Alert.alert('Backup created', `Saved to: ${result.uri}`);
      }
    } catch (err) {
      Alert.alert('Backup failed', err?.message || String(err));
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  const handleRestore = async () => {
    if (busy) return;
    const asset = await pickBackupFile();
    if (!asset) return;

    const vault = await getCurrentVault();
    Alert.alert(
      'Restore backup?',
      `Warning: this replaces every entry, thread, photo and voice note in "${vault?.name}". You cannot undo this.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setStage('reading-zip');
            setLastResult(null);
            try {
              const result = await restoreFromZip(asset.uri, {
                onProgress: ({ stage }) => setStage(stage),
              });
              setLastResult({ kind: 'restore', ...result });
              // Re-mount the navigator + lock screen against the freshly
              // replaced DB. Switching to the same vault is a clean way
              // to trigger that without duplicating the plumbing.
              if (vault?.id) {
                await switchVault(vault.id);
              }
            } catch (err) {
              Alert.alert('Restore failed', err?.message || String(err));
            } finally {
              setBusy(false);
              setStage(null);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back"
          disabled={busy}
        >
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Backup & Restore</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {lastBackup !== undefined ? (
          (() => {
            const stale = isBackupStale(lastBackup ? lastBackup.at : null);
            const modeSuffix =
              lastBackup?.mode === BACKUP_MODE_FULL
                ? ' · Full'
                : lastBackup?.mode === BACKUP_MODE_DATA_ONLY
                ? ' · Data-only'
                : '';
            const label =
              lastBackup == null
                ? 'Never backed up'
                : `Last backup created ${formatBackupAge(
                    lastBackup.at
                  )}${modeSuffix}`;
            return (
              <View
                style={[styles.statusRow, stale && styles.statusRowStale]}
              >
                <Ionicons
                  name={stale ? 'alert-circle' : 'time-outline'}
                  size={16}
                  color={stale ? colors.danger : colors.textMuted}
                />
                <Text
                  style={[styles.statusText, stale && styles.statusTextStale]}
                >
                  {label}
                </Text>
              </View>
            );
          })()
        ) : null}

        <Text style={styles.intro}>
          There are three kinds of backup. Each backup is one .zip file that
          you can save where your share sheet permits. The app streams all
          exports natively, so a large media library does not cause an
          out-of-memory error.
        </Text>

        <Text style={styles.sectionLabel}>Export</Text>
        {EXPORT_MODES.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={[styles.actionCard, busy && styles.actionDisabled]}
            onPress={() => handleExport(m.key)}
            activeOpacity={0.7}
            disabled={busy}
          >
            <View style={styles.actionIcon}>
              <Ionicons name={m.icon} size={22} color={colors.primary} />
            </View>
            <View style={styles.actionText}>
              <Text style={styles.actionLabel}>{m.label}</Text>
              <Text style={styles.actionHint}>{m.hint}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </TouchableOpacity>
        ))}

        <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>
          Restore
        </Text>
        <TouchableOpacity
          style={[styles.actionCard, busy && styles.actionDisabled]}
          onPress={handleRestore}
          activeOpacity={0.7}
          disabled={busy}
        >
          <View style={styles.actionIcon}>
            <Ionicons name="cloud-download-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.actionText}>
            <Text style={styles.actionLabel}>Restore from backup</Text>
            <Text style={styles.actionHint}>
              Replace this vault with the contents of a .zip file. Restore
              accepts full backups and data-only backups, including archives
              from earlier versions.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </TouchableOpacity>

        {busy ? (
          <View style={styles.busyBox}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.busyText}>{STAGE_LABEL[stage] || 'Working…'}</Text>
          </View>
        ) : null}

        {lastResult?.kind === 'export' ? (
          <View style={styles.resultBox}>
            <Text style={styles.resultTitle}>Backup ready</Text>
            <Text style={styles.resultLine}>{lastResult.filename}</Text>
            <Text style={styles.resultLine}>
              {lastResult.mode === BACKUP_MODE_DATA_ONLY
                ? 'Database only. The backup contains no media.'
                : `${lastResult.photos} photo(s), ${lastResult.voice} voice note(s)${
                    lastResult.skipped
                      ? `, ${lastResult.skipped} attachment(s) skipped (file no longer on device)`
                      : ''
                  }`}
            </Text>
          </View>
        ) : null}

        {lastResult?.kind === 'restore' ? (
          <View style={styles.resultBox}>
            <Text style={styles.resultTitle}>Restore complete</Text>
            <Text style={styles.resultLine}>
              {lastResult.photosRestored} photo(s) and{' '}
              {lastResult.voiceRestored} voice note(s) restored
              {lastResult.skipped
                ? `, ${lastResult.skipped} originally skipped`
                : ''}
              .
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 60,
      paddingBottom: 12,
    },
    headerTitle: { fontSize: 22, fontWeight: '700', color: colors.text },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    scrollContent: { padding: 20, paddingBottom: 40 },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: colors.surfaceMuted,
      marginBottom: 14,
    },
    statusRowStale: {
      backgroundColor: colors.dangerSoft,
    },
    statusText: { flex: 1, fontSize: 13, color: colors.textMuted },
    statusTextStale: { color: colors.danger, fontWeight: '600' },
    intro: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 16 },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginBottom: 8,
      marginLeft: 4,
    },
    sectionLabelSpaced: { marginTop: 16 },
    actionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 10,
    },
    actionDisabled: { opacity: 0.5 },
    actionIcon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actionText: { flex: 1 },
    actionLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
    actionHint: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 16 },
    busyBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderRadius: 12,
      backgroundColor: colors.surfaceMuted,
      marginTop: 8,
    },
    busyText: { color: colors.text, fontSize: 14 },
    resultBox: {
      marginTop: 16,
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    resultTitle: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 4 },
    resultLine: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  });
