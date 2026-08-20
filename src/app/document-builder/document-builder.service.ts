import { Injectable } from '@angular/core';
import { Observable, catchError, concatMap, from, map, of, toArray } from 'rxjs';
import { DataService } from '../data.service';
import { compositeAnalysisId } from '../analysis-model';
import {
  GswbSemanticMergePart,
  GswbSolution,
  LigerStructure,
  SemanticAnalysis,
  SentenceAnalysis,
  SequenceAnalysis,
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

export interface SequenceMergeRequest {
  current: SequenceMergeCurrentSolution[];
  previousContexts: SequenceMergePreviousContext[];
  /** Canonical, always-fully-enriched sentence registry, used to resolve a previous
   *  SequenceAnalysis's sentenceIds back to full SentenceAnalysis objects for the
   *  syntax-merge request. */
  knownSentences: SentenceAnalysis[];
  resolveDrs: boolean;
  /** Passed through to the syntax-merge `ligerSequence` call only (never to a semantic
   *  derivation -- there isn't one). Optional because glue-vis's own callers don't
   *  configure these; chat does (its own grammar/logic-type preferences). */
  ruleString?: string;
  logicType?: 'fof' | 'tff';
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
   *  `SequenceMergeCurrentSolution.semantic`, so its `.graph` is available as the
   *  hypothesis AST reasoning needs, without re-deriving anything. */
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
 * `SequenceMergeResult` above).
 *
 * Chat (Stage B) now calls this same method instead of a separate re-derivation path.
 * That earlier chat-only path merged syntax and then re-proved the new sentence's
 * semantics from scratch via a `/deduce` call on the merged structure -- redundant with
 * a plain `/deduce` chat already runs once per sentence when it's first parsed, and the
 * actual source of a solution-count duplication bug (a sentence with N readings sharing
 * one syntax variant produced N times too many merged pairs, confirmed live via
 * misc/current/chat-document-plan-b-test.json: turn 2 had 8 solutions instead of 4).
 * Investigating the backend endpoints directly (`GswbController.java`) showed
 * `/merge_sequence_semantics` never re-invokes the prover at all -- it only performs a
 * structural DRS-graph merge of two already-proven readings, which is safe because
 * LiGER's `/apply_rules_xle_sequence` already returns source-index-rebased meaning
 * constructors per sequence part (`liger-vis.component.ts`'s `sequenceParts[]`
 * handling), and GSWB's supplied-structure parsing derives source indices from SYN-ID
 * rather than a positional counter (`docs/plans/SUPPLIED_STRUCTURE_ANAPHORA_PLAN.md`).
 * So a sentence's own reading only ever needs to be proven once, at parse time -- the
 * same shape glue-vis already used -- and chat now reuses it here unchanged, dropping
 * its own `ligerSequence`+`gswbDeduce` rebase chain entirely.
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
      }))
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
