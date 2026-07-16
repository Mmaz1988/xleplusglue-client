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
        graph: {
          graphElements: [{ data: { id: 'r1' } }]
        },
        structureJson: {
          id: 'annotated-graph',
          text: 'annotated graph',
          constraints: [],
          annotations: [],
          choiceSpace: {}
        }
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

  it('should render a preloaded graph from route state', () => {
    (component as any).preloadedGraphElements = [{ data: { id: 'g1' } }];
    component.ngAfterViewInit();

    const graphVis = fixture.debugElement.query(By.directive(GraphVisStubComponent)).componentInstance as GraphVisStubComponent;
    expect(graphVis.lastRendered.map(element => element.data.id)).toEqual(['g1']);
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
    expect(graphVis.lastRendered.map(element => element.data.id)).toEqual(['r1']);
    expect(component.currentStructureJson).toContain('annotated-graph');
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
