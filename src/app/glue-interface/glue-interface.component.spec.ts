import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { DataService } from '../data.service';

import { GlueInterfaceComponent } from './glue-interface.component';

describe('GlueInterfaceComponent', () => {
  let component: GlueInterfaceComponent;
  let fixture: ComponentFixture<GlueInterfaceComponent>;
  let routerMock: { navigate: jasmine.Spy };
  let dataServiceMock: { ligerMergeStructure: jasmine.Spy; gswbGeneratePcdrs: jasmine.Spy; gswbCollapseAnaphora: jasmine.Spy };

  beforeEach(() => {
    routerMock = {
      navigate: jasmine.createSpy('navigate')
    };
    dataServiceMock = {
      ligerMergeStructure: jasmine.createSpy('ligerMergeStructure').and.returnValue(of({
        graph: { graphElements: [{ data: { id: 'm1', label: 'merged' } }] },
        structureJson: { id: 'merged-graph', text: 'merged graph', constraints: [], annotations: [], choiceSpace: {} }
      })),
      gswbGeneratePcdrs: jasmine.createSpy('gswbGeneratePcdrs').and.returnValue(of({
        solutions: [{ id: 's1-pcdrs-1', solution: '<svg></svg>' }]
      })),
      gswbCollapseAnaphora: jasmine.createSpy('gswbCollapseAnaphora').and.callFake((request: any) => of({
        id: `${request.parentSolutionId}-collapsed`, solution: '<svg></svg>'
      }))
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
});
