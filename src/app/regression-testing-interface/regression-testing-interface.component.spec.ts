import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { EMPTY, Subject, of, throwError } from 'rxjs';

import { RegressionTestingInterfaceComponent } from './regression-testing-interface.component';
import { DataService } from '../data.service';
import { ReasoningPipelineService } from '../reasoning/reasoning-pipeline.service';
import {
  createRegressionAnalysisDocument,
  createRegressionTestingSession,
} from '../models/models';
import { discourseBranchesForDisplay, reasoningAssignmentId } from '../analysis-model';
import { LigerFileSource } from '../liger-workspace/liger-file-source.service';
import { LigerWorkspaceService } from '../liger-workspace/liger-workspace.service';
import { FILES, RULE_SET, TREE, fileSourceSpy } from '../liger-workspace/liger-workspace.testing';
import { ALL_READINGS } from '../reading-order';

/** A derived reading as GSWB sends it: everything about the reading in semanticAnalysis.
 *  `solution` is its SVG in LFGxDRT mode, its text in prolog-drt mode. */
const derived = ({ solution, semantic, graph, ...rest }: any, semType: 'lfgxdrt' | 'prolog-drt' = 'lfgxdrt'): any => ({
  ...rest,
  semanticAnalysis: {
    syntacticOrigin: rest.solutionKey ?? 'syn', semId: rest.id, semString: semantic, graph, semType,
    ...(semType === 'lfgxdrt' ? { svg: solution } : { prologRender: solution }),
  },
});

describe('RegressionTestingInterfaceComponent', () => {
  let component: RegressionTestingInterfaceComponent;
  let fixture: ComponentFixture<RegressionTestingInterfaceComponent>;
  let reasoningPipeline: jasmine.SpyObj<ReasoningPipelineService>;
  let ligerFiles: jasmine.SpyObj<LigerFileSource>;

  beforeEach(() => {
    ligerFiles = fileSourceSpy();
    const dataServiceSpy = jasmine.createSpyObj('DataService', [
      'loadRules',
      'ligerSequence',
      'gswbDeduce',
      'gswbBatchDeduce',
      'gswbMergeSequenceSemantics',
      'listRegressionSessions',
      'loadRegressionSession',
      'saveRegressionSession',
      'patchRegressionSession',
      'deleteRegressionSession',
      'deleteRegressionSessions',
      'holdSessionLease',
      'releaseSessionLease',
      'sessionLeaseReleaseUrl',
      'requestVampireCancel',
      'getLastSession',
      'getLastSessionSummary',
      'getLastGswbSession',
      'getLastGswbSessionSummary',
      'gswbReasoningChecks',
      'getVampireProgress',
      'clearVampireProgress',
      'callBatchVampire'
    ]);
    dataServiceSpy.loadRules.and.returnValue(of({
      kind: 'config', source: './liger_resources/rules/default.liger.yaml',
      semantics: 'semantics from file', pragmatics: 'pragmatics from file', lexica: [],
      axioms: null,
    }));
    dataServiceSpy.clearVampireProgress.and.returnValue(of({} as any));
    dataServiceSpy.callBatchVampire.and.returnValue(of({ status: 'ok' } as any));
    dataServiceSpy.listRegressionSessions.and.returnValue(of([]));
    dataServiceSpy.loadRegressionSession.and.returnValue(of({} as any));
    dataServiceSpy.saveRegressionSession.and.returnValue(of({} as any));
    dataServiceSpy.patchRegressionSession.and.returnValue(of({} as any));
    dataServiceSpy.deleteRegressionSession.and.returnValue(of({} as any));
    dataServiceSpy.deleteRegressionSessions.and.returnValue(of({ status: 'ok', deleted: [] } as any));
    dataServiceSpy.holdSessionLease.and.returnValue(of({}));
    dataServiceSpy.releaseSessionLease.and.returnValue(of({}));
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
      return of({ solutions: [derived({
        id: `seq-${index + 1}`, sourceIndex: (index + 1) * 10,
        semantic: ['A', 'B', 'C'][index] ?? 'X', graph: { constraints: [] },
      })] } as any);
    });
    dataServiceSpy.gswbMergeSequenceSemantics.and.returnValue(
      of(derived({ id: 'sem-1+sem-2', semantic: 'P + Q', graph: { constraints: [] } })));

    reasoningPipeline = jasmine.createSpyObj<ReasoningPipelineService>('ReasoningPipelineService',
      ['prepareReasoningChecks', 'prepareReasoningChecksSequentially', 'generateDiscourseMappings', 'prepareStoredReadingChecks']);
    reasoningPipeline.prepareReasoningChecks.and.returnValue(
      of({ scopeId: 'pxq-n1-1-1', assignments: [], failures: [], degradations: [] }));
    // One PCDRS reading per merged reading, named under the request's scope as GSWB names it.
    reasoningPipeline.generateDiscourseMappings.and.callFake((request: any) => of([{
      mapping: { id: `${request.scopeId}-rule-1-pcdrs-1`, semantic: `${request.merged.semString} ok`, anaphoraRelations: [] },
      ruleBranchIndex: 1, semanticOrigin: request.merged.semId,
    }]));
    reasoningPipeline.prepareStoredReadingChecks.and.callFake((request: any) =>
      of({ scopeId: request.scopeId, assignments: [], failures: [], degradations: [] }));

    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [RegressionTestingInterfaceComponent],
      providers: [
        { provide: DataService, useValue: dataServiceSpy },
        { provide: ReasoningPipelineService, useValue: reasoningPipeline },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: LigerFileSource, useValue: ligerFiles },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA]
    });
    fixture = TestBed.createComponent(RegressionTestingInterfaceComponent);
    component = fixture.componentInstance;
    component['testfile'] = { getContent: () => '', updateContent: () => {} } as any;
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
    component.session.pragmaticsRulesText = 'pragmatics rules';
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
      derived({ id: 'sol-1', solution: 'first' }, 'prolog-drt'),
      derived({ id: 'sol-2', solution: 'second' }, 'prolog-drt'),
    ]), true);

    expect(result).toEqual(['second']);
  });

  it('uses the LFGxDRT semantic field when preparing reasoning input', () => {
    component.session.gswbPreferences.outputstyle = 5;

    const result = selectedTexts(outputsFor([derived({
      id: 'sol-1',
      solution: '<svg>rendered</svg>',
      semantic: '([x],[dog(x)])',
      graph: { constraints: [] },
    })]), false);

    expect(result).toEqual(['([x],[dog(x)])']);
  });

  it('does not fall back to all solutions in disambiguated mode when no selection exists', () => {
    component.session.selectedSolutionIdsBySentence = {};

    const result = selectedTexts(outputsFor([
      derived({ id: 'sol-1', solution: 'first' }, 'prolog-drt'),
      derived({ id: 'sol-2', solution: 'second' }, 'prolog-drt'),
    ]), true);

    expect(result).toEqual([]);
  });

  it('selects readings once, so text and semantic graph cannot come apart', () => {
    // A reading with no graph cannot be a premise AST. It used to be filtered out of the
    // graph list only, leaving the text list one entry longer -- and the two were then
    // indexed against each other, so every later reading was paired with the wrong graph.
    component.session.gswbPreferences.outputstyle = 5;

    const selected = (component as any).selectedSolutions('S1', outputsFor([
      derived({ id: 'sol-1', solution: 'a', semantic: '([x],[dog(x)])' }),
      derived({ id: 'sol-2', solution: 'b', semantic: '([y],[cat(y)])', graph: { constraints: [] } }),
    ]), false);

    expect(selected.map((solution: any) => solution.id)).toEqual(['sol-2']);
    expect(selected.every((solution: any) => !!solution.semanticAnalysis.graph)).toBeTrue();
  });

  it('keeps graphless readings when the run is not an LFGxDRT one', () => {
    component.session.gswbPreferences.outputstyle = 1;

    const selected = (component as any).selectedSolutions('S1', outputsFor([
      derived({ id: 'sol-1', solution: 'a' }, 'prolog-drt'),
    ]), false);

    expect(selected.map((solution: any) => solution.id)).toEqual(['sol-1']);
  });

  /** One NLI item build: two premises, one hypothesis -- the shape buildItemDiscourse chains
   *  over (append S2 to seed S1, then S3 as the hypothesis). */
  const itemBuild = () => ({
    itemId: 'n1', updateId: 'ru-n1',
    premiseSentenceIds: ['S1', 'S2'], hypothesisSentenceIds: ['S3'],
  }) as any;

  /** Every sentence parsed and derived on its own in the batch (one analysis each, keyed
   *  B1..B3, with `mcs` meaning constructors), and LiGER/GSWB as appendSentence calls them:
   *  a sequence over the supplied structures (analyses numbered S0.. per call, each part
   *  offset by the earlier parts' constructors) and a merge naming its syntax by the
   *  request's solutionKey. */
  const mockChainEndpoints = (dataServiceSpy: jasmine.SpyObj<DataService>, batchStructures = true) => {
    component.session.gswbPreferences.outputstyle = 5;
    component.sentenceMap = { S1: 'one', S2: 'two', S3: 'three' };
    const mcs: Record<string, number> = { S1: 5, S2: 3, S3: 4 };
    const batchAnnotation = (sid: string, key: string) => ({
      sentence: sid,
      solutions: [{ solutionKey: key, graph: null, meaningConstructors: `mc-${sid}`,
                    ...(batchStructures ? { structureJson: { id: `st-${sid}`, mcs: mcs[sid] } } : {}) }],
    });
    component.session.lastAnnotations = {
      S1: batchAnnotation('S1', 'B1'), S2: batchAnnotation('S2', 'B2'), S3: batchAnnotation('S3', 'B3'),
    } as any;
    const own = (sid: string, key: string, semantic: string) => ({
      solutions: [derived({ id: `${sid}-sol-1`, solutionKey: key, solution: 'x', semantic, graph: { id: `${sid}-graph` } })],
      log: '', derivation: null, discriminants: [],
    });
    component.session.lastGswbOutputs = {
      S1: own('S1', 'B1', 'A'), S2: own('S2', 'B2', 'B'), S3: own('S3', 'B3', 'C'),
    } as any;

    dataServiceSpy.ligerSequence.and.callFake((request: any) => {
      let counter = 0;
      let offset = 0;
      const sequenceParts = (request.parsedSentences as any[][]).map((structures, sourceIndex) => {
        const part = { sourceIndex, sentenceId: request.sentenceIds[sourceIndex], syntaxVariantId: `S${counter}`,
          sourceIndexOffset: offset };
        counter += structures.length;
        offset += structures[0].mcs;
        return part;
      });
      return of({ solutions: [{
        solutionKey: `sequence-1-${request.sentenceIds.join('+')}`,
        structureJson: { id: `merged-${request.sentenceIds.join('+')}` },
        sequenceParts,
        sequenceAnalysis: { id: 'x', text: 'x', sentences: [], syntax: [{ synId: 'x', structure: {}, graph: { graphElements: [] } }] },
      }] } as any);
    });
    dataServiceSpy.gswbMergeSequenceSemantics.and.callFake((request: any) => {
      const combined = request.parts.map((part: any) => part.semantic).join(' + ');
      return of({
        id: `merged-${combined}`,
        semanticAnalysis: {
          // As GSWB: the positional composite of the parts' semIds.
          syntacticOrigin: request.solutionKey, semId: request.parts.map((part: any) => part.id).join('+'),
          semString: combined, graph: { id: 'merged-graph' }, semType: 'lfgxdrt',
        },
      } as any);
    });
  };

  it('derives nothing and parses nothing again: every append supplies the batch structures', done => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);

    (component as any).buildItemDiscourse(itemBuild(), component.session.lastGswbOutputs)
      .subscribe(() => {
        expect(dataServiceSpy.gswbDeduce).not.toHaveBeenCalled();
        const calls = dataServiceSpy.ligerSequence.calls.all().map(call => call.args[0] as any);
        expect(calls.map(call => call.sentenceIds.join(','))).toEqual(['S1,S2', 'S1,S2,S3']);
        expect(calls[0].parsedSentences.map((group: any[]) => group[0].id)).toEqual(['st-S1', 'st-S2']);
        expect(calls[1].parsedSentences.map((group: any[]) => group[0].id)).toEqual(['st-S1', 'st-S2', 'st-S3']);
        const document = component.session.analysisDocuments['n1'];
        expect(document.sentences.map(sentence => sentence.syntax.map(syntax => syntax.synId))).toEqual([['B1'], ['B2'], ['B3']]);
        done();
      });
  });

  it('merges each later sentence\'s own batch reading moved by its part offset', done => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);

    (component as any).buildItemDiscourse(itemBuild(), component.session.lastGswbOutputs)
      .subscribe(() => {
        const merges = dataServiceSpy.gswbMergeSequenceSemantics.calls.allArgs().map(([request]: any[]) => request);
        expect(merges.map(request => request.parts[1].id)).toEqual(['S2-sol-1', 'S3-sol-1']);
        expect(merges.map(request => request.parts[1].sourceIndexOffset)).toEqual([5, 8]);
        expect(merges.map(request => request.solutionKey)).toEqual(['B1+B2', 'B1+B2+B3']);
        const request = reasoningPipeline.generateDiscourseMappings.calls.mostRecent().args[0];
        expect((request.sequenceStructure as any).id).toBe('merged-S1+S2+S3');
        expect(request.merged.semString).toBe('A + B + C');
        // The loaded rule set's post-processing rules, not a client-side default.
        expect(request.ruleString).toBe('pragmatics rules');
        done();
      });
  });

  it('stores the premises sequence, the item sequence and every reading of its discourse at step 1', done => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);
    // Step 1 ignores the discriminants: they narrow at step 2.
    component.session.selectedSolutionIdsBySentence = { S1: [], S2: [], S3: [] };

    (component as any).buildItemDiscourse(itemBuild(), component.session.lastGswbOutputs)
      .subscribe(() => {
        const document = component.session.analysisDocuments['n1'];
        expect(document.sequences.map(sequence => [sequence.id, sequence.semantics.map(semantic => semantic.semId)]))
          .toEqual([['S1+S2', ['S1-sol-1+S2-sol-1']], ['S1+S2+S3', ['S1-sol-1+S2-sol-1+S3-sol-1']]]);
        const update = document.discourseUpdates![0];
        expect(update.id).toBe('du-S1+S2+S3');
        expect(update.discourse.map(reading => [reading.id, reading.semanticOrigin]))
          .toEqual([['pxq-n1-1-rule-1-pcdrs-1', 'S1-sol-1+S2-sol-1+S3-sol-1']]);
        expect(reasoningPipeline.prepareStoredReadingChecks).not.toHaveBeenCalled();
        done();
      });
  });

  it('reasons over the stored readings: check ASTs, prior and ids read from the document', done => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);
    const outputs = component.session.lastGswbOutputs;

    (component as any).buildItemDiscourse(itemBuild(), outputs).subscribe(() => {
      dataServiceSpy.ligerSequence.calls.reset();
      dataServiceSpy.gswbMergeSequenceSemantics.calls.reset();
      reasoningPipeline.generateDiscourseMappings.calls.reset();
      (component as any).reasonOverItem(itemBuild(), outputs, false, false, false).subscribe((pair: any) => {
        // Nothing is merged or generated again.
        expect(dataServiceSpy.ligerSequence).not.toHaveBeenCalled();
        expect(dataServiceSpy.gswbMergeSequenceSemantics).not.toHaveBeenCalled();
        expect(reasoningPipeline.generateDiscourseMappings).not.toHaveBeenCalled();
        expect((component as any).runDiscoursesBuilt).toBe(0);
        const request = reasoningPipeline.prepareStoredReadingChecks.calls.mostRecent().args[0];
        expect(request.premiseAsts as any).toEqual([{ id: 'S1-graph' }, { id: 'S2-graph' }]);
        expect(request.hypothesisAsts as any).toEqual([{ id: 'S3-graph' }]);
        // The prior is the merged premises alone -- the conclusion must not appear in the
        // axiom the four checks are tested against.
        expect(request.premiseSemantic).toBe('A + B');
        expect(request.readings.map(reading => [reading.id, reading.drsString]))
          .toEqual([['pxq-n1-1-rule-1-pcdrs-1', 'A + B + C ok']]);
        expect(request.scope).toEqual({
          updateId: 'ru-n1', premiseSemanticIds: ['S1-sol-1', 'S2-sol-1'], hypothesisSemanticIds: ['S3-sol-1'],
        });
        expect(pair.failures).toEqual([]);
        done();
      });
    });
  });

  it('stores each sentence\'s discriminants in the item document, for the surface ordering', done => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);
    const scoping = [{ id: 'sc0', type: 'scope', surfaceAligned: true, associatedSolutions: ['S2-sol-1'] }];
    (component.session.lastGswbOutputs as any).S2.discriminants = scoping;

    (component as any).buildItemDiscourse(itemBuild(), component.session.lastGswbOutputs).subscribe(() => {
      const sentences = component.session.analysisDocuments['n1'].sentences;
      expect(sentences.map(sentence => sentence.discriminants)).toEqual([[], scoping as any, []]);
      done();
    });
  });

  it('builds the discourse first for an item that has none stored, and counts it', done => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);

    (component as any).reasonOverItem(itemBuild(), component.session.lastGswbOutputs, false, false, false)
      .subscribe((pair: any) => {
        expect(reasoningPipeline.generateDiscourseMappings).toHaveBeenCalledTimes(1);
        expect(reasoningPipeline.prepareStoredReadingChecks).toHaveBeenCalledTimes(1);
        expect((component as any).runDiscoursesBuilt).toBe(1);
        expect(pair.failures).toEqual([]);
        done();
      });
  });

  it('narrows the stored readings by the discriminant selection at step 2', done => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);
    component.session.selectedSolutionIdsBySentence = { S1: ['S1-sol-1'], S2: ['S2-sol-1'], S3: [] };

    (component as any).reasonOverItem(itemBuild(), component.session.lastGswbOutputs, true, false, false)
      .subscribe((pair: any) => {
        expect(component.session.analysisDocuments['n1'].discourseUpdates![0].discourse.length).toBe(1);
        expect(reasoningPipeline.prepareStoredReadingChecks).not.toHaveBeenCalled();
        expect(pair.assignments).toEqual([]);
        done();
      });
  });

  it('fails the item, saying why, when the batch parse has no structure for a reading', done => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy, false);

    (component as any).reasonOverItem(itemBuild(), component.session.lastGswbOutputs, false, false, false)
      .subscribe((pair: any) => {
        expect(dataServiceSpy.ligerSequence).not.toHaveBeenCalled();
        expect(pair.failures.length).toBe(1);
        expect(pair.failures[0]).toContain('no structure');
        done();
      });
  });

  it('reports an item that could not be prepared instead of aborting the batch', done => {
    // Every pair of every item used to live in one forkJoin under a single error handler,
    // so one unpreparable item killed the whole run.
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);
    reasoningPipeline.prepareStoredReadingChecks.and.returnValue(
      throwError(() => new Error('no post-processed sequence interpretations')));

    (component as any).reasonOverItem(itemBuild(), component.session.lastGswbOutputs, false, false, false)
      .subscribe((pair: any) => {
        expect(pair.itemId).toBe('n1');
        expect(pair.assignments).toEqual([]);
        expect(pair.failures.length).toBe(1);
        expect(pair.failures[0]).toContain('no post-processed sequence interpretations');
        done();
      });
  });

  it('builds at Parse only the discourses that are not stored', done => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);
    component['regressionTestItems'] = [{ id: 'n1', premises: ['S1', 'S2'], conclusion: ['S3'] }];

    (component as any).buildParsedDiscourses({ phases: [] }).subscribe(() => {
      reasoningPipeline.generateDiscourseMappings.calls.reset();
      (component as any).buildParsedDiscourses({ phases: [] }).subscribe((note: string) => {
        expect(reasoningPipeline.generateDiscourseMappings).not.toHaveBeenCalled();
        expect(note).toBe(' Kept 1 item(s) the parse did not touch.');
        done();
      });
    });
  });

  it('builds every parsed item\'s discourse at Parse, and says how many', done => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);
    component['regressionTestItems'] = [
      { id: 'n1', premises: ['S1', 'S2'], conclusion: ['S3'] },
      { id: 'n2', premises: ['S1'], conclusion: ['S4'] },
    ];
    const parseReport: any = { phases: [] };

    (component as any).buildParsedDiscourses(parseReport).subscribe((note: string) => {
      expect(Object.keys(component.session.analysisDocuments)).toEqual(['n1']);
      expect(note).toBe(' Built 1 of 1 discourse(s).');
      expect(parseReport.phases.map((phase: any) => phase.name)).toEqual(['Discourses (rules, PCDRS)']);
      done();
    });
  });

  describe('a session parsed when discourse items were derived in sequence', () => {
    beforeEach(() => {
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      mockChainEndpoints(dataServiceSpy);
      const outputs = component.session.lastGswbOutputs as any;
      outputs.S2 = { ...outputs.S2, derivedInSequence: { itemId: 'n1', sentenceIndex: 1 } };
      outputs.S3 = { ...outputs.S3, derivedInSequence: { itemId: 'n1', sentenceIndex: 2 } };
      component.session.selectedSolutionIdsBySentence = { S1: ['S1-sol-1'], S2: ['S2-sol-1'] };
      (dataServiceSpy as any).gswbBatchDeduce.and.callFake((request: any) => of({
        outputs: Object.fromEntries(Object.keys(request.items).map(id => [id, {
          solutions: [derived({ id: `${id}-own`, solutionKey: `B${id.slice(1)}`, semantic: id, graph: { id: `${id}-own-graph` } })],
          log: '', derivation: null, discriminants: [],
        }])),
        report: '',
      }));
    });

    it('derives those sentences again on their own from the stored parse, once, and resets their disambiguation', () => {
      const dataServiceSpy = TestBed.inject(DataService) as any;
      let migrated: string[] = [];
      (component as any).rederiveInSequenceOutputs().subscribe((ids: string[]) => migrated = ids);

      expect(migrated).toEqual(['S2', 'S3']);
      expect(dataServiceSpy.gswbBatchDeduce).toHaveBeenCalledTimes(1);
      const request = dataServiceSpy.gswbBatchDeduce.calls.mostRecent().args[0];
      expect(Object.keys(request.items)).toEqual(['S2', 'S3']);
      expect(request.items.S2.proofs.map((proof: any) => [proof.proofId, proof.sentenceId])).toEqual([['B2', 'S2']]);
      const outputs = component.session.lastGswbOutputs as any;
      expect(outputs.S2.solutions[0].id).toBe('S2-own');
      expect(outputs.S2.derivedInSequence).toBeUndefined();
      expect(outputs.S1.solutions[0].id).toBe('S1-sol-1');
      expect(component.session.selectedSolutionIdsBySentence['S1']).toEqual(['S1-sol-1']);
      expect(component.session.selectedSolutionIdsBySentence['S2']).toEqual(['S2-own']);
    });
  });

  it('fails the item outright when a sentence cannot be folded into any branch', done => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    mockChainEndpoints(dataServiceSpy);
    dataServiceSpy.ligerSequence.and.returnValue(of({ solutions: [] } as any));

    (component as any).reasonOverItem(itemBuild(), component.session.lastGswbOutputs, false, false, false)
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

  it('shows the run report in the pill, and nothing before a run', () => {
    expect(component.hasTimingInfo).toBeFalse();
    component.session.report = {
      parse: {
        startedAt: new Date().toISOString(), finishedAt: null, durationMs: null, phases: [],
        parsing: null, composition: null,
        sentences: { total: 0, successful: 0, failedIds: [] }, items: { total: 0, discourse: 0 },
      },
      inference: null,
    };

    expect(component.hasTimingInfo).toBeTrue();
    expect(component.processingTimingSummary).toBe('Parsing…');
  });

  it('counts disambiguated sentences when selected solutions differ from all solutions', () => {
    component.session.lastGswbOutputs = {
      S1: { solutions: [derived({ id: 'a', solution: 'a' }, 'prolog-drt'), derived({ id: 'b', solution: 'b' }, 'prolog-drt')], log: '', derivation: null, discriminants: [] },
      S2: { solutions: [derived({ id: 'c', solution: 'c' }, 'prolog-drt')], log: '', derivation: null, discriminants: [] },
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

  it('counts the reasoning branches of a finished run from its results, not the last progress poll', () => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    dataServiceSpy.getVampireProgress.and.returnValue(of({ itemTimingsMs: { I1: 5 } } as any));
    component.session.report = {
      parse: null,
      inference: {
        startedAt: new Date().toISOString(), finishedAt: null, durationMs: null, phases: [],
        runKind: 'initial', itemsInRun: 2, selected: false, preparation: null, vampire: null,
        results: { total: 0, correct: 0, wrong: 0, notParsed: 0, noVerdict: 0 }, proofs: 0,
      },
    };
    component.session.lastVampireResults = {
      I1: [{ proof_files: ['a', 'b'] }, { proof_files: ['c'] }], I2: [{ proof_files: [] }],
    } as any;
    component['vampireProgressProofCount'] = 1;  // a stale poll

    (component as any).finishInferenceReport();

    expect(component.session.report.inference!.proofs).toBe(3);
    expect(component.session.report.inference!.vampire!.fastest).toEqual({ id: 'I1', ms: 5 });
  });

  it('names the slowest and fastest sentence by id, and adds the disambiguation state', () => {
    component.sentenceMap = { S1: 'One', S2: 'Two' };
    component.session.lastGswbOutputs = {
      S1: { solutions: [derived({ id: 'a', solution: 'a' }, 'prolog-drt'), derived({ id: 'b', solution: 'b' }, 'prolog-drt')], log: '', derivation: null, discriminants: [] },
      S2: { solutions: [derived({ id: 'c', solution: 'c' }, 'prolog-drt')], log: '', derivation: null, discriminants: [] },
    } as any;
    component.session.selectedSolutionIdsBySentence = { S1: ['a'], S2: ['c'] };
    component.session.report = {
      parse: {
        startedAt: '2026-10-01T10:00:00.000Z', finishedAt: '2026-10-01T10:00:05.000Z', durationMs: 5000,
        phases: [{ name: 'Parsing (LiGER)', startedAt: '2026-10-01T10:00:00.000Z', durationMs: 3000 }],
        parsing: { count: 2, totalMs: 3000, averageMs: 1500, fastest: { id: 'S1', ms: 1000 }, slowest: { id: 'S2', ms: 2000 } },
        composition: null,
        sentences: { total: 2, successful: 2, failedIds: [] }, items: { total: 0, discourse: 0 },
      },
      inference: null,
    };

    const { timings, outcomes } = component.runReport;

    expect(timings[1].fastest).toEqual({ duration: '1.00s', id: 'S1' });
    expect(timings[1].slowest).toEqual({ duration: '2.00s', id: 'S2' });
    expect(outcomes).toContain(['Disambiguated sentences', '1']);
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
      S1: { solutions: [derived({ id: 'a', solution: 'a' }, 'prolog-drt'), derived({ id: 'b', solution: 'b' }, 'prolog-drt')], log: '', derivation: null, discriminants: [] },
    } as any;
    snapshot.selectedSolutionIdsBySentence = { S1: ['a'] };
    snapshot.lastVampireResults = {
      I1: [{ proof_files: ['p1'] } as any],
    } as any;

    snapshot.report = {
      parse: null,
      inference: {
        startedAt: '2026-10-01T10:00:00.000Z', finishedAt: '2026-10-01T10:01:00.000Z', durationMs: 60000,
        phases: [], runKind: 'initial', itemsInRun: 1, selected: false, preparation: null, vampire: null,
        results: { total: 1, correct: 1, wrong: 0, notParsed: 0, noVerdict: 0 }, proofs: 1,
      },
    };

    (component as any).hydrateSession(snapshot);

    expect(component.hasTimingInfo).toBeTrue();
    expect(component['vampirePreserveExistingResults']).toBeTrue();
    expect(component.processingTimingSummary).toBe('Inference 1m00s · 1/1 correct');
    expect(component.runReport.outcomes).toContain(['Disambiguated sentences', '1']);
    expect(component.runReport.outcomes).toContain(['Reasoning branches checked', '1']);
  });

  describe('the rule set, from the LiGER workspace', () => {
    let workspace: LigerWorkspaceService;
    let saves: { semantics: string; pragmatics: string; axioms: string }[];

    /** Saved per-file text with p.liger edited, and what the workspace assembles from it. */
    function savedRuleSet() {
      const files: Record<string, string> = { ...FILES, '/res/rules/p.liger': 'P SAVED' };
      delete files['/res/dicts/d.txt'];
      workspace.open(RULE_SET.source, files);
      const texts = { semantics: workspace.semantics!, pragmatics: workspace.pragmatics!, axioms: workspace.axioms! };
      workspace.open(RULE_SET.source);  // back to disk, as a fresh page would be
      return { files, texts };
    }

    function storedSession(texts: { semantics: string; pragmatics: string; axioms: string },
                           files: Record<string, string> | null) {
      const snapshot = createRegressionTestingSession();
      snapshot.rulesFilename = RULE_SET.source;
      snapshot.rulesText = texts.semantics;
      snapshot.pragmaticsRulesText = texts.pragmatics;
      snapshot.axiomsText = texts.axioms;
      snapshot.ruleSetFiles = files;
      return snapshot;
    }

    beforeEach(() => {
      workspace = TestBed.inject(LigerWorkspaceService);
      workspace.open(RULE_SET.source);
      // What ngAfterViewInit wires up.
      component['workspaceSubscription'] = workspace.state$.subscribe(() => component['onWorkspaceChange']());
      saves = [];
      spyOn<any>(component, 'scheduleSessionSave').and.callFake(() => saves.push({
        semantics: component.session.rulesText,
        pragmatics: component.session.pragmaticsRulesText,
        axioms: component.session.axiomsText,
      }));
    });

    afterEach(() => component['workspaceSubscription']?.unsubscribe());

    it('reopens a restored session\'s rule set with its stored text, over what is on disk', () => {
      const { files, texts } = savedRuleSet();

      (component as any).hydrateSession(storedSession(texts, files));

      expect(workspace.state.documents['/res/rules/p.liger'].currentText).toBe('P SAVED');
      expect(workspace.state.documents['/res/rules/p.liger'].loadedText).toBe('P RULES\n');
      expect(component.session.pragmaticsRulesText).toBe(texts.pragmatics);
      expect(component.ruleSetNotice).toBe('');
      expect(component.isRestoringRuleSet).toBeFalse();
      expect(component.unsavedInputChanges).toEqual([]);
    });

    it('never lets the disk text reach a save while the rule set reopens', () => {
      const { files, texts } = savedRuleSet();

      (component as any).hydrateSession(storedSession(texts, files));

      for (const saved of saves) {
        expect(saved.pragmatics).toBe(texts.pragmatics);
      }
    });

    it('holds runs until the rule set has reopened', () => {
      const { files, texts } = savedRuleSet();
      const tree = new Subject<any>();
      ligerFiles.listConfig.and.returnValue(tree);

      (component as any).hydrateSession(storedSession(texts, files));
      expect(component.isRestoringRuleSet).toBeTrue();
      expect(component.runLocked).toBeTrue();

      tree.next(TREE);
      tree.complete();
      expect(component.isRestoringRuleSet).toBeFalse();
      expect(component.runLocked).toBeFalse();
      expect(component.ruleSetNotice).toBe('');
    });

    it('keeps stored text it cannot rebuild file by file, and says so', () => {
      // A session from before the workspace: assembled text only, edited by hand.
      const { texts } = savedRuleSet();

      (component as any).hydrateSession(storedSession({ ...texts, semantics: 'edited semantics' }, null));

      expect(component.session.rulesText).toBe('edited semantics');
      expect(component.ruleSetNotice).toContain('semantics rules');
      expect(saves.every(saved => saved.semantics === 'edited semantics')).toBeTrue();
    });

    it('keeps the stored rules when the rule set cannot be reopened', () => {
      const { files, texts } = savedRuleSet();
      ligerFiles.loadRuleSet.and.returnValue(throwError(() => ({ error: { error: 'No such file' } })));

      (component as any).hydrateSession(storedSession(texts, files));

      expect(component.ruleSetNotice).toContain('Could not reopen');
      expect(component.session.pragmaticsRulesText).toBe(texts.pragmatics);
      expect(component.isRestoringRuleSet).toBeFalse();
    });

    it('takes an edit into the session, and reports it as unsaved until the next save', () => {
      const { files, texts } = savedRuleSet();
      (component as any).hydrateSession(storedSession(texts, files));

      workspace.edit('/res/axioms/x.p', 'fof(z, axiom, r).\n');

      expect(component.session.axiomsText).toContain('fof(z, axiom, r).');
      expect(component.session.ruleSetFiles!['/res/axioms/x.p']).toBe('fof(z, axiom, r).\n');
      expect(saves[saves.length - 1].axioms).toContain('fof(z, axiom, r).');
      expect(component.unsavedInputChanges).toEqual(['axioms']);

      (component as any).markInputsSaved((component as any).buildSessionSnapshot());
      expect(component.unsavedInputChanges).toEqual([]);
    });

    it('does not count a change that does not touch what a run sends', () => {
      const { files, texts } = savedRuleSet();
      (component as any).hydrateSession(storedSession(texts, files));
      const before = saves.length;

      workspace.load('/res/dicts/d.txt');  // reading a lexicon changes the state, not the texts

      expect(saves.length).toBe(before);
    });

    it('starts a new session clean of a previous session\'s failed reopen', () => {
      // A session from before the move of the configs: its path is gone.
      ligerFiles.loadRuleSet.and.returnValue(throwError(() => ({ error: { error: 'No such file' } })));
      const legacy = createRegressionTestingSession();
      legacy.rulesFilename = './liger_resources/rules/default.liger.yaml';
      legacy.rulesText = 'old rules';
      (component as any).hydrateSession(legacy);
      expect(workspace.state.error).toContain('./liger_resources');

      ligerFiles.loadRuleSet.and.returnValue(of(RULE_SET));
      (component as any).initializeBlankSession();

      expect(workspace.state.error).toBeNull();
      expect(component.ruleSetNotice).toBe('');
      // The rule set that is open is the new session's.
      expect(component.session.rulesFilename).toBe(RULE_SET.source);
      expect(component.session.rulesText).toBe('SERVER SEMANTICS');
    });

    it('starts a new session on the rule set as it is on disk, not the last session\'s', () => {
      const { files, texts } = savedRuleSet();
      const snapshot = storedSession(texts, files);
      snapshot.ruleSetExcluded = ['/res/axioms/x.p'];
      (component as any).hydrateSession(snapshot);
      expect(workspace.hasEdits).toBeTrue();
      expect(workspace.isIncluded('/res/axioms/x.p')).toBeFalse();

      (component as any).initializeBlankSession();

      expect(workspace.hasEdits).toBeFalse();
      expect(workspace.state.excluded).toEqual([]);
      expect(workspace.yieldsToGrammar).toBeTrue();
      expect(component.session.pragmaticsRulesText).toBe('SERVER PRAGMATICS');
      expect(component.session.ruleSetExcluded).toEqual([]);
    });

    it('holds runs, and saves nothing, while a new session\'s rule set reopens', () => {
      const tree = new Subject<any>();
      ligerFiles.listConfig.and.returnValue(tree);
      const before = saves.length;

      (component as any).initializeBlankSession();
      expect(component.runLocked).toBeTrue();

      tree.next(TREE);
      tree.complete();
      expect(component.runLocked).toBeFalse();
      expect(component.session.rulesText).toBe('SERVER SEMANTICS');
      expect(component.unsavedInputChanges).toEqual([]);
      expect(saves.length).toBe(before);
    });

    it('stores how its rule set was chosen, and restores it that way', () => {
      const { files, texts } = savedRuleSet();
      const snapshot = storedSession(texts, files);
      snapshot.ruleSetOrigin = 'grammar';

      (component as any).hydrateSession(snapshot);

      expect(workspace.state.origin).toBe('grammar');
      expect((component as any).buildSessionSnapshot().inputs.ruleSetOrigin).toBe('grammar');
    });

    it('treats a session from before origins as picked by hand', () => {
      const { files, texts } = savedRuleSet();

      (component as any).hydrateSession(storedSession(texts, files));

      expect(workspace.state.origin).toBe('selected');
      expect(workspace.yieldsToGrammar).toBeFalse();
    });

    it('stores the per-file text with the session', () => {
      const { files, texts } = savedRuleSet();
      (component as any).hydrateSession(storedSession(texts, files));

      const document = (component as any).buildSessionSnapshot();

      expect(document.inputs.ruleSetFiles).toEqual(files);
      expect(document.inputs.pragmaticsRules).toBe(texts.pragmatics);
    });

    it('still generates an NLI branch\'s readings when no post-processing rules are loaded', done => {
      component.session.pragmaticsRulesText = '';
      (component as any).branchReadings(
        { itemId: 'n1', updateId: 'u1' },
        { sequenceStructure: { constraints: [] }, merged: derived({ id: 'm', graph: {} }) },
        0,
      ).subscribe((result: any) => {
        expect(result.failure).toBeUndefined();
        expect(result.readings.length).toBe(1);
        expect(reasoningPipeline.generateDiscourseMappings).toHaveBeenCalledWith(
          jasmine.objectContaining({ ruleString: '', scopeId: 'pxq-n1-1' }));
        done();
      });
    });
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
    expect(component.canRunInference).toBeFalse();

    cancelSubject.next({});
    cancelSubject.complete();

    expect(dataServiceSpy.saveRegressionSession).not.toHaveBeenCalled();
    expect(component['abortRequestInFlight']).toBeTrue();
    expect(component.canRunInference).toBeFalse();
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
    expect(component.canRunInference).toBeTrue();
  });

  describe('session lease', () => {
    it('holds the open session, moves the lease when the session changes and releases it on destroy', () => {
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      const holder = component['sessionLeaseHolderId'];
      const first = 'session-2026-10-06_09-00-00-000Z';
      component.session.redisSessionKey = first;
      (component as any).startSessionLease();
      expect(dataServiceSpy.holdSessionLease).toHaveBeenCalledWith(first, holder);

      component.session.redisSessionKey = 'degree-basic';
      (component as any).renewSessionLease();
      expect(dataServiceSpy.releaseSessionLease).toHaveBeenCalledWith(first, holder);
      expect(dataServiceSpy.holdSessionLease).toHaveBeenCalledWith('degree-basic', holder);

      component.ngOnDestroy();
      expect(dataServiceSpy.releaseSessionLease).toHaveBeenCalledWith('degree-basic', holder);
      expect(component['sessionLeaseTimer']).toBeNull();
    });
  });

  describe('Save As and unnamed sessions', () => {
    // Save As persists the new key as this browser's active session; later tests must not
    // start from it.
    afterEach(() => localStorage.removeItem('regression-testing-active-session-key'));

    it('removes the unnamed session it was saved from', () => {
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      component.session.redisSessionKey = 'session-2026-10-05_19-22-24-695Z';
      component.saveAsSessionName = 'degree-basic';

      component.saveSessionAs();

      expect(dataServiceSpy.saveRegressionSession.calls.mostRecent().args[0]).toBe('degree-basic');
      expect(dataServiceSpy.deleteRegressionSessions).toHaveBeenCalledOnceWith(['session-2026-10-05_19-22-24-695Z']);
    });

    it('keeps a named session it was saved from: that is a bank of its own', () => {
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      component.session.redisSessionKey = 'degree-basic';
      component.saveAsSessionName = 'degree-basic-v2';

      component.saveSessionAs();

      expect(dataServiceSpy.deleteRegressionSessions).not.toHaveBeenCalled();
    });

    it('refuses a name of the unnamed-session shape', () => {
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      dataServiceSpy.saveRegressionSession.calls.reset();
      component.saveAsSessionName = 'session-2026-01-01_00-00-00-000Z';

      component.saveSessionAs();

      expect(dataServiceSpy.saveRegressionSession).not.toHaveBeenCalled();
    });

    it('lists only named sessions besides the current one', () => {
      component.session.redisSessionKey = 'session-2026-10-06_09-00-00-000Z';
      component.recentSessions = [
        { sessionKey: 'session-2026-10-05_19-22-24-695Z' } as any,
        { sessionKey: 'degree-basic' } as any,
        { sessionKey: 'session-2026-10-06_09-00-00-000Z' } as any,
      ];
      expect(component.namedRecentSessions.map(entry => entry.sessionKey)).toEqual(['degree-basic']);
    });
  });

  /** 2026-10-06: an aborted run kept running beside the run that replaced it, because the
   *  abort unlocked the session as soon as the cancel was acknowledged. */
  it('keeps the session locked after an abort until the service has stopped the cancelled run', fakeAsync(() => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    dataServiceSpy.requestVampireCancel.and.returnValue(of({ cancelledRunId: 'run-1', activeRunId: 'run-1' }));
    let serverRun: string | null = 'run-1';
    dataServiceSpy.getVampireProgress.and.callFake(() => of({ runId: 'run-1', state: 'cancel_requested',
      activeRunId: serverRun } as any));
    component.loading = true;
    component['activeVampireRunStartedAt'] = 123;
    component['vampireRunId'] = 'run-1';

    component.abortCurrentRun();

    expect(dataServiceSpy.requestVampireCancel).toHaveBeenCalledWith(component.redisSessionKey, 'run-1');
    tick(1500);
    expect(component['abortRequestInFlight']).toBeTrue();
    expect(component.isSessionActionLocked).toBeTrue();
    expect(dataServiceSpy.getLastSession).not.toHaveBeenCalled();

    serverRun = null;
    tick(500);

    expect(dataServiceSpy.getLastSession).toHaveBeenCalled();
    expect(component['abortRequestInFlight']).toBeFalse();
    expect(component.loading).toBeFalse();
  }));

  it('unlocks after the stop timeout and says the abort was not confirmed', fakeAsync(() => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    dataServiceSpy.requestVampireCancel.and.returnValue(of({ cancelledRunId: 'run-1', activeRunId: 'run-1' }));
    dataServiceSpy.getVampireProgress.and.returnValue(of({ runId: 'run-1', activeRunId: 'run-1' } as any));
    component.loading = true;
    component['vampireRunId'] = 'run-1';

    component.abortCurrentRun();
    tick(30500);

    expect(component['abortRequestInFlight']).toBeFalse();
    expect(component.sessionLoadMessage).toContain('Abort not confirmed');
  }));

  it('ignores a progress record written by another run', () => {
    const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    component['vampireRunId'] = 'run-new';
    component['vampireProgressItemCount'] = 3;
    dataServiceSpy.getVampireProgress.and.returnValue(of({ runId: 'run-old', state: 'running', itemCount: 26,
      proofCount: 26, activeItemId: 'n9' } as any));

    (component as any).pollVampireProgress(component['vampireRunToken']);

    expect(component['vampireProgressItemCount']).toBe(3);
    expect(component['vampireActiveItemId']).toBeNull();
  });

  it('does not count results whose assignment ids belong to another preparation of the item', () => {
    component.session.hasRunVampire = true;
    component['regressionTestItems'] = [{ id: 'n8', premises: ['S0'], conclusion: ['S1'], gold_label: '1' }];
    component['sentenceMap'] = { S0: 'Premise.', S1: 'Hypothesis.' };
    component.session.analysisDocuments = {
      n8: {
        ...createRegressionAnalysisDocument('n8'),
        reasoningUpdates: [{
          id: 'ru-n8', premiseElementIds: ['S0'], hypothesisElementIds: ['S1'], itemId: 'n8',
          logicType: 'fof', ruleString: '', pruned: false,
          assignments: [{ id: 'current-a1', premiseSemanticIds: [], hypothesisSemanticIds: [], checks: {} as any }],
        } as any],
      },
    } as any;
    const stale = [{ glyph: '', informative: false, consistent: true, relevant: false, proof_files: [],
      assignment_id: 'earlier-a1' }];
    component.session.lastVampireResults = { n8: stale };

    (component as any).renderVampireResults({ n8: stale }, { item_count: 1, proof_count: 1 }, true, false);

    expect(component.inferenceResults.map(result => result.id)).toEqual([]);
    expect(component.failedInferenceItems[0].reason).toContain('earlier preparation');
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
    // Counted on the summary line and listed in the info pill, once inference has run.
    expect(component.inferenceFailures.map(f => f.id)).toEqual(['n1']);
    component.session.hasRunVampire = false;
    expect(component.inferenceFailures).toEqual([]);
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

    it('keeps, on a reparse of selected sentences, the documents of the items over none of them', () => {
      component['regressionTestItems'] = [
        { id: 'n0', premises: ['S0'], conclusion: ['S1'] },
        { id: 'n1', premises: ['S2'], conclusion: ['S3'] },
      ];
      const kept = { id: 'kept' } as any;
      component.session.analysisDocuments = { n0: { id: 'gone' } as any, n1: kept, S9: {} as any };

      (component as any).reparsingSentenceIds = new Set(['S1']);
      (component as any).resetAnalysisDocuments();
      expect(component.session.analysisDocuments).toEqual({ n1: kept });

      (component as any).reparsingSentenceIds = null;
      (component as any).resetAnalysisDocuments();
      expect(component.session.analysisDocuments).toEqual({});
    });

    it('records one DiscourseAnalysis per PCDRS branch, linked to the reading it annotates', () => {
      const document: any = createRegressionAnalysisDocument('doc');
      document.sequences = [{ id: 'S0+S1', text: '', sentenceIds: ['S0', 'S1'], syntax: [], semantics: [], synSemMapping: {} }];
      const build: any = { itemId: 'n0', updateId: 'ru-n0', premiseSentenceIds: ['S0'], hypothesisSentenceIds: ['S1'] };
      const reading = (mappingId: string, semanticOrigin: string, relations: any[]) => ({
        mapping: { id: mappingId, semantic: 'drs', graph: { id: 'g' }, anaphoraRelations: relations },
        ruleBranchIndex: 1,
        semanticOrigin,
      });

      (component as any).registerDiscourseUpdate(document, build, [
        reading('pcdrs-a', 'sem-a', [{ pronoun: 'x2', antecedent: 'x1' }]),
        reading('pcdrs-b', 'sem-b', []),
      ], ['pxq-n0-3: rules failed']);

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
      // Rule-branch provenance is recorded; the joins it was read off are not. Storing
      // them made the update scale with the cross product (180 structures, 37 MB, in one
      // measured item) while adding nothing recoverable that the element's own syntax and
      // semantics do not already hold.
      expect(update.discourse.map((d: any) => d.ruleBranch)).toEqual([1, 1]);
      // A branch whose readings could not be generated is recorded, for the run to report.
      expect(update.failures).toEqual(['pxq-n0-3: rules failed']);
      expect(update.structures).toBeUndefined();
      expect(update.mergedGraphs).toBeUndefined();
    });

    it('ranks the stored branches in the background and saves the ranking into the item document', () => {
      const lm = new Subject<any>();
      const dataService: any = TestBed.inject(DataService);
      dataService.lmRankAnaphora = jasmine.createSpy('lmRankAnaphora').and.returnValue(lm);
      const scheduleSessionSave = spyOn(component as any, 'scheduleSessionSave');
      const document: any = createRegressionAnalysisDocument('doc');
      document.sequences = [{
        id: 'S0+S1', text: '', sentenceIds: ['S0', 'S1'],
        syntax: [{ synId: 'syn-a', structure: { id: 'seq-structure' } }],
        semantics: [{ syntacticOrigin: 'syn-a', semId: 'sem-a', semString: 'P', semType: 'lfgxdrt', graph: { id: 'drs-a' } }],
        synSemMapping: { 'syn-a': ['sem-a'] },
      }];
      component.session.analysisDocuments = { n0: document };
      const build: any = { itemId: 'n0', updateId: 'ru-n0', premiseSentenceIds: ['S0'], hypothesisSentenceIds: ['S1'] };
      const relations = [{ pronounReferentId: 's1:4', pronounDisplay: 'x4', antecedent: 'x1' }];

      (component as any).registerDiscourseUpdate(document, build, [{
        mapping: { id: 'pcdrs-a', semantic: 'drs', anaphoraRelations: relations }, ruleBranchIndex: 1, semanticOrigin: 'sem-a',
      }], []);

      expect(document.discourseUpdates[0].anaphoraRanking).toBeUndefined();
      expect(dataService.lmRankAnaphora.calls.mostRecent().args[0].syntax).toEqual({ 'syn-a': { id: 'seq-structure' } });
      const ranking = {
        method: 'cosine-description', model: 'm', layers: [-1], pooling: 'mean', createdAt: 'now',
        relations: [], branches: [{ discourseId: 'pcdrs-a', score: 0.8, rank: 1 }], warnings: [],
      };
      lm.next(ranking);
      lm.complete();

      expect(component.session.analysisDocuments['n0'].discourseUpdates![0].anaphoraRanking).toEqual(ranking as any);
      expect(scheduleSessionSave).toHaveBeenCalled();
    });

    describe('the discourse dialog', () => {
      let document: any;
      let open: jasmine.Spy;
      let dataService: any;

      beforeEach(() => {
        document = createRegressionAnalysisDocument('doc');
        document.sequences = [{
          id: 'S0+S1', text: '', sentenceIds: ['S0', 'S1'], syntax: [], synSemMapping: {},
          semantics: [{ semId: 'sem-a', semString: '(A) + (B)' }],
        }];
        const binding = (antecedent: string) => ({ relations: [{ pronounReferentId: 's1:4', pronounDisplay: 'x4', antecedent }] });
        document.discourseUpdates = [{
          id: 'du-S0+S1', sourceElementId: 'S0+S1', sourceElementKind: 'sequence', semDiscourseMapping: {},
          discourse: [
            { id: 'pcdrs-1', semanticOrigin: 'sem-a', drsString: 'drs-1', ruleBranch: 1, collapsed: true, anaphoraMapping: binding('x2') },
            { id: 'pcdrs-2', semanticOrigin: 'sem-a', drsString: 'drs-2', ruleBranch: 1, collapsed: true, anaphoraMapping: binding('x1') },
          ],
          anaphoraRanking: {
            method: 'cosine-description', model: 'm', layers: [-1], pooling: 'mean', createdAt: 'now', relations: [], warnings: [],
            branches: [{ discourseId: 'pcdrs-1', score: 0.5, rank: 2 }, { discourseId: 'pcdrs-2', score: 0.9, rank: 1 }],
          },
        }];
        component.session.analysisDocuments = { n0: document, n1: createRegressionAnalysisDocument('empty') };
        open = jasmine.createSpy('open');
        (component as any).discourseDialog = { open };
        dataService = TestBed.inject(DataService);
      });

      it('is offered only for items with discourse branches', () => {
        expect(component.hasDiscourses('n0')).toBeTrue();
        expect(component.hasDiscourses('n1')).toBeFalse();
        expect(component.hasDiscourses('missing')).toBeFalse();
      });

      it('renders the branches to SVG from their stored PCDRS, in rank order, without touching sentence selections', () => {
        dataService.gswbRenderPcdrs = jasmine.createSpy('gswbRenderPcdrs').and.callFake((request: any) => of({
          solutions: request.items.map((item: any) => ({ id: item.id, solution: `<svg>${item.id}</svg>` })),
        }));
        const selectionsBefore = JSON.stringify(component.session.selectedScopeIdsBySentence);

        component.openDiscourseDialog('n0');

        const request = dataService.gswbRenderPcdrs.calls.mostRecent().args[0];
        expect(request.items.map((item: any) => item.id)).toEqual(['pcdrs-2', 'pcdrs-1']);
        // The stored PCDRS, its A: and P: inline -- so P: is shown.
        expect(request.items[0].semantic).toBe('drs-2');
        expect(request.items[0].anaphoraRelations).toBeUndefined();

        const payload = open.calls.mostRecent().args[0];
        expect(payload.title).toBe('Discourses — n0');
        expect(payload.svgSolutions).toBeTrue();
        expect(payload.items.map((item: any) => item.solution)).toEqual(['<svg>pcdrs-2</svg>', '<svg>pcdrs-1</svg>']);
        expect(payload.itemLabels[0]).toContain('rank 1');
        expect(component.discourseDialogLoadingItemId).toBeNull();
        expect(JSON.stringify(component.session.selectedScopeIdsBySentence)).toBe(selectionsBefore);
      });

      it('hides the readings the discriminant selection rules out, as for a sentence', () => {
        dataService.gswbRenderPcdrs = jasmine.createSpy('gswbRenderPcdrs').and.callFake((request: any) => of({
          solutions: request.items.map((item: any) => ({ id: item.id, solution: `<svg>${item.id}</svg>` })),
        }));
        document.discourseUpdates[0].discourse[0].semanticOrigin = 'S0-s0+S1-s0';
        document.discourseUpdates[0].discourse[1].semanticOrigin = 'S0-s0+S1-s1';
        component['regressionTestItems'] = [{ id: 'n0', premises: ['S0'], conclusion: ['S1'] }];
        const reading = (id: string) => derived({ id, semantic: 'p', graph: {} });
        component.session.lastGswbOutputs = {
          S0: { solutions: [reading('S0-s0')], log: '', derivation: null, discriminants: [] },
          S1: { solutions: [reading('S1-s0'), reading('S1-s1')], log: '', derivation: null, discriminants: [] },
        } as any;
        component.session.gswbPreferences.outputstyle = 5;

        component.session.selectedSolutionIdsBySentence = { S0: ['S0-s0'], S1: ['S1-s0', 'S1-s1'] };
        component.openDiscourseDialog('n0');
        expect(open.calls.mostRecent().args[0].narrowTo).toBeUndefined();

        component.session.selectedSolutionIdsBySentence = { S0: ['S0-s0'], S1: ['S1-s0'] };
        component.openDiscourseDialog('n0');
        const payload = open.calls.mostRecent().args[0];
        expect(payload.narrowTo).toEqual(['pcdrs-1']);
        // Every reading is still handed over, so the counter's total counts them all.
        expect(payload.items.length).toBe(2);
      });

      it('opens on the branches the run sent to Vampire', () => {
        dataService.gswbRenderPcdrs = jasmine.createSpy('gswbRenderPcdrs').and.callFake((request: any) => of({
          solutions: request.items.map((item: any) => ({ id: item.id, solution: `<svg>${item.id}</svg>` })),
        }));
        component.openDiscourseDialog('n0');
        expect(open.calls.mostRecent().args[0].filter).toBeUndefined();

        // A top-1 run sent only pcdrs-2; no verdict has come back yet.
        document.reasoningUpdates = [{
          id: 'ru-n0', premiseElementIds: ['S0'], hypothesisElementIds: ['S1'], logicType: 'fof',
          readingSelection: { criteria: ['lm'], filters: [], k: 1, applied: true },
          assignments: [{
            id: 'a-pcdrs-2', premiseSemanticIds: [], hypothesisSemanticIds: [], ruleBranchIndex: 1, checks: {},
            discourseUpdateId: 'du-S0+S1', discourseId: 'pcdrs-2',
          }],
        }];
        component.openDiscourseDialog('n0');
        expect(open.calls.mostRecent().args[0].filter).toEqual({ ids: ['pcdrs-2'], label: 'Only branches sent to Vampire' });
      });

      it('falls back to the text DRSs when GSWB cannot render them', () => {
        dataService.gswbRenderPcdrs = jasmine.createSpy('gswbRenderPcdrs').and.returnValue(throwError(() => ({ status: 0 })));

        component.openDiscourseDialog('n0');

        const payload = open.calls.mostRecent().args[0];
        expect(payload.svgSolutions).toBeFalse();
        expect(payload.items.map((item: any) => item.solution)).toEqual(['drs-2', 'drs-1']);
        expect(component.discourseDialogLoadingItemId).toBeNull();
      });
    });

    it('keeps each run\'s anaphora selection and compares the stored results restricted to each selection', () => {
      const branchOf = (id: string, antecedent: string) => ({
        id, semanticOrigin: 'sem-a', drsString: id, ruleBranch: 1, collapsed: true,
        anaphoraMapping: { relations: [{ pronounReferentId: 's1:4', pronounDisplay: 'x4', antecedent }] },
      });
      const assignmentOver = (discourseId: string, informative: boolean) => ({
        id: `a-${discourseId}`, premiseSemanticIds: [], hypothesisSemanticIds: [], ruleBranchIndex: 1, checks: {},
        discourseUpdateId: 'du-S0+S1', discourseId, verdict: { consistent: true, informative, relevant: true },
      });
      const document: any = createRegressionAnalysisDocument('doc');
      document.discourseUpdates = [{
        id: 'du-S0+S1', sourceElementId: 'S0+S1', sourceElementKind: 'sequence', semDiscourseMapping: {},
        discourse: [branchOf('p1', 'x1'), branchOf('p2', 'x2'), branchOf('p3', 'x3')],
        anaphoraRanking: {
          method: 'cosine-description', model: 'm', layers: [-1], pooling: 'mean', createdAt: 'now', relations: [], warnings: [],
          branches: [{ discourseId: 'p1', score: 0.9, rank: 1 }, { discourseId: 'p2', score: 0.5, rank: 2 }, { discourseId: 'p3', score: 0.4, rank: 3 }],
        },
      }];
      // Two neutral branches outvote the best-ranked one, which is the gold entailment.
      document.reasoningUpdates = [{
        id: 'ru-n0', premiseElementIds: ['S0'], hypothesisElementIds: ['S1'], logicType: 'fof',
        assignments: [assignmentOver('p1', false), assignmentOver('p2', true), assignmentOver('p3', true)],
      }];
      component.session.analysisDocuments = { n0: document };
      component['regressionTestItems'] = [{ id: 'n0', premises: ['S0'], conclusion: ['S1'], gold_label: '1' }];
      const results = { n0: [{ consistent: true, informative: true } as any] };

      component.vampirePreferences.vampirePreferences = { ...component.vampirePreferences.vampirePreferences, reading_selection: { ...ALL_READINGS } };
      (component as any).renderVampireResults(results, { item_count: 1, proof_count: 0 }, false);
      expect(component.inferenceResults[0].predictedLabel).toBe('0');
      expect(component.inferenceSummary).toContain('Readings sent to Vampire: all readings.');
      expect(component.inferenceSummary).toContain('Same results restricted to each selection: all readings 0/1 · top 1 by LM 1/1');

      // Changing the setting afterwards leaves the existing verdict alone.
      component.vampirePreferences.vampirePreferences = { ...component.vampirePreferences.vampirePreferences, reading_selection: { criteria: ['lm'], filters: [], k: 1 } };
      (component as any).renderVampireResults(results, { item_count: 1, proof_count: 0 }, false);
      expect(component.inferenceResults[0].predictedLabel).toBe('0');

      // A top-1 run sends and stores only the best branch; its verdict is that branch's.
      document.reasoningUpdates[0] = {
        ...document.reasoningUpdates[0],
        readingSelection: { criteria: ['lm'], filters: [], k: 1, applied: true },
        assignments: [assignmentOver('p1', false)],
      };
      (component as any).renderVampireResults(results, { item_count: 1, proof_count: 0 }, false);
      expect(component.inferenceResults[0].predictedLabel).toBe('1');
      expect(component.inferenceResults[0].readingSelection).toEqual({ criteria: ['lm'], filters: [], k: 1, applied: true, used: 1, total: 3 });
      expect(component.inferenceSummary).toContain('Readings sent to Vampire: top 1 by LM.');
    });

    it('waits for the ranking before a top-k run goes on, and not otherwise', () => {
      const lm = new Subject<any>();
      const dataService: any = TestBed.inject(DataService);
      dataService.lmRankAnaphora = jasmine.createSpy('lmRankAnaphora').and.returnValue(lm);
      spyOn(component as any, 'scheduleSessionSave');
      const document: any = createRegressionAnalysisDocument('doc');
      document.sequences = [{
        id: 'S0+S1', text: '', sentenceIds: ['S0', 'S1'],
        syntax: [{ synId: 'syn-a', structure: { id: 'seq' } }],
        semantics: [{ syntacticOrigin: 'syn-a', semId: 'sem-a', semString: 'P', semType: 'lfgxdrt', graph: { id: 'drs' } }],
        synSemMapping: { 'syn-a': ['sem-a'] },
      }];
      component.session.analysisDocuments = { n0: document };
      const build: any = { itemId: 'n0', updateId: 'ru-n0', premiseSentenceIds: ['S0'], hypothesisSentenceIds: ['S1'] };
      (component as any).registerDiscourseUpdate(document, build, [{
        mapping: { id: 'pcdrs-a', semantic: 'drs', anaphoraRelations: [{ pronounReferentId: 's1:4', pronounDisplay: 'x4', antecedent: 'x1' }] },
        ruleBranchIndex: 1, semanticOrigin: 'sem-a',
      }], []);
      let ranked = false;
      (component as any).rankingOf('n0').subscribe({ complete: () => ranked = true });
      expect(ranked).toBeFalse();

      lm.next({ method: 'cosine-description', model: 'm', layers: [-1], pooling: 'mean', createdAt: 'now',
        relations: [], branches: [{ discourseId: 'pcdrs-a', score: 0.8, rank: 1 }], warnings: [] });
      lm.complete();
      expect(ranked).toBeTrue();

      let immediate = false;
      (component as any).rankingOf('n0').subscribe({ complete: () => immediate = true });
      expect(immediate).toBeTrue();
    });

    it('points each reasoning assignment at the discourse branch it was reasoned over', () => {
      const sentence = (id: string) => ({
        id, text: id, syntax: [{ synId: `${id}-syn`, structure: {} }],
        semantics: [{ syntacticOrigin: `${id}-syn`, semId: `${id}-s0`, semString: 'P', semType: 'lfgxdrt' }],
        synSemMapping: { [`${id}-syn`]: [`${id}-s0`] },
      });
      const document: any = createRegressionAnalysisDocument('doc');
      document.sentences = [sentence('S0'), sentence('S1')];
      document.sequences = [{
        id: 'S0+S1', text: '', sentenceIds: ['S0', 'S1'], syntax: [{ synId: 'seq-syn', structure: {} }],
        semantics: [{ syntacticOrigin: 'seq-syn', semId: 'sem-a', semString: 'P', semType: 'lfgxdrt' }],
        synSemMapping: { 'seq-syn': ['sem-a'] },
      }];
      document.elements = [{ kind: 'sentence', id: 'S0' }, { kind: 'sentence', id: 'S1' }, { kind: 'sequence', id: 'S0+S1' }];
      document.discourseUpdates = [{
        id: 'du-S0+S1', sourceElementId: 'S0+S1', sourceElementKind: 'sequence', semDiscourseMapping: { 'sem-a': ['pcdrs-a'] },
        discourse: [{ id: 'pcdrs-a', semanticOrigin: 'sem-a', drsString: 'drs', ruleBranch: 1, collapsed: true,
          anaphoraMapping: { relations: [{ pronounReferentId: 's1:4', pronounDisplay: 'x4', antecedent: 'x1' }] } }],
      }];
      component.session.analysisDocuments = { n0: document };
      component['regressionTestItems'] = [{ id: 'n0', premises: ['S0'], conclusion: ['S1'] }];
      const checks = { info_pos_check: { tptp: 'a' }, info_neg_check: { tptp: 'b' }, cons_pos_check: { tptp: 'c' }, cons_neg_check: { tptp: 'd' } };
      const assignmentId = (mappingId: string) => reasoningAssignmentId({
        updateId: 'ru-n0', premiseSemanticIds: ['S0-s0'], hypothesisSemanticIds: ['S1-s0'], ruleBranchIndex: 1, anaphoraBranchId: mappingId,
      });
      (component as any).preparedNliPairs = [{
        itemId: 'n0', scopeId: 'pxq', failures: [], degradations: [],
        assignments: [
          { assignmentId: assignmentId('pcdrs-a'), mappingId: 'pcdrs-a', ruleBranchIndex: 1, checks, contextTptp: '' },
          { assignmentId: assignmentId('pcdrs-unstored'), mappingId: 'pcdrs-unstored', ruleBranchIndex: 1, checks, contextTptp: '' },
        ],
      }];

      (component as any).runReadingSelection = { criteria: ['lm'], filters: [], k: 2 };
      component.vampirePreferences.vampirePreferences = { ...component.vampirePreferences.vampirePreferences, reading_selection: { ...ALL_READINGS } };

      (component as any).upsertReasoningUpdates({
        n0: [{ assignment_id: assignmentId('pcdrs-a'), consistent: true, informative: false, relevant: true }],
      });

      // The selection the run started with, not whatever the setting says now.
      expect(component.session.analysisDocuments['n0'].reasoningUpdates![0].readingSelection).toEqual({ criteria: ['lm'], filters: [], k: 2, applied: true });

      const assignments = component.session.analysisDocuments['n0'].reasoningUpdates![0].assignments;
      expect(assignments[0].discourseUpdateId).toBe('du-S0+S1');
      expect(assignments[0].discourseId).toBe('pcdrs-a');
      // A branch that was never stored is not pointed at: validation would reject the pointer.
      expect(assignments[1].discourseUpdateId).toBeUndefined();
      expect(assignments[1].discourseId).toBeUndefined();
      const { labels } = discourseBranchesForDisplay(component.session.analysisDocuments['n0']);
      expect(labels[0]).toContain('Vampire: entailment ×1');
    });

    it('writes nothing, and fails the item, when there is no registered sequence or no reading', () => {
      const document: any = createRegressionAnalysisDocument('doc');
      const build: any = { itemId: 'n0', updateId: 'ru-n0', premiseSentenceIds: ['S0'], hypothesisSentenceIds: ['S1'] };
      const reading = { mapping: { id: 'pcdrs-a', semantic: 'drs', anaphoraRelations: [] }, ruleBranchIndex: 1, semanticOrigin: 'sem-a' };
      expect(() => (component as any).registerDiscourseUpdate(document, build, [reading], []))
        .toThrowError(/No sequence S0\+S1/);
      document.sequences = [{ id: 'S0+S1', text: '', sentenceIds: ['S0', 'S1'], syntax: [], semantics: [], synSemMapping: {} }];
      expect(() => (component as any).registerDiscourseUpdate(document, build, [], ['pxq-n0-1: boom']))
        .toThrowError(/No reading of S0\+S1 could be generated\. pxq-n0-1: boom/);
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
  /** Whether a save goes out as a full PUT or a partial PATCH is decided purely from the
   *  client's per-path baseline, and a baseline that describes a session Redis does not
   *  have makes every save 404 forever. Observed live 2026-09-04: a 322s run whose every
   *  save was refused with "no stored session under ...", so none of it was ever stored. */
  describe('session save: full PUT vs. partial PATCH', () => {
    let dataServiceSpy: jasmine.SpyObj<DataService>;

    beforeEach(() => {
      dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    });

    /** Make the session differ from the last-saved fingerprint, or the save is skipped as
     *  "nothing to save". */
    const dirtyTheSession = () => {
      component.session.grammarPath = `grammar-${Math.random()}.lfg`;
    };

    const save = () => component['saveSessionSnapshot'](undefined, undefined, undefined, 'autosave');

    it('writes a brand-new session in full, because nothing is stored under its key yet', () => {
      component.createNewSession();
      dataServiceSpy.saveRegressionSession.calls.reset();
      dataServiceSpy.patchRegressionSession.calls.reset();

      dirtyTheSession();
      save();

      expect(dataServiceSpy.patchRegressionSession).not.toHaveBeenCalled();
      expect(dataServiceSpy.saveRegressionSession).toHaveBeenCalledTimes(1);
    });

    it('writes in full after a load failure reset the session to a blank one', () => {
      dataServiceSpy.loadRegressionSession.and.returnValue(
        throwError(() => ({ status: 404 })) as any);

      component.loadSessionFromRecent('gone', true);
      dataServiceSpy.saveRegressionSession.calls.reset();
      dataServiceSpy.patchRegressionSession.calls.reset();

      dirtyTheSession();
      save();

      expect(dataServiceSpy.patchRegressionSession).not.toHaveBeenCalled();
      expect(dataServiceSpy.saveRegressionSession).toHaveBeenCalledTimes(1);
    });

    it('treats a 200 empty document as a missing session rather than loading it', () => {
      // The store answers a miss with 200 `{}`, not a 404, so this arrives as a success.
      dataServiceSpy.loadRegressionSession.and.returnValue(of({} as any));

      component.loadSessionFromRecent('gone', true);

      expect(component.sessionLoadState).toBe('error');
      expect(component['lastSavedSectionFingerprints']).toEqual({});

      dataServiceSpy.saveRegressionSession.calls.reset();
      dataServiceSpy.patchRegressionSession.calls.reset();
      dirtyTheSession();
      save();

      expect(dataServiceSpy.patchRegressionSession).not.toHaveBeenCalled();
      expect(dataServiceSpy.saveRegressionSession).toHaveBeenCalledTimes(1);
    });

    it('patches only the paths that changed once a session is stored', () => {
      component.createNewSession();
      dirtyTheSession();
      save();                                   // the full PUT that creates it
      dataServiceSpy.saveRegressionSession.calls.reset();

      component.session.axiomsFilename = 'degree_axioms.txt';
      save();

      expect(dataServiceSpy.saveRegressionSession).not.toHaveBeenCalled();
      expect(dataServiceSpy.patchRegressionSession).toHaveBeenCalledTimes(1);
      const [key, body] = dataServiceSpy.patchRegressionSession.calls.mostRecent().args;
      expect(key).toBe(component.redisSessionKey);
      const paths = JSON.parse(body).paths;
      // Only `inputs` moved; the immutable parse-phase bulk must not be re-sent.
      expect(Object.keys(paths)).toEqual(['inputs']);
      expect(paths.inputs.axioms.filename).toBe('degree_axioms.txt');
    });

    it('re-saves in full when the store says the patched session is not there', () => {
      component.createNewSession();
      dirtyTheSession();
      save();                                   // the full PUT that creates it
      dataServiceSpy.saveRegressionSession.calls.reset();

      // The session goes missing behind the client's back: deleted from another tab, or
      // the store cleared under a running session.
      dataServiceSpy.patchRegressionSession.and.returnValue(
        throwError(() => ({ status: 404, error: { detail: "no stored session under 'k'" } })) as any);

      component.session.axiomsFilename = 'degree_axioms.txt';
      save();

      expect(dataServiceSpy.patchRegressionSession).toHaveBeenCalledTimes(1);
      expect(dataServiceSpy.saveRegressionSession).toHaveBeenCalledTimes(1);
      const [, payload] = dataServiceSpy.saveRegressionSession.calls.mostRecent().args;
      // The whole session, not the patch fragment.
      expect(JSON.parse(payload as string).analysis).toBeDefined();
      // Recovered, so no error banner -- and the save lock is released, not stranded.
      expect(component.sessionLoadState).not.toBe('error');
      expect(component['saveOperationInProgress']).toBeFalse();
    });

    it('does not retry a full save that fails, and says why', () => {
      component.createNewSession();
      dataServiceSpy.saveRegressionSession.and.returnValue(
        throwError(() => ({ status: 503, message: 'service unavailable' })) as any);

      dirtyTheSession();
      save();

      expect(dataServiceSpy.saveRegressionSession).toHaveBeenCalledTimes(1);
      expect(dataServiceSpy.patchRegressionSession).not.toHaveBeenCalled();
      expect(component.sessionLoadState).toBe('error');
      expect(component['saveOperationInProgress']).toBeFalse();
    });
  });
  describe('autosave toggle and JSON download', () => {
    let dataServiceSpy: jasmine.SpyObj<DataService>;

    beforeEach(() => {
      dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      component.createNewSession();
      dataServiceSpy.saveRegressionSession.calls.reset();
      dataServiceSpy.patchRegressionSession.calls.reset();
    });

    const dirtyTheSession = () => {
      component.session.grammarPath = `grammar-${Math.random()}.lfg`;
    };
    const autoSave = () => component['saveSessionSnapshot'](undefined, undefined, undefined, 'autosave');

    it('writes nothing automatically while autosave is off', () => {
      component.setAutosaveEnabled(false);
      dirtyTheSession();

      autoSave();
      component['scheduleSessionSave'](true);

      expect(dataServiceSpy.saveRegressionSession).not.toHaveBeenCalled();
      expect(dataServiceSpy.patchRegressionSession).not.toHaveBeenCalled();
    });

    it('still writes the post-run snapshot suppressed, even though it passes action "current"', () => {
      // The post-abort snapshot passes 'current' only to get past the abortRequestInFlight
      // guard; it is still an automatic save and must respect the switch.
      component.setAutosaveEnabled(false);
      dirtyTheSession();

      component['saveSessionSnapshot'](undefined, undefined, undefined, 'current');

      expect(dataServiceSpy.saveRegressionSession).not.toHaveBeenCalled();
      expect(dataServiceSpy.patchRegressionSession).not.toHaveBeenCalled();
    });

    it('still saves on an explicit "Save current session" while autosave is off', () => {
      component.setAutosaveEnabled(false);
      dirtyTheSession();

      component.saveCurrentSession();

      expect(dataServiceSpy.saveRegressionSession).toHaveBeenCalledTimes(1);
    });

    it('flushes what changed when autosave is switched back on', () => {
      component.setAutosaveEnabled(false);
      dirtyTheSession();
      expect(dataServiceSpy.saveRegressionSession).not.toHaveBeenCalled();

      component.setAutosaveEnabled(true);

      expect(dataServiceSpy.saveRegressionSession).toHaveBeenCalledTimes(1);
    });

    it('autosaves as usual once it is back on', () => {
      dirtyTheSession();
      autoSave();

      expect(dataServiceSpy.saveRegressionSession).toHaveBeenCalledTimes(1);
    });

    it('downloads the live session, not the stored one, in the dashboard export shape', async () => {
      const link = document.createElement('a');
      spyOn(link, 'click');
      spyOn(document, 'createElement').and.returnValue(link as any);
      let blob: Blob | null = null;
      spyOn(window.URL, 'createObjectURL').and.callFake((given: Blob | MediaSource) => {
        blob = given as Blob;
        return 'blob:probe';
      });
      spyOn(window.URL, 'revokeObjectURL');

      component.session.grammarPath = './grammars/dev/probe.lfg';
      // The per-NLI-item XlePlusGlueDocuments are the part of a bank that matters --
      // analysis.documents is the record, system.inferenceResults only a view over it.
      component.session.analysisDocuments = {
        n0: { ...createRegressionAnalysisDocument('n0'), id: 'n0' } as any,
      };
      component.downloadSessionJson();

      const captured = blob ? await (blob as Blob).text() : '';

      // Never re-reads the store: this has to work with the services down.
      expect(dataServiceSpy.loadRegressionSession).not.toHaveBeenCalled();
      expect(link.click).toHaveBeenCalled();
      expect(link.download).toBe(`${component.redisSessionKey}.json`);

      const parsed = JSON.parse(captured);
      // The RegressionSessionDocument shape the dashboard exports and imports.
      expect(parsed.schemaVersion).toBeDefined();
      expect(parsed.metadata.redisSessionKey).toBe(component.redisSessionKey);
      expect(parsed.inputs.grammarPath).toBe('./grammars/dev/probe.lfg');
      expect(Object.keys(parsed.analysis.documents)).toEqual(['n0']);
      expect(parsed.analysis.documents.n0.elements).toBeDefined();
      expect(parsed.analysis.documents.n0.reasoningUpdates).toBeDefined();
    });
  });
  /** The status box under the session controls is an ACTION log: it says what the user
   *  just did. Autosave is not an action -- it has its own in-flight indicator -- and
   *  before the save fix its failures were stamping the box every few seconds, which is
   *  the only reason it ever looked lively during a run. */
  describe('session status box', () => {
    let dataServiceSpy: jasmine.SpyObj<DataService>;

    beforeEach(() => {
      dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
    });

    it('reports a new session instead of leaving the box blank', () => {
      component.createNewSession();

      expect(component.sessionLoadState).toBe('success');
      expect(component.sessionLoadMessage).toContain(`Started new session ${component.redisSessionKey}`);
    });

    it('reports a loaded session', () => {
      dataServiceSpy.loadRegressionSession.and.returnValue(of({
        schemaVersion: 6, metadata: { id: 'stored', redisSessionKey: 'stored' },
        inputs: {}, analysis: {},
      } as any));

      component.loadSessionFromRecent('stored', true);

      expect(component.sessionLoadState).toBe('success');
      expect(component.sessionLoadMessage).toContain('Loaded stored');
    });

    it('says nothing on an autosave that succeeds', () => {
      component.createNewSession();
      const afterAction = component.sessionLoadMessage;

      component.session.grammarPath = './grammars/dev/probe.lfg';
      component['saveSessionSnapshot'](undefined, undefined, undefined, 'autosave');

      // Unchanged: the box still shows the last real action, not save chatter.
      expect(dataServiceSpy.saveRegressionSession).toHaveBeenCalled();
      expect(component.sessionLoadMessage).toBe(afterAction);
    });

    it('still reports an autosave that FAILS, which has no other visible signal', () => {
      component.createNewSession();
      dataServiceSpy.saveRegressionSession.and.returnValue(
        throwError(() => ({ status: 503, message: 'service unavailable' })) as any);

      component.session.grammarPath = './grammars/dev/probe.lfg';
      component['saveSessionSnapshot'](undefined, undefined, undefined, 'autosave');

      expect(component.sessionLoadState).toBe('error');
      expect(component.sessionLoadMessage).toContain('Could not save session');
    });
  });
  /** The 2s vampire_progress poll must not outlive the run that started it. Diagnosed
   *  2026-09-08 (xleplusglue docs/bug_reports/redis_traffic_with_autosave_off.md): a poll
   *  loop was observed still running against a session whose run had long finished. */
  describe('progress poll lifetime', () => {
    const progressRecord = (state: string) => ({
      sessionKey: 'k', runId: null, state, cancelRequested: false, activeItemId: null,
      completedItemIds: [], changedItemIds: [], itemResults: {}, itemCount: 0, proofCount: 0,
      totalItemCount: 1,
    } as any);

    const pollTimer = () => component['vampireProgressPollTimer'];

    afterEach(() => {
      (component as any).endVampireRun();
    });

    it('stops polling when the record says the run finished', () => {
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      (component as any).startVampireSummaryPolling(Date.now(), component['vampireRunToken']);

      dataServiceSpy.getVampireProgress.and.returnValue(of(progressRecord('running')));
      (component as any).pollVampireProgress(component['vampireRunToken']);
      expect(pollTimer()).not.toBeNull();

      dataServiceSpy.getVampireProgress.and.returnValue(of(progressRecord('completed')));
      (component as any).pollVampireProgress(component['vampireRunToken']);

      expect(pollTimer()).toBeNull();
    });

    it('ignores a PREVIOUS run\'s leftover completed record', () => {
      // The record is cleared before polling starts, but that clear is allowed to fail --
      // it must never block a run. One failed clear must not stop the new run's polling.
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      (component as any).startVampireSummaryPolling(Date.now(), component['vampireRunToken']);

      dataServiceSpy.getVampireProgress.and.returnValue(of(progressRecord('completed')));
      (component as any).pollVampireProgress(component['vampireRunToken']);

      expect(pollTimer()).not.toBeNull();
    });

    it('tears the run down when the submission fails, even though the error is swallowed', () => {
      // batchVampire() catches its own errors and returns EMPTY, so a failed submission
      // emits nothing and merely completes: `error` never fires. Before the `complete`
      // handler, nothing stopped the poll and `loading` stayed true forever.
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      dataServiceSpy.callBatchVampire.and.returnValue(
        throwError(() => ({ status: 500, message: 'vampire is down' })) as any);

      (component as any).submitVampireRequest({}, false, Date.now(), component['vampireRunToken'], true);

      expect(pollTimer()).toBeNull();
      expect(component['vampireRunInFlight']).toBeFalse();
      expect(component.loading).toBeFalse();
    });

    it('does not let the progress clear arm a poll for a run that already ended', () => {
      // The clear and the submission are separate requests with no ordering between them.
      // A submission that fails instantly (a refused connection) used to tear down a poller
      // that had not started yet, and the clear's callback then armed one nothing would stop.
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      const clearResponse = new Subject<any>();
      dataServiceSpy.clearVampireProgress.and.returnValue(clearResponse.asObservable() as any);
      dataServiceSpy.callBatchVampire.and.returnValue(
        throwError(() => ({ status: 500, message: 'vampire is down' })) as any);

      (component as any).submitVampireRequest({}, false, Date.now(), component['vampireRunToken'], true);
      expect(component['vampireRunInFlight']).toBeFalse();

      clearResponse.next({});
      clearResponse.complete();

      expect(pollTimer()).toBeNull();
    });
  });
  /** Parsing and inference are two operations, not one chain. */
  /** The progress denominator counts ITEMS THIS RUN WILL ACCOUNT FOR: the ones it submits,
   *  plus the ones it is leaving alone because they already have a verdict. An item that is
   *  both on record AND being redone belongs to the first group only. Counting every prior
   *  result as a head start put it in both, so re-running a whole suite showed twice its
   *  size -- a 26-item suite reported "26 / 52" from the first poll. */
  describe('progress totals on a re-run', () => {
    const priorChecks = () => [{ glyph: 'x', informative: true, consistent: true, relevant: true, proof_files: [] }];
    const submittable = (ids: string[]) => Object.fromEntries(
      ids.map(id => [id, { premises: ['p'], hypothesis: ['h'], axioms: '', tptp_checks: ['c'] }]));

    // The default spy resolves the batch instantly, which completes the run and clears the
    // indicator before anything can be read off it. Hold the submission open instead.
    const submitAndHold = (kind: 'initial' | 'rerun', priorIds: string[], submittedIds: string[]) => {
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      dataServiceSpy.callBatchVampire.and.returnValue(new Subject<any>().asObservable() as any);
      component.session.lastVampireResults = Object.fromEntries(
        priorIds.map(id => [id, priorChecks()])) as any;
      component['currentVampireRunKind'] = kind;
      component['vampireCurrentRunItemCount'] = submittedIds.length;
      (component as any).submitVampireRequest(
        submittable(submittedIds), false, Date.now(), component['vampireRunToken'], true);
    };

    const runRerunOver = (priorIds: string[], submittedIds: string[]) =>
      submitAndHold('rerun', priorIds, submittedIds);

    afterEach(() => {
      (component as any).endVampireRun();
    });

    it('does not double-count items that are both on record and being redone', () => {
      runRerunOver(['a', 'b', 'c'], ['a', 'b', 'c']);

      // Every prior item is being redone, so nothing is carried over: the total is the
      // suite, not the suite twice, and the bar starts at zero rather than half full.
      expect(component['vampireProgressTotalCount']).toBe(3);
      expect(component['vampireProgressBaselineCount']).toBe(0);
      expect(component['vampireProofBaselineCount']).toBe(0);
    });

    it('still credits results the run is leaving alone', () => {
      runRerunOver(['a', 'b', 'c'], ['c']);

      // 'a' and 'b' keep their verdicts and are real progress; only 'c' is resubmitted.
      expect(component['vampireProgressTotalCount']).toBe(3);
      expect(component['vampireProgressBaselineCount']).toBe(2);
      expect(component['vampireProofBaselineCount']).toBe(2);
    });

    it('counts nothing as already done on an initial run', () => {
      submitAndHold('initial', ['a'], ['a']);

      expect(component['vampireProgressTotalCount']).toBe(1);
      expect(component['vampireProgressBaselineCount']).toBe(0);
    });
  });

  describe('inference as a separate step', () => {
    let ran: jasmine.Spy;

    beforeEach(() => {
      ran = spyOn<any>(component, 'runVampireFromCurrentState');
    });

    it('runs inference after a parse by default', () => {
      component.enableInference = true;

      (component as any).continueAfterParse();

      expect(ran).toHaveBeenCalledWith(true);
    });

    it('stops after parsing when inference is switched off', () => {
      component.enableInference = false;

      (component as any).continueAfterParse();

      expect(ran).not.toHaveBeenCalled();
    });

    it('leaves a session that stopped after parsing able to parse again', () => {
      // Parsing used to be locked for the whole disambiguation pause, on the assumption
      // that Continue or Skip would end it. Nothing ends it now, so a lock like that would
      // disable "Parse all" for good the first time a run stopped.
      component.enableInference = false;
      (component as any).continueAfterParse();
      component.loading = false;

      expect(component.runLocked).toBeFalse();
    });

    it('always honours the discriminant selections', () => {
      // Selecting discriminants IS the commitment to using them, so there is no second
      // mode: what Skip used to mean has no button and no checkbox.
      component['session'].regressionTestResults = [{ sentence_id: 'S1' } as any];
      component['session'].lastGswbOutputs = {} as any;

      component.runInference();

      expect(ran).toHaveBeenCalledWith(true);
    });
  });

  /** The inference report lists every NLI item, not only the ones with a verdict. */
  describe('inference report rows', () => {
    beforeEach(() => {
      component['session'].regressionTestResults = [{ sentence_id: 'S1' } as any];
      component['session'].sentenceMap = { S1: 'A dog barks.', S2: 'A dog exists.' };
      component['session'].regressionTestItems = [
        { id: 'n1', premises: ['S1'], conclusion: ['S2'], gold_label: '1' },
        { id: 'n2', premises: ['S1'], conclusion: ['S2'], gold_label: '0' },
      ];
      component['session'].lastGswbOutputs = {
        S1: { solutions: [{ id: 'a' }], log: '', derivation: null, discriminants: [] },
        S2: { solutions: [{ id: 'b' }], log: '', derivation: null, discriminants: [] },
      } as any;
    });

    it('lists items that have not run, with no predicted label', () => {
      const rows = component.inferenceReportRows;

      expect(rows.map(row => row.id)).toEqual(['n1', 'n2']);
      expect(rows.every(row => row.status === 'pending')).toBeTrue();
      expect(rows[0].data.predictedLabel).toBe('');
      expect(rows[0].data.premises).toEqual(['A dog barks.']);
      expect(rows[0].data.goldLabel).toBe('1');
    });

    it('shows the verdict once one exists, leaving the others pending', () => {
      component['session'].inferenceResults = [
        { id: 'n1', premises: [], conclusion: '', predictedLabel: '1', goldLabel: '1',
          premiseIds: [], conclusionIds: [], mismatch: false, glyphs: [] },
      ];

      const rows = component.inferenceReportRows;

      expect(rows[0].status).toBe('done');
      expect(rows[0].data.predictedLabel).toBe('1');
      expect(rows[1].status).toBe('pending');
    });

    it('greys out an item whose sentence has no reading, and refuses to select it', () => {
      component['session'].lastGswbOutputs = {
        S1: { solutions: [{ id: 'a' }], log: '', derivation: null, discriminants: [] },
        S2: { solutions: [], log: '', derivation: null, discriminants: [] },
      } as any;

      const rows = component.inferenceReportRows;

      expect(rows[0].status).toBe('unparsed');
      expect(rows[0].selectable).toBeFalse();
      expect(rows[0].unparsedSentences).toEqual(['A dog exists.']);

      component.toggleAllNliItems();

      expect(component.selectedNliItemCount).toBe(0);
    });

    it('marks the item the run is currently on', () => {
      component['vampireActiveItemId'] = 'n2';

      expect(component.inferenceReportRows[1].status).toBe('running');
    });

    it('lists nothing before a parse has produced anything', () => {
      component['session'].regressionTestResults = [];

      expect(component.inferenceReportRows).toEqual([]);
    });

    it('forgets the selection when another session is loaded', () => {
      // Item ids repeat across sessions (n0, n1, ...), so pruning against the new items
      // keeps a stale selection rather than catching it -- and the next run is silently
      // narrowed to whichever ids happen to exist in both.
      component.toggleAllNliItems();
      expect(component.selectedNliItemCount).toBe(2);

      (component as any).resetRuntimeStatus();

      expect(component.selectedNliItemCount).toBe(0);
    });

    it('drops a selection whose item no longer exists', () => {
      component.toggleAllNliItems();
      expect(component.selectedNliItemCount).toBe(2);

      component['session'].regressionTestItems = [
        { id: 'n2', premises: ['S1'], conclusion: ['S2'], gold_label: '0' },
      ];
      component['pruneNliItemSelection']();

      expect(component.selectedNliItemCount).toBe(1);
      expect(component.isNliItemSelected('n2')).toBeTrue();
    });
  });
  /** "Run inference" runs the items you ticked, and nothing else. */
  describe('running a subset of the NLI items', () => {
    let submitted: jasmine.Spy;

    const itemsSubmitted = () => Object.keys(submitted.calls.mostRecent().args[0]);

    beforeEach(() => {
      submitted = spyOn<any>(component, 'submitVampireRequest');
      component['contextPruning'] = { nativeElement: { checked: false } } as any;
      component['session'].sentenceMap = { S1: 'A dog barks.', S2: 'A dog exists.' };
      component['session'].regressionTestItems = [
        { id: 'n1', premises: ['S1'], conclusion: ['S2'], gold_label: '1' },
        { id: 'n2', premises: ['S1'], conclusion: ['S2'], gold_label: '0' },
      ];
      component['session'].lastAnnotations = {} as any;
      component['session'].lastGswbOutputs = {
        S1: { solutions: [derived({ id: 'a', solution: 'p' }, 'prolog-drt')], log: '', derivation: null, discriminants: [] },
        S2: { solutions: [derived({ id: 'b', solution: 'c' }, 'prolog-drt')], log: '', derivation: null, discriminants: [] },
      } as any;
    });

    it('submits every item when nothing is selected', () => {
      (component as any).runVampireFromCurrentState(false);

      expect(itemsSubmitted()).toEqual(['n1', 'n2']);
    });

    it('submits only the selected items', () => {
      component.setNliItemSelected('n1', true);

      (component as any).runVampireFromCurrentState(false);

      expect(itemsSubmitted()).toEqual(['n1']);
    });

    it('reruns a selected item that already has a verdict', () => {
      // The skip that spares unchanged, already-processed items is exactly what would drop
      // the item someone ticked in order to redo it.
      component['session'].inferenceResults = [
        { id: 'n1', premises: [], conclusion: '', predictedLabel: '1', goldLabel: '1',
          premiseIds: [], conclusionIds: [], mismatch: false, glyphs: [] },
      ];
      component.setNliItemSelected('n1', true);

      (component as any).runVampireFromCurrentState(false);

      expect(itemsSubmitted()).toEqual(['n1']);
    });

    it('still skips an unchanged, already-processed item when nothing is selected', () => {
      component['session'].inferenceResults = [
        { id: 'n1', premises: [], conclusion: '', predictedLabel: '1', goldLabel: '1',
          premiseIds: [], conclusionIds: [], mismatch: false, glyphs: [] },
      ];

      (component as any).runVampireFromCurrentState(false);

      expect(itemsSubmitted()).toEqual(['n2']);
    });
  });

  /** Building the TPTP checks is part of the run: until it hands over to Vampire nothing may
   *  start another run or switch the session under it, and abort stops it locally. */
  describe('while the TPTP checks are being built', () => {
    let submitted: jasmine.Spy;
    let prepare: jasmine.Spy;
    let preparation: Subject<any>;

    beforeEach(() => {
      submitted = spyOn<any>(component, 'submitVampireRequest');
      preparation = new Subject<any>();
      prepare = spyOn<any>(component, 'reasonOverItem').and.returnValue(preparation.asObservable());
      component['contextPruning'] = { nativeElement: { checked: false } } as any;
      component['session'].gswbPreferences.outputstyle = 5;
      component['session'].sentenceMap = { S1: 'A dog barks.', S2: 'A dog exists.' };
      component['session'].regressionTestItems = [
        { id: 'n1', premises: ['S1'], conclusion: ['S2'], gold_label: '1' },
      ];
      component['session'].regressionTestResults = [{ sentence_id: 'S1' } as any];
      component['session'].lastAnnotations = {} as any;
      component['session'].lastGswbOutputs = {
        S1: { solutions: [derived({ id: 'a', semantic: 'p', graph: { nodes: [], edges: [] } })],
          log: '', derivation: null, discriminants: [] },
        S2: { solutions: [derived({ id: 'b', semantic: 'c', graph: { nodes: [], edges: [] } })],
          log: '', derivation: null, discriminants: [] },
      } as any;
      // Run inference reasons over the selected (disambiguated) readings.
      component['session'].selectedSolutionIdsBySentence = { S1: ['a'], S2: ['b'] };
    });

    it('holds the run lock from the start of the run', () => {
      component.runInference();

      expect(prepare).toHaveBeenCalledTimes(1);
      expect(component.preparingInference).toBeTrue();
      expect(component.runLocked).toBeTrue();
      expect(component.canRunInference).toBeFalse();
      expect(component.isSessionActionLocked).toBeTrue();
      expect(component.canAbortRun).toBeTrue();
    });

    it('starts no second run, neither inference nor parse', () => {
      const parse = spyOn<any>(component, 'parse_testfile');
      // A parse that got through would ask before overwriting; a real confirm() blocks the browser.
      spyOn<any>(component, 'confirmWriteModeOverwrite').and.returnValue(true);
      component.runInference();

      component.runInference();
      component.batchParse('A dog barks.');

      expect(prepare).toHaveBeenCalledTimes(1);
      expect(parse).not.toHaveBeenCalled();
    });

    it('aborts locally: nothing is cancelled at, or later sent to, Vampire', () => {
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      component.runInference();

      component.abortCurrentRun();
      preparation.next({ itemId: 'n1', assignments: [], failures: [], degradations: [] });
      preparation.complete();

      expect(dataServiceSpy.requestVampireCancel).not.toHaveBeenCalled();
      expect(submitted).not.toHaveBeenCalled();
      expect(component.loading).toBeFalse();
      expect(component.preparingInference).toBeFalse();
      expect(component['session'].report?.inference?.failure).toBe('aborted');
    });

    it('releases the lock when no checks could be built', () => {
      component.runInference();

      preparation.next({ itemId: 'n1', assignments: [], failures: ['n1: no reading'], degradations: [] });
      preparation.complete();

      expect(submitted).not.toHaveBeenCalled();
      expect(component.loading).toBeFalse();
      expect(component.preparingInference).toBeFalse();
    });

    it('releases the lock when building fails', () => {
      component.runInference();

      preparation.error(new Error('collapse failed'));

      expect(component.loading).toBeFalse();
      expect(component.preparingInference).toBeFalse();
      expect(component['session'].report?.inference?.failure).toBe('reasoning checks could not be built');
    });

    it('releases the lock when there is nothing to run', () => {
      // Already reasoned over, with the readings selected now: nothing to redo.
      component['session'].lastVampireSolutionIdsBySentence = { S1: ['a'], S2: ['b'] };
      component['session'].inferenceResults = [
        { id: 'n1', premises: [], conclusion: '', predictedLabel: '1', goldLabel: '1',
          premiseIds: [], conclusionIds: [], mismatch: false, glyphs: [] },
      ];

      component.runInference();

      expect(prepare).not.toHaveBeenCalled();
      expect(component.loading).toBeFalse();
      expect(component.preparingInference).toBeFalse();
    });

    it('leaves the lock to the run that superseded it', () => {
      component.runInference();
      // A newer run took over (as an abort-and-rerun would): the old chain's failure must
      // not unlock the view under it.
      component['vampireRunToken']++;

      preparation.error(new Error('late failure of the superseded run'));

      expect(component.loading).toBeTrue();
    });
  });

  /** The logic type is a property of the inference run, not of the parse: switching fof ->
   *  tff and rerunning used to type the checks for the parse-time logic while the request
   *  named the new one, and Vampire rejected every problem. */
  describe('logic type of an inference run', () => {
    let submitted: jasmine.Spy;

    beforeEach(() => {
      submitted = spyOn<any>(component, 'submitVampireRequest');
      component['contextPruning'] = { nativeElement: { checked: false } } as any;
      component['session'].sentenceMap = { S1: 'A dog barks.', S2: 'A dog exists.' };
      component['session'].regressionTestItems = [
        { id: 'n1', premises: ['S1'], conclusion: ['S2'], gold_label: '1' },
      ];
      component['session'].axiomsText = 'tff(t, type, t: $o).';
      component['session'].lastAnnotations = {
        S1: { solutions: [{ axioms: { prolog: ['all(X,p(X))'], tptp: ['![X]: q(X)'],
          tffTypes: ['big: ($i * $int) > $o'] } }] },
        // Parsed before types existed: no tffTypes.
        S2: { solutions: [{ axioms: { prolog: ['all(X,p(X))'], tptp: [] } }] },
      } as any;
      component['session'].lastGswbOutputs = {
        S1: { solutions: [derived({ id: 'a', solution: 'p' }, 'prolog-drt')], log: '', derivation: null, discriminants: [] },
        S2: { solutions: [derived({ id: 'b', solution: 'c' }, 'prolog-drt')], log: '', derivation: null, discriminants: [] },
      } as any;
      // Parsed while fof was selected; tff selected since.
      component['session'].lastLogicType = 'fof';
      component['vampirePreferences'].vampirePreferences = { logic_type: 1 } as any;
    });

    it('is read when the run starts and recorded for it', () => {
      (component as any).runVampireFromCurrentState(false);

      expect(component['session'].lastLogicType).toBe('tff');
      expect((component as any).runVampirePreferences.logic_type).toBe(1);
    });

    it('types the reasoning checks for that logic', () => {
      component['session'].gswbPreferences.outputstyle = 5;
      // LFGxDRT reasons only over readings with a semantic graph.
      for (const output of Object.values(component['session'].lastGswbOutputs!)) {
        output.solutions.forEach((solution: any) => solution.semanticAnalysis.graph = { nodes: [], edges: [] });
      }
      const prepare = spyOn<any>(component, 'reasonOverItem').and.returnValue(EMPTY);

      (component as any).runVampireFromCurrentState(false);

      expect(prepare).toHaveBeenCalled();
      expect(prepare.calls.mostRecent().args[3]).toBeTrue();
    });

    it('sends the rules\' axioms untranslated, next to the rule set\'s TPTP', () => {
      (component as any).runVampireFromCurrentState(false);

      const item = submitted.calls.mostRecent().args[0]['n1'];
      expect(item.axioms).toBe('tff(t, type, t: $o).');
      expect(item.grammar_axioms).toEqual({ prolog: ['all(X,p(X))'], tptp: ['![X]: q(X)'],
        tffTypes: ['big: ($i * $int) > $o'] });
    });

    it('refuses a session whose axioms were encoded at parse time, rather than dropping them', () => {
      component['session'].lastAnnotations = {
        S1: { solutions: [{ axioms: ['(![A]: p(A))'] }] },
      } as any;

      (component as any).runVampireFromCurrentState(false);

      expect(submitted).not.toHaveBeenCalled();
    });

    it('sends the settings the run started with, even if they change meanwhile', () => {
      submitted.and.callThrough();
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      dataServiceSpy.clearVampireProgress.and.returnValue(of({}) as any);
      dataServiceSpy.callBatchVampire.and.returnValue(EMPTY as any);
      (component as any).runVampireFromCurrentState(false);
      component['vampirePreferences'].vampirePreferences = { logic_type: 0 } as any;

      (component as any).submitVampireRequest(
        { n1: { premises: [], hypothesis: [], axioms: '' } }, false, Date.now(), component['vampireRunToken'], true);

      expect(dataServiceSpy.callBatchVampire.calls.mostRecent().args[0].vampire_preferences.logic_type).toBe(1);
    });
  });

  /** Aborting must stop a run that has not been submitted yet. */
  describe('aborting during NLI preparation', () => {
    it('stops the preparation chain and refuses its late submission', () => {
      const dataServiceSpy = TestBed.inject(DataService) as jasmine.SpyObj<DataService>;
      dataServiceSpy.requestVampireCancel.and.returnValue(new Subject<any>().asObservable() as any);
      const preparation = jasmine.createSpyObj('Subscription', ['unsubscribe']);
      component['nliPreparationSubscription'] = preparation;
      component.loading = true;
      const staleToken = component['vampireRunToken'];

      component.abortCurrentRun();

      expect(preparation.unsubscribe).toHaveBeenCalled();
      expect(component['vampireRunToken']).not.toBe(staleToken);

      // What the aborted chain would do if it ran to completion in the browser anyway.
      (component as any).submitVampireRequest({}, false, Date.now(), staleToken, true);

      expect(dataServiceSpy.callBatchVampire).not.toHaveBeenCalled();
    });
  });

  /** "Parse" with sentences ticked in the parsing report reparses just those. */
  describe('reparsing selected sentences', () => {
    const out = (id: string) => ({ solutions: [{ id, semantic: id, solution: id }], log: '', derivation: null, discriminants: [] });
    let dataService: any;

    beforeEach(() => {
      dataService = TestBed.inject(DataService);
      dataService.ligerBatchAnnotate = jasmine.createSpy('ligerBatchAnnotate').and.callFake((request: any) => of({
        annotations: Object.fromEntries(Object.keys(request.sentences).map(id => [id, { solutions: [{ id: `new-${id}` }] }])),
      }));
      component['gswbPreferences'] = {
        gswbPreferences: { outputstyle: 5 }, onSubmit: () => {},
        gswbPreferencesForm: { valueChanges: of([]) }, updateFormFromPreferences: () => {},
      } as any;
      component.sentenceMap = { S1: 'A man appeared.', S2: 'He smiled.', S3: 'A dog barked.', S4: 'A dog exists.' };
      component.regressionTestItems = [
        { id: 'n1', premises: ['S1'], conclusion: ['S2'], gold_label: '1' },
        { id: 'n2', premises: ['S3'], conclusion: ['S4'], gold_label: '1' },
      ];
      component.session.testsuiteText = 'the stored testsuite';
      component.session.enableInference = false;
      component.session.lastAnnotations = { S1: {}, S2: {}, S3: { old: true }, S4: { old: true } } as any;
      component.session.lastGswbOutputs = { S1: out('old-1'), S2: out('old-2'), S3: out('old-3'), S4: out('old-4') } as any;
      component.session.selectedSolutionIdsBySentence = { S1: ['old-1'], S3: ['old-3'] };
      component.session.report = { parse: null, inference: { kept: true } as any };
      component.regressionTestResults = ['S1', 'S2', 'S3', 'S4'].map(id => ({ sentence_id: id } as any));
      dataService.gswbBatchDeduce = jasmine.createSpy('gswbBatchDeduce').and.callFake((request: any) => of({
        outputs: Object.fromEntries(Object.keys(request.items).map(id => [id, out(`new-${id}`)])), report: '',
      }));
      spyOn<any>(component, 'batchProofInputs').and.callFake((id: string) => [{ proofId: id, meaningConstructors: `mc-${id}` }]);
    });

    it('parses and derives just the ticked sentences, on their own, and keeps the others', () => {
      const confirm = spyOn<any>(component, 'confirmWriteModeOverwrite');
      const reread = spyOn<any>(component, 'parse_testfile');
      component.setParseSentenceSelected('S1', true);

      component.parse('the testsuite as now edited');

      expect(confirm).not.toHaveBeenCalled();
      expect(reread).not.toHaveBeenCalled();
      expect(Object.keys(dataService.ligerBatchAnnotate.calls.mostRecent().args[0].sentences)).toEqual(['S1']);
      expect(Object.keys(dataService.gswbBatchDeduce.calls.mostRecent().args[0].items)).toEqual(['S1']);

      const outputs = component.session.lastGswbOutputs as any;
      expect(outputs.S1.solutions[0].id).toBe('new-S1');
      expect(outputs.S2.solutions[0].id).toBe('old-2');
      expect(outputs.S3.solutions[0].id).toBe('old-3');
      expect((component.session.lastAnnotations as any).S3).toEqual({ old: true });
      // The reparsed sentence's old disambiguation is gone; the other one stays.
      expect(component.session.selectedSolutionIdsBySentence['S1']).toEqual(['new-S1']);
      expect(component.session.selectedSolutionIdsBySentence['S3']).toEqual(['old-3']);
      expect(component.regressionTestResults.map(result => result.sentence_id)).toEqual(['S1', 'S2', 'S3', 'S4']);
      expect(component.session.testsuiteText).toBe('the stored testsuite');
      expect(component.session.report!.inference).toEqual({ kept: true } as any);
      // The items over the reparsed sentences are what "Run inference" runs next.
      expect(component.selectedNliItemCount).toBe(1);
      expect(component.isNliItemSelected('n1')).toBeTrue();
      expect(component.selectedParseSentenceCount).toBe(0);
    });

    it('parses the whole testsuite when nothing is ticked', () => {
      const batchParse = spyOn(component, 'batchParse');
      component.parse('the testsuite');
      expect(batchParse).toHaveBeenCalledWith('the testsuite');
    });
  });
});
