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

  it('keeps the line between the buttons fixed and shows the ranking as a table in a pill', () => {
    component.svgSolutions = true;
    component.items = [{ id: 'a', solution: '<svg>a</svg>' }, { id: 'b', solution: '<svg>b</svg>' }] as any;
    component.itemLabels = ['rank 2 · mean score 0.100', 'rank 1 · mean score 0.900'];
    component.itemRankings = [null, {
      summary: 'rank 1 · mean score 0.900',
      columns: ['Anaphor', 'Antecedent', 'Score'],
      rows: [['it', 'the cat', '0.900'], ['he', 'Bill', '0.800']],
    }];
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;

    // Only the counter stands between Prev and Next; the caption comes after them.
    const controls = element.querySelector('.controls')!;
    const children = Array.from(controls.children).map(child => child.className || child.tagName.toLowerCase());
    expect(children.slice(0, 3)).toEqual(['button', 'status', 'button']);
    expect(element.querySelector('.status')!.textContent!.trim()).toBe('1 / 2 out of 2');
    expect(element.querySelector('app-pill')).toBeNull();

    component.next();
    fixture.detectChanges();
    expect(element.querySelector('.status-label')!.textContent).toContain('rank 1');
    const rows = Array.from(element.querySelectorAll('app-pill .ranking-table tbody tr'))
      .map(row => Array.from(row.querySelectorAll('td')).map(cell => cell.textContent!.trim()));
    expect(rows).toEqual([['it', 'the cat', '0.900'], ['he', 'Bill', '0.800']]);
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

    it('shows and collapses a derived reading, which GSWB sends only as its semanticAnalysis', () => {
      component.items = [{
        id: 'd1',
        semanticAnalysis: {
          syntacticOrigin: 'S0', semId: 'd1', semType: 'lfgxdrt', svg: '<svg>d1</svg>',
          semString: "([],[p(([x1],[bind(x1),x1='peter']))])",
        },
      }];
      expect(shown()).toBe('<svg>d1</svg>');
      expect(component.canCollapse).toBeTrue();

      component.collapseAll();

      expect(dataService.gswbCollapseAnaphora).toHaveBeenCalledOnceWith(
        { semantic: "([],[p(([x1],[bind(x1),x1='peter']))])", parentSolutionId: 'd1' });
      expect(shown()).toBe('<svg>c-d1</svg>');
    });

    it('shows a prolog-drt reading as its text', () => {
      const editor = { updateContent: jasmine.createSpy('updateContent') };
      component.sem = editor as any;
      component.svgSolutions = false;
      component.items = [{
        id: 'p1',
        semanticAnalysis: { syntacticOrigin: 'S0', semId: 'p1', semType: 'prolog-drt', semString: '', prologRender: 'drs([],[])' },
      }];
      expect(editor.updateContent).toHaveBeenCalledWith('drs([],[])');
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

    it('shows what the collapse did, and why a rejected reading is not collapsed', () => {
      dataService.gswbCollapseAnaphora.and.callFake((request: any) => of(request.parentSolutionId === 'bad'
        ? { id: 'c-bad', rejection: 'Referent x2 occurs outside the scope (I9)' }
        : { id: `c-${request.parentSolutionId}`, solution: `<svg>c-${request.parentSolutionId}</svg>`,
            semantic: 'c', collapseReport: 's1 accommodated at s0' }) as any);
      component.items = [pcdrs('b1', '([x1],[ant(x1)])'), pcdrs('bad', '([x2],[ant(x2)])')];

      component.collapseAll();

      expect(component.collapseNote).toBe('s1 accommodated at s0');
      component.next();
      expect(shown()).toBe('<svg>bad</svg>');
      expect(component.collapseNote).toContain('rejected');
      expect(component.collapseNote).toContain('I9');
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

  describe('reading order and filters', () => {
    const profile = (pronouns: number[], accommodation = [0, 0, 0]) =>
      ({ pronouns, binding: [0, 0, 0], accommodation });
    const reading = (id: string, semanticOrigin: string, pragmaticProfile: any) => ({
      id, semanticOrigin, drsString: id, ruleBranch: 1, anaphoraMapping: { relations: [] }, collapsed: false, pragmaticProfile,
    });
    const items = ['p1', 'p2', 'p3'].map(id => ({ id, solution: `<svg>${id}</svg>`, semantic: id } as any));
    const context = (anaphoraRanking?: any) => ({
      updates: [{
        id: 'du-s', sourceElementId: 's', sourceElementKind: 'sequence', semDiscourseMapping: {},
        discourse: [
          reading('p1', 'wide+b', profile([0, 0, 1])),
          reading('p2', 'narrow+b', profile([1, 0, 0], [1, 0, 0])),
          reading('p3', 'narrow+b', profile([0, 1, 0])),
        ],
        ...(anaphoraRanking ? { anaphoraRanking } : {}),
      }],
      // `wide` takes scope against the surface.
      discriminants: [{ id: 'd', type: 'scope', identifier: 'd', associatedSolutions: ['wide'], surfaceAligned: false }],
      averager: 'borda',
    } as any);
    const shown = () => component.allItems.map(item => item.id);

    beforeEach(() => {
      component.svgSolutions = true;
      component.items = items;
      component.itemLabels = ['label p1', 'label p2', 'label p3'];
    });

    it('offers only the criteria and filters that apply, surface alignment checked', () => {
      component.readingOrder = context();
      expect(component.orderOptions.criteria).toEqual(['surface', 'pronouns', 'accommodation']);
      expect(component.orderOptions.filters).toEqual(['unbound', 'accommodated']);
      expect(component.orderCriteria).toEqual(['surface']);
      expect(component.readingFilters).toEqual([]);

      component.readingOrder = context({ method: 'm', methods: ['m'], branches: [], relations: [], warnings: [] });
      expect(component.orderOptions.criteria).toContain('lm');
    });

    it('orders by the checked criteria; captions stay with their items', () => {
      component.readingOrder = context();
      // Surface alone: p1 scopes against the surface; p2 and p3 tie and keep their order.
      expect(shown()).toEqual(['p2', 'p3', 'p1']);

      component.toggleCriterion('surface');
      component.toggleCriterion('pronouns');
      expect(shown()).toEqual(['p2', 'p3', 'p1']);
      expect(component.currentLabel).toBe('label p2');

      // A refreshed context keeps the reading shown.
      component.next();
      component.readingOrder = context();
      expect(component.currentLabel).toBe('label p3');

      component.toggleCriterion('pronouns');
      // Nothing checked: the owner's order.
      expect(shown()).toEqual(['p1', 'p2', 'p3']);
    });

    it('hides readings by the filters, for display only', () => {
      component.readingOrder = context();
      component.toggleFilter('unbound');
      expect(component.items.map(item => item.id)).toEqual(['p2', 'p3']);
      component.toggleFilter('accommodated');
      expect(component.items.map(item => item.id)).toEqual(['p3']);
      expect(component.allItems.length).toBe(3);
      component.toggleFilter('unbound');
      component.toggleFilter('accommodated');
      expect(component.items.length).toBe(3);
    });

    it('orders semantic readings by its own scope discriminants when no discourse is given', () => {
      component.setItems([{ id: 's0' }, { id: 's1' }] as any);
      component.setDiscriminants([
        { id: 'a', type: 'scope', identifier: 'A', associatedSolutions: ['s0'], surfaceAligned: false },
        { id: 'b', type: 'scope', identifier: 'B', associatedSolutions: ['s1'], surfaceAligned: true },
      ]);
      expect(component.orderOptions).toEqual({ criteria: ['surface'], filters: [] });
      expect(shown()).toEqual(['s1', 's0']);
    });

    it('explains every offered option', () => {
      component.readingOrder = context({ method: 'm', methods: ['m'], branches: [], relations: [], warnings: [] });
      fixture.detectChanges();
      const labels: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.reading-order label'));
      expect(labels.length).toBe(component.orderOptions.criteria.length + component.orderOptions.filters.length);
      labels.forEach(label => expect(label.title.length).toBeGreaterThan(20));
    });

    it('offers nothing without a discourse or scope discriminants', () => {
      expect(component.orderOptions).toEqual({ criteria: [], filters: [] });
      expect(shown()).toEqual(['p1', 'p2', 'p3']);
    });

    describe('with the discourse\'s selection', () => {
      const visible = () => component.items.map(item => item.id);
      let changes: any[];

      beforeEach(() => {
        changes = [];
        component.readingSelectionChange.subscribe(change => changes.push(change));
        component.readingOrder = context();
      });

      it('starts from it and keeps the top k places, ties together', () => {
        component.readingSelection = { selection: { criteria: ['surface'], filters: [], k: 1 }, own: false };
        expect(component.orderCriteria).toEqual(['surface']);
        expect(component.readingK).toBe(1);
        // p2 and p3 tie on the first place.
        expect(visible()).toEqual(['p2', 'p3']);
        expect(component.allItems.length).toBe(3);

        component.readingSelection = { selection: { criteria: ['pronouns'], filters: [], k: 1 }, own: true };
        expect(visible()).toEqual(['p2']);
        component.toggleBeyondTopK(true);
        expect(visible()).toEqual(['p2', 'p3', 'p1']);
        expect(changes).toEqual([]);
      });

      it('takes the top k over what the narrowing leaves, as a run does', () => {
        component.readingSelection = { selection: { criteria: ['pronouns'], filters: [], k: 1 }, own: true };
        component.setItemFilter(['p1', 'p3']);
        expect(visible()).toEqual(['p3']);
      });

      it('emits every change for the owner to store, and null for the default', () => {
        component.readingSelection = { selection: { criteria: ['surface'], filters: [], k: null }, own: false };
        component.setTopKMode('top');
        component.setTopK('2');
        component.toggleFilter('unbound');
        component.toggleCriterion('lm');
        expect(changes).toEqual([
          { criteria: ['surface'], filters: [], k: 1 },
          { criteria: ['surface'], filters: [], k: 2 },
          { criteria: ['surface'], filters: ['unbound'], k: 2 },
          { criteria: ['surface', 'lm'], filters: ['unbound'], k: 2 },
        ]);
        // The owner's echo keeps the reading shown.
        component.next();
        const current = component.items[component.index].id;
        component.readingSelection = { selection: changes[changes.length - 1], own: true };
        expect(component.items[component.index].id).toBe(current);
        expect(component.readingSelectionOwn).toBeTrue();

        component.useDefaultReadingSelection();
        expect(changes[changes.length - 1]).toBeNull();
      });

      it('marks what the last run sent once the selection keeps something else', () => {
        component.readingSelection = { selection: { criteria: ['surface'], filters: [], k: 1 }, own: false };
        component.sentByLastRun = ['p2', 'p3'];
        expect(component.currentSentByLastRun).toBeNull();

        component.setTopKMode('all');
        expect(visible()).toEqual(['p2', 'p3', 'p1']);
        expect(component.currentSentByLastRun).toBeTrue();
        component.next();
        component.next();
        expect(component.currentSentByLastRun).toBeFalse();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.last-run-badge')?.textContent).toContain('not sent by the last run');
      });

      it('keeps only selectable readings, and marks the others where they show', () => {
        component.readingSelection = { selection: { criteria: ['pronouns'], filters: [], k: 1 }, own: false };
        expect(visible()).toEqual(['p2']);
        // p2 was rejected: the top 1 is the best of the rest.
        component.selectableIds = ['p1', 'p3'];
        expect(visible()).toEqual(['p3']);
        expect(component.currentSelectable).toBeTrue();

        component.toggleBeyondTopK(true);
        expect(visible()).toEqual(['p2', 'p3', 'p1']);
        // The reading shown stays shown.
        expect(component.currentSelectable).toBeTrue();
        component.prev();
        expect(component.currentSelectable).toBeFalse();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.last-run-badge')?.textContent).toContain('rejected, not selectable');
      });

      it('narrows by the owner\'s discriminants and restores their selection', () => {
        component.readingSelection = { selection: { criteria: ['pronouns'], filters: [], k: null }, own: false };
        const discriminant = { id: 'd2', type: 'scope', identifier: 'd2', associatedSolutions: ['p1', 'p3'] } as any;
        component.discriminants = [discriminant];
        component.selectedDiscriminants = { scopeIds: ['d2'], mcIds: [] };
        expect(visible()).toEqual(['p3', 'p1']);
        // The same discriminants again keep the selection made over them.
        component.discriminants = [{ ...discriminant }];
        expect(component.selectedScopeIds).toEqual(['d2']);
      });

      it('offers neither filters nor discriminants when order only', () => {
        component.readingSelection = null;
        component.orderOnly = true;
        component.toggleFilter('unbound');
        expect(component.allItems.length).toBe(3);
        expect(visible().length).toBe(3);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.discriminants')).toBeNull();
        expect(fixture.nativeElement.textContent).not.toContain('Hide');
      });

      it('shows the k control only for a discourse\'s selection', () => {
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.reading-top-k')).toBeNull();
        component.readingSelection = { selection: { criteria: ['surface'], filters: [], k: 1 }, own: true };
        fixture.detectChanges();
        const control: HTMLElement = fixture.nativeElement.querySelector('.reading-top-k');
        expect(control.textContent).toContain('set for this discourse');
        expect(control.querySelector('input[type="number"]')).not.toBeNull();
      });
    });
  });
});
