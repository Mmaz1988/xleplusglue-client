import { Injectable } from '@angular/core';
import { Observable, catchError, concatMap, forkJoin, from, map, of, switchMap, toArray } from 'rxjs';
import { DataService } from '../data.service';
import { APP_DEFAULTS } from '../app-defaults';
import { reasoningAssignmentId } from '../analysis-model';
import {
  LigerStructure,
  LigerWebGraph,
  REASONING_CHECK_NAMES,
  ReasoningCheck,
  ReasoningCheckName,
} from '../models/models';

/** One post-processing rule branch: the tier-B interconnected structure the rules
 *  produced, plus the graph LiGER rendered for it. */
interface RuleBranch {
  structure: LigerStructure;
  graph?: LigerWebGraph;
}

/** What a prepared assignment needs in order to carry a document-level id.
 *  Supplied by the caller because only it knows which document elements and readings this
 *  pair stands for; the service mints the id so both callers produce the same shape. */
export interface ReasoningScope {
  /** `reasoningUpdateId(...)` of the ReasoningUpdate these assignments belong to. */
  updateId: string;
  /** Positionally aligned with the update's premise element ids. */
  premiseSemanticIds: string[];
  /** Positionally aligned with the update's hypothesis element ids. */
  hypothesisSemanticIds: string[];
}

export interface ReasoningPairRequest {
  /** Identifies this (premise reading x hypothesis reading) pair. Becomes the
   *  `parentSolutionId` prefix GSWB sees, so it must be stable and unique per pair. */
  scopeId: string;
  /** When set, every prepared assignment carries a `reasoningAssignmentId` so it can be
   *  written into the document and paired with its Vampire verdict by id. */
  scope?: ReasoningScope;
  /** Output of GSWB /merge_sequence_semantics over premises AND conclusion -- carries
   *  `semantic` and `graph`. This is the whole sequence, not the context. */
  merged: any;
  /** The PRIOR's semantics: everything the update builds on, without the conclusion.
   *  For A + B that is A's semantic; for (A + B) + C it is the merged A + B. This, not
   *  `merged`, is the `Q` reattached as the `fof(context, axiom, ...)` conjunct --
   *  LFGXDRT_NLI_CHECK_COMPOSITION_PLAN.md's "Implementation Correction" drops the outer
   *  `Q` from the check ASTs to keep anaphora mapping unambiguous and requires it back at
   *  the TPTP level. Conjoining the merged premise+conclusion instead would put the
   *  conclusion into the axiom the checks are supposed to be testing *against*.
   *  Optional only so a caller that genuinely has no prior can omit it; when it is absent
   *  no context axiom is emitted, which is the honest fallback. */
  premiseSemantic?: string;
  /** The sequence provenance structure from LiGER (the merged *syntax* side). Required:
   *  the post-processing rules join semantics to syntax via SRC/SYN-ID, so without it
   *  no SYNSEM link -- and therefore no anaphora binding -- can be produced. */
  sequenceStructure: LigerStructure;
  premiseAsts: LigerStructure[];
  hypothesisAsts: LigerStructure[];
  typed: boolean;
  /** Reason over the first candidate only. */
  prune?: boolean;
  /** Defaults to the graph-inspector rule text both the analysis view and chat use. */
  ruleString?: string;
}

/** One reading-assignment x rule-branch x anaphora-branch, with everything needed to
 *  send it to Vampire and to record it in the document. */
export interface PreparedAssignment {
  pairId: string;
  /** The document-level `ReasoningAssignment.id`, set when the request carried a scope.
   *  Sent to Vampire in the bundle and echoed back on the verdict, so a verdict is paired
   *  with its assignment by id rather than by position in an array that gets filtered. */
  assignmentId?: string;
  mappingId: string;
  /** GSWB's PCDRS solution: carries `semantic`, `graph` and `anaphoraRelations`. */
  mapping: any;
  /** Which post-processing rule branch this mapping came from, 1-based, matching the
   *  parentSolutionId sent to GSWB -- and the value recorded as DiscourseAnalysis.ruleBranch.
   *  The tier-A and tier-B structures the branch was derived from are deliberately not
   *  carried here: nothing consumed them but the document writers, which no longer persist
   *  them, and holding them on every assignment kept the whole cross product alive in memory
   *  for the length of a run. */
  ruleBranchIndex: number;
  checks: Record<string, ReasoningCheck>;
  /** TPTP for the PRIOR alone (`Q`), collapsed against this branch's mapping. Sent to
   *  Vampire as `contextTptp` and emitted there as `fof(context, axiom, ...)`. */
  contextTptp: string;
  /** TPTP for the whole merged premise+conclusion sequence. NOT sent to Vampire -- it is
   *  what the caller displays and carries forward as the next turn's prior, which is why
   *  it stayed available when `contextTptp` narrowed to the prior alone. */
  sequenceTptp: string;
  /** Items GSWB could translate only by dropping this branch's anaphora mapping, as
   *  human-readable reasons. Non-empty means the bundle below is usable but NOT fully
   *  resolved -- the pronoun it names bound to nothing. Must be shown to the user rather
   *  than treated as a clean result. */
  degradations: string[];
}

/** Either a usable assignment or the reason its branch could not be prepared. */
type PreparedBranch =
  | { assignment: PreparedAssignment; failure?: undefined }
  | { assignment?: undefined; failure: string };

export interface PreparedReasoningPair {
  scopeId: string;
  assignments: PreparedAssignment[];
  /** Branches that could not be prepared, as human-readable reasons. Kept rather than
   *  silently dropped -- a mapping whose collapse failed is evidence, not noise. */
  failures: string[];
  /** Every degradation across this pair's assignments, flattened. A pair can have
   *  assignments and degradations at the same time: the bundles are usable, but some of
   *  them lost their anaphora binding on the way. */
  degradations: string[];
}

/** One PCDRS/anaphora mapping together with the number of the rule branch it came from --
 *  the output of the post-processing half of the pipeline, before any reasoning checks are
 *  built on top. The tier-A union and the tier-B branch themselves stay inside the pipeline:
 *  they are consumed to produce this mapping and then dropped, since no consumer persists
 *  them any more and holding them would keep the whole cross product in memory. */
export interface MappingWithStructure {
  /** GSWB's PCDRS solution: `.id`, `.semantic`, `.graph`, `.anaphoraRelations`. */
  mapping: any;
  /** 1-based, matching the parentSolutionId sent to GSWB. */
  ruleBranchIndex: number;
}

/**
 * Builds the four discourse-reasoning checks for a premise/conclusion pair.
 *
 * Extracted from ChatComponent so the regression-testing interface can run the same
 * pipeline instead of its own older copy. The observable structure is deliberately
 * preserved from the chat implementation, including which steps run concurrently --
 * see the comments on the individual stages.
 */
@Injectable({ providedIn: 'root' })
export class ReasoningPipelineService {
  constructor(private dataService: DataService) {}

  /**
   * Runs several pairs strictly one after another.
   *
   * Callers with more than one pair MUST use this rather than `forkJoin` over an array
   * of `prepareReasoningChecks` calls: two of these chains in flight at once has been
   * observed to leave an HttpClient observable that never emits, hanging the request
   * with no error. It also keeps a discourse with many candidate mappings from firing
   * enough concurrent requests to overwhelm GSWB's single embedded server.
   */
  prepareReasoningChecksSequentially(
    requests: ReasoningPairRequest[]
  ): Observable<PreparedReasoningPair[]> {
    return from(requests).pipe(
      concatMap(request => this.prepareReasoningChecks(request)),
      toArray()
    );
  }

  /** The post-processing half of the pipeline: union the merged syntax with the merged
   *  semantics, apply the NLI rules over that union, and generate the PCDRS/anaphora
   *  mappings from every resulting rule branch.
   *
   *  Shared by `prepareReasoningChecks` (which then builds the four checks on top) and by
   *  `generateDiscourseMappings` (which stops here). A first sentence has no premise/
   *  hypothesis pair to reason over, but it does have pronouns and reflexives to bind --
   *  and the user needs to see whether they were bound correctly in that turn, which is
   *  exactly what these mappings show.
   */
  private buildDiscourseMappings(
    scopeId: string,
    merged: any,
    sequenceStructure: LigerStructure,
    ruleString: string,
    prune: boolean,
  ): Observable<MappingWithStructure[]> {
    // /merge_uploaded_structures only UNIONS the merged syntax with the merged
    // semantics -- both sides end up in one graph with no edges between them. The
    // post-processing rules below are what interconnect them (they join SRC to SYN-ID
    // and emit SYNSEM), and that interconnected form is what the anaphora mappings are
    // read off. Neither join outlives this method: both are derivable again from the
    // element's stored syntax and semantics plus the rule string.
    return this.dataService.ligerMergeStructure({
      syntax: sequenceStructure, drs: merged.graph
    }).pipe(
      switchMap(base => this.applyNliRules(base.structureJson, ruleString, base.graph).pipe(
        map(branches => ({ base, branches }))
      )),
      switchMap(({ branches }) => forkJoin(branches.map((branch, index) =>
        this.dataService.gswbGeneratePcdrs({
          semantic: merged.semantic,
          parentSolutionId: `${scopeId}-rule-${index + 1}`,
          mergedStructure: branch.structure as any
        }).pipe(map(result => ({ result, ruleBranchIndex: index + 1 })))
      ))),
      map(pcdrsResults => {
        let mappingsWithStructure = pcdrsResults.flatMap(({ result, ruleBranchIndex }) =>
          (result?.solutions ?? []).map(mapping => ({ mapping, ruleBranchIndex }))
        );
        if (!mappingsWithStructure.length) {
          throw new Error('No post-processed sequence interpretations were generated.');
        }
        console.info('[Reasoning] PCDRS candidates generated', {
          scopeId,
          ruleBranchCount: pcdrsResults.length,
          mappingCount: mappingsWithStructure.length,
          anaphoraResolvedCount: mappingsWithStructure.filter(({ mapping }) =>
            (mapping.anaphoraRelations ?? []).length > 0).length,
        });
        // Pruning reasons over the first candidate alone; the reduction happens here,
        // before the expensive collapse/TPTP/Vampire steps below.
        if (prune) {
          mappingsWithStructure = mappingsWithStructure.slice(0, 1);
        }
        return mappingsWithStructure;
      })
    );
  }

  /** Post-processing only: the DRS plus its anaphora mappings for ONE reading, with no
   *  premise/hypothesis pair and no reasoning checks. This is what a first sentence needs
   *  -- it has nothing to reason against yet, but a reflexive or pronoun in it still has
   *  to be shown as bound (or not) for that turn. */
  generateDiscourseMappings(request: {
    scopeId: string;
    merged: any;
    sequenceStructure: LigerStructure;
    ruleString?: string;
    prune?: boolean;
  }): Observable<MappingWithStructure[]> {
    if (!request.sequenceStructure) {
      throw new Error('Discourse mappings require the sequence provenance structure.');
    }
    if (!request.merged?.graph) {
      throw new Error('Discourse mappings require the reading\'s semantic graph.');
    }
    return this.buildDiscourseMappings(
      request.scopeId,
      request.merged,
      request.sequenceStructure,
      request.ruleString ?? APP_DEFAULTS.graphInspector.rulesText,
      !!request.prune,
    );
  }

  prepareReasoningChecks(request: ReasoningPairRequest): Observable<PreparedReasoningPair> {
    const { scopeId, merged, sequenceStructure, premiseAsts, hypothesisAsts, typed } = request;

    if (!sequenceStructure) {
      throw new Error('NLI checks require the sequence provenance structure.');
    }
    if (!premiseAsts?.length || !hypothesisAsts?.length || !merged?.graph) {
      throw new Error('NLI sequence semantic graphs are missing.');
    }
    // Not fatal -- the four checks are complete without it -- but it silently removes the
    // context axiom from every proof file in this pair, so it is said out loud.
    if (!request.premiseSemantic) {
      console.warn('[Reasoning] no prior semantics supplied; no context axiom will be emitted',
        { scopeId });
    }

    const ruleString = request.ruleString ?? APP_DEFAULTS.graphInspector.rulesText;

    // The check ASTs are fixed for this pair and never vary across the PCDRS mappings
    // below, so they are fetched exactly once and reused by every mapping. This call
    // needs none of the PCDRS pipeline's output, so it runs concurrently with it rather
    // than waiting for PCDRS generation to finish.
    const reasoningChecks$ = this.dataService.gswbReasoningCheckAsts({
      premiseAsts, hypothesisAsts, typed
    });

    const mappingsWithStructure$ = this.buildDiscourseMappings(
      scopeId, merged, sequenceStructure, ruleString, !!request.prune);

    return forkJoin({
      reasoningChecksResponse: reasoningChecks$,
      mappingsWithStructure: mappingsWithStructure$
    }).pipe(
      switchMap(({ reasoningChecksResponse, mappingsWithStructure }) => {
        // Shared across every mapping below -- each mapping only varies in which
        // anaphoraRelations it uses to collapse these same four check ASTs.
        const checkEntries = Object.entries(reasoningChecksResponse?.checks ?? {});
        return forkJoin(mappingsWithStructure.map(({ mapping, ruleBranchIndex }) => {
          // The mapping is computed once by generate_pcdrs above and reused as-is across
          // the context collapse and all four checks. gswbCollapseAndTptpBatch re-parses
          // each item's semantic from scratch server-side and carries no mapping of its
          // own, so the structured anaphoraRelations must be passed explicitly rather
          // than re-derived or spliced into the semantic text as a string. Folding the
          // context plus all four checks into one batched request (instead of five
          // separate collapse+translate round trips) keeps GSWB from being overwhelmed.
          //
          // Two non-check items, and they are not interchangeable:
          //   context  -- the PRIOR alone (Q). Reattached as the TPTP context axiom.
          //   sequence -- the merged premise+conclusion. Display/carry-forward only.
          // Both are collapsed against the same mapping so the prior's referents keep the
          // binding the sequence gave them. A relation whose pronoun lives only in the
          // conclusion simply finds nothing to rewrite in the prior; one whose antecedent
          // is unreachable there degrades that item alone, reported like any other.
          const anaphoraRelations = mapping.anaphoraRelations ?? [];
          const items = [
            { name: 'context', semantic: request.premiseSemantic || '' },
            { name: 'sequence', semantic: mapping.semantic || '' },
            ...checkEntries.map(([name, check]: [string, any]) => ({ name, semantic: check.semantic }))
          ].filter(item => !!item.semantic);
          return this.dataService.gswbCollapseAndTptpBatch({
            anaphoraRelations,
            items,
            typed,
            parentSolutionId: mapping.id
          }).pipe(
            map(result => {
              const contextTptp = result.results?.['context']?.tptp ?? '';
              const sequenceTptp = result.results?.['sequence']?.tptp ?? '';
              const checks: Record<string, ReasoningCheck> = {};
              const missing: string[] = [];
              // An item GSWB could only translate by dropping the mapping still yields TPTP,
              // so nothing downstream would notice on its own. Collect the notes here and
              // carry them all the way out.
              const degradations = Object.entries(result.results ?? {})
                .filter(([, item]) => !!item?.degraded)
                .map(([name, item]) => `${mapping.id} (${name}): ${item.degraded}`);
              for (const name of REASONING_CHECK_NAMES) {
                const tptp = result.results?.[name]?.tptp;
                if (tptp) {
                  checks[name] = { tptp };
                } else {
                  missing.push(name);
                }
              }
              // The four checks are fixed and may never be reduced: a bundle missing any
              // of them cannot be reasoned over, so it is reported rather than sent on.
              if (missing.length) {
                return <PreparedBranch>{
                  failure: `${mapping.id}: missing check(s) ${missing.join(', ')}`
                };
              }
              return <PreparedBranch>{
                assignment: {
                  pairId: scopeId,
                  assignmentId: request.scope && reasoningAssignmentId({
                    updateId: request.scope.updateId,
                    premiseSemanticIds: request.scope.premiseSemanticIds,
                    hypothesisSemanticIds: request.scope.hypothesisSemanticIds,
                    ruleBranchIndex,
                    anaphoraBranchId: mapping.id,
                  }),
                  mappingId: mapping.id,
                  mapping,
                  ruleBranchIndex,
                  checks,
                  contextTptp,
                  sequenceTptp,
                  degradations,
                }
              };
            }),
            catchError(error => of(<PreparedBranch>{
              failure: `${mapping.id}: ${error?.message ?? String(error)}`
            }))
          );
        }));
      }),
      map((results: PreparedBranch[]) => {
        const assignments = results
          .map(result => result.assignment)
          .filter((value): value is PreparedAssignment => !!value);
        const failures = results
          .map(result => result.failure)
          .filter((value): value is string => !!value);
        const degradations = assignments.flatMap(assignment => assignment.degradations);
        if (failures.length) {
          console.warn('[Reasoning] some branches could not be prepared', { scopeId, failures });
        }
        if (degradations.length) {
          console.warn('[Reasoning] some branches lost their anaphora binding', { scopeId, degradations });
        }
        return { scopeId, assignments, failures, degradations };
      })
    );
  }

  /** Runs the post-processing rules over the tier-A union, producing one tier-B
   *  interconnected structure per rule branch. The rendered graph is kept alongside
   *  each branch because LiGER already computed it and it cannot be rebuilt
   *  client-side. When no rule fires there is no tier B, so the branch falls back to
   *  tier A itself -- structure and graph together, as the analysis view does. */
  private applyNliRules(
    structure: any,
    ruleString: string,
    graph?: LigerWebGraph
  ): Observable<RuleBranch[]> {
    return this.dataService.ligerApplyRulesToStructure({
      content: JSON.stringify(structure),
      format: 'json',
      ruleString,
      id: 'nli-post-processing'
    }).pipe(
      map(response => {
        const branches = (response.annotations ?? [])
          .filter(annotation => !!annotation.structureJson)
          .map(annotation => ({ structure: annotation.structureJson, graph: annotation.graph }));
        return branches.length ? branches : [{ structure, graph }];
      })
    );
  }
}
