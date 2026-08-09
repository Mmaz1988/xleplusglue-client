# LIGER Cytoscape Layout Notes

This file summarizes the current experiment for making LiGER graphs keep related node types closer together without losing the dagre hierarchy.

## What I tried

1. Hidden helper edges between same-`node_type` nodes.
2. A post-layout compaction pass that repacked nodes by type.
3. A softer post-layout pass that nudges same-type nodes toward each other instead of repacking them.

## Current approach

The graph component in `src/app/liger-vis/liger-graph-vis/graph-vis.component.ts` still uses `dagre` for the baseline layout.

After dagre finishes, the code:

- groups nodes by approximate rank using their `y` positions
- clusters nodes by `node_type` within each rank
- moves same-type nodes only partway toward their local type centroid

This keeps the hierarchy from collapsing as badly as the earlier hard compaction approach.

## Tunable values

These constants control the feel of the result:

- `typeCompactionRankTolerance`
- `typeCompactionPullStrength`
- `typeCompactionMaxShift`

The current values are intentionally conservative.

## Build status

- `npm run build` passes.

## If picking this up later

Things to try next:

1. Tune the three constants above on a few representative graphs.
2. Apply different pull strengths per node type if some types should cluster more strongly than others.
3. Skip compaction for graphs that are already small or already well ordered.
4. Consider a more structural solution if the soft nudge still feels too artificial.
