import { APP_DEFAULTS } from './app-defaults';
import {
  ANAPHORA_AVERAGERS,
  ANAPHORA_RANKERS,
  AnaphoraAverager,
  AnaphoraRankedBranch,
  AnaphoraRankerId,
  AnaphoraRankerSelection,
  AnaphoraRanking,
  AnaphoraSelectionMode,
  DiscourseAnalysis,
  DiscourseUpdate,
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
/** `inferenceResults` as a view over the document's reasoning updates.
 *
 *  The label is `majorityVerdict` + `nliLabelFromVerdicts`, which is the same majority rule
 *  and the same label mapping the component applied to Vampire's checks directly -- so
 *  this is a view, not a second opinion. Items with no reasoning update yield nothing;
 *  the caller keeps whatever it computed for those (a non-LFGxDRT run has no updates at
 *  all). Kept here rather than in the component so a stored session can be re-rendered
 *  from the document alone. */
export interface AnaphoraSelectionPolicy {
  mode: AnaphoraSelectionMode;
  k: number;
}

export const ALL_ANAPHORA_BRANCHES: AnaphoraSelectionPolicy = { mode: 'all', k: 1 };

/** The policy a session's Vampire preferences ask for; absent fields mean every branch. */
export function anaphoraSelectionPolicy(preferences: VampirePreferences | undefined): AnaphoraSelectionPolicy {
  const k = Math.max(1, Math.floor(Number(preferences?.anaphora_top_k) || 1));
  return preferences?.anaphora_selection === 'top_k' ? { mode: 'top_k', k } : { ...ALL_ANAPHORA_BRANCHES, k };
}

/** The anaphora branch ids that survive `policy`, per reading: within each semantic origin,
 *  every branch whose score is among the k best distinct scores (dense ranks, "1223"). k
 *  counts anaphora mappings, not branches: several branches binding the same way score the
 *  same, and they are kept or dropped together without using up k. Unscored branches rank
 *  after every score.
 *  A reading with no scored branch keeps all of its branches -- the ranking says nothing
 *  about it -- and so does every reading when the update has no ranking. Readings are never
 *  compared with each other: choosing between syntactic or scope readings is not the ranker's
 *  job. */
export function selectedAnaphoraBranchIds(update: DiscourseUpdate, policy: AnaphoraSelectionPolicy): Set<string> {
  const ids = new Set(update.discourse.map(branch => branch.id));
  if (policy.mode === 'all' || !update.anaphoraRanking) return ids;

  const scoreById = new Map(update.anaphoraRanking.branches.map(branch => [branch.discourseId, branch.score]));
  const origins = [...new Set(update.discourse.map(branch => branch.semanticOrigin))];
  origins.forEach(origin => {
    const branches = update.discourse.filter(branch => branch.semanticOrigin === origin);
    const scores = branches.map(branch => scoreById.get(branch.id) ?? null);
    const distinct = [...new Set(scores.filter((score): score is number => score !== null))];
    if (!distinct.length) return;
    branches.forEach((branch, index) => {
      const score = scores[index];
      const rank = score === null ? distinct.length + 1 : 1 + distinct.filter(other => other > score).length;
      if (rank > policy.k) ids.delete(branch.id);
    });
  });
  return ids;
}

/** The prepared items (anything carrying the anaphora branch it was built over as `mappingId`)
 *  that a run sends to Vampire under `policy`. An item whose branch is not in `discourseUpdate`
 *  is always sent: there is nothing to rank it by. `applied` is false when top-k was asked for
 *  but the update has no ranking, in which case everything is sent. */
export function selectForVampire<T extends { mappingId?: string }>(
  discourseUpdate: DiscourseUpdate | undefined,
  items: T[],
  policy: AnaphoraSelectionPolicy,
): { items: T[]; applied: boolean } {
  if (policy.mode === 'all') return { items, applied: true };
  if (!discourseUpdate?.anaphoraRanking) return { items, applied: false };
  const selected = selectedAnaphoraBranchIds(discourseUpdate, policy);
  const known = new Set(discourseUpdate.discourse.map(branch => branch.id));
  return {
    items: items.filter(item => !item.mappingId || !known.has(item.mappingId) || selected.has(item.mappingId)),
    applied: true,
  };
}

/** The assignments of `update` that survive `policy` -- for comparing stored results under
 *  another selection. An assignment not linked to a discourse branch always survives. */
export function selectReasoningAssignments(
  document: XlePlusGlueDocument,
  update: ReasoningUpdate,
  policy: AnaphoraSelectionPolicy,
): { assignments: ReasoningAssignment[]; applied: boolean } {
  if (policy.mode === 'all') return { assignments: update.assignments, applied: true };

  const discourseUpdates = new Map((document.discourseUpdates ?? []).map(du => [du.id, du]));
  const selected = new Map<string, Set<string>>();
  let applied = false;
  const assignments = update.assignments.filter(assignment => {
    const discourseUpdate = assignment.discourseUpdateId ? discourseUpdates.get(assignment.discourseUpdateId) : undefined;
    if (!discourseUpdate || !assignment.discourseId) return true;
    if (discourseUpdate.anaphoraRanking) applied = true;
    if (!selected.has(discourseUpdate.id)) {
      selected.set(discourseUpdate.id, selectedAnaphoraBranchIds(discourseUpdate, policy));
    }
    return selected.get(discourseUpdate.id)!.has(assignment.discourseId);
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

/** Each item's verdict as its document records it: the majority over the assignments its run
 *  reasoned over (under top-k, only the selected branches have any). `override` instead
 *  evaluates the same stored verdicts as if only `override`'s branches had been sent -- for
 *  comparisons, never for the report. */
export function inferenceResultsFromDocument(
  document: XlePlusGlueDocument | undefined,
  items: any[],
  sentenceMap: Record<string, string>,
  override?: AnaphoraSelectionPolicy,
): Record<string, RegressionInferenceResult> {
  const results: Record<string, RegressionInferenceResult> = {};
  const updatesById = new Map((document?.reasoningUpdates ?? []).map(update => [update.id, update]));

  for (const item of items ?? []) {
    const itemId = String(item?.id ?? '');
    const update = updatesById.get(`ru-${itemId}`);
    if (!document || !update) continue;
    const recorded = update.anaphoraSelection ?? ALL_ANAPHORA_BRANCHES;
    const selection = override
      ? selectReasoningAssignments(document, update, override)
      : { assignments: update.assignments, applied: update.anaphoraSelection?.applied ?? true };
    const policy = override ?? recorded;
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
      anaphoraSelection: {
        mode: policy.mode,
        k: policy.k,
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

/** One-line description of how `discourseId` was ranked within `update`, shared by every view
 *  so they caption the same ranking the same way. Scores are in [0, 1] for every ranker. One
 *  ranker -- the raw value behind each score follows it:
 *  "rank 1 · mean score 0.250 · he → man (score 0.250, logp -1.39, "The man", recency 2)".
 *  Several -- the combined score, each ranker's rank, and each binding's per-ranker scores:
 *  "rank 1 · borda 0.500 (mlm 1st, recency 2nd) · he → man (mlm 0.250, recency 0.500, "The man")".
 *  Empty when unranked. */
export function anaphoraRankingCaption(update: DiscourseUpdate, discourseId: string): string {
  const ranking = update.anaphoraRanking;
  const branch = ranking?.branches.find(candidate => candidate.discourseId === discourseId);
  const discourse = update.discourse.find(candidate => candidate.id === discourseId);
  if (!ranking || !branch || !discourse) return '';
  const methods = anaphoraRankingMethods(ranking);
  if (methods.length > 1) return fusedRankingCaption(ranking, methods, branch, discourse);

  const bindings = discourse.anaphoraMapping.relations.map(relation => {
    const pronoun = relation.pronounDisplay ?? relation.pronounReferentId;
    const scored = ranking.relations.find(candidate => candidate.semanticOrigin === discourse.semanticOrigin
      && candidate.pronoun === pronoun && candidate.antecedent === relation.antecedent);
    const recency = scored?.recencyRank == null ? 'n/a' : scored.recencyRank;
    const raw = scored?.logProb != null ? `, logp ${scored.logProb.toFixed(2)}`
      : scored?.cosine != null ? `, cos ${scored.cosine.toFixed(2)}` : '';
    const scoreText = `score ${scored?.score == null ? 'n/a' : scored.score.toFixed(3)}${raw}`;
    const substitution = scored?.substitution ? `, "${scored.substitution}"` : '';
    return `${scored?.pronounText || pronoun} → ${scored?.antecedentText || relation.antecedent} (${scoreText}${substitution}, recency ${recency})`;
  });
  const score = branch.score == null ? 'no score' : `mean score ${branch.score.toFixed(3)}`;
  return [`rank ${branch.rank}`, score, ...bindings].join(' · ');
}

function fusedRankingCaption(
  ranking: AnaphoraRanking,
  methods: string[],
  branch: AnaphoraRankedBranch,
  discourse: DiscourseAnalysis,
): string {
  const perRanker = methods
    .map(method => `${rankerShortName(method)} ${branch.ranks?.[method] == null ? 'n/a' : ordinal(branch.ranks[method])}`)
    .join(', ');
  const combined = `${ranking.averager ?? 'combined'} ${branch.score == null ? 'n/a' : branch.score.toFixed(3)} (${perRanker})`;
  const bindings = discourse.anaphoraMapping.relations.map(relation => {
    const pronoun = relation.pronounDisplay ?? relation.pronounReferentId;
    const scored = ranking.relations.find(candidate => candidate.semanticOrigin === discourse.semanticOrigin
      && candidate.pronoun === pronoun && candidate.antecedent === relation.antecedent);
    const scores = methods.map(method => `${rankerShortName(method)} ${scoreText(scored?.scores?.[method])}`);
    const substitution = scored?.substitution ? [`"${scored.substitution}"`] : [];
    return `${scored?.pronounText || pronoun} → ${scored?.antecedentText || relation.antecedent} (${[...scores, ...substitution].join(', ')})`;
  });
  return [`rank ${branch.rank}`, combined, ...bindings].join(' · ');
}

const NLI_LABEL_NAMES: Record<NliLabel, string> = { '1': 'entailment', '0': 'neutral', '-1': 'contradiction' };

/** Every discourse branch of a document, for paging through in a dialog: text DRSs grouped by
 *  reading (in the order the readings first appear), each reading's branches by anaphora rank
 *  (generation order when unranked), captioned with the ranking and with the Vampire verdicts
 *  of the reasoning assignments computed over that branch. Reads the document only. */
export function discourseBranchesForDisplay(document: XlePlusGlueDocument): {
  solutions: GswbSolution[];
  labels: string[];
  /** Branches a run sent to Vampire (with or without a verdict yet); undefined before any run. */
  counted?: string[];
  /** Index-aligned with `solutions`: what GSWB /render_pcdrs needs to render each as SVG. */
  render: GswbRenderPcdrsRequest['items'];
} {
  const assignments = (document.reasoningUpdates ?? []).flatMap(update => update.assignments);
  // The branches a run sent to Vampire, verdict or not yet.
  const sentIds = new Set(assignments.filter(assignment => !!assignment.discourseId).map(assignment => assignment.discourseId!));
  const topK = (document.reasoningUpdates ?? []).find(update => update.anaphoraSelection?.mode === 'top_k')?.anaphoraSelection;
  const solutions: GswbSolution[] = [];
  const labels: string[] = [];
  const render: GswbRenderPcdrsRequest['items'] = [];

  (document.discourseUpdates ?? []).forEach(update => {
    const semantics = findElementById(document, update.sourceElementId)?.semantics ?? [];
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
          : topK && sentIds.size ? `not sent to Vampire (top ${topK.k} mapping${topK.k === 1 ? '' : 's'} per reading)` : 'no reasoning over this branch';

        solutions.push({ id: branch.id, solution: branch.drsString } as GswbSolution);
        labels.push([`reading ${readingIndex + 1}/${origins.length}`, ranking, verdicts].join(' · '));
        render.push({
          id: branch.id,
          // The semantic /generate_pcdrs was sent; the branch's own flattened string renders
          // without the sentence dividers.
          semantic: semantics.find(semantic => semantic.semId === origin)?.semString || branch.drsString,
          anaphoraRelations: branch.anaphoraMapping.relations,
        });
      });
    });
  });

  return { solutions, labels, render, counted: sentIds.size ? solutions.map(s => s.id).filter(id => sentIds.has(id)) : undefined };
}
