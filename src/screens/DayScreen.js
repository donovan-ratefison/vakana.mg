import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import EntryCard from '../components/EntryCard';
import ChainPreview from '../components/ChainPreview';
import { loadThreadPreview, buildChainItems } from '../components/ThreadCard';
import { getDb } from '../database/db';
import { parseDateStr } from '../utils/dateString';
import { loadThreadCountsForEntries } from '../services/threadMembership';
import { loadAttachmentsForEntries } from '../services/attachments';
import { threadsAnchoredToDay } from '../services/anchoredThreads';
import {
  loadOneShotRemindersForDate,
  restoreReminder,
} from '../services/reminders';
import { useTheme } from '../theme';

function formatHeading(dateStr) {
  const d = parseDateStr(dateStr);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function DayScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const dateStr = route.params?.dateStr;
  const [entries, setEntries] = useState([]);
  // User threads anchored to this exact day: the loci the calendar's
  // day-band promised. The band and this section are driven by the same
  // predicate (anchoredThreads.js) so they can't disagree. Each carries
  // its chain via the shared preview path (no second bead renderer).
  const [anchored, setAnchored] = useState([]);
  // One-shot reminders scheduled on this day: pending *and* the ones you
  // acked off the banner (struck "done", restorable here). The calendar
  // is the palace; an acked reminder waits on its day, not in oblivion.
  // Recurring series are out of scope (they advance; the recurring sheet
  // owns them, so there are no per-day occurrences to materialize).
  const [dayReminders, setDayReminders] = useState([]);

  const loadEntries = useCallback(async () => {
    const db = getDb();
    if (!db || !dateStr) return;
    // Timed entries first, in clock order (morning → night); untimed entries
    // follow, newest-edited first. On an all-untimed day every row has
    // `time IS NULL`, so this collapses to the original `updated_at DESC`.
    const rows = await db.getAllAsync(
      `SELECT * FROM entries WHERE date = ?
        ORDER BY (time IS NULL) ASC, time ASC, updated_at DESC`,
      [dateStr]
    );
    // Batched (2 queries total, not 2 per entry; see attachments.js).
    const attachments = await loadAttachmentsForEntries(rows.map((r) => r.id));
    const enriched = rows.map((entry) => ({
      ...entry,
      photos: attachments[entry.id]?.photos ?? [],
      voiceNotes: attachments[entry.id]?.voiceNotes ?? [],
    }));
    const threadCounts = await loadThreadCountsForEntries(
      enriched.map((e) => e.id)
    );
    for (const e of enriched) {
      e.threadCount = threadCounts[e.id] ?? 0;
    }
    setEntries(enriched);
  }, [dateStr]);

  const loadAnchored = useCallback(async () => {
    if (!dateStr) return;
    const db = getDb();
    const threads = await threadsAnchoredToDay(dateStr);
    const withChains = await Promise.all(
      threads.map(async (t) => ({
        ...t,
        chain: db ? buildChainItems(await loadThreadPreview(db, t.id)) : [],
      }))
    );
    setAnchored(withChains);
  }, [dateStr]);

  const loadDayReminders = useCallback(async () => {
    setDayReminders(await loadOneShotRemindersForDate(dateStr));
  }, [dateStr]);

  useEffect(() => {
    const run = () => {
      loadEntries();
      loadAnchored();
      loadDayReminders();
    };
    const unsubscribe = navigation.addListener('focus', run);
    return unsubscribe;
  }, [loadEntries, loadAnchored, loadDayReminders, navigation]);

  const handleRestore = useCallback(
    async (reminder) => {
      await restoreReminder(reminder.id);
      await loadDayReminders();
    },
    [loadDayReminders]
  );

  // The anchor is a locus in its own right: a day with no entries but a
  // thread anchored to it is *not* empty. The band told the truth, so
  // soften the copy rather than calling it blank.
  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>
        {anchored.length > 0 || dayReminders.length > 0
          ? 'No entries yet for this day'
          : 'No entries for this day'}
      </Text>
      <Text style={styles.emptySubtext}>Tap + to add one.</Text>
    </View>
  );

  const anchoredHeader =
    anchored.length > 0 ? (
      <View style={styles.anchoredSection}>
        <Text style={styles.anchoredHeading}>Threads anchored here</Text>
        {anchored.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={styles.anchoredRow}
            activeOpacity={0.7}
            onPress={() =>
              navigation.navigate('ThreadDetail', { threadId: t.id })
            }
          >
            <View style={styles.anchoredRowMain}>
              <Text style={styles.anchoredName} numberOfLines={1}>
                {t.name}
              </Text>
              {t.chain.length > 0 ? (
                <ChainPreview items={t.chain} beadSize={16} />
              ) : null}
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textFaint}
            />
          </TouchableOpacity>
        ))}
      </View>
    ) : null;

  const remindersHeader =
    dayReminders.length > 0 ? (
      <View style={styles.anchoredSection}>
        <Text style={styles.anchoredHeading}>Reminders this day</Text>
        {dayReminders.map((r) => {
          const done = !!r.acknowledged_at;
          return (
            <View
              key={r.id}
              style={styles.anchoredRow}
            >
              <Ionicons
                name={done ? 'checkmark-done' : 'notifications-outline'}
                size={16}
                color={done ? colors.textFaint : colors.primary}
              />
              <View style={styles.anchoredRowMain}>
                <Text
                  style={[styles.anchoredName, done && styles.reminderDone]}
                  numberOfLines={1}
                >
                  {r.title || 'Journal Reminder'}
                </Text>
                <Text
                  style={[styles.reminderTime, done && styles.reminderDone]}
                >
                  {r.scheduled_time || ''}
                  {done ? ' · done' : ''}
                </Text>
              </View>
              {done ? (
                <TouchableOpacity
                  onPress={() => handleRestore(r)}
                  hitSlop={8}
                  accessibilityLabel="Restore this reminder"
                >
                  <Ionicons
                    name="arrow-undo-outline"
                    size={18}
                    color={colors.primary}
                  />
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
      </View>
    ) : null;

  const listHeader =
    anchoredHeader || remindersHeader ? (
      <>
        {anchoredHeader}
        {remindersHeader}
      </>
    ) : null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backWrap} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {dateStr ? formatHeading(dateStr) : ''}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      <FlatList
        data={entries}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <EntryCard
            entry={item}
            onPress={() => navigation.navigate('EntryEditor', { entryId: item.id })}
            onOpenThread={(threadId) =>
              navigation.navigate('ThreadDetail', { threadId })
            }
          />
        )}
        ListHeaderComponent={listHeader}
        contentContainerStyle={
          entries.length === 0 ? styles.emptyList : styles.listContent
        }
        ListEmptyComponent={renderEmpty}
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('EntryEditor', { entryId: null, dateStr })}
        accessibilityLabel="New entry on this day"
      >
        <Ionicons name="add" size={32} color={colors.primaryOnPrimary} />
      </TouchableOpacity>
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
      paddingBottom: 16,
    },
    backWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      width: 60,
    },
    backText: {
      color: colors.primary,
      fontSize: 16,
      marginLeft: 2,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    listContent: {
      paddingHorizontal: 20,
      paddingBottom: 100,
    },
    // Self-padded (not reliant on listContent) so it sits correctly in
    // both the populated and the locus-with-no-entries layouts.
    anchoredSection: {
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 12,
      marginBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    anchoredHeading: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 8,
    },
    anchoredRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 8,
    },
    anchoredRowMain: {
      flex: 1,
      gap: 6,
    },
    anchoredName: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    reminderTime: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '500',
      marginTop: 2,
    },
    // Done one-shot: struck + dimmed (same idiom as a resolved comment
    // and the calendar panel's done row).
    reminderDone: {
      color: colors.textFaint,
      textDecorationLine: 'line-through',
    },
    emptyList: {
      flexGrow: 1,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 40,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 8,
    },
    emptySubtext: {
      color: colors.textFaint,
      fontSize: 14,
    },
    fab: {
      position: 'absolute',
      right: 24,
      bottom: 24,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      elevation: 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
    },
  });
