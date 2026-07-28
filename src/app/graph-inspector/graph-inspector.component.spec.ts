import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';

import { DataService } from '../data.service';
import { GraphInspectorComponent } from './graph-inspector.component';

@Component({
  selector: 'app-graph-vis',
  template: ''
})
class GraphVisStubComponent {
  @Input() graphID!: string;
  @Input() graphStyle!: string;
  lastRendered: any[] = [];

  renderGraph(elements: any[]) {
    this.lastRendered = elements;
  }

  updateGraph(elements: any[]) {
    this.lastRendered = elements;
  }
}

describe('GraphInspectorComponent', () => {
  let component: GraphInspectorComponent;
  let fixture: ComponentFixture<GraphInspectorComponent>;
  let dataServiceMock: {
    ligerUploadStructure: () => any;
    ligerRenderStructure: () => any;
    ligerApplyRulesToStructure: jasmine.Spy;
    ligerQueryStructure: jasmine.Spy;
  };

  beforeEach(() => {
    dataServiceMock = {
      ligerUploadStructure: () => of({}),
      ligerRenderStructure: () => of({}),
      ligerApplyRulesToStructure: jasmine.createSpy('ligerApplyRulesToStructure').and.returnValue(of({
        sentence: 'annotated graph',
        annotations: [
          {
            sentence: 'branch 1',
            graph: {
              graphElements: [{ data: { id: 'branch-1-node' } }],
              semantics: ''
            },
            structureJson: { id: 'branch-1', constraints: [], annotations: [], choiceSpace: {} },
            appliedRules: [],
            meaningConstructors: '',
            numberOfMCsets: 0,
            highlightedNodeIds: ['branch-1-node'],
            addedAnnotationsByRule: {}
          },
          {
            sentence: 'branch 2',
            graph: {
              graphElements: [{ data: { id: 'branch-2-node' } }],
              semantics: ''
            },
            structureJson: { id: 'branch-2', constraints: [], annotations: [], choiceSpace: {} },
            appliedRules: [],
            meaningConstructors: '',
            numberOfMCsets: 0,
            highlightedNodeIds: ['branch-2-node'],
            addedAnnotationsByRule: {}
          }
        ]
      })),
      ligerQueryStructure: jasmine.createSpy('ligerQueryStructure').and.returnValue(of({
        success: 'true',
        matchCount: 2,
        graph: {
          graphElements: [
            { data: { id: '1', query_selector: 'query-match' } },
            { data: { id: '2', query_selector: 'query-match' } },
            { data: { id: '3' } }
          ]
        },
        solutions: [
          {
            signature: '#a=1',
            bindings: {
              '#a': { '1': ['SUBJ=#2', 'PRED=semform(\'John\',0,[],[])'] }
            }
          },
          {
            signature: '#a=2',
            bindings: {
              '#a': { '2': ['SUBJ=#4'] }
            }
          }
        ]
      }))
    };

    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [GraphInspectorComponent, GraphVisStubComponent],
      providers: [
        {
          provide: DataService,
          useValue: dataServiceMock
        }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    });
    fixture = TestBed.createComponent(GraphInspectorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should pass liger graph style to the shared renderer', () => {
    const graphVis = fixture.debugElement.query(By.directive(GraphVisStubComponent)).componentInstance as GraphVisStubComponent;

    expect(component).toBeTruthy();
    expect(graphVis.graphStyle).toBe('liger');
  });

  it('should seed default rules and query text', () => {
    expect(component.rulesText).toContain('Connects referents via SRC');
    expect(component.queryText).toContain('MCN-PATH(#a,#b)');
    expect(component.queryText).toContain('REFL-BIND(#f,#h)');
  });

  it('should render a preloaded graph from route state', () => {
    (component as any).preloadedGraphElements = [{ data: { id: 'g1' } }];
    component.ngAfterViewInit();

    const graphVis = fixture.debugElement.query(By.directive(GraphVisStubComponent)).componentInstance as GraphVisStubComponent;
    expect(graphVis.lastRendered.map(element => element.data.id)).toEqual(['g1']);
  });

  it('should render graph data supplied by the inline inspector inputs', () => {
    component.initialUploadedContent = '{"id":"inline-graph"}';
    component.initialUploadedFileName = 'inline-graph.json';
    component.initialGraphElements = [{ data: { id: 'inline-node' } }];
    component.ngOnChanges({
      initialUploadedContent: {} as any,
      initialUploadedFileName: {} as any,
      initialGraphElements: {} as any,
    });
    component.ngAfterViewInit();

    expect(component.uploadedContent).toContain('inline-graph');
    expect(component.uploadedFileName).toBe('inline-graph.json');
    const graphVis = fixture.debugElement.query(By.directive(GraphVisStubComponent)).componentInstance as GraphVisStubComponent;
    expect(graphVis.lastRendered.map(element => element.data.id)).toEqual(['inline-node']);
  });

  it('should hydrate uploaded JSON from route state for querying', () => {
    (component as any).initializeFromRouteState({
      uploadedContent: '{"id":"merged-graph","text":"merged graph","constraints":[],"annotations":[],"choiceSpace":{}}',
      uploadedFormat: 'json',
      uploadedFileName: 'merged-graph.json',
      graphElements: [{ data: { id: 'g1' } }]
    });

    expect(component.uploadedContent).toContain('merged-graph');
    expect(component.uploadedFormat).toBe('json');
    expect(component.uploadedFileName).toBe('merged-graph.json');
  });

  it('should include embedded query definitions in the query payload', () => {
    component.uploadedContent = '{"constraints":[],"annotation":[]}';
    component.queryText = "GF ::= SUBJ > OBJ > OBL .\nfeature-label() := TENSE | PERF .\n#a SUBJ #b";

    component.runQuery();

    expect(dataServiceMock.ligerQueryStructure).toHaveBeenCalled();
    const request = dataServiceMock.ligerQueryStructure.calls.mostRecent().args[0];
    expect(request.query).toContain('GF ::= SUBJ > OBJ > OBL .');
    expect(request.query).toContain('feature-label() := TENSE | PERF .');
    expect(component.queryResult).toContain('2 solutions');
    expect(component.querySolutions.length).toBe(2);
  });

  it('should query the currently rendered structure after applying rules', () => {
    component.uploadedContent = '{"id":"old-graph","constraints":[],"annotations":[],"choiceSpace":{}}';
    component.currentStructureJson = '{"id":"new-graph","constraints":[],"annotations":[],"choiceSpace":{}}';
    component.queryText = '#a SUBJ #b';

    component.runQuery();

    expect(dataServiceMock.ligerQueryStructure).toHaveBeenCalled();
    const request = dataServiceMock.ligerQueryStructure.calls.mostRecent().args[0];
    expect(request.content).toContain('new-graph');
    expect(request.content).not.toContain('old-graph');
    expect(request.format).toBe('json');
  });

  it('should download the uploaded JSON structure unchanged', async () => {
    component.uploadedContent = '{\n  "id": "merged-graph",\n  "text": "merged graph",\n  "constraints": [],\n  "annotations": [],\n  "choiceSpace": {}\n}';
    component.uploadedFileName = 'merged-graph.json';
    component.currentStructureJson = '{\n  "id": "annotated-graph",\n  "text": "annotated graph",\n  "constraints": [],\n  "annotations": [],\n  "choiceSpace": {}\n}';

    const createObjectURLSpy = spyOn(window.URL, 'createObjectURL').and.returnValue('blob:mock');
    spyOn(window.URL, 'revokeObjectURL');
    const clickSpy = jasmine.createSpy('click');
    const anchor = {
      href: '',
      download: '',
      click: clickSpy,
    } as any;
    spyOn(document, 'createElement').and.returnValue(anchor);

    component.downloadCurrentStructure();

    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(anchor.download).toBe('merged-graph.json');
    expect(clickSpy).toHaveBeenCalled();

    const blob = createObjectURLSpy.calls.mostRecent().args[0] as Blob;
    const text = await blob.text();
    expect(text).toBe(component.currentStructureJson);
  });

  it('should apply LiGER rules and render the annotated graph', () => {
    component.uploadedContent = '{"constraints":[],"annotations":[],"choiceSpace":{}}';
    component.uploadedFormat = 'json';
    component.uploadedFileName = 'merged-graph.json';
    component.rulesText = '--replace(true);';

    component.applyRules();

    expect(dataServiceMock.ligerApplyRulesToStructure).toHaveBeenCalled();
    const request = dataServiceMock.ligerApplyRulesToStructure.calls.mostRecent().args[0];
    expect(request.ruleString).toBe('--replace(true);');

    const graphVis = fixture.debugElement.query(By.directive(GraphVisStubComponent)).componentInstance as GraphVisStubComponent;
    expect(graphVis.lastRendered.map(element => element.data.id)).toEqual(['branch-1-node']);
    expect(component.ruleAnnotations.length).toBe(2);
  });

  it('should apply rules to the currently selected structure instead of the original upload', () => {
    component.uploadedContent = '{"id":"original","constraints":[],"annotations":[],"choiceSpace":{}}';
    component.uploadedFormat = 'json';
    component.uploadedFileName = 'merged-graph.json';
    component.currentStructureJson = '{"id":"selected-branch","constraints":[],"annotations":[],"choiceSpace":{}}';
    component.rulesText = '--replace(true);';

    component.applyRules();

    const request = dataServiceMock.ligerApplyRulesToStructure.calls.mostRecent().args[0];
    expect(request.content).toContain('selected-branch');
    expect(request.content).not.toContain('original');
    expect(request.format).toBe('json');
  });

  it('should apply a later rule to the selected branch structure', () => {
    component.uploadedContent = '{"id":"original","constraints":[],"annotations":[],"choiceSpace":{}}';
    component.uploadedFormat = 'json';
    component.uploadedFileName = 'merged-graph.json';
    component.rulesText = '#a SUBJ #b ?=> #a TOP #b';

    component.applyRules();
    component.selectRuleAnnotation(1);
    component.rulesText = '--replace(true);';
    component.applyRules();

    const request = dataServiceMock.ligerApplyRulesToStructure.calls.mostRecent().args[0];
    expect(request.content).toContain('branch-2');
    expect(request.content).not.toContain('original');
  });

  it('should expose all rule branches when a rule forks the structure', () => {
    component.uploadedContent = '{"constraints":[],"annotations":[],"choiceSpace":{}}';
    component.uploadedFormat = 'json';
    component.uploadedFileName = 'merged-graph.json';
    component.rulesText = '#a SUBJ #b ?=> #a TOP #b';

    component.applyRules();
    fixture.detectChanges();

    expect(component.ruleAnnotations.length).toBe(2);

    const nav = fixture.nativeElement.querySelector('aside.solutions-panel .solution-nav');
    expect(nav.textContent).toContain('Result 1 / 2');
  });

  it('should iterate branch graphs with prev and next controls', () => {
    component.uploadedContent = '{"constraints":[],"annotations":[],"choiceSpace":{}}';
    component.uploadedFormat = 'json';
    component.uploadedFileName = 'merged-graph.json';
    component.rulesText = '#a SUBJ #b ?=> #a TOP #b';

    component.applyRules();

    const graphVis = fixture.debugElement.query(By.directive(GraphVisStubComponent)).componentInstance as GraphVisStubComponent;
    expect(graphVis.lastRendered.map(element => element.data.id)).toEqual(['branch-1-node']);

    component.nextRuleVariant();
    expect(graphVis.lastRendered.map(element => element.data.id)).toEqual(['branch-2-node']);

    component.previousRuleVariant();
    expect(graphVis.lastRendered.map(element => element.data.id)).toEqual(['branch-1-node']);
  });

  it('should clear stale highlights when a rule has an explicit empty highlight set', () => {
    component.activeResultKind = 'rules';
    component['ruleAnnotations'] = [
      {
        sentence: 'deletion rule',
        graph: {
          graphElements: [
            { data: { id: '1', query_selector: 'query-match' } },
            { data: { id: '2', query_selector: 'query-match' } }
          ],
          semantics: ''
        },
        appliedRules: [],
        meaningConstructors: '',
        numberOfMCsets: 0,
        highlightedNodeIds: [],
        addedAnnotationsByRule: {}
      }
    ] as any;

    component.selectRuleAnnotation(0);
    component.onRuleToggle(0, true);

    const graphVis = fixture.debugElement.query(By.directive(GraphVisStubComponent)).componentInstance as GraphVisStubComponent;
    const highlightedIds = graphVis.lastRendered.filter(element => element.data?.query_selector === 'query-match').map(element => element.data.id);

    expect(highlightedIds).toEqual([]);
  });

  it('should not fall back to stale rule highlights when the active rule has no matched facts', () => {
    component.activeResultKind = 'rules';
    component['ruleAnnotations'] = [
      {
        sentence: 'deletion rule',
        graph: {
          graphElements: [
            { data: { id: '1', query_selector: 'query-match' } },
            { data: { id: '2', query_selector: 'query-match' } }
          ],
          semantics: ''
        },
        appliedRules: [{ rule: '#a POTENTIAL-ANT #b =-> 0.', index: 6, lineNumber: 6 }],
        meaningConstructors: '',
        numberOfMCsets: 0,
        highlightedNodeIds: ['1', '2'],
        addedAnnotationsByRule: { 6: [] }
      }
    ] as any;

    component.selectRuleAnnotation(0);
    component.onRuleToggle(0, true);

    const graphVis = fixture.debugElement.query(By.directive(GraphVisStubComponent)).componentInstance as GraphVisStubComponent;
    const highlightedIds = graphVis.lastRendered.filter(element => element.data?.query_selector === 'query-match').map(element => element.data.id);

    expect(highlightedIds).toEqual([]);
  });

  it('renders added facts for the selected rule solution', () => {
    component.activeResultKind = 'rules';
    component['ruleAnnotations'] = [{
      sentence: 'annotated graph',
      graph: { graphElements: [], semantics: '' },
      appliedRules: [{ rule: '#a ant #a ==> #a SEM event', index: 0, lineNumber: 1 }],
      addedAnnotationsByRule: {
        0: [{ fsNode: 'd2', relationLabel: 'ant', fsValue: 'd2' }]
      }
    }] as any;

    component.selectRuleAnnotation(0);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('#d2 ant #d2');
  });

  it('renders object-shaped added-fact groups from JSON responses', () => {
    component.activeResultKind = 'rules';
    component['ruleAnnotations'] = [{
      graph: { graphElements: [], semantics: '' },
      appliedRules: [{ rule: '#a ant #a ==> #a SEM event', index: 2, lineNumber: 3 }],
      addedAnnotationsByRule: {
        2: { fact1: { fsNode: 'd3', relationLabel: 'SEM', fsValue: 'event' } }
      }
    }] as any;

    component.selectRuleAnnotation(0);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('#d3 SEM event');
  });

  it('should expose solution bindings for the inspector panel', () => {
    component.querySolutions = [{
      signature: '#a=1',
      bindings: {
        '#a': { '1': ['SUBJ=#2'] }
      }
    }];

    const entries = component.solutionEntries(component.querySolutions[0]);

    expect(entries.length).toBe(1);
    expect(entries[0].variable).toBe('#a');
    expect(entries[0].nodes[0].node).toBe('1');
    expect(entries[0].nodes[0].constraints).toEqual(['SUBJ=#2']);
  });

  it('should narrow graph highlighting to the expanded solution', () => {
    component.uploadedContent = '{"constraints":[],"annotation":[]}';
    component.queryText = '#a SUBJ #b';

    component.runQuery();

    const graphVis = fixture.debugElement.query(By.directive(GraphVisStubComponent)).componentInstance as GraphVisStubComponent;
    const highlightedIds = graphVis.lastRendered.filter(element => element.data?.query_selector === 'query-match').map(element => element.data.id);
    expect(highlightedIds).toEqual(['1', '2']);

    component.onSolutionToggle(0, true);

    const narrowedIds = graphVis.lastRendered.filter(element => element.data?.query_selector === 'query-match').map(element => element.data.id);
    expect(narrowedIds).toEqual(['1']);

    component.onSolutionToggle(0, false);

    const resetIds = graphVis.lastRendered.filter(element => element.data?.query_selector === 'query-match').map(element => element.data.id);
    expect(resetIds).toEqual(['1', '2']);
  });
});
