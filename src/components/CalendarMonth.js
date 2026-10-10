import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  ScrollView,
  Dimensions,
} from 'react-native';
import {
  PanGestureHandler,
  State,
} from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { formatRule, formatProgress } from '../services/recurrence';
import { isUserDayAnchor } from '../services/anchoredThreads';
import BeadView from './BeadView';

const HOLD_MS = 350;
const SWIPE_THRESHOLD = 50;
const SLIDE_DURATION = 180;
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const YEAR_RANGE_BACK = 80;
const YEAR_RANGE_FWD = 20;

const pad = (n) => n.toString().padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function getMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    cells.push(new Date(year, month, 1 + i - startOffset));
  }
  return cells;
}

function bucketFor(count) {
  if (!count) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  return 3;
}

function fillForBucket(primary, bucket) {
  const alpha = [0, 0.22, 0.45, 0.78][bucket];
  if (!alpha) return 'transparent';
  return hexWithAlpha(primary, alpha);
}

function hexWithAlpha(hex, alpha) {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return hex;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function CalendarMonth({
  entriesByDate,
  beadsByDate,
  anchoredThreads = [],
  reminders = [],
  doneReminders = [],
  commentReminders = [],
  doneCommentReminders = [],
  onVisit,
  onCreate,
  onOpenThread,
  onDeleteReminder,
  onRestoreReminder,
  onLongPressReminder,
  onOpenRecurringList,
  onOpenReminderComments,
  onOpenCommentReminder,
  reminderCommentCounts = {},
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const today = useMemo(() => new Date(), []);
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [yearPickerVisible, setYearPickerVisible] = useState(false);
  // Acked one-shots are "done business": hidden from the panel by
  // default so it stays the live ledger; the header toggle reveals them
  // (struck, restorable) on demand. Panel-local + non-persisted: a
  // context-scoped reveal, not a new standing preference.
  const [showAcked, setShowAcked] = useState(false);

  const cells = useMemo(
    () => getMonthGrid(visibleMonth.getFullYear(), visibleMonth.getMonth()),
    [visibleMonth]
  );

  const monthLabel = visibleMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const yearKey = String(visibleMonth.getFullYear());
  const monthKey = `${visibleMonth.getFullYear()}-${pad(visibleMonth.getMonth() + 1)}`;

  const remindersByDate = useMemo(() => {
    const map = {};
    for (const r of reminders) {
      if (!r.scheduled_date) continue;
      if (!map[r.scheduled_date]) map[r.scheduled_date] = [];
      map[r.scheduled_date].push(r);
    }
    return map;
  }, [reminders]);

  // Active recurring series live across all months. They are surfaced as a single
  // "Recurring (N)" header link in the panel that opens the dedicated
  // list sheet. Stopped (is_active = 0) series don't count.
  const recurringActiveCount = useMemo(
    () =>
      reminders.filter(
        (r) =>
          r.recurrence_kind &&
          (r.is_active == null || r.is_active === 1) &&
          !r.acknowledged_at
      ).length,
    [reminders]
  );

  // Calendar reminders (scheduled_prompts) and comment-reminders are
  // surfaced in the same panel: different shapes, same chronological
  // bucket. We merge into one list with a `panelKind` tag so the row
  // renderer can switch icon + tap behavior without a second loop.
  // How many acked one-shots fall in the visible month. Gates whether
  // the "view acked" toggle is shown at all (no dead control).
  const monthAckedCount = useMemo(() => {
    const oneShots = doneReminders.filter((r) =>
      (r.scheduled_date || '').startsWith(monthKey)
    ).length;
    const comments = doneCommentReminders.filter((c) => {
      if (!c.remind_at) return false;
      const d = new Date(c.remind_at);
      return (
        !isNaN(d.getTime()) &&
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}` === monthKey
      );
    }).length;
    return oneShots + comments;
  }, [doneReminders, doneCommentReminders, monthKey]);

  const monthPanelItems = useMemo(() => {
    const items = [];
    const tsOf = (item) => {
      if (item.panelKind === 'calendar') {
        return Date.parse(
          `${item.scheduled_date}T${item.scheduled_time || '00:00'}:00`
        );
      }
      return Date.parse(item.remind_at);
    };
    for (const r of reminders) {
      if ((r.scheduled_date || '').startsWith(monthKey)) {
        items.push({ panelKind: 'calendar', ...r });
      }
    }
    // Acked one-shots are hidden until the header toggle is on; when
    // shown they sit in the same chronological bucket, struck, with a
    // restore affordance (`done`). The ack is never oblivion: they
    // persist on their day and the Day view shows them regardless.
    if (showAcked) {
      for (const r of doneReminders) {
        if ((r.scheduled_date || '').startsWith(monthKey)) {
          items.push({ panelKind: 'calendar', done: true, ...r });
        }
      }
    }
    for (const c of commentReminders) {
      if (!c.remind_at) continue;
      const d = new Date(c.remind_at);
      if (isNaN(d.getTime())) continue;
      const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      if (ym === monthKey) items.push({ panelKind: 'comment', ...c });
    }
    // Acked comment-reminders join the same toggle. No restore affordance
    // (the comment was never lost: it lives in its parent's drawer); the
    // struck row still taps through to that parent.
    if (showAcked) {
      for (const c of doneCommentReminders) {
        if (!c.remind_at) continue;
        const d = new Date(c.remind_at);
        if (isNaN(d.getTime())) continue;
        const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        if (ym === monthKey) {
          items.push({ panelKind: 'comment', done: true, ...c });
        }
      }
    }
    return items.sort((a, b) => {
      const ta = tsOf(a);
      const tb = tsOf(b);
      if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
      return ta - tb;
    });
  }, [
    reminders,
    doneReminders,
    commentReminders,
    doneCommentReminders,
    monthKey,
    showAcked,
  ]);

  const { dayRibbons, monthBanners, yearMarkers } = useMemo(() => {
    const ribbons = {};
    const months = [];
    const years = [];
    for (const t of anchoredThreads) {
      if (isUserDayAnchor(t)) {
        // Only *user* day/time anchors ribbon a day. The per-day
        // auto_day thread (anchor_kind 'day', kind 'auto_day') is
        // excluded: it exists for every day with an entry, so it
        // would dilute the ribbon into a duplicate of the cell count.
        if (!t.anchor_date) continue;
        if (!ribbons[t.anchor_date]) ribbons[t.anchor_date] = [];
        ribbons[t.anchor_date].push(t);
      } else if (t.anchor_kind === 'month' && t.anchor_date === monthKey) {
        months.push(t);
      } else if (t.anchor_kind === 'year' && t.anchor_date === yearKey) {
        years.push(t);
      }
    }
    return { dayRibbons: ribbons, monthBanners: months, yearMarkers: years };
  }, [anchoredThreads, monthKey, yearKey]);

  const anchoredYears = useMemo(() => {
    const set = new Set();
    for (const t of anchoredThreads) {
      if (t.anchor_kind === 'year' && t.anchor_date) set.add(t.anchor_date);
    }
    return set;
  }, [anchoredThreads]);

  const screenWidth = Dimensions.get('window').width;
  const slideX = useRef(new Animated.Value(0)).current;
  const animatingRef = useRef(false);

  const animateAndCommit = (direction) => {
    if (animatingRef.current) return;
    animatingRef.current = true;
    const offTo = direction === 'next' ? -screenWidth : screenWidth;
    Animated.timing(slideX, {
      toValue: offTo,
      duration: SLIDE_DURATION,
      useNativeDriver: true,
    }).start(() => {
      setVisibleMonth((m) =>
        new Date(
          m.getFullYear(),
          m.getMonth() + (direction === 'next' ? 1 : -1),
          1
        )
      );
      slideX.setValue(-offTo);
      Animated.timing(slideX, {
        toValue: 0,
        duration: SLIDE_DURATION,
        useNativeDriver: true,
      }).start(() => {
        animatingRef.current = false;
      });
    });
  };

  const goPrev = () => animateAndCommit('prev');
  const goNext = () => animateAndCommit('next');
  const setYear = (year) =>
    setVisibleMonth((m) => new Date(year, m.getMonth(), 1));

  // Grid month-nav swipe via gesture-handler's PanGestureHandler (was
  // RN's PanResponder until v0.50.0; converted in v0.51.0 because gesture-
  // handler's parent PanGestureHandler in HomeScreen wins races against
  // PanResponder regardless of onPanResponderTerminationRequest, so the
  // body-cycle swipe was stealing the grid's month-nav. With both gestures
  // in the same system, gesture-handler v2's child-wins-on-child-touch
  // default takes over. This is exactly how list-row Swipeables already
  // coexist with the body pan without explicit coordination).
  //
  // Drag-follow: Animated.event drives slideX from translationX natively,
  // so the grid tracks the finger at 60fps without JS-thread jank.
  const onGridGestureEvent = useMemo(
    () =>
      Animated.event(
        [{ nativeEvent: { translationX: slideX } }],
        { useNativeDriver: true }
      ),
    [slideX]
  );

  // Commit / snap-back on release. Mirrors the PanResponder logic verbatim
  // (same SWIPE_THRESHOLD, same spring config) so behavior is identical to
  // a user. Only the underlying gesture system changed.
  const onGridStateChange = ({ nativeEvent }) => {
    if (
      nativeEvent.state !== State.END &&
      nativeEvent.state !== State.CANCELLED
    )
      return;
    if (animatingRef.current) {
      // Animation already in flight from a previous gesture: snap
      // any partial drag back to 0 and let the existing animation finish.
      Animated.spring(slideX, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
        tension: 100,
      }).start();
      return;
    }
    const { translationX, state } = nativeEvent;
    if (state === State.CANCELLED) {
      Animated.spring(slideX, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
        tension: 100,
      }).start();
      return;
    }
    if (translationX <= -SWIPE_THRESHOLD) {
      animateAndCommit('next');
    } else if (translationX >= SWIPE_THRESHOLD) {
      animateAndCommit('prev');
    } else {
      Animated.spring(slideX, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
        tension: 100,
      }).start();
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goPrev} hitSlop={10} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setYearPickerVisible(true)}
          style={styles.monthLabelWrap}
        >
          <Text style={styles.monthLabel}>{monthLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goNext} hitSlop={10} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {(monthBanners.length > 0 || yearMarkers.length > 0) && (
        <View style={styles.anchorBannerWrap}>
          {yearMarkers.map((t) => (
            <TouchableOpacity
              key={`y-${t.id}`}
              style={[styles.anchorBanner, styles.anchorBannerYear]}
              onPress={() => onOpenThread?.(t.id)}
            >
              <Ionicons name="git-branch-outline" size={12} color={colors.primary} />
              <Text style={styles.anchorBannerText} numberOfLines={1}>
                {yearKey} · {t.name}
              </Text>
            </TouchableOpacity>
          ))}
          {monthBanners.map((t) => (
            <TouchableOpacity
              key={`m-${t.id}`}
              style={styles.anchorBanner}
              onPress={() => onOpenThread?.(t.id)}
            >
              <Ionicons name="git-branch-outline" size={12} color={colors.primary} />
              <Text style={styles.anchorBannerText} numberOfLines={1}>
                {t.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={styles.weekdayText}>
            {w}
          </Text>
        ))}
      </View>

      <PanGestureHandler
        onGestureEvent={onGridGestureEvent}
        onHandlerStateChange={onGridStateChange}
        activeOffsetX={[-10, 10]}
        failOffsetY={[-20, 20]}
      >
        <Animated.View
          style={[styles.grid, { transform: [{ translateX: slideX }] }]}
        >
          {chunk(cells, 7).map((week, wi) => (
            <View key={wi} style={styles.weekRow}>
              {week.map((d, di) => {
                const inMonth = d.getMonth() === visibleMonth.getMonth();
                const key = dateKey(d);
                const count = inMonth ? entriesByDate[key] ?? 0 : 0;
                const bead = inMonth ? beadsByDate?.[key] ?? null : null;
                const ribbonCount = inMonth ? (dayRibbons[key]?.length ?? 0) : 0;
                const hasReminder = inMonth && Boolean(remindersByDate[key]?.length);
                return (
                  <DayCell
                    key={di}
                    date={d}
                    isCurrentMonth={inMonth}
                    isToday={sameDay(d, today)}
                    count={count}
                    bead={bead}
                    ribbonCount={ribbonCount}
                    hasReminder={hasReminder}
                    styles={styles}
                    colors={colors}
                    onTap={() => onVisit(dateKey(d))}
                    onLongPress={() => onCreate(dateKey(d))}
                  />
                );
              })}
            </View>
          ))}
        </Animated.View>
      </PanGestureHandler>

      <RemindersPanel
        commentCounts={reminderCommentCounts}
        onOpenComments={onOpenReminderComments}
        onOpenCommentReminder={onOpenCommentReminder}
        items={monthPanelItems}
        recurringCount={recurringActiveCount}
        ackedCount={monthAckedCount}
        showAcked={showAcked}
        onToggleAcked={() => setShowAcked((v) => !v)}
        onOpenRecurringList={onOpenRecurringList}
        styles={styles}
        colors={colors}
        onDelete={onDeleteReminder}
        onRestore={onRestoreReminder}
        onLongPressReminder={onLongPressReminder}
      />

      <YearPicker
        visible={yearPickerVisible}
        currentYear={visibleMonth.getFullYear()}
        todayYear={today.getFullYear()}
        anchoredYears={anchoredYears}
        onSelect={(year) => {
          setYear(year);
          setYearPickerVisible(false);
        }}
        onClose={() => setYearPickerVisible(false)}
      />
    </View>
  );
}

function YearPicker({ visible, currentYear, todayYear, anchoredYears, onSelect, onClose }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makePickerStyles(colors), [colors]);
  const listRef = useRef(null);
  const [years, setYears] = useState(() => {
    const arr = [];
    for (let y = todayYear - YEAR_RANGE_BACK; y <= todayYear + YEAR_RANGE_FWD; y++) arr.push(y);
    return arr;
  });

  useEffect(() => {
    if (!visible) return;
    const idx = years.indexOf(currentYear);
    if (idx >= 0) {
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.5 });
      }, 0);
    }
  }, [visible, currentYear, years]);

  const onEndReached = () => {
    setYears((prev) => {
      const last = prev[prev.length - 1];
      const next = [];
      for (let y = last + 1; y <= last + 30; y++) next.push(y);
      return prev.concat(next);
    });
  };

  const onScroll = (e) => {
    if (e.nativeEvent.contentOffset.y < 200) {
      setYears((prev) => {
        const first = prev[0];
        const next = [];
        for (let y = first - 30; y < first; y++) next.push(y);
        return next.concat(prev);
      });
    }
  };

  const renderItem = ({ item }) => {
    const isCurrent = item === currentYear;
    const isToday = item === todayYear;
    const isAnchored = anchoredYears?.has(String(item));
    return (
      <TouchableOpacity
        onPress={() => onSelect(item)}
        style={[styles.yearRow, isCurrent && styles.yearRowCurrent]}
      >
        <Text
          style={[
            styles.yearText,
            isToday && styles.yearTextToday,
            isCurrent && styles.yearTextCurrent,
          ]}
        >
          {item}
        </Text>
        {isAnchored ? (
          <View
            style={[
              styles.yearAnchorDot,
              isCurrent && styles.yearAnchorDotCurrent,
            ]}
          />
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Year</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <FlatList
            ref={listRef}
            data={years}
            keyExtractor={(y) => y.toString()}
            renderItem={renderItem}
            getItemLayout={(_, index) => ({ length: 48, offset: 48 * index, index })}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.3}
            onScroll={onScroll}
            scrollEventThrottle={64}
            showsVerticalScrollIndicator={false}
          />
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function DayCell({
  date,
  isCurrentMonth,
  isToday,
  count,
  bead = null,
  ribbonCount = 0,
  hasReminder = false,
  styles,
  colors,
  onTap,
  onLongPress,
}) {
  const bucket = bucketFor(count);
  // No heatmap fill when the day carries a bead: the bead is the signal, and a
  // tinted cell would fight the bead's own mood. Bead-less but active days keep
  // the heatmap.
  const fill =
    isCurrentMonth && !bead
      ? fillForBucket(colors.primary, bucket)
      : 'transparent';

  return (
    <View style={styles.cellWrap}>
      <TouchableOpacity
        style={[styles.cell, { backgroundColor: fill }, isToday && styles.cellToday]}
        onPress={onTap}
        onLongPress={onLongPress}
        delayLongPress={HOLD_MS}
        activeOpacity={0.7}
      >
        <View style={styles.cellTopRow}>
          <Text style={[styles.dayNumber, !isCurrentMonth && styles.dayNumberOff]}>
            {date.getDate()}
          </Text>
          {hasReminder ? (
            <Ionicons
              name="notifications"
              size={9}
              color={colors.primary}
              style={styles.cellBell}
            />
          ) : null}
        </View>
        {isCurrentMonth && bead ? (
          <View style={styles.cellBead}>
            <BeadView bead={bead} size={18} />
            {count > 1 ? (
              <Text style={styles.cellBeadMore}>+{count - 1}</Text>
            ) : null}
          </View>
        ) : isCurrentMonth && count > 0 ? (
          <Text style={styles.countText}>{count}</Text>
        ) : null}
        {ribbonCount > 0 ? <View style={styles.threadRibbon} /> : null}
      </TouchableOpacity>
    </View>
  );
}

function RemindersPanel({
  items,
  styles,
  colors,
  onDelete,
  onRestore,
  onLongPressReminder,
  onOpenComments,
  onOpenCommentReminder,
  recurringCount = 0,
  ackedCount = 0,
  showAcked = false,
  onToggleAcked,
  onOpenRecurringList,
  commentCounts = {},
}) {
  return (
    <View style={styles.remindersWrap}>
      <View style={styles.remindersHeaderRow}>
        <Text style={styles.remindersHeader}>Reminders this month</Text>
        <View style={styles.remindersHeaderActions}>
          {ackedCount > 0 && onToggleAcked ? (
            <TouchableOpacity
              onPress={onToggleAcked}
              hitSlop={6}
              style={styles.recurringLink}
              accessibilityLabel={`${showAcked ? 'Hide' : 'View'} ${ackedCount} acknowledged reminder${ackedCount === 1 ? '' : 's'} this month`}
            >
              <Ionicons
                name={showAcked ? 'eye-off-outline' : 'eye-outline'}
                size={12}
                color={showAcked ? colors.primary : colors.textFaint}
              />
              <Text
                style={[
                  styles.recurringLinkText,
                  !showAcked && { color: colors.textFaint },
                ]}
              >
                Acked ({ackedCount})
              </Text>
            </TouchableOpacity>
          ) : null}
          {recurringCount > 0 && onOpenRecurringList ? (
            <TouchableOpacity
              onPress={onOpenRecurringList}
              hitSlop={6}
              style={styles.recurringLink}
              accessibilityLabel={`Recurring reminders: ${recurringCount}. Tap to manage.`}
            >
              <Ionicons name="repeat" size={12} color={colors.primary} />
              <Text style={styles.recurringLinkText}>
                Recurring ({recurringCount})
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      {!items || items.length === 0 ? (
        <Text style={styles.remindersEmpty}>
          No reminders scheduled. Tap + to add one.
        </Text>
      ) : (
        <ScrollView
          style={styles.remindersScroll}
          contentContainerStyle={styles.remindersScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {items.map((item) =>
            item.panelKind === 'comment' ? (
              <CommentReminderRow
                key={`c-${item.id}`}
                item={item}
                styles={styles}
                colors={colors}
                onOpen={onOpenCommentReminder}
              />
            ) : (
              <CalendarReminderRow
                key={`r-${item.id}`}
                item={item}
                styles={styles}
                colors={colors}
                commentCount={commentCounts[item.id] ?? 0}
                onOpenComments={onOpenComments}
                onDelete={onDelete}
                onRestore={onRestore}
                onLongPress={onLongPressReminder}
              />
            )
          )}
        </ScrollView>
      )}
    </View>
  );
}

function CalendarReminderRow({
  item: r,
  styles,
  colors,
  commentCount,
  onOpenComments,
  onDelete,
  onRestore,
  onLongPress,
}) {
  // A done one-shot: struck, no long-press/delete (it's past business),
  // and a restore action instead. The ack was reversible all along.
  const done = !!r.done;
  const dt = new Date(r.scheduled_date + 'T' + (r.scheduled_time || '00:00'));
  const label = dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const isRecurring = !!r.recurrence_kind;
  const ruleLine = isRecurring
    ? `${formatRule({
        kind: r.recurrence_kind,
        every: r.recurrence_every || 1,
        scheduledDate: r.scheduled_date,
      })}  ·  ${formatProgress({
        fired: r.recurrence_fired || 0,
        max: r.recurrence_max,
      })}`
    : null;
  return (
    <TouchableOpacity
      style={styles.reminderRow}
      onLongPress={!done && onLongPress ? () => onLongPress(r) : undefined}
      delayLongPress={350}
      activeOpacity={!done && onLongPress ? 0.7 : 1}
      disabled={done || !onLongPress}
    >
      <Ionicons
        name={done ? 'checkmark-done' : isRecurring ? 'repeat' : 'notifications-outline'}
        size={14}
        color={done ? colors.textFaint : colors.primary}
        style={styles.reminderIcon}
      />
      <View style={styles.reminderInfo}>
        <Text
          style={[styles.reminderTitle, done && styles.reminderTextDone]}
          numberOfLines={1}
        >
          {r.title || 'Journal Reminder'}
        </Text>
        <Text style={[styles.reminderMeta, done && styles.reminderTextDone]}>
          {label} · {r.scheduled_time}
          {done ? ' · done' : ''}
        </Text>
        {ruleLine ? (
          <Text style={styles.reminderMetaFaint} numberOfLines={1}>
            {ruleLine}
          </Text>
        ) : null}
      </View>
      {onOpenComments ? (
        <TouchableOpacity
          onPress={() => onOpenComments(r)}
          style={styles.reminderComments}
          hitSlop={6}
          accessibilityLabel={`${commentCount} comment${commentCount === 1 ? '' : 's'} on this reminder`}
        >
          <Ionicons
            name="chatbubble-outline"
            size={14}
            color={colors.primary}
          />
          {commentCount > 0 ? (
            <Text style={styles.reminderCommentsCount}>{commentCount}</Text>
          ) : null}
        </TouchableOpacity>
      ) : null}
      {done ? (
        onRestore ? (
          <TouchableOpacity
            onPress={() => onRestore(r)}
            style={styles.reminderDelete}
            hitSlop={6}
            accessibilityLabel="Restore this reminder"
          >
            <Ionicons
              name="arrow-undo-outline"
              size={16}
              color={colors.primary}
            />
          </TouchableOpacity>
        ) : null
      ) : onDelete ? (
        <TouchableOpacity
          onPress={() => onDelete(r)}
          style={styles.reminderDelete}
          hitSlop={6}
        >
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

// Comment-reminder row in the calendar panel. Distinct chatbubble icon so
// the user can tell self-pings from prompt-reminders without reading the
// text. Tap routes to the parent and auto-opens the drawer (same behavior
// as the home banner). The fired vs upcoming distinction shows up via the
// dot color: danger when the time has passed without an ack.
function CommentReminderRow({ item: c, styles, colors, onOpen }) {
  const dt = new Date(c.remind_at);
  const label = dt.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  // `done` = acked (revealed by the panel's "view acked" toggle). Struck,
  // no fired/danger emphasis. Still taps through to the parent. The
  // comment itself was never lost, it lives in that drawer.
  const done = !!c.done;
  const fired = !done && dt.getTime() <= Date.now();
  return (
    <TouchableOpacity
      onPress={() => onOpen?.(c)}
      style={styles.reminderRow}
      activeOpacity={0.7}
      accessibilityLabel={`Comment reminder on ${c.parent_label || 'a comment'}${done ? ' (acknowledged)' : ''}`}
    >
      <Ionicons
        name="chatbubble-ellipses-outline"
        size={14}
        color={done ? colors.textFaint : fired ? colors.danger : colors.primary}
        style={styles.reminderIcon}
      />
      <View style={styles.reminderInfo}>
        <Text
          style={[styles.reminderTitle, done && styles.reminderTextDone]}
          numberOfLines={1}
        >
          {c.parent_label || 'Comment reminder'}
        </Text>
        <Text
          style={[styles.reminderMeta, done && styles.reminderTextDone]}
          numberOfLines={1}
        >
          {c.body}
        </Text>
        <Text
          style={[
            styles.reminderMetaFaint,
            fired && { color: colors.danger },
            done && styles.reminderTextDone,
          ]}
        >
          {label}
          {done ? ' · done' : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    navBtn: {
      width: 32,
      height: 32,
      justifyContent: 'center',
      alignItems: 'center',
    },
    monthLabelWrap: { paddingHorizontal: 8, paddingVertical: 4 },
    monthLabel: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    weekdayRow: {
      flexDirection: 'row',
      paddingVertical: 4,
    },
    weekdayText: {
      flex: 1,
      textAlign: 'center',
      color: colors.textFaint,
      fontSize: 11,
      fontWeight: '600',
    },
    grid: {
      flexDirection: 'column',
    },
    weekRow: {
      flexDirection: 'row',
    },
    cellWrap: {
      flex: 1,
      aspectRatio: 1,
      padding: 2,
    },
    cell: {
      flex: 1,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 4,
      paddingTop: 4,
      paddingBottom: 4,
      justifyContent: 'space-between',
    },
    cellToday: {
      borderColor: colors.primary,
      borderWidth: 2,
    },
    cellTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    cellBell: {
      marginLeft: 2,
    },
    dayNumber: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '500',
    },
    dayNumberOff: {
      color: colors.textFaint,
      fontWeight: '400',
    },
    countText: {
      alignSelf: 'flex-end',
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    // The day's representative bead, centred in the cell (calendar-as-beads).
    cellBead: {
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    // "+N" admitting a day holds more than the one bead shown (decision 4).
    cellBeadMore: {
      color: colors.textFaint,
      fontSize: 7,
      fontWeight: '700',
      marginTop: -1,
    },
    threadRibbon: {
      position: 'absolute',
      left: 4,
      right: 4,
      bottom: 3,
      height: 2,
      borderRadius: 1,
      backgroundColor: colors.primary,
      opacity: 0.8,
    },
    anchorBannerWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      paddingVertical: 6,
    },
    anchorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 12,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      maxWidth: '100%',
    },
    anchorBannerYear: {
      borderColor: colors.primary,
    },
    anchorBannerText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
    },
    remindersWrap: {
      flex: 1,
      minHeight: 0,
      paddingTop: 16,
      paddingBottom: 8,
    },
    remindersScroll: {
      flex: 1,
    },
    remindersScrollContent: {
      paddingBottom: 8,
    },
    remindersHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    remindersHeader: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    remindersHeaderActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    recurringLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 4,
      paddingHorizontal: 6,
    },
    recurringLinkText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '600',
    },
    remindersEmpty: {
      color: colors.textFaint,
      fontSize: 13,
      fontStyle: 'italic',
    },
    reminderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    reminderIcon: {
      marginRight: 8,
    },
    reminderInfo: {
      flex: 1,
    },
    reminderTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    reminderMeta: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '500',
      marginTop: 2,
    },
    reminderMetaFaint: {
      color: colors.textFaint,
      fontSize: 11,
      marginTop: 2,
    },
    // Done one-shot: struck + dimmed (same idiom as a resolved comment).
    reminderTextDone: {
      color: colors.textFaint,
      textDecorationLine: 'line-through',
    },
    reminderDelete: {
      padding: 6,
    },
    reminderComments: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingVertical: 4,
      paddingHorizontal: 6,
    },
    reminderCommentsCount: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '600',
    },
  });

const makePickerStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    sheet: {
      width: '100%',
      maxWidth: 280,
      height: '60%',
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    sheetHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    sheetTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    yearRow: {
      height: 48,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
    },
    yearRowCurrent: {
      backgroundColor: colors.primary,
    },
    yearText: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '500',
      fontVariant: ['tabular-nums'],
    },
    yearTextToday: {
      color: colors.primary,
      fontWeight: '700',
    },
    yearTextCurrent: {
      color: colors.primaryOnPrimary,
      fontWeight: '700',
    },
    yearAnchorDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.primary,
    },
    yearAnchorDotCurrent: {
      backgroundColor: colors.primaryOnPrimary,
    },
  });

// Memoized so the calendar can stay mounted (hidden) without re-rendering on
// every HomeScreen state change. Compares only the data props; handler props
// (navigation / setState) are staleness-resilient and intentionally ignored.
// Theme changes still propagate: colors come from useTheme() via context,
// which React.memo does not block.
export default React.memo(CalendarMonth, (a, b) =>
  a.entriesByDate === b.entriesByDate &&
  a.beadsByDate === b.beadsByDate &&
  a.anchoredThreads === b.anchoredThreads &&
  a.reminders === b.reminders &&
  a.doneReminders === b.doneReminders &&
  a.commentReminders === b.commentReminders &&
  a.doneCommentReminders === b.doneCommentReminders &&
  a.reminderCommentCounts === b.reminderCommentCounts);
