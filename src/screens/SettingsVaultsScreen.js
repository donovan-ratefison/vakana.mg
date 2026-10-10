import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';
import { useVault } from '../vault';
import {
  listVaults,
  createVault,
  renameVault,
  deleteVault,
  getCurrentVaultId,
} from '../utils/vaults';

export default function SettingsVaultsScreen({ navigation }) {
  const { colors } = useTheme();
  const keyboardInset = useKeyboardInset();
  const { switchVault } = useVault();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [vaults, setVaults] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [actionsFor, setActionsFor] = useState(null); // vault object
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const refresh = useCallback(async () => {
    const list = await listVaults();
    setVaults(list);
    setCurrentId(await getCurrentVaultId());
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = navigation.addListener('focus', refresh);
    return unsubscribe;
  }, [navigation, refresh]);

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    try {
      const created = await createVault(name);
      setCreateOpen(false);
      setCreateName('');
      await refresh();
      Alert.alert(
        'Vault created',
        `Switch to "${created.name}" now? You set its PIN on the next screen.`,
        [
          { text: 'Stay here', style: 'cancel' },
          {
            text: 'Switch',
            onPress: async () => {
              await switchVault(created.id);
            },
          },
        ]
      );
    } catch (err) {
      Alert.alert('Could not create', err?.message || String(err));
    }
  };

  const handleSwitch = async (vault) => {
    if (vault.id === currentId) return;
    setActionsFor(null);
    Alert.alert(
      'Switch vault',
      `Lock this session and open "${vault.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: async () => {
            await switchVault(vault.id);
          },
        },
      ]
    );
  };

  const handleRename = async () => {
    if (!actionsFor) return;
    const next = renameValue.trim();
    if (!next) return;
    try {
      await renameVault(actionsFor.id, next);
      setRenameOpen(false);
      setActionsFor(null);
      await refresh();
    } catch (err) {
      Alert.alert('Could not rename', err?.message || String(err));
    }
  };

  const handleDelete = (vault) => {
    if (vault.id === currentId) {
      Alert.alert(
        'Cannot delete',
        'Switch to another vault before you delete this vault.'
      );
      return;
    }
    Alert.alert(
      `Delete "${vault.name}"?`,
      'Warning: this permanently deletes every entry, thread, photo and voice note in this vault.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteVault(vault.id);
              setActionsFor(null);
              await refresh();
            } catch (err) {
              Alert.alert('Could not delete', err?.message || String(err));
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
        >
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Vaults</Text>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => setCreateOpen(true)}
          accessibilityLabel="New vault"
        >
          <Ionicons name="add" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.intro}>
          Each vault has its own database, attachments folder, and PIN. Use a
          different vault when you want a separate journal, for example for
          work, personal notes, or travel.
        </Text>

        <View style={styles.card}>
          {vaults.map((v, i) => {
            const isCurrent = v.id === currentId;
            return (
              <TouchableOpacity
                key={v.id}
                style={[
                  styles.row,
                  i < vaults.length - 1 && styles.rowDivider,
                ]}
                onPress={() => setActionsFor(v)}
                activeOpacity={0.7}
              >
                <View style={styles.rowIcon}>
                  <Ionicons
                    name={isCurrent ? 'bookmark' : 'bookmark-outline'}
                    size={20}
                    color={colors.primary}
                  />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{v.name}</Text>
                  <Text style={styles.rowHint}>
                    {isCurrent ? 'Currently open' : 'Tap for actions'}
                  </Text>
                </View>
                <Ionicons
                  name="ellipsis-horizontal"
                  size={18}
                  color={colors.textFaint}
                />
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <Modal
        visible={createOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateOpen(false)}
      >
        <View
          style={[
            styles.modalScrim,
            keyboardInset > 0 && { paddingBottom: 28 + keyboardInset },
          ]}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New vault</Text>
            <TextInput
              style={styles.input}
              value={createName}
              onChangeText={setCreateName}
              placeholder="e.g. Travel journal"
              placeholderTextColor={colors.placeholder}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => {
                  setCreateOpen(false);
                  setCreateName('');
                }}
                style={[styles.modalBtn, styles.modalBtnGhost]}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreate}
                style={[styles.modalBtn, styles.modalBtnPrimary]}
              >
                <Text
                  style={[styles.modalBtnText, { color: colors.primaryOnPrimary }]}
                >
                  Create
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!actionsFor && !renameOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setActionsFor(null)}
      >
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{actionsFor?.name}</Text>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => actionsFor && handleSwitch(actionsFor)}
              disabled={actionsFor?.id === currentId}
            >
              <Ionicons
                name="swap-horizontal-outline"
                size={20}
                color={actionsFor?.id === currentId ? colors.textFaint : colors.primary}
              />
              <Text
                style={[
                  styles.actionRowText,
                  actionsFor?.id === currentId && { color: colors.textFaint },
                ]}
              >
                {actionsFor?.id === currentId ? 'Already open' : 'Switch to this vault'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => {
                setRenameValue(actionsFor?.name || '');
                setRenameOpen(true);
              }}
            >
              <Ionicons name="pencil-outline" size={20} color={colors.primary} />
              <Text style={styles.actionRowText}>Rename</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => actionsFor && handleDelete(actionsFor)}
            >
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
              <Text style={[styles.actionRowText, { color: colors.danger }]}>
                Delete vault
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnGhost, { marginTop: 8 }]}
              onPress={() => setActionsFor(null)}
            >
              <Text style={[styles.modalBtnText, { color: colors.text }]}>
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={renameOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameOpen(false)}
      >
        <View
          style={[
            styles.modalScrim,
            keyboardInset > 0 && { paddingBottom: 28 + keyboardInset },
          ]}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename vault</Text>
            <TextInput
              style={styles.input}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Vault name"
              placeholderTextColor={colors.placeholder}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setRenameOpen(false)}
                style={[styles.modalBtn, styles.modalBtnGhost]}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleRename}
                style={[styles.modalBtn, styles.modalBtnPrimary]}
              >
                <Text
                  style={[styles.modalBtnText, { color: colors.primaryOnPrimary }]}
                >
                  Save
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    intro: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 16 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      gap: 12,
    },
    rowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.surfaceMuted,
      justifyContent: 'center',
      alignItems: 'center',
    },
    rowText: { flex: 1 },
    rowLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
    rowHint: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
    modalScrim: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      padding: 28,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 18,
      borderWidth: 1,
      borderColor: colors.border,
    },
    modalTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 12 },
    input: {
      backgroundColor: colors.background,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 15,
      marginBottom: 12,
    },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    modalBtn: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 10,
    },
    modalBtnGhost: { backgroundColor: colors.surfaceMuted },
    modalBtnPrimary: { backgroundColor: colors.primary },
    modalBtnText: { fontSize: 14, fontWeight: '600' },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    actionRowText: { fontSize: 15, color: colors.text, fontWeight: '500' },
  });
