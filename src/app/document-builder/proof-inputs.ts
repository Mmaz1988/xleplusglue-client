import { GswbProofInput, LigerSolutionAnnotation } from '../models/models';

/**
 * Builds GSWB proof inputs from a LiGER response's solutions -- one
 * {@link GswbProofInput} per syntactic analysis, each carrying its own structure.
 *
 * `/deduce` is an aggregate endpoint over syntactic origins: `GswbProofInput` describes
 * itself as "One syntactic origin and its MC input within an aggregate deduction",
 * `parseProofInputs` gives each proof its own MC set, and every returned solution is
 * stamped with its origin's `proofId`/`solutionKey`/`mcSetId`/`sentenceId`. So this list
 * is how the caller both *asks for* every reading and *gets back* which syntax each came
 * from.
 *
 * One implementation because there were four, and they drifted: the analysis view's two
 * (`proofInputsFor`, `proofInputsForSequencePart`), regression's batch builder, and
 * `DocumentBuilderService.deriveCurrentPart`. Only one of the four had the per-variant
 * keying that keeps readings attributable (see `keyBy`), which is the class of divergence
 * that produced the syntactic-variant collapse in the first place.
 */
export interface ProofInputOptions {
  /** Absent: use each solution's whole `meaningConstructors` -- a standalone parse.
   *
   *  Set: use that solution's `sequenceParts` entry with this `sourceIndex` instead --
   *  one sentence's own part inside a merged sequence. Those entries are already shifted
   *  into the sequence-global SYN-ID range by LiGER's `SequenceGraphAssembler`, so their
   *  SRC ids line up with the same sentence's nodes in the merged `structureJson`. Found
   *  by `sourceIndex`, never by position: the two coincide only for the newest sentence. */
  sentenceIndex?: number;

  /** Which id identifies a proof, and therefore what GSWB stamps back onto every reading
   *  derived from it.
   *
   *  `'sequence'` (default) uses the SEQUENCE solution's own key, which is unique per
   *  syntactic variant of the whole sequence. `'part'` uses the sentence-part's key,
   *  falling back to the sequence key.
   *
   *  These differ, and it matters: variants that differ only in a PREVIOUS sentence's
   *  parse share the new sentence's part key, so `'part'` collapses exactly the
   *  distinction a caller needs to map a reading back to its variant. `'part'` exists only
   *  because the analysis view has always used it and its downstream solution-key
   *  resolution has not been re-verified against a change -- it is not the better choice.
   *  See SHARED_PIPELINE_PLAN.md, Stage 5. */
  keyBy?: 'sequence' | 'part';

  /** Fallback prefix for a solution with no key of its own. */
  idPrefix?: string;
}

export function proofInputsFrom(
  solutions: LigerSolutionAnnotation[] | undefined,
  options: ProofInputOptions = {},
): GswbProofInput[] {
  const { sentenceIndex, keyBy = 'sequence', idPrefix = 'solution' } = options;

  return (solutions ?? [])
    .map((solution, index) => {
      const part = sentenceIndex === undefined
        ? undefined
        : (solution.sequenceParts ?? []).find(candidate => candidate.sourceIndex === sentenceIndex);

      const sequenceKey = solution.solutionKey || `${idPrefix}-${index}`;
      const proofId = keyBy === 'part'
        ? (part?.solutionKey || solution.solutionKey || `${idPrefix}-${index}`)
        : sequenceKey;

      const scopedSentence = sentenceIndex === undefined
        ? solution.sentenceAnalysis
        : solution.sequenceAnalysis?.sentences?.[sentenceIndex];

      return {
        proofId,
        sentenceId: scopedSentence?.id,
        solutionKey: proofId,
        mcSetId: proofId,
        meaningConstructors: (sentenceIndex === undefined
          ? solution.meaningConstructors
          : part?.meaningConstructors) ?? '',
        structure: solution.structureJson,
        sentenceAnalysis: scopedSentence,
        sequenceAnalysis: solution.sequenceAnalysis,
      };
    })
    .filter(input => input.meaningConstructors.trim().length > 0);
}
