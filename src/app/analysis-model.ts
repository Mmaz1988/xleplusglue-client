import { APP_DEFAULTS } from './app-defaults';
import {
  ANAPHORA_AVERAGERS,
  ANAPHORA_RANKERS,
  AnaphoraAverager,
  AnaphoraRankedBranch,
  AnaphoraRankerId,
  AnaphoraRankerSelection,
  AnaphoraRanking,
  DiscourseAnalysis,
  DiscourseUpdate,
  GswbDiscriminant,
  GswbRenderPcdrsRequest,
  GswbSolution,
  LmRankAnaphoraRequest,
  NliLabel,
  RegressionInferenceResult,
  VampirePreferences,
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
  SyntacticAnalysis,
  XlePlusGlueElementRef,
} from './models/models';
import {
  ALL_READINGS,
  ReadingOrderContext,
  ReadingSelection,
  describeReadingSelection,
  normalizedReadingSelection,
  selectedReadingIds,
  selectionNeedsRanking,
} from './reading-order';

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

/** Strict-majority vote; ties resolve false. With a single value (one reading reasoned
 *  over) this reduces to just that value. Equivalent to the
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

/** A derived or merged reading's `SemanticAnalysis`. GSWB sends such a reading (/deduce,
 *  /gswb_batch_proof, /merge_sequence_semantics) once, as `semanticAnalysis`, and nothing
 *  flat: a solution without one is not a derived reading. */
export function readingOf(solution: GswbSolution): SemanticAnalysis {
  if (!solution.semanticAnalysis) {
    throw new Error(`GSWB solution ${solution.id} carries no semanticAnalysis: not a derived or merged reading.`);
  }
  return solution.semanticAnalysis;
}

/** What a reading shows: its SVG in LFGxDRT display mode, its text in the other modes. */
export function readingDisplay(reading: SemanticAnalysis): string {
  return reading.svg ?? reading.prologRender ?? '';
}

/** What `sem-vis` shows of an item, and the text its collapse is keyed on. `sem-vis` takes
 *  both kinds of reading: a derived or merged one carries `semanticAnalysis` and nothing flat,
 *  a PCDRS one carries `solution` (SVG or text) and `semantic`. */
export function semVisDisplay(item: GswbSolution): { solution: string; semantic?: string } {
  return item.semanticAnalysis
    ? { solution: readingDisplay(item.semanticAnalysis), semantic: item.semanticAnalysis.semString || undefined }
    : { solution: item.solution ?? '', semantic: item.semantic };
}

/** Returns all sentence alternatives when no explicit selection has been stored. */
export function selectedSentenceSemantics(sentence: SentenceAnalysis): SemanticAnalysis[] {
  if (!sentence.selectedSemanticIds) {
    return sentence.semantics;
  }
  const selected = new Set(sentence.selectedSemanticIds);
  return sentence.semantics.filter(semantic => selected.has(semantic.semId));
}

/** The syntactic analyses that still have a selected semantic reading.
 *
 *  The point of `SYNSEM_MAPPING` being a disjoint partition: once semantics are
 *  disambiguated, the syntax that survives is exactly the buckets with something left in
 *  them. Preserving a syntactic analysis whose readings were all deselected is how a
 *  discourse ends up re-deriving branches the user already ruled out.
 *
 *  A sentence with no `selectedSemanticIds`, or one whose syntax carries no semantics of
 *  its own yet (normal before its readings are derived in a sequence), is returned
 *  unchanged -- this narrows an explicit selection, it does not invent one. */
export function selectedSentenceSyntax(sentence: SentenceAnalysis): SyntacticAnalysis[] {
  if (!sentence.selectedSemanticIds?.length || !sentence.semantics?.length) {
    return sentence.syntax;
  }
  const selected = new Set(sentence.selectedSemanticIds);
  const surviving = sentence.syntax.filter(syntax => {
    const mapped = sentence.synSemMapping?.[syntax.synId];
    // A syntax with no mapping at all is not "deselected" -- nothing was ever recorded
    // about it, so it stays.
    if (!mapped?.length) return true;
    return mapped.some(semanticId => selected.has(semanticId));
  });
  return surviving.length ? surviving : sentence.syntax;
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

  (update.anaphoraRanking?.branches ?? []).forEach(branch => {
    if (!discourseIds.has(branch.discourseId)) {
      throw new Error(`Anaphora ranking of ${update.id} ranks unknown discourse analysis ${branch.discourseId}.`);
    }
  });
}

/** The ranker selection a view's preferences ask for. Unknown or repeated rankers are dropped;
 *  absent fields (sessions saved before rankers were selectable) mean APP_DEFAULTS. Every view
 *  reads its selection through this. */
export function anaphoraRankerSelection(
  preferences: Pick<VampirePreferences, 'anaphora_rankers' | 'anaphora_averager'> | undefined,
): AnaphoraRankerSelection {
  const known = new Set<string>(ANAPHORA_RANKERS);
  const rankers = [...new Set((preferences?.anaphora_rankers ?? []).filter(id => known.has(id)))] as AnaphoraRankerId[];
  const defaults = APP_DEFAULTS.anaphoraRanking;
  const averager = (ANAPHORA_AVERAGERS as readonly string[]).includes(preferences?.anaphora_averager ?? '')
    ? preferences!.anaphora_averager as AnaphoraAverager
    : defaults.averager as AnaphoraAverager;
  return { rankers: rankers.length ? rankers : defaults.rankers as AnaphoraRankerId[], averager };
}

/** The rankers a stored ranking ran, in priority order; old rankings ran one, named by `method`. */
export function anaphoraRankingMethods(ranking: AnaphoraRanking): string[] {
  return ranking.methods?.length ? ranking.methods : [ranking.method];
}

/** Whether `ranking` was computed with `selection`. The averager only matters for two or more
 *  rankers: with one, the scores and ranks are that ranker's whatever the averager. */
export function anaphoraRankingMatchesSelection(ranking: AnaphoraRanking, selection: AnaphoraRankerSelection): boolean {
  const methods = anaphoraRankingMethods(ranking);
  return methods.join('>') === selection.rankers.join('>')
    && (selection.rankers.length === 1 || ranking.averager === selection.averager);
}

/** The `/rank_anaphora` request for a discourse update, built from the document alone: the
 *  source element's stored syntax and semantic graphs plus each branch's anaphora mapping, and
 *  the selected rankers. Every view produces the same request for the same document and
 *  selection, whichever view built it.
 *  Returns a reason instead when there is nothing to rank or the inputs are not stored. */
export function anaphoraRankingRequest(
  document: XlePlusGlueDocument,
  update: DiscourseUpdate,
  selection: AnaphoraRankerSelection,
): { request: LmRankAnaphoraRequest } | { reason: string } {
  if (!update.discourse.some(branch => branch.anaphoraMapping.relations.length)) {
    return { reason: 'no branch binds a pronoun' };
  }
  const element = findElementById(document, update.sourceElementId);
  if (!element) {
    return { reason: `unknown element ${update.sourceElementId}` };
  }

  const origins = [...new Set(update.discourse
    .filter(branch => branch.anaphoraMapping.relations.length)
    .map(branch => branch.semanticOrigin))];
  const semantics: LmRankAnaphoraRequest['semantics'] = [];
  const syntax: LmRankAnaphoraRequest['syntax'] = {};
  for (const origin of origins) {
    const semantic = element.semantics.find(candidate => candidate.semId === origin);
    const synId = semantic?.syntacticOrigin;
    const structure = element.syntax.find(candidate => candidate.synId === synId)?.structure;
    if (!semantic?.graph || !synId || !structure) {
      return { reason: `semantic origin ${origin} has no stored DRS graph or syntax structure` };
    }
    semantics.push({ semanticOrigin: origin, syntacticOrigin: synId, drs: semantic.graph });
    syntax[synId] = structure;
  }

  return {
    request: {
      syntax,
      semantics,
      branches: update.discourse.map(branch => ({
        discourseId: branch.id,
        semanticOrigin: branch.semanticOrigin,
        relations: branch.anaphoraMapping.relations.map(relation => ({
          // The referent label is what /drs_provenance knows referents by.
          pronoun: relation.pronounDisplay ?? relation.pronounReferentId,
          antecedent: relation.antecedent,
        })),
      })),
      methods: [...selection.rankers],
      averager: selection.averager,
    },
  };
}

function bindingsKey(branches: DiscourseAnalysis[]): string {
  return JSON.stringify(branches.map(branch => [
    branch.id,
    branch.semanticOrigin,
    branch.anaphoraMapping.relations.map(relation =>
      [relation.pronounDisplay ?? relation.pronounReferentId, relation.antecedent]),
  ]).sort());
}

/** Whether a ranking computed for `ranked` still describes `current`: same branches, same
 *  bindings. Collapsing a branch or re-applying the same rules keeps a ranking valid; a new
 *  PCDRS generation does not. */
export function anaphoraRankingStillApplies(ranked: DiscourseUpdate, current: DiscourseUpdate): boolean {
  return bindingsKey(ranked.discourse) === bindingsKey(current.discourse);
}

/** `next` carrying `previous`'s ranking when that ranking still applies to it and was computed
 *  with the selected rankers. Views call this when they replace a discourse update, so
 *  re-upserting unchanged branches does not drop the ranking and trigger another lm call, while
 *  a changed ranker selection does. */
export function carryAnaphoraRanking(
  previous: DiscourseUpdate | undefined,
  next: DiscourseUpdate,
  selection: AnaphoraRankerSelection,
): DiscourseUpdate {
  if (next.anaphoraRanking || !previous?.anaphoraRanking || !anaphoraRankingStillApplies(previous, next)
    || !anaphoraRankingMatchesSelection(previous.anaphoraRanking, selection)) {
    return next;
  }
  return { ...next, anaphoraRanking: previous.anaphoraRanking };
}

/** Whether `update` binds a pronoun and has no ranking computed with `selection`. */
export function needsAnaphoraRanking(update: DiscourseUpdate, selection: AnaphoraRankerSelection): boolean {
  return update.discourse.some(branch => branch.anaphoraMapping.relations.length)
    && (!update.anaphoraRanking || !anaphoraRankingMatchesSelection(update.anaphoraRanking, selection));
}

/** The update as it now stands in `document` with `ranking` attached, or null when the ranking
 *  arrived too late: the update was replaced by one with different branches or bindings, or the
 *  document no longer holds it (e.g. a new conversation). */
export function attachAnaphoraRanking(
  document: XlePlusGlueDocument,
  ranked: DiscourseUpdate,
  ranking: AnaphoraRanking,
): DiscourseUpdate | null {
  const current = document.discourseUpdates?.find(update => update.id === ranked.id);
  if (!current || !anaphoraRankingStillApplies(ranked, current)) {
    return null;
  }
  return { ...current, anaphoraRanking: ranking };
}

/** `branches` grouped by reading, each reading ordered by its ranking. Ranks only compare
 *  branches of one reading (semantic origin of one discourse update), so readings are never
 *  interleaved: they come in the order they first appear in `branches`, each with its branches
 *  by rank (stable: equal ranks keep their generation order, unranked ones last in their reading).
 *  Branches of no ranked update come last, in generation order. */
export function orderByAnaphoraRanking<T extends { id: string }>(
  branches: T[],
  updates: (DiscourseUpdate | undefined)[],
): T[] {
  const placement = new Map<string, { reading: string; rank: number }>();
  updates.forEach(update => {
    if (!update?.anaphoraRanking) return;
    const rankById = new Map(update.anaphoraRanking.branches.map(branch => [branch.discourseId, branch.rank]));
    update.discourse.forEach(branch => placement.set(branch.id, {
      reading: `${update.id}|${branch.semanticOrigin}`,
      rank: rankById.get(branch.id) ?? Number.MAX_SAFE_INTEGER,
    }));
  });
  const readingOrder = new Map<string, number>();
  branches.forEach(branch => {
    const reading = placement.get(branch.id)?.reading;
    if (reading !== undefined && !readingOrder.has(reading)) readingOrder.set(reading, readingOrder.size);
  });
  return branches
    .map((branch, index) => {
      const placed = placement.get(branch.id);
      return {
        branch,
        index,
        reading: placed ? readingOrder.get(placed.reading)! : Number.MAX_SAFE_INTEGER,
        rank: placed?.rank ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.reading - b.reading || a.rank - b.rank || a.index - b.index)
    .map(entry => entry.branch);
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
/** The selection a session's Vampire preferences ask for; absent: the default, every reading. */
export function readingSelectionOf(preferences: VampirePreferences | undefined): ReadingSelection {
  return normalizedReadingSelection(preferences?.reading_selection);
}

/** What a discourse update's readings are ordered in: the update itself, the scope
 *  discriminants of the document's sentences, the session's averager. */
export function discourseOrderContext(
  document: XlePlusGlueDocument,
  updates: DiscourseUpdate[],
  averager: AnaphoraAverager,
): ReadingOrderContext {
  return {
    updates,
    discriminants: document.sentences.flatMap(sentence => sentence.discriminants ?? []),
    averager,
  };
}

/** The sentence readings a discourse reading was built from, in sentence order: the parts of
 *  its semanticOrigin, a positional composite (`S0-s0+S1-s0`). */
export function sentenceReadingIdsOf(reading: Pick<DiscourseAnalysis, 'semanticOrigin'>): string[] {
  return reading.semanticOrigin.split('+');
}

/** The readings of `update` the discriminant selection leaves: those each of whose sentence
 *  readings is in `allowedSentenceReadings` (absent: every reading). The discourse-level
 *  counterpart of a sentence's discriminant narrowing, through the composite semIds. */
export function readingsAllowedByDiscriminants(
  update: DiscourseUpdate,
  allowedSentenceReadings?: Set<string>,
): DiscourseAnalysis[] {
  return !allowedSentenceReadings ? update.discourse : update.discourse.filter(reading =>
    sentenceReadingIdsOf(reading).every(id => allowedSentenceReadings.has(id)));
}

/** The readings of `update` a run reasons over (N4 6d step 2), best first. First the
 *  discriminant selection: a reading survives when each of its sentence readings is in
 *  `allowedSentenceReadings` (absent: no narrowing). Then the discourse's own selection, or
 *  `fallback` (the session default), over what survived: order, filters, top k places.
 *  `applied` is false when the selection needed the LM ranking and the update has none, in
 *  which case every surviving reading is reasoned over. */
export function readingsForReasoning(
  document: XlePlusGlueDocument,
  update: DiscourseUpdate,
  fallback: ReadingSelection,
  averager: AnaphoraAverager,
  allowedSentenceReadings?: Set<string>,
): { readings: DiscourseAnalysis[]; selection: ReadingSelection; applied: boolean } {
  const narrowed: DiscourseUpdate = { ...update, discourse: readingsAllowedByDiscriminants(update, allowedSentenceReadings) };
  return readingsSelectedAcross(document, [narrowed], update.readingSelection ?? fallback, averager);
}

/** The readings of `updates` that `selection` keeps, best first, in one order over all of
 *  them. `applied` is false when the selection needs the LM ranking and an update with
 *  readings has none: then every reading is kept. */
export function readingsSelectedAcross(
  document: XlePlusGlueDocument,
  updates: DiscourseUpdate[],
  selection: ReadingSelection,
  averager: AnaphoraAverager,
): { readings: DiscourseAnalysis[]; selection: ReadingSelection; applied: boolean } {
  const normalized = normalizedReadingSelection(selection);
  const readings = updates.flatMap(update => update.discourse);
  if (selectionNeedsRanking(normalized) && updates.some(update => update.discourse.length && !update.anaphoraRanking)) {
    return { readings, selection: normalized, applied: false };
  }
  const byId = new Map(readings.map(reading => [reading.id, reading]));
  const ids = selectedReadingIds(discourseOrderContext(document, updates, averager), normalized);
  return { readings: ids.map(id => byId.get(id)!), selection: normalized, applied: true };
}

/** The readings of a sentence its discriminant selection keeps: those in every selected scope
 *  and MC discriminant. Undefined when none is selected. */
export function sentenceReadingsAllowedBy(sentence: SentenceAnalysis | undefined): Set<string> | undefined {
  const selected = new Set([...(sentence?.selectedScopeIds ?? []), ...(sentence?.selectedMcIds ?? [])]);
  const discriminants = (sentence?.discriminants ?? []).filter(discriminant => selected.has(discriminant.id));
  if (!discriminants.length) return undefined;
  return discriminants.slice(1).reduce(
    (allowed, discriminant) => new Set([...allowed].filter(id => (discriminant.associatedSolutions ?? []).includes(id))),
    new Set(discriminants[0].associatedSolutions ?? []));
}

/** The part of a composite id that marks a sentence as an empty move (N4 6d): entailed, it
 *  contributed nothing, so the reading is its prior's. Its sentence is skipped when the
 *  reading is appended to. */
export const EMPTY_MOVE_MARK = '~empty';

export function emptyMovePart(sentenceId: string): string {
  return `${sentenceId}${EMPTY_MOVE_MARK}`;
}

export function isEmptyMovePart(part: string): boolean {
  return part.endsWith(EMPTY_MOVE_MARK);
}

/** The A: and P: entries of a PCDRS (`...,A:[a(s3:x2,x1)],P:[p(s5,s0)]`), e.g. `A a(s3:x2,x1)`. */
export function pcdrsChoices(drsString: string): string[] {
  const choices: string[] = [];
  let rest = drsString.trim();
  for (;;) {
    const match = /,([AP]):\[/.exec(rest);
    if (!match) return choices;
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    for (; end < rest.length && depth > 0; end++) {
      if (rest[end] === '[' || rest[end] === '(') depth++;
      if (rest[end] === ']' || rest[end] === ')') depth--;
    }
    topLevelParts(rest.slice(start, end - 1)).forEach(entry => choices.push(`${match[1]} ${entry}`));
    rest = rest.slice(end);
  }
}

/** What a choice is about: the pronoun of an A: entry, the p-box of a P: entry. */
export function choiceKey(choice: string): string {
  const [kind, entry] = [choice.slice(0, 1), choice.slice(2)];
  const inner = entry.slice(entry.indexOf('(') + 1, entry.lastIndexOf(')'));
  return `${kind} ${topLevelParts(inner)[0] ?? ''}`;
}

/** Whether a reading keeps its prior's choices: its entries about what the prior's entries are
 *  about are exactly the prior's. Names survive an append (probe_prior_binding_stability.py),
 *  so the prior's entries keep their text. */
export function agreesWithPrior(readingDrs: string, priorDrs: string): boolean {
  const prior = pcdrsChoices(priorDrs);
  const keys = new Set(prior.map(choiceKey));
  const part = pcdrsChoices(readingDrs).filter(choice => keys.has(choiceKey(choice)));
  return part.length === prior.length && prior.every(choice => part.includes(choice));
}

function topLevelParts(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") quoted = !quoted;
    if (quoted) continue;
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts.filter(Boolean);
}

/** The latest sentence of a discourse reading: the last part of its semanticOrigin. */
export function latestSentenceReadingOf(reading: Pick<DiscourseAnalysis, 'semanticOrigin'>): string {
  const parts = sentenceReadingIdsOf(reading);
  return parts[parts.length - 1];
}

/** The latest sentence's discriminants over the readings of a discourse: each names the
 *  discourse readings built from the sentence readings it names, so a discourse view narrows
 *  by them as a sentence's view does (chat, N4 6d). */
export function discourseDiscriminantsOf(
  discriminants: GswbDiscriminant[], readings: DiscourseAnalysis[],
): GswbDiscriminant[] {
  return discriminants.map(discriminant => {
    const named = new Set(discriminant.associatedSolutions ?? []);
    return {
      ...discriminant,
      associatedSolutions: readings
        .filter(reading => named.has(latestSentenceReadingOf(reading)))
        .map(reading => reading.id),
    };
  });
}

/** What survives a chat turn's message (N4 6d), best first, over the turn's discourse
 *  updates (one per sequence it extended): of the `selectable` readings (sent and consistent;
 *  null: all, a first turn), those whose latest sentence reading is in `allowedLatest` (the
 *  latest sentence's discriminant selection; absent: all), then `selection`. Only the latest
 *  sentence is narrowed: the earlier ones were fixed by the turns before. */
export function turnSurvivors(
  document: XlePlusGlueDocument,
  updates: DiscourseUpdate[],
  selection: ReadingSelection,
  averager: AnaphoraAverager,
  selectable: Set<string> | null,
  allowedLatest?: Set<string>,
): { readings: DiscourseAnalysis[]; selection: ReadingSelection; applied: boolean } {
  const narrowed = updates.map(update => ({
    ...update,
    discourse: update.discourse.filter(reading => (!selectable || selectable.has(reading.id))
      && (!allowedLatest || allowedLatest.has(latestSentenceReadingOf(reading)))),
  }));
  return readingsSelectedAcross(document, narrowed, selection, averager);
}

/** The assignments of `update` that survive `selection` -- for comparing stored results under
 *  another selection. An assignment not linked to a discourse reading always survives. */
export function selectReasoningAssignments(
  document: XlePlusGlueDocument,
  update: ReasoningUpdate,
  selection: ReadingSelection,
  averager: AnaphoraAverager,
): { assignments: ReasoningAssignment[]; applied: boolean } {
  const discourseUpdates = new Map((document.discourseUpdates ?? []).map(du => [du.id, du]));
  const selected = new Map<string, Set<string> | null>();
  let applied = true;
  const assignments = update.assignments.filter(assignment => {
    const discourseUpdate = assignment.discourseUpdateId ? discourseUpdates.get(assignment.discourseUpdateId) : undefined;
    if (!discourseUpdate || !assignment.discourseId) return true;
    if (!selected.has(discourseUpdate.id)) {
      const unranked = selectionNeedsRanking(selection) && !discourseUpdate.anaphoraRanking;
      if (unranked) applied = false;
      selected.set(discourseUpdate.id, unranked ? null : new Set(
        selectedReadingIds(discourseOrderContext(document, [discourseUpdate], averager), selection)));
    }
    const ids = selected.get(discourseUpdate.id);
    return !ids || ids.has(assignment.discourseId);
  });
  return { assignments, applied };
}

/** The discourse branches `assignments` were reasoned over, and every branch of the discourse
 *  updates they point into. */
function branchCoverage(document: XlePlusGlueDocument, assignments: ReasoningAssignment[]): { used: number; total: number } {
  const linked = assignments.filter(assignment => assignment.discourseUpdateId && assignment.discourseId);
  const updateIds = new Set(linked.map(assignment => assignment.discourseUpdateId!));
  const total = (document.discourseUpdates ?? [])
    .filter(du => updateIds.has(du.id))
    .reduce((sum, du) => sum + du.discourse.length, 0);
  return { used: new Set(linked.map(assignment => assignment.discourseId!)).size, total };
}

/** `inferenceResults` as a view over the document's reasoning updates.
 *
 *  The label is `majorityVerdict` + `nliLabelFromVerdicts`, which is the same majority rule
 *  and the same label mapping the component applied to Vampire's checks directly -- so
 *  this is a view, not a second opinion. Items with no reasoning update yield nothing;
 *  the caller keeps whatever it computed for those (a non-LFGxDRT run has no updates at
 *  all). Kept here rather than in the component so a stored session can be re-rendered
 *  from the document alone.
 *
 *  Each item's verdict is the majority over the assignments its run reasoned over (only the
 *  selected readings have any). `override` instead evaluates the same stored verdicts as if
 *  only `override`'s readings had been sent -- for comparisons, never for the report. */
export function inferenceResultsFromDocument(
  document: XlePlusGlueDocument | undefined,
  items: any[],
  sentenceMap: Record<string, string>,
  override?: { selection: ReadingSelection; averager: AnaphoraAverager },
): Record<string, RegressionInferenceResult> {
  const results: Record<string, RegressionInferenceResult> = {};
  const updatesById = new Map((document?.reasoningUpdates ?? []).map(update => [update.id, update]));

  for (const item of items ?? []) {
    const itemId = String(item?.id ?? '');
    const update = updatesById.get(`ru-${itemId}`);
    if (!document || !update) continue;
    const selection = override
      ? selectReasoningAssignments(document, update, override.selection, override.averager)
      : { assignments: update.assignments, applied: update.readingSelection?.applied ?? true };
    const { applied: _recordedApplied, ...recorded } = update.readingSelection ?? { ...ALL_READINGS };
    const used = override?.selection ?? recorded;
    const verdict = majorityVerdict(selection.assignments);
    if (!verdict) continue;

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
      readingSelection: {
        ...normalizedReadingSelection(used),
        applied: selection.applied,
        ...branchCoverage(document, selection.assignments),
      },
    };
  }
  return results;
}

const RANKER_SHORT_NAMES: Record<string, string> = {
  'mlm-pronoun-product': 'mlm×pron',
  'mlm-substitution': 'mlm',
  'mlm-pronoun': 'mlm-pron',
  'mlm-slot': 'mlm-slot',
  'cosine-lexical': 'cos-lex',
  'cosine-description': 'cos-desc',
  'recency': 'recency',
};

function rankerShortName(ranker: string): string {
  return RANKER_SHORT_NAMES[ranker] ?? ranker;
}

function ordinal(rank: number): string {
  const tens = rank % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[rank % 10] ?? 'th';
  return `${rank}${suffix}`;
}

function scoreText(score: number | null | undefined): string {
  return score == null ? 'n/a' : score.toFixed(3);
}

/** How one reading was ranked: a one-line summary and, per binding, a row of the table the sem
 *  view shows in a pill. Shared by every view, so they show the same ranking the same way. */
export interface AnaphoraRankingTable {
  /** "rank 1 · mean score 0.250", or with several rankers
   *  "rank 1 · borda 0.500 (mlm 1st, recency 2nd)". */
  summary: string;
  columns: string[];
  /** One per binding: anaphor, antecedent, then the scores. */
  rows: string[][];
}

/** The ranking of `discourseId` within `update`; null when unranked. Scores are in [0, 1] for
 *  every ranker. One ranker: its score, the raw value behind it, the substituted text and the
 *  recency rank. Several: each ranker's score and the substituted text. */
export function anaphoraRankingTable(update: DiscourseUpdate, discourseId: string): AnaphoraRankingTable | null {
  const ranking = update.anaphoraRanking;
  const branch = ranking?.branches.find(candidate => candidate.discourseId === discourseId);
  const discourse = update.discourse.find(candidate => candidate.id === discourseId);
  if (!ranking || !branch || !discourse) return null;
  const methods = anaphoraRankingMethods(ranking);
  const fused = methods.length > 1;

  const rows = discourse.anaphoraMapping.relations.map(relation => {
    const pronoun = relation.pronounDisplay ?? relation.pronounReferentId;
    const scored = ranking.relations.find(candidate => candidate.semanticOrigin === discourse.semanticOrigin
      && candidate.pronoun === pronoun && candidate.antecedent === relation.antecedent);
    const binding = [scored?.pronounText || pronoun, scored?.antecedentText || relation.antecedent];
    const substitution = scored?.substitution ?? '';
    if (fused) {
      return [...binding, ...methods.map(method => scoreText(scored?.scores?.[method])), substitution];
    }
    const raw = scored?.logProb != null ? `logp ${scored.logProb.toFixed(2)}`
      : scored?.cosine != null ? `cos ${scored.cosine.toFixed(2)}` : '';
    const recency = scored?.recencyRank == null ? 'n/a' : String(scored.recencyRank);
    return [...binding, scoreText(scored?.score), raw, substitution, recency];
  });
  const columns = fused
    ? ['Anaphor', 'Antecedent', ...methods.map(rankerShortName), 'Substitution']
    : ['Anaphor', 'Antecedent', 'Score', 'Raw', 'Substitution', 'Recency'];

  const summary = fused
    ? `rank ${branch.rank} · ${ranking.averager ?? 'combined'} ${scoreText(branch.score)} (${methods
      .map(method => `${rankerShortName(method)} ${branch.ranks?.[method] == null ? 'n/a' : ordinal(branch.ranks[method])}`)
      .join(', ')})`
    : `rank ${branch.rank} · ${branch.score == null ? 'no score' : `mean score ${branch.score.toFixed(3)}`}`;
  return { summary, columns, rows };
}

/** The summary line of anaphoraRankingTable; empty when unranked. */
export function anaphoraRankingCaption(update: DiscourseUpdate, discourseId: string): string {
  return anaphoraRankingTable(update, discourseId)?.summary ?? '';
}

const NLI_LABEL_NAMES: Record<NliLabel, string> = { '1': 'entailment', '0': 'neutral', '-1': 'contradiction' };

/** Every discourse branch of a document, for paging through in a dialog: text DRSs grouped by
 *  reading (in the order the readings first appear), each reading's branches by anaphora rank
 *  (generation order when unranked), captioned with the ranking and with the Vampire verdicts
 *  of the reasoning assignments computed over that branch. Reads the document only. */
export function discourseBranchesForDisplay(document: XlePlusGlueDocument): {
  solutions: GswbSolution[];
  labels: string[];
  /** Index-aligned with `solutions`: each branch's ranking table, null when unranked. */
  rankings: (AnaphoraRankingTable | null)[];
  /** Branches a run sent to Vampire (with or without a verdict yet); undefined before any run. */
  counted?: string[];
  /** Index-aligned with `solutions`: what GSWB /render_pcdrs needs to render each as SVG. */
  render: GswbRenderPcdrsRequest['items'];
} {
  const assignments = (document.reasoningUpdates ?? []).flatMap(update => update.assignments);
  // The branches a run sent to Vampire, verdict or not yet.
  const sentIds = new Set(assignments.filter(assignment => !!assignment.discourseId).map(assignment => assignment.discourseId!));
  const recorded = (document.reasoningUpdates ?? []).find(update => update.readingSelection?.k != null)?.readingSelection;
  const solutions: GswbSolution[] = [];
  const labels: string[] = [];
  const rankings: (AnaphoraRankingTable | null)[] = [];
  const render: GswbRenderPcdrsRequest['items'] = [];

  (document.discourseUpdates ?? []).forEach(update => {
    const origins = [...new Set(update.discourse.map(branch => branch.semanticOrigin))];
    origins.forEach((origin, readingIndex) => {
      const branches = orderByAnaphoraRanking(
        update.discourse.filter(branch => branch.semanticOrigin === origin), [update]);
      branches.forEach(branch => {
        const bindings = branch.anaphoraMapping.relations.length
          ? branch.anaphoraMapping.relations
            .map(relation => `${relation.pronounDisplay ?? relation.pronounReferentId} → ${relation.antecedent}`).join(', ')
          : 'no binding';
        const ranking = anaphoraRankingCaption(update, branch.id) || (update.anaphoraRanking ? 'unranked' : bindings);

        const own = assignments.filter(assignment => assignment.discourseId === branch.id);
        const counts = new Map<string, number>();
        own.forEach(assignment => {
          const outcome = assignment.verdict
            ? NLI_LABEL_NAMES[nliLabelFromVerdicts(assignment.verdict.consistent, assignment.verdict.informative)]
            : assignment.failure ? 'failed' : 'not run';
          counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
        });
        const verdicts = own.length
          ? `Vampire: ${[...counts].map(([outcome, count]) => `${outcome} ×${count}`).join(', ')}`
          : recorded && sentIds.size ? `not sent to Vampire (${describeReadingSelection(recorded)})` : '';

        // `semantic` is what the dialog's Collapse sends to GSWB: the PCDRS with its A:/P:.
        solutions.push({ id: branch.id, solution: branch.drsString, semantic: branch.drsString } as GswbSolution);
        // Nothing to say about reasoning (no run yet, or no verdict for this branch): left out.
        labels.push([`reading ${readingIndex + 1}/${origins.length}`, ranking, verdicts].filter(part => !!part).join(' · '));
        rankings.push(anaphoraRankingTable(update, branch.id));
        // The stored PCDRS itself, A: and P: inline: its merge chain keeps the sentence
        // dividers (I3), and P: is shown.
        render.push({ id: branch.id, semantic: branch.drsString });
      });
    });
  });

  return { solutions, labels, rankings, render, counted: sentIds.size ? solutions.map(s => s.id).filter(id => sentIds.has(id)) : undefined };
}
