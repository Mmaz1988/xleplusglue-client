# Feature Request: Glue Workspace Persistence for Editors, Settings, and Selected Files

## Summary

Make Glue/Analysis workspace persistence explicit and current so sequence workflows remain convenient while the restored workspace accurately reflects the grammar, rules, editor content, and GSWB settings that were actually in use.

This is intentionally separate from general `APP_DEFAULTS` synchronization.

## Motivation

Glue currently persists workspace state to support continuing sequence analysis. However, state is primarily captured when the Glue view is destroyed. Changes made while the view is live can therefore be absent from the persisted workspace or become unclear after restoration.

In particular:

- Grammar changes are not consistently persisted as they happen.
- Rule-file loads and rule-editor edits are not consistently persisted.
- GSWB preference changes are captured only as part of a later workspace snapshot.
- A selected file and the file actually loaded by the backend can be confused.

## Scope

This feature covers the Glue/Analysis workspace only:

- GSWB settings.
- LiGER grammar selection and loaded grammar.
- LiGER rules selection, loaded rules, and current rules editor content.
- Existing sentence, sequence, parse, and semantic workspace state needed by the current sequence workflow.

It does not change Chat or Regression Testing persistence behavior.

## Required Behavior

### GSWB settings

- Keep the current Glue behavior of restoring GSWB state to support sequence work.
- When the user changes a GSWB setting, update the in-memory workspace state.
- Persist the updated state immediately or using a small controlled debounce.
- On restoration, the persisted Glue setting is authoritative for that Glue workspace.

### Rules

The current rules editor content is the request truth.

- Editing the rules editor updates the workspace state.
- Loading a new rule file updates the editor and workspace state.
- The loaded rule path and loaded file content are tracked separately from current editor content.
- If the editor is modified after loading, restoration must preserve the modified editor content and identify it as modified where the UI supports that state.
- A failed rule load must not be recorded as the active loaded rule file.

### Grammar

Track selected and loaded grammar paths separately.

- Selecting a grammar updates the selected path only.
- A successful backend grammar load updates the loaded path.
- A failed load must not replace the loaded path.
- Workspace persistence records both values when they differ.
- On restoration, the UI must make clear which grammar was actually loaded and which path is merely selected.

### Existing sequence workflow

- Preserve the current workspace state required to continue sequences.
- Settings, grammar, and rules updates must not invalidate or silently replace the current sequence state unless an existing workflow explicitly does so.
- Workspace snapshots must remain internally consistent: restored semantic results must correspond to the editor/file state represented by the snapshot.

## Proposed State Flow

1. A Glue view initializes from `APP_DEFAULTS` and loader defaults.
2. User interaction updates the live component state.
3. Relevant state changes update `AnalysisWorkspaceStateService`.
4. The service stores a cloned snapshot, preserving the current workspace without sharing mutable references.
5. A later Glue view restores the latest Glue workspace snapshot.
6. Chat and Regression Testing do not consume this Glue workspace snapshot.

## Implementation Areas

Likely files:

- `src/app/analysis-workspace-state.service.ts`
- `src/app/glue-interface/glue-interface.component.ts`
- `src/app/liger-vis/liger-vis.component.ts`
- `src/app/gswb-vis/gswb-vis.component.ts`
- `src/app/gswb-vis/gswb-settings/gswb-settings.component.ts`
- `src/app/utilities/grammar-loader/grammar-loader.component.ts`
- `src/app/utilities/rule-loader/rule-loader.component.ts`

Likely changes:

- Add explicit workspace update methods or events for settings, grammar, and rules.
- Subscribe to those events in the owning Glue/Analysis component.
- Trigger a debounced workspace snapshot after each relevant change.
- Keep `ngOnDestroy` persistence as a final safety snapshot, not the primary synchronization mechanism.
- Preserve loaded-versus-selected file metadata in the workspace state.

## Out of Scope

- Changing which values are defined in `APP_DEFAULTS`.
- Sharing settings between application views.
- Persisting Chat settings across conversations or navigation.
- Changing Regression Testing session persistence.
- Redesigning the file-loader UI beyond the metadata needed to show accurate state.

## Potential Pitfalls

- A file can be selected without being successfully loaded. These states must not be collapsed.
- Rule editor content can diverge from the last loaded rule file. The editor must remain authoritative for requests.
- Persisting on every keystroke may create excessive cloning or storage activity. A debounce or change coalescing should be used.
- Restoring a grammar path must not imply that the backend has loaded it unless the restoration flow explicitly reloads and confirms it.
- Existing `captureState()` behavior should be reviewed for mutable nested objects and stale snapshots.
- Updating workspace state during restoration can create feedback loops. Restoration should be guarded so it does not immediately overwrite the snapshot being restored.
- The service is root-scoped and survives route changes. This is intentional for Glue sequence continuity, but its state must remain isolated from Chat and Regression Testing.

## Acceptance Criteria

- Glue sequence workflows continue to restore as they do today.
- GSWB setting changes are reflected in the persisted Glue workspace before the view is destroyed.
- Rule editor edits are reflected in the persisted Glue workspace.
- Loading a rule file persists its path and content.
- Grammar loads persist the successfully loaded path.
- Selected and loaded grammar paths remain distinguishable after restoration.
- Failed grammar/rule loads do not overwrite the last confirmed loaded file.
- Reopening Glue restores the latest settings and editor/file state.
- Chat and Regression Testing never inherit Glue workspace settings or files.
- Tests cover settings edits, rule edits, successful/failed file loads, restoration, and sequence continuity.
