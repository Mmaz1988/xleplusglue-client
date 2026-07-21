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
  let dataServiceMock: { ligerMergeStructure: jasmine.Spy };

  beforeEach(() => {
    routerMock = {
      navigate: jasmine.createSpy('navigate')
    };
    dataServiceMock = {
      ligerMergeStructure: jasmine.createSpy('ligerMergeStructure').and.returnValue(of({
        graph: { graphElements: [{ data: { id: 'm1', label: 'merged' } }] },
        structureJson: { id: 'merged-graph', text: 'merged graph', constraints: [], annotations: [], choiceSpace: {} }
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
});
