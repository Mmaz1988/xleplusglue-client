# Regression Backend Detach Plan

Postponed for now.

## Goal

Handle backend detachment or persistent request failures in the regression testing UI without confusing them with user-initiated aborts.

## Plan

1. Add a shared backend-connection state for the regression testing interface.
2. Treat backend request failures separately from aborts.
3. Centralize recovery into one helper that can:
   - stop GSWB/Vampire polling
   - clear pending final snapshots
   - clear in-flight run/save markers
   - cancel autosave retries
   - surface a backend-down message
4. Disable backend-mutating actions while detached:
   - parse all
   - multistage
   - save current
   - save as
   - resend to Vampire
   - abort
   - any import/export path that depends on the backend
5. Keep view-only actions usable:
   - inspect results
   - scroll
   - select rows
   - open dialogs
   - copy text
6. Add error classification so transient failures do not always force full detach.
7. Add tests for:
   - abort still uses the abort path
   - backend failure enters detached state
   - detached state blocks backend actions
   - UI remains viewable in detached state

## Notes

- The detached state should behave like a safety lock, not a session reset.
- The existing abort flow is a useful cleanup pattern, but the semantics should remain separate.
