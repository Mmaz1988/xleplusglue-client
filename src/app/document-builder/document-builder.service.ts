import { Injectable } from '@angular/core';
import { Observable, catchError, concatMap, defer, forkJoin, from, map, of, toArray } from 'rxjs';
import { DataService } from '../data.service';
import { compositeAnalysisId, readingOf } from '../analysis-model';
import { proofInputsFrom } from './proof-inputs';
import { MappingWithStructure, PcdrsRuleBranch, distinctPcdrsMappings } from './pcdrs-readings';
import {
  GswbDiscriminant,
  GswbPreferences,
  GswbSemanticMergePart,
  GswbSolution,
  LigerSolutionAnnotation,
  LigerStructure,
  SemanticAnalysis,
  SentenceAnalysis,
  SequenceAnalysis,
  SyntacticAnalysis,
  XlePlusGlueDocument,
  XlePlusGlueElementRef,
} from '../models/models';

/** One reading a discourse is extended from: a Sentence's own reading, or a Sequence's
 *  merged one. Its `syntacticOrigin` names the parse of every sentence it was derived from
 *  -- a sentence's synId, or a sequence's composite of them (`compositeAnalysisId`). */
export interface SequenceMergePreviousContext {
  semantic: SemanticAnalysis;
  element: SentenceAnalysis | SequenceAnalysis;
}

/** Appending a sentence to the discourse readings in `previousContexts`. */
export interface SentenceAppendRequest {
  previousContexts: SequenceMergePreviousContext[];
  /** The new sentence as registered: its own syntax, one entry per parse with its structure. */
  sentence: SentenceAnalysis;
  /** The new sentence's readings to append, each derived on its own (`syntacticOrigin` = the
   *  synId of its parse in `sentence.syntax`). The caller's disambiguation is already applied. */
  readings: SemanticAnalysis[];
  /** The document's sentence registry: a previous context's sentences and their parses are
   *  resolved against it. */
  knownSentences: SentenceAnalysis[];
  resolveDrs: boolean;
  ruleString?: string;
}

export interface SequenceMergePair {
  merged: GswbSolution;
  previousElement: SentenceAnalysis | SequenceAnalysis;
  /** The previous context's reading that went into this pair. */
  previousSemantic: SemanticAnalysis;
  currentElement: SentenceAnalysis;
  /** The new sentence's own reading that went into this pair, as derived on its own. */
  currentSemantic: SemanticAnalysis;
  /** The parse of the new sentence that reading came from (one of `currentElement.syntax`). */
  currentSyntax: SyntacticAnalysis;
  /** The merged structure of the sequence variant this pair belongs to: the previous
   *  context's parses followed by `currentSyntax`. Post-processing joins the merged reading's
   *  SRC ids against its SYN-IDs. */
  sequenceStructure?: LigerStructure;
  /** The new reading's part offset in that variant, as LiGER reported it and GSWB applied it. */
  sourceIndexOffset: number;
}

export interface SequenceMergeResult {
  /** One pair per (previous context, new reading) of the same sequence variant. */
  pairs: SequenceMergePair[];
  /** Why a previous context produced no pairs, or a reading could not be placed. Empty on a
   *  fully successful append; a caller with fewer pairs than expected can say why. */
  failures: string[];
  /** One SequenceAnalysis per distinct sentence sequence, holding every syntax variant the
   *  pairs used in its `.syntax[]` (composite synIds) and every merged reading. */
  sequenceAnalyses: SequenceAnalysis[];
}

/** A sentence derived on its own: one `/deduce` over its parses. */
export interface DerivedSentence {
  /** The sentence with one syntax entry per parse (`synId` = the parse's `solutionKey`) and
   *  its readings, each pointing at its parse. */
  analysis: SentenceAnalysis;
  /** GSWB's solutions, in the same order as `analysis.semantics`. */
  solutions: GswbSolution[];
  discriminants: GswbDiscriminant[];
}

/** A previous context resolved to the sentences it covers and the parse of each it was
 *  derived from, in order. */
interface ResolvedContext {
  context: SequenceMergePreviousContext;
  index: number;
  sentences: SentenceAnalysis[];
  parses: SyntacticAnalysis[];
}

/**
 * Owns document lifecycle, registry upserts, and how a discourse grows, for an
 * `XlePlusGlueDocument` -- shared by the analysis view, chat and regression
 * (docs/plans/DERIVE_ONCE_REBASE_PLAN.md in xleplusglue; R5: no view-local variant).
 *
 * A sentence is derived once, on its own, per parse (`deriveSentence`, or the caller's own
 * `/deduce`/batch over the same proofs). Appending it to a discourse (`appendSentence`)
 * derives nothing: one `ligerSequence` call over the already-parsed sentences gives every
 * syntactic variant of the sequence, with each part's `sourceIndexOffset`; each new reading
 * is merged only with the discourse readings of its own variant, and GSWB moves the new
 * reading's SRC ids by that offset (`GswbSemanticMergePart.sourceIndexOffset`). Within a
 * sequence a sentence's meaning constructors are its own with their indices shifted by the
 * offset, and a derived reading carries the index nowhere but in SRC, so the merged reading
 * is the one an in-sequence derivation would give (verified: `tests/probes/rebase_probe.py`).
 *
 * `upsertSentenceAnalyses` refuses to merge two different sentence texts under one id, so a
 * document that was not reset for a new discourse fails loudly rather than silently.
 */
@Injectable({ providedIn: 'root' })
export class DocumentBuilderService {
  constructor(private dataService: DataService) {}

  /** The PCDRS readings of post-processing rule branches: GSWB /generate_pcdrs per branch,
   *  duplicates dropped (`distinctPcdrsMappings`). The one procedure analysis, chat and
   *  regression build their PCDRS readings with. Fails with GSWB's rejections when no
   *  branch yields a reading: every reading the rules allow may be rejected by the collapse. */
  generatePcdrsReadings(request: {
    scopeId: string;
    branches: PcdrsRuleBranch[];
    /** Whether GSWB renders each reading to SVG. */
    includeSvg: boolean;
  }): Observable<MappingWithStructure[]> {
    const { scopeId, branches } = request;
    return forkJoin(branches.map(branch => this.dataService.gswbGeneratePcdrs({
      semantic: branch.semantic,
      parentSolutionId: branch.parentSolutionId,
      mergedStructure: branch.structure,
      rulesApplied: branch.rulesApplied,
      includeSvg: request.includeSvg,
    }))).pipe(map(results => {
      const generated = results.flatMap((result, index) =>
        (result?.solutions ?? []).map(mapping => ({
          mapping,
          ruleBranchIndex: branches[index].ruleBranchIndex,
          semanticOrigin: branches[index].semanticOrigin,
        })));
      if (!generated.length) {
        const rejected = results.flatMap(result => result?.rejected ?? [])
          .map(reading => `${reading.id}: ${reading.rejection}`);
        throw new Error('No post-processed sequence interpretations were generated.'
          + (rejected.length ? ` Rejected: ${rejected.join('; ')}` : ''));
      }
      const distinct = distinctPcdrsMappings(generated);
      if (distinct.length < generated.length) {
        console.info('[DocumentBuilder] dropped duplicate anaphora mappings', {
          scopeId,
          generated: generated.length,
          distinct: distinct.length,
          dropped: generated.length - distinct.length,
        });
      }
      console.info('[DocumentBuilder] PCDRS candidates generated', {
        scopeId,
        ruleBranchCount: branches.length,
        mappingCount: distinct.length,
        anaphoraResolvedCount: distinct.filter(({ mapping }) =>
          (mapping.anaphoraRelations ?? []).length > 0).length,
      });
      return distinct;
    }));
  }

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

  /** Derives a sentence on its own: one `/deduce` over every parse in `parses` (LiGER's
   *  solutions for this sentence alone, from `/apply_rules_xle` or a one-sentence
   *  `ligerSequence`). Each reading points at the parse it came from -- GSWB stamps the
   *  proof's `solutionKey` onto it -- and the parse is the sentence's syntax entry under that
   *  key. Throws (through the observable) when no reading is derived. */
  deriveSentence(
    sentence: { id: string; text: string },
    parses: LigerSolutionAnnotation[],
    gswbPreferences: GswbPreferences,
  ): Observable<DerivedSentence> {
    return defer(() => {
      const proofs = proofInputsFrom(parses, { idPrefix: sentence.id, sentenceId: sentence.id });
      if (!proofs.length) {
        throw new Error(`${sentence.id} has no meaning constructors to derive.`);
      }
      const syntax: SyntacticAnalysis[] = proofs.map(proof => {
        const parse = parses.find(candidate => candidate.solutionKey === proof.solutionKey);
        return {
          synId: proof.solutionKey,
          structure: proof.structure as LigerStructure,
          graph: parse?.graph ?? { graphElements: [] },
          meaningConstructors: proof.meaningConstructors,
          numberOfMCsets: parse?.numberOfMCsets,
          appliedRules: parse?.appliedRules,
          axioms: parse?.axioms,
        };
      });
      return this.dataService.gswbDeduce({
        premises: proofs.map(proof => proof.meaningConstructors).join('\n'),
        gswbPreferences,
        structure: proofs[0].structure,
        proofs,
      }).pipe(map((output: { solutions?: GswbSolution[]; discriminants?: GswbDiscriminant[] }): DerivedSentence => {
        const solutions = (output?.solutions ?? []).filter(solution =>
          !!solution.semanticAnalysis?.semString?.trim() && !!solution.semanticAnalysis?.graph);
        if (!solutions.length) {
          throw new Error(`No semantics derived for ${sentence.id}.`);
        }
        const semantics = solutions.map(solution => {
          const origin = solution.solutionKey || solution.proofId;
          if (!syntax.some(parse => parse.synId === origin)) {
            throw new Error(`GSWB returned reading ${solution.id} of ${sentence.id} stamped with `
              + `"${origin ?? '<none>'}", none of its parses (${syntax.map(parse => parse.synId).join(', ')}).`);
          }
          return { ...readingOf(solution), syntacticOrigin: origin! };
        });
        const synSemMapping: Record<string, string[]> = {};
        semantics.forEach(semantic => (synSemMapping[semantic.syntacticOrigin] ??= []).push(semantic.semId));
        return {
          analysis: { id: sentence.id, text: sentence.text, syntax, semantics, synSemMapping },
          solutions,
          discriminants: output?.discriminants ?? [],
        };
      }));
    });
  }

  /** Appends a sentence to the discourse readings in `previousContexts` -- the one procedure
   *  the analysis view, chat and regression share. Runs no `/deduce`:
   *
   *  1. every context is resolved to its sentences and the parse of each it came from;
   *  2. per group of contexts over the same sentences, one `ligerSequence` call supplies the
   *     parses those contexts use and the new sentence's parses that have a reading to
   *     append (nothing is parsed again) -> the sequence's variants;
   *  3. per variant, the contexts whose parses are the variant's prefix are crossed with the
   *     new readings of the variant's parse of the new sentence;
   *  4. per pair one `/merge_sequence_semantics`: the context as it is, the new reading moved
   *     by its part's `sourceIndexOffset`. The pair's syntax is the variant's structure.
   *
   *  Readings after appending = sum over variants of (contexts of the prefix x new readings
   *  of that parse). Sequential (`concatMap`): 2+ concurrent HttpClient calls joined with
   *  forkJoin have been seen to drop a notification. */
  appendSentence(request: SentenceAppendRequest): Observable<SequenceMergeResult> {
    return defer(() => {
      const { sentence, readings } = request;
      const failures: string[] = [];
      const resolved: ResolvedContext[] = [];
      request.previousContexts.forEach((context, index) => {
        const parses = this.previousParses(context.element, context.semantic, request.knownSentences);
        if ('failure' in parses) {
          failures.push(`Cannot append ${sentence.id} to ${context.element.id} (${context.semantic.semId}): ${parses.failure}`);
        } else {
          resolved.push({ context, index, ...parses });
        }
      });

      const newParses = sentence.syntax.filter(parse =>
        readings.some(reading => reading.syntacticOrigin === parse.synId));
      const unplaced = readings.filter(reading => !newParses.some(parse => parse.synId === reading.syntacticOrigin));
      if (unplaced.length) {
        throw new Error(`Reading(s) ${unplaced.map(reading => reading.semId).join(', ')} of ${sentence.id} name `
          + `none of its parses (${sentence.syntax.map(parse => parse.synId).join(', ')}).`);
      }
      const structureless = newParses.find(parse => !parse.structure);
      if (structureless) {
        throw new Error(`Parse ${structureless.synId} of ${sentence.id} has no structure to supply.`);
      }

      const groups = new Map<string, ResolvedContext[]>();
      resolved.forEach(entry => {
        const key = JSON.stringify(entry.sentences.map(previous => previous.id));
        groups.set(key, [...(groups.get(key) ?? []), entry]);
      });

      return from([...groups.values()]).pipe(
        concatMap(group => defer(() => this.appendToGroup(group, sentence, newParses, readings, request)).pipe(
          catchError(error => {
            console.error('[DocumentBuilder] appending failed for a group of contexts', {
              previousElementIds: group.map(entry => entry.context.element.id), sentenceId: sentence.id, error,
            });
            return of({
              pairs: [] as Array<{ index: number; pair: SequenceMergePair }>,
              failures: group.map(entry => `Appending ${sentence.id} to ${entry.context.element.id} `
                + `(${entry.context.semantic.semId}) failed: ${this.describeError(error)}`),
            });
          }),
        )),
        toArray(),
        map(results => {
          const pairs = results.flatMap(result => result.pairs)
            .sort((a, b) => a.index - b.index)
            .map(entry => entry.pair);
          return {
            pairs,
            failures: [...failures, ...results.flatMap(result => result.failures)],
            sequenceAnalyses: this.aggregateSequenceAnalyses(pairs),
          };
        }),
      );
    });
  }

  /** Steps 2-4 of `appendSentence` for contexts over the same sentences. */
  private appendToGroup(
    group: ResolvedContext[],
    sentence: SentenceAnalysis,
    newParses: SyntacticAnalysis[],
    readings: SemanticAnalysis[],
    request: SentenceAppendRequest,
  ): Observable<{ pairs: Array<{ index: number; pair: SequenceMergePair }>; failures: string[] }> {
    const previousSentences = group[0].sentences;
    // Per previous sentence, the parses its contexts use, in the sentence's own order.
    const supplied: SyntacticAnalysis[][] = previousSentences.map((previous, position) =>
      previous.syntax.filter(parse => group.some(entry => entry.parses[position].synId === parse.synId)));
    supplied.push(newParses);
    const sentences = [...previousSentences, sentence];
    const structureless = supplied.flat().find(parse => !parse.structure);
    if (structureless) {
      throw new Error(`Parse ${structureless.synId} has no structure to supply.`);
    }
    // LiGER numbers the analyses of one call S0, S1, ... in sentence order, supplied ones
    // included (LigerController.applyRuleRequestXLESequence), and reports each part's
    // analysis under that id (`syntaxVariantId`). A call-local name: mapped back to the
    // supplied parse here, never kept.
    const parseByCallId = new Map<string, { position: number; parse: SyntacticAnalysis }>();
    let counter = 0;
    supplied.forEach((parses, position) => parses.forEach(parse => parseByCallId.set(`S${counter++}`, { position, parse })));

    return this.dataService.ligerSequence({
      sentences: sentences.map(item => item.text),
      sentenceIds: sentences.map(item => item.id),
      ruleString: request.ruleString,
      parsedSentences: supplied.map(parses => parses.map(parse => parse.structure)),
    }).pipe(
      concatMap(response => {
        const variants = (Array.isArray(response?.solutions) ? response.solutions : []) as LigerSolutionAnnotation[];
        if (!variants.length) {
          throw new Error(response?.failureMessage || `LiGER returned no sequence for ${sentences.map(item => item.id).join(' + ')}.`);
        }
        const specs: Array<{ entry: ResolvedContext; reading: SemanticAnalysis; variant: LigerSolutionAnnotation;
          newParse: SyntacticAnalysis; offset: number; syntaxId: string }> = [];
        const placed = new Set<ResolvedContext>();
        variants.forEach(variant => {
          const parses = sentences.map((_, position) => {
            const part = (variant.sequenceParts ?? []).find(candidate => candidate.sourceIndex === position);
            const known = part?.syntaxVariantId ? parseByCallId.get(part.syntaxVariantId) : undefined;
            if (!part || !known || known.position !== position) {
              throw new Error(`Sequence variant ${variant.solutionKey} reports part ${position} as `
                + `"${part?.syntaxVariantId ?? '<none>'}", which is not one of the parses supplied for `
                + `${sentences[position].id}. Refusing to guess which parse it is.`);
            }
            return { part, parse: known.parse };
          });
          const last = parses[parses.length - 1];
          if (!Number.isInteger(last.part.sourceIndexOffset)) {
            throw new Error(`Sequence variant ${variant.solutionKey} reports no sourceIndexOffset for ${sentence.id}.`);
          }
          const prefix = parses.slice(0, -1).map(item => item.parse.synId);
          const syntaxId = compositeAnalysisId([...prefix, last.parse.synId]);
          group
            .filter(entry => entry.parses.every((parse, position) => parse.synId === prefix[position]))
            .forEach(entry => {
              placed.add(entry);
              readings
                .filter(reading => reading.syntacticOrigin === last.parse.synId)
                .forEach(reading => specs.push({
                  entry, reading, variant, newParse: last.parse, offset: last.part.sourceIndexOffset, syntaxId,
                }));
            });
        });
        const failures = group.filter(entry => !placed.has(entry)).map(entry =>
          `${entry.context.element.id} (${entry.context.semantic.semId}, parses `
          + `${entry.parses.map(parse => parse.synId).join('+')}) is in no sequence variant LiGER returned.`);

        return from(specs).pipe(
          concatMap(spec => this.dataService.gswbMergeSequenceSemantics({
            parts: [
              this.semanticPart(spec.entry.context.semantic, spec.entry.context.element.id),
              this.semanticPart(spec.reading, sentence.id, spec.offset),
            ],
            parentSolutionId: spec.reading.semId,
            solutionKey: spec.syntaxId,
            mcSetId: spec.syntaxId,
            resolveDrs: request.resolveDrs,
          }).pipe(map(merged => {
            const mergedSyntax = spec.variant.sequenceAnalysis?.syntax?.[0];
            const semantic = readingOf(merged);
            if (mergedSyntax) {
              merged.sequenceAnalysis = {
                id: merged.id,
                text: spec.variant.sequenceAnalysis!.text,
                sentenceIds: sentences.map(item => item.id),
                syntax: [{ ...mergedSyntax, synId: spec.syntaxId }],
                semantics: [semantic],
                synSemMapping: { [spec.syntaxId]: [semantic.semId] },
              };
            }
            return {
              index: spec.entry.index,
              pair: {
                merged,
                previousElement: spec.entry.context.element,
                previousSemantic: spec.entry.context.semantic,
                currentElement: sentence,
                currentSemantic: spec.reading,
                currentSyntax: spec.newParse,
                sequenceStructure: spec.variant.structureJson,
                sourceIndexOffset: spec.offset,
              } as SequenceMergePair,
            };
          }))),
          toArray(),
          map(pairs => ({ pairs, failures })),
        );
      }),
    );
  }

  /** The parse a sentence's reading came from: the one its `syntacticOrigin` names, or the
   *  sentence's only parse. Several parses and no match is not guessed. */
  private parseOfReading(sentence: SentenceAnalysis, semantic?: SemanticAnalysis): SyntacticAnalysis | undefined {
    return sentence.syntax.find(syntax => syntax.synId === semantic?.syntacticOrigin)
      ?? (sentence.syntax.length === 1 ? sentence.syntax[0] : undefined);
  }

  /** The previous element's sentences, each with the parse the previous reading came from,
   *  resolved against the registry. A Sequence's syntax id is the composite of its
   *  sentences' parse ids, in order. */
  private previousParses(
    element: SentenceAnalysis | SequenceAnalysis,
    semantic: SemanticAnalysis,
    knownSentences: SentenceAnalysis[],
  ): { sentences: SentenceAnalysis[]; parses: SyntacticAnalysis[] } | { failure: string } {
    if (!('sentenceIds' in element)) {
      const sentence = knownSentences.find(candidate => candidate.id === element.id) ?? element;
      const parse = this.parseOfReading(sentence, semantic);
      return parse
        ? { sentences: [sentence], parses: [parse] }
        : { failure: `its reading names syntax ${semantic.syntacticOrigin}, which is none of ${element.id}'s parses` };
    }
    const sentences = element.sentenceIds.map(id => knownSentences.find(candidate => candidate.id === id));
    const missing = element.sentenceIds.filter((_, position) => !sentences[position]);
    if (missing.length) {
      return { failure: `its sentences ${missing.join(', ')} are not registered` };
    }
    const parseIds = semantic.syntacticOrigin?.split('+') ?? [];
    if (parseIds.length !== sentences.length) {
      return {
        failure: `its reading's syntax ${semantic.syntacticOrigin} does not name one parse for each of its `
          + `${sentences.length} sentences`,
      };
    }
    const parses: SyntacticAnalysis[] = [];
    for (let position = 0; position < parseIds.length; position++) {
      const parse = sentences[position]!.syntax.find(syntax => syntax.synId === parseIds[position]);
      if (!parse) {
        return { failure: `its syntax ${semantic.syntacticOrigin} names parse ${parseIds[position]}, which ${sentences[position]!.id} does not have` };
      }
      parses.push(parse);
    }
    return { sentences: sentences as SentenceAnalysis[], parses };
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

  /** One SequenceAnalysis per distinct sentence sequence, unioning every syntax variant and
   *  merged reading its pairs produced. Each pair's merged solution is pointed at that
   *  aggregated entry. */
  private aggregateSequenceAnalyses(pairs: SequenceMergePair[]): SequenceAnalysis[] {
    const bySentences = new Map<string, SequenceAnalysis>();
    pairs.forEach(pair => {
      const template = pair.merged.sequenceAnalysis;
      const syntaxEntry = template?.syntax[0];
      const semantic = template?.semantics[0];
      if (!template || !syntaxEntry || !semantic) {
        return;
      }

      const sequenceId = compositeAnalysisId(template.sentenceIds);
      const analysis = bySentences.get(sequenceId) ?? {
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
      bySentences.set(sequenceId, analysis);
      pair.merged.sequenceAnalysis = analysis;
    });
    return Array.from(bySentences.values());
  }

  private semanticPart(semantic: SemanticAnalysis, sentenceId: string, sourceIndexOffset = 0): GswbSemanticMergePart {
    return {
      id: semantic.semId,
      sentenceId,
      solutionId: semantic.semId,
      syntacticOrigin: semantic.syntacticOrigin,
      semantic: semantic.semString,
      graph: semantic.graph,
      ...(sourceIndexOffset ? { sourceIndexOffset } : {}),
      provenance: {
        syntacticOrigin: semantic.syntacticOrigin,
        semanticId: semantic.semId,
      },
    };
  }
}
