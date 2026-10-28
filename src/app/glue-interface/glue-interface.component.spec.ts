import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventEmitter, NO_ERRORS_SCHEMA } from '@angular/core';
import { Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { DataService } from '../data.service';
import { MISSING_PRAGMATICS_MESSAGE, SentenceAnalysis, SequenceAnalysis } from '../models/models';
import { LigerWorkspaceService } from '../liger-workspace/liger-workspace.service';
import { SyntaxSourceService } from '../syntax-source/syntax-source.service';
import { AnalysisWorkspaceStateService } from '../analysis-workspace-state.service';

import { GlueInterfaceComponent } from './glue-interface.component';

/** A derived reading as GSWB sends it: its text and graph only in semanticAnalysis. */
const derived = ({ semantic, graph, ...rest }: any): any => ({
  ...rest,
  semanticAnalysis: {
    syntacticOrigin: 'syn', semId: rest.id ?? 'sem', semString: semantic, graph, semType: 'lfgxdrt',
  },
});

describe('GlueInterfaceComponent', () => {
  let component: GlueInterfaceComponent;
  /** Stands in for LigerWorkspaceService: post-processing runs its pragmatics. */
  let ligerWorkspace: { pragmatics: string | null };
  let fixture: ComponentFixture<GlueInterfaceComponent>;
  let routerMock: { navigate: jasmine.Spy };
  let dataServiceMock: {
    ligerMergeStructure: jasmine.Spy;
    ligerApplyRulesToStructure: jasmine.Spy;
    gswbGeneratePcdrs: jasmine.Spy;
    gswbCollapseAnaphora: jasmine.Spy;
    clearAnalysisDocument: jasmine.Spy;
    saveAnalysisDocument: jasmine.Spy;
    lmRankAnaphora: jasmine.Spy;
  };

  beforeEach(() => {
    routerMock = {
      navigate: jasmine.createSpy('navigate')
    };
    dataServiceMock = {
      ligerMergeStructure: jasmine.createSpy('ligerMergeStructure').and.returnValue(of({
        graph: { graphElements: [{ data: { id: 'm1', label: 'merged' } }] },
        structureJson: { id: 'merged-graph', text: 'merged graph', constraints: [], annotations: [], choiceSpace: {} }
      })),
      ligerApplyRulesToStructure: jasmine.createSpy('ligerApplyRulesToStructure').and.returnValue(of({ annotations: [] })),
      gswbGeneratePcdrs: jasmine.createSpy('gswbGeneratePcdrs').and.returnValue(of({
        solutions: [{ id: 's1-pcdrs-1', solution: '<svg></svg>' }]
      })),
      gswbCollapseAnaphora: jasmine.createSpy('gswbCollapseAnaphora').and.callFake((request: any) => of({
        id: `${request.parentSolutionId}-collapsed`, solution: '<svg></svg>'
      })),
      clearAnalysisDocument: jasmine.createSpy('clearAnalysisDocument').and.returnValue(of({})),
      lmRankAnaphora: jasmine.createSpy('lmRankAnaphora').and.returnValue(new Subject()),
      saveAnalysisDocument: jasmine.createSpy('saveAnalysisDocument').and.callFake((sessionKey: string, document: any) => of({
        status: 'ok',
        document: { ...document, revision: 1, createdAt: 'now', updatedAt: 'now' },
      })),
    };

    ligerWorkspace = { pragmatics: 'PRAGMATICS RULES' };

    TestBed.configureTestingModule({
      declarations: [GlueInterfaceComponent],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: DataService, useValue: dataServiceMock },
        { provide: LigerWorkspaceService, useValue: ligerWorkspace },
      ],
      schemas: [NO_ERRORS_SCHEMA]
    });
    fixture = TestBed.createComponent(GlueInterfaceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('switching between XLE and UD starts a new discourse whose document records the parser', () => {
    const syntaxSource = TestBed.inject(SyntaxSourceService);
    const workspaceState = TestBed.inject(AnalysisWorkspaceStateService);
    workspaceState.saveLiger({ sentence: 'A dog barked.' } as any);
    const before = component.analysisDocumentSessionId;
    dataServiceMock.clearAnalysisDocument.calls.reset();
    component.liger = jasmine.createSpyObj('LigerVisComponent', ['resetForNewDiscourse']);
    component.glue = jasmine.createSpyObj('GswbVisComponent', ['resetForNewDiscourse']);

    syntaxSource.select({ kind: 'ud', model: 'en' });

    expect(component.analysisDocumentSessionId).not.toBe(before);
    expect(dataServiceMock.clearAnalysisDocument).toHaveBeenCalledWith(before);
    expect((component as any).analysisDocument.parser).toEqual({ kind: 'ud', model: 'en' });
    // The saved view state was parsed with XLE: a later visit starts afresh too.
    expect(workspaceState.getState().liger).toBeNull();

    syntaxSource.select({ kind: 'ud', model: 'de' });
    expect((component as any).analysisDocument.parser).toEqual({ kind: 'ud', model: 'en' });
    syntaxSource.select({ kind: 'xle' });
    expect((component as any).analysisDocument.parser).toBeUndefined();
  });

  it('blocks post-processing, and says why, while the rule set has no pragmatics rules', () => {
    component.liger = { structureJson: { id: 'syntax-graph' } } as any;
    component.glue = {
      semvis: { index: 0, items: [derived({ graph: { id: 'drs-1' } })] },
      gswbPreferences: { gswbPreferences: { betaReduce: true } },
    } as any;
    ligerWorkspace.pragmatics = null;

    expect(component.postProcessingBlockedReason()).toBe(MISSING_PRAGMATICS_MESSAGE);
    component.handlePostProcessing('inline');

    expect(dataServiceMock.ligerMergeStructure).not.toHaveBeenCalled();
    expect(component.postProcessingLoading).toBeFalse();

    ligerWorkspace.pragmatics = 'PRAGMATICS RULES';
    expect(component.postProcessingBlockedReason()).toBeNull();
  });

  it('should navigate to the graph inspector', () => {
    component.liger = {
      structureJson: { id: 'syntax-graph', text: 'syntax graph', constraints: [], annotations: [], choiceSpace: {} }
    } as any;
    component.glue = {
      semvis: {
        index: 0,
        items: [derived({
          id: 'drs-1',
          semantic: 'drs example',
          graph: { id: 'drs-1', text: 'drs example', constraints: [], annotations: [], choiceSpace: {} }
        })]
      },
      gswbPreferences: {
        gswbPreferences: { betaReduce: true }
      }
    } as any;

    component.openMergedGraphInspector();

    expect(dataServiceMock.ligerMergeStructure).toHaveBeenCalled();
    expect(dataServiceMock.ligerMergeStructure.calls.mostRecent().args[0].syntax).toBeTruthy();
    expect(routerMock.navigate).toHaveBeenCalled();
    const [commands, extras] = routerMock.navigate.calls.mostRecent().args;
    expect(commands).toEqual(['/graph-inspector']);
    expect(extras.state.uploadedFormat).toBe('json');
    expect(extras.state.uploadedFileName).toBe('merged-graph.json');
    expect(extras.state.uploadedContent).toContain('merged-graph');
    expect(extras.state.uploadedContent).toContain('constraints');
  });

  it('should display the same merged response inline without navigating', () => {
    component.liger = {
      structureJson: { id: 'syntax-graph' }
    } as any;
    component.glue = {
      semvis: {
        index: 0,
        items: [derived({ graph: { id: 'drs-1' } })]
      },
      gswbPreferences: {
        gswbPreferences: { betaReduce: true }
      }
    } as any;

    component.handlePostProcessing('inline');

    expect(routerMock.navigate).not.toHaveBeenCalled();
    expect(component.showInlinePostProcessing).toBeTrue();
    expect(component.mergedStructureContent).toContain('merged-graph');
    expect(component.mergedGraphElements).toEqual([{ data: { id: 'm1', label: 'merged' } }]);
  });

  it('does not allow graph post-processing for non-beta-reduced semantics', () => {
    component.liger = {
      structureJson: { id: 'syntax-graph' }
    } as any;
    component.glue = {
      semvis: {
        index: 0,
        items: [derived({ graph: { id: 'drs-1' } })]
      },
      gswbPreferences: {
        gswbPreferences: { betaReduce: false }
      }
    } as any;

    expect(component.canOpenMergedGraphInspector()).toBeFalse();
  });

  it('allows graph post-processing for beta-reduced unresolved DRSs', () => {
    component.liger = {
      structureJson: { id: 'syntax-graph' }
    } as any;
    component.glue = {
      semvis: {
        index: 0,
        items: [derived({ graph: { id: 'drs-1' } })]
      },
      gswbPreferences: {
        gswbPreferences: { betaReduce: true, resolveDrs: false }
      }
    } as any;

    expect(component.canOpenMergedGraphInspector()).toBeTrue();
  });

  it('merges every semantic solution when no discriminant is selected', () => {
    component.liger = {
      structureJson: { id: 'syntax-graph' }
    } as any;
    const first = derived({ id: 'drs-1', semantic: 'first', graph: { id: 'drs-1' } });
    const second = derived({ id: 'drs-2', semantic: 'second', graph: { id: 'drs-2' } });
    component.glue = {
      semvis: {
        index: 0,
        items: [first],
        allItems: [first, second],
        selectedScopeIds: [],
        selectedMcIds: []
      },
      gswbPreferences: { gswbPreferences: { betaReduce: true } }
    } as any;

    component.handlePostProcessing('inline');

    expect(dataServiceMock.ligerMergeStructure).toHaveBeenCalledTimes(2);
    expect(component.postProcessingResults.map(result => result.semanticSolution.id))
      .toEqual(['drs-1', 'drs-2']);
  });

  it('merges each sequence reading with the structure of its own parse pairing, not the sequence\'s first', () => {
    // "every person saw the cat" + "it was cute": the expletive and the pronoun parse give
    // two syntax entries; the pronoun reading's SRC ids only line up with its own.
    component.liger = { structureJson: { id: 'syntax-graph' } } as any;
    const sequence: SequenceAnalysis = {
      id: 'sentence-1+sentence-2',
      text: 'every person saw the cat\nit was cute',
      sentenceIds: ['sentence-1', 'sentence-2'],
      syntax: [
        { synId: 'S0+S1', structure: { id: 'expletive-pairing' } as any, graph: { graphElements: [] } },
        { synId: 'S0+S2', structure: { id: 'pronoun-pairing' } as any, graph: { graphElements: [] } },
      ],
      semantics: [
        { syntacticOrigin: 'S0+S1', semId: 'sem-expletive', semString: 'E', semType: 'lfgxdrt' },
        { syntacticOrigin: 'S0+S2', semId: 'sem-pronoun', semString: 'P', semType: 'lfgxdrt' },
      ],
      synSemMapping: { 'S0+S1': ['sem-expletive'], 'S0+S2': ['sem-pronoun'] },
    };
    const pronoun = derived({ id: 'sem-pronoun', semantic: 'P', graph: { id: 'drs-pronoun' }, sequenceAnalysis: sequence });
    component.glue = {
      semvis: { index: 0, items: [pronoun], allItems: [pronoun], selectedScopeIds: [], selectedMcIds: [] },
      gswbPreferences: { gswbPreferences: { betaReduce: true } },
    } as any;

    component.handlePostProcessing('inline');

    expect(dataServiceMock.ligerMergeStructure.calls.mostRecent().args[0].syntax.id).toBe('pronoun-pairing');
  });

  it('merges only discriminant-selected semantic solutions', () => {
    component.liger = {
      structureJson: { id: 'syntax-graph' }
    } as any;
    const first = derived({ id: 'drs-1', graph: { id: 'drs-1' } });
    const second = derived({ id: 'drs-2', graph: { id: 'drs-2' } });
    component.glue = {
      semvis: {
        items: [second],
        allItems: [first, second],
        selectedScopeIds: ['scope-1'],
        selectedMcIds: []
      },
      gswbPreferences: { gswbPreferences: { betaReduce: true } }
    } as any;

    component.handlePostProcessing('inline');

    expect(dataServiceMock.ligerMergeStructure).toHaveBeenCalledTimes(1);
    expect(dataServiceMock.ligerMergeStructure.calls.mostRecent().args[0].drs.id).toBe('drs-2');
  });

  it('generates PCDRS only from the selected merged solution', () => {
    component.showInlinePostProcessing = true;
    component.mergedStructureContent = JSON.stringify({
      constraints: [],
      annotations: [],
      choiceSpace: {}
    });
    component.glue = {
      semvis: {
        index: 0,
        items: [derived({ id: 's1', semantic: '([x1],[dog(x1)])', graph: { id: 'drs-1' } })]
      }
    } as any;

    component.generatePcdrs();

    expect(dataServiceMock.gswbGeneratePcdrs).toHaveBeenCalledWith({
      semantic: '([x1],[dog(x1)])',
      parentSolutionId: 's1',
      mergedStructure: { constraints: [], annotations: [], choiceSpace: {} },
      // No rules ran: GSWB gives the default reading.
      rulesApplied: false,
      // The analysis view shows its readings.
      includeSvg: true,
    });
    expect(component.pcdrsSolutions.length).toBe(1);
  });

  it('applies rules separately to every merged graph', () => {
    const ruleResult = {
      annotations: [{ graph: { graphElements: [] }, appliedRules: [], structureJson: { id: 'annotated' } }]
    } as any;
    component.postProcessingResults = [{
      semanticSolution: derived({ id: 's1', graph: { id: 'd1' } }),
      structureContent: '{"id":"d1"}',
      graphElements: [],
      ruleAnnotations: [],
      rulesApplied: false
    }, {
      semanticSolution: derived({ id: 's2', graph: { id: 'd2' } }),
      structureContent: '{"id":"d2"}',
      graphElements: [],
      ruleAnnotations: [],
      rulesApplied: false
    }];
    component.inlineGraphInspector = { rulesText: 'rule text' } as any;

    component.onRulesApplied(ruleResult);

    expect(dataServiceMock.ligerApplyRulesToStructure).toHaveBeenCalledTimes(1);
    expect(component.postProcessingResults[0].ruleAnnotations).toEqual(ruleResult.annotations);
    expect(component.postProcessingResults[1].rulesApplied).toBeTrue();
  });

  it('restores the selected rule result when navigating merged graphs', () => {
    const showStructure = jasmine.createSpy('showStructure');
    const showRuleAnnotations = jasmine.createSpy('showRuleAnnotations');
    component.inlineGraphInspector = { showStructure, showRuleAnnotations } as any;
    component.postProcessingResultsReady = true;
    component.postProcessingResults = [{
      semanticSolution: { id: 's1' } as any,
      structureContent: '{"id":"base-1"}',
      graphElements: [{ data: { id: 'base-1' } }],
      ruleAnnotations: [{ structureJson: { id: 'rule-1' } } as any],
      rulesApplied: true,
      annotatedStructureContent: '{"id":"rule-1"}',
      annotatedGraphElements: [{ data: { id: 'rule-1' } }],
    }, {
      semanticSolution: { id: 's2' } as any,
      structureContent: '{"id":"base-2"}',
      graphElements: [{ data: { id: 'base-2' } }],
      ruleAnnotations: [{ structureJson: { id: 'rule-2' } } as any],
      rulesApplied: true,
      annotatedStructureContent: '{"id":"rule-2"}',
      annotatedGraphElements: [{ data: { id: 'rule-2' } }],
    }];

    component.nextPostProcessingResult();

    expect(showStructure).toHaveBeenCalledWith('{"id":"rule-2"}', [{ data: { id: 'rule-2' } }]);
    expect(showRuleAnnotations).toHaveBeenCalledWith(component.postProcessingResults[1].ruleAnnotations);
  });

  it('keeps merged-graph navigation disabled during the initial rule request', () => {
    component.postProcessingResultsReady = true;
    component.postProcessingResults = [{}, {}] as any;
    component.inlineGraphInspector = { loading: true } as any;

    expect(component.canNavigatePostProcessing()).toBeFalse();

    component.inlineGraphInspector.loading = false;
    expect(component.canNavigatePostProcessing()).toBeTrue();
  });

  it('reports applied rules only after every merged graph is processed', () => {
    component.postProcessingResults = [
      { rulesApplied: true } as any,
      { rulesApplied: false } as any,
    ];

    expect(component.allPostProcessingRulesApplied()).toBeFalse();

    component.postProcessingResults[1].rulesApplied = true;
    expect(component.allPostProcessingRulesApplied()).toBeTrue();
  });

  it('keeps the rules status pending while the graph inspector is loading', () => {
    component.postProcessingResults = [{ rulesApplied: true } as any];
    component.inlineGraphInspector = { loading: true } as any;

    expect(component.rulesApplicationInProgress()).toBeTrue();
    expect(component.allPostProcessingRulesApplied()).toBeFalse();
  });

  describe('anaphora ranking', () => {
    const sentence = {
      id: 'sentence-1',
      text: 'the big cat ate the black dog it barked',
      syntax: [{ synId: 'syn-1', structure: { id: 'syn' }, graph: { graphElements: [] } }],
      semantics: [{ syntacticOrigin: 'syn-1', semId: 's1', semString: 'P', semType: 'lfgxdrt', graph: { id: 'drs' } }],
      synSemMapping: { 'syn-1': ['s1'] },
    } as any;
    const binding = (antecedent: string) => [{ pronounReferentId: 's1:4', pronounDisplay: 'x4', antecedent, stateLabel: 's1' }];
    const ranking = {
      method: 'cosine-description', model: 'test-model', layers: [-1], pooling: 'mean', createdAt: 'now',
      relations: [
        { semanticOrigin: 's1', pronoun: 'x4', antecedent: 'x2', pronounText: 'it', antecedentText: 'the black dog', score: 0.894, cosine: 0.788, recencyRank: 1 },
        { semanticOrigin: 's1', pronoun: 'x4', antecedent: 'x1', pronounText: 'it', antecedentText: 'the big cat', score: 0.908, cosine: 0.816, recencyRank: 2 },
      ],
      branches: [{ discourseId: 's1-pcdrs-1', score: 0.894, rank: 2 }, { discourseId: 's1-pcdrs-2', score: 0.908, rank: 1 }],
      warnings: [],
    };
    const storedUpdate = () => (component as any).analysisDocument.discourseUpdates?.[0];
    const shownIds = () => component.pcdrsDisplaySolutions.map(solution => solution.id);

    beforeEach(() => {
      // What the `ranking` fixture was computed with.
      component.anaphoraRankerPreferences = { anaphora_rankers: ['cosine-description'], anaphora_averager: 'borda' };
      (component as any).analysisDocument.sentences.push(sentence);
      (component as any).analysisDocument.elements.push({ kind: 'sentence', id: 'sentence-1' });
      dataServiceMock.gswbGeneratePcdrs.and.returnValue(of({
        solutions: [
          { id: 's1-pcdrs-1', solution: '<svg></svg>', semantic: 'A:[a(x4,x2)]', anaphoraRelations: binding('x2') },
          { id: 's1-pcdrs-2', solution: '<svg></svg>', semantic: 'A:[a(x4,x1)]', anaphoraRelations: binding('x1') },
        ],
      }));
      component.showInlinePostProcessing = true;
      component.mergedStructureContent = '{"constraints":[],"annotations":[]}';
      component.postProcessingResults = [{
        semanticSolution: derived({ id: 's1', semantic: 'P', sentenceAnalysis: sentence }),
        structureContent: '{"id":"d1"}',
        graphElements: [],
        ruleAnnotations: [{ structureJson: { id: 'd1a' } } as any],
        rulesApplied: true,
      }];
    });

    it('stores the PCDRS at once, then hands the sem view the ranking lm returns', () => {
      const lm = new Subject<any>();
      dataServiceMock.lmRankAnaphora.and.returnValue(lm);

      component.generatePcdrs();
      fixture.detectChanges();

      expect(storedUpdate().discourse.map((entry: any) => entry.id)).toEqual(['s1-pcdrs-1', 's1-pcdrs-2']);
      expect(storedUpdate().anaphoraRanking).toBeUndefined();
      expect(shownIds()).toEqual(['s1-pcdrs-1', 's1-pcdrs-2']);
      expect(fixture.nativeElement.querySelector('.pcdrs-ranking-status')?.textContent).toContain('Ranking with the language model');
      expect(dataServiceMock.lmRankAnaphora.calls.mostRecent().args[0]).toEqual({
        syntax: { 'syn-1': { id: 'syn' } },
        semantics: [{ semanticOrigin: 's1', syntacticOrigin: 'syn-1', drs: { id: 'drs' } }],
        branches: [
          { discourseId: 's1-pcdrs-1', semanticOrigin: 's1', relations: [{ pronoun: 'x4', antecedent: 'x2' }] },
          { discourseId: 's1-pcdrs-2', semanticOrigin: 's1', relations: [{ pronoun: 'x4', antecedent: 'x1' }] },
        ],
        methods: ['cosine-description'],
        averager: 'borda',
      });

      lm.next(ranking);
      lm.complete();
      fixture.detectChanges();

      expect(storedUpdate().anaphoraRanking).toEqual(ranking);
      expect(dataServiceMock.lmRankAnaphora).toHaveBeenCalledTimes(1);
      // In generation order, captions aligned: the sem view orders them by its options.
      expect(shownIds()).toEqual(['s1-pcdrs-1', 's1-pcdrs-2']);
      expect(component.pcdrsDisplayLabels[1]).toBe('rank 1');
      expect(component.pcdrsDisplayRankings[1]?.rows).toEqual([['it', 'the big cat', '0.908', 'cos 0.82', '', '2']]);
      expect(component.pcdrsReadingOrder?.updates[0].anaphoraRanking).toEqual(ranking);
      expect(component.pcdrsReadingOrder?.averager).toBe('borda');
      expect(fixture.nativeElement.querySelector('.pcdrs-ranking-status')?.textContent).toContain('Ranked by test-model');
    });

    it('stores a ranking lm computed with other rankers once, without asking again', () => {
      // An lm image without ranker fusion ignores `methods`: its answer never matches.
      component.anaphoraRankerPreferences = { anaphora_rankers: ['mlm-substitution', 'recency'], anaphora_averager: 'borda' };
      const lm = new Subject<any>();
      dataServiceMock.lmRankAnaphora.and.returnValue(lm);
      component.generatePcdrs();
      lm.next(ranking);
      lm.complete();

      expect(storedUpdate().anaphoraRanking).toEqual(ranking);
      expect(dataServiceMock.lmRankAnaphora).toHaveBeenCalledTimes(1);
    });

    it('re-ranks the stored PCDRS when the ranker selection changes, and only then', () => {
      dataServiceMock.lmRankAnaphora.and.returnValue(of(ranking));
      component.generatePcdrs();
      expect(dataServiceMock.lmRankAnaphora).toHaveBeenCalledTimes(1);

      component.onAnaphoraRankersChange({ rankers: ['cosine-description'], averager: 'rrf' });
      expect(dataServiceMock.lmRankAnaphora).toHaveBeenCalledTimes(1);

      const fused = { ...ranking, method: 'borda(cosine-description>recency)', methods: ['cosine-description', 'recency'], averager: 'borda' };
      dataServiceMock.lmRankAnaphora.and.returnValue(of(fused));
      component.onAnaphoraRankersChange({ rankers: ['cosine-description', 'recency'], averager: 'borda' });
      expect(dataServiceMock.lmRankAnaphora).toHaveBeenCalledTimes(2);
      expect(dataServiceMock.lmRankAnaphora.calls.mostRecent().args[0].methods).toEqual(['cosine-description', 'recency']);
      expect(storedUpdate().anaphoraRanking).toEqual(fused);
    });

    it('stores a sem-view selection with the shown discourse, the built-in default otherwise', () => {
      dataServiceMock.lmRankAnaphora.and.returnValue(of(ranking));
      component.generatePcdrs();
      expect(component.pcdrsReadingSelection).toEqual({ selection: { criteria: ['surface'], filters: [], k: null }, own: false });
      const saves = dataServiceMock.saveAnalysisDocument.calls.count();

      component.onPcdrsReadingSelectionChange({ criteria: ['lm'], filters: [], k: 1 });
      expect(storedUpdate().readingSelection).toEqual({ criteria: ['lm'], filters: [], k: 1 });
      expect(component.pcdrsReadingSelection).toEqual({ selection: { criteria: ['lm'], filters: [], k: 1 }, own: true });
      expect(dataServiceMock.saveAnalysisDocument.calls.count()).toBeGreaterThan(saves);

      component.onPcdrsReadingSelectionChange(null);
      expect(storedUpdate().readingSelection).toBeUndefined();
      expect(component.pcdrsReadingSelection?.own).toBeFalse();
    });

    it('works unchanged when lm is down', () => {
      dataServiceMock.lmRankAnaphora.and.returnValue(throwError(() => ({ status: 0 })));

      component.generatePcdrs();
      fixture.detectChanges();

      expect(storedUpdate().discourse.length).toBe(2);
      expect(storedUpdate().anaphoraRanking).toBeUndefined();
      expect(shownIds()).toEqual(['s1-pcdrs-1', 's1-pcdrs-2']);
      expect(component.pcdrsReadingOrder?.updates[0].anaphoraRanking).toBeUndefined();
      expect(fixture.nativeElement.querySelector('.pcdrs-ranking-status')?.textContent)
        .toContain('Ranking unavailable: lm service unreachable');
    });
  });

  it('creates PCDRS for every annotated merged graph', () => {
    component.showInlinePostProcessing = true;
    component.mergedStructureContent = '{"constraints":[],"annotations":[]}';
    component.postProcessingResults = [{
      semanticSolution: derived({ id: 's1', semantic: 'first' }),
      structureContent: '{"id":"d1"}',
      graphElements: [],
      ruleAnnotations: [
        { structureJson: { id: 'd1a' } } as any,
        { structureJson: { id: 'd1b' } } as any
      ],
      rulesApplied: true
    }, {
      semanticSolution: derived({ id: 's2', semantic: 'second' }),
      structureContent: '{"id":"d2"}',
      graphElements: [],
      ruleAnnotations: [{ structureJson: { id: 'd2a' } } as any],
      rulesApplied: true
    }];
    // A distinct reading per branch: identical ones are one reading (see below).
    dataServiceMock.gswbGeneratePcdrs.and.callFake((request: any) => of({
      solutions: [{ id: `${request.parentSolutionId}-pcdrs-1`, solution: '<svg></svg>', semantic: request.parentSolutionId }],
    }));

    component.generatePcdrs();

    expect(dataServiceMock.gswbGeneratePcdrs).toHaveBeenCalledTimes(3);
    expect(component.pcdrsSolutions.length).toBe(3);
    expect(dataServiceMock.gswbGeneratePcdrs.calls.allArgs()
      .map(args => args[0].parentSolutionId))
      .toEqual(['s1-graph-1-rule-1', 's1-graph-1-rule-2', 's2-graph-2-rule-1']);
    // Every branch is the rules': GSWB returns only the readings they propose.
    expect(dataServiceMock.gswbGeneratePcdrs.calls.allArgs()
      .map(args => args[0].rulesApplied))
      .toEqual([true, true, true]);
  });

  it('creates PCDRS only for the selected merged graph', () => {
    component.showInlinePostProcessing = true;
    component.mergedStructureContent = '{"graph":2}';
    component.selectedPostProcessingIndex = 1;
    component.postProcessingResults = [{
      semanticSolution: derived({ id: 's1', semantic: 'sem-1' }),
      structureContent: '{"graph":1}',
      graphElements: [],
      ruleAnnotations: [{ structureJson: { graph: 1 } } as any],
      rulesApplied: true,
    }, {
      semanticSolution: derived({ id: 's2', semantic: 'sem-2' }),
      structureContent: '{"graph":2}',
      graphElements: [],
      ruleAnnotations: [{ structureJson: { graph: 2 } } as any],
      rulesApplied: true,
    }];

    component.generatePcdrs(true);

    expect(dataServiceMock.gswbGeneratePcdrs).toHaveBeenCalledTimes(1);
    expect(dataServiceMock.gswbGeneratePcdrs.calls.mostRecent().args[0].parentSolutionId)
      .toBe('s2-graph-2-rule-1');
  });

  it('resets stale graph inspector state before a new post-processing run', () => {
    component.liger = {
      structureJson: { id: 'syntax-graph' }
    } as any;
    component.glue = {
      semvis: {
        index: 0,
        items: [derived({ id: 's1', graph: { id: 'drs-1' } })]
      },
      gswbPreferences: { gswbPreferences: { betaReduce: true } }
    } as any;
    component.inlineGraphInspector = {
      currentStructureJson: '{"id":"old-annotated"}',
      resetForNewStructure: jasmine.createSpy('resetForNewStructure')
    } as any;

    component.handlePostProcessing('inline');

    expect(component.inlineGraphInspector.resetForNewStructure).toHaveBeenCalled();
  });

  it('uses the rule-applied structure for PCDRS generation', () => {
    component.showInlinePostProcessing = true;
    component.mergedStructureContent = JSON.stringify({ constraints: [], annotations: [] });
    component.inlineGraphInspector = {
      currentStructureJson: JSON.stringify({
        constraints: [],
        annotations: [{ sourceNode: 'd8', relationLabel: 'POSSIBLE-ANT', targetNode: 'd6' }]
      })
    } as any;
    component.glue = {
      semvis: {
        index: 0,
        items: [derived({ id: 's1', semantic: '([d8,d6],[ant(d8)])', graph: { id: 'drs-1' } })]
      }
    } as any;

    component.generatePcdrs();

    expect(dataServiceMock.gswbGeneratePcdrs.calls.mostRecent().args[0].mergedStructure.annotations)
      .toEqual([{ sourceNode: 'd8', relationLabel: 'POSSIBLE-ANT', targetNode: 'd6' }]);
  });

  it('records the discourse layer with its rule branch and neither derived join', () => {
    const sentence: SentenceAnalysis = {
      id: 'sentence-1', text: 'a man saw himself', syntax: [], semantics: [], synSemMapping: {},
    } as any;
    (component as any).analysisDocument.sentences = [sentence];
    (component as any).analysisDocument.elements = [{ kind: 'sentence', id: 'sentence-1' }];

    component.showInlinePostProcessing = true;
    component.mergedStructureContent = JSON.stringify({ constraints: [], annotations: [] });
    // Two rule branches off one reading: the case where storing tier B once per branch
    // used to multiply the update by the rule fan-out.
    component.postProcessingResults = [{
      semanticSolution: derived({ id: 'sol-1', semantic: '([x],[])', sentenceAnalysis: sentence }),
      structureContent: '{"constraints":[],"annotations":[]}',
      graphElements: [],
      ruleAnnotations: [
        { structureJson: { id: 'branch-1' } },
        { structureJson: { id: 'branch-2' } },
      ],
      rulesApplied: true,
    }] as any;
    dataServiceMock.gswbGeneratePcdrs.and.callFake((request: any) => of({
      solutions: [{ id: `${request.parentSolutionId}-m1`, solution: '<svg></svg>', semantic: `drs-${request.parentSolutionId}` }],
    }));

    component.generatePcdrs();

    const update = (component as any).analysisDocument.discourseUpdates[0];
    expect(update.sourceElementId).toBe('sentence-1');
    expect(update.sourceElementKind).toBe('sentence');
    expect(update.discourse.length).toBe(2);
    // 1-based, matching the parentSolutionId sent to GSWB -- the same numbering chat and
    // regression record, which is what keeps the three documents comparable.
    expect(update.discourse.map((entry: any) => entry.ruleBranch)).toEqual([1, 2]);
    expect(update.structures).toBeUndefined();
    expect(update.mergedGraphs).toBeUndefined();
  });

  it('records two rule branches with the same binding over the same DRS as one reading', () => {
    const sentence: SentenceAnalysis = {
      id: 'sentence-1', text: 'a man saw himself', syntax: [], semantics: [], synSemMapping: {},
    } as any;
    (component as any).analysisDocument.sentences = [sentence];
    (component as any).analysisDocument.elements = [{ kind: 'sentence', id: 'sentence-1' }];
    component.showInlinePostProcessing = true;
    component.mergedStructureContent = JSON.stringify({ constraints: [], annotations: [] });
    component.postProcessingResults = [{
      semanticSolution: derived({ id: 'sol-1', semantic: '([x],[])', sentenceAnalysis: sentence }),
      structureContent: '{"constraints":[],"annotations":[]}',
      graphElements: [],
      ruleAnnotations: [{ structureJson: { id: 'branch-1' } }, { structureJson: { id: 'branch-2' } }],
      rulesApplied: true,
    }] as any;
    const relation = { pronounReferentId: 'x2', antecedent: 'x1', stateLabel: 's1' };
    dataServiceMock.gswbGeneratePcdrs.and.callFake((request: any) => of({
      solutions: [{ id: `${request.parentSolutionId}-m1`, solution: '<svg></svg>', semantic: 'drs', anaphoraRelations: [relation] }],
    }));

    component.generatePcdrs();

    const update = (component as any).analysisDocument.discourseUpdates[0];
    expect(update.discourse.map((entry: any) => entry.id)).toEqual(['sol-1-graph-1-rule-1-m1']);
    expect(update.discourse[0].collapsed).toBeTrue();
    expect(component.pcdrsSolutions.map(solution => solution.id)).toEqual(['sol-1-graph-1-rule-1-m1']);
  });

  describe('canonical document assembly', () => {
    const structure = { constraints: [], annotations: [], choiceSpace: {} };

    const sentenceAnalysis = (id: string, text: string): SentenceAnalysis => ({
      id,
      text,
      syntax: [{ synId: `syn-${id}`, structure, graph: { graphElements: [] } }],
      semantics: [{ syntacticOrigin: `syn-${id}`, semId: `sem-${id}`, semString: 'P', semType: 'lfgxdrt' }],
      synSemMapping: { [`syn-${id}`]: [`sem-${id}`] },
    });

    const sequenceAnalysisOf = (id: string, sentenceIds: string[]): SequenceAnalysis => ({
      id,
      text: 'merged text',
      sentenceIds,
      syntax: [{ synId: `syn-${id}`, structure, graph: { graphElements: [] } }],
      semantics: [{ syntacticOrigin: `syn-${id}`, semId: `sem-${id}`, semString: 'P & Q', semType: 'lfgxdrt' }],
      synSemMapping: { [`syn-${id}`]: [`sem-${id}`] },
    });

    let sentenceAnalysisChange: EventEmitter<SentenceAnalysis[]>;
    let sequenceAnalysisChange: EventEmitter<SequenceAnalysis[]>;
    let discourseReset: EventEmitter<void>;

    beforeEach(() => {
      sentenceAnalysisChange = new EventEmitter<SentenceAnalysis[]>();
      sequenceAnalysisChange = new EventEmitter<SequenceAnalysis[]>();
      discourseReset = new EventEmitter<void>();
      component.liger = {
        changeDetector: new Subject<string>(),
        sequenceSentences: [],
        proofInputChange: new EventEmitter(),
        displaySequenceAnalysis: jasmine.createSpy('displaySequenceAnalysis'),
        discourseReset,
        resetForNewDiscourse: jasmine.createSpy('resetForNewDiscourse'),
      } as any;
      component.glue = {
        editor1: { updateContent: jasmine.createSpy('updateContent') },
        semanticSolutionReady: false,
        setProofInputs: jasmine.createSpy('setProofInputs'),
        sequenceAnalysisChange,
        sentenceAnalysisChange,
      } as any;
      // The subscriptions this feature relies on are only wired up inside ngAfterViewInit,
      // which already ran once during the outer beforeEach's fixture.detectChanges() (before
      // component.liger/component.glue existed, so it was a no-op) -- re-run it now that the
      // doubles are in place so the real sentenceAnalysisChange/sequenceAnalysisChange
      // subscriptions attach to them.
      (component as any).ngAfterViewInit();
    });

    it('registers the very first sentence on its first emission (chicken-and-egg regression)', () => {
      sentenceAnalysisChange.emit([sentenceAnalysis('s1', 'First sentence.')]);

      const doc = (component as any).analysisDocument;
      expect(doc.sentences.length).toBe(1);
      expect(doc.sentences[0].id).toBe('s1');
      expect(doc.elements).toEqual([{ kind: 'sentence', id: 's1' }]);

      const updated = sentenceAnalysis('s1', 'First sentence.');
      updated.semantics = [
        ...updated.semantics,
        { syntacticOrigin: 'syn-s1', semId: 'sem-s1-b', semString: 'Q', semType: 'lfgxdrt' },
      ];
      sentenceAnalysisChange.emit([updated]);

      expect(doc.sentences.length).toBe(1);
      expect(doc.elements.length).toBe(1);
    });

    it('upserts a sequence into a separate registry and references it by id without embedding it', () => {
      sentenceAnalysisChange.emit([sentenceAnalysis('s1', 'First.'), sentenceAnalysis('s2', 'Second.')]);
      sequenceAnalysisChange.emit([sequenceAnalysisOf('seq-1', ['s1', 's2'])]);

      const doc = (component as any).analysisDocument;
      expect(doc.sequences.length).toBe(1);
      expect(doc.sequences[0].id).toBe('seq-1');
      expect(doc.elements).toEqual([
        { kind: 'sentence', id: 's1' },
        { kind: 'sentence', id: 's2' },
        { kind: 'sequence', id: 'seq-1' },
      ]);
      doc.elements.forEach((ref: any) => {
        expect(Object.keys(ref).sort()).toEqual(['id', 'kind']);
      });
    });

    it('does not duplicate sentence payload when the document is persisted', () => {
      sentenceAnalysisChange.emit([sentenceAnalysis('s1', 'needle-text-marker')]);
      sequenceAnalysisChange.emit([sequenceAnalysisOf('seq-1', ['s1'])]);

      const doc = (component as any).analysisDocument;
      const json = JSON.stringify(doc);
      expect((json.match(/needle-text-marker/g) || []).length).toBe(1);
    });

    it('rejects a document with a dangling elements ref', () => {
      sentenceAnalysisChange.emit([sentenceAnalysis('s1', 'First.')]);
      const doc = (component as any).analysisDocument;
      doc.elements.push({ kind: 'sentence', id: 'ghost' });

      const warnSpy = spyOn(console, 'warn');
      (component as any).persistAnalysisDocument();

      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.calls.mostRecent().args[0]).toContain('document invariant failed');
    });

    it('does not merge a new discourse\'s sentence-1 into the old discourse\'s sentence-1', () => {
      // Regression for the captured reset-corruption bug: before startNewDiscourse()
      // existed, glue-interface had no reset path at all, so a fresh discourse's
      // first sentence silently merged into the previous discourse's sentence-1 by id.
      sentenceAnalysisChange.emit([sentenceAnalysis('sentence-1', 'a man saw a woman')]);
      sequenceAnalysisChange.emit([sequenceAnalysisOf('seq-1', ['sentence-1'])]);
      const oldSessionKey = (component as any).analysisDocumentSessionKey;

      component.liger.resetForNewDiscourse = jasmine.createSpy('resetForNewDiscourse');
      component.glue.resetForNewDiscourse = jasmine.createSpy('resetForNewDiscourse');
      component.startNewDiscourse();

      expect(dataServiceMock.clearAnalysisDocument).toHaveBeenCalledWith(oldSessionKey);
      expect((component as any).analysisDocumentSessionKey).not.toBe(oldSessionKey);
      const freshDoc = (component as any).analysisDocument;
      expect(freshDoc.sentences).toEqual([]);
      expect(freshDoc.sequences).toEqual([]);
      expect(freshDoc.elements).toEqual([]);
      expect(component.liger.resetForNewDiscourse).toHaveBeenCalled();
      expect(component.glue.resetForNewDiscourse).toHaveBeenCalled();

      sentenceAnalysisChange.emit([sentenceAnalysis('sentence-1', 'a completely different sentence')]);

      expect(freshDoc.sentences.length).toBe(1);
      expect(freshDoc.sentences[0].text).toBe('a completely different sentence');
    });

    it('resets the document automatically when liger reports a fresh discourse, without touching liger itself', () => {
      // Regression for the captured corruption
      // (misc/current/analysis-document-sequence-not-reset-properly.json): "Parse and
      // rewrite" is supposed to start a new discourse on its own -- no separate "New
      // discourse" click should be required.
      sentenceAnalysisChange.emit([sentenceAnalysis('sentence-1', 'a man appeared')]);
      sentenceAnalysisChange.emit([sentenceAnalysis('sentence-2', 'a woman appeared')]);
      sequenceAnalysisChange.emit([sequenceAnalysisOf('seq-1', ['sentence-1', 'sentence-2'])]);
      const oldSessionKey = (component as any).analysisDocumentSessionKey;

      component.glue.resetForNewDiscourse = jasmine.createSpy('resetForNewDiscourse');
      discourseReset.emit();

      expect((component as any).analysisDocumentSessionKey).not.toBe(oldSessionKey);
      const freshDoc = (component as any).analysisDocument;
      expect(freshDoc.sentences).toEqual([]);
      expect(freshDoc.sequences).toEqual([]);
      expect(component.glue.resetForNewDiscourse).toHaveBeenCalled();
      // liger's own state is untouched -- it was just correctly set by the parse that
      // triggered this event, and resetting it here would wipe that out.
      expect(component.liger.resetForNewDiscourse).not.toHaveBeenCalled();

      // The new discourse's own sentence-1 registers cleanly against the empty document.
      sentenceAnalysisChange.emit([sentenceAnalysis('sentence-1', 'he smiled')]);

      expect(freshDoc.sentences.length).toBe(1);
      expect(freshDoc.sentences[0].text).toBe('he smiled');
    });
  });
});
