import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, of, throwError } from 'rxjs';

import { RegressionTestingInterfaceComponent } from './regression-testing-interface.component';
import { DataService } from '../data.service';
import { ReasoningPipelineService } from '../reasoning/reasoning-pipeline.service';
import {
  createRegressionAnalysisDocument,
  createRegressionTestingSession,
} from '../models/models';

describe('RegressionTestingInterfaceComponent', () => {
  let component: RegressionTestingInterfaceComponent;
  let fixture: ComponentFixture<RegressionTestingInterfaceComponent>;
  let reasoningPipeline: jasmine.SpyObj<ReasoningPipelineService>;

  beforeEach(() => {
    const dataServiceSpy = jasmine.createSpyObj('DataService', [
      'ligerSequence',
      'gswbDeduce',
      'gswbMergeSequenceSemantics',
      'listRegressionSessions',
      'loadRegressionSession',
      'saveRegressionSession',
      'deleteRegressionSession',
      'requestVampireCancel',
      'getLastSession',
      'getLastSessionSummary',
      'getLastGswbSession',
      'getLastGswbSessionSummary',
      'gswbReasoningChecks',
      'getVampireProgress'
    ]);
    dataServiceSpy.listRegressionSessions.and.returnValue(of([]));
    dataServiceSpy.loadRegressionSession.and.returnValue(of({} as any));
    dataServiceSpy.saveRegressionSession.and.returnValue(of({} as any));
    dataServiceSpy.deleteRegressionSession.and.returnValue(of({} as any));
    dataServiceSpy.getLastSession.and.returnValue(of({ results: {} }));
    dataServiceSpy.getLastSessionSummary.and.returnValue(of({ item_count: 0, proof_count: 0 }));
    dataServiceSpy.getLastGswbSession.and.returnValue(of({ outputs: {} } as any));
    dataServiceSpy.getLastGswbSessionSummary.and.returnValue(of({} as any));
    dataServiceSpy.getVampireProgress.and.returnValue(of({
      sessionKey: 'k', runId: null, state: 'idle', cancelRequested: false, activeItemId: null,
      completedItemIds: [], changedItemIds: [], itemResults: {}, itemCount: 0, proofCount: 0,
      totalItemCount: 0,
    } as any));
    dataServiceSpy.gswbReasoningChecks.and.returnValue(of({ checks: {} }));
    // A three-sentence sequence: one part per sentence, each with its own MCs.
    dataServiceSpy.ligerSequence.and.returnValue(of({
      solutions: [{
        structureJson: { constraints: [] },
        sequenceParts: [
          { sentenceId: 'S1', solutionKey: 'S0', meaningConstructors: 'mc1' },
          { sentenceId: 'S2', solutionKey: 'S0', meaningConstructors: 'mc2' },
          { sentenceId: 'S3', solutionKey: 'S0', meaningConstructors: 'mc3' },
        ],
      }]
    } as any));
    // Each part re-derived inside the sequence: new ids, rebased source indices.
    let deduceCall = 0;
    dataServiceSpy.gswbDeduce.and.callFake(() => {
      const index = deduceCall++;
      return of({ solutions: [{
        id: `seq-${index + 1}`, sourceIndex: (index + 1) * 10,
        semantic: ['A', 'B', 'C'][index] ?? 'X', graph: { constraints: [] },
      }] } as any);
    });
    dataServiceSpy.gswbMergeSequenceSemantics.and.returnValue(
      of({ id: 'sem-1+sem-2', semantic: 'P + Q', graph: { constraints: [] } } as any));

    reasoningPipeline = jasmine.createSpyObj<ReasoningPipelineService>(
      'ReasoningPipelineService', ['prepareReasoningChecks', 'prepareReasoningChecksSequentially']);
    reasoningPipeline.prepareReasoningChecks.and.returnValue(
      of({ scopeId: 'pxq-n1-1-1', assignments: [], failures: [], degradations: [] }));

    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [RegressionTestingInterfaceComponent],
      providers: [
        { provide: DataService, useValue: dataServiceSpy },
        { provide: ReasoningPipelineService, useValue: reasoningPipeline },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA]
    });
    fixture = TestBed.createComponent(RegressionTestingInterfaceComponent);
    component = fixture.componentInstance;
    component['testfile'] = { getContent: () => '', updateContent: () => {} } as any;
    component['ligerRules'] = { getContent: () => '', updateContent: () => {} } as any;
    component['axiomEdit'] = { getContent: () => '', updateContent: () => {} } as any;
    component['gswbPreferences'] = {
      gswbPreferences: {},
      gswbPreferencesForm: { valueChanges: of([]) },
      updateFormFromPreferences: () => {},
    } as any;
    component['vampirePreferences'] = {
      vampirePreferences: {},
      vampirePreferencesForm: { valueChanges: of([]) },
      updateFormFromPreferences: () => {},
    } as any;
    component['errorhandle'] = { nativeElement: { textContent: '', style: {} } } as any;
    component['semvisDialog'] = { open: () => {} } as any;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /** One sentence's GSWB output, in the shape the selection helpers read. */
  const outputsFor = (solutions: any[]) => ({
    S1: { solutions, log: '', derivation: null, discriminants: [] }
  }) as any;

  const selectedTexts = (outputs: any, useDisambiguated: boolean) =>
    (component as any).selectedSolutions('S1', outputs, useDisambiguated)
      .map((solution: any) => (component as any).solutionText(solution));

  it('filters Vampire solutions to the disambiguated selection', () => {
    component.session.selectedSolutionIdsBySentence = { S1: ['sol-2'] };

    const result = selectedTexts(outputsFor([
      { id: 'sol-1', solution: 'first' },
      { id: 'sol-2', solution: 'second' },
    ]), true);

    expect(result).toEqual(['second']);
  });

  it('uses the LFGxDRT semantic field when preparing reasoning input', () => {
    component.session.gswbPreferences.outputstyle = 5;

    const result = selectedTexts(outputsFor([{
      id: 'sol-1',
      solution: '<svg>rendered</svg>',
      semantic: '([x],[dog(x)])',
      graph: { constraints: [] },
    }]), false);

    expect(result).toEqual(['([x],[dog(x)])']);
  });

  it('does not fall back to all solutions in disambiguated mode when no selection exists', () => {
    component.session.selectedSolutionIdsBySentence = {};

    const result = selectedTexts(outputsFor([
      { id: 'sol-1', solution: 'first' },
      { id: 'sol-2', solution: 'second' },
    ]), true);

    expect(result).toEqual([]);
  });

  it('selects readings once, so text and semantic graph cannot come apart', () => {
    // A reading with no graph cannot be a premise AST. It used to be filtered out of the
    // graph list only, leaving the text list one entry longer -- and the two were then
    // indexed against each other, so every later reading was paired with the wrong graph.
    component.session.gswbPreferences.outputstyle = 5;

    const selected = (component as any).selectedSolutions('S1', outputsFor([
      { id: 'sol-1', solution: 'a', semantic: '([x],[dog(x)])' },
      { id: 'sol-2', solution: 'b', semantic: '([y],[cat(y)])', graph: { constraints: [] } },
    ]), false);

    expect(selected.map((solution: any) => solution.id)).toEqual(['sol-2']);
    expect(selected.every((solution: any) => !!solution.graph)).toBeTrue();
  });

  it('keeps graphless readings when the run is not an LFGxDRT one', () => {
    component.session.gswbPreferences.outputstyle = 1;

    const selected = (component as any).selectedSolutions('S1', outputsFor([
      { id: 'sol-1', solution: 'a' },
    ]), false);

    expect(selected.map((solution: any) => solution.id)).toEqual(['sol-1']);
  });

  /** One NLI item build: two premises, one hypothesis -- the shape prepareNliItem chains
   *  over (fold S2 onto seed S1, then fold S3 as the hypothesis). */
  const itemBuild = () => ({
    itemId: 'n1', updateId: 'ru-n1',
    premiseSentenceIds: ['S1', 'S2'], hypothesisSentenceIds: ['S3'],
  }) as any;

  /** Wires the three GSWB/LiGER endpoints DocumentBuilderService.mergeSequence's rebase
   *  path calls, one sentence at a time, keyed off the request content so the same spies
   *  serve both fold steps (S1+S2, then (S1+S2)+S3) correctly. */
  const mockChainEndpoints = (dataServiceSpy: jasmine.SpyObj<DataService>) => {
    component.session.gswbPreferences.outputstyle = 5;
    component.sentenceMap = { S1: 'one', S2: 'two', S3: 'three' };
    component.session.lastAnnotations = {
      S1: { structureJson: { id: 'st-1' } as any, graph: null, appliedRules: [] },
      S2: { structureJson: { id: 'st-2' } as any, graph: null, appliedRules: [] },
      S3: { structureJson: { id: 'st-3' } as any, graph: null, appliedRules: [] },
    } as any;
    component.session.lastGswbOutputs = {
      S1: { solutions: [{ id: 'S1-sol-1', solution: 'x', semantic: 'A', graph: { id: 'S1-graph' } }], log: '', derivation: null, discriminants: [] },
    } as any;

    dataServiceSpy.ligerSequence.and.callFake((request: any) => {
      const sentenceIds = request.sentenceIds as string[];
      const variantKey = `sequence-1-${sentenceIds.join('+')}`;
      return of({
        // One solution per SYNTACTIC VARIANT of the sequence; its key is what GSWB
        // stamps back onto every reading derived from it.
        solutions: [{
          solutionKey: variantKey,
          structureJson: { id: `merged-${sentenceIds.join('+')}` },
          sequenceParts: sentenceIds.map((id, index) => ({
            sourceIndex: index, sentenceId: id, solutionKey: 'S0', meaningConstructors: `mc-${id}`,
          })),
          sequenceAnalysis: {
            sentences: sentenceIds.map(id => ({
              id,
              syntax: [{ synId: `${id}-rebased-syn`, structure: { id: `${id}-rebased-struct` }, graph: { graphElements: [] } }],
            })),
          },
        }],
      } as any);
    });
    dataServiceSpy.gswbDeduce.and.callFake((request: any) => {
      // Mirrors GSWB: one MC set per proof, each returned solution stamped with its
      // originating proof's solutionKey.
      return of({
        solutions: (request.proofs ?? []).map((proof: any) => {
          const sentenceId = (proof.meaningConstructors as string).replace('mc-', '');
          return {
            id: `${sentenceId}-derived-1`,
            sourceIndex: 1,
            solutionKey: proof.solutionKey,
            semantic: sentenceId,
            graph: { id: `${sentenceId}-graph` },
          };
        }),
      } as any);
    });
    dataServiceSpy.gswbMergeSequenceSemantics.and.callFake((request: any) => {
      const combined = request.parts.map((part: any) => part.semantic).join(' + ');
      return of({
        id: `merged-${combined}`, semantic: combined, graph: { id: 'merged-graph' },
        semanticAnalysis: {
          syntacticOrigin: `syn-${combined}`, semId: `sem-${combined}`,
          semString: combined, graph: { id: 'merged-graph' }, semType: 'lfgxdrt',
        },
      } as any);
    });
  };

  it('folds a new sentence by supplying only the already-parsed prior structures, leaving it to be freshly rule-applied', done => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);

    (component as any).prepareNliItem(itemBuild(), component.session.lastGswbOutputs, false, false, 'fof', false)
      .subscribe(() => {
        // The seed (S1) gets its own one-sentence ligerSequence call first -- batch parse
        // never populates session.lastAnnotations[...].structureJson, so the seed's syntax
        // is sourced the same way chat's turn 1 is, not from the batch annotation.
        const seedCall = dataServiceSpy.ligerSequence.calls.all()
          .find(call => (call.args[0] as any).sentenceIds.join(',') === 'S1')!.args[0] as any;
        expect(seedCall.parsedSentences).toBeUndefined();
        // First fold (S2 onto seed S1): only S1 is supplied (from that seed call's
        // response), S2 is the new sentence.
        const s2Fold = dataServiceSpy.ligerSequence.calls.all()
          .find(call => (call.args[0] as any).sentenceIds.join(',') === 'S1,S2')!.args[0] as any;
        expect(s2Fold.parsedSentences.map((group: any[]) => group[0].id)).toEqual(['merged-S1']);
        // Second fold (S3 onto S1+S2): both priors supplied, S3 is the new sentence.
        const s3Fold = dataServiceSpy.ligerSequence.calls.all()
          .find(call => (call.args[0] as any).sentenceIds.join(',') === 'S1,S2,S3')!.args[0] as any;
        expect(s3Fold.parsedSentences.map((group: any[]) => group[0].id)).toEqual(['merged-S1', 'S2-rebased-struct']);
        done();
      });
  });

  it('sends the merged premises alone as the prior, separately from the whole merged sequence', done => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);

    (component as any).prepareNliItem(itemBuild(), component.session.lastGswbOutputs, false, false, 'fof', false)
      .subscribe(() => {
        const request = reasoningPipeline.prepareReasoningChecks.calls.mostRecent().args[0];
        // The prior is the merged premises alone -- the conclusion must not appear in the
        // axiom the four checks are tested against.
        expect(request.premiseSemantic).toBe('A + S2');
        expect(request.merged.semantic).toBe('A + S2 + S3');
        expect(request.scope!.updateId).toBe('ru-n1');
        expect(request.scope!.premiseSemanticIds).toEqual(['S1-sol-1', 'S2-derived-1']);
        expect(request.scope!.hypothesisSemanticIds).toEqual(['S3-derived-1']);
        done();
      });
  });

  it('re-derives each newly-folded sentence inside the sequence via a scoped deduce call, but not the seed', done => {
    // The seed sentence's own independent batch-parse reading is already correctly
    // numbered (nothing precedes it); only sentences folded in afterward need LiGER to
    // rule-apply and GSWB to re-derive them inside the growing sequence.
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);

    (component as any).prepareNliItem(itemBuild(), component.session.lastGswbOutputs, false, false, 'fof', false)
      .subscribe(() => {
        expect(dataServiceSpy.gswbDeduce).toHaveBeenCalledTimes(2);
        expect(dataServiceSpy.gswbDeduce.calls.allArgs().map(([request]: any[]) => request.premises))
          .toEqual(['mc-S2', 'mc-S3']);
        const request = reasoningPipeline.prepareReasoningChecks.calls.mostRecent().args[0];
        expect(request.premiseAsts as any).toEqual([{ id: 'S1-graph' }, { id: 'S2-graph' }]);
        expect(request.hypothesisAsts as any).toEqual([{ id: 'S3-graph' }]);
        done();
      });
  });

  it('reports an item that could not be prepared instead of aborting the batch', done => {
    // Every pair of every item used to live in one forkJoin under a single error handler,
    // so one unpreparable item killed the whole run.
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);
    reasoningPipeline.prepareReasoningChecks.and.returnValue(
      throwError(() => new Error('no post-processed sequence interpretations')));

    (component as any).prepareNliItem(itemBuild(), component.session.lastGswbOutputs, false, false, 'fof', false)
      .subscribe((pair: any) => {
        expect(pair.itemId).toBe('n1');
        expect(pair.assignments).toEqual([]);
        expect(pair.failures.length).toBe(1);
        expect(pair.failures[0]).toContain('no post-processed sequence interpretations');
        done();
      });
  });

  it('fails the item outright when a sentence cannot be folded into any branch', done => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);
    dataServiceSpy.ligerSequence.and.returnValue(of({ solutions: [] } as any));

    (component as any).prepareNliItem(itemBuild(), component.session.lastGswbOutputs, false, false, 'fof', false)
      .subscribe((pair: any) => {
        expect(pair.itemId).toBe('n1');
        expect(pair.assignments).toEqual([]);
        expect(pair.failures.length).toBe(1);
        done();
      });
  });

  it('deletes the old string-based reading-matching mechanism', () => {
    for (const removed of [
      'sequenceSolution', 'rebasedReadings', 'matchReading', 'conditionSignature',
      'readingRank', 'semanticMergePart', 'solutionAssignments', 'prepareNliPair',
    ]) {
      expect((component as any)[removed]).toBeUndefined();
    }
  });

  it('detects append items that touch updated sentences', () => {
    const result = (component as any).itemTouchesUpdatedSentences(
      { premises: ['S1'], conclusion: ['S2'] },
      new Set(['S2'])
    );

    expect(result).toBeTrue();
  });

  it('describes mixed vampire reruns with progressive wording', () => {
    component['vampireReprocessingItemCount'] = 8;
    component['vampireNewItemCount'] = 8;

    expect(component.vampireProgressLabel).toBe('Re-processing 8 items and processing 8 new items...');
  });

  it('shows absolute progress against the full bank size', () => {
    component['vampireProgressItemCount'] = 8;
    component['vampireProgressTotalCount'] = 16;

    expect(component.vampireProgressPercent).toBe(50);
  });

  it('shows vampire pending only while a vampire run is active', () => {
    component.session.timing.parseMs = 1200;
    component['activeVampireRunStartedAt'] = 123;

    expect(component.processingTimingSummary).toContain('Vampire pending');

    component['activeVampireRunStartedAt'] = null;
    component.session.hasRunVampire = true;
    component.inferenceResults = [{ id: 'I1' } as any];
    component.regressionTestItems = [{ id: 'I1' } as any, { id: 'I2' } as any];

    expect(component.processingTimingSummary).toContain('Vampire call incomplete');
  });

  it('counts disambiguated sentences when selected solutions differ from all solutions', () => {
    component.session.lastGswbOutputs = {
      S1: { solutions: [{ id: 'a', solution: 'a' }, { id: 'b', solution: 'b' }], log: '', derivation: null, discriminants: [] },
      S2: { solutions: [{ id: 'c', solution: 'c' }], log: '', derivation: null, discriminants: [] },
    } as any;
    component.session.selectedSolutionIdsBySentence = {
      S1: ['a'],
      S2: ['c'],
    };

    expect(component.disambiguatedSentenceCount).toBe(1);
  });

  it('counts vampire proofs from the saved result set', () => {
    component.session.lastVampireResults = {
      I1: [{ proof_files: ['p1', 'p2'] } as any],
      I2: [{ proof_files: [] } as any, { proof_files: ['p3'] } as any],
    } as any;

    expect(component.vampireProofCount).toBe(3);
  });

  it('includes parse, vampire, and disambiguated counts in the timing details', () => {
    component.session.timing.startedAt = '2026-05-18T21:00:00.000Z';
    component.session.timing.parseMs = 1234;
    component.session.timing.vampireMs = 2345;
    component.session.timing.totalMs = 3579;
    component.sentenceMap = { S1: 'One', S2: 'Two' };
    component.regressionTestResults = [{ sentence_id: 'S1' } as any, { sentence_id: 'S2' } as any];
    component.regressionTestItems = [{ id: 'I1' } as any, { id: 'I2' } as any];
    component.session.lastVampireResults = {
      I1: [{ proof_files: ['p1'] } as any],
      I2: [{ proof_files: ['p2', 'p3'] } as any],
    } as any;
    component.session.lastGswbOutputs = {
      S1: { solutions: [{ id: 'a', solution: 'a' }, { id: 'b', solution: 'b' }], log: '', derivation: null, discriminants: [] },
      S2: { solutions: [{ id: 'c', solution: 'c' }], log: '', derivation: null, discriminants: [] },
    } as any;
    component.session.selectedSolutionIdsBySentence = {
      S1: ['a'],
      S2: ['c'],
    };

    const details = component.processingTimingDetails;

    expect(details).toContain('Parse phase: 1.23s · 2/2 parses');
    expect(details).toContain('Vampire phase: 2.35s · 0/2 items');
    expect(details).toContain('Disambiguated sentences: 1 total');
    expect(details).toContain('Proofs: 3 total');
    expect(details).toContain('Overall: 3.58s');
  });

  it('does not show a saving message for current session no-ops', () => {
    const displaySpy = spyOn(component, 'displayMessage');

    component['sessionPersistenceEnabled'] = true;
    component['isHydratingSession'] = false;
    component['lastSavedSessionFingerprint'] = (component as any).buildSessionFingerprint((component as any).buildSessionSnapshot());

    component.saveCurrentSession();

    expect(displaySpy).not.toHaveBeenCalledWith(jasmine.stringMatching(/^Saving current session/), jasmine.any(String));
  });

  it('stays silent for autosave no-ops', () => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    const displaySpy = spyOn(component, 'displayMessage');

    component['sessionPersistenceEnabled'] = true;
    component['isHydratingSession'] = false;
    component['lastSavedSessionFingerprint'] = (component as any).buildSessionFingerprint((component as any).buildSessionSnapshot());

    (component as any).scheduleSessionSave(true);

    expect(dataServiceSpy.saveRegressionSession).not.toHaveBeenCalled();
    expect(displaySpy).not.toHaveBeenCalled();
  });

  it('reports all parsed sentences on final GSWB refresh', () => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    spyOn(component, 'displayMessage');
    dataServiceSpy.getLastGswbSession.and.returnValue(of({ outputs: {} } as any));

    component.loading = true;
    component['sentenceMap'] = { S1: 'One', S2: 'Two' };
    component['gswbRunToken'] = 1;
    component['activeGswbRunStartedAt'] = 123;

    (component as any).loadAndRenderGswbState(true, 123, 1);

    expect(component.displayMessage).toHaveBeenCalledWith('Parsed 2 of 2 sentences!', 'green');
  });

  it('does not show a fake parse count before GSWB finishes', () => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    const displaySpy = spyOn(component, 'displayMessage');
    dataServiceSpy.getLastGswbSession.and.returnValue(of({ outputs: {} } as any));

    component.loading = true;
    component['isHydratingSession'] = true;
    component['sentenceMap'] = { S1: 'One', S2: 'Two' };
    component['gswbRunToken'] = 1;
    component['activeGswbRunStartedAt'] = 123;

    (component as any).loadAndRenderGswbState(false, 123, 1);

    expect(displaySpy).not.toHaveBeenCalled();
  });

  it('shows timing info for hydrated sessions with cached Vampire state', () => {
    const snapshot = createRegressionTestingSession();
    snapshot.lastGswbOutputs = {
      S1: { solutions: [{ id: 'a', solution: 'a' }, { id: 'b', solution: 'b' }], log: '', derivation: null, discriminants: [] },
    } as any;
    snapshot.selectedSolutionIdsBySentence = { S1: ['a'] };
    snapshot.lastVampireResults = {
      I1: [{ proof_files: ['p1'] } as any],
    } as any;

    (component as any).hydrateSession(snapshot);

    expect(component.hasTimingInfo).toBeTrue();
    expect(component['vampirePreserveExistingResults']).toBeTrue();
    expect(component.processingTimingDetails).toContain('Disambiguated sentences: 1 total');
    expect(component.processingTimingDetails).toContain('Proofs: 1 total');
  });

  it('drives progress from the live vampire_progress record, not from last_session results', () => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    dataServiceSpy.getVampireProgress.and.returnValue(of({
      sessionKey: 'k', runId: null, state: 'running', cancelRequested: false, activeItemId: 'n1',
      completedItemIds: ['n1'], changedItemIds: [], itemResults: {}, itemCount: 2, proofCount: 2,
      totalItemCount: 5,
    } as any));

    (component as any).startVampireProgressIndicator(5);
    expect(component.vampireProgressItemCount).toBe(0);

    (component as any).pollVampireProgress((component as any).vampireRunToken);

    expect(component.vampireProgressItemCount).toBe(2);
    expect(component.vampireProgressPercent).toBe(40);
    expect(dataServiceSpy.getVampireProgress).toHaveBeenCalled();
  });

  it('describes the completion message using the absolute processed count', () => {
    const message = (component as any).buildVampireCompletionDescription({ item_count: 5 });

    expect(message).toBe('Processed 5 items');
  });

  it('blocks autosave while an abort is in flight', () => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;

    component['sessionPersistenceEnabled'] = true;
    component['isHydratingSession'] = false;
    component['abortRequestInFlight'] = true;

    (component as any).scheduleSessionSave(true);

    expect(dataServiceSpy.saveRegressionSession).not.toHaveBeenCalled();
    expect(component['pendingAutosave']).toBeFalse();
  });

  it('allows abort while an autosave is in progress but not during manual saves', () => {
    component.loading = true;
    component['saveOperationInProgress'] = true;
    component['activeSaveAction'] = null;

    expect(component.canAbortRun).toBeTrue();

    component['activeSaveAction'] = 'current';

    expect(component.canAbortRun).toBeFalse();
  });

  it('keeps resend locked and saves the reloaded vampire state after abort finalization', () => {
    const cancelSubject = new Subject<any>();
    const sessionSubject = new Subject<any>();
    const summarySubject = new Subject<any>();
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    dataServiceSpy.requestVampireCancel.and.returnValue(cancelSubject.asObservable());
    dataServiceSpy.getLastSession.and.returnValue(sessionSubject.asObservable());
    dataServiceSpy.getLastSessionSummary.and.returnValue(summarySubject.asObservable());

    component.loading = true;
    component['activeVampireRunStartedAt'] = 123;
    component['vampireRunToken'] = 123;
    component['regressionTestItems'] = [{ id: 'item-1', premises: ['S1'], conclusion: ['S2'], gold_label: '0' }];
    component['sentenceMap'] = { S1: 'Premise', S2: 'Hypothesis' };
    component['regressionTestResults'] = [{ sentence_id: 'S1', sentence: 'Premise', noOfAppliedRules: 0, noOfMCsets: 0, noOfSolutions: 0, ligerGraph: null, ligerMCsets: '', allMCs: null, gswbSolutions: [], gswbDerivation: null, result_type: 'parseResult' } as any];
    component.session.lastGswbOutputs = { S1: { solutions: [], log: '', derivation: null, discriminants: [] } as any };
    component.session.lastAnnotations = { S1: { graph: null, appliedRules: [] } as any };
    component.session.lastVampireResults = { stale: [{ glyph: 'old', informative: false, consistent: false, relevant: false, proof_files: [] }] };
    component['sessionPersistenceEnabled'] = true;
    component['isHydratingSession'] = false;

    component.abortCurrentRun();

    expect(dataServiceSpy.requestVampireCancel).toHaveBeenCalledTimes(1);
    expect(component.loading).toBeTrue();
    expect(component['abortRequestInFlight']).toBeTrue();
    expect(component.canAbortRun).toBeFalse();
    expect(component.canResendVampire).toBeFalse();

    cancelSubject.next({});
    cancelSubject.complete();

    expect(dataServiceSpy.saveRegressionSession).not.toHaveBeenCalled();
    expect(component['abortRequestInFlight']).toBeTrue();
    expect(component.canResendVampire).toBeFalse();
    sessionSubject.next({ results: { 'item-1': [{ glyph: 'new', informative: true, consistent: true, relevant: true, proof_files: ['p1'] }] } });
    summarySubject.next({ item_count: 1, proof_count: 1 });
    sessionSubject.complete();
    summarySubject.complete();

    expect(dataServiceSpy.saveRegressionSession).toHaveBeenCalledTimes(1);
    // The payload is now the pre-serialized snapshot -- autosave stringifies once and
    // uses that string as both the fingerprint and the body.
    const [, payload] = dataServiceSpy.saveRegressionSession.calls.mostRecent().args;
    expect(typeof payload).toBe('string');
    const snapshot = JSON.parse(payload as string);
    expect(snapshot.analysis.save_state.lastVampireResults['item-1'][0].glyph).toBe('new');
    expect(component['abortRequestInFlight']).toBeFalse();
    expect(component.loading).toBeFalse();
    expect(component.canResendVampire).toBeTrue();
  });

  it('surfaces items that produced no verdict instead of silently dropping them from the count', () => {
    component.session.hasRunVampire = true;
    component['regressionTestItems'] = [
      { id: 'n0', premises: ['S0'], conclusion: ['S1'], gold_label: '1' },
      { id: 'n1', premises: ['S2'], conclusion: ['S3'], gold_label: '1' },
    ];
    component['sentenceMap'] = { S0: 'Premise zero.', S1: 'Hypothesis zero.', S2: 'Premise one.', S3: 'Hypothesis one.' };
    // One document per item, each holding only its own reasoning update.
    component.session.analysisDocuments = {
      n0: {
        ...createRegressionAnalysisDocument('n0'),
        reasoningUpdates: [{
          id: 'ru-n0', premiseElementIds: ['S0'], hypothesisElementIds: ['S1'], itemId: 'n0',
          logicType: 'fof', ruleString: '', pruned: false, assignments: [{
            id: 'a1', premiseSemanticIds: [], hypothesisSemanticIds: [], checks: {} as any,
            verdict: { consistent: true, informative: false, relevant: false, glyph: '', computedAt: '' },
          }],
        } as any],
      },
      n1: {
        ...createRegressionAnalysisDocument('n1'),
        reasoningUpdates: [{
          id: 'ru-n1', premiseElementIds: ['S2'], hypothesisElementIds: ['S3'], itemId: 'n1',
          logicType: 'fof', ruleString: '', pruned: false, assignments: [],
          failure: 'pxq-n1-1-1: Http failure response for http://localhost:8081/merge_sequence_semantics: 500 OK',
        } as any],
      },
    };

    const failed = component.failedInferenceItems;

    expect(failed.length).toBe(1);
    expect(failed[0].id).toBe('n1');
    expect(failed[0].sentences).toBe('Premise one. / Hypothesis one.');
    expect(failed[0].reason).toContain('merge_sequence_semantics');
  });

  it('treats a zero item_count after a non-empty submission as a failed run, keeping prior results', () => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    dataServiceSpy.getLastSession.and.returnValue(of({ results: {} }));
    dataServiceSpy.getLastSessionSummary.and.returnValue(of({ item_count: 0, proof_count: 0 }));
    const displaySpy = spyOn(component, 'displayMessage');

    component.loading = true;
    component['vampireRunToken'] = 7;
    component['vampireCurrentRunItemCount'] = 3;
    component.session.lastVampireResults = {
      'item-1': [{ glyph: 'old', informative: true, consistent: true, relevant: true, proof_files: ['p1'] }],
    };
    component['inferenceResults'] = [{ id: 'item-1' } as any];

    (component as any).loadAndRenderVampireState(true, Date.now(), 7);

    expect(component.session.lastVampireResults['item-1'][0].glyph).toBe('old');
    expect(component.inferenceResults).toEqual([{ id: 'item-1' } as any]);
    expect(component.loading).toBeFalse();
    expect(displaySpy).toHaveBeenCalledWith(jasmine.stringMatching(/failed/i), 'red');
  });

  describe('per-item documents (one document is one discourse)', () => {
    /** Documents are no longer seeded from the batch parse -- an item's document holds
     *  the readings that item's chain actually used, exactly as chat's does. Registering
     *  both put the same semId under two syntax ids and broke SYNSEM_MAPPING. */
    it('gives each item its own document, created on demand by the chain', () => {
      component.session.analysisDocuments = {};
      const n0 = (component as any).documentFor('n0');
      const n1 = (component as any).documentFor('n1');

      expect(Object.keys(component.session.analysisDocuments).sort()).toEqual(['n0', 'n1']);
      expect(n0).not.toBe(n1);
      expect(n0.sentences).toEqual([]);
    });

    /** The reason per-item documents exist: the same sentence may be disambiguated
     *  differently in different items, and one object cannot hold two selections. */
    it('keeps a sentence registered into two items as two independent objects', () => {
      component.session.analysisDocuments = {};
      const n0 = (component as any).documentFor('n0');
      const n1 = (component as any).documentFor('n1');
      const sentence = () => ({
        id: 'S1', text: 'Shared.',
        syntax: [{ synId: 'S0', structure: {} as any, graph: { graphElements: [] } }],
        semantics: [{ syntacticOrigin: 'S0', semId: 'S1-s0', semString: 'P', semType: 'lfgxdrt' as const }],
        synSemMapping: { S0: ['S1-s0'] },
      });

      component['documentBuilder'].upsertSentenceAnalyses(n0, [sentence()]);
      component['documentBuilder'].upsertSentenceAnalyses(n1, [sentence()]);

      const inN0 = n0.sentences.find((x: any) => x.id === 'S1')!;
      const inN1 = n1.sentences.find((x: any) => x.id === 'S1')!;
      expect(inN0).not.toBe(inN1);

      inN0.selectedSemanticIds = ['S1-s0'];
      inN1.selectedSemanticIds = [];
      expect(inN0.selectedSemanticIds).toEqual(['S1-s0']);
      expect(inN1.selectedSemanticIds).toEqual([]);
    });

    /** The invariant the whole joint id rests on: a semantic belongs to exactly one
     *  syntax, and the mapping says which. */
    it('keeps synSemMapping a disjoint partition agreeing with each reading\'s origin', () => {
      component.session.analysisDocuments = {};
      const document = (component as any).documentFor('n0');
      component['documentBuilder'].upsertSentenceAnalyses(document, [{
        id: 'S1', text: 'Ambiguous.',
        syntax: [
          { synId: 'S0', structure: {} as any, graph: { graphElements: [] } },
          { synId: 'S1', structure: {} as any, graph: { graphElements: [] } },
        ],
        semantics: [
          { syntacticOrigin: 'S0', semId: 'S1-s0', semString: 'P', semType: 'lfgxdrt' as const },
          { syntacticOrigin: 'S1', semId: 'S1-s1', semString: 'Q', semType: 'lfgxdrt' as const },
        ],
        synSemMapping: { S0: ['S1-s0'], S1: ['S1-s1'] },
      }]);

      const sentence = document.sentences[0];
      const mapped = Object.values(sentence.synSemMapping).flat() as string[];
      expect(mapped.length).toBe(new Set(mapped).size);
      sentence.semantics.forEach((semantic: any) => {
        expect(sentence.synSemMapping[semantic.syntacticOrigin]).toContain(semantic.semId);
      });
    });
  });

  describe('autosave cost', () => {
    /** A saved session is routinely 8-12 MB. Measured on `first-test`: `sentenceAnalysis`
     *  1.93 MB and `structureVariants` 1.19 MB of an 11 MB payload -- the first re-wraps
     *  the structure the solution already carries, the second is not read anywhere in the
     *  client. A quarter of every autosave, for nothing. */
    it('does not persist the parse fields nothing reads back', () => {
      component.session.lastAnnotations = {
        S0: {
          sentence: 'a sentence',
          solutions: [{
            solutionKey: 'S0',
            meaningConstructors: 'mc',
            structureJson: { id: 'keep-me' },
            graph: { graphElements: [] },
            sentenceAnalysis: { id: 'sentence-1', syntax: [], semantics: [] },
            structureVariants: [{ id: 'drop-me' }, { id: 'drop-me-too' }],
          }],
        },
      } as any;

      const stored: any = (component as any).buildSessionSnapshot();
      const solution = stored.analysis.save_state.lastAnnotations.S0.solutions[0];

      expect(solution.structureJson).toEqual({ id: 'keep-me' } as any);
      expect(solution.meaningConstructors).toBe('mc');
      expect(solution.sentenceAnalysis).toBeUndefined();
      expect(solution.structureVariants).toBeUndefined();

      // The in-memory session keeps them -- live proof-input building uses
      // sentenceAnalysis off the fresh response.
      expect(component.session.lastAnnotations!['S0'].solutions[0].sentenceAnalysis).toBeTruthy();
    });

    it('serializes the snapshot once, and the fingerprint IS the request body', () => {
      const snapshot = (component as any).buildSessionSnapshot();
      const serialized = (component as any).serializeSessionSnapshot(snapshot);

      expect(typeof serialized).toBe('string');
      expect((component as any).buildSessionFingerprint(snapshot)).toBe(serialized);
      // updatedAt is excluded so the fingerprint is stable across snapshots of unchanged
      // state -- otherwise every autosave would see a change and re-save forever.
      expect(serialized).not.toContain('"updatedAt"');
      expect(JSON.parse(serialized).metadata.createdAt).toBeDefined();
    });
  });

  describe('the (syn, sem, prag) chain in an item document', () => {
    /** The batch parse used to be registered into every item document alongside the
     *  chain's own readings. GSWB mints reading ids as `sentenceId-sN` for both the batch
     *  deduce and the sequence-scoped one, so the same semId existed twice under different
     *  syntax ids, upsertSentenceAnalyses unioned the mappings, and (syn_id, sem_id)
     *  stopped being recoverable. */
    it('leaves item documents empty for the chain to fill, rather than seeding them from the batch parse', () => {
      component['regressionTestItems'] = [{ id: 'n0', premises: ['S0'], conclusion: ['S1'] }];
      component['sentenceMap'] = { S0: 'One.', S1: 'Two.' };
      component.session.analysisDocuments = { stale: {} as any };

      (component as any).resetAnalysisDocuments();

      expect(component.session.analysisDocuments).toEqual({});
    });

    it('records one DiscourseAnalysis per PCDRS branch, linked to the reading it annotates', () => {
      const document: any = createRegressionAnalysisDocument('doc');
      document.sequences = [{ id: 'S0+S1', text: '', sentenceIds: ['S0', 'S1'], syntax: [], semantics: [], synSemMapping: {} }];
      const build: any = { itemId: 'n0', updateId: 'ru-n0', premiseSentenceIds: ['S0'], hypothesisSentenceIds: ['S1'] };
      const branches: any = [
        { merged: { semanticAnalysis: { semId: 'sem-a' } } },
        { merged: { semanticAnalysis: { semId: 'sem-b' } } },
      ];
      const assignment = (mappingId: string, relations: any[]) => ({
        mappingId,
        ruleBranchIndex: 1,
        baseStructureId: 'base-1', baseStructure: { id: 'base' }, baseGraph: { graphElements: [] },
        structureId: 'branch-1', mergedStructure: { id: 'merged' }, mergedGraph: { graphElements: [] },
        mapping: { id: mappingId, semantic: 'drs', graph: { id: 'g' }, anaphoraRelations: relations },
      });
      const prepared: any = [
        { scopeId: 'p1', assignments: [assignment('pcdrs-a', [{ pronoun: 'x2', antecedent: 'x1' }])], failures: [], degradations: [] },
        { scopeId: 'p2', assignments: [assignment('pcdrs-b', [])], failures: [], degradations: [] },
      ];

      (component as any).registerDiscourseUpdate(document, build, branches, prepared);

      const update = document.discourseUpdates[0];
      expect(update.id).toBe('du-S0+S1');
      expect(update.sourceElementId).toBe('S0+S1');
      expect(update.discourse.map((d: any) => d.id)).toEqual(['pcdrs-a', 'pcdrs-b']);
      // Each branch points at the merged reading it annotates -- this is the sem -> prag
      // half of the joint id.
      expect(update.semDiscourseMapping).toEqual({ 'sem-a': ['pcdrs-a'], 'sem-b': ['pcdrs-b'] });
      // A branch that bound nothing is still recorded: "post-processing ran and bound
      // nothing" is a different fact from "post-processing never ran".
      expect(update.discourse[0].collapsed).toBeTrue();
      expect(update.discourse[1].collapsed).toBeFalse();
      expect(update.discourse[1].anaphoraMapping.relations).toEqual([]);
      expect(Object.keys(update.structures).sort()).toEqual(['base-1', 'branch-1']);
    });

    it('writes nothing when the item has no registered sequence to hang it off', () => {
      const document: any = createRegressionAnalysisDocument('doc');
      const build: any = { itemId: 'n0', updateId: 'ru-n0', premiseSentenceIds: ['S0'], hypothesisSentenceIds: ['S1'] };
      (component as any).registerDiscourseUpdate(document, build, [], []);
      expect(document.discourseUpdates).toEqual([]);
    });
  });

  describe('a run that dies server-side', () => {
    /** The run died with a 500 at 06:58 and the progress record kept its last "running"
     *  snapshot; the client polled it for 43 minutes. A crash presented as a run that had
     *  merely stopped progressing, with the real cause only in the service log. */
    it('stops polling and reports the reason when progress says failed', () => {
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      dataServiceSpy.getVampireProgress.and.returnValue(of({
        sessionKey: 'k', runId: null, state: 'failed', cancelRequested: false,
        activeItemId: null, completedItemIds: ['n0', 'n1'], changedItemIds: [],
        itemResults: { n0: 2, n1: 2 }, itemCount: 2, proofCount: 4, totalItemCount: 5,
        failure: 'socket.timeout talking to the session store',
      } as any));
      (component as any).activeVampireRunStartedAt = Date.now();
      component.loading = true;
      (component as any).startVampireProgressIndicator(5, 20);
      const stopSpy = spyOn(component as any, 'stopVampireSummaryPolling').and.callThrough();

      (component as any).pollVampireProgress((component as any).vampireRunToken);

      expect(stopSpy).toHaveBeenCalled();
      expect(component.loading).toBeFalse();
      expect((component as any).activeVampireRunStartedAt).toBeNull();
      expect(component.sessionLoadDetails).toContain('socket.timeout');
    });

    it('keeps polling while the run is still running', () => {
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      dataServiceSpy.getVampireProgress.and.returnValue(of({
        sessionKey: 'k', runId: null, state: 'running', cancelRequested: false,
        activeItemId: 'n2', completedItemIds: ['n0', 'n1'], changedItemIds: [],
        itemResults: { n0: 2, n1: 2 }, itemCount: 2, proofCount: 4, totalItemCount: 5,
      } as any));
      (component as any).activeVampireRunStartedAt = Date.now();
      component.loading = true;
      (component as any).startVampireProgressIndicator(5, 20);

      (component as any).pollVampireProgress((component as any).vampireRunToken);

      expect(component.loading).toBeTrue();
      expect(component.vampireProgressProofCount).toBe(4);
    });
  });
});
