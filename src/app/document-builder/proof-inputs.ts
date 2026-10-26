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
 * One implementation, shared by the analysis view, regression's batch builder and
 * `DocumentBuilderService.deriveSentence`: a sentence is derived on its own, once per parse
 * (docs/plans/DERIVE_ONCE_REBASE_PLAN.md in xleplusglue), so every proof is a whole parse.
 */
export interface ProofInputOptions {
  /** Fallback prefix for a solution with no key of its own. */
  idPrefix?: string;

  /** The SENTENCE this proof belongs to, when the caller knows it.
   *
   *  Not the same thing as the solution key, and GSWB cares: it derives reading ids from
   *  `origin.sentenceId`. LiGER's solution keys are numbered globally across a batch, so
   *  a sentence with two syntactic analyses shifts every later sentence's key by one --
   *  and taking the sentence id from the response then gave sentence S3's readings the id
   *  `S4-s2` while sentence S4's were `S5-s0`. Both namespaces look like `S<n>`, so the
   *  drift reads as "this reading belongs to another sentence".
   *
   *  A caller iterating its own sentence map already knows the answer and should say so
   *  rather than trust the response to agree. */
  sentenceId?: string;
}

export function proofInputsFrom(
  solutions: LigerSolutionAnnotation[] | undefined,
  options: ProofInputOptions = {},
): GswbProofInput[] {
  const { idPrefix = 'solution', sentenceId } = options;

  return (solutions ?? [])
    .map((solution, index) => {
      const proofId = solution.solutionKey || `${idPrefix}-${index}`;
      return {
        proofId,
        sentenceId: sentenceId ?? solution.sentenceAnalysis?.id,
        solutionKey: proofId,
        mcSetId: proofId,
        meaningConstructors: solution.meaningConstructors ?? '',
        structure: solution.structureJson,
        sentenceAnalysis: solution.sentenceAnalysis,
        sequenceAnalysis: solution.sequenceAnalysis,
      };
    })
    .filter(input => input.meaningConstructors.trim().length > 0);
}
