import { SafeHtml } from '@angular/platform-browser';

export interface LigerBatchParsingAnalysis {
  annotations: { [key: number]: LigerRuleAnnotation };
  ruleApplicationGraph: LigerGraphComponent[];
  report: string;
}


//Unify Liger and Stanza models

export interface LigerRule {
  rule: string;
  index: number;
  lineNumber: number;
}

export type SynSemMapping = Record<string, string[]>;

export interface SyntacticAnalysis {
  synId: string;
  structure: LigerStructure;
  graph: LigerWebGraph;
  meaningConstructors?: string;
  numberOfMCsets?: number;
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
  structureId: string;               // key into DiscourseUpdate.structures -- see note there. NOT the
                                      // same thing as drsGraph: this is the LinguisticStructure side,
                                      // needed for further LiGER querying/rule application
                                      // (QueryParser/RuleParser).
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
  // Deduplicated LinguisticStructures, keyed by structureId. A single semantic origin can fan out
  // into several rule-annotation variants, and each variant can fan out into several PCDRS/anaphora
  // candidates that all share the SAME LinguisticStructure -- storing structures here once and
  // having DiscourseAnalysis.structureId reference them avoids duplicating multi-KB structures per
  // candidate when persisted.
  structures: Record<string, LigerStructure>;
  mergedGraphs?: Record<string, LigerWebGraph>;  // keyed the same way as `structures` -- rendering companion
  discourse: DiscourseAnalysis[];    // candidate branches, referencing `structures`/`mergedGraphs` by structureId
  semDiscourseMapping: SemDiscourseMapping;
  createdAt?: string;
  updatedAt?: string;
}

export interface LigerRuleAnnotation {
  sentence?: string;
  graph: LigerWebGraph;
  structureJson?: LigerStructure;
  structureVariants?: LigerStructure[];
  structureVariantGraphs?: LigerWebGraph[];
  appliedRules: LigerRule[];
  meaningConstructors?: string;
  numberOfMCsets?: number;
  axioms?: string[];
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
  axioms?: string[];
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
  logicType?: string;
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
}

export interface LigerMergeResponse {
  graph: LigerWebGraph;
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

export interface GswbMultipleRequest {
  premises: { [key: string]: string };
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
}

export interface GswbSolution {
  solution: string;
  id: string;
  sourceIndex?: number;
  graph?: LigerStructure;
  semantic?: string;
  anaphoraMapping?: string;
  anaphoraRelations?: AnaphoraRelation[];
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
}

export interface GswbPcdrsOutput {
  parentSolutionId?: string;
  solutions: GswbSolution[];
}

export interface GswbCollapseAnaphoraRequest {
  semantic: string;
  parentSolutionId?: string;
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
  semanticAnalyses?: SemanticAnalysis[];
  synSemMapping?: SynSemMapping;
  log: string;
  derivation: any;
  discriminants: GswbDiscriminant[];
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
}

export interface RegressionRunTiming {
  startedAt: string | null;
  parseMs: number | null;
  vampireMs: number | null;
  totalMs: number | null;
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
  disambiguationMode: boolean;
}

export interface RegressionSessionInputs {
  grammarPath: string;
  testsuite: RegressionSessionFilePart;
  rules: RegressionSessionFilePart;
  axioms: RegressionSessionFilePart;
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
}

export interface RegressionSessionSaveState {
  lastGswbOutputs: Record<string, GswbOutput> | null;
  lastAnnotations: Record<string, LigerRuleAnnotation> | null;
  lastVampireResults: Record<string, check[]> | null;
  lastLogicType: 'fof' | 'tff';
  lastVampireScopeIdsBySentence: Record<string, string[]>;
  lastVampireMcIdsBySentence: Record<string, string[]>;
  lastVampireSolutionIdsBySentence: Record<string, string[]>;
  sortedMCmap: Record<string, any>;
}

export interface RegressionSessionDocument {
  schemaVersion: 2;
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
  gswbPreferences: GswbPreferences;
  vampirePreferences: VampirePreferences;
  sentenceMap: Record<string, string>;
  regressionTestItems: any[];
  regressionTestResults: RegressionParseResult[];
  inferenceResults: RegressionInferenceResult[];
  selectedSolutionIdsBySentence: Record<string, string[]>;
  selectedScopeIdsBySentence: Record<string, string[]>;
  selectedMcIdsBySentence: Record<string, string[]>;
  lastGswbOutputs: Record<string, GswbOutput> | null;
  lastAnnotations: Record<string, LigerRuleAnnotation> | null;
  lastVampireResults: Record<string, check[]> | null;
  lastLogicType: 'fof' | 'tff';
  lastVampireScopeIdsBySentence: Record<string, string[]>;
  lastVampireMcIdsBySentence: Record<string, string[]>;
  lastVampireSolutionIdsBySentence: Record<string, string[]>;
  sortedMCmap: Record<string, any>;
  hasRunVampire: boolean;
  disambiguationMode: boolean;
  timing: RegressionRunTiming;
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
    schemaVersion: 2,
    metadata: {
      id: sessionId,
      redisSessionKey,
      createdAt,
      updatedAt,
      testsuiteUpdateMode: session?.testsuiteUpdateMode ?? 'write',
      hasRunVampire: Boolean(session?.hasRunVampire),
      disambiguationMode: Boolean(session?.disambiguationMode),
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
      axioms: createRegressionSessionFilePart(
        String(session?.axiomsFilename ?? ''),
        String(session?.axiomsText ?? ''),
        String(session?.axiomsLoadedText ?? session?.axiomsText ?? ''),
      ),
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
        lastAnnotations: session?.lastAnnotations ? { ...session.lastAnnotations } : null,
        lastVampireResults: session?.lastVampireResults ? Object.fromEntries(Object.entries(session.lastVampireResults).map(([key, value]) => [key, (value ?? []).map(item => ({ ...item }))])) : null,
        lastLogicType: session?.lastLogicType ?? 'fof',
        lastVampireScopeIdsBySentence: { ...(session?.lastVampireScopeIdsBySentence ?? {}) },
        lastVampireMcIdsBySentence: { ...(session?.lastVampireMcIdsBySentence ?? {}) },
        lastVampireSolutionIdsBySentence: { ...(session?.lastVampireSolutionIdsBySentence ?? {}) },
        sortedMCmap: { ...(session?.sortedMCmap ?? {}) },
      },
    },
  };
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
    gswbPreferences: { ...(inputs?.gswbPreferences ?? document?.gswbPreferences ?? base.gswbPreferences) },
    vampirePreferences: { ...(inputs?.vampirePreferences ?? document?.vampirePreferences ?? base.vampirePreferences) },
    sentenceMap: { ...(system?.sentenceMap ?? document?.sentenceMap ?? {}) },
    regressionTestItems: Array.isArray(system?.regressionTestItems ?? document?.regressionTestItems) ? (system?.regressionTestItems ?? document?.regressionTestItems) : [],
    regressionTestResults: Array.isArray(system?.regressionTestResults ?? document?.regressionTestResults) ? (system?.regressionTestResults ?? document?.regressionTestResults).map((result: RegressionParseResult) => cloneRegressionParseResult(result)) : [],
    inferenceResults: Array.isArray(system?.inferenceResults ?? document?.inferenceResults) ? (system?.inferenceResults ?? document?.inferenceResults).map((result: RegressionInferenceResult) => cloneRegressionInferenceResult(result)) : [],
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
    disambiguationMode: Boolean(metadata?.disambiguationMode ?? document?.disambiguationMode),
    timing: document?.timing ?? base.timing,
  };
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
    },
    sentenceMap: {},
    regressionTestItems: [],
    regressionTestResults: [],
    inferenceResults: [],
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
    disambiguationMode: false,
    timing: {
      startedAt: null,
      parseMs: null,
      vampireMs: null,
      totalMs: null,
    },
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
}


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
  hypothesis?: string;
  pruning?: boolean;
  active_indices?: number[];
  vampire_preferences?: VampirePreferences;
  tptp_checks?: GswbReasoningChecksOutput[];
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
}

/*class VampireNLI(BaseModel):
premises: List[str]
hypothesis: str*/

export interface nliItem {
  premises: string[];
  hypothesis: string[];
  axioms: string;
  premise_groups?: string[][];
  hypothesis_groups?: string[][];
  premise_ast_groups?: LigerStructure[][];
  hypothesis_ast_groups?: LigerStructure[][];
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

export interface check {
  glyph: string;
  informative: boolean;
  consistent: boolean;
  relevant: boolean;
  proof_files?: string[];
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
  //optional glyph
  glyph?: string;
   showGlyph?: false
   detailText?: string;        // for chat analysis
   semanticText?: string;
   showDetail?: boolean;

   glyphs?: string[];        // raw svg strings (optional to keep)
   safeGlyphs?: SafeHtml[];
   glyphGridSize?: number;

 }
