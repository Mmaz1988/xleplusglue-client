import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import {
  ReasoningPairRequest, ReasoningPipelineService, StoredReadingChecksRequest,
} from './reasoning-pipeline.service';
import { DataService } from '../data.service';
import { REASONING_CHECK_NAMES } from '../models/models';

describe('ReasoningPipelineService', () => {
  let service: ReasoningPipelineService;
  let dataService: jasmine.SpyObj<DataService>;

  const structure = { constraints: [], annotations: [], choiceSpace: {} } as any;
  const graph = { graphElements: [] } as any;

  /** GSWB returns the four check ASTs keyed by name. */
  const checkAsts = () => ({
    checks: Object.fromEntries(
      REASONING_CHECK_NAMES.map(name => [name, { semantic: `sem(${name})`, ast: structure }])
    )
  });

  /** /collapse_and_tptp_batch echoes one entry per requested item. */
  const tptpBatch = (omit: string[] = []) => ({
    results: Object.fromEntries([
      ['context', { tptp: 'fof(context).' }],
      ['sequence', { tptp: 'fof(sequence).' }],
      ...REASONING_CHECK_NAMES
        .filter(name => !omit.includes(name))
        .map(name => [name, { tptp: `fof(${name}).` }])
    ])
  });

  const request = (scopeId = 'pxq-1-1'): ReasoningPairRequest => ({
    scopeId,
    merged: { syntacticOrigin: 'syn-1+syn-2', semId: 'sem-1+sem-2', semString: 'P & Q', graph, semType: 'lfgxdrt' },
    premiseSemantic: 'Q',
    sequenceStructure: structure,
    premiseAsts: [structure],
    hypothesisAsts: [structure],
    typed: false,
    ruleString: "#a PRED %p ==> #a MARKED 'yes'.",
    includeSvg: false,
  });

  beforeEach(() => {
    dataService = jasmine.createSpyObj<DataService>('DataService', [
      'gswbReasoningCheckAsts', 'ligerMergeStructure', 'ligerApplyRulesToStructure',
      'gswbGeneratePcdrs', 'gswbCollapseAndTptpBatch',
    ]);
    TestBed.configureTestingModule({
      providers: [ReasoningPipelineService, { provide: DataService, useValue: dataService }],
    });
    service = TestBed.inject(ReasoningPipelineService);

    dataService.gswbReasoningCheckAsts.and.returnValue(of(checkAsts()) as any);
    dataService.ligerMergeStructure.and.returnValue(of({ structureJson: structure, graph }) as any);
    dataService.ligerApplyRulesToStructure.and.returnValue(
      of({ annotations: [{ structureJson: structure, graph }] }) as any);
    dataService.gswbGeneratePcdrs.and.returnValue(
      of({ solutions: [{ id: 'm1', semantic: 'P & Q', anaphoraRelations: [] }] }) as any);
    dataService.gswbCollapseAndTptpBatch.and.returnValue(of(tptpBatch()) as any);
  });

  it('produces one assignment carrying all four checks', done => {
    service.prepareReasoningChecks(request()).subscribe(pair => {
      expect(pair.assignments.length).toBe(1);
      expect(Object.keys(pair.assignments[0].checks).sort())
        .toEqual([...REASONING_CHECK_NAMES].sort());
      expect(pair.assignments[0].contextTptp).toBe('fof(context).');
      expect(pair.failures).toEqual([]);
      done();
    });
  });

  it('conjoins the prior as the context and keeps the merged sequence separate', done => {
    // The context axiom is Q, the prior -- A for A+B, A+B for A+B+C. Sending the merged
    // premise+conclusion instead would put the conclusion into the axiom the four checks
    // are meant to be tested against.
    service.prepareReasoningChecks(request()).subscribe(pair => {
      const sent = dataService.gswbCollapseAndTptpBatch.calls.mostRecent().args[0] as any;
      const byName = Object.fromEntries(sent.items.map((item: any) => [item.name, item.semantic]));
      expect(byName['context']).toBe('Q');
      expect(byName['sequence']).toBe('P & Q');
      expect(pair.assignments[0].contextTptp).toBe('fof(context).');
      expect(pair.assignments[0].sequenceTptp).toBe('fof(sequence).');
      done();
    });
  });

  it('omits the context item entirely when the caller has no prior', done => {
    // Echo only what was actually requested: the default stub answers every name
    // unconditionally, which would hide exactly the omission under test.
    dataService.gswbCollapseAndTptpBatch.and.callFake((payload: any) => of({
      results: Object.fromEntries(
        payload.items.map((item: any) => [item.name, { tptp: `fof(${item.name}).` }]))
    }) as any);

    service.prepareReasoningChecks({ ...request(), premiseSemantic: undefined }).subscribe(pair => {
      const sent = dataService.gswbCollapseAndTptpBatch.calls.mostRecent().args[0] as any;
      expect(sent.items.some((item: any) => item.name === 'context')).toBe(false);
      // No prior means no axiom -- never the merged sequence standing in for one.
      expect(pair.assignments[0].contextTptp).toBe('');
      done();
    });
  });

  it('asks GSWB to render the readings only when the caller shows them', done => {
    service.prepareReasoningChecks(request()).subscribe(() => {
      service.prepareReasoningChecks({ ...request(), includeSvg: true }).subscribe(() => {
        expect(dataService.gswbGeneratePcdrs.calls.allArgs().map(args => args[0].includeSvg))
          .toEqual([false, true]);
        done();
      });
    });
  });

  it('asks GSWB for the readings the rules propose', done => {
    service.prepareReasoningChecks(request()).subscribe(() => {
      expect(dataService.gswbGeneratePcdrs.calls.allArgs().map(args => args[0].rulesApplied))
        .toEqual([true]);
      done();
    });
  });

  it('fetches the check ASTs once per pair, not once per mapping', done => {
    dataService.gswbGeneratePcdrs.and.returnValue(of({
      solutions: [{ id: 'm1', semantic: 'a', anaphoraRelations: [] },
                  { id: 'm2', semantic: 'b', anaphoraRelations: [] }]
    }) as any);

    service.prepareReasoningChecks(request()).subscribe(pair => {
      expect(pair.assignments.length).toBe(2);
      expect(dataService.gswbReasoningCheckAsts).toHaveBeenCalledTimes(1);
      expect(dataService.gswbCollapseAndTptpBatch).toHaveBeenCalledTimes(2);
      done();
    });
  });

  it('sends the reading inline with the sequence and nothing beside it', done => {
    dataService.gswbGeneratePcdrs.and.returnValue(of({
      solutions: [{ id: 'm1', semantic: '([x1],[ant(x1)]),A:[a(x1,/)],P:[p(s1,s1)]', anaphoraRelations: [] }]
    }) as any);

    service.prepareReasoningChecks(request()).subscribe(() => {
      const sent = dataService.gswbCollapseAndTptpBatch.calls.mostRecent().args[0] as any;
      expect(sent.anaphoraRelations).toBeUndefined();
      expect(sent.presuppositionRelations).toBeUndefined();
      expect(sent.items.find((item: any) => item.name === 'sequence').semantic)
        .toBe('([x1],[ant(x1)]),A:[a(x1,/)],P:[p(s1,s1)]');
      done();
    });
  });

  it('keeps each check\'s rebased reading and collapse report with it', done => {
    const batch = tptpBatch();
    (batch.results as any)['cons_neg_check'] = {
      tptp: 'fof(c).', presuppositionMapping: 'P:[p(s2,s2),p(s6,s1)]', anaphoraMapping: 'A:[a(x3,x1)]',
      stateMap: { s0: 's1', s3: 's6' }, collapseReport: 's2 accommodated at s1; s6 bound at s1 (x3 ↦ x1)'
    };
    dataService.gswbCollapseAndTptpBatch.and.returnValue(of(batch) as any);

    service.prepareReasoningChecks(request()).subscribe(pair => {
      const check = pair.assignments[0].checks['cons_neg_check'];
      expect(check.presuppositionMapping).toBe('P:[p(s2,s2),p(s6,s1)]');
      expect(check.stateMap).toEqual({ s0: 's1', s3: 's6' });
      expect(check.collapseReport).toContain('bound at s1');
      done();
    });
  });

  it('records a failure instead of dropping the branch when a check is missing', done => {
    dataService.gswbCollapseAndTptpBatch.and.returnValue(of(tptpBatch(['cons_neg_check'])) as any);

    service.prepareReasoningChecks(request()).subscribe(pair => {
      expect(pair.assignments).toEqual([]);
      expect(pair.failures.length).toBe(1);
      expect(pair.failures[0]).toContain('cons_neg_check');
      done();
    });
  });

  it('mints a document-level assignment id when the request carries a scope', done => {
    dataService.gswbGeneratePcdrs.and.returnValue(of({
      solutions: [{ id: 'm1', semantic: 'P & Q', anaphoraRelations: [] }]
    }) as any);

    service.prepareReasoningChecks({
      ...request(),
      scope: {
        updateId: 'ru-sentence-1=>sentence-2',
        premiseSemanticIds: ['sem-1'],
        hypothesisSemanticIds: ['sem-2'],
      },
    }).subscribe(pair => {
      // Every component recoverable, so array position is never identity.
      expect(pair.assignments[0].assignmentId)
        .toBe('ru-sentence-1=>sentence-2/P[sem-1]/H[sem-2]/r1/mm1');
      done();
    });
  });

  it('leaves the assignment id unset when no scope is given', done => {
    service.prepareReasoningChecks(request()).subscribe(pair => {
      expect(pair.assignments[0].assignmentId).toBeUndefined();
      done();
    });
  });

  it('fails a branch whose reading an item\'s collapse rejects, saying why', done => {
    // No fallback (I7): a rejected item has no TPTP, and the branch is not reasoned over.
    const rejectedBatch = tptpBatch();
    (rejectedBatch.results as any)['context'] = {
      tptp: '', rejection: 'Referent x7 occurs outside the scope of the box that introduces it (I9)'
    };
    dataService.gswbCollapseAndTptpBatch.and.returnValue(of(rejectedBatch) as any);

    service.prepareReasoningChecks(request()).subscribe(pair => {
      expect(pair.assignments).toEqual([]);
      expect(pair.failures.length).toBe(1);
      expect(pair.failures[0]).toContain('context');
      expect(pair.failures[0]).toContain('x7');
      done();
    });
  });

  it('reports a branch whose reading leaves a pronoun unresolved', done => {
    const batch = tptpBatch();
    (batch.results as any)['sequence'] = { tptp: 'fof(s).', unresolvedPronouns: ['x4'] };
    dataService.gswbCollapseAndTptpBatch.and.returnValue(of(batch) as any);

    service.prepareReasoningChecks(request()).subscribe(pair => {
      expect(pair.assignments.length).toBe(1);
      expect(pair.degradations.length).toBe(1);
      expect(pair.degradations[0]).toContain('x4');
      done();
    });
  });

  it('survives one mapping erroring and keeps the others', done => {
    dataService.gswbGeneratePcdrs.and.returnValue(of({
      solutions: [{ id: 'bad', semantic: 'a', anaphoraRelations: [] },
                  { id: 'good', semantic: 'b', anaphoraRelations: [] }]
    }) as any);
    dataService.gswbCollapseAndTptpBatch.and.callFake((payload: any) =>
      (payload.parentSolutionId === 'bad'
        ? throwError(() => new Error('collapse exploded'))
        : of(tptpBatch())) as any);

    service.prepareReasoningChecks(request()).subscribe(pair => {
      expect(pair.assignments.map(a => a.mappingId)).toEqual(['good']);
      expect(pair.failures.length).toBe(1);
      expect(pair.failures[0]).toContain('collapse exploded');
      done();
    });
  });

  it('numbers rule branches 1-based and carries neither tier on the assignment', done => {
    // Two rule branches, two mappings each -- the classic duplication case.
    dataService.ligerApplyRulesToStructure.and.returnValue(of({
      annotations: [
        { structureJson: { ...structure, id: 'branch-1' }, graph },
        { structureJson: { ...structure, id: 'branch-2' }, graph },
      ]
    }) as any);
    // The semantic varies per branch: two branches yielding the IDENTICAL mapping are
    // deduplicated now (see the dedup test below), which would make this fixture measure
    // that instead of the branch numbering it is here for.
    dataService.gswbGeneratePcdrs.and.callFake((payload: any) => of({
      solutions: [
        { id: `${payload.parentSolutionId}-m1`, semantic: `${payload.parentSolutionId}-a`, anaphoraRelations: [] },
        { id: `${payload.parentSolutionId}-m2`, semantic: `${payload.parentSolutionId}-b`, anaphoraRelations: [] },
      ]
    }) as any);

    service.prepareReasoningChecks(request()).subscribe(pair => {
      expect(pair.assignments.length).toBe(4);
      // Rule branch index is 1-based and matches the parentSolutionId sent to GSWB.
      expect(pair.assignments.map(a => a.ruleBranchIndex)).toEqual([1, 1, 2, 2]);
      expect(dataService.gswbGeneratePcdrs.calls.allArgs().map((args: any[]) => args[0].parentSolutionId))
        .toEqual(['pxq-1-1-rule-1', 'pxq-1-1-rule-2']);
      // Neither derived join rides along on the assignment. They are computed (the two
      // calls above prove it) and consumed to produce the mappings, then dropped: keeping
      // them here is what used to hold the whole cross product in memory for a run, and
      // what the document writers then persisted.
      pair.assignments.forEach(assignment => {
        ['baseStructure', 'baseGraph', 'mergedStructure', 'mergedGraph', 'structureId', 'baseStructureId']
          .forEach(field => expect((assignment as any)[field]).toBeUndefined());
      });
      done();
    });
  });

  it('drops a duplicate anaphora mapping before any check is built for it', done => {
    // LiGER forks a rule branch per rule solution; branches that differ only in facts GSWB
    // does not read come back with the same mapping.
    dataService.ligerApplyRulesToStructure.and.returnValue(of({
      annotations: [
        { structureJson: { ...structure, id: 'branch-1' }, graph },
        { structureJson: { ...structure, id: 'branch-2' }, graph },
      ]
    }) as any);
    // Both branches produce the same binding over the same DRS -- the duplication case.
    dataService.gswbGeneratePcdrs.and.callFake((payload: any) => of({
      solutions: [{
        id: `${payload.parentSolutionId}-m1`,
        semantic: 'drs',
        anaphoraRelations: [{ pronounReferentId: 'x2', antecedent: 'x1', stateLabel: 's1' }],
      }]
    }) as any);

    service.prepareReasoningChecks(request()).subscribe(pair => {
      expect(pair.assignments.length).toBe(1);
      // The point of deduplicating here rather than where the document is written: a
      // duplicate that reaches this far has already cost a collapse/TPTP batch and four
      // Vampire runs. Filtering at the document layer would have hidden that, not saved it.
      expect(dataService.gswbCollapseAndTptpBatch).toHaveBeenCalledTimes(1);
      done();
    });
  });

  it('fails with the rules\' reason when they delete every reading', done => {
    // `?+=> 0` can delete every branch; going on with the structure before rules would bring
    // the deleted reading back.
    dataService.ligerApplyRulesToStructure.and.returnValue(of({
      annotations: [],
      failureMessage: 'every branch was deleted by the rule(s) at line(s) 50',
    }) as any);

    service.prepareReasoningChecks(request()).subscribe({
      next: () => fail('expected the pair to fail'),
      error: (error: Error) => {
        expect(error.message).toContain('left no reading');
        expect(error.message).toContain('line(s) 50');
        expect(dataService.gswbGeneratePcdrs).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('keeps mappings that differ only in their binding', done => {
    dataService.ligerApplyRulesToStructure.and.returnValue(of({
      annotations: [
        { structureJson: { ...structure, id: 'branch-1' }, graph },
        { structureJson: { ...structure, id: 'branch-2' }, graph },
      ]
    }) as any);
    // Same DRS, different antecedent: two genuinely different readings of the discourse,
    // which is exactly what the cross-product enumeration exists to produce.
    let antecedent = 0;
    dataService.gswbGeneratePcdrs.and.callFake((payload: any) => of({
      solutions: [{
        id: `${payload.parentSolutionId}-m1`,
        semantic: 'drs',
        anaphoraRelations: [{ pronounReferentId: 'x2', antecedent: `x${++antecedent}`, stateLabel: 's1' }],
      }]
    }) as any);

    service.prepareReasoningChecks(request()).subscribe(pair => {
      expect(pair.assignments.length).toBe(2);
      done();
    });
  });

  it('scopes assignments per pair so concurrent contexts stay distinct', done => {
    // Several pairs routinely share one merged semantic id while having genuinely
    // different structures, because each comes from a different premise context. The
    // pair scope is what keeps them apart -- it used to also be the structure key.
    service.prepareReasoningChecksSequentially([request('pxq-1'), request('pxq-2')])
      .subscribe(pairs => {
        const [first, second] = pairs.map(p => p.assignments[0]);
        expect(first.pairId).toBe('pxq-1');
        expect(second.pairId).toBe('pxq-2');
        expect(first.ruleBranchIndex).toBe(1);
        expect(second.ruleBranchIndex).toBe(1);
        done();
      });
  });

  it('computes both tiers even though it stores neither', done => {
    service.prepareReasoningChecks(request()).subscribe(pair => {
      // Tier A comes from the union endpoint, tier B from rule application. Both still
      // run -- the anaphora mappings below are read off tier B -- they are just not kept.
      expect(dataService.ligerMergeStructure).toHaveBeenCalledTimes(1);
      expect(dataService.ligerApplyRulesToStructure).toHaveBeenCalledTimes(1);
      expect(pair.assignments[0].mapping).toBeTruthy();
      done();
    });
  });

  for (const [label, ruleString] of [
    ['empty', ''],
    ['comment-only', '// anaphora rules go here\n//   #a ==> #b'],
  ]) {
    it(`builds the checks over the merged DRS with ${label} rules, skipping only the rules`, done => {
      service.prepareReasoningChecks({ ...request(), ruleString }).subscribe(pair => {
        // The DRS is still merged with the syntax and still goes to PCDRS generation; only
        // the rule application itself is skipped, so the merged union is the one branch.
        expect(dataService.ligerMergeStructure).toHaveBeenCalledTimes(1);
        expect(dataService.ligerApplyRulesToStructure).not.toHaveBeenCalled();
        expect((dataService.gswbGeneratePcdrs.calls.mostRecent().args[0] as any).mergedStructure)
          .toBe(structure);
        // GSWB returns its default reading only when told the rules did not run; told they
        // did, it finds no proposed site for a p-box and rejects every reading.
        expect(dataService.gswbGeneratePcdrs.calls.mostRecent().args[0].rulesApplied).toBe(false);
        expect(pair.assignments.length).toBe(1);
        expect(pair.assignments[0].ruleBranchIndex).toBe(1);
        expect(pair.failures).toEqual([]);
        done();
      });
    });
  }

  it('generates the discourse mappings without rules too', done => {
    service.generateDiscourseMappings({
      scopeId: 's', merged: request().merged, sequenceStructure: structure, ruleString: '',
      includeSvg: true,
    }).subscribe(mappings => {
      expect(mappings.length).toBe(1);
      expect(dataService.ligerApplyRulesToStructure).not.toHaveBeenCalled();
      expect(dataService.gswbGeneratePcdrs.calls.mostRecent().args[0].rulesApplied).toBe(false);
      done();
    });
  });

  it('names a branch whose pronouns stayed unresolved', done => {
    const batch: any = tptpBatch();
    batch.results['sequence'].unresolvedPronouns = ['x4'];
    batch.results['info_pos_check'].unresolvedPronouns = ['x2'];
    dataService.gswbCollapseAndTptpBatch.and.returnValue(of(batch) as any);

    service.prepareReasoningChecks({ ...request(), ruleString: '' }).subscribe(pair => {
      // Once per branch, from the sequence: the check items number their referents apart.
      expect(pair.assignments[0].degradations).toEqual(['m1: unresolved pronoun(s) x4 read as new referent(s)']);
      expect(pair.degradations.length).toBe(1);
      done();
    });
  });

  it('requires the sequence syntax -- rules cannot link semantics alone', () => {
    expect(() => service.prepareReasoningChecks({ ...request(), sequenceStructure: null as any }))
      .toThrowError(/sequence provenance structure/);
  });

  it('runs pairs strictly sequentially, never concurrently', () => {
    // Two concurrent chains has been observed to leave an HttpClient observable that
    // never emits, so the second pair must not start until the first completes.
    const gates = [new Subject<any>(), new Subject<any>()];
    let started = 0;
    dataService.ligerMergeStructure.and.callFake(() => gates[started++] as any);

    const emitted: string[] = [];
    service.prepareReasoningChecksSequentially([request('pair-1'), request('pair-2')])
      .subscribe(pairs => emitted.push(...pairs.map(p => p.scopeId)));

    expect(started).toBe(1);

    gates[0].next({ structureJson: structure, graph });
    gates[0].complete();
    expect(started).toBe(2);

    gates[1].next({ structureJson: structure, graph });
    gates[1].complete();
    expect(emitted).toEqual(['pair-1', 'pair-2']);
  });

  describe('over stored readings', () => {
    const stored = (readings = [{ id: 'S0-s0+S1-s0-pcdrs-1', drsString: 'P & Q', ruleBranch: 2 }])
      : StoredReadingChecksRequest => ({
      scopeId: 'pxq-item-1',
      readings,
      premiseSemantic: 'Q',
      premiseAsts: [structure],
      hypothesisAsts: [structure],
      typed: false,
    });

    it('reasons over the given readings without rules or PCDRS generation', done => {
      service.prepareStoredReadingChecks(stored()).subscribe(pair => {
        expect(dataService.ligerMergeStructure).not.toHaveBeenCalled();
        expect(dataService.ligerApplyRulesToStructure).not.toHaveBeenCalled();
        expect(dataService.gswbGeneratePcdrs).not.toHaveBeenCalled();
        expect(pair.assignments.length).toBe(1);
        expect(Object.keys(pair.assignments[0].checks).sort()).toEqual([...REASONING_CHECK_NAMES].sort());
        done();
      });
    });

    it('collapses each reading under its own id with the prior as the context', done => {
      service.prepareStoredReadingChecks(stored()).subscribe(pair => {
        const sent = dataService.gswbCollapseAndTptpBatch.calls.mostRecent().args[0] as any;
        const byName = Object.fromEntries(sent.items.map((item: any) => [item.name, item.semantic]));
        expect(sent.parentSolutionId).toBe('S0-s0+S1-s0-pcdrs-1');
        expect(byName['context']).toBe('Q');
        expect(byName['sequence']).toBe('P & Q');
        expect(pair.assignments[0].mappingId).toBe('S0-s0+S1-s0-pcdrs-1');
        expect(pair.assignments[0].ruleBranchIndex).toBe(2);
        expect((pair.assignments[0] as any).mapping).toBeUndefined();
        done();
      });
    });

    it('fetches the check ASTs once for all readings', done => {
      const readings = [
        { id: 'r1', drsString: 'a', ruleBranch: 1 },
        { id: 'r2', drsString: 'b', ruleBranch: 1 },
      ];
      service.prepareStoredReadingChecks(stored(readings)).subscribe(pair => {
        expect(dataService.gswbReasoningCheckAsts).toHaveBeenCalledTimes(1);
        expect(dataService.gswbCollapseAndTptpBatch).toHaveBeenCalledTimes(2);
        expect(pair.assignments.map(a => a.mappingId)).toEqual(['r1', 'r2']);
        done();
      });
    });

    it('mints the same assignment id as the full pipeline for the same reading', done => {
      const scope = { updateId: 'ru-1', premiseSemanticIds: ['S0-s0'], hypothesisSemanticIds: ['S1-s0'] };
      dataService.gswbGeneratePcdrs.and.returnValue(
        of({ solutions: [{ id: 'm1', semantic: 'P & Q', anaphoraRelations: [] }] }) as any);
      service.prepareReasoningChecks({ ...request(), scope }).subscribe(full => {
        service.prepareStoredReadingChecks({
          ...stored([{ id: 'm1', drsString: 'P & Q', ruleBranch: 1 }]), scope,
        }).subscribe(fromStored => {
          expect(fromStored.assignments[0].assignmentId).toBe(full.assignments[0].assignmentId!);
          expect(fromStored.assignments[0].checks).toEqual(full.assignments[0].checks);
          done();
        });
      });
    });

    it('emits an empty pair for an empty selection and asks GSWB nothing', done => {
      service.prepareStoredReadingChecks(stored([])).subscribe(pair => {
        expect(pair).toEqual({ scopeId: 'pxq-item-1', assignments: [], failures: [], degradations: [] });
        expect(dataService.gswbReasoningCheckAsts).not.toHaveBeenCalled();
        expect(dataService.gswbCollapseAndTptpBatch).not.toHaveBeenCalled();
        done();
      });
    });

    it('keeps the other readings when one reading\'s collapse fails', done => {
      dataService.gswbCollapseAndTptpBatch.and.callFake((payload: any) =>
        (payload.parentSolutionId === 'bad'
          ? throwError(() => new Error('collapse exploded'))
          : of(tptpBatch())) as any);
      service.prepareStoredReadingChecks(stored([
        { id: 'bad', drsString: 'a', ruleBranch: 1 },
        { id: 'good', drsString: 'b', ruleBranch: 1 },
      ])).subscribe(pair => {
        expect(pair.assignments.map(a => a.mappingId)).toEqual(['good']);
        expect(pair.failures).toEqual(['bad: collapse exploded']);
        done();
      });
    });

    it('requires the sentence readings\' graphs', () => {
      expect(() => service.prepareStoredReadingChecks({ ...stored(), hypothesisAsts: [] }))
        .toThrowError(/semantic graphs are missing/);
    });
  });
});
