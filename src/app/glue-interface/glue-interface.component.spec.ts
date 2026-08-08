import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventEmitter, NO_ERRORS_SCHEMA } from '@angular/core';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { DataService } from '../data.service';
import { SentenceAnalysis, SequenceAnalysis } from '../models/models';

import { GlueInterfaceComponent } from './glue-interface.component';

describe('GlueInterfaceComponent', () => {
  let component: GlueInterfaceComponent;
  let fixture: ComponentFixture<GlueInterfaceComponent>;
  let routerMock: { navigate: jasmine.Spy };
  let dataServiceMock: {
    ligerMergeStructure: jasmine.Spy;
    ligerApplyRulesToStructure: jasmine.Spy;
    gswbGeneratePcdrs: jasmine.Spy;
    gswbCollapseAnaphora: jasmine.Spy;
    clearAnalysisDocument: jasmine.Spy;
    saveAnalysisDocument: jasmine.Spy;
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
      saveAnalysisDocument: jasmine.createSpy('saveAnalysisDocument').and.callFake((sessionKey: string, document: any) => of({
        status: 'ok',
        document: { ...document, revision: 1, createdAt: 'now', updatedAt: 'now' },
      })),
    };

    TestBed.configureTestingModule({
      declarations: [GlueInterfaceComponent],
      providers: [
        { provide: Router, useValue: routerMock },
        { provide: DataService, useValue: dataServiceMock }
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

  it('should navigate to the graph inspector', () => {
    component.liger = {
      structureJson: { id: 'syntax-graph', text: 'syntax graph', constraints: [], annotations: [], choiceSpace: {} }
    } as any;
    component.glue = {
      semvis: {
        index: 0,
        items: [{
          id: 'drs-1',
          solution: 'drs example',
          graph: { id: 'drs-1', text: 'drs example', constraints: [], annotations: [], choiceSpace: {} }
        }]
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
        items: [{ graph: { id: 'drs-1' } }]
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
        items: [{ graph: { id: 'drs-1' } }]
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
        items: [{ graph: { id: 'drs-1' } }]
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
    const first = { id: 'drs-1', semantic: 'first', graph: { id: 'drs-1' } };
    const second = { id: 'drs-2', semantic: 'second', graph: { id: 'drs-2' } };
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

  it('merges only discriminant-selected semantic solutions', () => {
    component.liger = {
      structureJson: { id: 'syntax-graph' }
    } as any;
    const first = { id: 'drs-1', graph: { id: 'drs-1' } };
    const second = { id: 'drs-2', graph: { id: 'drs-2' } };
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
        items: [{ id: 's1', semantic: '([x1],[dog(x1)])', graph: { id: 'drs-1' } }]
      }
    } as any;

    component.generatePcdrs();

    expect(dataServiceMock.gswbGeneratePcdrs).toHaveBeenCalledWith({
      semantic: '([x1],[dog(x1)])',
      parentSolutionId: 's1',
      mergedStructure: { constraints: [], annotations: [], choiceSpace: {} }
    });
    expect(component.pcdrsSolutions.length).toBe(1);
  });

  it('applies rules separately to every merged graph', () => {
    const ruleResult = {
      annotations: [{ graph: { graphElements: [] }, appliedRules: [], structureJson: { id: 'annotated' } }]
    } as any;
    component.postProcessingResults = [{
      semanticSolution: { id: 's1', graph: { id: 'd1' } } as any,
      structureContent: '{"id":"d1"}',
      graphElements: [],
      ruleAnnotations: [],
      rulesApplied: false
    }, {
      semanticSolution: { id: 's2', graph: { id: 'd2' } } as any,
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

  it('creates PCDRS for every annotated merged graph', () => {
    component.showInlinePostProcessing = true;
    component.mergedStructureContent = '{"constraints":[],"annotations":[]}';
    component.postProcessingResults = [{
      semanticSolution: { id: 's1', semantic: 'first' } as any,
      structureContent: '{"id":"d1"}',
      graphElements: [],
      ruleAnnotations: [
        { structureJson: { id: 'd1a' } } as any,
        { structureJson: { id: 'd1b' } } as any
      ],
      rulesApplied: true
    }, {
      semanticSolution: { id: 's2', semantic: 'second' } as any,
      structureContent: '{"id":"d2"}',
      graphElements: [],
      ruleAnnotations: [{ structureJson: { id: 'd2a' } } as any],
      rulesApplied: true
    }];

    component.generatePcdrs();

    expect(dataServiceMock.gswbGeneratePcdrs).toHaveBeenCalledTimes(3);
    expect(component.pcdrsSolutions.length).toBe(3);
    expect(dataServiceMock.gswbGeneratePcdrs.calls.allArgs()
      .map(args => args[0].parentSolutionId))
      .toEqual(['s1-graph-1-rule-1', 's1-graph-1-rule-2', 's2-graph-2-rule-1']);
  });

  it('creates PCDRS only for the selected merged graph', () => {
    component.showInlinePostProcessing = true;
    component.mergedStructureContent = '{"graph":2}';
    component.selectedPostProcessingIndex = 1;
    component.postProcessingResults = [{
      semanticSolution: { id: 's1', semantic: 'sem-1' } as any,
      structureContent: '{"graph":1}',
      graphElements: [],
      ruleAnnotations: [{ structureJson: { graph: 1 } } as any],
      rulesApplied: true,
    }, {
      semanticSolution: { id: 's2', semantic: 'sem-2' } as any,
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
        items: [{ id: 's1', graph: { id: 'drs-1' } }]
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
        items: [{ id: 's1', semantic: '([d8,d6],[ant(d8)])', graph: { id: 'drs-1' } }]
      }
    } as any;

    component.generatePcdrs();

    expect(dataServiceMock.gswbGeneratePcdrs.calls.mostRecent().args[0].mergedStructure.annotations)
      .toEqual([{ sourceNode: 'd8', relationLabel: 'POSSIBLE-ANT', targetNode: 'd6' }]);
  });

  it('collapses all PCDRS solutions and switches their display', () => {
    component.pcdrsSolutions = [{
      id: 's1-pcdrs-1',
      solution: '<svg></svg>',
      semantic: '([x1,x2],[loves(x2,x1)]),A:[a(x2,x1)]'
    }, {
      id: 's1-pcdrs-2',
      solution: '<svg></svg>',
      semantic: '([x1,x2],[ant(x2)]),A:[a(x2,x1)]'
    }];
    component.pcdrsSemvis = { index: 0, items: component.pcdrsSolutions } as any;

    component.collapseAllAnaphora();

    expect(dataServiceMock.gswbCollapseAnaphora).toHaveBeenCalledWith({
      semantic: '([x1,x2],[loves(x2,x1)]),A:[a(x2,x1)]',
      parentSolutionId: 's1-pcdrs-1'
    });
    expect(dataServiceMock.gswbCollapseAnaphora).toHaveBeenCalledTimes(2);
    expect(component.collapsedPcdrsById['s1-pcdrs-1']).toBeTruthy();
    expect(component.collapsedPcdrsById['s1-pcdrs-2']).toBeTruthy();
    expect(component.showCollapsedAnaphora).toBeTrue();
    expect(component.pcdrsDisplaySolutions[0].id).toBe('s1-pcdrs-1-collapsed');
    expect(component.pcdrsDisplaySolutions[1].id).toBe('s1-pcdrs-2-collapsed');

    component.toggleCollapsedAnaphora();

    expect(component.showCollapsedAnaphora).toBeFalse();
    expect(component.pcdrsDisplaySolutions[0].id).toBe('s1-pcdrs-1');
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

    beforeEach(() => {
      sentenceAnalysisChange = new EventEmitter<SentenceAnalysis[]>();
      sequenceAnalysisChange = new EventEmitter<SequenceAnalysis[]>();
      component.liger = {
        changeDetector: new Subject<string>(),
        sequenceSentences: [],
        proofInputChange: new EventEmitter(),
        displaySequenceAnalysis: jasmine.createSpy('displaySequenceAnalysis'),
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
  });
});
