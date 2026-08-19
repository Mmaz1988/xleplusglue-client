# Feature Request: App Defaults Across Views

## Summary

Make `APP_DEFAULTS` the single source of truth for initial GSWB and reasoning/Vampire settings in the active application views, without making those defaults override user changes.

## Scope

This feature covers:

- Chat interface.
- Glue/Analysis interface initial settings.
- Regression-testing interface.
- Shared GSWB and Vampire settings initialization used by Chat and Regression Testing.

The standalone `/inference` route is not part of this feature. Its shared settings component must remain compatible because Chat and Regression Testing use it.

## Required Behavior

### New view

When a view is opened, initialize its settings from the appropriate `APP_DEFAULTS` values:

- `APP_DEFAULTS.gswb.preferences`
- `APP_DEFAULTS.vampire.chat`
- `APP_DEFAULTS.vampire.regression`

Each view receives its own cloned settings object. Defaults must not be shared by reference between views.

### Live view

After initialization, the live view owns the settings:

- User changes immediately become the active settings.
- Requests use the current live settings.
- Reapplying `APP_DEFAULTS` must not occur after a user change.
- Settings must remain available while the current view remains alive.

### Navigation between views

Settings must not be persisted globally between Chat, Glue/Analysis, and Regression Testing merely because the user navigated between views. Opening a new view starts from its defaults unless that view has an explicit saved-session workflow.

### Regression sessions

Regression Testing has an explicit exception because settings are part of a saved regression session:

1. A new regression session starts from `APP_DEFAULTS`.
2. Loading a saved session replaces the defaults with the saved GSWB and Vampire settings.
3. User changes update the active session settings.
4. Autosave/manual save persists the current settings with the session.
5. Loading another session replaces the current settings with that session's settings.

## Implementation Notes

- Remove duplicated initial GSWB/Vampire values from `createRegressionTestingSession()` and derive them from `APP_DEFAULTS`.
- Keep initialization and restoration separate:
  - Defaults initialize a new view/session.
  - Restored session state takes precedence in Regression Testing.
- Synchronize both the settings object and its form when initializing or restoring settings.
- Avoid form initialization events overwriting restored or user-owned values.
- Normalize numeric form values before constructing requests where Angular select controls may provide strings.

## Out of Scope

- Persisting Glue/Analysis workspace state. That is covered by the separate editor/settings/selected-files feature request.
- Removing or redesigning the standalone `/inference` route.
- Changing the meaning of GSWB or Vampire preference fields.

## Potential Pitfalls

- Chat currently applies an interface-specific `resolveDrs: false` override while Glue and Regression Testing use the shared default. This must either be explicitly documented as a Chat policy or removed for consistent defaults.
- Settings component constructors currently contain their own fallback values. Leaving those values in place creates a second source of truth if initialization is missed.
- `glueOnly` and `meaningOnly` are currently reconstructed as hardcoded values by the GSWB settings component. Future or restored values could be discarded unless settings are preserved deliberately.
- Numeric settings can become strings through form controls, causing comparisons such as `logic_type === 0` to behave incorrectly.

## Acceptance Criteria

- New Chat, Glue/Analysis, and Regression Testing views initialize from `APP_DEFAULTS`.
- User-edited settings remain active for all requests made by the live view.
- Navigating away and opening another non-session view does not reuse the previous view's settings.
- A loaded Regression session restores its saved settings.
- Regression setting edits are included in the saved session.
- No duplicated regression defaults contradict `APP_DEFAULTS`.
- Tests cover default initialization, live edits, and Regression session restoration.
