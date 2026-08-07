# XLE+Glue Analysis Data Model

Status: reference model for the sentence and sequence analysis implementation.

This document defines the data model for parsing one or more sentences with
XLE, deriving Glue/LFGxDRT semantics, and merging sentence or sequence
analyses. Discourse updates and final pragmatic reasoning are deliberately
outside the core model described here.

## Scope

A `LigerDocument` contains one or more sentences. A sentence may have:

- multiple syntactic analyses;
- multiple semantic analyses for each syntactic analysis; and
- pragmatic alternatives that are calculated only after sequence merging.

Sequencing is currently supported only for the `lfgxdrt` semantic type. The
frontend must prevent sequence operations for other semantic types.

All elements used in a sequence are assumed to have been created with the
same parser, grammar, LiGER rules, and semantic settings. Compatibility is a
frontend precondition. The backend may validate this defensively, but normal
workflow control belongs in the frontend.

## Core Types

### SyntacticAnalysis

```text
SyntacticAnalysis
  SYN_ID: String
  STRUCTURE: LinguisticStructure (JSON)
  GRAPH: LigerWebGraph (JSON)
  MEANING_CONSTRUCTORS: String
  NUMBER_OF_MC_SETS: Integer
```

`SYN_ID` identifies one syntactic parse or one merged syntactic analysis.
`STRUCTURE` is the LiGER linguistic structure used for rule application and
sequence construction. `GRAPH` is its visual/graph representation.
`MEANING_CONSTRUCTORS` are generated from this syntactic analysis and are the
input to GSWB semantic deduction. They belong to the syntactic analysis
because different syntax variants can produce different constructor sets.

### SemanticAnalysis

```text
SemanticAnalysis
  SYNTACTIC_ORIGIN: String
  SEM_ID: String
  SEM_STRING: String
  STRUCTURE: LinguisticStructure (JSON)
  GRAPH: LigerWebGraph (JSON)
  SEM_TYPE: String
  SVG: String | PROLOG_RENDER: String
```

`SYNTACTIC_ORIGIN` references the `SYN_ID` for which the semantic analysis
was derived. `SEM_TYPE` is currently expected to be `lfgxdrt` for sequence
operations, but the model permits other semantic types for single-sentence
analysis.

The semantic graph is produced by LFGxDRT/GSWB and represented in a form that
can be combined with the corresponding LiGER linguistic structure. The two
graphs have different roles and provenance: LiGER supplies the linguistic
syntax and annotations, while GSWB/LFGxDRT supplies the semantic DRS graph.
They are nevertheless intentionally compatible graph layers. The frontend
uses LiGER's structure/graph merge operation to produce a combined graph for
the graph inspector and later discourse processing.

### Sentence

```text
Sentence
  ID: String
  TEXT: String
  SYNTAX: List<SyntacticAnalysis>
  SEMANTICS: List<SemanticAnalysis>
  SYNSEM_MAPPING: Map<String, List<String>>
```

`SYNSEM_MAPPING` maps each syntactic analysis to all semantic analyses that
were derived from it:

```json
{
  "syn-1": ["sem-1", "sem-2"],
  "syn-2": ["sem-3"]
}
```

Every semantic ID in the mapping must occur in `SEMANTICS`, and every
semantic analysis must have a `SYNTACTIC_ORIGIN` that occurs in `SYNTAX`.

### Sequence

```text
Sequence
  ID: String
  TEXT: String
  SENTENCES: List<Sentence>
  SYNTAX: List<SyntacticAnalysis>
  SEMANTICS: List<SemanticAnalysis>
  SYNSEM_MAPPING: Map<String, List<String>>
```

`SENTENCES` contains the source sentence objects. `SYNTAX` contains merged
syntactic analyses for the sequence. `SEMANTICS` contains merged semantic
analyses associated with those merged syntactic analyses. Each semantic
analysis retains a semantic graph that is compatible with, and can be merged
into, the corresponding LiGER syntax structure.

The sequence mapping has the same shape as the sentence mapping, but its
keys and values encode the parent analyses used to construct the merged
analysis.

## Composite IDs and Provenance

Parentage is encoded in canonical composite IDs. For example:

```text
syn-1 + syn-4 -> syn-1+syn-4
sem-1 + sem-7 -> sem-1+sem-7
```

The resulting mapping can be:

```json
{
  "syn-1+syn-4": [
    "sem-1+sem-7",
    "sem-2+sem-7"
  ]
}
```

This allows the source analyses to be restored through `SENTENCES` without
requiring separate parentage fields in the initial implementation.

Composite ID rules:

- The separator is reserved and cannot occur unescaped in component IDs.
- Component order is significant and follows document order.
- A composite ID is formed by concatenating the complete ordered parent ID
  components; it must not depend on array position.
- A merged semantic ID must identify the semantic parent combination, not
  merely the resulting semantic string.

For recursive merges, composite IDs remain ordered and may contain already
composite IDs. Implementations should canonicalize them so equivalent parent
lists always produce the same ID.

## Sentence Analysis Workflow

For a sentence:

```text
text
  -> XLE parsing
  -> syntactic analyses
  -> sentence-level LiGER rules
  -> SyntacticAnalysis[]
  -> GSWB/LFGxDRT deduction for each syntax analysis
  -> SemanticAnalysis[]
  -> SYNSEM_MAPPING
```

Sentence-level pragmatic alternatives are not merged into
`SYNSEM_MAPPING`. They are derived later from a completed sentence or
sequence structure.

## Sequence Merge Workflow

The supported merge operation is:

```text
Sentence + Sentence
Sequence + Sentence
Sequence + Sequence
```

Before merging, the frontend must verify:

- both elements use semantic type `lfgxdrt`;
- sentence order is known;
- each syntactic and semantic reference is internally valid; and
- both elements satisfy the current sequencing configuration.

For elements `S1` and `S2`:

1. Take every syntactic analysis from `S1` and every syntactic analysis from
   `S2`.
2. Run the LiGER sequencing workflow for each syntactic pair. This creates
   the linguistic structure into which the corresponding semantic graph can
   later be merged.
3. Create one merged `SyntacticAnalysis` for each successful pair.
4. Look up all semantic analyses mapped from the two parent syntax IDs.
5. Form every semantic pair from those lists.
6. Merge each semantic pair with GSWB/LFGxDRT.
7. Create merged `SemanticAnalysis` objects with composite IDs. Their
   LFGxDRT/GSWB graphs remain compatible semantic layers of the merged LiGER
   structures.
8. Use the LiGER/GSWB structure merge operation to create the combined graph
   used for visualization and later discourse processing.
9. Build the new sequence `SYNSEM_MAPPING` from each merged syntax ID to all
   corresponding merged semantic IDs.
10. Recalculate pragmatic annotations only after the sequence structure and
   semantic alternatives exist.

Formally, for syntax IDs `a` and `b`:

```text
SYNSEM_MAPPING_1[a] = [sem-a1, sem-a2]
SYNSEM_MAPPING_2[b] = [sem-b1]

merged syntax:   a+b
merged semantics: [sem-a1+sem-b1, sem-a2+sem-b1]
```

No semantic alternative may be discarded merely because another alternative
exists for the same syntax pair.

## Reuse and Derived Artifacts

Sentence analyses are reusable inputs. A sequence is a derived artifact
created from a particular combination of sentence syntax and semantics.

The implementation should:

- retain sentence syntax variants after sentence analysis;
- retain sentence semantic variants and their mapping;
- avoid reparsing unchanged sentence structures;
- reuse an existing sequence result when its parent IDs and sequencing
  operation are unchanged; and
- rebuild only the sequence combinations affected by a new or changed
  element.

The assembled sequence is not itself a replacement for its source sentences.
It is an additional derived object with explicit composite IDs.

## Pragmatic and Discourse Results

Pragmatic annotations, including pronoun mappings, are calculated after
sequence construction because the complete linguistic structure is required
to determine possible antecedents.

They are therefore not part of the base `Sentence` or `Sequence`
syntax/semantics mapping. A later result may be represented as:

```text
DiscourseUpdate
  CONTEXT: Sentence | Sequence
  UPDATE: Sentence
  ANAPHORA_MAPPING: String
  NLI_CHECKS: String
```

This layer consumes completed sequence semantic alternatives and must not
change the underlying `SYNSEM_MAPPING`.

## Invariants

- IDs are unique within their containing document or sequence.
- Every semantic analysis has exactly one syntactic origin.
- Every syntax mapping value is a list, even when it has one item.
- Every mapping reference resolves to an object in the corresponding list.
- Sequence semantic alternatives retain the complete parent syntax and
  semantic provenance through composite IDs.
- Pragmatic annotations are recalculated after sequence merging.
- Sequence operations are enabled only for `lfgxdrt` analyses.
