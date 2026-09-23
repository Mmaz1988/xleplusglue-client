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

  const sccId = '([v1, v2, v3], [(v1,v2), (v2,v1), (v2,v3)])';
  const member = (id: string, color = 'green') => ({ data: { id, color } });
  const scc = (extra: object) => ({ data: { id: sccId, color: 'green', text: 'g_e, (g_e -o f_t), f_t',
    subgraph: { graphElements: [member('g_e'), member('(g_e -o f_t)'), member('f_t', 'yellow'),
      { data: { id: 'p1', color: 'blue' } }, { data: { id: 'x', source: 'p1', target: 'g_e' } }] }, ...extra } });
  const render = (sccNode: any) => {
    component.renderGraph([sccNode, { data: { id: 'h_t', color: 'yellow', text: 'hₜ' } },
      { data: { id: 'e1', source: sccId, target: 'h_t' } }]);
    return (component as any).cy;
  };

  it('labels a strongly connected component by what it produces, keeping its id for edges', () => {
    const cy = render(scc({ outputs: ['gₑ ⊸ fₜ'] }));

    const node = cy.getElementById(sccId);
    expect(node.data('label')).toBe('gₑ ⊸ fₜ');
    expect(node.width()).toBeLessThan(160);
    expect(cy.getElementById('e1').source().id()).toBe(sccId);
  });

  it('draws GSWB\'s pretty print (text), not the plain id, and the id where there is no text', () => {
    component.renderGraph([
      { data: { id: '(g_e -o f_t) -o h_t', color: 'blue', text: '(gₑ ⊸ fₜ) ⊸ hₜ' } },
      { data: { id: 'k_e', color: 'red' } },
    ]);
    const cy = (component as any).cy;

    expect(cy.getElementById('(g_e -o f_t) -o h_t').data('label')).toBe('(gₑ ⊸ fₜ) ⊸ hₜ');
    expect(cy.getElementById('k_e').data('label')).toBe('k_e');
  });

  it('falls back to "SCC n (members)" when GSWB sends no outputs', () => {
    const cy = render(scc({}));

    expect(cy.getElementById(sccId).data('label')).toBe('SCC 1 (3)');
  });

});
