import {
  DiscourseUpdate,
  NliLabel,
  RegressionInferenceResult,
  REASONING_CHECK_NAMES,
  ReasoningAssignment,
  ReasoningItemVerdict,
  ReasoningUpdate,
  SemanticAnalysis,
  SentenceAnalysis,
  SequenceAnalysis,
  SynSemMapping,
  XlePlusGlueDocument,
  XlePlusGlueElement,
  XlePlusGlueElementRef,
} from './models/models';

/** Resolves a thin element ref against the document's canonical sentences/sequences
 *  registries. Both SentenceAnalysis and SequenceAnalysis share the syntax/semantics/
 *  synSemMapping shape, so callers that only need that shared shape (post-processing,
 *  validation) can treat the result uniformly without either being coerced into the
 *  other's type. */
export function resolveElement(
  document: XlePlusGlueDocument,
  ref: XlePlusGlueElementRef,
): XlePlusGlueElement | undefined {
  return ref.kind === 'sentence'
    ? document.sentences.find(sentence => sentence.id === ref.id)
    : document.sequences.find(sequence => sequence.id === ref.id);
}

/** Resolves by id alone (sentence and sequence ids are drawn from the same id space and
 *  never collide) -- used where only an id is available, e.g. DiscourseUpdate.sourceElementId. */
export function findElementById(
  document: XlePlusGlueDocument,
  id: string,
): XlePlusGlueElement | undefined {
  return document.sentences.find(sentence => sentence.id === id)
    ?? document.sequences.find(sequence => sequence.id === id);
}

/** Builds a stable ordered parent ID. Array position must not be used as identity. */
export function compositeAnalysisId(parts: string[]): string {
  const ids = parts.map(part => part.trim()).filter(Boolean);
  if (!ids.length) {
    throw new Error('Cannot create a composite analysis ID without parent IDs.');
  }
  return ids.join('+');
}

/** Mints a key into `DiscourseUpdate.structures`/`mergedGraphs`. The two tiers stored
 *  there differ in kind, not just in "before/after rules":
 *
 *  - tier A (`ruleBranchIndex` omitted) is the *union* produced by LiGER's
 *    /merge_uploaded_structures -- merged syntax and merged semantics co-present in one
 *    graph but entirely unlinked, since LinguisticStructureMerger.merge only unions
 *    constraints and concatenates annotations;
 *  - tier B is the *interconnected* structure produced by running the post-processing
 *    rules over tier A. Those rules are what create the syntax-to-semantics links, and
 *    anaphora mappings derive from tier B.
 *
 *  Neither tier is recoverable from the source element's own syntax/semantics -- both are
 *  outputs of server-side LiGER round-trips. `ruleBranchIndex` is 1-based, matching the
 *  `parentSolutionId` both views already send to GSWB. */
export function discourseStructureId(semanticId: string, ruleBranchIndex?: number): string {
  return ruleBranchIndex === undefined
    ? semanticId
    : `${semanticId}-rule-${ruleBranchIndex}`;
}

/** Builds a ReasoningUpdate id. Regression items have a stable item id of their own;
 *  chat has none, so the premise/conclusion element ids form the scope instead. */
export function reasoningUpdateId(
  premiseElementIds: string[],
  hypothesisElementIds: string[],
  itemId?: string,
): string {
  if (itemId?.trim()) {
    return `ru-${itemId.trim()}`;
  }
  return `ru-${compositeAnalysisId(premiseElementIds)}=>${compositeAnalysisId(hypothesisElementIds)}`;
}

/** Stable hierarchical assignment id covering item, assignment, side, rule branch and
 *  anaphora branch, as required by LFGXDRT_NLI_CHECK_COMPOSITION_PLAN.md's
 *  "Caching and Stable IDs". Every component is recoverable via
 *  parseReasoningAssignmentId -- array position is never identity.
 *
 *  `anaphoraBranchId` is GSWB's PCDRS mapping id, which is also the id the
 *  corresponding DiscourseAnalysis carries, so an assignment's discourseId can be
 *  checked against its own id rather than trusted blindly. */
export function reasoningAssignmentId(parts: {
  updateId: string;
  premiseSemanticIds: string[];
  hypothesisSemanticIds: string[];
  ruleBranchIndex: number;
  anaphoraBranchId: string;
}): string {
  return `${parts.updateId}`
    + `/P[${parts.premiseSemanticIds.join(',')}]`
    + `/H[${parts.hypothesisSemanticIds.join(',')}]`
    + `/r${parts.ruleBranchIndex}`
    + `/m${parts.anaphoraBranchId}`;
}

export interface ParsedReasoningAssignmentId {
  updateId: string;
  premiseSemanticIds: string[];
  hypothesisSemanticIds: string[];
  ruleBranchIndex: number;
  anaphoraBranchId: string;
}

// Anchored on the fixed markers rather than on separator counting, so ids remain
// parseable when an update id or a GSWB mapping id contains '/' or '+'.
const ASSIGNMENT_ID_PATTERN = /^(.*)\/P\[([^\]]*)\]\/H\[([^\]]*)\]\/r(\d+)\/m(.*)$/;

export function parseReasoningAssignmentId(id: string): ParsedReasoningAssignmentId {
  const match = ASSIGNMENT_ID_PATTERN.exec(id);
  if (!match) {
    throw new Error(`Malformed reasoning assignment id: ${id}`);
  }
  const splitIds = (value: string) => value.split(',').map(part => part.trim()).filter(Boolean);
  return {
    updateId: match[1],
    premiseSemanticIds: splitIds(match[2]),
    hypothesisSemanticIds: splitIds(match[3]),
    ruleBranchIndex: Number(match[4]),
    anaphoraBranchId: match[5],
  };
}

/** Strict-majority vote; ties resolve false. With a single value (the pruned,
 *  reason-over-one-candidate case) this reduces to just that value. Equivalent to the
 *  `count > n/2` form regression used and the `trueCount > n - trueCount` form chat
 *  used -- both call sites now delegate here. */
export function majorityVote(values: boolean[]): boolean {
  const trueCount = values.reduce((acc, value) => acc + (value ? 1 : 0), 0);
  return trueCount > values.length - trueCount;
}

/** The NLI label rule: a conclusion that is consistent but *not* informative adds
 *  nothing new to the premises, i.e. it follows from them (entailment). Inconsistent
 *  means contradiction; consistent and informative means neutral. `relevant` is
 *  deliberately not part of the label. */
export function nliLabelFromVerdicts(consistent: boolean, informative: boolean): NliLabel {
  if (!consistent) return '-1';
  return informative ? '0' : '1';
}

/** Aggregates a reasoning update's assignment verdicts into one item-level verdict.
 *  Assignments without a verdict (not yet run, or failed) are ignored; returns
 *  undefined when none remain. */
export function majorityVerdict(assignments: ReasoningAssignment[]): ReasoningItemVerdict | undefined {
  const scored = assignments.filter(assignment => !!assignment.verdict);
  if (!scored.length) {
    return undefined;
  }
  const consistent = majorityVote(scored.map(assignment => assignment.verdict!.consistent));
  const informative = majorityVote(scored.map(assignment => assignment.verdict!.informative));
  const relevant = majorityVote(scored.map(assignment => assignment.verdict!.relevant));
  return {
    label: nliLabelFromVerdicts(consistent, informative),
    consistent,
    informative,
    relevant,
    assignmentIds: scored.map(assignment => assignment.id),
    glyphs: scored.map(assignment => assignment.verdict!.glyph).filter((glyph): glyph is string => !!glyph),
  };
}

/** Returns all sentence alternatives when no explicit selection has been stored. */
export function selectedSentenceSemantics(sentence: SentenceAnalysis): SemanticAnalysis[] {
  if (!sentence.selectedSemanticIds) {
    return sentence.semantics;
  }
  const selected = new Set(sentence.selectedSemanticIds);
  return sentence.semantics.filter(semantic => selected.has(semantic.semId));
}

export function validateSentenceAnalysis(sentence: SentenceAnalysis): void {
  const syntaxIds = new Set(sentence.syntax.map(syntax => syntax.synId));
  const semanticIds = new Set(sentence.semantics.map(semantic => semantic.semId));
  validateMapping(sentence.synSemMapping, syntaxIds, semanticIds);

  sentence.semantics.forEach(semantic => {
    if (!syntaxIds.has(semantic.syntacticOrigin)) {
      throw new Error(`Semantic ${semantic.semId} has unknown syntax origin ${semantic.syntacticOrigin}.`);
    }
  });

  if (sentence.selectedSemanticIds) {
    sentence.selectedSemanticIds.forEach(semanticId => {
      if (!semanticIds.has(semanticId)) {
        throw new Error(`Sentence selection references unknown semantic ${semanticId}.`);
      }
    });
  }
}

export function validateSequenceAnalysis(document: XlePlusGlueDocument, sequence: SequenceAnalysis): void {
  const syntaxIds = new Set(sequence.syntax.map(syntax => syntax.synId));
  const semanticIds = new Set(sequence.semantics.map(semantic => semantic.semId));
  validateMapping(sequence.synSemMapping, syntaxIds, semanticIds);
  sequence.semantics.forEach(semantic => {
    if (!syntaxIds.has(semantic.syntacticOrigin)) {
      throw new Error(`Semantic ${semantic.semId} has unknown sequence syntax origin ${semantic.syntacticOrigin}.`);
    }
  });
  const knownSentenceIds = new Set(document.sentences.map(sentence => sentence.id));
  const seenSentenceIds = new Set<string>();
  sequence.sentenceIds.forEach(sentenceId => {
    if (!knownSentenceIds.has(sentenceId)) {
      throw new Error(`Sequence ${sequence.id} references unknown sentence ${sentenceId}.`);
    }
    // A sentence appearing twice in one sequence is not "the same sentence spoken
    // twice" -- discourse never repeats an existing sentence into itself. Seen live
    // as a symptom of stale document-reset state: a second discourse's sentence
    // upserted into a first discourse's id under the same session key.
    if (seenSentenceIds.has(sentenceId)) {
      throw new Error(`Sequence ${sequence.id} references sentence ${sentenceId} more than once.`);
    }
    seenSentenceIds.add(sentenceId);
  });
}

export function validateAnalysisDocument(document: XlePlusGlueDocument): void {
  document.sentences.forEach(validateSentenceAnalysis);
  (document.sequences ?? []).forEach(sequence => validateSequenceAnalysis(document, sequence));
  document.elements.forEach(ref => {
    if (!resolveElement(document, ref)) {
      throw new Error(`Element ${ref.kind} ${ref.id} is not registered in sentences/sequences.`);
    }
  });
  (document.discourseUpdates ?? []).forEach(update => validateDiscourseUpdate(document, update));
  (document.reasoningUpdates ?? []).forEach(update => validateReasoningUpdate(document, update));
}

/** The discourse layer stacks on Sentence/Sequence by id reference rather than
 *  embedding into it, so validation here checks the reference resolves and that
 *  semDiscourseMapping stays internally consistent -- it does not touch synSemMapping. */
export function validateDiscourseUpdate(document: XlePlusGlueDocument, update: DiscourseUpdate): void {
  const element = findElementById(document, update.sourceElementId);
  if (!element) {
    throw new Error(`Discourse update ${update.id} references unknown element ${update.sourceElementId}.`);
  }

  const semanticIds = new Set(element.semantics.map(semantic => semantic.semId));
  const discourseIds = new Set(update.discourse.map(discourse => discourse.id));

  update.discourse.forEach(discourse => {
    if (!semanticIds.has(discourse.semanticOrigin)) {
      throw new Error(`Discourse analysis ${discourse.id} has unknown semantic origin ${discourse.semanticOrigin}.`);
    }
  });

  Object.entries(update.semDiscourseMapping).forEach(([semId, mappedDiscourseIds]) => {
    if (!semanticIds.has(semId)) {
      throw new Error(`Discourse mapping references unknown semantic ${semId}.`);
    }
    mappedDiscourseIds.forEach(discourseId => {
      if (!discourseIds.has(discourseId)) {
        throw new Error(`Discourse mapping references unknown discourse analysis ${discourseId}.`);
      }
    });
  });
}

/** The reasoning layer stacks on Sentence/Sequence by id reference, like the discourse
 *  layer, and additionally points *into* the discourse layer for the anaphora mapping a
 *  check was collapsed with. Both hops are checked here, which is what keeps
 *  "reference the DiscourseUpdate, never copy the mapping" a mechanical invariant
 *  rather than a convention. */
export function validateReasoningUpdate(document: XlePlusGlueDocument, update: ReasoningUpdate): void {
  if (!update.premiseElementIds.length || !update.hypothesisElementIds.length) {
    throw new Error(`Reasoning update ${update.id} needs at least one premise and one hypothesis element.`);
  }

  const resolveSide = (elementIds: string[], side: string): XlePlusGlueElement[] =>
    elementIds.map(elementId => {
      const element = findElementById(document, elementId);
      if (!element) {
        throw new Error(`Reasoning update ${update.id} references unknown ${side} element ${elementId}.`);
      }
      return element;
    });

  const premiseElements = resolveSide(update.premiseElementIds, 'premise');
  const hypothesisElements = resolveSide(update.hypothesisElementIds, 'hypothesis');

  if (update.sourceElementId) {
    const source = findElementById(document, update.sourceElementId);
    if (!source) {
      throw new Error(`Reasoning update ${update.id} references unknown source element ${update.sourceElementId}.`);
    }
    const sourceKind = 'sentenceIds' in source ? 'sequence' : 'sentence';
    if (update.sourceElementKind && update.sourceElementKind !== sourceKind) {
      throw new Error(
        `Reasoning update ${update.id} declares source kind ${update.sourceElementKind} but ${update.sourceElementId} is a ${sourceKind}.`);
    }
  }

  const discourseUpdatesById = new Map((document.discourseUpdates ?? []).map(du => [du.id, du]));
  const seenAssignmentIds = new Set<string>();

  update.assignments.forEach(assignment => {
    if (seenAssignmentIds.has(assignment.id)) {
      throw new Error(`Reasoning update ${update.id} has duplicate assignment id ${assignment.id}.`);
    }
    seenAssignmentIds.add(assignment.id);

    const parsed = parseReasoningAssignmentId(assignment.id);
    if (parsed.updateId !== update.id) {
      throw new Error(`Assignment ${assignment.id} does not belong to reasoning update ${update.id}.`);
    }

    validateAssignmentSide(assignment.id, 'premise', assignment.premiseSemanticIds, premiseElements);
    validateAssignmentSide(assignment.id, 'hypothesis', assignment.hypothesisSemanticIds, hypothesisElements);

    // A failed branch legitimately has no usable check set; anything else must carry
    // exactly the four checks -- never renamed, never reduced.
    if (!assignment.failure) {
      const checkNames = Object.keys(assignment.checks ?? {}).sort();
      const expected = [...REASONING_CHECK_NAMES].sort();
      if (checkNames.length !== expected.length || checkNames.some((name, index) => name !== expected[index])) {
        throw new Error(
          `Assignment ${assignment.id} must carry exactly the checks [${expected.join(', ')}], got [${checkNames.join(', ')}].`);
      }
    }

    if (assignment.discourseUpdateId || assignment.discourseId) {
      if (!assignment.discourseUpdateId || !assignment.discourseId) {
        throw new Error(
          `Assignment ${assignment.id} must set both discourseUpdateId and discourseId, or neither.`);
      }
      const discourseUpdate = discourseUpdatesById.get(assignment.discourseUpdateId);
      if (!discourseUpdate) {
        throw new Error(
          `Assignment ${assignment.id} references unknown discourse update ${assignment.discourseUpdateId}.`);
      }
      if (!discourseUpdate.discourse.some(branch => branch.id === assignment.discourseId)) {
        throw new Error(
          `Assignment ${assignment.id} references unknown discourse analysis ${assignment.discourseId} `
          + `in ${assignment.discourseUpdateId}.`);
      }
    }
  });
}

/** Premise/hypothesis semantic ids are positionally aligned with their element id lists:
 *  the i-th semantic id must be a reading of the i-th element. This is the one place
 *  where array position carries meaning, so it is asserted rather than assumed. */
function validateAssignmentSide(
  assignmentId: string,
  side: string,
  semanticIds: string[],
  elements: XlePlusGlueElement[],
): void {
  if (semanticIds.length !== elements.length) {
    throw new Error(
      `Assignment ${assignmentId} has ${semanticIds.length} ${side} semantic ids for ${elements.length} ${side} elements.`);
  }
  semanticIds.forEach((semanticId, index) => {
    if (!elements[index].semantics.some(semantic => semantic.semId === semanticId)) {
      throw new Error(
        `Assignment ${assignmentId} references ${side} semantic ${semanticId}, `
        + `which is not a reading of ${elements[index].id}.`);
    }
  });
}

function validateMapping(
  mapping: SynSemMapping,
  syntaxIds: Set<string>,
  semanticIds: Set<string>,
): void {
  Object.entries(mapping).forEach(([syntaxId, mappedSemanticIds]) => {
    if (!syntaxIds.has(syntaxId)) {
      throw new Error(`Mapping references unknown syntax ${syntaxId}.`);
    }
    mappedSemanticIds.forEach(semanticId => {
      if (!semanticIds.has(semanticId)) {
        throw new Error(`Mapping references unknown semantic ${semanticId}.`);
      }
    });
  });
}
/** `inferenceResults` as a view over the document's reasoning updates.
 *
 *  The label is `majorityVerdict` + `nliLabelFromVerdicts`, which is the same majority rule
 *  and the same label mapping the component applied to Vampire's checks directly -- so
 *  this is a view, not a second opinion. Items with no reasoning update yield nothing;
 *  the caller keeps whatever it computed for those (a non-LFGxDRT run has no updates at
 *  all). Kept here rather than in the component so a stored session can be re-rendered
 *  from the document alone. */
export function inferenceResultsFromDocument(
  document: XlePlusGlueDocument | undefined,
  items: any[],
  sentenceMap: Record<string, string>,
): Record<string, RegressionInferenceResult> {
  const results: Record<string, RegressionInferenceResult> = {};
  const updatesById = new Map((document?.reasoningUpdates ?? []).map(update => [update.id, update]));

  for (const item of items ?? []) {
    const itemId = String(item?.id ?? '');
    const update = updatesById.get(`ru-${itemId}`);
    const verdict = update && majorityVerdict(update.assignments ?? []);
    if (!update || !verdict) continue;

    const goldLabel = item?.gold_label ?? 'unknown';
    const textsFor = (ids: string[]) => (ids ?? [])
      .map(sentenceId => sentenceMap[sentenceId])
      .filter((text: any) => typeof text === 'string' && text.trim().length > 0);

    results[itemId] = {
      id: itemId,
      premises: textsFor(update.premiseElementIds),
      conclusion: textsFor(update.hypothesisElementIds).join(' '),
      predictedLabel: verdict.label,
      goldLabel,
      premiseIds: [...update.premiseElementIds],
      conclusionIds: [...update.hypothesisElementIds],
      mismatch: goldLabel !== verdict.label,
      glyphs: [...(verdict.glyphs ?? [])],
    };
  }
  return results;
}

