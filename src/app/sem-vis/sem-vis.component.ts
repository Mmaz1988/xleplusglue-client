import {ChangeDetectorRef, Component, ViewChild, AfterViewInit, Output, Input, EventEmitter, Injector} from '@angular/core';
import {DomSanitizer, SafeHtml} from '@angular/platform-browser';
import {catchError, concatMap, from, of, toArray} from 'rxjs';
import { EditorComponent } from '../editor/editor.component';
import { DataService } from '../data.service';
import {DiscourseAnalysis, GswbDiscriminant, GswbSolution} from "../models/models";
import { AnaphoraRankingTable, semVisDisplay } from '../analysis-model';
import {
  ReadingCriterion,
  ReadingFilter,
  ReadingOrderContext,
  CRITERION_HINTS,
  CRITERION_LABELS,
  FILTER_HINTS,
  FILTER_LABELS,
  ORDER_HINT,
  applicableReadingOptions,
  globalReadingOrder,
  hiddenByFilter,
} from '../reading-order';

/** What /collapse_anaphora can resolve: an LFGxDRT expression with a presupposition box, an
 *  anaphor marker or an A:/P: mapping. Anything else has nothing to collapse. */
const COLLAPSIBLE_DRS = /\bp\(\(|\bant\(|\bA:\[|\bP:\[/;

type DiscStateBucket = 0 | 1 | 2; // 0=selected, 1=active, 2=inactive
type DiscView = GswbDiscriminant & { _order: number; _stateBucket: DiscStateBucket };
type DiscRow = { kind: 'item'; disc: DiscView } | { kind: 'separator'; key: string };

@Component({
  selector: 'app-sem-vis',
  templateUrl: './sem-vis.component.html',
  styleUrls: ['./sem-vis.component.css']
})


export class SemVisComponent implements AfterViewInit {
  @ViewChild('sem') sem!: EditorComponent;

  @Input() meaningConstructors: string = '';
  @Input() svgSolutions = false;
  @Input() solutionActionLabel: string | null = null;
  @Input() solutionActionDisabled = false;
  @Output() solutionAction = new EventEmitter<void>();
  @Input() solutionToggleLabel: string | null = null;
  @Input() solutionToggleDisabled = false;
  @Output() solutionToggle = new EventEmitter<void>();

  /** Offers "Collapse" for LFGxDRT items with presuppositions or anaphora (a PCDRS, or a
   *  reading with p-boxes): GSWB's /collapse_anaphora, run on request for every such item,
   *  after which the view toggles between each item and its collapsed DRS. View only: the
   *  items, and anything their owner stores, stay as they are. */
  @Input() collapsible = false;

  @Input()
  set items(value: GswbSolution[]) {
    this.assignItems(value ?? []);
    this.applyCurrent();
    this.rebuildDiscriminantViews();
  }

  /** The discourse the items are PCDRS readings of (their ids are its readings' ids), for the
   *  reading order and filters (N4). Without it the items are semantic readings, ordered by
   *  this view's own scope discriminants. Display only: the owner's items stay as they are. */
  @Input()
  set readingOrder(value: ReadingOrderContext | null) {
    // A first order opens on the best reading; a refreshed one (a ranking arrived) keeps the
    // reading shown.
    const refreshed = !!this.readingOrderContext && !!value;
    this.readingOrderContext = value ?? null;
    this.reorder(refreshed);
  }
  private readingOrderContext: ReadingOrderContext | null = null;

  /** The checked orderings and filters. Surface alignment is the only ordering checked by
   *  default; the filters are off. Only the applicable ones are offered (`orderOptions`). */
  orderCriteria: ReadingCriterion[] = ['surface'];
  readingFilters: ReadingFilter[] = [];
  /** What applies to the current items; the panel shows only these. */
  orderOptions: { criteria: ReadingCriterion[]; filters: ReadingFilter[] } = { criteria: [], filters: [] };
  /** The PCDRS reading behind each item, for the filters. */
  private readingById = new Map<string, DiscourseAnalysis>();

  criterionLabel(criterion: ReadingCriterion): string {
    return CRITERION_LABELS[criterion];
  }

  filterLabel(filter: ReadingFilter): string {
    return FILTER_LABELS[filter];
  }

  criterionHint(criterion: ReadingCriterion): string {
    return CRITERION_HINTS[criterion];
  }

  filterHint(filter: ReadingFilter): string {
    return FILTER_HINTS[filter];
  }

  readonly orderHint = ORDER_HINT;

  isCriterionChecked(criterion: ReadingCriterion): boolean {
    return this.orderCriteria.includes(criterion);
  }

  isFilterChecked(filter: ReadingFilter): boolean {
    return this.readingFilters.includes(filter);
  }

  toggleCriterion(criterion: ReadingCriterion): void {
    this.orderCriteria = this.isCriterionChecked(criterion)
      ? this.orderCriteria.filter(checked => checked !== criterion)
      : [...this.orderCriteria, criterion];
    this.reorder(false);
  }

  toggleFilter(filter: ReadingFilter): void {
    this.readingFilters = this.isFilterChecked(filter)
      ? this.readingFilters.filter(checked => checked !== filter)
      : [...this.readingFilters, filter];
    this.applyFiltersAndResetIndex(0, true);
  }

  /** The context the order is computed in: the owner's, or -- for semantic readings -- one
   *  built from this view's scope discriminants, where only surface alignment applies. */
  private orderContext(): ReadingOrderContext | null {
    if (this.readingOrderContext) return this.readingOrderContext;
    if (!this.scope_discriminants.length) return null;
    return {
      updates: [{
        id: '', sourceElementId: '', sourceElementKind: 'sentence', semDiscourseMapping: {},
        discourse: this.inputItems.map(item => ({
          id: item.id, semanticOrigin: item.id, drsString: '', ruleBranch: 1,
          anaphoraMapping: { relations: [] }, collapsed: false,
        } as DiscourseAnalysis)),
      }],
      discriminants: this.scope_discriminants,
      averager: 'borda',
    };
  }

  /** Orders the items by the checked, applicable criteria; tied items, and items the context
   *  does not know, keep the owner's order. */
  private orderItems(items: GswbSolution[]): GswbSolution[] {
    const context = this.orderContext();
    this.orderOptions = context ? applicableReadingOptions(context) : { criteria: [], filters: [] };
    this.readingById = new Map((context?.updates ?? []).flatMap(update => update.discourse)
      .map(reading => [reading.id, reading]));
    if (!context) return items;
    const places = globalReadingOrder({
      ...context,
      criteria: this.orderCriteria.filter(criterion => this.orderOptions.criteria.includes(criterion)),
    });
    const position = new Map(places.map((place, index) => [place.id, index]));
    const unknown = Number.MAX_SAFE_INTEGER;
    return items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => (position.get(a.item.id) ?? unknown) - (position.get(b.item.id) ?? unknown) || a.index - b.index)
      .map(({ item }) => item);
  }

  /** Orders the items again, showing the first or keeping the current one. */
  private reorder(keepCurrent: boolean): void {
    this.allItems = this.orderItems(this.inputItems);
    this.applyFiltersAndResetIndex(0, keepCurrent, false);
  }

  /** Optional caption per item, index-aligned with the array passed to `items`. Empty by
   *  default, so callers that don't set it are unaffected. */
  @Input() itemLabels: string[] = [];

  /** Resolved by identity against the unfiltered input rather than by `index`: selecting
   *  discriminants narrows `items` to a subset, and a positional lookup would then caption
   *  a solution with another one's label. */
  get currentLabel(): string {
    const position = this.currentPosition();
    return position >= 0 ? this.itemLabels?.[position] ?? '' : '';
  }

  /** Optional ranking per item, index-aligned with `items` like `itemLabels`: shown as a
   *  table in a pill, so the line between the buttons keeps its size. */
  @Input() itemRankings: (AnaphoraRankingTable | null)[] = [];

  get currentRanking(): AnaphoraRankingTable | null {
    const position = this.currentPosition();
    return position >= 0 ? this.itemRankings?.[position] ?? null : null;
  }

  private currentPosition(): number {
    const current = this.items[this.index];
    return current ? this.inputItems.indexOf(current) : -1;
  }

  @Output() selectionChange = new EventEmitter<{
    items: GswbSolution[];
    selectedScopeIds: string[];
    selectedMcIds: string[];
  }>();

  private _items: GswbSolution[] = [];
  get items(): GswbSolution[] {
    return this._items;
  }
  currentSvg: SafeHtml | null = null;

  scope_discriminants: GswbDiscriminant[] = [];
  mc_discriminants: GswbDiscriminant[] = [];

  /** Every item, in the order shown. */
  allItems: GswbSolution[] = [];
  /** Every item as the owner gave them; `itemLabels` and `itemRankings` align with these. */
  private inputItems: GswbSolution[] = [];

  index = 0;

  // Multi-select state (store IDs; stable + easy to compare)
  selectedScopeIds: string[] = [];
  selectedMcIds: string[] = [];

  private viewReady = false;
  private pendingValue: string | null = null;

  // sem-vis.component.ts
  highlightCurrent = true; // default on (set false if you want off by default)

  scope_rows: DiscRow[] = [];
  mc_rows: DiscRow[] = [];

  // ---- collapsed view ----
  /** Collapsed DRS per item semantic: an id names a branch only within one item set. */
  private collapsedBySemantic = new Map<string, GswbSolution>();
  /** Semantics that GSWB could not collapse, with the reason. */
  private collapseErrors = new Map<string, string>();
  showCollapsed = false;
  collapseLoading = false;

  constructor(private sanitizer: DomSanitizer, private changeDetector: ChangeDetectorRef,
              private injector?: Injector) {}

  /** An item's text: what the collapse is keyed on and sent. */
  private semanticOf(item: GswbSolution | undefined): string | undefined {
    return item ? semVisDisplay(item).semantic : undefined;
  }

  private isCollapsibleItem(item: GswbSolution | undefined): boolean {
    const semantic = this.semanticOf(item);
    return typeof semantic === 'string' && COLLAPSIBLE_DRS.test(semantic);
  }

  /** The button: shown while some item could be collapsed and is not yet. */
  get canCollapse(): boolean {
    return this.collapsible && this.allItems.some(item =>
      this.isCollapsibleItem(item) && !this.collapsedBySemantic.has(this.semanticOf(item)!));
  }

  /** The toggle: shown once some item has a collapsed DRS. */
  get canToggleCollapsed(): boolean {
    return this.collapsible && this.allItems.some(item => !!this.collapsedFor(item));
  }

  private collapsedFor(item: GswbSolution | undefined): GswbSolution | undefined {
    const semantic = this.semanticOf(item);
    return semantic ? this.collapsedBySemantic.get(semantic) : undefined;
  }

  /** While the collapsed view is on: what the collapse did to the shown item, or why it is
   *  not collapsed; '' otherwise. */
  get collapseNote(): string {
    if (!this.showCollapsed) return '';
    const current = this.items[this.index];
    if (!current) return '';
    const collapsed = this.collapsedFor(current);
    if (collapsed) return collapsed.collapseReport ?? '';
    if (!this.isCollapsibleItem(current)) return 'nothing to collapse';
    const semantic = this.semanticOf(current);
    const error = semantic ? this.collapseErrors.get(semantic) : undefined;
    return error ? `not collapsed: ${error}` : 'not collapsed';
  }

  /** Collapses every collapsible item that has no collapsed DRS yet, one request after
   *  another, then shows the collapsed view. */
  collapseAll(): void {
    const pending = this.allItems.filter(item =>
      this.isCollapsibleItem(item) && !this.collapsedBySemantic.has(this.semanticOf(item)!));
    if (!pending.length || this.collapseLoading || !this.injector) return;
    const dataService = this.injector.get(DataService);
    // The owner's items: reordering them is not a new item set.
    const items = this.inputItems;
    this.collapseLoading = true;
    from(pending).pipe(
      concatMap(item => dataService.gswbCollapseAnaphora({
        semantic: this.semanticOf(item)!, parentSolutionId: item.id,
      }).pipe(catchError(error => {
        this.collapseErrors.set(this.semanticOf(item)!, error?.error?.message ?? error?.message ?? 'GSWB error');
        return of(null);
      }))),
      toArray(),
    ).subscribe(responses => {
      this.collapseLoading = false;
      // A new item set arrived meanwhile: these belong to the old one.
      if (items !== this.inputItems) return;
      responses.forEach((response, index) => {
        if (response?.rejection) {
          this.collapseErrors.set(this.semanticOf(pending[index])!, `the reading is rejected: ${response.rejection}`);
        } else if (response) {
          this.collapsedBySemantic.set(this.semanticOf(pending[index])!, response);
        }
      });
      this.showCollapsed = true;
      this.applyCurrent();
      this.changeDetector.markForCheck();
    });
  }

  toggleCollapsed(): void {
    if (!this.canToggleCollapsed) return;
    this.showCollapsed = !this.showCollapsed;
    this.applyCurrent();
  }

  private assignItems(items: GswbSolution[]): void {
    const next = Array.isArray(items) ? items : [];
    // The same items again (reordered, say) keep their collapsed view; others start over,
    // so a collapsed view is only ever shown after "Collapse" was asked for on these items.
    const semantics = (list: GswbSolution[]) => new Set(list.map(item => this.semanticOf(item) ?? item.id));
    const before = semantics(this.allItems);
    const after = semantics(next);
    if (before.size !== after.size || [...after].some(key => !before.has(key))) {
      this.collapsedBySemantic.clear();
      this.collapseErrors.clear();
      this.showCollapsed = false;
    }
    this.inputItems = next;
    this.allItems = this.orderItems(next);
    this._items = this.filterItemsBySelectedDiscriminants(this.allItems);
    if (this.index >= this._items.length) {
      this.index = Math.max(this._items.length - 1, 0);
    }
  }

  ngAfterViewInit(): void {
    this.viewReady = true;

    if (this.svgSolutions) {
      this.pendingValue = null;
      this.applyCurrent();
    } else if (this.pendingValue !== null && this.sem) {
      this.sem.updateContent(this.pendingValue);
      this.pendingValue = null;
    } else {
      this.applyCurrent();
    }
    this.changeDetector.detectChanges();
  }


  public setItems(items: GswbSolution[], startIndex = 0): void {
    this.assignItems(items);
    this.applyFiltersAndResetIndex(startIndex, false);
  }

  public setDiscriminants(items: GswbDiscriminant[]): void {
    this.scope_discriminants = items.filter(s => s.type === "scope");
    this.mc_discriminants = items.filter(s => s.type === "MCs");
    // Semantic readings are ordered by these.
    this.allItems = this.orderItems(this.inputItems);

    this.applyFiltersAndResetIndex(0, true);
  }

  public next(): void {
    if (!this.items.length) return;
    this.index = (this.index + 1) % this.items.length;
    this.applyCurrent();
  }

  public prev(): void {
    if (!this.items.length) return;
    this.index = (this.index - 1 + this.items.length) % this.items.length;
    this.applyCurrent();
  }

  private applyCurrent(): void {
    if (!this.items.length) {
      this.currentSvg = null;
      return;
    }

    const current = this.items[this.index];
    const collapsed = this.showCollapsed ? this.collapsedFor(current) : undefined;
    // GSWB returns a collapsed DRS as SVG (`solution`) and as text (`semantic`).
    const value = (collapsed ? (this.svgSolutions ? collapsed.solution : collapsed.semantic) : semVisDisplay(current).solution) ?? '';

    if (this.svgSolutions) {
      this.currentSvg = this.sanitizer.bypassSecurityTrustHtml(value);
      return;
    }

    if (this.viewReady && this.sem) {
      this.sem.updateContent(value);
    } else {
      this.pendingValue = value;
    }
  }

  //Discriminants
  // ---- Multi-select toggles ----
  isScopeSelected(d: GswbDiscriminant): boolean {
    return this.selectedScopeIds.includes(d.id);
  }

  surfaceLabelFor(d: GswbDiscriminant): string {
    const originLabel = Object.values(d.surfaceLabelsByOrigin ?? {})
      .find(label => typeof label === 'string' && label.trim().length > 0);
    return originLabel
      || d.surfaceLabel
      || d.identifier;
  }

  toggleScope(d: GswbDiscriminant): void {
    this.selectedScopeIds = this.isScopeSelected(d)
      ? this.selectedScopeIds.filter(id => id !== d.id)
      : [...this.selectedScopeIds, d.id];

    this.applyFiltersAndResetIndex(0, true);
  }

  isMcSelected(d: GswbDiscriminant): boolean {
    return this.selectedMcIds.includes(d.id);
  }

  toggleMc(d: GswbDiscriminant): void {
    this.selectedMcIds = this.isMcSelected(d)
      ? this.selectedMcIds.filter(id => id !== d.id)
      : [...this.selectedMcIds, d.id];

    this.applyFiltersAndResetIndex(0, true);
  }


  applyFiltersAndResetIndex(startIndex = 0, preserveCurrent = true, notify = true): void {
    const currentId = preserveCurrent ? this.items[this.index]?.id ?? null : null;
    const filtered = this.filterItemsBySelectedDiscriminants(this.allItems);

    this._items = filtered;
    if (!this._items.length) {
      this.index = 0;
    } else if (currentId) {
      const nextIndex = this._items.findIndex(item => item.id === currentId);
      this.index = nextIndex >= 0
        ? nextIndex
        : Math.min(Math.max(startIndex, 0), this._items.length - 1);
    } else {
      this.index = Math.min(Math.max(startIndex, 0), this._items.length - 1);
    }

    this.applyCurrent();
    this.rebuildDiscriminantViews();

    //notify parent(s)
    if (!notify) return;
    this.selectionChange.emit({
      items: this.items,
      selectedScopeIds: [...this.selectedScopeIds],
      selectedMcIds: [...this.selectedMcIds],
    });
  }

  clearScope(): void {
    this.selectedScopeIds = [];
    this.applyFiltersAndResetIndex(0);
  }

  clearMc(): void {
    this.selectedMcIds = [];
    this.applyFiltersAndResetIndex(0);
  }

  /** Ids an owner restricts the items to, on top of any discriminant selection; null shows all.
   *  Narrows `items` the way discriminants do, so the counter reads "n / m out of total". */
  private itemIdFilter: Set<string> | null = null;

  public setItemFilter(ids: string[] | null): void {
    this.itemIdFilter = ids ? new Set(ids) : null;
    this.applyFiltersAndResetIndex(0);
  }

  private filterItemsBySelectedDiscriminants(items: GswbSolution[]): GswbSolution[] {
    const idFilter = this.itemIdFilter;
    if (idFilter) items = items.filter(item => idFilter.has(item.id));
    // The reading filters hide; they never change what the owner reasons over.
    const filters = this.readingFilters.filter(filter => this.orderOptions.filters.includes(filter));
    if (filters.length) {
      items = items.filter(item => {
        const reading = this.readingById.get(item.id);
        return !reading || !filters.some(filter => hiddenByFilter(reading, filter));
      });
    }
    const selectedDiscriminants = this.getSelectedDiscriminants();

    // No selection => no filtering
    if (selectedDiscriminants.length === 0) return items;

    // AND logic: item must be in every selected discriminant's associatedSolutions
    let allowed: Set<string> | null = null;

    for (const d of selectedDiscriminants) {
      const ids = new Set(d.associatedSolutions ?? []);
      allowed = allowed === null ? ids : this.intersect(allowed, ids);
      if (allowed.size === 0) break;
    }

    const allowedIds = allowed ?? new Set<string>();
    return items.filter(it => allowedIds.has(it.id)); // replace with it.id if typed
  }

  private getSelectedDiscriminants(): GswbDiscriminant[] {
    const scopeSelected = this.scope_discriminants.filter(d => this.selectedScopeIds.includes(d.id));
    const mcSelected = this.mc_discriminants.filter(d => this.selectedMcIds.includes(d.id));
    return [...scopeSelected, ...mcSelected];
  }

  private intersect(a: Set<string>, b: Set<string>): Set<string> {
    const out = new Set<string>();
    // iterate smaller set without swapping references
    const small = a.size <= b.size ? a : b;
    const large = a.size <= b.size ? b : a;

    for (const x of small) {
      if (large.has(x)) out.add(x);
    }
    return out;
  }

  private getCurrentAllowedIds(): Set<string> {
    // Base universe: all current items (unfiltered source-of-truth!)
    const universe = new Set(this.allItems.map(s => s.id));

    const selected = this.getSelectedDiscriminants();
    if (selected.length === 0) return universe;

    let allowed: Set<string> | null = null;

    for (const d of selected) {
      const ids = new Set(d.associatedSolutions ?? []);
      allowed = allowed === null ? ids : this.intersect(allowed, ids);
      if (allowed.size === 0) break;
    }

    return allowed ?? new Set<string>();
  }

  private furtherReducesSolutions(d: GswbDiscriminant): boolean {
    const currentAllowed = this.getCurrentAllowedIds();
    const candidate = new Set(d.associatedSolutions ?? []);
    const nextAllowed = this.intersect(currentAllowed, candidate);
    return nextAllowed.size !== currentAllowed.size && nextAllowed.size > 0;
  }

  wouldFurtherFilter(d: GswbDiscriminant): boolean {
    // If already selected, don't treat it as "inactive" (you probably want it clickable to deselect)
    const alreadySelected =
      this.selectedScopeIds.includes(d.id) || this.selectedMcIds.includes(d.id);
    if (alreadySelected) return true;

    return this.furtherReducesSolutions(d);
  }

  private rebuildDiscriminantViews(): void {
    const decorate = (arr: GswbDiscriminant[]): DiscRow[] => {
      const views: DiscView[] = arr.map((d, i) => {
        const selected =
          this.selectedScopeIds.includes(d.id) || this.selectedMcIds.includes(d.id);

        // active = wouldFurtherFilter for unselected; selected stays in its own bucket
        const active = selected ? true : this.wouldFurtherFilter(d);

        const stateBucket: DiscStateBucket = selected ? 0 : (active ? 1 : 2);

        return {...d, _order: i, _stateBucket: stateBucket};
      });

      const buckets: Array<{ items: DiscView[]; solutions: Set<string> }> = [];

      for (const disc of views) {
        const candidate = new Set(disc.associatedSolutions ?? []);
        const bucketIndex = buckets.findIndex(bucket => !this.hasIntersection(bucket.solutions, candidate));

        if (bucketIndex >= 0) {
          buckets[bucketIndex].items.push(disc);
          buckets[bucketIndex].solutions = this.unionSets(buckets[bucketIndex].solutions, candidate);
        } else {
          buckets.push({items: [disc], solutions: candidate});
        }
      }

      // Within a bucket, scopings that follow the surface order first, then by where their
      // elements start, then as GSWB listed them. Buckets themselves are left as they are.
      buckets.forEach(bucket => bucket.items.sort((a, b) => SemVisComponent.compareBySurface(a, b)));

      const rows: DiscRow[] = [];
      buckets.forEach((bucket, bucketIndex) => {
        if (bucketIndex > 0) {
          rows.push({kind: 'separator', key: `sep-${bucketIndex}`});
        }
        bucket.items.forEach(disc => rows.push({kind: 'item', disc}));
      });

      return rows;
    };

    this.scope_rows = decorate(this.scope_discriminants);
    this.mc_rows = decorate(this.mc_discriminants);
  }

  private static compareBySurface(a: DiscView, b: DiscView): number {
    const aligned = (d: DiscView) => d.surfaceAligned === true ? 0 : d.surfaceAligned === false ? 2 : 1;
    const byAlignment = aligned(a) - aligned(b);
    if (byAlignment !== 0) return byAlignment;
    for (let i = 0; i < 2; i++) {
      const left = a.surfaceKey?.[i] ?? Number.MAX_SAFE_INTEGER;
      const right = b.surfaceKey?.[i] ?? Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
    }
    return a._order - b._order;
  }

  private hasIntersection(a: Set<string>, b: Set<string>): boolean {
    const small = a.size <= b.size ? a : b;
    const large = a.size <= b.size ? b : a;
    for (const x of small) {
      if (large.has(x)) return true;
    }
    return false;
  }

  private unionSets(a: Set<string> | null, b: Set<string>): Set<string> {
    const out = new Set<string>(a ?? []);
    for (const x of b) out.add(x);
    return out;
  }

  bucketCount(rows: DiscRow[]): number {
    if (!rows.length) return 0;
    return 1 + rows.filter(row => row.kind === 'separator').length;
  }

  activeDiscriminantCount(discriminants: GswbDiscriminant[]): number {
    return discriminants.filter(d => this.furtherReducesSolutions(d)).length;
  }

  activeBucketCount(rows: DiscRow[]): number {
    let count = 0;
    let hasActiveItem = false;

    for (const row of rows) {
      if (row.kind === 'separator') {
        if (hasActiveItem) count++;
        hasActiveItem = false;
        continue;
      }

      if (this.furtherReducesSolutions(row.disc)) {
        hasActiveItem = true;
      }
    }

    if (rows.length && hasActiveItem) count++;
    return count;
  }

  repeat(s: string, n: number): string {
    return s.repeat(n);
  }


  public replaceLollipop(s: string | null | undefined): string {
    return (s ?? '').replaceAll('⊸', '-o');
  }


  public setSelectedDiscriminants(scopeIds: string[], mcIds: string[]): void {
    this.selectedScopeIds = [...scopeIds];
    this.selectedMcIds = [...mcIds];
    this.applyFiltersAndResetIndex(0);
  }

  captureState(): any {
    return {
      items: this.items.map(item => ({ ...item })),
      index: this.index,
      selectedScopeIds: [...this.selectedScopeIds],
      selectedMcIds: [...this.selectedMcIds],
      scopeDiscriminants: this.scope_discriminants.map(item => ({ ...item })),
      mcDiscriminants: this.mc_discriminants.map(item => ({ ...item })),
      svgSolutions: this.svgSolutions,
      meaningConstructors: this.meaningConstructors,
    };
  }

  restoreState(state: any): void {
    if (!state) {
      return;
    }

    this.scope_discriminants = Array.isArray(state.scopeDiscriminants) ? state.scopeDiscriminants.map((item: GswbDiscriminant) => ({ ...item })) : [];
    this.mc_discriminants = Array.isArray(state.mcDiscriminants) ? state.mcDiscriminants.map((item: GswbDiscriminant) => ({ ...item })) : [];
    this.selectedScopeIds = Array.isArray(state.selectedScopeIds) ? [...state.selectedScopeIds] : [];
    this.selectedMcIds = Array.isArray(state.selectedMcIds) ? [...state.selectedMcIds] : [];
    this.svgSolutions = Boolean(state.svgSolutions);
    this.meaningConstructors = typeof state.meaningConstructors === 'string' ? state.meaningConstructors : this.meaningConstructors;

    if (Array.isArray(state.items)) {
      this.assignItems(state.items.map((item: GswbSolution) => ({ ...item })));
    }

    this.index = Number.isFinite(state.index) ? state.index : this.index;
    this.applyCurrent();
    this.rebuildDiscriminantViews();
  }

  isCurrentSolutionIn(d: GswbDiscriminant): boolean {
    const cur = this.items?.[this.index];
    if (!cur?.id) return false;

    const assoc = d.associatedSolutions ?? [];
    return Array.isArray(assoc) && assoc.includes(cur.id);
  }
}
