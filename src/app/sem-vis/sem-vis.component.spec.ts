import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { of, throwError } from 'rxjs';

import { SemVisComponent } from './sem-vis.component';
import { DataService } from '../data.service';

describe('SemVisComponent', () => {
  let component: SemVisComponent;
  let fixture: ComponentFixture<SemVisComponent>;
  let dataService: jasmine.SpyObj<DataService>;

  beforeEach(() => {
    dataService = jasmine.createSpyObj<DataService>('DataService', ['gswbCollapseAnaphora']);
    dataService.gswbCollapseAnaphora.and.callFake((request: any) => of({
      id: `${request.parentSolutionId}-collapsed`, solution: `<svg>c-${request.parentSolutionId}</svg>`,
      semantic: `collapsed ${request.parentSolutionId}`,
    } as any));
    TestBed.configureTestingModule({
      declarations: [SemVisComponent],
      imports: [CommonModule, FormsModule],
      providers: [{ provide: DataService, useValue: dataService }],
      schemas: [NO_ERRORS_SCHEMA]
    });
    fixture = TestBed.createComponent(SemVisComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('groups disjoint discriminants together and moves overlaps into later buckets', () => {
    component.setDiscriminants([
      { id: 'a', type: 'scope', identifier: 'A', associatedSolutions: ['1'] },
      { id: 'b', type: 'scope', identifier: 'B', associatedSolutions: ['2'] },
      { id: 'c', type: 'scope', identifier: 'C', associatedSolutions: ['1', '2'] },
    ]);

    const itemLabels = component.scope_rows
      .filter(row => row.kind === 'item')
      .map(row => row.kind === 'item' ? row.disc.identifier : '');
    expect(itemLabels).toEqual(['A', 'B', 'C']);

    const separators = component.scope_rows.filter(row => row.kind === 'separator');
    expect(separators.length).toBe(1);
  });

  it('keeps fully disjoint runs together', () => {
    component.setDiscriminants([
      { id: 'a', type: 'scope', identifier: 'A', associatedSolutions: ['1'] },
      { id: 'b', type: 'scope', identifier: 'B', associatedSolutions: ['2'] },
    ]);

    const separators = component.scope_rows.filter(row => row.kind === 'separator');
    expect(separators.length).toBe(0);
  });

  it('lists surface-order scopings first within a bucket, without moving any between buckets', () => {
    component.setDiscriminants([
      { id: 'inv', type: 'scope', identifier: 'every > the', associatedSolutions: ['1'],
        surfaceKey: [9, 1], surfaceAligned: false },
      { id: 'unk', type: 'scope', identifier: 'unknown', associatedSolutions: ['3'] },
      { id: 'late', type: 'scope', identifier: 'a > every', associatedSolutions: ['4'],
        surfaceKey: [5, 9], surfaceAligned: true },
      { id: 'surf', type: 'scope', identifier: 'the > every', associatedSolutions: ['2'],
        surfaceKey: [1, 9], surfaceAligned: true },
      { id: 'both', type: 'scope', identifier: 'overlap', associatedSolutions: ['1', '2'] },
    ]);

    const labels = component.scope_rows
      .map(row => row.kind === 'item' ? row.disc.identifier : '|');
    expect(labels).toEqual(['the > every', 'a > every', 'unknown', 'every > the', '|', 'overlap']);
  });

  describe('the collapsed view', () => {
    const pcdrs = (id: string, semantic: string) => ({ id, solution: `<svg>${id}</svg>`, semantic });
    const shown = () => String((component.currentSvg as any)?.changingThisBreaksApplicationSecurity ?? '');

    beforeEach(() => {
      component.svgSolutions = true;
      component.collapsible = true;
    });

    it('is offered only for items with presuppositions or anaphora, and only when asked for', () => {
      component.items = [pcdrs('r1', '([x1],[dog(x1)])')];
      expect(component.canCollapse).toBeFalse();

      component.items = [pcdrs('b1', '([x1],[dog(x1),ant(x1)]),A:[a(x1,x1)]')];
      expect(component.canCollapse).toBeTrue();
      component.collapsible = false;
      expect(component.canCollapse).toBeFalse();
      expect(dataService.gswbCollapseAnaphora).not.toHaveBeenCalled();
    });

    it('collapses every collapsible item on request, then toggles between the two views', () => {
      component.items = [
        pcdrs('b1', "([],[p(([x1],[bind(x1),x1='peter']))])"),
        pcdrs('r2', '([x1],[dog(x1)])'),
        pcdrs('b3', '([x1],[ant(x1)]),A:[a(x1,x1)]'),
      ];
      expect(shown()).toBe('<svg>b1</svg>');
      expect(component.canToggleCollapsed).toBeFalse();

      component.collapseAll();

      expect(dataService.gswbCollapseAnaphora.calls.allArgs().map(([request]) => request.parentSolutionId))
        .toEqual(['b1', 'b3']);
      expect(component.showCollapsed).toBeTrue();
      expect(component.canCollapse).toBeFalse();
      expect(shown()).toBe('<svg>c-b1</svg>');
      component.next();
      // Nothing to collapse: the item itself, and the view says why.
      expect(shown()).toBe('<svg>r2</svg>');
      expect(component.collapseNote).toBe('nothing to collapse');

      component.toggleCollapsed();
      component.prev();
      expect(shown()).toBe('<svg>b1</svg>');
      expect(component.collapseNote).toBe('');
    });

    it('offers one button in the window: Collapse, then a toggle between the two views', () => {
      component.items = [pcdrs('b1', '([x1],[ant(x1)])')];
      const tag = () => fixture.nativeElement.querySelector('.solution-action-tag') as HTMLButtonElement;
      fixture.detectChanges();
      expect(tag().textContent!.trim()).toBe('Collapse');

      tag().click();
      fixture.detectChanges();
      expect(shown()).toBe('<svg>c-b1</svg>');
      expect(tag().textContent!.trim()).toBe('Show PCDRS');

      tag().click();
      fixture.detectChanges();
      expect(shown()).toBe('<svg>b1</svg>');
      expect(tag().textContent!.trim()).toBe('Show collapsed');
      expect(dataService.gswbCollapseAnaphora).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.querySelector('.controls input[type=checkbox]')).toBeNull();
    });

    it('shows the collapsed text DRS when the items are text', () => {
      const editor = { updateContent: jasmine.createSpy('updateContent') };
      component.sem = editor as any;
      component.svgSolutions = false;
      component.items = [{ id: 'b1', solution: 'pcdrs text', semantic: '([x1],[ant(x1)])' }];
      expect(editor.updateContent).toHaveBeenCalledWith('pcdrs text');

      component.collapseAll();

      expect(editor.updateContent).toHaveBeenCalledWith('collapsed b1');
    });

    it('keeps the collapsed view for the same items reordered, and drops it for other items', () => {
      const a = pcdrs('b1', '([x1],[ant(x1)])');
      const b = pcdrs('b2', '([x2],[ant(x2)])');
      component.items = [a, b];
      component.collapseAll();

      component.items = [b, a];
      expect(component.showCollapsed).toBeTrue();
      expect(shown()).toBe('<svg>c-b2</svg>');

      component.items = [pcdrs('b9', '([x1],[ant(x1)])')];
      expect(component.showCollapsed).toBeFalse();
      expect(component.canToggleCollapsed).toBeFalse();
      expect(shown()).toBe('<svg>b9</svg>');
    });

    it('says when GSWB could not collapse an item', () => {
      dataService.gswbCollapseAnaphora.and.returnValues(
        throwError(() => ({ error: { message: 's3 is no box' } })),
        of({ id: 'b2-collapsed', solution: '<svg>c-b2</svg>', semantic: 'c' } as any));
      component.items = [pcdrs('b1', '([x1],[ant(x1)])'), pcdrs('b2', '([x2],[ant(x2)])')];

      component.collapseAll();

      expect(component.showCollapsed).toBeTrue();
      expect(shown()).toBe('<svg>b1</svg>');
      expect(component.collapseNote).toBe('not collapsed: s3 is no box');
      component.next();
      expect(shown()).toBe('<svg>c-b2</svg>');
      // Collapse stays on offer for the item that failed.
      expect(component.canCollapse).toBeTrue();
    });
  });
});
