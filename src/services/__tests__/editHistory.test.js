import { createEditHistory } from '../editHistory';

const s = (content, title = 'T') => ({ title, content });

describe('createEditHistory', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(2026, 2, 10, 9, 0, 0) });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('empty history: nothing to undo or redo', () => {
    const h = createEditHistory();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
    expect(h.size()).toBe(0);
  });

  test('record on an empty history seeds the root', () => {
    const h = createEditHistory();
    h.record(s('a'));
    expect(h.size()).toBe(1);
    expect(h.canUndo(s('a'))).toBe(false);
  });

  test('reset defaults missing fields to empty strings', () => {
    const h = createEditHistory();
    h.reset();
    const { rootId } = h.getTree();
    expect(h.getSnapshot(rootId)).toEqual({ title: '', content: '' });
  });

  test('linear undo / redo walk', () => {
    const h = createEditHistory();
    h.reset(s(''));
    h.record(s('a'));
    h.record(s('ab'));
    h.record(s('abc'));

    expect(h.canUndo(s('abc'))).toBe(true);
    expect(h.canRedo(s('abc'))).toBe(false);
    expect(h.undo(s('abc'))).toEqual(s('ab'));
    expect(h.undo(s('ab'))).toEqual(s('a'));
    expect(h.undo(s('a'))).toEqual(s(''));
    expect(h.undo(s(''))).toBeNull();
    expect(h.canUndo(s(''))).toBe(false);

    expect(h.canRedo(s(''))).toBe(true);
    expect(h.redo(s(''))).toEqual(s('a'));
    expect(h.redo(s('a'))).toEqual(s('ab'));
    expect(h.redo(s('ab'))).toEqual(s('abc'));
    expect(h.redo(s('abc'))).toBeNull();
  });

  test('adjacent duplicates are not recorded', () => {
    const h = createEditHistory();
    h.reset(s('a'));
    h.record(s('a'));
    h.record(s('a'));
    expect(h.size()).toBe(1);
  });

  test('title changes are states too', () => {
    const h = createEditHistory();
    h.reset(s('body', 'One'));
    h.record(s('body', 'Two'));
    expect(h.undo(s('body', 'Two'))).toEqual(s('body', 'One'));
  });

  test('uncaptured live tail is recorded before undo', () => {
    const h = createEditHistory();
    h.reset(s(''));
    h.record(s('abc'));
    // User typed "abc-just-typed" but the debounce hasn't recorded it.
    const live = s('abc-just-typed');
    expect(h.canUndo(live)).toBe(true);
    expect(h.canRedo(live)).toBe(false);
    expect(h.undo(live)).toEqual(s('abc'));
    // The tail survived: redo brings it back.
    expect(h.redo(s('abc'))).toEqual(live);
  });

  test('redo with a live tail materializes the fork and returns null', () => {
    const h = createEditHistory();
    h.reset(s(''));
    h.record(s('a'));
    h.undo(s('a'));
    const live = s('x');
    expect(h.redo(live)).toBeNull();
    expect(h.size()).toBe(3);
    // Now at 'x'; its parent is the root.
    expect(h.undo(live)).toEqual(s(''));
  });

  test('typing after undo forks; the abandoned branch stays reachable', () => {
    const h = createEditHistory();
    h.reset(s(''));
    h.record(s('a'));
    h.record(s('ab'));
    h.undo(s('ab')); // at 'a'
    h.record(s('aX')); // fork under 'a'

    const tree = h.getTree();
    const a = tree.nodes.find((n) => h.getSnapshot(n.id).content === 'a');
    expect(a.childIds).toHaveLength(2);

    // Back at 'a', redo follows the most recently travelled child ('aX').
    expect(h.undo(s('aX'))).toEqual(s('a'));
    expect(h.redo(s('a'))).toEqual(s('aX'));

    // The old branch is still there and can be jumped to.
    const ab = tree.nodes.find((n) => h.getSnapshot(n.id).content === 'ab');
    expect(h.jumpTo(ab.id)).toEqual(s('ab'));
    expect(h.getTree().currentId).toBe(ab.id);

    // Having travelled 'ab' last, redo from 'a' now prefers it.
    h.undo(s('ab'));
    expect(h.redo(s('a'))).toEqual(s('ab'));
  });

  test('jumpTo an unknown id is a no-op', () => {
    const h = createEditHistory();
    h.reset(s('a'));
    const before = h.getTree().currentId;
    expect(h.jumpTo(999)).toBeNull();
    expect(h.getTree().currentId).toBe(before);
  });

  test('reset starts a fresh tree', () => {
    const h = createEditHistory();
    h.reset(s(''));
    h.record(s('a'));
    h.reset(s('fresh'));
    expect(h.size()).toBe(1);
    expect(h.canUndo(s('fresh'))).toBe(false);
  });

  test('getTree returns copies with timestamps', () => {
    const h = createEditHistory();
    h.reset(s(''));
    const tree = h.getTree();
    expect(tree.nodes[0].ts).toBe(new Date(2026, 2, 10, 9, 0, 0).getTime());
    tree.nodes[0].childIds.push(42);
    expect(h.getTree().nodes[0].childIds).toEqual([]);
  });

  test('limit: a linear history drops its oldest states', () => {
    const h = createEditHistory({ limit: 3 });
    h.reset(s('0'));
    for (let i = 1; i <= 5; i++) h.record(s(String(i)));
    expect(h.size()).toBe(3);
    expect(h.undo(s('5'))).toEqual(s('4'));
    expect(h.undo(s('4'))).toEqual(s('3'));
    expect(h.undo(s('3'))).toBeNull();
  });

  test('limit: a forked root keeps it; the stalest abandoned leaf goes', () => {
    const h = createEditHistory({ limit: 4 });
    h.reset(s('root'));
    h.record(s('a'));
    h.undo(s('a')); // at root
    h.record(s('b')); // root now has two children: a, b
    h.record(s('b1'));
    h.record(s('b2')); // 5 nodes -> prune

    expect(h.size()).toBe(4);
    const contents = h.getTree().nodes.map((n) => h.getSnapshot(n.id).content);
    expect(contents.sort()).toEqual(['b', 'b1', 'b2', 'root']);
  });

  test('limit: never cuts the path under the current state', () => {
    const h = createEditHistory({ limit: 1 });
    h.reset(s('0'));
    h.record(s('1'));
    // Root promoted away; the current node stays.
    expect(h.size()).toBe(1);
    expect(h.getSnapshot(h.getTree().currentId)).toEqual(s('1'));
  });
});
