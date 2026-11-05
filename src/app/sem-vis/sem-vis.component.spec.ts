import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { Subject, of, throwError } from 'rxjs';

import { SemVisComponent } from './sem-vis.component';
import { DataService } from '../data.service';

describe('SemVisComponent', () => {
  let component: SemVisComponent;
  let fixture: ComponentFixture<SemVisComponent>;
  let dataService: jasmine.SpyObj<DataService>;

  beforeEach(() => {
    dataService = jasmine.createSpyObj<DataService>('DataService', ['gswbCollapseAnaphora', 'gswbRenderPcdrs']);
    dataService.gswbRenderPcdrs.and.callFake((request: any) => of({
      solutions: request.items.map((item: any) => ({ id: item.id, solution: `<svg>r-${item.id}</svg>` })),
    } as any));
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

  describe('the SVG zoom', () => {
    const wide = '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="200" viewBox="0 0 4000 200"><rect width="4000" height="200"/></svg>';
    const svgOf = (element: HTMLElement) => element.querySelector('.sem-svg svg') as SVGSVGElement;

    beforeEach(() => {
      component.svgSolutions = true;
      component.items = [{ id: 'a', solution: wide }, { id: 'b', solution: wide }] as any;
      fixture.detectChanges();
    });

    it('fits a wide DRS to the box by default', () => {
      const element: HTMLElement = fixture.nativeElement;
      const box = element.querySelector('.sem-svg') as HTMLElement;
      expect(component.svgZoom).toBeNull();
      expect(svgOf(element).getBoundingClientRect().width).toBeLessThanOrEqual(box.clientWidth);
      expect(element.querySelector('.svg-zoom-level')!.textContent!.trim()).toBe('fit');
    });

    it('draws it at the zoomed size, kept across readings, and fits it again', () => {
      const element: HTMLElement = fixture.nativeElement;
      component.setSvgZoom(1);
      fixture.detectChanges();
      expect(svgOf(element).getBoundingClientRect().width).toBeCloseTo(4000, 0);

      component.zoomSvgBy(0.5);
      component.next();
      fixture.detectChanges();
      expect(element.querySelector('.svg-zoom-level')!.textContent!.trim()).toBe('50%');
      expect(svgOf(element).getBoundingClientRect().width).toBeCloseTo(2000, 0);

      component.setSvgZoom(null);
      fixture.detectChanges();
      expect(element.querySelector('.sem-svg-canvas')!.getAttribute('style') ?? '').not.toContain('width');
    });

    it('zooms with Ctrl + wheel only, within bounds', () => {
      component.setSvgZoom(1);
      const plain = new WheelEvent('wheel', { deltaY: -100, cancelable: true });
      component.onSvgWheel(plain);
      expect(component.svgZoom).toBe(1);
      expect(plain.defaultPrevented).toBeFalse();

      const pinch = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true });
      component.onSvgWheel(pinch);
      expect(component.svgZoom!).toBeGreaterThan(1);
      expect(pinch.defaultPrevented).toBeTrue();

      component.zoomSvgBy(1000);
      expect(component.svgZoom).toBe(8);
      component.zoomSvgBy(0);
      expect(component.svgZoom).toBe(0.1);
    });

    it('offers no zoom for an SVG without a width', () => {
      component.items = [{ id: 'c', solution: '<svg>c</svg>' }] as any;
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('.svg-zoom')).toBeNull();
    });
  });

  describe('readings rendered on demand', () => {
    const text = (id: string) => ({ id, solution: `drs-${id}`, semantic: `drs-${id}` });
    const shown = () => String((component.currentSvg as any)?.changingThisBreaksApplicationSecurity ?? '');
    const rendered = () => dataService.gswbRenderPcdrs.calls.allArgs().flatMap(([request]) => request.items.map(item => item.id));

    beforeEach(() => {
      component.svgSolutions = true;
      component.renderOnDemand = true;
    });

    it('renders the shown reading and a few around it, not all of them, and none twice', () => {
      component.items = Array.from({ length: 30 }, (_, index) => text(`b${index}`));

      expect(dataService.gswbRenderPcdrs).toHaveBeenCalledTimes(1);
      // The one before (wrapping round), the shown one, eight ahead.
      expect(rendered()).toEqual(['b29', 'b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8']);
      expect(dataService.gswbRenderPcdrs.calls.mostRecent().args[0].items[1].semantic).toBe('drs-b0');
      expect(shown()).toBe('<svg>r-b0</svg>');

      component.next();
      expect(shown()).toBe('<svg>r-b1</svg>');
      // b9 comes into the window: only it is asked for.
      expect(rendered().slice(10)).toEqual(['b9']);

      // The same readings in a new item set (a reopened dialog): nothing is rendered again.
      const before = dataService.gswbRenderPcdrs.calls.count();
      component.items = Array.from({ length: 30 }, (_, index) => text(`b${index}`)).slice(0, 5);
      expect(dataService.gswbRenderPcdrs.calls.count()).toBe(before);
    });

    it('says it is rendering until GSWB answers, and shows the text when GSWB renders none', () => {
      const answer = new Subject<any>();
      dataService.gswbRenderPcdrs.and.returnValue(answer);
      component.items = [text('b1'), text('b2')];
      expect(component.renderNote).toBe('rendering…');
      expect(shown()).toBe('');

      answer.next({ solutions: [{ id: 'b2', solution: '<svg>r-b2</svg>' }] });
      answer.complete();
      expect(shown()).toContain('drs-b1');
      expect(component.renderNote).toBe('not rendered: shown as text');
      component.next();
      expect(shown()).toBe('<svg>r-b2</svg>');
      expect(component.renderNote).toBe('');
    });
  });

  describe('collapsing the selected readings', () => {
    const reading = (id: string) => ({ id, solution: `<svg>${id}</svg>`, semantic: `([x1],[ant(x1)]),A:[a(${id},x1)]` });
    const branch = (id: string) => ({
      id, semanticOrigin: 'sem-a', drsString: `([x1],[ant(x1)]),A:[a(${id},x1)]`, ruleBranch: 1,
      anaphoraMapping: { relations: [] }, collapsed: false,
    });
    const collapsedIds = () => dataService.gswbCollapseAnaphora.calls.allArgs().map(([request]) => request.parentSolutionId);

    beforeEach(() => {
      component.svgSolutions = true;
      component.collapsible = true;
      component.readingOrder = {
        updates: [{ id: 'du', sourceElementId: 's', sourceElementKind: 'sequence', semDiscourseMapping: {},
          discourse: ['p1', 'p2', 'p3', 'p4'].map(branch) } as any],
        discriminants: [], averager: 'borda',
      };
      component.items = ['p1', 'p2', 'p3', 'p4'].map(reading);
    });

    it('collapses only what the selection keeps, and on a wider selection only what it adds', () => {
      component.readingSelection = { selection: { criteria: [], filters: [], k: null }, own: true };
      component.setItemFilter(['p1', 'p2']);
      expect(component.collapsePending).toBe(2);

      component.collapseAll();
      expect(collapsedIds()).toEqual(['p1', 'p2']);
      expect(component.showCollapsed).toBeTrue();

      // The collapsed view is on: widening the selection collapses the readings it adds.
      component.setItemFilter(['p1', 'p2', 'p3']);
      expect(collapsedIds()).toEqual(['p1', 'p2', 'p3']);

      // Narrowing and widening again: p3 is cached, nothing is asked for.
      component.setItemFilter(['p1']);
      component.setItemFilter(['p1', 'p2', 'p3']);
      expect(collapsedIds()).toEqual(['p1', 'p2', 'p3']);
    });

    it('offers Collapse again for readings a selection adds while the PCDRS are shown', () => {
      component.setItemFilter(['p1']);
      component.collapseAll();
      component.toggleCollapsed();
      expect(component.collapseButtonLabel).toBe('Show collapsed');

      component.setItemFilter(['p1', 'p2']);
      expect(collapsedIds()).toEqual(['p1']);
      expect(component.collapseButtonLabel).toBe('Collapse');
      component.onCollapseButton();
      expect(collapsedIds()).toEqual(['p1', 'p2']);
      expect(component.showCollapsed).toBeTrue();
    });

    it('collapses a large selection as it is shown, not all at once', () => {
      const many = Array.from({ length: 60 }, (_, index) => reading(`q${index}`));
      component.items = many;
      component.collapseAll();

      expect(component.showCollapsed).toBeTrue();
      expect(component.collapseOnDemand).toBeTrue();
      // The shown reading, the one before (wrapping round) and eight ahead.
      expect(collapsedIds()).toEqual(['q59', 'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
      expect(String((component.currentSvg as any)?.changingThisBreaksApplicationSecurity)).toBe('<svg>c-q0</svg>');

      component.next();
      // q9 comes into the window: only it is asked for.
      expect(collapsedIds().slice(10)).toEqual(['q9']);
      expect(String((component.currentSvg as any)?.changingThisBreaksApplicationSecurity)).toBe('<svg>c-q1</svg>');
    });

    it('keeps collapsed readings for a reopened discourse', () => {
      component.collapseAll();
      expect(collapsedIds().length).toBe(4);

      component.items = ['p4', 'p3', 'p2', 'p1'].map(id => ({ ...reading(id) }));
      component.items = ['p1', 'p2'].map(reading);
      expect(component.canCollapse).toBeFalse();
      expect(component.collapseButtonLabel).toBe('Show collapsed');
      expect(collapsedIds().length).toBe(4);
    });
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
            semantic: 'c', collapseReport: 's1 accommodated at s0; s2 bound at s0 (s2:y1 ↦ s0:x1); renamed s1:y1 → s0:x2',
            collapseSteps: {
              resolutions: [
                { presupposition: 's1', bound: false, site: 's0', depth: 'GLOBAL', bindings: [] },
                { presupposition: 's2', bound: true, site: 's0', depth: 'INTERMEDIATE',
                  bindings: [{ from: 's2:y1', to: 's0:x1' }] },
              ],
              renamed: [{ from: 's1:y1', to: 's0:x2' }],
            } }) as any);
      component.items = [pcdrs('b1', '([x1],[ant(x1)])'), pcdrs('bad', '([x2],[ant(x2)])')];

      component.collapseAll();

      // N4 6g: tables in a pill, not a line.
      expect(component.collapseNote).toBe('');
      expect(component.collapseTables).toEqual({
        resolutions: [['s1', 'accommodated', 's0', 'global', '–'], ['s2', 'bound', 's0', 'intermediate', 's2:y1 ↦ s0:x1']],
        renamed: [['s1:y1', 's0:x2']],
      });
      component.next();
      expect(component.collapseTables).toBeNull();
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

      component.items = [pcdrs('b9', '([x9],[ant(x9)])')];
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

  describe('names resolved automatically', () => {
    const choice = (point: string, target: string, name?: string) => ({
      kind: 'PRESUPPOSITION', point, pointLabel: point, resolution: target === 'GLOBAL' ? 'ACCOMMODATED' : 'BOUND',
      target, targetLabel: target, id: `PRESUPPOSITION@${point}=${target}`, ...(name ? { name } : {}),
    });
    const reading = (id: string, choices: any[]) => ({
      id, semanticOrigin: 'sem', drsString: id, ruleBranch: 1, anaphoraMapping: { relations: [] }, collapsed: false, choices,
    });
    // Two mentions of Kim: the second bound to the first (automatic) or accommodated anew;
    // and "the dog": accommodated or bound.
    const discourse = [
      reading('r1', [choice('0-3', 'GLOBAL', 'kim'), choice('10-13', '0-3', 'kim'), choice('20-27', 'GLOBAL')]),
      reading('r2', [choice('0-3', 'GLOBAL', 'kim'), choice('10-13', 'GLOBAL', 'kim'), choice('20-27', 'GLOBAL')]),
      reading('r3', [choice('0-3', 'GLOBAL', 'kim'), choice('10-13', '0-3', 'kim'), choice('20-27', '0-3')]),
    ];
    const points = () => component.presupposition_points.map(point => point.point);

    beforeEach(() => {
      component.svgSolutions = true;
      component.readingOrder = {
        updates: [{ id: 'du', sourceElementId: 's', sourceElementKind: 'sequence', semDiscourseMapping: {}, discourse } as any],
        discriminants: [], averager: 'borda',
      };
      component.items = discourse.map(r => ({ id: r.id, solution: `<svg>${r.id}</svg>`, semantic: r.id } as any));
      component.pragmaticSelection = { choiceIds: [], hiddenReadingIds: [] };
      component.readingSelection = { selection: { criteria: [], filters: [], k: null }, own: true };
    });

    it('offers a name\'s choice point only while the names filter does not decide it', () => {
      expect(points()).toContain('10-13');
      component.toggleFilter('names');
      expect(points()).not.toContain('10-13');
      expect(points()).toContain('20-27');
      component.toggleFilter('names');
      expect(points()).toContain('10-13');
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
      expect(component.orderOptions.criteria).toEqual(['surface', 'pronouns', 'accommodation', 'random']);
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
      expect(component.orderOptions).toEqual({ criteria: ['surface', 'random'], filters: [] });
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

  describe('pragmatic discriminants and hiding by hand', () => {
    const choice = (kind: string, point: string, resolution: string, target: string, label = target) => ({
      kind, point, pointLabel: kind === 'ANAPHORA' ? 'It' : 'The dog', resolution, target, targetLabel: label,
      id: `${kind}@${point}=${target}`, direct: true,
    });
    const reading = (id: string, semanticOrigin: string, choices: any[]) => ({
      id, semanticOrigin, drsString: id, ruleBranch: 1, anaphoraMapping: { relations: [] }, collapsed: false, choices,
    });
    // It -> a man or a dog; the dog accommodated or bound to a man.
    const discourse = [
      reading('r1', 'wide', [choice('ANAPHORA', '33-35', 'ANTECEDENT', '2-5', 'man'), choice('PRESUPPOSITION', '17-24', 'ACCOMMODATED', 'GLOBAL', 'global')]),
      reading('r2', 'wide', [choice('ANAPHORA', '33-35', 'ANTECEDENT', '12-15', 'dog'), choice('PRESUPPOSITION', '17-24', 'ACCOMMODATED', 'GLOBAL', 'global')]),
      reading('r3', 'narrow', [choice('ANAPHORA', '33-35', 'ANTECEDENT', '2-5', 'man'), choice('PRESUPPOSITION', '17-24', 'BOUND', '2-5', 'man')]),
    ];
    const items = discourse.map(r => ({ id: r.id, solution: `<svg>${r.id}</svg>`, semantic: r.id } as any));
    let emitted: any[];
    const visible = () => component.items.map(item => item.id);
    const chips = () => Array.from(fixture.nativeElement.querySelectorAll('.discriminants.pragmatic .chip')) as HTMLButtonElement[];
    const chip = (text: string) => chips().find(button => button.textContent!.trim() === text)!;

    beforeEach(() => {
      emitted = [];
      component.pragmaticSelectionChange.subscribe((selection: any) => emitted.push(selection));
      component.svgSolutions = true;
      component.items = items;
      component.readingOrder = { updates: [{ id: 'du', sourceElementId: 's', sourceElementKind: 'sequence', semDiscourseMapping: {},
        discourse }], discriminants: [], averager: 'borda' } as any;
      component.pragmaticSelection = { choiceIds: [], hiddenReadingIds: [] };
      fixture.detectChanges();
    });

    it('lists anaphora and presupposition in a row of their own, by choice point', () => {
      const blocks = fixture.nativeElement.querySelectorAll('.discriminants.pragmatic .disc-block');
      expect(blocks.length).toBe(2);
      expect(blocks[0].textContent).toContain('Anaphora discriminants');
      expect(chips().map(button => button.textContent!.trim())).toEqual(['man', 'dog', 'bound to man', 'global']);
    });

    it('narrows by a selected alternative and emits it for the owner to store', () => {
      chip('man').click();
      fixture.detectChanges();
      expect(visible()).toEqual(['r1', 'r3']);
      expect(emitted.pop()).toEqual({ choiceIds: ['ANAPHORA@33-35=man'.replace('man', '2-5')], hiddenReadingIds: [] });
      // Within the survivors, "dog" would leave nothing: inactive (D7).
      expect(chip('dog').disabled).toBeTrue();
      // The header says what is selected, not only what would narrow further.
      expect(fixture.nativeElement.querySelector('.discriminants.pragmatic h4').textContent).toContain('1 selected');
      expect(fixture.nativeElement.querySelector('.disc-point-label').textContent).toContain('It ⟶');
    });

    it('narrows the scope discriminants by the pragmatic selection too (D8)', () => {
      component.discriminants = [{ id: 'd', type: 'scope', identifier: 'd', associatedSolutions: ['r3'] } as any];
      chip('global').click();
      fixture.detectChanges();
      expect(component.wouldFurtherFilter(component.scope_discriminants[0])).toBeFalse();
    });

    it('hides a reading by hand, out of the shown readings, and restores it', () => {
      component.index = 0;
      fixture.detectChanges();
      (Array.from(fixture.nativeElement.querySelectorAll('.controls button')) as HTMLButtonElement[])
        .find(button => button.textContent!.trim() === 'Hide')!.click();
      fixture.detectChanges();
      expect(visible()).toEqual(['r2', 'r3']);
      expect(emitted.pop()).toEqual({ choiceIds: [], hiddenReadingIds: ['r1'] });
      component.restoreAll();
      expect(visible()).toEqual(['r1', 'r2', 'r3']);
      expect(emitted.pop()).toEqual({ choiceIds: [], hiddenReadingIds: [] });
    });

    it('makes an alternative only hidden readings hold inactive: it would leave nothing shown', () => {
      // r2 is the only reading with It -> dog.
      component.pragmaticSelection = { choiceIds: [], hiddenReadingIds: ['r2'] };
      fixture.detectChanges();
      expect(chip('dog').disabled).toBeTrue();
      component.restoreAll();
      fixture.detectChanges();
      expect(chip('dog').disabled).toBeFalse();
    });

    it('never shows a hidden reading the discriminants exclude', () => {
      component.pragmaticSelection = { choiceIds: [], hiddenReadingIds: ['r1'] };
      fixture.detectChanges();
      chip('dog').click();
      component.toggleShowHidden(true);
      fixture.detectChanges();
      expect(visible()).toEqual(['r2']);
      expect(fixture.nativeElement.querySelector('.hidden-readings').textContent).toContain('0/1 kept by the discriminants');
    });

    it('selects an alternative among thousands of readings without recomputing the survivors per chip', () => {
      // Six definites, each accommodated globally or locally: every combination, repeated. The
      // template asks every chip whether it is active on every change detection; each answer
      // used to recompute the survivors with an array search per reading (a frozen page for
      // the 36,836 readings of a long conditional).
      const points = ['0-3', '10-13', '20-23', '30-33', '40-43', '50-53'];
      const many = Array.from({ length: 8000 }, (_, n) => reading(`m${n}`, 'wide', points.map((point, bit) =>
        choice('PRESUPPOSITION', point, 'ACCOMMODATED', (n >> bit) & 1 ? 'LOCAL' : 'GLOBAL', (n >> bit) & 1 ? 'local' : 'global'))));
      component.items = many.map(r => ({ id: r.id, solution: `<svg>${r.id}</svg>`, semantic: r.id } as any));
      component.readingOrder = { updates: [{ id: 'du', sourceElementId: 's', sourceElementKind: 'sequence', semDiscourseMapping: {},
        discourse: many }], discriminants: [], averager: 'borda' } as any;
      fixture.detectChanges();
      expect(chips().length).toBe(12);

      const start = performance.now();
      chips()[0].click();
      fixture.detectChanges();
      chips()[2].click();
      fixture.detectChanges();
      const elapsed = performance.now() - start;

      expect(component.items.length).toBe(2000);
      expect(chips().filter(button => !button.disabled).length).toBe(2 + 8);
      expect(elapsed).toBeLessThan(1500);
    });
  });
});
