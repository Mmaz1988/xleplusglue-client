# XLE+Glue Analysis Data Model

Status: reference model for the sentence and sequence analysis implementation.

This document defines the data model for parsing one or more sentences with
XLE, deriving Glue/LFGxDRT semantics, merging sentence or sequence analyses,
resolving anaphora over a merged sequence (`DiscourseUpdate`, see "Pragmatic
and Discourse Results"), and recording the final pragmatic/NLI reasoning
checks computed over a premise/conclusion pair (`ReasoningUpdate`, see
"Reasoning Results").

Reasoning was previously declared out of scope here, which left the four
discourse checks and their Vampire verdicts with nowhere to live: they existed
only as transient values in the chat component and were discarded once used as
an accept/reject filter. `ReasoningUpdate` closes that gap and is the layer the
regression-testing interface persists against.

## Document Lifecycle

The frontend owns a monotonically growing `XlePlusGlueDocument`:

```text
XlePlusGlueDocument
  ID: String
  SEMANTIC_TYPE: String
  SENTENCES: List<Sentence>
  SEQUENCES: List<Sequence>
  ELEMENTS: List<ElementRef>     // ElementRef = { KIND: "sentence" | "sequence", ID: String }
```

Parsing the first input creates the document and its first `Sentence`. Adding
an input creates a new independent `Sentence`; it does not replace or rebuild
the existing sentence objects. The new sentence is populated by LiGER and
then GSWB before it is merged with the previous document element.

The merge creates a new `Sequence` while retaining all source sentences and
prior elements. A sequence is therefore a derived result, not the mutable
replacement for the sentence objects from which it was built.

`SENTENCES`, `SEQUENCES`, and `ELEMENTS` serve three different purposes and
all three are required. `SENTENCES` and `SEQUENCES` are canonical,
enriched-by-id registries that mirror each other: every `Sentence`/`Sequence`
that has ever been analyzed, kept current as its syntax/semantics/selection
state changes, addressable by `ID`. `ELEMENTS` is the ordered timeline the
user actually built and sees: a thin, ordered list of `{KIND, ID}` references
into those two registries, carrying no payload of its own, so it cannot
duplicate or drift from the registry entries it points at -- resolve a
reference via `resolveElement`/`findElementById` (`analysis-model.ts`) to get
the actual `Sentence`/`Sequence` object. Both share the same
`SYNTAX`/`SEMANTICS`/`SYNSEM_MAPPING` shape, so consumers like post-processing
that only need that shared shape can resolve either kind and treat it
uniformly, without `Sentence` needing to be coerced into a (needless)
single-element `Sequence` to get uniform handling.

A `Sequence` does not embed its own copy of each source sentence; it
references them by ID via `SENTENCE_IDS` and the reader resolves those IDs
against `SENTENCES` (see `Sequence` below). Earlier revisions of this model
had `Sequence` embed full `Sentence` copies alongside its own merged
syntax/semantics; those copies were populated syntax-only by the LiGER wire
response and never refreshed with semantics after the fact, so they silently
went stale. Later, `ELEMENTS` itself embedded full `Sentence`/`Sequence`
objects rather than references -- harmless in memory (the embedded object was
the same reference as the one in `SENTENCES`), but the whole document is
JSON-serialized for Redis persistence, which breaks that aliasing and
duplicates the payload in the persisted blob, with the same staleness risk on
reload. The `{KIND, ID}` reference form removes both kinds of duplication
entirely instead of trying to keep copies in sync.

## Analysis Document Lifetime

An analysis document is an exploratory working object, not a persistent user
document. It must not use the Redis endpoints or keys belonging to regression
testing.

The analysis workflow should use a separate volatile Redis namespace, for
example:

```text
analysis_document:<analysis-session-id>
```

Lifecycle rules:

- The first parse in a new analysis view creates a new document.
- Each successful sentence or sequence merge may save a new document
  revision.
- Starting a new analysis session clears the current analysis document before
  creating another one.
- The analysis view does not hydrate a document from Redis after a browser
  reload. A new interaction starts a new document.
- Redis entries should have a short expiration as protection against abandoned
  sessions.
- Clearing a document removes the complete document and its derived revisions;
  it must not affect regression-testing sessions.

Redis is therefore a short-lived coordination/cache layer for the active
analysis workflow, not the long-term source of user documents. The canonical
object remains the in-memory `XlePlusGlueDocument`; Redis protects it from
accidental frontend state replacement during the current analysis session.

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
  MEANING_CONSTRUCTORS: String (sentence syntax only)
  NUMBER_OF_MC_SETS: Integer (sentence syntax only)
```

`SYN_ID` identifies one syntactic parse or one merged syntactic analysis.
`STRUCTURE` is the LiGER linguistic structure used for rule application and
sequence construction. `GRAPH` is its visual/graph representation.
`MEANING_CONSTRUCTORS` are generated from a sentence-level syntactic analysis
and are the input to GSWB semantic deduction. They belong to the sentence
syntax analysis because different syntax variants can produce different
constructor sets. A merged sequence syntax analysis does not require meaning
constructors: its source `Sentence` objects retain the sentence-level
constructors if they need to be recovered.

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

The semantic graph is the canonical semantic payload for sequence merging.
An API may transport it directly as an ordered graph list, or wrap it in
sequence parts when sentence IDs, proof IDs, and other provenance need to be
carried alongside each graph. The semantic merge wrapper carries semantic
identity and provenance only; it does not carry the LiGER syntax structure.
Syntax structures are sent separately to LiGER for the coordinated syntax
merge. The wrapper does not replace graph merging.

## Coordinated Element Merge

Semantic merging is never treated as an independent document update. It is
one stage of a coordinated merge of two document elements:

```text
Element 1 + Element 2
  -> LiGER syntax merge
  -> GSWB semantic graph merge
  -> new Sequence
```

Both services receive the same ordered parent identities. LiGER produces the
merged syntactic analysis, while GSWB produces the merged semantic analysis
and its syntax-semantic mapping. The frontend coordinator combines those
results into one new `Sequence` object, registers it in `SEQUENCES`, and
appends an `ElementRef` for it to `ELEMENTS` (see below). Neither service
result alone is the complete sequence.

### Sentence

```text
Sentence
  ID: String
  TEXT: String
  SYNTAX: List<SyntacticAnalysis>
  SEMANTICS: List<SemanticAnalysis>
  SYNSEM_MAPPING: Map<String, List<String>>
  DISCRIMINANTS: List<GswbDiscriminant>
  SELECTED_SEMANTIC_IDS: List<String>
  SELECTED_SCOPE_IDS: List<String>
  SELECTED_MC_IDS: List<String>
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
  SENTENCE_IDS: List<String>
  SYNTAX: List<SyntacticAnalysis>
  SEMANTICS: List<SemanticAnalysis>
  SYNSEM_MAPPING: Map<String, List<String>>
```

`SENTENCE_IDS` references the source sentences by `Sentence.ID`; resolve
against `XlePlusGlueDocument.SENTENCES` to get the full, currently-enriched
`Sentence` objects. This is a plain id reference rather than an embedded
copy: the sequence-specific rebased view of a sentence's syntax/semantics
(the SYN-ID/SRC offsetting applied when a sentence is appended to a
sequence) lives entirely in the sequence's own top-level `SYNTAX`/`SEMANTICS`
below, not in anything per-sentence, so an embedded per-sentence copy would
have nothing rebased to hold and would only duplicate `SENTENCES` -- id
reference loses nothing. `SYNTAX` contains merged syntactic analyses for the
sequence. `SEMANTICS` contains merged semantic analyses associated with
those merged syntactic analyses. Sentence-level meaning constructors are
recovered from the resolved sentences, not duplicated into the merged
sequence syntax. Each semantic analysis retains a semantic graph that is
compatible with, and can be merged into, the corresponding LiGER syntax
structure.

`SEMANTICS` retains all calculated alternatives. Sentence analyses additionally
record discriminants and the active semantic IDs without destroying unselected
alternatives. Sequence construction must use only the selected semantic IDs
from sentence parents; sequence alternatives themselves do not currently have
discriminant selections.

The sequence mapping has the same shape as the sentence mapping, but its
keys and values encode the parent analyses used to construct the merged
analysis.

### ElementRef

```text
ElementRef
  KIND: "sentence" | "sequence"
  ID: String
```

An `ElementRef` is one `ELEMENTS` entry: a thin, ordered pointer into
`SENTENCES` (when `KIND` is `"sentence"`) or `SEQUENCES` (when `KIND` is
`"sequence"`), carrying no other data of its own. Resolve it with
`resolveElement(document, ref)`, or `findElementById(document, id)` when only
an id is available -- e.g. `DiscourseUpdate` stores `SOURCE_ELEMENT_ID` and
`SOURCE_ELEMENT_KIND` as separate top-level fields rather than a nested
`ElementRef`, so `findElementById` (which tries both registries by id alone)
is the natural lookup there. Both helpers live in `analysis-model.ts`. See
"Document Lifecycle" above for why `ELEMENTS` holds refs rather than
embedded `Sentence`/`Sequence` objects.

`SENTENCES` and `SEQUENCES` are not updated the same way. A `Sentence`
already in `SENTENCES` is updated incrementally: its `SYNTAX`/`SEMANTICS`
arrays are merged by id with newly-arrived entries, so alternatives computed
on an earlier pass are preserved. A `Sequence` already in `SEQUENCES` is
replaced wholesale, because a sequence merge always recomputes the full
merged object from its parents' *current* state rather than incrementally
extending a prior sequence result. Either way, an `ElementRef` is appended to
`ELEMENTS` only the first time an id is seen; a later update to an existing
`Sentence`/`Sequence` never moves or duplicates its ref.

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

For a sentence, including a sentence added to an existing document:

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

Once a sentence's syntax/semantics are available, it is upserted into
`SENTENCES` by `ID` (merging into an existing entry if one already exists,
per "ElementRef" above) and, the first time that `ID` is seen, an
`ElementRef` is appended to `ELEMENTS`.

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

The semantic merge occurs only after both input elements have complete
sentence/sequence semantic analyses. Syntax and semantics are separate merge
inputs, but both retain the same source IDs. Pragmatic annotations are not
copied from either input; they are recalculated for the new sequence.

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
syntax/semantics mapping. Instead, a `DiscourseUpdate` stacks on a completed
`Sentence` or `Sequence` the same way a `Sequence` stacks on its source
`Sentence`s: as a parallel, id-referenced structure, not as new fields on
`SentenceAnalysis`/`SequenceAnalysis` themselves.

```text
DiscourseUpdate
  ID: String
  SOURCE_ELEMENT_ID: String (Sentence.ID or Sequence.ID)
  SOURCE_ELEMENT_KIND: "sentence" | "sequence"
  RULE_STRING: String (the pronoun-binding rules applied)
  STRUCTURES: Map<StructureId, LinguisticStructure (JSON)>
  MERGED_GRAPHS: Map<StructureId, LigerWebGraph (JSON)>
  DISCOURSE: List<DiscourseAnalysis>
  SEM_DISCOURSE_MAPPING: Map<SemId, List<DiscourseId>>
```

```text
DiscourseAnalysis
  ID: String
  SEMANTIC_ORIGIN: String (SemanticAnalysis.SEM_ID this branch enriches)
  DRS_STRING: String (enriched DRS text)
  DRS_GRAPH: LigerStructure (JSON, semantic side; carries SYN-ID/SRC provenance)
  STRUCTURE_ID: String (key into DiscourseUpdate.STRUCTURES)
  SVG: String
  ANAPHORA_MAPPING: AnaphoraMapping
  COLLAPSED: Boolean

AnaphoraMapping
  RELATIONS: List<AnaphoraRelation>

AnaphoraRelation
  PRONOUN_REFERENT_ID: String
  PRONOUN_DISPLAY: String
  ANTECEDENT: String
  STATE_LABEL: String
```

`SOURCE_ELEMENT_ID` references a `Sentence`/`Sequence` `ID` rather than embedding a
copy, mirroring how `SemanticAnalysis.SYNTACTIC_ORIGIN` and composite IDs already
decouple identity from object identity elsewhere in this model. `SEM_DISCOURSE_MAPPING`
mirrors `SYNSEM_MAPPING` one level up: each semantic analysis maps one-to-many onto
enriched-DRS branches, the same way each syntactic analysis maps one-to-many onto
semantic analyses.

`ANAPHORA_MAPPING` mirrors LFGxDRT's own `AnaphoraMapping`/`AnaphoraRelation` classes
(`LFGxDRT/src/main/java/de/ukon/lfgxdrt/drs_elements/`) rather than the opaque
rendered string GSWB previously exposed on `GswbSolution.anaphoraMapping`.
`AnaphoraRelation` is one resolved (or candidate) pronoun-to-antecedent binding.
`PresuppositionMapping`/`PresuppositionRelation` exist in LFGxDRT in the same shape
and are the natural next addition once presupposition resolution is implemented, but
are not modeled here yet -- this layer currently covers anaphora resolution only.

### The two structure tiers

`STRUCTURES`/`MERGED_GRAPHS` hold two tiers that differ in *kind*, not merely in
"before/after rules". Four distinct operations are involved in reaching them, and
conflating them is a recurring source of bugs:

| Operation | Producer | Produces |
|---|---|---|
| merge syntax1 + syntax2 | LiGER `/apply_rules_xle_sequence` | `Sequence.SYNTAX` |
| merge semantics1 + semantics2 | GSWB `/merge_sequence_semantics` | `Sequence.SEMANTICS` |
| **union** of the two merged sides | LiGER `/merge_uploaded_structures` | **tier A** -- both sides co-present in one graph, but *unlinked* |
| **linking** | LiGER `/apply_rules_uploaded_structure` | **tier B** -- the *interconnected* syntax-to-semantics graph |

The union genuinely is only a union: LiGER's `LinguisticStructureMerger.merge`
deduplicates constraints and concatenates annotations, and creates no edges
between the syntax and semantics sides. **The post-processing rules are what
interconnect them**, which is the whole reason this layer stores merged graphs
at all. A component that runs the rules over merged semantics alone cannot
produce any syntax-to-semantics link, because there is no syntax in the input.

When inspecting these structures, note that a `LinguisticStructure` carries two
separate constraint lists: `constraints` (the base graph) and `annotations`
(facts added by rule application). **Rule-added links land in `annotations`, not
`constraints`.** Measured on `"Kim arrived" / "she smiled"`, tier A has 366
constraints and 4 annotations with no `SYNSEM`; tier B has the same 366
constraints and 12 annotations, the 8 new ones being exactly the `SYNSEM` links
joining each DRS referent to its f-structure node. Counting only `constraints`
makes it look as though the rules did nothing.

The join those rules perform is keyed on provenance that both sides already
carry: the semantic side contributes `SRC` and the syntax side `SYN-ID`, both
resolving to the same `i<n>` identifiers, and `DR-GF-LINK` turns a matching pair
into a `SYNSEM` edge. Every downstream anaphora rule is gated on `SYNSEM`.

The sequence workflow that leads here, in order: parse S1, derive its semantics,
parse S2, merge the syntax of S1+S2, extract S2's meaning constructors *relative
to that merged syntax*, derive S2's semantics, merge the semantics, then feed the
independently-merged sides into post-processing.

A single semantic origin can fan out into several rule-annotation variants (tier B),
and each variant can fan out into several anaphora-mapping candidates that all share
the same `LinguisticStructure`. `STRUCTURES`/`MERGED_GRAPHS` therefore store each
distinct structure once, keyed by a `StructureId`:

- `${SemId}` -- tier A, the union;
- `${SemId}-rule-${RuleBranchIndex}` -- tier B, one per rule branch, **1-based** to
  match the `parentSolutionId` sent to GSWB.

Each `DiscourseAnalysis` references one by `STRUCTURE_ID` instead of embedding a copy.
The key is deliberately *not* the anaphora-mapping id: every mapping produced from one
rule branch shares that branch's structure, so keying by mapping would store one copy
per mapping and defeat the deduplication these maps exist for. **Anaphora mappings
derive from tier B**; tier A is referenced only when no rule fired.

`STRUCTURES`/`MERGED_GRAPHS` are not redundant with the source `Sentence`/`Sequence`'s
own `SYNTAX`/`SEMANTICS`: each entry is the *output* of a LiGER round-trip -- genuinely
new server-computed content that cannot be reconstructed from the base element's syntax
and semantics without recomputation.

This layer consumes completed sequence semantic alternatives and must not
change the underlying `SYNSEM_MAPPING`.

## Reasoning Results

The four discourse checks (`info_pos_check`, `info_neg_check`,
`cons_pos_check`, `cons_neg_check`) are computed over a *pair* of document
elements -- a premise side and a conclusion side -- and are the last stage of
the pipeline. A `ReasoningUpdate` stacks on those elements the same way a
`DiscourseUpdate` stacks on one: as a parallel, id-referenced structure.

```text
ReasoningUpdate
  ID: String                                 // `ru-${ItemId}` or `ru-${PremiseIds}=>${HypothesisIds}`
  PREMISE_ELEMENT_IDS: List<String>          // Sentence.ID | Sequence.ID, ordered
  HYPOTHESIS_ELEMENT_IDS: List<String>
  SOURCE_ELEMENT_ID: String                  // the merged Sequence, when one is registered
  SOURCE_ELEMENT_KIND: "sentence" | "sequence"
  ITEM_ID: String                            // regression's NLI item id; absent in chat
  LOGIC_TYPE: "fof" | "tff"
  RULE_STRING: String
  PRUNED: Boolean
  ASSIGNMENTS: List<ReasoningAssignment>
  VERDICT: ReasoningItemVerdict              // majority vote across assignments

ReasoningAssignment
  ID: String                                 // see "Reasoning IDs" below
  PREMISE_SEMANTIC_IDS: List<String>         // positionally aligned with PREMISE_ELEMENT_IDS
  HYPOTHESIS_SEMANTIC_IDS: List<String>
  RULE_BRANCH_INDEX: Integer
  DISCOURSE_UPDATE_ID: String                // pointer into DISCOURSE_UPDATES
  DISCOURSE_ID: String                       // the DiscourseAnalysis whose mapping was used
  CONTEXT_TPTP: String
  CONTEXT_SEMANTIC_ID: String
  CHECKS: Map<CheckName, ReasoningCheck>     // exactly the four names, never fewer
  VERDICT: ReasoningVerdict                  // absent until Vampire has run
  FAILURE: String                            // set instead of usable CHECKS

ReasoningCheck
  TPTP: String
  CANONICAL_SEMANTIC: String

ReasoningVerdict
  CONSISTENT / INFORMATIVE / RELEVANT: Boolean
  GLYPH: String                              // Vampire's diagnostic SVG, not a semantic SVG
  PROOF_FILES: List<String>
```

Three modelling decisions are load-bearing.

**A reasoning check is scoped to lists of element IDs, not to one element and
not to two.** A regression NLI item has N premises and M conclusions and the
ordered groups must survive; chat is the degenerate 1+1 case of the same shape.
`PREMISE_SEMANTIC_IDS` is positionally aligned with `PREMISE_ELEMENT_IDS`: the
i-th semantic ID is a reading of the i-th element. This is the only place in
the model where array position carries meaning, so it is validated explicitly.

**The verdict belongs to the assignment, not to the individual check.** Vampire
runs all four checks for one assignment and folds them into a single
consistent/informative/relevant triple with one set of proof files. A per-check
verdict does not exist and cannot be reconstructed, so the model does not
pretend otherwise.

**A reasoning result references the anaphora mapping it used; it never copies
it.** The mapping is computed exactly once by GSWB's `/generate_pcdrs` and
threaded through to the collapse step. Re-deriving it against a duplicated
premise context makes the mapping ambiguous between the outer copy and the copy
embedded in the check's antecedent. `DISCOURSE_UPDATE_ID` + `DISCOURSE_ID`
therefore point at the `DiscourseAnalysis` branch that supplied the relations,
and both must resolve or neither may be set.

Consequently a `ReasoningUpdate` stores no structures of its own: the merged
structures a check was computed over already live in the `DiscourseUpdate`.

### Reasoning IDs

```text
ReasoningUpdate.ID     = `ru-${ItemId}`
                       | `ru-${PremiseElementIds}=>${HypothesisElementIds}`
ReasoningAssignment.ID = `${UpdateId}/P[${PremiseSemIds}]/H[${HypothesisSemIds}]`
                         + `/r${RuleBranchIndex}/m${AnaphoraBranchId}`
```

The assignment ID covers item, assignment, side, rule branch and anaphora
branch, as the caching/stable-ID requirements demand, and every component is
recoverable by parsing it -- array position is never identity. `AnaphoraBranchId`
is GSWB's PCDRS mapping ID, which is also the ID the corresponding
`DiscourseAnalysis` carries, so `DISCOURSE_ID` can be checked against the
assignment's own ID rather than trusted blindly.

A branch that cannot be prepared (collapse failed, or fewer than four checks
returned) is recorded as an assignment with `FAILURE` set rather than being
dropped. It is excluded from the Vampire payload but remains in the document as
evidence of what was attempted.

## Invariants

- IDs are unique within their containing document or sequence.
- Every semantic analysis has exactly one syntactic origin.
- Every syntax mapping value is a list, even when it has one item.
- Every mapping reference resolves to an object in the corresponding list.
- Sequence semantic alternatives retain the complete parent syntax and
  semantic provenance through composite IDs.
- Pragmatic annotations are recalculated after sequence merging.
- Sequence operations are enabled only for `lfgxdrt` analyses.
- Every `ELEMENTS` entry resolves against `SENTENCES`/`SEQUENCES` by `ID`.
- Every `DiscourseUpdate.SOURCE_ELEMENT_ID` resolves to an element in the document.
- Every `DiscourseAnalysis.STRUCTURE_ID` resolves to an entry in the owning
  `DiscourseUpdate.STRUCTURES`.
- `DiscourseUpdate` never modifies `SYNSEM_MAPPING` on its source element.
- Every `ReasoningUpdate` premise/hypothesis element ID resolves to an element
  in the document.
- Every `ReasoningAssignment.ID` parses back to its owning `ReasoningUpdate.ID`,
  and is unique within that update.
- `PREMISE_SEMANTIC_IDS`/`HYPOTHESIS_SEMANTIC_IDS` have the same length as their
  element ID lists, and each entry is a reading of the element at its position.
- Every assignment carries exactly the four check names, unless `FAILURE` is set.
- `DISCOURSE_UPDATE_ID` and `DISCOURSE_ID` are either both set and both
  resolvable, or both absent.
- `ReasoningUpdate` never modifies `SYNSEM_MAPPING` or the discourse layer it
  points at.
