import { Injectable } from '@angular/core';
import { Observable, catchError, concatMap, from, map, of, switchMap, toArray } from 'rxjs';
import { DataService } from '../data.service';
import { compositeAnalysisId } from '../analysis-model';
import {
  GswbPreferences,
  GswbSemanticMergePart,
  GswbSolution,
  LigerStructure,
  SemanticAnalysis,
  SentenceAnalysis,
  SequenceAnalysis,
  XlePlusGlueDocument,
  XlePlusGlueElementRef,
} from '../models/models';

/** One of the new sentence's own candidate readings, already resolved by the caller
 *  (`semanticAnalysisFor`/`sentenceAnalysisFor` stay caller-local -- see class doc). */
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

/** Chat's variant: the new sentence's readings are not known ahead of the merge the way
 *  glue-vis's are (glue-vis's "current" solutions come from a /deduce the user already
 *  ran against sequence-rebased meaning constructors, via LigerVisComponent.addSentence()
 *  -- see docs/plans/DOCUMENT_BUILDER_UNIFICATION_PLAN.md). Chat has no such prior step,
 *  so this rebase strategy performs it inline: merge syntax, then derive semantics from
 *  the merged structure. Whatever comes back from that derivation simply IS the new
 *  sentence's reading set for this discourse context -- there is no earlier candidate to
 *  match it back to, so none of `request.current`'s `semantic`/`solution` fields are used
 *  as merge input when this is set; they exist only so `sentenceAnalysis` can identify
 *  which syntax variant to derive from.
 *
 *  No pruning here, by design (user, 2026-08-20): this always builds the full cross
 *  product, same as the non-rebase path. Discarding down to one candidate happens exactly
 *  once, at the very end of the whole turn (ReasoningPipelineService.prepareReasoningChecks's
 *  own `prune`, and the caller's own final selection) -- not cascaded through this method's
 *  intermediate stages. Less efficient when pruning, but keeps this method's behavior
 *  identical regardless of whether the caller happens to be pruning. */
export interface SequenceMergeRebase {
  ruleString?: string;
  logicType?: 'fof' | 'tff';
  gswbPreferences: GswbPreferences;
}

export interface SequenceMergeRequest {
  current: SequenceMergeCurrentSolution[];
  previousContexts: SequenceMergePreviousContext[];
  /** Canonical, always-fully-enriched sentence registry, used to resolve a previous
   *  SequenceAnalysis's sentenceIds back to full SentenceAnalysis objects for the
   *  syntax-merge request. */
  knownSentences: SentenceAnalysis[];
  resolveDrs: boolean;
  /** Absent (the default): glue-vis's path -- `current`'s own semantic/solution fields
   *  are the merge input, unchanged. Present: chat's path, see SequenceMergeRebase. */
  rebase?: SequenceMergeRebase;
}

export interface SequenceMergePair {
  merged: GswbSolution;
  previousElement: SentenceAnalysis | SequenceAnalysis;
  currentElement?: SentenceAnalysis;
  /** Set only by the rebase path: the merged sequence's own syntax structure (needed as
   *  `sequenceStructure` for reasoning-check building), and the specific sequence-scoped
   *  reading that was actually merged -- its own `.graph` is the hypothesis AST
   *  reasoning needs, distinct from `merged` (the whole premise+conclusion). */
  sequenceStructure?: LigerStructure;
  currentSemantic?: SemanticAnalysis;
}

export interface SequenceMergeResult {
  /** Every (current x previous) pair -- never dropped just because its syntax merge
   *  could not be resolved; see the "no semantic alternative may be discarded" invariant
   *  in docs/analysis-data-model.md (xleplusglue-client). */
  pairs: SequenceMergePair[];
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
 * `SequenceMergeResult` above). Chat's own re-derivation path (Stage B of the plan) is
 * not implemented here yet -- this only covers glue-vis's "already-computed readings"
 * case.
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
      return this.mergeSequenceDerived(request, request.rebase);
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
          }))
        )
      ),
      toArray(),
      concatMap(pairs => this.mergeSyntaxForPairs(pairs, request.knownSentences)),
      map(pairs => ({
        pairs,
        sequenceAnalyses: this.aggregateSequenceAnalyses(pairs),
      }))
    );
  }

  /** Chat's path: group (previous x current-syntax-variant) pairs, merge syntax and
   *  derive semantics once per group (never once per reading pairing -- that was the
   *  actual defect in chat's original per-pairing implementation), then semantic-merge
   *  every derived reading against its group's previous context. See SequenceMergeRebase. */
  private mergeSequenceDerived(
    request: SequenceMergeRequest,
    rebase: SequenceMergeRebase,
  ): Observable<SequenceMergeResult> {
    const pairSpecs = request.current.flatMap(currentEntry =>
      request.previousContexts.map(previousContext => ({ currentEntry, previousContext }))
    );

    const groups = new Map<string, typeof pairSpecs>();
    pairSpecs.forEach(spec => {
      const key = `${spec.previousContext.element.id}=>${this.syntaxIds(spec.currentEntry.sentenceAnalysis)}`;
      const group = groups.get(key) ?? [];
      group.push(spec);
      groups.set(key, group);
    });

    return from(Array.from(groups.values())).pipe(
      concatMap(group => this.deriveGroupPairs(group, rebase, request.resolveDrs, request.knownSentences)),
      toArray(),
      // Chat's own registration (registerSentence/upsertSequenceFromContexts) is driven
      // from Vampire's accepted results, not from every raw merge result the way
      // glue-vis's is -- so this path never builds SequenceAnalysis entries itself.
      map(groupResults => ({ pairs: groupResults.flat(), sequenceAnalyses: [] }))
    );
  }

  /** One (previous x current-syntax-variant) group: merge syntax once, derive semantics
   *  from the merged structure once (pruned to the first reading here if requested --
   *  syntax:semantics is 1:many, so this can only happen after deriving), then semantic-
   *  merge every resulting reading against every previous context in the group. Whatever
   *  the derivation returns simply IS the new sentence's reading set for this context --
   *  there is no earlier candidate it needs to be matched back to. */
  private deriveGroupPairs(
    group: Array<{ currentEntry: SequenceMergeCurrentSolution; previousContext: SequenceMergePreviousContext }>,
    rebase: SequenceMergeRebase,
    resolveDrs: boolean,
    knownSentences: SentenceAnalysis[],
  ): Observable<SequenceMergePair[]> {
    const first = group[0];
    const previousElement = first.previousContext.element;
    const currentElement = first.currentEntry.sentenceAnalysis;
    if (!currentElement) {
      console.error('[DocumentBuilder] no resolvable syntax for the new sentence; skipping this group', {
        previousElementId: previousElement.id,
      });
      return of([]);
    }

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
        console.error('[DocumentBuilder] cannot resolve previous sentences for rebase merge; skipping this group', {
          previousElementId: previousElement.id, missingSentenceIds,
        });
        return of([]);
      }
    } else {
      previousSentences = [previousElement];
    }

    const sentences = [...previousSentences, currentElement];
    const mergeDerivedReading = (
      spec: { currentEntry: SequenceMergeCurrentSolution; previousContext: SequenceMergePreviousContext },
      semantic: SemanticAnalysis,
      sequenceStructure?: LigerStructure,
    ): Observable<SequenceMergePair> =>
      this.dataService.gswbMergeSequenceSemantics({
        parts: [
          this.semanticPart(spec.previousContext.semantic, spec.previousContext.element.id),
          this.semanticPart(semantic, currentElement.id),
        ],
        parentSolutionId: spec.currentEntry.solution.id,
        solutionKey: semantic.syntacticOrigin,
        mcSetId: semantic.syntacticOrigin,
        resolveDrs,
      }).pipe(map((merged): SequenceMergePair => ({
        merged, previousElement: spec.previousContext.element, currentElement,
        sequenceStructure, currentSemantic: semantic,
      })));

    return this.dataService.ligerSequence({
      sentences: sentences.map(sentence => sentence.text),
      sentenceIds: sentences.map(sentence => sentence.id),
      ruleString: rebase.ruleString,
      logicType: rebase.logicType,
      parsedSentences: sentences.map(sentence => sentence.syntax.map(syntax => syntax.structure)),
    }).pipe(
      switchMap(sequence => {
        const sequenceSolution = sequence?.solutions?.[0];
        const sequenceStructure = sequenceSolution?.structureJson;
        const parts = Array.isArray(sequenceSolution?.sequenceParts) ? sequenceSolution.sequenceParts : [];
        const currentPart = parts[parts.length - 1];
        if (!currentPart?.meaningConstructors?.trim()) {
          throw new Error('The merged sequence has no source-indexed current sentence part.');
        }
        return this.dataService.gswbDeduce({
          premises: currentPart.meaningConstructors,
          gswbPreferences: rebase.gswbPreferences,
          structure: sequenceStructure,
          proofs: [{
            proofId: currentPart.solutionKey || 'sequence-current-sentence',
            solutionKey: currentPart.solutionKey,
            meaningConstructors: currentPart.meaningConstructors,
            structure: sequenceStructure,
          }],
        }).pipe(map((result: { solutions?: GswbSolution[] }) => {
          const derived: GswbSolution[] = (result?.solutions ?? []).filter(candidate =>
            typeof candidate?.semantic === 'string' && candidate.semantic.trim().length > 0 && !!candidate.graph);
          if (!derived.length) {
            throw new Error('No source-indexed semantic analyses found for the current sentence.');
          }
          return { sequenceStructure, derived };
        }));
      }),
      switchMap(({ sequenceStructure, derived }) => from(group).pipe(
        concatMap(spec => from(derived).pipe(
          concatMap(candidate => mergeDerivedReading(
            spec, this.toSemanticAnalysis(candidate, currentElement.id), sequenceStructure))
        )),
        toArray()
      )),
      catchError(error => {
        console.error('[DocumentBuilder] syntax merge/derive failed for this group; no pairs produced', {
          previousElementId: previousElement.id, currentElementId: currentElement.id, error,
        });
        return of([]);
      })
    );
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
          parsedSentences: sentences.map(sentence => sentence.syntax.map(syntax => syntax.structure)),
        }).pipe(
          map(sequence => {
            const syntax = sequence?.solutions?.[0]?.sequenceAnalysis;
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
