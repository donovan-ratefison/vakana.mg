// Session-only undo/redo history for the entry editor (S15).
//
// A tree of {title, content} snapshots, held in RAM only. Nothing here
// touches the DB, by design: a persisted history would keep "deleted" text
// alive in the vault indefinitely, which a PIN-locked journal should never
// do silently. Close the editor and the history is gone.
//
// The model is Emacs's undo model (vundo's view of it): nothing is ever
// lost. Undo moves to the parent state; typing after an undo does NOT
// discard the redo trail. It forks a new branch, and the abandoned branch
// stays reachable (Phase 2 renders the tree; Phase 1 only walks it).
//
// Node granularity is the caller's concern. EntryEditorScreen records on
// the same 1s pause as auto-save, so history states and "Saved" states
// coincide: one mental model, bounded memory.
//
// The uncaptured-tail rule: when undo/redo is invoked while the live
// buffer has changes newer than the last recorded node (the user is
// mid-debounce), the live snapshot is recorded FIRST, then the move
// happens. Without this, undo from "abc-just-typed" would jump past "abc"
// to the state before it and lose the tail forever.

const snapshotsEqual = (a, b) =>
  !!a && !!b && a.title === b.title && a.content === b.content;

const toSnapshot = (node) => ({ title: node.title, content: node.content });

export function createEditHistory({ limit = 200 } = {}) {
  const nodes = new Map(); // id -> { id, parentId, childIds, title, content, ts, touched }
  let nextId = 1;
  let touchCounter = 0;
  let rootId = null;
  let currentId = null;

  const current = () => (currentId != null ? nodes.get(currentId) : null);
  const touch = (node) => {
    node.touched = ++touchCounter;
  };

  // Keep the tree under `limit` nodes. Two safe shrink moves, tried in
  // order: promote a single-child root (drop the oldest linear state), or
  // drop the least-recently-touched abandoned leaf (a branch tip that is
  // not the current state). If neither applies, stop shrinking rather
  // than risk cutting the path under the user's feet.
  const prune = () => {
    while (nodes.size > limit) {
      const root = rootId != null ? nodes.get(rootId) : null;
      if (root && root.childIds.length === 1 && rootId !== currentId) {
        const child = nodes.get(root.childIds[0]);
        child.parentId = null;
        nodes.delete(rootId);
        rootId = child.id;
        continue;
      }
      let victim = null;
      for (const node of nodes.values()) {
        if (node.childIds.length > 0) continue;
        if (node.id === currentId || node.id === rootId) continue;
        if (!victim || node.touched < victim.touched) victim = node;
      }
      if (!victim) break;
      nodes.get(victim.parentId).childIds = nodes
        .get(victim.parentId)
        .childIds.filter((id) => id !== victim.id);
      nodes.delete(victim.id);
    }
  };

  // Drop everything and seed a fresh root. Called once per editor session
  // (new-entry mount / loadEntry completion).
  const reset = (snapshot) => {
    nodes.clear();
    nextId = 1;
    touchCounter = 0;
    const root = {
      id: nextId++,
      parentId: null,
      childIds: [],
      title: snapshot?.title ?? '',
      content: snapshot?.content ?? '',
      ts: Date.now(),
      touched: 0,
    };
    touch(root);
    nodes.set(root.id, root);
    rootId = root.id;
    currentId = root.id;
  };

  // Record the live buffer as a new state. No-ops when it equals the
  // current node (adjacent duplicates carry no information). Recording
  // while not at a leaf is what creates a fork.
  const record = (snapshot) => {
    if (currentId == null) {
      reset(snapshot);
      return;
    }
    const cur = current();
    if (snapshotsEqual(toSnapshot(cur), snapshot)) {
      touch(cur);
      return;
    }
    const node = {
      id: nextId++,
      parentId: cur.id,
      childIds: [],
      title: snapshot.title,
      content: snapshot.content,
      ts: Date.now(),
      touched: 0,
    };
    touch(node);
    nodes.set(node.id, node);
    cur.childIds.push(node.id);
    currentId = node.id;
    prune();
  };

  const liveDiffers = (snapshot) =>
    snapshot != null &&
    currentId != null &&
    !snapshotsEqual(toSnapshot(current()), snapshot);

  // Move to the parent state and return its snapshot (null when there is
  // nowhere to go). An uncaptured live tail is recorded first, so undo
  // lands on the last state that looked different on screen.
  const undo = (liveSnapshot) => {
    if (currentId == null) return null;
    if (liveDiffers(liveSnapshot)) record(liveSnapshot);
    const cur = current();
    if (cur.parentId == null) return null;
    currentId = cur.parentId;
    const next = current();
    touch(next);
    return toSnapshot(next);
  };

  // Move to the most-recently-travelled child and return its snapshot.
  // With an uncaptured live tail there is nothing coherent to redo into:
  // the tail is recorded (materializing the fork) and null is returned;
  // the buttons re-derive their enabled state from canRedo afterwards.
  const redo = (liveSnapshot) => {
    if (currentId == null) return null;
    if (liveDiffers(liveSnapshot)) {
      record(liveSnapshot);
      return null;
    }
    const cur = current();
    if (cur.childIds.length === 0) return null;
    let best = null;
    for (const id of cur.childIds) {
      const child = nodes.get(id);
      if (!best || child.touched > best.touched) best = child;
    }
    currentId = best.id;
    touch(best);
    return toSnapshot(best);
  };

  // A live tail counts as undoable (undo returns to the last recorded
  // state) but blocks redo (the fork isn't materialized yet).
  const canUndo = (liveSnapshot) => {
    if (currentId == null) return false;
    if (liveDiffers(liveSnapshot)) return true;
    return current().parentId != null;
  };

  const canRedo = (liveSnapshot) => {
    if (currentId == null) return false;
    if (liveDiffers(liveSnapshot)) return false;
    return current().childIds.length > 0;
  };

  // Jump the pointer straight to a node (the tree sheet's restore). The
  // caller is expected to have recorded any live tail already (the sheet
  // records on open); no tail handling here.
  const jumpTo = (id) => {
    const node = nodes.get(id);
    if (!node) return null;
    currentId = id;
    touch(node);
    return toSnapshot(node);
  };

  // Phase 2 (the tree sheet) reads the raw structure through these.
  const size = () => nodes.size;
  const getTree = () => ({
    rootId,
    currentId,
    nodes: Array.from(nodes.values()).map((n) => ({
      id: n.id,
      parentId: n.parentId,
      childIds: [...n.childIds],
      ts: n.ts,
      touched: n.touched,
    })),
  });
  const getSnapshot = (id) => {
    const node = nodes.get(id);
    return node ? toSnapshot(node) : null;
  };

  return {
    reset,
    record,
    undo,
    redo,
    jumpTo,
    canUndo,
    canRedo,
    size,
    getTree,
    getSnapshot,
  };
}
