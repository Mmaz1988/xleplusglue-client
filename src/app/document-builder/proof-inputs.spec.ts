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

  describe('sentenceId', () => {
    /** GSWB prefixes every reading id with `origin.sentenceId`, and LiGER's solution keys
     *  are numbered GLOBALLY across a batch -- so a sentence with two analyses shifts every
     *  later sentence's key by one. Reading the sentence id back off the response gave
     *  sentence S3's readings the id `S4-s2` while sentence S4's were `S5-s0`; both
     *  namespaces look like `S<n>`, so it read as belonging to another sentence. */
    it('states the caller\'s sentence id rather than trusting the response', () => {
      const drifted = solution({
        solutionKey: 'S4',
        sentenceAnalysis: { id: 'S4', text: 'All boxers are slow.' } as any,
      });

      const proofs = proofInputsFrom([drifted], { sentenceId: 'S3', idPrefix: 'S3' });

      expect(proofs[0].sentenceId).toBe('S3');
      // The solution key is untouched -- it identifies the ANALYSIS, which is a different
      // thing from the sentence.
      expect(proofs[0].solutionKey).toBe('S4');
    });

    it('falls back to the response when the caller has no id to state', () => {
      const withEmbedded = solution({
        solutionKey: 'S4',
        sentenceAnalysis: { id: 'S4', text: 'x' } as any,
      });
      expect(proofInputsFrom([withEmbedded])[0].sentenceId).toBe('S4');
    });
  });
});
