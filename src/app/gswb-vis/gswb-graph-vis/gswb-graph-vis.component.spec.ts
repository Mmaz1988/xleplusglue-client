import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

import { GswbGraphVisComponent } from './gswb-graph-vis.component';

describe('GswbGraphVisComponent', () => {
  let component: GswbGraphVisComponent;
  let fixture: ComponentFixture<GswbGraphVisComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [GswbGraphVisComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    });
    fixture = TestBed.createComponent(GswbGraphVisComponent);
    component = fixture.componentInstance;
    component.graphID = 'explanation-graph-spec';
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /** Regression: 86c61f3 fixed every explanation node at 80 x 30px, so a premise or
   *  intermediate result longer than that spilled out of its box. */
  it('sizes each node to its label, so a node matches its contents', () => {
    const long = '(g_e -o (f_e -o h_t)) : \\x.\\y.love(x,y)';
    component.renderGraph([
      { data: { id: long, color: 'yellow' } },
      { data: { id: 'a', color: 'green' } },
      { data: { id: 'e1', source: long, target: 'a' } },
    ]);
    const cy = (component as any).cy;

    const longNode = cy.getElementById(long);
    const shortNode = cy.getElementById('a');
    expect(longNode.width()).toBeGreaterThan(200);
    expect(shortNode.width()).toBeLessThan(40);
    // The label fits inside its node. Cytoscape's label box carries a few pixels of its own
    // margin, which label-sized nodes never covered either.
    const labelBox = longNode.boundingBox({ includeNodes: false, includeLabels: true });
    expect(longNode.outerWidth()).toBeGreaterThanOrEqual(labelBox.w - 4);
  });
});
