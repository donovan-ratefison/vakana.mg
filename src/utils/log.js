// Tiny logging helper for catch blocks that must not change control flow
// but must not be silent either. There is no test runner and no crash
// reporter (true local-only: no telemetry), so logcat / the Metro console
// is the only regression signal; an empty `catch {}` erases it.
//
// Usage: `} catch (e) { warn('backup.stageDb', e); }`
// Output: `[vakana:backup.stageDb] <message>`
//
// A catch that is silent ON PURPOSE (best-effort cleanup of something that
// may legitimately not exist) should stay empty, with a one-line comment
// saying why.

export function warn(scope, err) {
  console.warn(`[vakana:${scope}]`, err?.message || err);
}
