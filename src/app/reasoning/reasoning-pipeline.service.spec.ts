import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { ReasoningPipelineService, ReasoningPairRequest } from './reasoning-pipeline.service';
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
      ...REASONING_CHECK_NAMES
        .filter(name => !omit.includes(name))
        .map(name => [name, { tptp: `fof(${name}).` }])
    ])
  });

  const request = (scopeId = 'pxq-1-1'): ReasoningPairRequest => ({
    scopeId,
    merged: { semantic: 'P & Q', graph, id: 'sem-1+sem-2' },
    sequenceStructure: structure,
    premiseAsts: [structure],
    hypothesisAsts: [structure],
    typed: false,
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

  it('passes structured anaphoraRelations rather than splicing them into the semantic', done => {
    const relations = [{ pronounReferentId: 'x3', antecedent: 'x1' }];
    dataService.gswbGeneratePcdrs.and.returnValue(of({
      solutions: [{ id: 'm1', semantic: 'P & Q', anaphoraRelations: relations }]
    }) as any);

    service.prepareReasoningChecks(request()).subscribe(() => {
      const sent = dataService.gswbCollapseAndTptpBatch.calls.mostRecent().args[0] as any;
      expect(sent.anaphoraRelations).toEqual(relations);
      expect(sent.items.every((item: any) => !item.semantic.includes(','))).toBe(true);
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

  it('keys tier B by rule branch so mappings sharing a branch do not duplicate it', done => {
    // Two rule branches, two mappings each -- the classic duplication case.
    dataService.ligerApplyRulesToStructure.and.returnValue(of({
      annotations: [
        { structureJson: { ...structure, id: 'branch-1' }, graph },
        { structureJson: { ...structure, id: 'branch-2' }, graph },
      ]
    }) as any);
    dataService.gswbGeneratePcdrs.and.callFake((payload: any) => of({
      solutions: [
        { id: `${payload.parentSolutionId}-m1`, semantic: 'a', anaphoraRelations: [] },
        { id: `${payload.parentSolutionId}-m2`, semantic: 'b', anaphoraRelations: [] },
      ]
    }) as any);

    service.prepareReasoningChecks(request()).subscribe(pair => {
      expect(pair.assignments.length).toBe(4);
      // Rule branch index is 1-based and matches the parentSolutionId sent to GSWB.
      expect(pair.assignments.map(a => a.ruleBranchIndex)).toEqual([1, 1, 2, 2]);
      expect(dataService.gswbGeneratePcdrs.calls.allArgs().map((args: any[]) => args[0].parentSolutionId))
        .toEqual(['pxq-1-1-rule-1', 'pxq-1-1-rule-2']);
      // Mappings off one branch share that branch's structure identity.
      expect((pair.assignments[0].mergedStructure as any).id).toBe('branch-1');
      expect((pair.assignments[1].mergedStructure as any).id).toBe('branch-1');
      expect((pair.assignments[2].mergedStructure as any).id).toBe('branch-2');
      done();
    });
  });

  it('keeps tier A alongside tier B on every assignment', done => {
    service.prepareReasoningChecks(request()).subscribe(pair => {
      expect(pair.assignments[0].baseStructure).toBeTruthy();
      expect(pair.assignments[0].baseGraph).toBeTruthy();
      // Tier A comes from the union endpoint, tier B from rule application.
      expect(dataService.ligerMergeStructure).toHaveBeenCalledTimes(1);
      expect(dataService.ligerApplyRulesToStructure).toHaveBeenCalledTimes(1);
      done();
    });
  });

  it('requires the sequence syntax -- rules cannot link semantics alone', () => {
    expect(() => service.prepareReasoningChecks({ ...request(), sequenceStructure: null as any }))
      .toThrowError(/sequence provenance structure/);
  });

  it('reasons over one candidate only when pruning', done => {
    dataService.gswbGeneratePcdrs.and.returnValue(of({
      solutions: [{ id: 'm1', semantic: 'a', anaphoraRelations: [] },
                  { id: 'm2', semantic: 'b', anaphoraRelations: [] }]
    }) as any);

    service.prepareReasoningChecks({ ...request(), prune: true }).subscribe(pair => {
      expect(pair.assignments.length).toBe(1);
      // Pruning must happen before the expensive collapse step, not after.
      expect(dataService.gswbCollapseAndTptpBatch).toHaveBeenCalledTimes(1);
      done();
    });
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
});
