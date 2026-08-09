# Inference Bank Session

`schemaVersion: 2`

## Top Level

- `metadata`: session identity and bookkeeping.
- `inputs`: grammar, testsuite, rules, axioms, and preferences.
- `analysis.system`: parser/inference outputs that come from the pipeline.
- `analysis.human`: user-selected disambiguation choices.
- `analysis.save_state`: persisted runtime cache used to restore the session.

## `metadata`

- `id`
- `redisSessionKey`
- `createdAt`
- `updatedAt`
- `testsuiteUpdateMode`
- `hasRunVampire`
- `disambiguationMode`

## `inputs`

- `grammarPath`
- `testsuite.{ filename, text, loadedText }`
- `rules.{ filename, text, loadedText }`
- `axioms.{ filename, text, loadedText }`
- `gswbPreferences`
- `vampirePreferences`

## `analysis.system`

- `sentenceMap`
- `regressionTestItems`
- `regressionTestResults`
- `inferenceResults`

## `analysis.human`

- `selectedSolutionIdsBySentence`
- `selectedScopeIdsBySentence`
- `selectedMcIdsBySentence`

## `analysis.save_state`

- `lastGswbOutputs`
- `lastAnnotations`
- `lastVampireResults`
- `lastLogicType`
- `lastVampireScopeIdsBySentence`
- `lastVampireMcIdsBySentence`
- `lastVampireSolutionIdsBySentence`
- `sortedMCmap`

## Notes

- `loadedText` is kept so the UI can tell whether a file was edited after loading.
- The runtime Angular session model remains flatter than the stored JSON.
- The stored JSON is meant to be the authoritative export/import format.
