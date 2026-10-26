import type { AnaphoraRankingTable } from '../analysis-model';
import { SafeHtml } from '@angular/platform-browser';
import { RegressionRunReport, emptyRunReport } from '../regression-testing-interface/run-report';

/** A batch parse: per sentence id, exactly what `/apply_rules_xle` returns for that
 *  sentence -- one `LigerSolutionAnnotation` per syntactic analysis, each with its own
 *  `structureJson`, `structureVariants`, `sentenceAnalysis`, graph and meaning
 *  constructors. Was one `LigerRuleAnnotation` per sentence carrying none of that. */
export interface LigerBatchParsingAnalysis {
  annotations: { [key: string]: LigerSolutionAnnotationResponse };
  ruleApplicationGraph: LigerGraphComponent[];
  report: string;
  /** Per sentence id: milliseconds for its XLE parse and rule application. */
  timingsMs?: { [key: string]: number };
}

/** The pre-Stage-4 batch shape, still returned by `/multistage_to_batch` and
 *  `/apply_rules_to_dependency_batch` -- endpoints with different semantics that were not
 *  migrated. */
export interface LigerRuleAnnotationBatchAnalysis {
  annotations: { [key: string]: LigerRuleAnnotation };
  ruleApplicationGraph: LigerGraphComponent[];
  report: string;
}


//Unify Liger and Stanza models

export interface LigerRule {
  rule: string;
  index: number;
  lineNumber: number;
}

/** LiGER's /load_rules answer for a LiGER config (*.liger.yaml) or a single rule file.
 *  A config gets exactly what it lists; a single rule file is the semantics stage only.
 *  Loading either makes its lexica (none, for a rule file) the ones LiGER's lex/2 uses. */
export interface LigerRuleSet {
  kind: 'config' | 'rules';
  /** The path that was loaded. */
  source: string;
  /** Rules applied to the parse before semantic composition (ruleString of /parse etc.). */
  semantics: string;
  /** Post-processing rules for /apply_rules_uploaded_structure; null if LiGER has none. */
  pragmatics: string | null;
  lexica: string[];
  /** The config's TPTP axiom files, concatenated; null when it lists none. */
  axioms: string | null;
}

/** Pragmatic post-processing (SYNSEM links, anaphora, presuppositions) runs the rule set's
 *  pragmatics rules. A config gets exactly what it lists and a single rule file has none.
 *  Running the rules by hand (graph inspector, the analysis view's "Post processing") is
 *  blocked without them, with this message; reasoning skips them, see below. */
export const MISSING_PRAGMATICS_MESSAGE =
  'Pragmatic post-processing needs pragmatics rules, and the loaded rule set lists none, or '
  + 'none is selected for this run. Open a LiGER config with a pragmatics section, or select '
  + 'its pragmatics files below the rule editor.';

/** Shown when reasoning runs without pragmatics rules: the checks are built over the merged
 *  DRS as it is, and no pronoun is bound. */
export const POST_PROCESSING_SKIPPED_NOTICE =
  'No pragmatics rules: post-processing was skipped, so no pronoun was resolved. Each '
  + 'pronoun is reasoned over as a new referent.';

/** Whether `ruleString` holds at least one rule: something with a rule arrow (`==>`, `?=>`)
 *  once `//` comments are removed. Empty, blank and comment-only strings hold none. */
export function hasPostProcessingRules(ruleString: string | null | undefined): boolean {
  return !!ruleString && ruleString
    .split('\n')
    .some(line => line.replace(/\/\/.*$/, '').includes('=>'));
}

/** LiGER's /config_tree answer: a config's (or single rule file's) files per field, unread.
 *  Joining a section's files the way LigerConfigLoader.assemble does reproduces /load_rules'
 *  text for that field (see liger-workspace/liger-assembly.ts). */
export interface LigerConfigTree {
  kind: 'config' | 'rules';
  /** The path that was loaded, as requested. */
  source: string;
  /** The config's scope folder, absolute (a single rule file's own folder): where its files
   *  belong, and where the workspace browses for more. */
  scope: string;
  /** The project's grammars folder (real path), or null: the workspace browses no higher. */
  projectRoot: string | null;
  /** semantics, pragmatics, lexica, axioms, in that order; always all four. */
  sections: LigerConfigTreeSection[];
}

export type LigerConfigField = 'semantics' | 'pragmatics' | 'lexica' | 'axioms';

export interface LigerConfigTreeSection {
  field: LigerConfigField;
  /** False when the loaded file does not list the field (nothing is inherited); then
   *  /load_rules reports it as null (lexica: empty) and files is empty. */
  present: boolean;
  files: LigerConfigTreeFile[];
}

export interface LigerConfigTreeFile {
  /** Absolute; exactly as /load_rules names it in its "===== path =====" marker lines. */
  path: string;
  name: string;
  /** False for a file outside the config's scope: allowed, but worth seeing. */
  inScope: boolean;
  /** Rules (semantics, pragmatics), labels (lexica) or formulas (axioms) in the file, as on
   *  disk; null when LiGER could not count them. */
  count: number | null;
}

export type SynSemMapping = Record<string, string[]>;

/** The axioms a structure's LiGER rules added, untranslated: AXIOM values as Prolog
 *  FOL/DRS terms, TPTP_AXIOM values as TPTP formulas, TFF_TYPE values as tff type
 *  declaration bodies (`big: ($i * $int) > $o`). The Vampire service encodes them for the
 *  logic type of the run that uses them, declaring each type once and only in tff (see
 *  grammarAxiomsOf). `tffTypes` is absent from parses stored before it existed. */
export interface GrammarAxioms {
  prolog: string[];
  tptp: string[];
  tffTypes?: string[];
}

/** The union of several axiom sets, order kept, duplicates dropped. */
export function mergeGrammarAxioms(sets: Array<GrammarAxioms | null | undefined>): GrammarAxioms {
  const prolog = new Set<string>();
  const tptp = new Set<string>();
  const tffTypes = new Set<string>();
  for (const set of sets) {
    (set?.prolog ?? []).forEach(term => term?.trim() && prolog.add(term.trim()));
    (set?.tptp ?? []).forEach(formula => formula?.trim() && tptp.add(formula.trim()));
    (set?.tffTypes ?? []).forEach(type => type?.trim() && tffTypes.add(type.trim()));
  }
  return { prolog: [...prolog], tptp: [...tptp], tffTypes: [...tffTypes] };
}

/** How many entries an axiom set holds, types included. */
export function grammarAxiomCount(axioms: GrammarAxioms | null | undefined): number {
  return (axioms?.prolog?.length ?? 0) + (axioms?.tptp?.length ?? 0) + (axioms?.tffTypes?.length ?? 0);
}

export interface SyntacticAnalysis {
  synId: string;
  structure: LigerStructure;
  graph: LigerWebGraph;
  meaningConstructors?: string;
  numberOfMCsets?: number;
  appliedRules?: LigerRule[];   // from LigerRuleAnnotation.appliedRules -- per syntax variant
  axioms?: GrammarAxioms;       // from LigerRuleAnnotation.axioms -- per syntax variant
}

export interface SemanticAnalysis {
  syntacticOrigin: string;
  semId: string;
  semString: string;
  structure?: LigerStructure;
  graph?: LigerStructure;
  semType: string;
  svg?: string;
  prologRender?: string;
}

export type GswbSemanticAnalysis = SemanticAnalysis;

export interface SentenceAnalysis {
  id: string;
  text: string;
  syntax: SyntacticAnalysis[];
  semantics: SemanticAnalysis[];
  synSemMapping: SynSemMapping;
  discriminants?: GswbDiscriminant[];
  selectedSemanticIds?: string[];
  selectedScopeIds?: string[];
  selectedMcIds?: string[];
}

/** LiGER's wire shape for a sequence solution. The embedded `sentences` copies are
 *  populated syntax-only by LiGER's sequenceSyntaxAnalysis and never refreshed with
 *  semantics -- do not use this for anything beyond immediate wire handling; the
 *  canonical app model is `SequenceAnalysis` below. */
export interface LigerSequenceAnalysis {
  id: string;
  text: string;
  sentences: SentenceAnalysis[];
  syntax: SyntacticAnalysis[];
  semantics: SemanticAnalysis[];
  synSemMapping: SynSemMapping;
}

export interface SequenceAnalysis {
  id: string;
  text: string;
  sentenceIds: string[];   // resolve against XlePlusGlueDocument.sentences
  syntax: SyntacticAnalysis[];
  semantics: SemanticAnalysis[];
  synSemMapping: SynSemMapping;
}

export type XlePlusGlueElement = SentenceAnalysis | SequenceAnalysis;

/** A thin, ordered reference into `sentences`/`sequences` -- records only which element
 *  occupies a given position in the document's timeline and which registry to resolve it
 *  against. Carries no payload of its own, so it cannot duplicate or go stale relative to
 *  the canonical `sentences`/`sequences` entries it points at. Resolve via
 *  `resolveElement`/`findElementById` in analysis-model.ts. */
export type XlePlusGlueElementRef =
  | { kind: 'sentence'; id: string }
  | { kind: 'sequence'; id: string };

export interface XlePlusGlueDocument {
  id: string;
  semanticType: string;
  sentences: SentenceAnalysis[];
  sequences: SequenceAnalysis[];      // canonical sequence registry, mirrors `sentences`
  elements: XlePlusGlueElementRef[];  // ordered {kind,id} refs, not embedded objects
  discourseUpdates?: DiscourseUpdate[];
  reasoningUpdates?: ReasoningUpdate[];   // sibling of discourseUpdates -- see the reasoning layer below
  activeElementId?: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
}

// Discourse layer (anaphora resolution over a merged Sentence/Sequence). Stacks on the
// core Sentence/Sequence model the same way SequenceAnalysis stacks on SentenceAnalysis --
// as a parallel, id-referenced structure, not new fields on SentenceAnalysis/SequenceAnalysis
// themselves. Mirrors LFGxDRT's own AnaphoraMapping/AnaphoraRelation shape (see
// LFGxDRT/src/main/java/de/ukon/lfgxdrt/drs_elements/AnaphoraRelation.java) rather than the
// opaque mapping.toString() GSWB previously put on GswbSolution.anaphoraMapping.

export interface AnaphoraRelation {
  pronounReferentId: string;   // DiscourseReferent.id/name of the pronoun, from LFGxDRT
  pronounDisplay?: string;     // rendered display form, e.g. "x2" -- for UI, not identity
  antecedent: string;          // antecedent referent label (AnaphoraRelation.antecedent)
  stateLabel?: string;         // DRS sub-state scope, if any (AnaphoraRelation.stateLabel)
}

export interface AnaphoraMappingModel {
  relations: AnaphoraRelation[];
}

export interface DiscourseAnalysis {
  id: string;                        // discourseId, e.g. `${semId}-pcdrs-${n}` (reuse GSWB's existing id scheme)
  semanticOrigin: string;            // the SemanticAnalysis.semId this branch enriches
  drsString: string;                 // enriched DRS text
  drsGraph?: LigerStructure;         // enriched DRS graph (semantic side; carries the ANT edges + SRC provenance)
  // Which post-processing rule branch this mapping came from, 1-based, matching the
  // parentSolutionId sent to GSWB. Provenance within its semanticOrigin, NOT identity:
  // `id` is identity. It replaces the former `structureId`, which was only ever a key
  // into the tier-B structure map that is no longer persisted (see DiscourseUpdate).
  ruleBranch: number;
  svg?: string;
  anaphoraMapping: AnaphoraMappingModel;  // structured, mirrors LFGxDRT's AnaphoraMapping
  collapsed: boolean;                // true once /collapse_anaphora has resolved this branch
}

export type SemDiscourseMapping = Record<string, string[]>;  // semId -> discourseId[], mirrors SynSemMapping

export interface DiscourseUpdate {
  id: string;                        // `du-${sourceElementId}`
  sourceElementId: string;           // Sentence.id or Sequence.id (XlePlusGlueElement.id) -- not a duplicated copy
  sourceElementKind: 'sentence' | 'sequence';
  ruleString?: string;               // the pronoun-binding rule text applied, for reproducibility
  // Stores pragmatic content only. The two joins post-processing computes on the way here --
  // tier A (merged syntax + merged semantics, unlinked) and tier B (tier A after the
  // post-processing rules, which is what carries the SYNSEM edges the anaphora rules gate on) --
  // are deliberately NOT persisted. Both are joins over the source element's own stored syntax
  // and semantics and are recomputable on demand; tier B cannot be reused for a later discourse
  // update anyway, so storing it bought nothing and cost the cross product: the persisted side
  // grows with the sentence count, the joins grew with readings x rule branches.
  discourse: DiscourseAnalysis[];    // candidate branches; each carries its own drsGraph
  semDiscourseMapping: SemDiscourseMapping;
  // Language-model ordering of `discourse`, keyed by discourseId. Pragmatic annotation only:
  // it orders the formally generated branches, never removes one, and never feeds back into
  // synSemMapping, the semantic alternatives or the branches themselves. Absent when the lm
  // service was unavailable or there was nothing to rank.
  anaphoraRanking?: AnaphoraRanking;
  createdAt?: string;
  updatedAt?: string;
}

/** One pronoun -> antecedent binding as scored by lm `/rank_anaphora`. `pronoun` and
 *  `antecedent` are referent labels (AnaphoraRelation.pronounDisplay / .antecedent) within
 *  `semanticOrigin`'s DRS. */
export interface AnaphoraRankedRelation {
  semanticOrigin: string;
  pronoun: string;
  antecedent: string;
  pronounText: string;       // the pronoun's lexical description in the input, e.g. "it"
  antecedentText: string;    // the antecedent's lexical description, e.g. "black dog"
  score?: number | null;     // the first ranker's score: in [0, 1] for every ranker, higher is better
  scores?: Record<string, number | null>; // every selected ranker's score (absent on old rankings)
  raw?: Record<string, number | null>;    // the raw value behind each: logProb, cosine, recencyRank
  cosine: number | null;     // cosine rankings: the raw cosine behind score ((cos + 1) / 2); null otherwise
  logProb?: number | null;   // mlm-substitution: the raw mean log-probability behind score (e^logProb)
  substitution?: string | null; // mlm-substitution: the words that replaced the pronoun
  recencyRank: number | null; // symbolic baseline: 1 = nearest admitted antecedent before the pronoun
}

export interface AnaphoraRankedBranch {
  discourseId: string;
  score: number | null;      // combined score in [0, 1] (one ranker: its mean relation score); null if none scored
  rank: number;              // 1-based within the branch's reading, highest score first; equal scores share a rank
  scores?: Record<string, number | null>; // per ranker: mean relation score (absent on old rankings)
  ranks?: Record<string, number>;         // per ranker: competition rank within the reading
}

/** lm `/rank_anaphora` response, stored as-is on the DiscourseUpdate it ranks. */
export interface AnaphoraRanking {
  method: string;            // readable summary: "mlm-substitution", or "borda(mlm-substitution>recency)"
  methods?: AnaphoraRankerId[]; // the rankers, in priority order; absent on old rankings: [method]
  averager?: AnaphoraAverager;  // absent on old rankings
  model: string;
  layers: number[];
  pooling: string;
  createdAt: string;
  relations: AnaphoraRankedRelation[];
  branches: AnaphoraRankedBranch[];
  warnings: string[];
}

/** lm `/rank_anaphora` request: the source element's syntax by synId, the DRS graph of every
 *  semantic origin the branches enrich, and each branch's bindings as referent labels. */
export interface LmRankAnaphoraRequest {
  syntax: Record<string, LigerStructure>;
  semantics: { semanticOrigin: string; syntacticOrigin: string; drs: LigerStructure }[];
  branches: { discourseId: string; semanticOrigin: string; relations: { pronoun: string; antecedent: string }[] }[];
  methods: AnaphoraRankerId[];
  averager: AnaphoraAverager;
}

/** The anaphora rankers lm `/rank_anaphora` can run; every one scores in [0, 1]. */
export const ANAPHORA_RANKERS = ['mlm-pronoun-product', 'mlm-substitution', 'mlm-pronoun', 'mlm-slot', 'cosine-lexical',
  'cosine-description', 'recency'] as const;
export type AnaphoraRankerId = typeof ANAPHORA_RANKERS[number];

/** How several rankers are fused into one score per branch, within each reading. */
export const ANAPHORA_AVERAGERS = ['borda', 'rrf', 'weighted'] as const;
export type AnaphoraAverager = typeof ANAPHORA_AVERAGERS[number];

/** Which rankers run, in priority order (first = most important), and how they are fused. */
export interface AnaphoraRankerSelection {
  rankers: AnaphoraRankerId[];
  averager: AnaphoraAverager;
}

/** GSWB `/render_pcdrs`: branches to render to SVG again. `semantic` is the stored PCDRS, its
 *  A: and P: inline; `anaphoraRelations`, when given, replace its A:. */
export interface GswbRenderPcdrsRequest {
  items: { id: string; semantic: string; anaphoraRelations?: AnaphoraRelation[] }[];
}

// Reasoning layer (consistency/informativity NLI checks over a premise/conclusion pair).
// Stacks on Sentence/Sequence exactly the way DiscourseUpdate does -- a parallel,
// id-referenced structure, never new fields on SentenceAnalysis/SequenceAnalysis.
//
// Deliberately stores NO structures of its own -- and neither does the DiscourseUpdate it
// points into: an assignment names the branch it was computed over via
// discourseUpdateId/discourseId, and the structures behind that branch are recomputed from
// the element's stored syntax and semantics if they are ever wanted again. The anaphora
// mapping, by contrast, is computed exactly once
// by GSWB /generate_pcdrs and threaded through; re-deriving it against a duplicated
// premise context makes the mapping ambiguous (see docs/plans/LFGXDRT_NLI_CHECK_COMPOSITION_PLAN.md).

/** The four discourse checks. Fixed by LFGXDRT_NLI_CHECK_COMPOSITION_PLAN.md -- never
 *  renamed, never reduced. Enforced by validateReasoningUpdate. */
export const REASONING_CHECK_NAMES = [
  'info_pos_check', 'info_neg_check', 'cons_pos_check', 'cons_neg_check',
] as const;
export type ReasoningCheckName = typeof REASONING_CHECK_NAMES[number];

/** Predicted/gold NLI label: entailment / neutral / contradiction. */
export type NliLabel = '1' | '0' | '-1';

/** One check's artefacts. `tptp` is the only field Vampire consumes; `graph` and
 *  `semanticSvg` are modelled because the composition plan asks for them, but are left
 *  unset in practice -- a regression session persists one assignment per
 *  reading x rule-branch x anaphora-branch, and embedding graphs there is what makes
 *  the autosave payload unmanageable. */
export interface ReasoningCheck {
  tptp: string;
  canonicalSemantic?: string;
  /** The discourse's reading rebased into this check (I11): its A: and P:, the discourse
   *  state labels it used -> this check's, and what the collapse did. For debugging. */
  anaphoraMapping?: string;
  presuppositionMapping?: string;
  stateMap?: Record<string, string>;
  collapseReport?: string;
  graph?: LigerStructure;
  semanticSvg?: string;
}

export type ReasoningCheckSet = Record<ReasoningCheckName, ReasoningCheck>;

/** Vampire's verdict for ONE assignment -- i.e. one tptp_checks bundle. The four checks
 *  are folded into this single triple server-side by discourse_checks(), with one
 *  proof_files list per bundle, so there is no per-check verdict to model.
 *  `glyph` is Vampire's diagnostic SVG, NOT the semantic SVG (kept separate per
 *  LFGXDRT_REASONING_PLAN.md section 6: do not overload Check.glyph). */
export interface ReasoningVerdict {
  consistent: boolean;
  informative: boolean;
  relevant: boolean;
  glyph?: string;
  proofFiles?: string[];
  computedAt?: string;
}

/** One reading-assignment x rule-branch x anaphora-branch. */
export interface ReasoningAssignment {
  /** `${updateId}/P[...]/H[...]/r${ruleBranchIndex}/m${anaphoraBranchId}` --
   *  see reasoningAssignmentId/parseReasoningAssignmentId in analysis-model.ts. */
  id: string;
  premiseSemanticIds: string[];      // one per premise element, ordered, positionally aligned
  hypothesisSemanticIds: string[];   // one per hypothesis element, ordered, positionally aligned
  ruleBranchIndex: number;           // which NLI post-processing rule annotation this came from
  discourseUpdateId?: string;        // pointer into document.discourseUpdates -- never a copy
  discourseId?: string;              // the DiscourseAnalysis branch whose mapping was used
  /** The PRIOR alone (`Q`) in TPTP, reattached as a separate `fof(context, axiom, ...)`
   *  conjunct. For premises A + B and conclusion C this is the merged A + B, never
   *  A + B + C: the conclusion must not appear in the axiom the checks test against. */
  contextTptp: string;
  contextSemanticId?: string;        // semId of the merged premise+hypothesis reading
  checks: ReasoningCheckSet;
  verdict?: ReasoningVerdict;        // absent until Vampire has run
  /** Set when this branch could not be prepared (collapse failed, fewer than four
   *  checks came back). Recorded rather than silently dropped, which is what both
   *  call sites did before. An assignment with `failure` set is excluded from the
   *  Vampire payload but stays in the document as evidence. */
  failure?: string;
  /** Items GSWB could translate only by dropping this branch's anaphora mapping, as
   *  human-readable reasons.
   *
   *  On the assignment rather than on the update: a degradation is a property of the one
   *  bundle it happened to, and a run routinely has degraded and cleanly resolved branches
   *  side by side. Without it a stored session cannot tell a resolved result from one whose
   *  pronoun bound to nothing -- the bundle still carries usable TPTP and a verdict either
   *  way, which is precisely why it has to be said explicitly. A handful of short strings,
   *  so unlike ReasoningCheck.graph it costs the autosave payload nothing. */
  degradations?: string[];
}

/** Aggregated verdict across a reasoning update's assignments, plus the derived NLI label. */
export interface ReasoningItemVerdict {
  label: NliLabel;
  consistent: boolean;
  informative: boolean;
  relevant: boolean;
  assignmentIds: string[];
  glyphs?: string[];
}

/** A reasoning check over a premise/conclusion pair. Scoped to lists of element ids
 *  rather than two ids: a regression NLI item has N premises and M conclusions, and the
 *  ordered groups must be preserved. Chat is the degenerate 1+1 case. */
export interface ReasoningUpdate {
  id: string;                        // `ru-${itemId}` or `ru-${premiseIds}=>${hypothesisIds}`
  premiseElementIds: string[];       // Sentence.id | Sequence.id, ordered
  hypothesisElementIds: string[];
  sourceElementId?: string;          // the merged Sequence, when one is registered
  sourceElementKind?: 'sentence' | 'sequence';
  itemId?: string;                   // regression's n<k>; absent in chat
  logicType: 'fof' | 'tff';
  ruleString?: string;               // NLI post-processing rules applied, for reproducibility
  pruned?: boolean;                  // true when only the first candidate was reasoned over
  /** Which anaphora branches this run sent to Vampire, as set when the run started (see
   *  VampirePreferences.anaphora_selection). Absent: every branch. Under top-k, `assignments`
   *  holds only the selected branches; `applied` is false when no ranking was available in
   *  time and every branch was sent. */
  anaphoraSelection?: { mode: AnaphoraSelectionMode; k: number; applied?: boolean };
  assignments: ReasoningAssignment[];
  verdict?: ReasoningItemVerdict;    // majority vote across assignments
  failure?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LigerRuleAnnotation {
  sentence?: string;
  // Absent when the request set `includeGraph: false` -- LiGER then skips rendering
  // entirely. Only callers that display a branch ask for it; see LigerStructureRuleRequest.
  graph?: LigerWebGraph;
  structureJson?: LigerStructure;
  structureVariants?: LigerStructure[];
  structureVariantGraphs?: LigerWebGraph[];
  appliedRules: LigerRule[];
  meaningConstructors?: string;
  numberOfMCsets?: number;
  axioms?: GrammarAxioms;
  highlightedNodeIds?: string[];
  highlightedNodeIdsByRule?: Record<string, string[]>;
  addedAnnotationsByRule?: Record<string, LigerRuleAnnotationFact[] | Record<string, LigerRuleAnnotationFact>>;
  sequenceParts?: LigerSequencePart[];
}

export interface LigerSequencePart {
  sourceIndex: number;
  sentenceId: string;
  syntaxVariantId?: string;
  solutionKey?: string;
  meaningConstructors: string;
  sourceIndexOffset: number;
  rootId?: string;
}

export interface LigerRuleAnnotationResponse {
  sentence?: string;
  annotations: LigerRuleAnnotation[];
  /** Set when rules (`?=> 0`) deleted every branch: why there is no annotation. */
  failureMessage?: string;
}

export interface LigerRuleAnnotationFact {
  fsNode?: string;
  fsValue?: string;
  sourceNode?: string;
  relationLabel?: string;
  targetNode?: string;
  choiceVars?: any[];
  [key: string]: any;
}

export interface LigerSolutionAnnotation {
  solutionKey: string;
  graph: LigerWebGraph;
  structureJson?: LigerStructure;
  structureVariants?: LigerStructure[];
  structureVariantGraphs?: LigerWebGraph[];
  appliedRules: LigerRule[];
  meaningConstructors: string;
  numberOfMCsets: number;
  axioms?: GrammarAxioms;
  sequenceParts?: LigerSequencePart[];
  sentenceAnalysis?: SentenceAnalysis;
  sequenceAnalysis?: LigerSequenceAnalysis;
}

export interface LigerSolutionAnnotationResponse {
  sentence?: string;
  solutions: LigerSolutionAnnotation[];
  structureJson?: Record<string, unknown>;
  success?: boolean;
  failedSentenceIndex?: number;
  failureMessage?: string;
}

export interface LigerSequenceRequest {
  sentences: string[];
  sentenceIds?: string[];
  ruleString?: string;
  parsedLastSentence?: LigerStructure[];
  parsedSentences?: LigerStructure[][];
}

export interface LigerStructureUploadRequest {
  content: string;
  format: 'json' | 'prolog';
  id?: string;
}

export interface LigerStructureRuleRequest extends LigerStructureUploadRequest {
  ruleString: string;
  /** Opt OUT of LiGER rendering each rule branch to a graph. Omitted means rendered, so
   *  callers that display branches need no change. The rendering is roughly a third of
   *  the response and is paid PER BRANCH, so a caller that only feeds the branch into the
   *  next request should always set this false. */
  includeGraph?: boolean;
}

export interface LigerStructureQueryRequest {
  content: string;
  format: 'json' | 'prolog';
  id?: string;
  query: string;
}

export interface LigerStructureQueryResponse {
  success: string;
  matchCount: number;
  graph: LigerWebGraph;
  solutions?: LigerQuerySolution[];
  structureJson?: Record<string, unknown>;
}

export interface LigerQuerySolution {
  signature: string;
  bindings: { [variable: string]: { [node: string]: string[] } };
}

export interface LigerWebGraph {
  graphElements: LigerGraphComponent[];
}

export interface LigerStructureConstraint {
  fsNode: string;
  relationLabel: string;
  fsValue: string;
  proj?: string;
  root?: boolean;
}

export interface LigerStructureChoiceSpace {
  rootChoice?: any[];
  choiceNodes?: any[];
  choices?: any[];
  allVars?: string[];
}

export interface LigerStructure {
  id?: string;
  text?: string;
  constraints: LigerStructureConstraint[];
  annotations: LigerStructureConstraint[];
  choiceSpace: LigerStructureChoiceSpace;
}

export interface LigerStructureMergeRequest {
  syntax?: LigerStructure;
  syntaxGraph?: LigerWebGraph;
  drs: LigerStructure;
  /** Opt OUT of LiGER rendering the merged structure to a graph. See
   *  LigerStructureRuleRequest.includeGraph. */
  includeGraph?: boolean;
}

export interface LigerMergeResponse {
  // Absent when the request set `includeGraph: false`.
  graph?: LigerWebGraph;
  structureJson?: Record<string, unknown>;
}

export interface LigerGraphComponent {
  data: { [key: string]: any };
}

export interface GswbBatchOutput {
outputs: { [key: string]: GswbOutput };
report: string;
}

export interface GswbRequest {
  premises: string;
  gswbPreferences: GswbPreferences;
  sessionKey?: string;
  structure?: LigerStructure;
  proofs?: GswbProofInput[];
}

export interface GswbProofInput {
  proofId: string;
  sentenceId?: string;
  solutionKey?: string;
  mcSetId?: string;
  meaningConstructors: string;
  structure?: LigerStructure;
  sentenceAnalysis?: SentenceAnalysis;
  sequenceAnalysis?: LigerSequenceAnalysis;
}

/** A batch deduction: one `GswbRequest` per sentence id -- the same payload `/deduce`
 *  takes, so the batch returns the same per-sentence result (per-origin provenance,
 *  surface labels on scope discriminants, sentence-scoped solution ids). Was
 *  `premises: {[id]: string}`, flat meaning constructors with no structure and no proofs. */
export interface GswbMultipleRequest {
  items: { [key: string]: GswbRequest };
  gswbPreferences: GswbPreferences;
  sessionKey?: string;
}

export interface GswbDiscriminant {
  id: string;
  type: string;
  identifier: string;
  associatedSolutions: string[];
  instantiations?: string[];
  surfaceLabel?: string;
  originIds?: string[];
  surfaceLabelsByOrigin?: Record<string, string>;
  /** Scope discriminants: first SYN-ID of the outscoping and of the outscoped element. */
  surfaceKey?: Array<number | null>;
  /** Scope discriminants: whether the scoping follows the surface order. Absent: unknown. */
  surfaceAligned?: boolean | null;
}

/** One GSWB reading on the wire. A derived or merged reading (/deduce, /gswb_batch_proof,
 *  /merge_sequence_semantics) is sent once, as `semanticAnalysis` (read it with `readingOf`);
 *  `solution`, `semantic` and `graph` are a PCDRS reading's. */
export interface GswbSolution {
  /** A PCDRS reading's SVG, or its text when not rendered. */
  solution?: string;
  id: string;
  sourceIndex?: number;
  /** For a solution of a proof: insitu modifiers outscoped by something to their left. */
  insituViolations?: number | null;
  /** For a solution of a proof: scope pairs whose outer element comes later in the sentence.
   *  GSWB orders a proof's solutions by these two counts. */
  surfaceOrderViolations?: number | null;
  /** A PCDRS reading's graph. */
  graph?: LigerStructure;
  /** A PCDRS reading as text. */
  semantic?: string;
  anaphoraMapping?: string;
  anaphoraRelations?: AnaphoraRelation[];
  /** A PCDRS reading's P:[p(s2,s1),...], an entry for every p-box: s2 resolved at s1. */
  presuppositionMapping?: string;
  /** What collapsing the reading does, e.g. "s1 accommodated at s0; s3 bound at s0 (x3 ↦ x1)". */
  collapseReport?: string;
  /** Why the collapse rejects the reading; set instead of a solution. */
  rejection?: string;
  proofId?: string;
  solutionKey?: string;
  mcSetId?: string;
  semanticAnalysis?: SemanticAnalysis;
  synSemMapping?: SynSemMapping;
  sentenceAnalysis?: SentenceAnalysis;
  sequenceAnalysis?: SequenceAnalysis;
}

export interface GswbPcdrsRequest {
  semantic: string;
  parentSolutionId?: string;
  mergedStructure: LigerStructure;
  // Whether the post-processing rules ran over mergedStructure: with rules, GSWB returns the
  // readings the rules propose; without, the one default reading (p-boxes in situ, pronouns unbound).
  rulesApplied: boolean;
  // Whether GSWB renders each reading to SVG (`solution`): true where the readings are shown,
  // false where they are only combined further (GSWB /render_pcdrs renders one later).
  includeSvg: boolean;
}

export interface GswbPcdrsOutput {
  parentSolutionId?: string;
  solutions: GswbSolution[];
  /** The readings the collapse rejects, each with its mappings and `rejection`. */
  rejected?: GswbSolution[];
}

/** The PCDRS's A: and P: come inline in `semantic`. */
export interface GswbCollapseAnaphoraRequest {
  semantic: string;
  parentSolutionId?: string;
}

export interface GswbTptpBatchItem {
  name: string;
  semantic: string;
}

export interface GswbTptpBatchResult {
  /** Empty if the item's collapse rejected the reading. */
  tptp: string;
  semantic?: string;
  /** Why the collapse rejected the reading. Must be surfaced: the item has no TPTP. */
  rejection?: string;
  /** The reading the item was collapsed with: the sequence's, a check's rebased one, or the
   *  context's part of it. */
  anaphoraMapping?: string;
  presuppositionMapping?: string;
  /** For a check: the sequence's state labels used by the reading -> the check's. */
  stateMap?: Record<string, string>;
  collapseReport?: string;
  /** Pronouns in this item the mapping did not bind, named as in `semantic`. Their ant(x)
   *  marker was dropped, so each is a new referent, equal to no other. */
  unresolvedPronouns?: string[];
}

/** One reading's items: `sequence` (the PCDRS, A: and P: inline), `context` and the four
 *  checks, which GSWB collapses with the sequence's reading. */
export interface GswbCollapseAndTptpBatchRequest {
  parentSolutionId?: string;
  items: GswbTptpBatchItem[];
  typed: boolean;
}

export interface GswbCollapseAndTptpBatchOutput {
  parentSolutionId?: string;
  /** Keyed by the requesting GswbTptpBatchItem.name, one entry per item. */
  results: Record<string, GswbTptpBatchResult>;
}

export interface GswbSequenceMergeRequest {
  parts?: GswbSemanticMergePart[];
  semantics?: string[];
  graphs?: LigerStructure[];
  parentSolutionId?: string;
  solutionKey?: string;
  mcSetId?: string;
  resolveDrs?: boolean;
}

export interface GswbSemanticMergePart {
  id?: string;
  sentenceId?: string;
  solutionId?: string;
  proofId?: string;
  syntacticOrigin?: string;
  mcSetId?: string;
  semantic: string;
  graph?: LigerStructure;
  /** Moves every `SRC iN` of `graph` by this much before the merge (GSWB): a sentence's
   *  reading derived on its own, appended to a discourse, gets its part's
   *  `LigerSequencePart.sourceIndexOffset`. Absent/0 for a part already numbered in the
   *  sequence, such as the discourse it is appended to. */
  sourceIndexOffset?: number;
  provenance?: Record<string, any>;
}

export interface GswbReasoningChecksRequest {
  premiseParts: string[];
  hypothesisParts: string[];
  typed: boolean;
}

export interface GswbReasoningCheck {
  tptp: string;
}

export interface GswbReasoningChecksOutput {
  checks: Record<string, GswbReasoningCheck>;
  contextTptp?: string;
}

export interface GswbReasoningCheckAst {
  semantic: string;
  ast: LigerStructure;
}

export interface GswbReasoningCheckAstsOutput {
  checks: Record<string, GswbReasoningCheckAst>;
}

export interface GswbReasoningCheckAstsRequest {
  premiseAsts: LigerStructure[];
  hypothesisAsts: LigerStructure[];
  typed: boolean;
}

export interface GswbOutput {
  solutions: GswbSolution[];
  synSemMapping?: SynSemMapping;
  log: string;
  derivation: any;
  discriminants: GswbDiscriminant[];
  /** Only in sessions parsed before docs/plans/DERIVE_ONCE_REBASE_PLAN.md (xleplusglue): the
   *  sentence was derived inside its discourse item's sequence, so its readings are numbered
   *  into that sequence. Such a sentence is derived again on its own before inference
   *  (regression `rederiveInSequenceOutputs`); a parse no longer sets it. */
  derivedInSequence?: { itemId: string; sentenceIndex: number };
  /** Milliseconds GSWB took for this deduction. */
  elapsedMs?: number;
  /** Why the sentence has no readings, when it was not derived or derived nothing -- e.g.
   *  an earlier sentence of its item has no semantics. */
  failure?: string;
}

export interface RegressionParseResult {
  sentence_id: string;
  sentence: string;
  noOfAppliedRules: number;
  noOfMCsets: number;
  noOfSolutions: number;
  ligerGraph: LigerWebGraph;
  ligerMCsets: string;
  allMCs: any;
  gswbSolutions: GswbSolution[];
  gswbDerivation: any;
  result_type: 'parseResult';
  discriminants?: GswbDiscriminant[];
}

export interface RegressionInferenceResult {
  id: string;
  premises: string[];
  conclusion: string;
  predictedLabel: string;
  goldLabel: string;
  premiseIds: string[];
  conclusionIds: string[];
  mismatch: boolean;
  glyphs: string[];
  /** Which anaphora branches were reasoned over (see VampirePreferences.anaphora_selection):
   *  `used` of the item's `total` discourse branches. `applied` is false when top-k was asked
   *  for but there was no ranking to select by, so every branch was used. */
  anaphoraSelection?: { mode: AnaphoraSelectionMode; k: number; applied: boolean; used: number; total: number };
}

/** One line of the inference report: an NLI item, and whatever is known about it so far.
 *
 *  The report lists every item from the moment parsing finishes, so `data` is often a
 *  placeholder with no predicted label rather than a real verdict -- `status` is what
 *  says which, and keeps an empty label from being rendered as a mismatch. */
export interface InferenceReportRow {
  id: string;
  /** `unparsed`: at least one of the item's sentences has no reading, so the item cannot
   *  contribute to a run at all. `pending`: parsed, not yet run. `running`: the item the
   *  progress record currently names. `done`: has a verdict. `failed`: ran, no verdict. */
  status: 'unparsed' | 'pending' | 'running' | 'done' | 'failed';
  /** False for `unparsed` items, which cannot be run and so cannot be selected. */
  selectable: boolean;
  data: RegressionInferenceResult;
  /** Why the item produced no verdict; empty unless `status` is `failed`. */
  reason: string;
  /** The sentence texts that have no reading; empty unless `status` is `unparsed`. */
  unparsedSentences: string[];
}

export interface RegressionSessionSummary {
  sessionKey: string;
  displayLabel: string;
  createdAt: string;
  updatedAt: string;
  parseCount: number;
  inferenceCount: number;
  hasParseResults: boolean;
  hasInferenceResults: boolean;
  sentenceCount?: number;
  failedParseCount?: number;
  mismatchCount?: number;
}

export interface RegressionSessionFilePart {
  filename: string;
  text: string;
  loadedText: string;
}

export interface RegressionSessionMetadata {
  id: string;
  redisSessionKey: string;
  createdAt: string;
  updatedAt: string;
  testsuiteUpdateMode: 'write' | 'append';
  hasRunVampire: boolean;
  /** The "Run inference after parsing" checkbox. Parsing used to continue into Vampire
   *  unconditionally, so there was no way to parse a testsuite, look at the readings and
   *  stop. Defaults to TRUE everywhere it is read, including for stored sessions written
   *  before the field existed -- those ran inference, and reading a missing field as
   *  `false` would silently turn it off for every one of them. */
  enableInference: boolean;
}

export interface RegressionSessionInputs {
  grammarPath: string;
  testsuite: RegressionSessionFilePart;
  rules: RegressionSessionFilePart;
  /** Post-processing rules of the loaded LiGER rule set. Missing in sessions saved before
   *  LiGER configs existed; those get them back by reloading `rules.filename`. */
  pragmaticsRules?: string;
  axioms: RegressionSessionFilePart;
  /** The text of every rule and axiom file of the rule set `rules.filename` names, edits
   *  included, keyed by path: restoring the session reopens that rule set with this text,
   *  over whatever is on disk now. Missing in sessions saved before the LiGER workspace. */
  ruleSetFiles?: Record<string, string>;
  /** How that rule set was chosen: the grammar's own config, or picked by hand. */
  ruleSetOrigin?: 'default' | 'grammar' | 'selected';
  /** Rule and axiom files of that rule set left out of runs, by path. Missing: none. */
  ruleSetExcluded?: string[];
  gswbPreferences: GswbPreferences;
  vampirePreferences: VampirePreferences;
}

export interface RegressionSessionAnalysisSystem {
  sentenceMap: Record<string, string>;
  regressionTestItems: any[];
  regressionTestResults: RegressionParseResult[];
  inferenceResults: RegressionInferenceResult[];
}

export interface RegressionSessionAnalysisHuman {
  selectedSolutionIdsBySentence: Record<string, string[]>;
  selectedScopeIdsBySentence: Record<string, string[]>;
  selectedMcIdsBySentence: Record<string, string[]>;
}

export interface RegressionSessionAnalysis {
  system: RegressionSessionAnalysisSystem;
  human: RegressionSessionAnalysisHuman;
  save_state: RegressionSessionSaveState;
  /** The report on the parse and inference steps the session holds (see run-report.ts).
   *  Absent in sessions saved before it existed. */
  report?: RegressionRunReport;
  /** v4: **one XlePlusGlueDocument per NLI item**, keyed by item id -- or per sentence id
   *  when a run has no NLI items (a parse-only testsuite). Each is exactly the shape chat
   *  builds per conversation and glue-vis per discourse: one document is one discourse.
   *
   *  v3 held a single session-wide document instead. That made every id have to be unique
   *  across the whole testsuite, made one item's invalid registration invalidate the
   *  document every other item lived in, and -- the reason it cannot stay -- forced two
   *  items quoting the same sentence to share one `SentenceAnalysis`, when the same
   *  sentence may legitimately be disambiguated differently per item. Every sentence is an
   *  individual parse per document; that duplication is the model working, not a cost.
   *
   *  `system.inferenceResults` is a *view* over these documents' `reasoningUpdates` -- it
   *  is still written so a v2 reader and the confusion matrix keep working, but the
   *  documents are the record. `system.regressionTestItems`/`regressionTestResults` are
   *  not views: they describe the testsuite and the parse phase, not reasoning. */
  documents: Record<string, XlePlusGlueDocument>;
}

export interface RegressionSessionSaveState {
  lastGswbOutputs: Record<string, GswbOutput> | null;
  lastAnnotations: Record<string, LigerSolutionAnnotationResponse> | null;
  lastVampireResults: Record<string, check[]> | null;
  /** The logic type of the last inference run, set when it starts. Parsing does not depend
   *  on it: grammar axioms stay untranslated until Vampire encodes them for a run. */
  lastLogicType: 'fof' | 'tff';
  lastVampireScopeIdsBySentence: Record<string, string[]>;
  lastVampireMcIdsBySentence: Record<string, string[]>;
  lastVampireSolutionIdsBySentence: Record<string, string[]>;
  sortedMCmap: Record<string, any>;
}

/** v4 holds one XlePlusGlueDocument per NLI item under `analysis.documents`; v3 had a
 *  single session-wide document under `analysis.document`; v2 had the three parallel
 *  result arrays alone. The store (Redis/redis_store.py) dispatches on this on read: an
 *  older session is upgraded in memory and flagged `upgradedFrom`, a newer one is refused. */
export const REGRESSION_SESSION_SCHEMA_VERSION = 5;

export interface RegressionSessionDocument {
  schemaVersion: typeof REGRESSION_SESSION_SCHEMA_VERSION;
  metadata: RegressionSessionMetadata;
  inputs: RegressionSessionInputs;
  analysis: RegressionSessionAnalysis;
}

export interface RegressionTestingSession {
  id: string;
  redisSessionKey: string;
  createdAt: string;
  updatedAt: string;
  grammarPath: string;
  testsuiteUpdateMode: 'write' | 'append';
  testsuiteText: string;
  rulesText: string;
  axiomsText: string;
  testsuiteFilename: string;
  rulesFilename: string;
  axiomsFilename: string;
  testsuiteLoadedText: string;
  rulesLoadedText: string;
  axiomsLoadedText: string;
  /** Post-processing (pragmatics) rules that came with the loaded rules file or config. */
  pragmaticsRulesText: string;
  /** Per-file text of the rule set (see RegressionSessionInputs.ruleSetFiles); null in a
   *  session saved before the LiGER workspace. */
  ruleSetFiles: Record<string, string> | null;
  ruleSetOrigin: 'default' | 'grammar' | 'selected' | null;
  /** Files of the rule set left out of runs (see RegressionSessionInputs.ruleSetExcluded). */
  ruleSetExcluded: string[];
  gswbPreferences: GswbPreferences;
  vampirePreferences: VampirePreferences;
  sentenceMap: Record<string, string>;
  regressionTestItems: any[];
  regressionTestResults: RegressionParseResult[];
  /** Derived from `analysisDocument.reasoningUpdates` for LFGxDRT runs (see
   *  `inferenceResultsFromDocument`), computed directly from Vampire's checks otherwise.
   *  Kept as a stored array either way: the confusion matrix and the saved-results view
   *  read it, and a v2 reader has nothing else. */
  inferenceResults: RegressionInferenceResult[];
  /** v4: one document per NLI item (or per sentence, for a parse-only run), keyed by
   *  item/sentence id. Each holds that item's own sentences, its merged sequence, and its
   *  ReasoningUpdate (`ru-n3`) with one assignment per reading x rule branch x anaphora
   *  branch. See RegressionSessionAnalysis.documents for why this is per item. */
  analysisDocuments: Record<string, XlePlusGlueDocument>;
  selectedSolutionIdsBySentence: Record<string, string[]>;
  selectedScopeIdsBySentence: Record<string, string[]>;
  selectedMcIdsBySentence: Record<string, string[]>;
  lastGswbOutputs: Record<string, GswbOutput> | null;
  lastAnnotations: Record<string, LigerSolutionAnnotationResponse> | null;
  lastVampireResults: Record<string, check[]> | null;
  lastLogicType: 'fof' | 'tff';
  lastVampireScopeIdsBySentence: Record<string, string[]>;
  lastVampireMcIdsBySentence: Record<string, string[]>;
  lastVampireSolutionIdsBySentence: Record<string, string[]>;
  sortedMCmap: Record<string, any>;
  hasRunVampire: boolean;
  /** See RegressionSessionMetadata.enableInference. Defaults to true. */
  enableInference: boolean;
  report: RegressionRunReport;
}

function createRegressionSessionFilePart(filename = '', text = '', loadedText = text): RegressionSessionFilePart {
  return {
    filename,
    text,
    loadedText,
  };
}

function cloneRegressionParseResult(result: RegressionParseResult): RegressionParseResult {
  return {
    ...result,
    ligerGraph: result.ligerGraph ? {
      ...result.ligerGraph,
      graphElements: (result.ligerGraph.graphElements ?? []).map(element => ({
        ...element,
        data: { ...(element.data ?? {}) },
      })),
    } : result.ligerGraph,
    gswbSolutions: (result.gswbSolutions ?? []).map(solution => ({ ...solution })),
    discriminants: (result.discriminants ?? []).map(discriminant => ({
      ...discriminant,
      associatedSolutions: [...(discriminant.associatedSolutions ?? [])],
      instantiations: [...(discriminant.instantiations ?? [])],
    })),
  };
}

function cloneRegressionInferenceResult(result: RegressionInferenceResult): RegressionInferenceResult {
  return {
    ...result,
    premises: [...(result.premises ?? [])],
    premiseIds: [...(result.premiseIds ?? [])],
    conclusionIds: [...(result.conclusionIds ?? [])],
    glyphs: [...(result.glyphs ?? [])],
  };
}

function cloneGswbOutput(output: GswbOutput): GswbOutput {
  return {
    ...output,
    solutions: (output?.solutions ?? []).map(solution => ({ ...solution })),
    discriminants: (output?.discriminants ?? []).map(discriminant => ({
      ...discriminant,
      associatedSolutions: [...(discriminant.associatedSolutions ?? [])],
      instantiations: [...(discriminant.instantiations ?? [])],
    })),
  };
}

export function createRegressionAnalysisDocument(sessionId: string): XlePlusGlueDocument {
  return {
    id: `analysis-${sessionId}`,
    semanticType: 'lfgxdrt',
    sentences: [],
    sequences: [],
    elements: [],
    discourseUpdates: [],
    reasoningUpdates: [],
  };
}

/** The persisted form of one reasoning check.
 *
 *  `graph` and `semanticSvg` are dropped rather than stored: a regression run persists one
 *  assignment per reading x rule branch x anaphora branch, and one graph per check of each
 *  is what makes the autosave payload unmanageable. They are rebuildable from the TPTP's
 *  source; the TPTP itself is not rebuildable from anything, so it stays. */
function persistedReasoningCheck(check: ReasoningCheck): ReasoningCheck {
  const { tptp, canonicalSemantic, anaphoraMapping, presuppositionMapping, stateMap, collapseReport } = check ?? {} as ReasoningCheck;
  return { tptp: tptp ?? '', ...(canonicalSemantic ? { canonicalSemantic } : {}),
    ...(anaphoraMapping ? { anaphoraMapping } : {}), ...(presuppositionMapping ? { presuppositionMapping } : {}),
    ...(stateMap ? { stateMap } : {}), ...(collapseReport ? { collapseReport } : {}) };
}

/** The parse response as STORED: without these fields nothing reads back.
 *
 *  Measured on an 11 MB session (`first-test`): `sentenceAnalysis` 1.93 MB and
 *  `structureVariants` 1.19 MB, against `structureJson` 1.19 MB that IS read. The first
 *  re-wraps the same structure the solution already carries; the second is not read
 *  anywhere in the client at all. Together they were a quarter of every autosave for
 *  nothing.
 *
 *  `graph` joins them (0.82 MB of `first-test-ambig`). It is a LigerWebGraph rendering
 *  companion, derivable from the `structureJson` stored beside it, and its one reader --
 *  regression's batchSyntaxFor, which copies it onto a SyntacticAnalysis -- feeds a field that no
 *  persisted document is ever read back for. See persistedAnalysisDocument.
 *
 *  They stay on the in-memory session -- this narrows the persisted copy only, so live
 *  proof-input building (which does use `sentenceAnalysis`, off the fresh response) is
 *  unaffected. Same principle as persistedReasoningCheck dropping check graphs. */
function persistedAnnotation(annotation: LigerSolutionAnnotationResponse): LigerSolutionAnnotationResponse {
  return {
    ...annotation,
    solutions: (annotation?.solutions ?? []).map(solution => {
      const { sentenceAnalysis, structureVariants, structureVariantGraphs, graph, ...kept } = solution as any;
      return kept;
    }),
  };
}

/** The document as STORED: without the syntax graphs, which nothing ever reads back.
 *
 *  Every SyntacticAnalysis carries a `graph` (LigerWebGraph) beside its `structure`. It is
 *  a rendering companion LiGER builds from that same structure's constraints and
 *  annotations, so it is derivable from what sits next to it -- the same argument that
 *  removed the tier-A/tier-B joins from DiscourseUpdate.
 *
 *  Nothing reads it back from persistence, on any surface:
 *   - chat and analysis documents are never rehydrated at all -- `data.service` has only
 *     PUT and DELETE for `analysis_document`/`chat_document`, no GET;
 *   - a regression session IS rehydrated, but its only renderer of a stored syntax graph
 *     (`LigerVisComponent.displaySequenceAnalysis`) is called from glue-vis alone, against
 *     the live in-memory document, never from regression.
 *
 *  Measured on `first-test-ambig`: 0.65 MB across sentence syntax and 1.17 MB across
 *  sequence syntax, of an 11.8 MB session.
 *
 *  Applied uniformly by all three surfaces, so the stored shape stays identical across
 *  them -- narrowing this in one place only would break exactly the parity the shared
 *  pipeline exists to keep. The in-memory document is untouched, so everything that does
 *  render a graph goes on rendering it. */
export function persistedAnalysisDocument(document: XlePlusGlueDocument): XlePlusGlueDocument {
  const withoutGraphs = (entries: SyntacticAnalysis[] | undefined) =>
    (entries ?? []).map(entry => {
      const { graph, ...kept } = entry as any;
      return kept as SyntacticAnalysis;
    });
  return {
    ...document,
    sentences: (document?.sentences ?? []).map(sentence => ({
      ...sentence,
      syntax: withoutGraphs(sentence.syntax),
    })),
    sequences: (document?.sequences ?? []).map(sequence => ({
      ...sequence,
      syntax: withoutGraphs(sequence.syntax),
    })),
  };
}

/** Whether two ReasoningUpdates say the same thing, ignoring the fields that move on
 *  their own: the update's own `createdAt`/`updatedAt` and each verdict's `computedAt`.
 *
 *  Regression rebuilds every update from `preparedNliPairs` on each 15s results poll, so
 *  the overwhelming majority of rebuilds are identical to what is already stored. Without
 *  this the timestamps alone made every rebuild differ, and since the autosave diffs by
 *  section path with `analysis.documents` as one path, that re-uploaded every item's
 *  document each poll -- 4.9 MB on a 6-item ambiguous session, roughly 200 MB over a
 *  ten-minute run, none of it new. */
export function sameReasoningUpdate(left: ReasoningUpdate, right: ReasoningUpdate): boolean {
  const comparable = (update: ReasoningUpdate) => {
    const { createdAt, updatedAt, ...rest } = update ?? ({} as ReasoningUpdate);
    return {
      ...rest,
      assignments: (rest.assignments ?? []).map(assignment => {
        if (!assignment?.verdict) return assignment;
        const { computedAt, ...verdict } = assignment.verdict as any;
        return { ...assignment, verdict };
      }),
    };
  };
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function persistedReasoningUpdate(update: ReasoningUpdate): ReasoningUpdate {
  return {
    ...update,
    premiseElementIds: [...(update.premiseElementIds ?? [])],
    hypothesisElementIds: [...(update.hypothesisElementIds ?? [])],
    assignments: (update.assignments ?? []).map(assignment => ({
      ...assignment,
      premiseSemanticIds: [...(assignment.premiseSemanticIds ?? [])],
      hypothesisSemanticIds: [...(assignment.hypothesisSemanticIds ?? [])],
      checks: Object.fromEntries(Object.entries(assignment.checks ?? {})
        .map(([name, check]) => [name, persistedReasoningCheck(check)])) as ReasoningCheckSet,
    })),
  };
}

export function createRegressionSessionDocument(): RegressionSessionDocument {
  const runtime = createRegressionTestingSession();
  return regressionSessionToDocument(runtime);
}

export function regressionSessionToDocument(session: Partial<RegressionTestingSession>): RegressionSessionDocument {
  const createdAt = String(session?.createdAt ?? new Date().toISOString());
  const updatedAt = String(session?.updatedAt ?? createdAt);
  const sessionId = String(session?.id ?? session?.redisSessionKey ?? `session-${createdAt.replace(/[:.]/g, '-').replace('T', '_')}`);
  const redisSessionKey = String(session?.redisSessionKey ?? sessionId);

  return {
    schemaVersion: REGRESSION_SESSION_SCHEMA_VERSION,
    metadata: {
      id: sessionId,
      redisSessionKey,
      createdAt,
      updatedAt,
      testsuiteUpdateMode: session?.testsuiteUpdateMode ?? 'write',
      hasRunVampire: Boolean(session?.hasRunVampire),
      enableInference: session?.enableInference ?? true,
    },
    inputs: {
      grammarPath: String(session?.grammarPath ?? ''),
      testsuite: createRegressionSessionFilePart(
        String(session?.testsuiteFilename ?? ''),
        String(session?.testsuiteText ?? ''),
        String(session?.testsuiteLoadedText ?? session?.testsuiteText ?? ''),
      ),
      rules: createRegressionSessionFilePart(
        String(session?.rulesFilename ?? ''),
        String(session?.rulesText ?? ''),
        String(session?.rulesLoadedText ?? session?.rulesText ?? ''),
      ),
      pragmaticsRules: String(session?.pragmaticsRulesText ?? ''),
      axioms: createRegressionSessionFilePart(
        String(session?.axiomsFilename ?? ''),
        String(session?.axiomsText ?? ''),
        String(session?.axiomsLoadedText ?? session?.axiomsText ?? ''),
      ),
      ...(session?.ruleSetFiles ? { ruleSetFiles: { ...session.ruleSetFiles } } : {}),
      ...(session?.ruleSetOrigin ? { ruleSetOrigin: session.ruleSetOrigin } : {}),
      ...(session?.ruleSetExcluded?.length ? { ruleSetExcluded: [...session.ruleSetExcluded] } : {}),
      gswbPreferences: { ...(session?.gswbPreferences ?? createRegressionTestingSession().gswbPreferences) },
      vampirePreferences: { ...(session?.vampirePreferences ?? createRegressionTestingSession().vampirePreferences) },
    },
    analysis: {
      system: {
        sentenceMap: { ...(session?.sentenceMap ?? {}) },
        regressionTestItems: (session?.regressionTestItems ?? []).map(item => ({ ...item })),
        regressionTestResults: (session?.regressionTestResults ?? []).map(result => cloneRegressionParseResult(result)),
        inferenceResults: (session?.inferenceResults ?? []).map(result => cloneRegressionInferenceResult(result)),
      },
      human: {
        selectedSolutionIdsBySentence: { ...(session?.selectedSolutionIdsBySentence ?? {}) },
        selectedScopeIdsBySentence: { ...(session?.selectedScopeIdsBySentence ?? {}) },
        selectedMcIdsBySentence: { ...(session?.selectedMcIdsBySentence ?? {}) },
      },
      save_state: {
        lastGswbOutputs: session?.lastGswbOutputs ? Object.fromEntries(Object.entries(session.lastGswbOutputs).map(([key, value]) => [key, cloneGswbOutput(value)])) : null,
        lastAnnotations: session?.lastAnnotations
          ? Object.fromEntries(Object.entries(session.lastAnnotations)
            .map(([key, annotation]) => [key, persistedAnnotation(annotation)]))
          : null,
        lastVampireResults: session?.lastVampireResults ? Object.fromEntries(Object.entries(session.lastVampireResults).map(([key, value]) => [key, (value ?? []).map(item => ({ ...item }))])) : null,
        lastLogicType: session?.lastLogicType ?? 'fof',
        lastVampireScopeIdsBySentence: { ...(session?.lastVampireScopeIdsBySentence ?? {}) },
        lastVampireMcIdsBySentence: { ...(session?.lastVampireMcIdsBySentence ?? {}) },
        lastVampireSolutionIdsBySentence: { ...(session?.lastVampireSolutionIdsBySentence ?? {}) },
        sortedMCmap: { ...(session?.sortedMCmap ?? {}) },
      },
      // No `updatedAt` stamp of its own here: the document carries the timestamp of the
      // last change to the document, and the session snapshot is fingerprinted to decide
      // whether an autosave is needed. Re-stamping it on every snapshot would make every
      // fingerprint unique and turn autosave into a loop.
      report: JSON.parse(JSON.stringify(session?.report ?? emptyRunReport())),
      documents: Object.fromEntries(
        Object.entries(session?.analysisDocuments ?? {}).map(([key, document]) => [key, {
          ...persistedAnalysisDocument(document),
          reasoningUpdates: (document?.reasoningUpdates ?? [])
            .map(update => persistedReasoningUpdate(update)),
        }])),
    },
  };
}

/** Reads `analysis.documents` -- one XlePlusGlueDocument per NLI item.
 *
 *  No v3 fallback: v2/v3 sessions are refused by the store (they were dropped along with
 *  its contents on 2026-08-21), so a payload reaching here is always v4. Wrapping a
 *  legacy single document would only mask a store that let something through. */
function regressionDocumentsFrom(analysis: any, sessionId: string): Record<string, XlePlusGlueDocument> {
  const documents = analysis?.documents;
  if (!documents || typeof documents !== 'object') {
    return {};
  }
  return Object.fromEntries(Object.entries(documents).map(([key, value]) => [key, {
    ...createRegressionAnalysisDocument(`${sessionId}-${key}`),
    ...(value as XlePlusGlueDocument),
  }]));
}

export function regressionDocumentToSession(document: any): RegressionTestingSession {
  const base = createRegressionTestingSession();
  const metadata = document?.metadata ?? {};
  const inputs = document?.inputs ?? {};
  const analysis = document?.analysis ?? {};
  const system = analysis?.system ?? {};
  const human = analysis?.human ?? {};
  const saveState = analysis?.save_state ?? analysis?.saveState ?? {};

  const testsuite = inputs?.testsuite ?? {};
  const rules = inputs?.rules ?? {};
  const axioms = inputs?.axioms ?? {};

  return {
    ...base,
    id: String(metadata?.id ?? document?.id ?? document?.redisSessionKey ?? base.id),
    redisSessionKey: String(metadata?.redisSessionKey ?? document?.redisSessionKey ?? metadata?.id ?? document?.id ?? base.redisSessionKey),
    createdAt: String(metadata?.createdAt ?? document?.createdAt ?? base.createdAt),
    updatedAt: String(metadata?.updatedAt ?? document?.updatedAt ?? base.updatedAt),
    grammarPath: String(inputs?.grammarPath ?? document?.grammarPath ?? ''),
    testsuiteUpdateMode: metadata?.testsuiteUpdateMode === 'append' ? 'append' : (document?.testsuiteUpdateMode === 'append' ? 'append' : 'write'),
    testsuiteText: String(testsuite?.text ?? document?.testsuiteText ?? ''),
    rulesText: String(rules?.text ?? document?.rulesText ?? ''),
    axiomsText: String(axioms?.text ?? document?.axiomsText ?? ''),
    testsuiteFilename: String(testsuite?.filename ?? document?.testsuiteFilename ?? ''),
    rulesFilename: String(rules?.filename ?? document?.rulesFilename ?? ''),
    axiomsFilename: String(axioms?.filename ?? document?.axiomsFilename ?? ''),
    testsuiteLoadedText: String(testsuite?.loadedText ?? document?.testsuiteLoadedText ?? testsuite?.text ?? document?.testsuiteText ?? ''),
    rulesLoadedText: String(rules?.loadedText ?? document?.rulesLoadedText ?? rules?.text ?? document?.rulesText ?? ''),
    axiomsLoadedText: String(axioms?.loadedText ?? document?.axiomsLoadedText ?? axioms?.text ?? document?.axiomsText ?? ''),
    pragmaticsRulesText: String(inputs?.pragmaticsRules ?? document?.pragmaticsRulesText ?? ''),
    ruleSetFiles: inputs?.ruleSetFiles && typeof inputs.ruleSetFiles === 'object'
      ? { ...inputs.ruleSetFiles } : null,
    ruleSetOrigin: ['default', 'grammar', 'selected'].includes(inputs?.ruleSetOrigin) ? inputs.ruleSetOrigin : null,
    ruleSetExcluded: Array.isArray(inputs?.ruleSetExcluded)
      ? inputs.ruleSetExcluded.filter((path: unknown) => typeof path === 'string') : [],
    gswbPreferences: { ...(inputs?.gswbPreferences ?? document?.gswbPreferences ?? base.gswbPreferences) },
    vampirePreferences: { ...(inputs?.vampirePreferences ?? document?.vampirePreferences ?? base.vampirePreferences) },
    sentenceMap: { ...(system?.sentenceMap ?? document?.sentenceMap ?? {}) },
    regressionTestItems: Array.isArray(system?.regressionTestItems ?? document?.regressionTestItems) ? (system?.regressionTestItems ?? document?.regressionTestItems) : [],
    regressionTestResults: Array.isArray(system?.regressionTestResults ?? document?.regressionTestResults) ? (system?.regressionTestResults ?? document?.regressionTestResults).map((result: RegressionParseResult) => cloneRegressionParseResult(result)) : [],
    inferenceResults: Array.isArray(system?.inferenceResults ?? document?.inferenceResults) ? (system?.inferenceResults ?? document?.inferenceResults).map((result: RegressionInferenceResult) => cloneRegressionInferenceResult(result)) : [],
    analysisDocuments: regressionDocumentsFrom(analysis, String(metadata?.id ?? base.id)),
    selectedSolutionIdsBySentence: { ...(human?.selectedSolutionIdsBySentence ?? document?.selectedSolutionIdsBySentence ?? {}) },
    selectedScopeIdsBySentence: { ...(human?.selectedScopeIdsBySentence ?? document?.selectedScopeIdsBySentence ?? {}) },
    selectedMcIdsBySentence: { ...(human?.selectedMcIdsBySentence ?? document?.selectedMcIdsBySentence ?? {}) },
    lastGswbOutputs: saveState?.lastGswbOutputs ?? document?.lastGswbOutputs ?? null,
    lastAnnotations: saveState?.lastAnnotations ?? document?.lastAnnotations ?? null,
    lastVampireResults: saveState?.lastVampireResults ?? document?.lastVampireResults ?? null,
    lastLogicType: saveState?.lastLogicType === 'tff' ? 'tff' : (document?.lastLogicType === 'tff' ? 'tff' : 'fof'),
    lastVampireScopeIdsBySentence: { ...(saveState?.lastVampireScopeIdsBySentence ?? document?.lastVampireScopeIdsBySentence ?? {}) },
    lastVampireMcIdsBySentence: { ...(saveState?.lastVampireMcIdsBySentence ?? document?.lastVampireMcIdsBySentence ?? {}) },
    lastVampireSolutionIdsBySentence: { ...(saveState?.lastVampireSolutionIdsBySentence ?? document?.lastVampireSolutionIdsBySentence ?? {}) },
    sortedMCmap: { ...(saveState?.sortedMCmap ?? document?.sortedMCmap ?? {}) },
    hasRunVampire: Boolean(metadata?.hasRunVampire ?? document?.hasRunVampire),
    enableInference: metadata?.enableInference ?? document?.enableInference ?? true,
    report: analysis?.report ?? base.report,
  };
}

/** The key a regression session has until it is saved under a name ("session-" and its
 *  creation time, below). Inference banks are the named ones; Save As refuses this shape so
 *  the two never mix. Mirrors Redis/redis_store.py's DEFAULT_SESSION_KEY. */
export const DEFAULT_SESSION_KEY = /^session-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}Z$/;

/** What a store cleanup deleted (or, on a dry run, would delete). */
export interface RegressionStoreCleanupReport {
  dryRun: boolean;
  /** Unnamed sessions removed with their results and progress. */
  sessions: string[];
  /** Vampire results and progress records left without a session. */
  results: string[];
  progress: string[];
  /** Index entries whose session no longer existed. */
  indexEntries: string[];
  bytes: number;
}

export function isDefaultSessionKey(sessionKey: string | null | undefined): boolean {
  return DEFAULT_SESSION_KEY.test(String(sessionKey ?? ''));
}

export function createRegressionTestingSession(): RegressionTestingSession {
  const createdAt = new Date().toISOString();
  const sessionId = `session-${createdAt.replace(/[:.]/g, '-').replace('T', '_')}`;

  return {
    id: sessionId,
    redisSessionKey: sessionId,
    createdAt,
    updatedAt: createdAt,
    grammarPath: '',
    testsuiteUpdateMode: 'write',
    testsuiteText: '',
    rulesText: '',
    axiomsText: '',
    testsuiteFilename: '',
    rulesFilename: '',
    axiomsFilename: '',
    testsuiteLoadedText: '',
    rulesLoadedText: '',
    axiomsLoadedText: '',
    pragmaticsRulesText: '',
    ruleSetFiles: null,
    ruleSetOrigin: null,
    ruleSetExcluded: [],
    gswbPreferences: {
      prover: 1,
      debugging: false,
      outputstyle: 4,
      parseSem: false,
      betaReduce: true,
      resolveDrs: true,
      glueOnly: false,
      meaningOnly: false,
      explainFail: false,
      naturalDeductionStyle: 0,
    },
    vampirePreferences: {
      logic_type: 0,
      model_building: true,
      max_duration: 10,
      layered: false,
      anaphora_selection: 'all',
      anaphora_top_k: 1,
      anaphora_rankers: ['mlm-pronoun-product'],
      anaphora_averager: 'borda',
    },
    sentenceMap: {},
    regressionTestItems: [],
    regressionTestResults: [],
    inferenceResults: [],
    analysisDocuments: {},
    selectedSolutionIdsBySentence: {},
    selectedScopeIdsBySentence: {},
    selectedMcIdsBySentence: {},
    lastGswbOutputs: null,
    lastAnnotations: null,
    lastVampireResults: null,
    lastLogicType: 'fof',
    lastVampireScopeIdsBySentence: {},
    lastVampireMcIdsBySentence: {},
    lastVampireSolutionIdsBySentence: {},
    sortedMCmap: {},
    hasRunVampire: false,
    enableInference: true,
    report: emptyRunReport(),
  };
}


export interface GswbPreferences {
  prover: number;
  debugging: boolean;
  outputstyle: number;
  parseSem: boolean;
  betaReduce: boolean;
  resolveDrs: boolean;
  glueOnly: boolean;
  meaningOnly: boolean;
  explainFail: boolean;
  naturalDeductionStyle: number;
}

export interface VampirePreferences {
  logic_type: number;
  model_building: boolean;
  max_duration: number;
  layered: boolean; //Processes with and without additional axioms
  /** Which anaphora branches the NEXT Vampire run sends to Vampire. 'all' (the default, and what a
   *  session saved without this field means): every formally generated branch. 'top_k': per
   *  reading, only the branches binding one of the `anaphora_top_k` best-ranked anaphora mappings
   *  (branches binding the same way share a rank; see selectedAnaphoraBranchIds); the others are
   *  never reasoned over. Recorded on the run's ReasoningUpdates. */
  anaphora_selection?: AnaphoraSelectionMode;
  anaphora_top_k?: number;
  /** The anaphora rankers to run, selected ones only, in priority order; and the averager that
   *  fuses them. Absent (sessions saved before): APP_DEFAULTS.anaphoraRanking. */
  anaphora_rankers?: string[];
  anaphora_averager?: string;
}

export type AnaphoraSelectionMode = 'all' | 'top_k';


export interface GrammarList {
  grammarList: string[];
}

export interface FileTree {
  name: string;        // The name of the file or directory
  path: string;        // The full path of the file or directory
  isDirectory: boolean; // Whether the node is a directory (true) or a file (false)
  children: FileTree[]; // A list of children nodes (only populated if it's a directory)
}

export interface GrammarString {
  grammar: string;
  isDir: boolean;
}

export interface PathString {
  grammar: string;
  isDir: boolean;
}

export interface vampireRequest {
  text: string;
  context?: context[];
  axioms?: string;
  /** The rules' axioms, untranslated; encoded by Vampire for the request's logic type. */
  grammar_axioms?: GrammarAxioms;
  hypothesis?: string;
  pruning?: boolean;
  active_indices?: number[];
  vampire_preferences?: VampirePreferences;
  tptp_checks?: GswbReasoningChecksOutput[];
  // Lets the Vampire adapter group this conversation's tmp/debug files under one session
  // directory, one subfolder per chat turn, instead of an unrelated fresh directory per call.
  session_key?: string;
  turn_index?: number;
}

/*

class VampireMultipleRequest(BaseModel):
nli_items: dict  # A dictionary mapping ids to VampireNLI objects
axioms: str
pruning: bool
vampire_preferences: dict
*/
export interface vampireMultipleRequest {
  nli_items: { [key: string]: nliItem };
  pruning: boolean;
  vampire_preferences?: VampirePreferences;
  session_key?: string;
  /** Names the run on its progress record and in cancel requests. */
  run_id?: string;
}

/*class VampireNLI(BaseModel):
premises: List[str]
hypothesis: str*/

export interface nliItem {
  premises: string[];
  hypothesis: string[];
  /** The background axiom files' TPTP, as loaded (already encoded). */
  axioms: string;
  /** The rules' axioms, untranslated; encoded by Vampire for the run's logic type. */
  grammar_axioms?: GrammarAxioms;
  premise_sentence_ids?: string[];
  hypothesis_sentence_ids?: string[];
  tptp_checks?: GswbReasoningChecksOutput[];
}

export interface vampireResponse {
  context: context[];
  active_indices: number[];
  context_checks_mapping: {[key: number]: check };
}

export interface vampireMultipleResponse {
  results: { [key: string]: check[] };
}

export interface VampireSessionSummary {
  item_count: number;
  proof_count: number;
}

/** GET /vampire_progress/{session_key} -- the live, per-request progress record
 *  (`inference/run_vampire.py`'s `_update_vampire_progress`), distinct from
 *  `VampireSessionSummary`: the summary is cumulative across every run ever merged into
 *  a session key, while this record's counts reset to 0 at the start of each
 *  `/vampire_multiple_request` call, so it is the source for a moving progress bar
 *  rather than for the session's overall result totals. */
export interface VampireProgress {
  sessionKey: string;
  /** The run this record describes. */
  runId: string | null;
  /** The run the inference service is executing for the session right now, or null. Added
   *  by the service on read; the authority on whether a cancelled run has stopped. */
  activeRunId?: string | null;
  /** `failed` means the run died server-side. Without it a dead run kept its last
   *  `running` snapshot forever and the client polled it indefinitely, so a crash
   *  presented as a run that had merely stopped progressing. */
  state: 'idle' | 'running' | 'cancel_requested' | 'cancelled' | 'completed' | 'failed';
  cancelRequested: boolean;
  activeItemId: string | null;
  completedItemIds: string[];
  changedItemIds: string[];
  /** Per item, how many check bundles have finished -- a count, not the results. The
   *  results live in `last_session`; copying them here made every per-branch snapshot
   *  rewrite the whole run's output. */
  itemResults: { [key: string]: number };
  /** Per completed item: milliseconds from its start to its last check. */
  itemTimingsMs?: { [key: string]: number };
  itemCount: number;
  proofCount: number;
  totalItemCount: number;
  updatedAt?: string;
  /** Set when `state` is `failed`: what went wrong, for the user rather than the log. */
  failure?: string;
}

export interface check {
  glyph: string;
  informative: boolean;
  consistent: boolean;
  relevant: boolean;
  proof_files?: string[];
  /** Echoed back by the Vampire adapter from the submitted tptp_checks bundle, so a
   *  verdict can be matched to its ReasoningAssignment by id instead of by array
   *  position. Snake_case to match the rest of this wire type. */
  assignment_id?: string;
}

export interface context {
  original: string;
  prolog_drs: string;
  prolog_fol: string;
  tptp: string;
  box: string;
  semantic?: string;
  semanticGraph?: LigerStructure;
  syntax?: LigerStructure;
  semanticAnalysis?: SemanticAnalysis;
  synSemMapping?: SynSemMapping;
  /** Sentence.id/Sequence.id in the chat's XlePlusGlueDocument this context entry
   *  corresponds to -- lets the next turn build a composite Sequence id from it. */
  elementId?: string;
}


export interface ChatMessage {
  text: string;
  sender: 'User' | 'Bot';
  timestamp: string;
  //optional glyph
  glyph?: string;
   showGlyph?: false
   detailText?: string;        // for chat analysis
   semanticText?: string;
   showDetail?: boolean;

   glyphs?: string[];        // raw svg strings (optional to keep)
   safeGlyphs?: SafeHtml[];
   glyphGridSize?: number;

   /** This turn's reasoning branches, one entry per bundle sent to Vampire -- accepted
    *  and rejected alike. Distinct from the carried-forward context: that is one entry
    *  per surviving reading, so it can never describe what was actually checked.
    *  Paged one at a time by app-sem-vis rather than rendered as 72 SVGs at once. */
   branchSolutions?: GswbSolution[];
   /** Per-branch caption, index-aligned with branchSolutions: mapping id + verdict. */
   branchLabels?: string[];
   /** Per-branch ranking table, index-aligned with branchSolutions; derived, not stored. */
   branchRankings?: (AnaphoraRankingTable | null)[];

 }
