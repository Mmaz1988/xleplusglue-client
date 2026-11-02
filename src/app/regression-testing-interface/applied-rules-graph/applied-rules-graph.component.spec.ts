import { NO_ERRORS_SCHEMA, NgZone } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AppliedRulesGraphComponent } from './applied-rules-graph.component';
import { SubGraphDialogComponent } from '../../sub-graph-dialog/sub-graph-dialog.component';
import { SubGraphComponent } from '../../sub-graph/sub-graph.component';

describe('AppliedRulesGraphComponent', () => {
  let component: AppliedRulesGraphComponent;
  let fixture: ComponentFixture<AppliedRulesGraphComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      // Its sub-graph dialog is real: its graph is drawn from the start.
      declarations: [AppliedRulesGraphComponent, SubGraphDialogComponent, SubGraphComponent],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(AppliedRulesGraphComponent);
    component = fixture.componentInstance;
    component.graphID = 'arTest';
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('runs no change detection while its graphs sit idle', async () => {
    // Cytoscape redraws on every animation frame; in Angular's zone each frame was a full
    // change detection of the app, which a large regression suite made the page's only work.
    const zone = TestBed.inject(NgZone);
    zone.run(() => component.renderGraph([
      { data: { id: '1', rule: 'a ==> b', line: 1, node_type: 'rule' } },
      { data: { id: '2', rule: 'b ==> c', line: 2, node_type: 'rule' } },
      { data: { id: 'e', source: '1', target: '2', edge_type: 'edge' } },
    ] as any));
    let turns = 0;
    const counting = zone.onUnstable.subscribe(() => turns++);
    await new Promise(resolve => zone.runOutsideAngular(() => setTimeout(resolve, 300)));
    counting.unsubscribe();
    expect(turns).toBe(0);
  });
});
