import { Component, Input, NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { DataService } from '../../data.service';
import { QueryDemoComponent } from './query-demo.component';
import { DEMO_QUERIES } from './demo-structure';

@Component({ selector: 'app-graph-vis', template: '' })
class GraphVisStubComponent {
  @Input() graphID!: string;
  @Input() graphStyle!: string;
  lastRendered: any[] = [];
  renderGraph(elements: any[]) { this.lastRendered = elements; }
  updateGraph(elements: any[]) { this.lastRendered = elements; }
}

@Component({ selector: 'app-editor', template: '' })
class EditorStubComponent {
  @Input() mode!: string;
  @Input() showControls!: boolean;
  @Input() initialContent!: string;
  content = '';
  updateContent(value: string) { this.content = value; }
}

const GRAPH = [
  { data: { id: 'f0' } },
  { data: { id: 'f1' } },
  { data: { id: 'f2' } },
  { data: { id: 'f3', query_selector: 'query-match' } },
  { data: { id: 'e01', source: 'f0', target: 'f1' } },
];

function highlighted(graph: GraphVisStubComponent): string[] {
  return graph.lastRendered.filter(e => e.data.query_selector === 'query-match').map(e => e.data.id);
}

describe('QueryDemoComponent', () => {
  let fixture: ComponentFixture<QueryDemoComponent>;
  let component: QueryDemoComponent;
  let dataService: jasmine.SpyObj<DataService>;

  beforeEach(() => {
    dataService = jasmine.createSpyObj('DataService', ['ligerRenderStructure', 'ligerQueryStructure']);
    dataService.ligerRenderStructure.and.returnValue(of({ graph: { graphElements: GRAPH } } as any));
    dataService.ligerQueryStructure.and.returnValue(of({
      success: 'true',
      matchCount: 2,
      graph: { graphElements: GRAPH },
      solutions: [
        { signature: 'a=f0|b=f1', bindings: { a: { f0: ['SUBJ=f1'] }, b: { f1: [] } } },
        { signature: 'a=f2|b=f3', bindings: { a: { f2: ['SUBJ=f3'] }, b: { f3: [] } } },
      ],
    } as any));

    TestBed.configureTestingModule({
      declarations: [QueryDemoComponent, GraphVisStubComponent, EditorStubComponent],
      providers: [{ provide: DataService, useValue: dataService }],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(QueryDemoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the example graph on load', () => {
    expect(dataService.ligerRenderStructure).toHaveBeenCalled();
    expect((component.graph as any).lastRendered.length).toBe(GRAPH.length);
  });

  it('highlights every solution after a query, and only the selected one after a click', () => {
    component.runQuery();
    expect(component.solutions.length).toBe(2);
    expect(highlighted(component.graph as any)).toEqual(['f0', 'f1', 'f2', 'f3']);

    component.selectSolution(1);
    expect(highlighted(component.graph as any)).toEqual(['f2', 'f3']);

    component.selectSolution(1);
    expect(component.activeSolutionIndex).toBeNull();
    expect(highlighted(component.graph as any)).toEqual(['f0', 'f1', 'f2', 'f3']);
  });

  it('runs an example query as it is chosen', () => {
    component.useExample(DEMO_QUERIES[1]);
    expect((component.queryEditor as any).content).toBe(DEMO_QUERIES[1].query);
    expect(dataService.ligerQueryStructure).toHaveBeenCalledWith(jasmine.objectContaining({ query: DEMO_QUERIES[1].query }));
  });

  it('says so when LiGER is unreachable instead of failing silently', () => {
    dataService.ligerRenderStructure.and.returnValue(throwError(() => new Error('down')));
    fixture = TestBed.createComponent(QueryDemoComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.statusKind).toBe('error');
    expect(fixture.componentInstance.status).toContain('LiGER is not reachable');
  });
});
