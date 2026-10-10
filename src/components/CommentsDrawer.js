import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DatePickerField from './DatePickerField';
import TimePickerField from './TimePickerField';
import { useKeyboardInset } from '../hooks/useKeyboardHeight';
import { useTheme } from '../theme';
import MarkdownText from './MarkdownText';
import {
  loadComments,
  addComment,
  updateCommentBody,
  deleteComment,
  setCommentResolved,
  scheduleCommentReminder,
  cancelCommentReminder,
  promoteCommentToEntry,
  chainPromotedEntryToThread,
} from '../services/comments';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const VISIBLE_DEFAULT = 10;

function formatRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (isNaN(then.getTime())) return '';
  const now = new Date();
  const ms = now - then;
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return day === 1 ? 'yesterday' : `${day}d ago`;
  if (day < 28) return `${Math.floor(day / 7)}w ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatScheduled(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Default scheduled time for a new comment-reminder: today + 1 day @ 9am.
function defaultReminderDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

// Merge helpers: the two pickers (Date + Time) bind to the same Date state,
// each replacing only its own slice of the value so picking a date doesn't
// reset the time and vice versa.
function mergeDate(base, picked) {
  const out = new Date(base);
  out.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
  return out;
}
function mergeTime(base, picked) {
  const out = new Date(base);
  out.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  return out;
}

export default function CommentsDrawer({
  visible,
  parentKind,        // 'entry' | 'thread' | 'reminder'
  parentId,
  parentLabel,       // short string used in the OS notification body
  allowReminders = true, // false when parentKind === 'reminder'
  onClose,
  onCommentsChanged, // fires after any add/edit/delete so parents can refresh chip counts
  // Fires after a promote-and-chain when the comment's parent was an entry.
  // The caller is expected to close the drawer and navigate to
  // ThreadComposer with the two prefilledEntryIds + the prefillName. When
  // null, the "...and chain" option is suppressed for entry parents (the
  // chain path needs navigation context only the caller has).
  onPromoteToThreadCompose,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const keyboardInset = useKeyboardInset();

  const [comments, setComments] = useState([]);
  const [composer, setComposer] = useState('');
  const [showAll, setShowAll] = useState(false);
  // Per-comment edit / schedule UI state.
  const [editingId, setEditingId] = useState(null);
  const [editingBody, setEditingBody] = useState('');
  const [actionsForId, setActionsForId] = useState(null);
  const [schedulingId, setSchedulingId] = useState(null);
  const [scheduleDate, setScheduleDate] = useState(defaultReminderDate());
  // 'now' for the new-comment composer schedule (so a brand-new comment can
  // be scheduled in one shot: write body, set time, send).
  const [composerSchedule, setComposerSchedule] = useState(null);
  // Comment whose promote sub-sheet is open. The sub-sheet asks for a
  // destination (just-a-bead vs ...and chain) before any DB write happens.
  const [promoteForComment, setPromoteForComment] = useState(null);

  const scrollRef = useRef(null);

  const refresh = async () => {
    if (parentId == null || !parentKind) return;
    const rows = await loadComments(parentKind, parentId);
    setComments(rows);
  };

  useEffect(() => {
    if (!visible) return;
    setShowAll(false);
    setComposer('');
    setComposerSchedule(null);
    setEditingId(null);
    setActionsForId(null);
    setSchedulingId(null);
    setPromoteForComment(null);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, parentKind, parentId]);

  const handleSend = async () => {
    const body = composer.trim();
    if (!body) return;
    const id = await addComment(parentKind, parentId, body);
    if (id != null && composerSchedule instanceof Date) {
      await scheduleCommentReminder(id, composerSchedule, parentLabel);
    }
    setComposer('');
    setComposerSchedule(null);
    await refresh();
    onCommentsChanged?.();
    // Scroll to the latest comment after send.
    setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 80);
  };

  const beginEdit = (c) => {
    setActionsForId(null);
    setEditingId(c.id);
    setEditingBody(c.body);
  };

  const commitEdit = async () => {
    if (editingId == null) return;
    await updateCommentBody(editingId, editingBody);
    setEditingId(null);
    setEditingBody('');
    await refresh();
    onCommentsChanged?.();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingBody('');
  };

  const handleDelete = async (c) => {
    setActionsForId(null);
    await deleteComment(c.id);
    await refresh();
    onCommentsChanged?.();
  };

  // Toggle the comment loop closed/open. Reversible by design (a tried
  // thing can re-open), so the gesture is its own commit: no confirm.
  const handleToggleResolved = async (c) => {
    setActionsForId(null);
    await setCommentResolved(c.id, !c.resolved_at);
    await refresh();
    onCommentsChanged?.();
  };

  const beginSchedule = (c) => {
    setActionsForId(null);
    setSchedulingId(c.id);
    setScheduleDate(c.remind_at ? new Date(c.remind_at) : defaultReminderDate());
  };

  const commitSchedule = async () => {
    if (schedulingId == null) return;
    await scheduleCommentReminder(schedulingId, scheduleDate, parentLabel);
    setSchedulingId(null);
    await refresh();
    onCommentsChanged?.();
  };

  const cancelSchedule = () => setSchedulingId(null);

  const handleClearSchedule = async (c) => {
    setActionsForId(null);
    await cancelCommentReminder(c.id);
    await refresh();
    onCommentsChanged?.();
  };

  // ---- Promote → bead (N21) ---------------------------------------------

  const openPromoteSheet = (c) => {
    setActionsForId(null);
    setPromoteForComment(c);
  };

  const closePromoteSheet = () => setPromoteForComment(null);

  // Just-a-bead path: create the entry, delete the comment, refresh + signal.
  // The drawer stays open so the user sees one fewer comment row immediately.
  const handlePromoteJust = async () => {
    const c = promoteForComment;
    if (!c) return;
    setPromoteForComment(null);
    try {
      await promoteCommentToEntry(c);
    } catch (err) {
      console.warn('promoteCommentToEntry failed:', err?.message || err);
      return;
    }
    await refresh();
    onCommentsChanged?.();
  };

  // ...and chain. Behavior depends on parent kind:
  //   - thread parent: append the new bead to this thread's chain in place.
  //   - entry parent: surface the new entry's id to the caller via
  //     onPromoteToThreadCompose so it can close the drawer and navigate
  //     into ThreadComposer with both entries' beads + the prefilled name.
  const handlePromoteAndChain = async () => {
    const c = promoteForComment;
    if (!c) return;
    setPromoteForComment(null);
    let result;
    try {
      result = await promoteCommentToEntry(c);
    } catch (err) {
      console.warn('promoteCommentToEntry failed:', err?.message || err);
      return;
    }
    if (parentKind === 'thread') {
      try {
        await chainPromotedEntryToThread(result.entryId, parentId, result.bead);
      } catch (err) {
        console.warn('chainPromotedEntryToThread failed:', err?.message || err);
      }
      await refresh();
      onCommentsChanged?.();
      return;
    }
    if (parentKind === 'entry' && onPromoteToThreadCompose) {
      // The caller handles drawer close + navigation. We still ping
      // onCommentsChanged so the parent screen's count/state refreshes.
      onCommentsChanged?.();
      onPromoteToThreadCompose({
        originEntryId: parentId,
        newEntryId: result.entryId,
        originTitle: parentLabel || '',
      });
      return;
    }
    // Reminder parent has no chain target; if we got here it's a bug.
    await refresh();
    onCommentsChanged?.();
  };

  const chainOptionAvailable =
    (parentKind === 'thread') ||
    (parentKind === 'entry' && typeof onPromoteToThreadCompose === 'function');

  const chainOptionLabel =
    parentKind === 'thread'
      ? 'Make a bead and chain with this thread'
      : 'Make a bead and chain with this entry';

  // --- Render --------------------------------------------------------------

  const visibleComments =
    showAll || comments.length <= VISIBLE_DEFAULT
      ? comments
      : comments.slice(comments.length - VISIBLE_DEFAULT);
  const hiddenCount = comments.length - visibleComments.length;

  return (
    <>
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={[styles.backdrop, keyboardInset > 0 && { paddingBottom: keyboardInset }]}
        onPress={onClose}
      >
        <Pressable
          style={[
            styles.sheet,
            keyboardInset === 0 && { paddingBottom: Math.max(12, insets.bottom + 8) },
          ]}
          onPress={() => {}}
        >
            <View style={styles.handle} />
            <Text style={styles.heading}>Comments</Text>

            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
            >
              {comments.length === 0 ? (
                <Text style={styles.emptyText}>
                  No comments yet. Add a thought.
                </Text>
              ) : null}

              {hiddenCount > 0 ? (
                <TouchableOpacity
                  onPress={() => setShowAll(true)}
                  style={styles.showOlder}
                  activeOpacity={0.7}
                >
                  <Text style={styles.showOlderText}>
                    Show {hiddenCount} older comment{hiddenCount === 1 ? '' : 's'}
                  </Text>
                </TouchableOpacity>
              ) : null}

              {visibleComments.map((c) => {
                const isEditing = editingId === c.id;
                const isScheduling = schedulingId === c.id;
                const showActions = actionsForId === c.id;
                const fired = c.remind_at && !c.reminded_at && new Date(c.remind_at) <= new Date();
                return (
                  <View key={c.id} style={styles.commentRow}>
                    <View style={[styles.dot, c.resolved_at && styles.dotResolved]} />
                    <View style={styles.commentBody}>
                      {isEditing ? (
                        <View style={styles.editBlock}>
                          <TextInput
                            style={styles.editInput}
                            value={editingBody}
                            onChangeText={setEditingBody}
                            multiline
                            autoFocus
                          />
                          <View style={styles.editActions}>
                            <TouchableOpacity
                              onPress={cancelEdit}
                              style={styles.editBtnGhost}
                            >
                              <Text style={styles.editBtnGhostText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={commitEdit}
                              style={styles.editBtnPrimary}
                              disabled={!editingBody.trim()}
                            >
                              <Text style={styles.editBtnPrimaryText}>Save</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <Pressable
                          onLongPress={() => setActionsForId(c.id)}
                          delayLongPress={300}
                        >
                          <MarkdownText
                            style={styles.bodyText}
                            strike={!!c.resolved_at}
                          >
                            {c.body}
                          </MarkdownText>
                          <View style={styles.metaRow}>
                            <Text style={styles.metaText}>
                              {formatRelative(c.created_at)}
                            </Text>
                            {c.edited_at ? (
                              <Text style={styles.metaTextFaint}> · edited</Text>
                            ) : null}
                            {c.resolved_at ? (
                              <View style={styles.resolvedTag}>
                                <Ionicons
                                  name="checkmark-circle"
                                  size={11}
                                  color={colors.textFaint}
                                />
                                <Text style={styles.resolvedTagText}>resolved</Text>
                              </View>
                            ) : null}
                            {c.remind_at && !c.reminded_at ? (
                              <View style={styles.scheduledChip}>
                                <Ionicons
                                  name="alarm-outline"
                                  size={10}
                                  color={fired ? colors.danger : colors.primary}
                                />
                                <Text
                                  style={[
                                    styles.scheduledChipText,
                                    fired && { color: colors.danger },
                                  ]}
                                >
                                  {formatScheduled(c.remind_at)}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        </Pressable>
                      )}

                      {showActions && !isEditing ? (
                        <View style={styles.actionRow}>
                          <TouchableOpacity
                            onPress={() => beginEdit(c)}
                            style={styles.actionBtn}
                          >
                            <Ionicons name="create-outline" size={14} color={colors.primary} />
                            <Text style={styles.actionText}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleToggleResolved(c)}
                            style={styles.actionBtn}
                          >
                            <Ionicons
                              name={c.resolved_at ? 'ellipse-outline' : 'checkmark-circle-outline'}
                              size={14}
                              color={colors.primary}
                            />
                            <Text style={styles.actionText}>
                              {c.resolved_at ? 'Reopen' : 'Resolve'}
                            </Text>
                          </TouchableOpacity>
                          {allowReminders ? (
                            c.remind_at && !c.reminded_at ? (
                              <>
                                <TouchableOpacity
                                  onPress={() => beginSchedule(c)}
                                  style={styles.actionBtn}
                                >
                                  <Ionicons name="alarm-outline" size={14} color={colors.primary} />
                                  <Text style={styles.actionText}>Reschedule</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  onPress={() => handleClearSchedule(c)}
                                  style={styles.actionBtn}
                                >
                                  <Ionicons name="alarm-outline" size={14} color={colors.textFaint} />
                                  <Text style={styles.actionText}>Clear</Text>
                                </TouchableOpacity>
                              </>
                            ) : (
                              <TouchableOpacity
                                onPress={() => beginSchedule(c)}
                                style={styles.actionBtn}
                              >
                                <Ionicons name="alarm-outline" size={14} color={colors.primary} />
                                <Text style={styles.actionText}>Remind</Text>
                              </TouchableOpacity>
                            )
                          ) : null}
                          <TouchableOpacity
                            onPress={() => openPromoteSheet(c)}
                            style={styles.actionBtn}
                          >
                            <Ionicons name="aperture-outline" size={14} color={colors.primary} />
                            <Text style={styles.actionText}>Make a bead</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleDelete(c)}
                            style={styles.actionBtn}
                          >
                            <Ionicons name="trash-outline" size={14} color={colors.danger} />
                            <Text style={[styles.actionText, { color: colors.danger }]}>
                              Delete
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => setActionsForId(null)}
                            style={styles.actionBtn}
                          >
                            <Text style={[styles.actionText, { color: colors.textFaint }]}>
                              Close
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}

                      {isScheduling ? (
                        <View style={styles.scheduleBlock}>
                          <View style={styles.scheduleRow}>
                            <View style={styles.scheduleCol}>
                              <DatePickerField
                                date={scheduleDate}
                                onDateChange={(d) =>
                                  setScheduleDate(mergeDate(scheduleDate, d))
                                }
                                label="Date"
                              />
                            </View>
                            <View style={styles.scheduleCol}>
                              <TimePickerField
                                date={scheduleDate}
                                onDateChange={(t) =>
                                  setScheduleDate(mergeTime(scheduleDate, t))
                                }
                                label="Time"
                              />
                            </View>
                          </View>
                          <View style={styles.editActions}>
                            <TouchableOpacity
                              onPress={cancelSchedule}
                              style={styles.editBtnGhost}
                            >
                              <Text style={styles.editBtnGhostText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={commitSchedule}
                              style={styles.editBtnPrimary}
                            >
                              <Text style={styles.editBtnPrimaryText}>Set</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.composerRow}>
              <TextInput
                style={styles.composerInput}
                placeholder="Add a thought…"
                placeholderTextColor={colors.placeholder}
                value={composer}
                onChangeText={setComposer}
                multiline
              />
              {allowReminders ? (
                <TouchableOpacity
                  onPress={() => {
                    if (composerSchedule) setComposerSchedule(null);
                    else setComposerSchedule(defaultReminderDate());
                  }}
                  style={styles.composerBell}
                  accessibilityLabel="Toggle reminder for this comment"
                >
                  <Ionicons
                    name={composerSchedule ? 'alarm' : 'alarm-outline'}
                    size={18}
                    color={composerSchedule ? colors.primary : colors.textFaint}
                  />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={handleSend}
                style={[
                  styles.sendBtn,
                  !composer.trim() && styles.sendBtnDisabled,
                ]}
                disabled={!composer.trim()}
              >
                <Ionicons name="arrow-up" size={18} color={colors.primaryOnPrimary} />
              </TouchableOpacity>
            </View>

            {composerSchedule ? (
              <View style={styles.composerScheduleRow}>
                <View style={styles.scheduleCol}>
                  <DatePickerField
                    date={composerSchedule}
                    onDateChange={(d) =>
                      setComposerSchedule(mergeDate(composerSchedule, d))
                    }
                    label="Date"
                  />
                </View>
                <View style={styles.scheduleCol}>
                  <TimePickerField
                    date={composerSchedule}
                    onDateChange={(t) =>
                      setComposerSchedule(mergeTime(composerSchedule, t))
                    }
                    label="Time"
                  />
                </View>
              </View>
            ) : null}
          </Pressable>
      </Pressable>
    </Modal>

    <Modal
      visible={promoteForComment != null}
      transparent
      animationType="fade"
      onRequestClose={closePromoteSheet}
    >
      <Pressable style={styles.promoteBackdrop} onPress={closePromoteSheet}>
        <Pressable
          style={[styles.promoteSheet, { paddingBottom: Math.max(24, insets.bottom + 8) }]}
          onPress={() => {}}
        >
          <View style={styles.handle} />
          <Text style={styles.promoteHeading}>Make a bead</Text>
          <Text style={styles.promoteHint}>
            The comment becomes a new entry. The entry has the date of today
            and the default bead. The first sentence becomes the title. The
            app deletes the initial comment.
          </Text>
          <View style={styles.promoteList}>
            <TouchableOpacity
              style={styles.promoteRow}
              onPress={handlePromoteJust}
              activeOpacity={0.7}
            >
              <Ionicons
                name="aperture-outline"
                size={18}
                color={colors.primary}
              />
              <View style={styles.promoteRowBody}>
                <Text style={styles.promoteRowTitle}>Just a bead</Text>
                <Text style={styles.promoteRowSubtitle}>
                  This makes a stand-alone entry. It is not in a chain.
                </Text>
              </View>
            </TouchableOpacity>
            {chainOptionAvailable ? (
              <TouchableOpacity
                style={[styles.promoteRow, styles.promoteRowLast]}
                onPress={handlePromoteAndChain}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="git-branch-outline"
                  size={18}
                  color={colors.primary}
                />
                <View style={styles.promoteRowBody}>
                  <Text style={styles.promoteRowTitle}>
                    {chainOptionLabel}
                  </Text>
                  <Text style={styles.promoteRowSubtitle}>
                    {parentKind === 'thread'
                      ? 'Add the new bead to the chain of this thread.'
                      : 'Open the thread composer with both beads prefilled.'}
                  </Text>
                </View>
              </TouchableOpacity>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      // Fixed share of screen height so the list always has room to breathe
      // and the composer never collapses into the heading. There is no
      // KeyboardAvoidingView here: the backdrop takes
      // `paddingBottom: keyboardInset`, which shrinks its content box, and
      // this percentage resolves against that content box. So the sheet
      // both shrinks and rides up with the keyboard while the composer
      // stays pinned to its bottom edge.
      height: '78%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
      paddingBottom: 12,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      alignSelf: 'center',
      marginBottom: 12,
    },
    heading: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: 20,
      marginBottom: 8,
    },
    list: {
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    emptyText: {
      color: colors.textFaint,
      fontSize: 14,
      fontStyle: 'italic',
      textAlign: 'center',
      paddingVertical: 20,
    },
    showOlder: {
      paddingVertical: 8,
      alignItems: 'center',
    },
    showOlderText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '600',
    },
    commentRow: {
      flexDirection: 'row',
      gap: 8,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.borderStrong,
      marginTop: 8,
      marginLeft: 4,
    },
    dotResolved: {
      backgroundColor: colors.border,
    },
    resolvedTag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      marginLeft: 4,
    },
    resolvedTagText: {
      color: colors.textFaint,
      fontSize: 11,
      fontStyle: 'italic',
    },
    commentBody: {
      flex: 1,
    },
    bodyText: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginTop: 4,
      gap: 4,
    },
    metaText: {
      color: colors.textFaint,
      fontSize: 11,
    },
    metaTextFaint: {
      color: colors.textFaint,
      fontSize: 11,
      fontStyle: 'italic',
    },
    scheduledChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      backgroundColor: colors.surfaceMuted,
      marginLeft: 4,
    },
    scheduledChipText: {
      color: colors.primary,
      fontSize: 10,
      fontWeight: '600',
    },
    editBlock: {
      gap: 6,
    },
    editInput: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
      padding: 8,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 6,
    },
    editActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
    },
    editBtnGhost: {
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    editBtnGhostText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    editBtnPrimary: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 6,
      backgroundColor: colors.primary,
    },
    editBtnPrimaryText: {
      color: colors.primaryOnPrimary,
      fontSize: 13,
      fontWeight: '600',
    },
    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 6,
      gap: 8,
    },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 6,
      backgroundColor: colors.surfaceMuted,
    },
    actionText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '600',
    },
    scheduleBlock: {
      marginTop: 8,
      gap: 6,
    },
    scheduleRow: {
      flexDirection: 'row',
      gap: 8,
    },
    scheduleCol: {
      flex: 1,
    },
    composerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 20,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    composerInput: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
      padding: 8,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      maxHeight: 100,
    },
    composerBell: {
      width: 36,
      height: 36,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sendBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sendBtnDisabled: {
      opacity: 0.4,
    },
    composerScheduleRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 20,
      paddingTop: 8,
    },
    promoteBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    promoteSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      paddingTop: 8,
      paddingBottom: 24,
    },
    promoteHeading: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: 20,
      marginTop: 4,
    },
    promoteHint: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
      paddingHorizontal: 20,
      marginTop: 6,
      marginBottom: 10,
    },
    promoteList: {
      paddingHorizontal: 20,
    },
    promoteRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    promoteRowLast: {
      borderBottomWidth: 0,
    },
    promoteRowBody: {
      flex: 1,
    },
    promoteRowTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    promoteRowSubtitle: {
      color: colors.textFaint,
      fontSize: 12,
      marginTop: 2,
      lineHeight: 16,
    },
  });
