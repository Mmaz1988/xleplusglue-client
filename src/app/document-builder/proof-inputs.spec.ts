import { proofInputsFrom } from './proof-inputs';
import { LigerSolutionAnnotation } from '../models/models';

describe('proofInputsFrom', () => {
  const solution = (overrides: Partial<LigerSolutionAnnotation>): LigerSolutionAnnotation => ({
    solutionKey: 'S0',
    meaningConstructors: 'mc-whole',
    structureJson: { id: 'struct-S0' } as any,
    ...overrides,
  } as LigerSolutionAnnotation);

  it('makes one proof per syntactic analysis, each with its own structure', () => {
    const proofs = proofInputsFrom([
      solution({ solutionKey: 'S0', structureJson: { id: 'a' } as any }),
      solution({ solutionKey: 'S1', structureJson: { id: 'b' } as any }),
    ]);

    expect(proofs.map(proof => proof.proofId)).toEqual(['S0', 'S1']);
    expect(proofs.map(proof => (proof.structure as any).id)).toEqual(['a', 'b']);
  });

  it('drops an analysis with no meaning constructors rather than sending an empty proof', () => {
    const proofs = proofInputsFrom([
      solution({ solutionKey: 'S0' }),
      solution({ solutionKey: 'S1', meaningConstructors: '   ' }),
    ]);
    expect(proofs.map(proof => proof.proofId)).toEqual(['S0']);
  });

  describe('sentenceIndex (one sentence part inside a merged sequence)', () => {
    const sequenceSolution = solution({
      solutionKey: 'sequence-1-S0+S3',
      sequenceParts: [
        { sourceIndex: 0, solutionKey: 'S0', meaningConstructors: 'mc-first' },
        { sourceIndex: 1, solutionKey: 'S3', meaningConstructors: 'mc-second' },
      ] as any,
      sequenceAnalysis: {
        sentences: [{ id: 'sentence-1' }, { id: 'sentence-2' }],
      } as any,
    });

    it('takes the part with that sourceIndex, not the one at that position', () => {
      const reordered = solution({
        solutionKey: 'seq',
        sequenceParts: [
          { sourceIndex: 1, solutionKey: 'S3', meaningConstructors: 'mc-second' },
          { sourceIndex: 0, solutionKey: 'S0', meaningConstructors: 'mc-first' },
        ] as any,
        sequenceAnalysis: { sentences: [{ id: 'sentence-1' }, { id: 'sentence-2' }] } as any,
      });

      const proofs = proofInputsFrom([reordered], { sentenceIndex: 1 });
      expect(proofs[0].meaningConstructors).toBe('mc-second');
    });

    it('scopes sentenceId/sentenceAnalysis to that sentence', () => {
      const proofs = proofInputsFrom([sequenceSolution], { sentenceIndex: 1 });
      expect(proofs[0].sentenceId).toBe('sentence-2');
    });
  });

  describe('keyBy', () => {
    /** The distinction that makes a returned reading attributable to its variant. Two
     *  sequence variants differing only in a PREVIOUS sentence's parse share the new
     *  sentence's part key, so keying by part collapses them -- which is how the
     *  syntactic-variant collapse hid for as long as it did. */
    const twoVariantsSharingAPartKey = [
      solution({
        solutionKey: 'sequence-1-S0+S9',
        sequenceParts: [{ sourceIndex: 1, solutionKey: 'S9', meaningConstructors: 'mc' }] as any,
        sequenceAnalysis: { sentences: [{ id: 's1' }, { id: 's2' }] } as any,
      }),
      solution({
        solutionKey: 'sequence-2-S1+S9',
        sequenceParts: [{ sourceIndex: 1, solutionKey: 'S9', meaningConstructors: 'mc' }] as any,
        sequenceAnalysis: { sentences: [{ id: 's1' }, { id: 's2' }] } as any,
      }),
    ];

    it("defaults to the sequence key, keeping the two variants distinguishable", () => {
      const proofs = proofInputsFrom(twoVariantsSharingAPartKey, { sentenceIndex: 1 });
      expect(proofs.map(proof => proof.proofId))
        .toEqual(['sequence-1-S0+S9', 'sequence-2-S1+S9']);
      expect(new Set(proofs.map(proof => proof.proofId)).size).toBe(2);
    });

    it("keyBy 'part' collapses them -- the analysis view's long-standing keying", () => {
      const proofs = proofInputsFrom(twoVariantsSharingAPartKey, { sentenceIndex: 1, keyBy: 'part' });
      expect(proofs.map(proof => proof.proofId)).toEqual(['S9', 'S9']);
      expect(new Set(proofs.map(proof => proof.proofId)).size).toBe(1);
    });
  });

  it('falls back to an indexed id when a solution has no key', () => {
    const proofs = proofInputsFrom(
      [solution({ solutionKey: undefined })], { idPrefix: 'S7' });
    expect(proofs[0].proofId).toBe('S7-0');
  });

  it('handles a missing solution list', () => {
    expect(proofInputsFrom(undefined)).toEqual([]);
  });
});
