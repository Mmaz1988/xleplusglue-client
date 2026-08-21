import { Injectable } from '@angular/core';
import { Observable, catchError, concatMap, defer, from, map, of, switchMap, toArray } from 'rxjs';
import { DataService } from '../data.service';
import { compositeAnalysisId } from '../analysis-model';
import {
  GswbDiscriminant,
  GswbPreferences,
  GswbProofInput,
  GswbSemanticMergePart,
  GswbSolution,
  LigerStructure,
  SemanticAnalysis,
  SentenceAnalysis,
  SequenceAnalysis,
  SyntacticAnalysis,
  XlePlusGlueDocument,
  XlePlusGlueElementRef,
} from '../models/models';

/** One of the new sentence's own candidate readings -- already independently parsed and
 *  proven by the caller (a sentence's own reading is never derived inline by this
 *  service; see class doc), and already resolved to which sentence/syntax variant it
 *  belongs to (`semanticAnalysisFor`/`sentenceAnalysisFor` stay caller-local). */
export interface SequenceMergeCurrentSolution {
  /** For `parentSolutionId`/`solutionKey`/`mcSetId` on the merge request only -- its
   *  semantic content is NOT re-read from here, `semantic` below is authoritative. */
  solution: GswbSolution;
  semantic: SemanticAnalysis;
  /** Absent when the caller could not resolve which sentence this reading belongs to
   *  (e.g. before that sentence is registered anywhere) -- the merge still proceeds
   *  semantic-only in that case, matching gswb-vis's existing tolerance for this. */
  sentenceAnalysis?: SentenceAnalysis;
}

export interface SequenceMergePreviousContext {
  semantic: SemanticAnalysis;
  element: SentenceAnalysis | SequenceAnalysis;
}

/** Chat's variant: chat never computes the new sentence's own reading through a
 *  sequence-aware step the way glue-vis's `LigerVisComponent.addSentence()` does (it
 *  only ever independently parses+proves a sentence in isolation, at message-send
 *  time) -- so `mergeSequence` performs that step itself here, once per distinct
 *  previous context, exactly mirroring `addSentence()`/`proofInputsForSequencePart`:
 *  call `ligerSequence` over [prior sentences (supplied, already-parsed) + this new
 *  sentence (deliberately UNSUPPLIED)], so LiGER parses and rule-applies the new
 *  sentence fresh as part of the sequence, producing a `sequenceParts[]` entry whose
 *  meaning constructors are already rebased into the merged SYN-ID range. Proving
 *  those via a scoped `/deduce` (mirroring chat's own turn-1
 *  `calculateSequencePartSemantics`) is what makes the later `/merge_sequence_semantics`
 *  call's lack of its own rebasing safe -- the same precondition glue-vis relies on.
 *  Supplying every sentence's structure instead (as the non-rebase path does) makes
 *  LiGER skip rule application for the whole call and reuse the new sentence's own
 *  unrelated solution-key, which is what silently broke chat's pronoun resolution
 *  (confirmed live via misc/current/chat-document-pronoun-new.json: zero
 *  anaphoraRelations on every assignment).
 *
 *  Whatever `/deduce` derives simply IS the new sentence's reading set for that
 *  context -- there is no earlier candidate to match it back to, so `request.current`
 *  is not used at all when this is set.
 *
 *  No pruning here, by design (user, 2026-08-20): this always builds the full cross
 *  product, same as the non-rebase path. Discarding down to one candidate happens
 *  exactly once, at the very end of the whole turn
 *  (ReasoningPipelineService.prepareReasoningChecks's own `prune`). */
export interface SequenceMergeRebase {
  newSentence: { id: string; text: string };
  ruleString?: string;
  logicType?: 'fof' | 'tff';
  gswbPreferences: GswbPreferences;
  /** The user's disambiguation choice for this sentence, as GSWB discriminant
   *  **identifiers** -- not solution ids.
   *
   *  A rebase-derived reading gets a brand-new solution id (`sequence-1-sequence+S0-s1`
   *  where the standalone parse said `sequence-1-S0-s1`), so a selection stored as a
   *  solution id can never be applied to it. Measured consequence before this existed: a
   *  fully-disambiguated 3-item run reasoned over 4 branches per item instead of 1 and ran
   *  48 Vampire checks instead of 12, three quarters of them over readings the user had
   *  explicitly deselected -- and reported verdicts from them.
   *
   *  A discriminant's `identifier` IS stable across rebasing (verified live: the same
   *  `(f7_t -o (f15_t -o f15_t)) < (f13_t -o (f15_t -o f15_t))` names the same reading
   *  standalone and inside a sequence), because it describes the scope ordering in glue
   *  types rather than naming a solution. So the identifier is the reading identity, and
   *  filtering by it is sound where matching ids or comparing condition strings was not.
   *
   *  Empty/absent means no pruning -- the full cross product, as before. */
  selectedDiscriminantIdentifiers?: string[];
}

export interface SequenceMergeRequest {
  /** Ignored when `rebase` is set -- see SequenceMergeRebase. */
  current: SequenceMergeCurrentSolution[];
  previousContexts: SequenceMergePreviousContext[];
  /** Canonical, always-fully-enriched sentence registry, used to resolve a previous
   *  SequenceAnalysis's sentenceIds back to full SentenceAnalysis objects for the
   *  syntax-merge request. */
  knownSentences: SentenceAnalysis[];
  resolveDrs: boolean;
  /** Passed through to the syntax-merge `ligerSequence` call only (never to a semantic
   *  derivation -- there isn't one, in the non-rebase path). Optional because glue-vis's
   *  own callers don't configure these; chat does (its own grammar/logic-type
   *  preferences). Ignored when `rebase` is set -- rebase carries its own copies. */
  ruleString?: string;
  logicType?: 'fof' | 'tff';
  /** Absent (the default): glue-vis's path -- `current`'s own semantic/solution fields
   *  are the merge input, unchanged. Present: chat's path, see SequenceMergeRebase. */
  rebase?: SequenceMergeRebase;
}

export interface SequenceMergePair {
  merged: GswbSolution;
  previousElement: SentenceAnalysis | SequenceAnalysis;
  currentElement?: SentenceAnalysis;
  /** The merged sequence's own syntax structure, attached once its syntax merge
   *  resolves -- needed as `sequenceStructure` for reasoning-check building. Absent if
   *  the syntax merge for this pair's group could not be resolved (see
   *  `mergeSyntaxForPairs`); a caller that requires it should treat that as a hard
   *  failure rather than guessing, the same way chat's own reasoning-check builder does. */
  sequenceStructure?: LigerStructure;
  /** The new sentence's own reading that went into this pair -- copied straight from
   *  `SequenceMergeCurrentSolution.semantic` in the non-rebase path, so its `.graph` is
   *  available as the hypothesis AST reasoning needs, without re-deriving anything. In
   *  the rebase path this is a freshly-derived reading (see SequenceMergeRebase); its
   *  `syntacticOrigin` always matches `currentSyntax.synId` below when that is set. */
  currentSemantic?: SemanticAnalysis;
  /** Rebase path only: the new sentence's own syntax, as scoped within this specific
   *  ligerSequence call (`sequenceAnalysis.sentences[last]`, mirroring
   *  `LigerVisComponent.proofInputsForSequencePart`'s `sentenceAnalysis` field). The
   *  caller needs this to register `currentSemantic` under the new sentence's OWN
   *  document entry (its `syntacticOrigin` must resolve to a registered synId there, or
   *  `validateSentenceAnalysis`/`validateReasoningUpdate` reject it -- confirmed live via
   *  misc/current/chat-document-pronoun-bug.json and -bug2.json: chat never re-registered
   *  the rebase-derived reading under the sentence, so every reasoning update was
   *  silently rejected by document invariants, turn after turn). */
  currentSyntax?: SyntacticAnalysis;
}

/** One syntactic variant of the merged sequence, as returned by `ligerSequence`.
 *
 *  `ligerSequence`'s `solutions[]` IS the syntactic-ambiguity dimension:
 *  `LigerController.applyRuleRequestXLESequence` builds `variants` as the cross product
 *  of every sentence's syntactic candidates (`collectSequenceVariants`) and emits one
 *  `LigerSolutionAnnotation` per variant. Indexing that list at `[0]` -- which this
 *  service did until 2026-08-21, inherited verbatim from chat's
 *  `calculateSequencePartSemantics` -- silently discarded every parse but the first.
 *  See docs/bug_reports/chat_single_syntax_variant_collapse.md. */
interface DerivedSequenceVariant {
  /** The `ligerSequence` solution's own key (`sequence-<n>-<localIds>`), unique per
   *  variant. Used as the proof's `solutionKey` so GSWB stamps it back onto every
   *  reading it derives (`GswbController.runProofsOverLexicalEntries`), which is how a
   *  returned reading is mapped to the variant it came from. */
  variantKey: string;
  /** This variant's own merged structure. Distinct per variant, and load-bearing:
   *  post-processing joins the semantics' SRC values against the merged structure's
   *  SYN-IDs, so pairing a reading with another variant's structure mis-joins silently
   *  rather than erroring. */
  sequenceStructure?: LigerStructure;
  /** The new sentence's own syntax within this variant (`sequenceAnalysis.sentences[i]`,
   *  mirroring `LigerVisComponent.proofInputsForSequencePart`'s `sentenceAnalysis`).
   *  Its `synId` is the sentence structure's `local_id`, so variants that differ only in
   *  a PREVIOUS sentence's parse legitimately share one `currentSyntax`. */
  currentSyntax?: SyntacticAnalysis;
}

/** One reading of a sentence, derived inside a sequence and tagged with the syntactic
 *  variant it actually came from. The output of `deriveSentenceInSequence`, shared by
 *  chat's first turn, chat's later turns, and regression's chain folds. */
export interface DerivedSentenceReading {
  /** GSWB's raw derived solution -- for `parentSolutionId` on a later merge. */
  solution: GswbSolution;
  /** The reading itself, with `syntacticOrigin` already pointed at `currentSyntax`. */
  semantic: SemanticAnalysis;
  /** The merged structure of the variant THIS reading came from. */
  sequenceStructure?: LigerStructure;
  /** This sentence's own syntax within that variant. */
  currentSyntax?: SyntacticAnalysis;
}

export interface SequenceMergeResult {
  /** Every (current x previous) pair -- never dropped just because its syntax merge
   *  could not be resolved; see the "no semantic alternative may be discarded" invariant
   *  in docs/analysis-data-model.md (xleplusglue-client). */
  pairs: SequenceMergePair[];
  /** Human-readable reasons a previous context produced no pairs at all. Empty on a
   *  fully successful merge. Populated instead of swallowing the cause into an empty
   *  result: a caller that ends up with zero pairs has to be able to say WHY (a LiGER
   *  500, an unresolvable sentence, a reading GSWB stamped with an unknown origin), and
   *  before this existed `deriveAndMergeForContext`'s catchError hid a real
   *  `/apply_rules_xle_sequence` 500 behind "no pairs produced". */
  failures: string[];
  /** One SequenceAnalysis per distinct sentence PAIR (by composite id of the merged
   *  sentenceIds), holding every syntax variant that pair produced in its `.syntax[]` --
   *  not one per syntax variant. Fixes the "multiple sequences per sentence pair" defect
   *  (docs/plans/DOCUMENT_BUILDER_UNIFICATION_PLAN.md), confirmed live via
   *  misc/current/analysis-document-syntactic-ambiguity.json: 3 syntactic analyses x 1
   *  previously produced 3 separate SequenceAnalysis entries instead of one with
   *  `.syntax.length === 3`. Only pairs whose syntax merge actually succeeded
   *  contribute here -- a pair that couldn't be resolved (see SequenceMergePair) still
   *  appears in `pairs` for display, but is not guessed into a sequence entry. */
  sequenceAnalyses: SequenceAnalysis[];
}

/**
 * Owns document lifecycle, registry upserts, and sequence merging for an
 * `XlePlusGlueDocument`, shared between chat and the analysis view (glue-interface/
 * gswb-vis) so the two stop maintaining independent copies of "how a Sentence/Sequence
 * gets registered and merged."
 *
 * `upsertSentenceAnalyses`/`upsertSequenceAnalyses` are moved from
 * `GlueInterfaceComponent`, which owned the only implementation of this that already
 * persisted (chat's own registration was append-only and never needed to merge). See
 * `docs/plans/DOCUMENT_BUILDER_UNIFICATION_PLAN.md` for the "starting a new discourse
 * does not reset the document" defect this was extracted to fix: glue-interface never
 * called `newDocument()` again after construction, so a second discourse's `sentence-1`
 * silently merged into the first discourse's `sentence-1` under the old upsert, keeping
 * a stale `text` while accumulating the new sentence's syntax/semantics under it. This
 * class does not fix "call newDocument() on a new discourse" by itself -- callers must
 * still invoke it explicitly -- but it now refuses to silently merge two different
 * sentence texts under one id, so that failure mode surfaces loudly instead of
 * persisting a corrupted document.
 *
 * `mergeSequence` is moved from `GswbVisComponent`'s `mergeCurrentSolutions`/
 * `mergeSyntaxForResults` (Stage A of the plan above), with two deliberate behavior
 * changes recorded there: syntax merges now serialize via `concatMap` instead of
 * `forkJoin` (2+ concurrent Angular HttpClient calls have been observed to silently
 * drop a response -- see `ReasoningPipelineService`'s own note on the same issue), and
 * `sequenceAnalyses` groups by sentence-pair id rather than syntax-variant id (see
 * `SequenceMergeResult` above).
 *
 * Chat (Stage B) calls this same method for its own sequence merging, via the `rebase`
 * request field (see SequenceMergeRebase) rather than a separate implementation.
 *
 * Investigating the backend endpoints directly (`GswbController.java`) showed
 * `/merge_sequence_semantics` never re-invokes the prover -- it only performs a
 * structural DRS-graph merge of two already-proven readings, with no source-index
 * rebasing of its own (`DrsSequenceMerger.merge` just wraps both trees in a `DrsMerge`
 * node verbatim). That is safe for glue-vis only because its own reading for each
 * sentence is never computed independently: `LigerVisComponent.addSentence()` always
 * calls `ligerSequence` over the growing discourse and proves the newest sentence's
 * `sequenceParts[]` entry (already rebased into the merged SYN-ID range by LiGER's
 * SequenceGraphAssembler) via a scoped `/deduce` -- see `proofInputsForSequencePart`.
 * Chat's own per-sentence reading was never computed that way (a bare, context-free
 * `/apply_rules_xle` + `/deduce` at message-send time), so routing it through the same
 * non-rebase `/merge_sequence_semantics` call unaligned silently broke anaphora
 * resolution: the SRC/SYN-ID join `ReasoningPipelineService.applyNliRules` depends on
 * found nothing to bind, so every mapping degraded to "no antecedent" (confirmed live,
 * misc/current/chat-document-pronoun-new.json: zero non-empty `anaphoraRelations`
 * across 12 assignments). `rebase` makes chat perform the same sequence-aware
 * derivation glue-vis's `addSentence()` does, once per distinct previous context
 * (chat can have several, from an ambiguous premise; glue-vis's own flow only ever has
 * one "sequence so far"), before falling through to the same `/merge_sequence_semantics`
 * call non-rebase pairs use.
 */
@Injectable({ providedIn: 'root' })
export class DocumentBuilderService {
  constructor(private dataService: DataService) {}

  newDocument(sessionKey: string, semanticType: string): XlePlusGlueDocument {
    return {
      id: sessionKey,
      semanticType,
      sentences: [],
      sequences: [],
      elements: [],
    };
  }

  /** Upserts sentences into the canonical `sentences` registry by id. An id not yet
   *  present is registered fresh; an id already present is merged into (syntax/semantics
   *  unioned by their own id, matching the sequence-registry's "never discard an
   *  alternative" invariant) rather than replaced, EXCEPT that a `text` mismatch under
   *  one id throws rather than silently keeping the stale text -- see class doc. */
  upsertSentenceAnalyses(document: XlePlusGlueDocument, analyses: SentenceAnalysis[]): void {
    analyses.forEach(incoming => {
      const existing = document.sentences.find(sentence => sentence.id === incoming.id);
      if (!existing) {
        document.sentences.push({
          ...incoming,
          syntax: [...incoming.syntax],
          semantics: [...incoming.semantics],
          synSemMapping: { ...incoming.synSemMapping },
          discriminants: [...(incoming.discriminants ?? [])],
          selectedSemanticIds: [...(incoming.selectedSemanticIds ?? incoming.semantics.map(semantic => semantic.semId))],
          selectedScopeIds: [...(incoming.selectedScopeIds ?? [])],
          selectedMcIds: [...(incoming.selectedMcIds ?? [])],
        });
        this.upsertElementRef(document, { kind: 'sentence', id: incoming.id });
        document.activeElementId = incoming.id;
        return;
      }

      if (existing.text !== incoming.text) {
        throw new Error(
          `Sentence ${incoming.id} already exists with a different text `
          + `("${existing.text}" vs. incoming "${incoming.text}"). This id belongs to two `
          + `different sentences -- likely a stale document that was never reset for a new `
          + `discourse. Refusing to merge them under one id.`);
      }

      existing.syntax = this.mergeById(existing.syntax, incoming.syntax, item => item.synId);
      existing.semantics = this.mergeById(existing.semantics, incoming.semantics, item => item.semId);
      existing.discriminants = [...(incoming.discriminants ?? existing.discriminants ?? [])];
      existing.selectedSemanticIds = [...(incoming.selectedSemanticIds ?? existing.selectedSemanticIds ?? [])];
      existing.selectedScopeIds = [...(incoming.selectedScopeIds ?? existing.selectedScopeIds ?? [])];
      existing.selectedMcIds = [...(incoming.selectedMcIds ?? existing.selectedMcIds ?? [])];
      Object.entries(incoming.synSemMapping).forEach(([syntaxId, semanticIds]) => {
        existing.synSemMapping[syntaxId] = Array.from(new Set([
          ...(existing.synSemMapping[syntaxId] ?? []),
          ...semanticIds,
        ]));
      });
      // No `elements` write needed: the ref for `existing.id` already occupies the right
      // position and never changes -- only the registry entry's own fields are mutated.
    });
  }

  /** Upserts sequences into the canonical `sequences` registry by id, preserving each
   *  sequence's position on update (matching sentence-upsert semantics) rather than
   *  moving it to the end of the timeline. */
  upsertSequenceAnalyses(document: XlePlusGlueDocument, analyses: SequenceAnalysis[]): void {
    analyses.forEach(incoming => {
      const index = document.sequences.findIndex(sequence => sequence.id === incoming.id);
      if (index === -1) {
        document.sequences.push(incoming);
      } else {
        document.sequences[index] = incoming;
      }
      this.upsertElementRef(document, { kind: 'sequence', id: incoming.id });
      document.activeElementId = incoming.id;
    });
  }

  /** Appends a ref if this id isn't already registered in `elements`; a no-op otherwise,
   *  so callers can call it unconditionally on every upsert without disturbing the
   *  existing position of an already-registered sentence/sequence. */
  private upsertElementRef(document: XlePlusGlueDocument, ref: XlePlusGlueElementRef): void {
    if (!document.elements.some(existingRef => existingRef.id === ref.id)) {
      document.elements = [...document.elements, ref];
    }
  }

  private mergeById<T>(existing: T[], incoming: T[], id: (item: T) => string): T[] {
    const merged = new Map(existing.map(item => [id(item), item]));
    incoming.forEach(item => merged.set(id(item), item));
    return Array.from(merged.values());
  }

  /** The current x previous cross product, one `gswbMergeSequenceSemantics` call per
   *  pair, reusing each side's already-computed `SemanticAnalysis` verbatim -- never a
   *  `/deduce` re-derivation. Then groups the results by distinct syntax pairing and
   *  attaches one syntax merge per group, and finally aggregates by sentence pair. */
  mergeSequence(request: SequenceMergeRequest): Observable<SequenceMergeResult> {
    if (request.rebase) {
      return this.mergeSequenceDerived(
        request.previousContexts, request.rebase, request.resolveDrs, request.knownSentences);
    }
    const pairSpecs = request.current.flatMap(currentEntry =>
      request.previousContexts.map(previousContext => ({ currentEntry, previousContext }))
    );

    return from(pairSpecs).pipe(
      concatMap(({ currentEntry, previousContext }) =>
        this.dataService.gswbMergeSequenceSemantics({
          parts: [
            this.semanticPart(previousContext.semantic, previousContext.element.id),
            this.semanticPart(currentEntry.semantic, currentEntry.sentenceAnalysis?.id),
          ],
          parentSolutionId: currentEntry.solution.id,
          solutionKey: currentEntry.solution.solutionKey,
          mcSetId: currentEntry.solution.mcSetId,
          resolveDrs: request.resolveDrs,
        }).pipe(
          map((merged): SequenceMergePair => ({
            merged,
            previousElement: previousContext.element,
            currentElement: currentEntry.sentenceAnalysis,
            currentSemantic: currentEntry.semantic,
          }))
        )
      ),
      toArray(),
      concatMap(pairs => this.mergeSyntaxForPairs(pairs, request.knownSentences, request.ruleString, request.logicType)),
      map(pairs => ({
        pairs,
        sequenceAnalyses: this.aggregateSequenceAnalyses(pairs),
        // The non-rebase path has no per-context failure mode of its own: an unresolvable
        // syntax merge leaves a pair without `sequenceStructure` rather than dropping it
        // (see mergeSyntaxForPairs), and that is reported through the pair itself.
        failures: [] as string[],
      }))
    );
  }

  /** Chat's path: one sequence-aware derivation per distinct previous context, run
   *  sequentially (`concatMap`, same forkJoin-avoidance rationale as the non-rebase
   *  path). There is no `current`-driven fan-out here -- see SequenceMergeRebase. */
  private mergeSequenceDerived(
    previousContexts: SequenceMergePreviousContext[],
    rebase: SequenceMergeRebase,
    resolveDrs: boolean,
    knownSentences: SentenceAnalysis[],
  ): Observable<SequenceMergeResult> {
    return from(previousContexts).pipe(
      concatMap(previousContext => this.deriveAndMergeForContext(previousContext, rebase, resolveDrs, knownSentences)),
      toArray(),
      // Chat's own registration (registerSentence/upsertSequenceFromContexts) is driven
      // from Vampire's accepted results, not from every raw merge result the way
      // glue-vis's is -- so this path never builds SequenceAnalysis entries itself.
      map(contextResults => ({
        pairs: contextResults.flatMap(result => result.pairs),
        sequenceAnalyses: [],
        failures: contextResults.flatMap(result => result.failures),
      }))
    );
  }

  /** One previous context: merge syntax exactly like `LigerVisComponent.addSentence()`
   *  does -- supply the previous sentence(s)' already-parsed structures, but deliberately
   *  leave the new sentence unsupplied so LiGER parses (and rule-applies) it fresh as
   *  part of this sequence call. Then extract and prove its rebased `sequenceParts[]`
   *  entry (`deriveCurrentPart`), and semantic-merge every resulting reading against
   *  this context. Whatever the derivation returns simply IS the new sentence's reading
   *  set for this context -- there is no earlier candidate it needs to be matched back
   *  to. */
  private deriveAndMergeForContext(
    previousContext: SequenceMergePreviousContext,
    rebase: SequenceMergeRebase,
    resolveDrs: boolean,
    knownSentences: SentenceAnalysis[],
  ): Observable<{ pairs: SequenceMergePair[]; failures: string[] }> {
    const previousElement = previousContext.element;
    let previousSentences: SentenceAnalysis[];
    if ('sentenceIds' in previousElement) {
      // Chat's previous context is always registered as a single opaque unit (its whole
      // accumulated discourse text/structure, not decomposed sentence-by-sentence) -- this
      // branch exists only in case a caller ever passes a genuine multi-sentence
      // SequenceAnalysis, mirroring mergeSyntaxForPairs's own resolution against
      // knownSentences.
      const missingSentenceIds: string[] = [];
      previousSentences = previousElement.sentenceIds.map(id => {
        const sentence = knownSentences.find(candidate => candidate.id === id);
        if (!sentence) missingSentenceIds.push(id);
        return sentence as SentenceAnalysis;
      });
      if (missingSentenceIds.length) {
        const reason = `Cannot resolve previous sentences ${missingSentenceIds.join(', ')} of `
          + `${previousElement.id} against the document's sentence registry.`;
        console.error('[DocumentBuilder] cannot resolve previous sentences for rebase merge; skipping this context', {
          previousElementId: previousElement.id, missingSentenceIds,
        });
        return of({ pairs: [], failures: [reason] });
      }
    } else {
      previousSentences = [previousElement];
    }

    return this.deriveSentenceInSequence(previousSentences, rebase).pipe(
      concatMap(readings => from(readings).pipe(
        concatMap(reading => this.dataService.gswbMergeSequenceSemantics({
          parts: [
            this.semanticPart(previousContext.semantic, previousElement.id),
            this.semanticPart(reading.semantic, rebase.newSentence.id),
          ],
          parentSolutionId: reading.solution.id,
          solutionKey: reading.semantic.syntacticOrigin,
          mcSetId: reading.semantic.syntacticOrigin,
          resolveDrs,
        }).pipe(map((merged): SequenceMergePair => ({
          merged,
          previousElement,
          // This reading's OWN variant's merged structure -- never another variant's.
          sequenceStructure: reading.sequenceStructure,
          currentSemantic: reading.semantic,
          currentSyntax: reading.currentSyntax,
        })))),
        toArray()
      )),
      map(pairs => ({ pairs, failures: [] as string[] })),
      catchError(error => {
        // Report the cause instead of swallowing it. This handler previously returned
        // `of([])`, which is how a real `/apply_rules_xle_sequence` 500 surfaced to the
        // user as nothing but "no pairs produced".
        const reason = `Rebasing ${rebase.newSentence.id} onto ${previousElement.id} failed: `
          + `${this.describeError(error)}`;
        console.error('[DocumentBuilder] syntax merge/derive failed for this context; no pairs produced', {
          previousElementId: previousElement.id, newSentenceId: rebase.newSentence.id, error,
        });
        return of({ pairs: [] as SequenceMergePair[], failures: [reason] });
      })
    );
  }

  /** Derives one sentence's readings **inside a sequence**, across every syntactic
   *  variant of that sequence. The single place this happens for chat and regression,
   *  for the first sentence and for every later one alike.
   *
   *  `previousSentences` empty is the first-sentence case (chat's turn 1, mirroring the
   *  analysis view's `LigerVisComponent.analyzeSentence()`, which also always goes
   *  through `/apply_rules_xle_sequence` rather than the standalone `/apply_rules_xle`).
   *  Non-empty is the append case (`addSentence()`): the prior sentences' structures are
   *  supplied and the new one deliberately is not, so LiGER parses and rule-applies it
   *  fresh, positionally numbered into this sequence.
   *
   *  Turn 1 and turn n used to be two separate implementations of this
   *  (`chat.component.ts`'s `calculateSequencePartSemantics` and this service's own
   *  copy of it). They drifted apart -- both acquired an independent `solutions[0]`, and
   *  only one of them ever got the per-variant fix -- which is exactly the argument for
   *  there being one. Throws rather than degrading: callers wrap this and report the
   *  cause. */
  deriveSentenceInSequence(
    previousSentences: SentenceAnalysis[],
    rebase: SequenceMergeRebase,
  ): Observable<DerivedSentenceReading[]> {
    // `defer` so the validation below fails through the OBSERVABLE's error channel, not
    // as a synchronous throw at subscribe-construction time -- a caller's `catchError`
    // is attached to the returned observable and cannot catch the latter.
    return defer(() => {
    // Every supplied structure must actually BE a structure. A SyntacticAnalysis
    // registered from `/apply_rules_to_batch` carries `structure: undefined` (that
    // endpoint never populates `structureJson`), and `upsertSentenceAnalyses` merges
    // syntax by synId, so such an entry survives alongside a good one under a different
    // id. `undefined` inside an array JSON-serializes to `null`, the array is still
    // non-empty so LiGER's `suppliedThisSentence` guard passes, and
    // `LinguisticStructure.parseFromJson(null)` 500s the whole call. That was the
    // "Could not fold S2 into any branch" failure -- see
    // docs/bug_reports/regression_second_fold_null_structure_500.md.
    const parsedSentences: LigerStructure[][] = [];
    const structurelessSentenceIds: string[] = [];
    for (const sentence of previousSentences) {
      const structures = sentence.syntax
        .map(syntax => syntax.structure)
        .filter((structure): structure is LigerStructure => !!structure);
      if (!structures.length) {
        structurelessSentenceIds.push(sentence.id);
      }
      parsedSentences.push(structures);
    }
    if (structurelessSentenceIds.length) {
      throw new Error(
        `Previous sentence(s) ${structurelessSentenceIds.join(', ')} have no parsed structure to `
        + `supply, so ${rebase.newSentence.id} cannot be rebased onto them. (A syntax entry `
        + `registered without a structure -- e.g. from a batch parse -- is not usable as parse input.)`);
    }

    const newSentenceIndex = previousSentences.length;

    return this.dataService.ligerSequence({
      sentences: [...previousSentences.map(sentence => sentence.text), rebase.newSentence.text],
      sentenceIds: [...previousSentences.map(sentence => sentence.id), rebase.newSentence.id],
      ruleString: rebase.ruleString,
      logicType: rebase.logicType,
      // Deliberately no entry for the new sentence -- see SequenceMergeRebase and
      // commit 78847cb ("Fix chat's pronoun-resolution bug"). Supplying it here would
      // make GswbController.applyRuleRequestXLESequence's suppliedAllSentences path
      // reuse its independent parse verbatim (skipping rule application for the WHOLE
      // call, and keeping whatever solution-key that independent parse had) instead of
      // letting LiGER parse and rule-apply it fresh, positionally numbered into this
      // sequence. Omitted entirely when there are no previous sentences.
      parsedSentences: parsedSentences.length ? parsedSentences : undefined,
    }).pipe(
      switchMap(sequence => this.deriveCurrentPart(sequence, rebase, newSentenceIndex)),
      map(({ variants, derived, discriminants }) => this
        .applyDisambiguation(derived, discriminants, rebase)
        .map(candidate => {
        // Which syntactic variant did GSWB derive this reading from? It stamps the
        // originating proof's solutionKey/proofId onto every solution
        // (GswbController.java:1181-1188), so this is a lookup, not a guess.
        const variantKey = candidate.solutionKey || candidate.proofId;
        const variant = variantKey ? variants.get(variantKey) : undefined;
        if (!variant) {
          // Never fall back to "the first variant": that is exactly the silent
          // mis-attribution this whole change exists to remove, and it would pair the
          // reading with the wrong merged structure (see DerivedSequenceVariant).
          throw new Error(
            `GSWB returned a reading (${candidate.id}) stamped with origin `
            + `"${variantKey ?? '<none>'}", which is not one of the ${variants.size} sequence `
            + `variant(s) it was asked to derive from (${[...variants.keys()].join(', ')}). `
            + `Refusing to guess which syntactic variant it belongs to.`);
        }
        const semantic = this.toSemanticAnalysis(candidate, rebase.newSentence.id);
        // The reading's syntacticOrigin must resolve to a synId registered under the
        // new sentence's OWN document entry (see SequenceMergePair.currentSyntax) --
        // override whatever /deduce's response happened to carry (its own solutionKey/
        // proofId namespace, unrelated to this) rather than merely falling back to it.
        // Resolved per variant, so two readings from two different parses of the same
        // sentence get two different origins instead of silently sharing one.
        if (variant.currentSyntax) {
          semantic.syntacticOrigin = variant.currentSyntax.synId;
        }
        return {
          solution: candidate,
          semantic,
          sequenceStructure: variant.sequenceStructure,
          currentSyntax: variant.currentSyntax,
        };
      }))
    );
    });
  }

  /** Narrows freshly-derived readings to the ones the user actually selected.
   *
   *  Matches on discriminant **identifier**, the one thing about a reading that survives
   *  rebasing -- see `SequenceMergeRebase.selectedDiscriminantIdentifiers`. Several
   *  selected identifiers intersect: a reading has to satisfy every one of them, which is
   *  what selecting two discriminants means in the semvis UI.
   *
   *  Deliberately NOT a silent best-effort: if a selection was made and none of it can be
   *  applied, that is reported rather than quietly reasoning over everything, because
   *  "quietly reasoning over everything" is exactly the bug this replaces. */
  private applyDisambiguation(
    derived: GswbSolution[],
    discriminants: GswbDiscriminant[],
    rebase: SequenceMergeRebase,
  ): GswbSolution[] {
    const selected = rebase.selectedDiscriminantIdentifiers ?? [];
    if (!selected.length) {
      return derived;
    }

    const wanted = new Set(selected);
    const matched = discriminants.filter(discriminant =>
      discriminant?.identifier != null && wanted.has(String(discriminant.identifier)));
    if (!matched.length) {
      throw new Error(
        `None of the ${selected.length} disambiguation choice(s) for ${rebase.newSentence.id} `
        + `could be applied: no derived discriminant carries a matching identifier `
        + `(the derivation offered ${discriminants.length}). Refusing to silently reason over `
        + `every reading instead of the selected one.`);
    }

    let keep: Set<string> | null = null;
    for (const discriminant of matched) {
      const associated = new Set((discriminant.associatedSolutions ?? []).map(String));
      keep = keep === null ? associated : new Set([...keep].filter(id => associated.has(id)));
    }

    const filtered = derived.filter(candidate => keep!.has(String(candidate.id)));
    if (!filtered.length) {
      throw new Error(
        `The disambiguation choice(s) for ${rebase.newSentence.id} matched `
        + `${matched.length} discriminant(s) but no reading satisfies all of them together.`);
    }
    console.info('[DocumentBuilder] disambiguation applied to derived readings', {
      newSentenceId: rebase.newSentence.id,
      derived: derived.length, kept: filtered.length, matchedDiscriminants: matched.length,
    });
    return filtered;
  }

  /** Best-effort one-line rendering of whatever an HttpClient/derivation failure carried,
   *  so a caller can put a real cause in front of the user rather than "no pairs". */
  private describeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    const httpError = error as { status?: number; url?: string; error?: unknown; message?: string };
    if (httpError?.status) {
      const detail = typeof httpError.error === 'string' && httpError.error.trim()
        ? ` -- ${httpError.error.trim().split('\n')[0]}`
        : '';
      return `HTTP ${httpError.status} from ${httpError.url ?? 'the server'}${detail}`;
    }
    return httpError?.message ?? String(error);
  }

  /** Extracts the newest sentence's own, sequence-rebased meaning constructors from
   *  EVERY syntactic variant in a `ligerSequence` response, and proves them all in one
   *  aggregate `/deduce`.
   *
   *  Mirrors `LigerVisComponent.proofInputsForSequencePart` exactly: one
   *  `GswbProofInput` per solution, each carrying that variant's own `structureJson` and
   *  its own `sequenceParts` entry selected **by `sourceIndex`** (not by position --
   *  equivalent for the newest sentence today, but it stops being equivalent the moment
   *  anything folds a non-final sentence, and the explicit form is what the analysis
   *  view uses).
   *
   *  One call, not one per variant: `/deduce` is an aggregate endpoint over syntactic
   *  origins. `GswbProofInput` describes itself as "One syntactic origin and its MC input
   *  within an aggregate deduction"; `parseProofInputs` gives each proof its own MC set,
   *  the prover runs each independently, and each returned solution is stamped with its
   *  origin's proofId/solutionKey/mcSetId/sentenceId. So the syn->sem link comes back
   *  from the server; it does not have to be reconstructed here. */
  private deriveCurrentPart(
    sequence: {
      solutions?: Array<{
        solutionKey?: string;
        structureJson?: LigerStructure;
        sequenceParts?: Array<{ sourceIndex?: number; solutionKey?: string; meaningConstructors?: string }>;
        sequenceAnalysis?: { sentences?: Array<{ id?: string; syntax?: SyntacticAnalysis[] }> };
      }>;
    },
    rebase: SequenceMergeRebase,
    newSentenceIndex: number,
  ): Observable<{
    variants: Map<string, DerivedSequenceVariant>;
    derived: GswbSolution[];
    discriminants: GswbDiscriminant[];
  }> {
    const solutions = Array.isArray(sequence?.solutions) ? sequence.solutions : [];
    const variants = new Map<string, DerivedSequenceVariant>();
    const proofs: GswbProofInput[] = [];

    solutions.forEach((solution, index) => {
      const parts = Array.isArray(solution?.sequenceParts) ? solution.sequenceParts : [];
      const currentPart = parts.find(part => part?.sourceIndex === newSentenceIndex)
        // Positional fallback for a LiGER build that predates `sourceIndex` on the part.
        ?? parts[parts.length - 1];
      if (!currentPart?.meaningConstructors?.trim()) {
        return;
      }
      // The SEQUENCE key, not the part key: variants that differ only in a previous
      // sentence's parse share the new sentence's part key, so keying on that would
      // collapse exactly the distinction this lookup exists to preserve.
      const variantKey = solution.solutionKey || `sequence-variant-${index + 1}`;
      const sentences = solution?.sequenceAnalysis?.sentences ?? [];
      const currentSentence = sentences[newSentenceIndex] ?? sentences[sentences.length - 1];
      variants.set(variantKey, {
        variantKey,
        sequenceStructure: solution.structureJson,
        currentSyntax: currentSentence?.syntax?.[0],
      });
      proofs.push({
        proofId: variantKey,
        sentenceId: currentSentence?.id ?? rebase.newSentence.id,
        solutionKey: variantKey,
        mcSetId: variantKey,
        meaningConstructors: currentPart.meaningConstructors,
        structure: solution.structureJson,
      });
    });

    if (!proofs.length) {
      throw new Error('The merged sequence has no source-indexed current sentence part.');
    }

    console.info('[DocumentBuilder] deriving current sentence part across syntactic variants', {
      newSentenceId: rebase.newSentence.id,
      newSentenceIndex,
      sequenceVariants: solutions.length,
      proofs: proofs.length,
      variantKeys: [...variants.keys()],
    });

    return this.dataService.gswbDeduce({
      // Unused by GSWB whenever `proofs` is non-empty (GswbController.java:102-114 takes
      // the proofs branch); kept populated so a logged request is still readable.
      premises: proofs.map(proof => proof.meaningConstructors).join('\n'),
      gswbPreferences: rebase.gswbPreferences,
      structure: proofs[0].structure,
      proofs,
    }).pipe(map((result: { solutions?: GswbSolution[]; discriminants?: GswbDiscriminant[] }) => {
      const derived: GswbSolution[] = (result?.solutions ?? []).filter(candidate =>
        typeof candidate?.semantic === 'string' && candidate.semantic.trim().length > 0 && !!candidate.graph);
      if (!derived.length) {
        throw new Error('No source-indexed semantic analyses found for the current sentence.');
      }
      return { variants, derived, discriminants: result?.discriminants ?? [] };
    }));
  }

  /** Wraps one of GSWB /deduce's raw derived solutions as a SemanticAnalysis, for the
   *  rebase path -- this is a freshly-derived reading, not a merge result, so it has no
   *  `.semanticAnalysis` of its own to prefer the way `semanticAnalysisFromMerged` does. */
  private toSemanticAnalysis(candidate: GswbSolution, fallbackSyntacticOrigin: string): SemanticAnalysis {
    if (candidate.semanticAnalysis) {
      return candidate.semanticAnalysis;
    }
    return {
      syntacticOrigin: candidate.solutionKey || candidate.proofId || fallbackSyntacticOrigin,
      semId: candidate.id,
      semString: candidate.semantic || candidate.solution || '',
      graph: candidate.graph,
      semType: 'lfgxdrt',
    };
  }

  /** Groups pairs by distinct (previous syntax, current syntax) identity and issues one
   *  `ligerSequence` call per group -- reused across every semantic reading combination
   *  sharing that group -- instead of once per pair. Groups are processed sequentially
   *  (`concatMap`), same rationale as the pair merges above. A pair whose previous/
   *  current element can't be resolved to a syntax, or whose previous sequence's
   *  sentences can't all be found in `knownSentences`, keeps its `merged` semantic
   *  result but is not attached a `sequenceAnalysis` -- it must not be silently dropped
   *  from the result, only from sequence-registration (see SequenceMergeResult). */
  private mergeSyntaxForPairs(
    pairs: SequenceMergePair[],
    knownSentences: SentenceAnalysis[],
    ruleString?: string,
    logicType?: 'fof' | 'tff',
  ): Observable<SequenceMergePair[]> {
    const groups = new Map<string, SequenceMergePair[]>();
    pairs.forEach(pair => {
      const key = `${this.syntaxIds(pair.previousElement)}=>${this.syntaxIds(pair.currentElement)}`;
      const group = groups.get(key) ?? [];
      group.push(pair);
      groups.set(key, group);
    });

    return from(Array.from(groups.values())).pipe(
      concatMap(group => {
        const first = group[0];
        if (!first.currentElement) {
          return of(group);
        }
        let previousSentences: SentenceAnalysis[];
        if ('sentenceIds' in first.previousElement) {
          const missingSentenceIds: string[] = [];
          previousSentences = first.previousElement.sentenceIds.map(id => {
            const sentence = knownSentences.find(candidate => candidate.id === id);
            if (!sentence) missingSentenceIds.push(id);
            return sentence as SentenceAnalysis;
          });
          if (missingSentenceIds.length) {
            console.error('[DocumentBuilder] cannot resolve previous sequence sentences for syntax merge; skipping syntax merge for this group', {
              previousSequenceId: first.previousElement.id,
              missingSentenceIds,
              knownSentenceIds: knownSentences.map(sentence => sentence.id),
            });
            return of(group);
          }
        } else {
          previousSentences = [first.previousElement];
        }
        const sentences = [...previousSentences, first.currentElement];
        return this.dataService.ligerSequence({
          sentences: sentences.map(sentence => sentence.text),
          sentenceIds: sentences.map(sentence => sentence.id),
          ruleString,
          logicType,
          parsedSentences: sentences.map(sentence => sentence.syntax.map(syntax => syntax.structure)),
        }).pipe(
          map(sequence => {
            const solution = sequence?.solutions?.[0];
            const syntax = solution?.sequenceAnalysis;
            if (!syntax) {
              return group;
            }
            // The syntax id THIS group actually merged to -- not whatever
            // GswbSolution.semanticAnalysis.syntacticOrigin the semantic merge (a
            // separate, earlier HTTP call, keyed by GSWB's own solutionKey/parentId
            // scheme) happened to carry. Those two ids live in different namespaces;
            // a semantic must be tagged with ITS OWN syntax pairing's id, or
            // validateSequenceAnalysis's per-semantic syntacticOrigin check fails
            // wherever the two happen not to coincide -- confirmed live via
            // misc/current/analysis-document-3x3syntaxambiguity.json, whose semantics
            // carried syntacticOrigin values from *other* groups' syntax ids entirely.
            const syntaxId = syntax.syntax[0]?.synId || syntax.id;
            return group.map(pair => {
              const semantic: SemanticAnalysis = {
                ...this.semanticAnalysisFromMerged(pair.merged),
                syntacticOrigin: syntaxId,
              };
              pair.merged.sequenceAnalysis = {
                id: pair.merged.id || syntax.id,
                text: syntax.text,
                sentenceIds: syntax.sentences.map(sentence => sentence.id),
                syntax: syntax.syntax,
                semantics: [semantic],
                synSemMapping: { [syntaxId]: [semantic.semId] },
              };
              pair.sequenceStructure = solution.structureJson;
              return pair;
            });
          }),
          catchError(() => of(group))
        );
      }),
      toArray(),
      map(groupResults => groupResults.flat())
    );
  }

  /** One SequenceAnalysis per distinct sentence-pair id, unioning every syntax variant
   *  that pair produced into its `.syntax[]` -- the fix for the "multiple sequences per
   *  sentence pair" defect (see SequenceMergeResult doc). Only pairs that got a
   *  `sequenceAnalysis` attached (i.e. their syntax merge succeeded) contribute; a pair
   *  whose syntax merge failed is not guessed into an existing or new sequence entry. */
  private aggregateSequenceAnalyses(pairs: SequenceMergePair[]): SequenceAnalysis[] {
    const bySentencePair = new Map<string, SequenceAnalysis>();
    pairs.forEach(pair => {
      const template = pair.merged.sequenceAnalysis;
      const syntaxEntry = template?.syntax[0];
      const semantic = template?.semantics[0];
      if (!template || !syntaxEntry || !semantic) {
        return;
      }

      const sequenceId = compositeAnalysisId(template.sentenceIds);
      const analysis = bySentencePair.get(sequenceId) ?? {
        id: sequenceId,
        text: template.text,
        sentenceIds: template.sentenceIds,
        syntax: [],
        semantics: [],
        synSemMapping: {},
      } as SequenceAnalysis;

      if (!analysis.syntax.some(item => item.synId === syntaxEntry.synId)) {
        analysis.syntax = [...analysis.syntax, syntaxEntry];
      }
      if (!analysis.semantics.some(item => item.semId === semantic.semId)) {
        analysis.semantics = [...analysis.semantics, semantic];
      }
      analysis.synSemMapping[syntaxEntry.synId] = Array.from(new Set([
        ...(analysis.synSemMapping[syntaxEntry.synId] ?? []),
        semantic.semId,
      ]));
      bySentencePair.set(sequenceId, analysis);
      // Point the pair's merged solution at the canonical, aggregated entry rather than
      // the single-syntax-variant one mergeSyntaxForPairs attached it to.
      pair.merged.sequenceAnalysis = analysis;
    });
    return Array.from(bySentencePair.values());
  }

  private syntaxIds(element?: SentenceAnalysis | SequenceAnalysis): string {
    return element?.syntax.map(syntax => syntax.synId).join('+') ?? 'unknown';
  }

  /** Mirrors GswbVisComponent's own `semanticAnalysisFor` fallback shape, but scoped to
   *  a just-merged GswbSolution specifically (which almost always already carries
   *  `.semanticAnalysis` set server-side by `/merge_sequence_semantics`) -- this is
   *  internal merge bookkeeping, not the caller-facing "which sentence does this belong
   *  to" identity policy that stays local to each caller (see class doc). */
  private semanticAnalysisFromMerged(solution: GswbSolution): SemanticAnalysis {
    if (solution.semanticAnalysis) {
      return solution.semanticAnalysis;
    }
    return {
      syntacticOrigin: solution.solutionKey || solution.proofId || 'syntax',
      semId: solution.id,
      semString: solution.semantic || solution.solution || '',
      graph: solution.graph,
      semType: 'lfgxdrt',
    };
  }

  private semanticPart(semantic: SemanticAnalysis, sentenceId?: string): GswbSemanticMergePart {
    return {
      id: semantic.semId,
      sentenceId,
      solutionId: semantic.semId,
      syntacticOrigin: semantic.syntacticOrigin,
      semantic: semantic.semString,
      graph: semantic.graph,
      provenance: {
        syntacticOrigin: semantic.syntacticOrigin,
        semanticId: semantic.semId,
      },
    };
  }
}
