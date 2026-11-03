import {ChangeDetectorRef, Component, ElementRef, ViewChild, AfterViewInit, Output, Input, EventEmitter, Injector} from '@angular/core';
import {DomSanitizer, SafeHtml} from '@angular/platform-browser';
import {catchError, concatMap, from, of, toArray} from 'rxjs';
import { EditorComponent } from '../editor/editor.component';
import { DataService } from '../data.service';
import {DiscourseAnalysis, GswbDiscriminant, GswbSolution, PragmaticSelection} from "../models/models";
import {
  PragmaticAlternative,
  PragmaticChip,
  chipsOf,
  heldBy,
  listedChoicePoints,
  narrowedByPragmatics,
  pragmaticAlternatives,
} from '../pragmatic-discriminants';
import { AnaphoraRankingTable, semVisDisplay } from '../analysis-model';
import {
  ReadingCriterion,
  ReadingFilter,
  ReadingOrderContext,
  CRITERION_HINTS,
  CRITERION_LABELS,
  FILTER_HINTS,
  FILTER_LABELS,
  HIDE_FILTERS,
  ORDER_HINT,
  ReadingSelection,
  TOP_K_HINT,
  applicableReadingOptions,
  globalReadingOrder,
  hiddenByFilter,
  sameReadingSelection,
  selectedReadingIds,
} from '../reading-order';

/** What /collapse_anaphora can resolve: an LFGxDRT expression with a presupposition box, an
 *  anaphor marker or an A:/P: mapping. Anything else has nothing to collapse. */
const COLLAPSIBLE_DRS = /\bp\(\(|\bant\(|\bA:\[|\bP:\[/;

/** The drawn width LFGxDRT gives a DRS's SVG (its root's `width`). */
const SVG_WIDTH = /<svg\b[^>]*?\swidth="([\d.]+)"/;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

type DiscStateBucket = 0 | 1 | 2; // 0=selected, 1=active, 2=inactive
type DiscView = GswbDiscriminant & { _order: number; _stateBucket: DiscStateBucket };
type DiscRow = { kind: 'item'; disc: DiscView } | { kind: 'separator'; key: string };
/** A pragmatic choice point as shown: its label and its chips over the current survivors. */
type ChoicePointView = { kind: 'ANAPHORA' | 'PRESUPPOSITION'; point: string; label: string; chips: PragmaticChip[] };

@Component({
  selector: 'app-sem-vis',
  templateUrl: './sem-vis.component.html',
  styleUrls: ['./sem-vis.component.css']
})


export class SemVisComponent implements AfterViewInit {
  @ViewChild('sem') sem!: EditorComponent;
  @ViewChild('svgBox') svgBox?: ElementRef<HTMLElement>;

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

  /** The discourse's reading selection (N4 6d), from an owner that stores it with the
   *  discourse: the options start from it, the view applies its top k, and every change is
   *  emitted (`readingSelectionChange`) for the owner to store and pass back. `own`: stored
   *  for this discourse; otherwise it is the default. Null: the options are this view's own,
   *  with no top k. */
  @Input()
  set readingSelection(value: { selection: ReadingSelection; own: boolean } | null) {
    this.readingSelectionOwn = !!value?.own;
    if (!value) {
      this.readingSelectionEditable = false;
      this.readingK = null;
      this.showBeyondTopK = false;
      return;
    }
    const unchanged = this.readingSelectionEditable && sameReadingSelection(this.currentReadingSelection(), value.selection);
    this.readingSelectionEditable = true;
    if (unchanged) return;
    this.orderCriteria = [...value.selection.criteria];
    this.readingFilters = [...value.selection.filters];
    this.readingK = value.selection.k;
    this.reorder(false);
  }
  readingSelectionEditable = false;
  readingSelectionOwn = false;
  /** The top k places shown; null: every reading. */
  readingK: number | null = null;
  /** Shows the readings beyond the top k too (the filters still hide). */
  showBeyondTopK = false;
  readonly topKHint = TOP_K_HINT;

  /** A changed selection, or null to go back to the default. */
  @Output() readingSelectionChange = new EventEmitter<ReadingSelection | null>();

  /** The readings the last run sent, to mark them while they differ from what the current
   *  selection keeps; null: no run, or nothing to mark. */
  @Input()
  set sentByLastRun(value: string[] | null) {
    this.lastRunIds = value ? new Set(value) : null;
  }
  private lastRunIds: Set<string> | null = null;
  /** What the current selection keeps (discriminants, filters, top k), whatever is shown. */
  private keptBySelection: Set<string> | null = null;

  /** The readings the selection may keep (chat: those Vampire accepted); the others are
   *  shown only beside the top k and marked. Null: every reading. */
  @Input()
  set selectableIds(value: string[] | null) {
    const next = value ? new Set(value) : null;
    const same = (next === null) === (this.selectable === null)
      && (!next || (next.size === this.selectable!.size && [...next].every(id => this.selectable!.has(id))));
    if (same) return;
    this.selectable = next;
    this.applyFiltersAndResetIndex(0, true, false);
  }
  private selectable: Set<string> | null = null;

  /** For the current reading, false when the selection may not keep it; null when every
   *  reading may be kept. */
  get currentSelectable(): boolean | null {
    const current = this.items[this.index];
    if (!this.selectable || !current) return null;
    return this.selectable.has(current.id);
  }

  /** Order only (an older chat message): no filters, no top k, no discriminants. */
  @Input() orderOnly = false;

  /** The owner's discriminants, as an input (see `setDiscriminants`); set again only when
   *  they change, so the selection made over them stays. */
  @Input()
  set discriminants(value: GswbDiscriminant[] | null) {
    const ids = (list: GswbDiscriminant[]) => list.map(d => `${d.id}:${(d.associatedSolutions ?? []).join(',')}`).join('|');
    if (ids(value ?? []) === ids([...this.scope_discriminants, ...this.mc_discriminants])) return;
    this.setDiscriminants(value ?? []);
  }

  /** The owner's stored discriminant selection, as an input (see `setSelectedDiscriminants`);
   *  applied only when it differs from the view's. */
  @Input()
  set selectedDiscriminants(value: { scopeIds: string[]; mcIds: string[] } | null) {
    if (!value) return;
    const same = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
    if (same(value.scopeIds, this.selectedScopeIds) && same(value.mcIds, this.selectedMcIds)) return;
    this.setSelectedDiscriminants(value.scopeIds, value.mcIds);
  }

  /** The discourse's pragmatic discriminant selection and hidden readings, from an owner that
   *  stores them with the discourse; every change is emitted (`pragmaticSelectionChange`) for
   *  the owner to store and pass back. Null: no pragmatic discriminants and no hiding. */
  @Input()
  set pragmaticSelection(value: PragmaticSelection | null) {
    const same = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
    const editable = !!value;
    const choiceIds = value?.choiceIds ?? [];
    const hiddenIds = value?.hiddenReadingIds ?? [];
    if (editable === this.pragmaticEditable && same(choiceIds, this.selectedChoiceIds) && same(hiddenIds, this.hiddenIds)) return;
    this.pragmaticEditable = editable;
    this.selectedChoiceIds = [...choiceIds];
    this.hiddenIds = [...hiddenIds];
    this.refreshPragmaticAlternatives();
    this.applyFiltersAndResetIndex(0, true, false);
  }
  @Output() pragmaticSelectionChange = new EventEmitter<PragmaticSelection>();
  pragmaticEditable = false;
  selectedChoiceIds: string[] = [];
  /** Readings hidden by hand: they refine what the discriminants keep, never replace it. */
  hiddenIds: string[] = [];
  /** Shows the hidden readings the discriminants keep, to restore them. */
  showHidden = false;
  anaphora_points: ChoicePointView[] = [];
  presupposition_points: ChoicePointView[] = [];
  /** The alternatives of the items' readings, over all of them (D7: a selection keeps its
   *  meaning whatever else narrows); null: no reading carries choices. */
  private pragmaticAlternativesCache: PragmaticAlternative[] | null = null;

  /** For the current reading, whether the last run sent it; null when the selection keeps
   *  what that run sent, or there was no run. */
  get currentSentByLastRun(): boolean | null {
    const lastRun = this.lastRunIds;
    const kept = this.keptBySelection;
    const current = this.items[this.index];
    if (!lastRun || !kept || !current) return null;
    const same = lastRun.size === kept.size && [...kept].every(id => lastRun.has(id));
    return same ? null : lastRun.has(current.id);
  }

  private currentReadingSelection(): ReadingSelection {
    return { criteria: [...this.orderCriteria], filters: [...this.readingFilters], k: this.readingK };
  }

  private emitReadingSelection(): void {
    if (this.readingSelectionEditable) this.readingSelectionChange.emit(this.currentReadingSelection());
  }

  setTopKMode(mode: string): void {
    this.setTopK(mode === 'all' ? null : this.readingK ?? 1);
  }

  setTopK(value: number | string | null): void {
    const k = value === null || value === '' ? null : Math.max(1, Math.floor(Number(value)) || 1);
    if (k === this.readingK) return;
    this.readingK = k;
    this.applyFiltersAndResetIndex(0, true);
    this.emitReadingSelection();
  }

  toggleBeyondTopK(show: boolean): void {
    this.showBeyondTopK = show;
    this.applyFiltersAndResetIndex(0, true);
  }

  /** Drops the discourse's own selection; the owner passes the default back. */
  useDefaultReadingSelection(): void {
    this.readingSelectionChange.emit(null);
  }
  /** The PCDRS reading behind each item, for the filters. */
  private readingById = new Map<string, DiscourseAnalysis>();

  criterionLabel(criterion: ReadingCriterion): string {
    return CRITERION_LABELS[criterion];
  }

  /** The applicable filters listed under "Hide" (names has a checkbox of its own). */
  get hideFilters(): ReadingFilter[] {
    return this.orderOptions.filters.filter(filter => HIDE_FILTERS.includes(filter));
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
    this.emitReadingSelection();
  }

  toggleFilter(filter: ReadingFilter): void {
    this.readingFilters = this.isFilterChecked(filter)
      ? this.readingFilters.filter(checked => checked !== filter)
      : [...this.readingFilters, filter];
    this.applyFiltersAndResetIndex(0, true);
    this.emitReadingSelection();
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
    this.refreshPragmaticAlternatives(items);
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

  /** The PCDRS readings behind the items, in the owner's order. */
  private pragmaticReadings(): DiscourseAnalysis[] {
    return this.inputItems.map(item => this.readingById.get(item.id)).filter((reading): reading is DiscourseAnalysis => !!reading);
  }

  private refreshPragmaticAlternatives(items: GswbSolution[] = this.inputItems): void {
    const readings = items.map(item => this.readingById.get(item.id)).filter((reading): reading is DiscourseAnalysis => !!reading);
    this.pragmaticAlternativesCache = this.pragmaticEditable && !this.orderOnly ? pragmaticAlternatives(readings) : null;
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
  /** The shown SVG's drawn width, 0 if it states none. */
  svgWidth = 0;
  /** The SVG's zoom: a factor of its drawn size, or null to fit it to the box's width. Kept
   *  across readings, so they can be compared at one size. */
  svgZoom: number | null = null;

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

  /** While the collapsed view is on: why the shown item is not collapsed; '' otherwise. What
   *  the collapse did is `collapseTables`. */
  get collapseNote(): string {
    if (!this.showCollapsed) return '';
    const current = this.items[this.index];
    if (!current) return '';
    if (this.collapsedFor(current)) return '';
    if (!this.isCollapsibleItem(current)) return 'nothing to collapse';
    const semantic = this.semanticOf(current);
    const error = semantic ? this.collapseErrors.get(semantic) : undefined;
    return error ? `not collapsed: ${error}` : 'not collapsed';
  }

  /** While the collapsed view shows a collapsed item: what the collapse did, as rows of the
   *  p-box table (p-box | resolution | site | depth | bindings) and of the renamed table
   *  (from | to); null when it did nothing. */
  get collapseTables(): { resolutions: string[][]; renamed: string[][] } | null {
    const steps = this.showCollapsed ? this.collapsedFor(this.items[this.index])?.collapseSteps : undefined;
    if (!steps || (!steps.resolutions.length && !steps.renamed.length)) return null;
    return {
      resolutions: steps.resolutions.map(resolution => [
        resolution.presupposition,
        resolution.bound ? 'bound' : 'accommodated',
        resolution.site,
        resolution.depth.toLowerCase(),
        resolution.bindings.length
          ? resolution.bindings.map(binding => `${binding.from} ↦ ${binding.to}`).join(', ')
          : '–',
      ]),
      renamed: steps.renamed.map(renaming => [renaming.from, renaming.to]),
    };
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

  /** The factor that fits the SVG to the box's width, never above its drawn size: read from
   *  the layout, so only on a zoom step, never while the view is checked. */
  private fitZoom(): number {
    const box = this.svgBox?.nativeElement;
    if (!box || !this.svgWidth) return 1;
    const style = getComputedStyle(box);
    const available = box.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
    return available > 0 ? Math.min(1, available / this.svgWidth) : 1;
  }

  /** The zoom as shown; fitting has none, as it depends on the box's layout. */
  get svgZoomLabel(): string {
    return this.svgZoom === null ? 'fit' : `${Math.round(100 * this.svgZoom)}%`;
  }

  /** The canvas width the zoom asks for; null lets the SVG fit the box. */
  get svgCanvasWidth(): number | null {
    return this.svgZoom === null || !this.svgWidth ? null : this.svgWidth * this.svgZoom;
  }

  setSvgZoom(zoom: number | null): void {
    this.svgZoom = zoom === null ? null : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  }

  zoomSvgBy(factor: number): void {
    this.setSvgZoom((this.svgZoom ?? this.fitZoom()) * factor);
  }

  /** Ctrl/Cmd + wheel, and a trackpad pinch (which the browser sends as one), zoom the drawing. */
  onSvgWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    this.zoomSvgBy(Math.exp(-event.deltaY * 0.01));
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
      this.svgWidth = Number(SVG_WIDTH.exec(value)?.[1] ?? 0);
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
    this.forgetDiscriminantState();
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
    items = this.narrowBySelectedDiscriminants(items);
    // Hidden by hand: on top of the discriminants, shown again only on request.
    if (!this.showHidden && this.hiddenIds.length) {
      const hidden = new Set(this.hiddenIds);
      items = items.filter(item => !hidden.has(item.id));
    }
    this.keptBySelection = null;
    // A discourse's selection, over what the narrowing left, as a run takes it
    // (`readingsForReasoning`): filters, then the top k places.
    const context = this.readingOrderContext;
    if (this.readingSelectionEditable && context) {
      const selectable = this.selectable;
      const narrowed = new Set(items.map(item => item.id).filter(id => !selectable || selectable.has(id)));
      const kept = new Set(selectedReadingIds({
        ...context,
        updates: context.updates.map(update => ({ ...update, discourse: update.discourse.filter(reading => narrowed.has(reading.id)) })),
      }, this.currentReadingSelection()));
      this.keptBySelection = kept;
      const filtersOnly = this.showBeyondTopK || this.readingK === null;
      return items.filter(item => !this.readingById.has(item.id) || (filtersOnly
        ? !this.readingFilters.some(filter => hiddenByFilter(this.readingById.get(item.id)!, filter))
        : kept.has(item.id)));
    }
    // The reading filters hide; they never change what the owner reasons over.
    if (this.orderOnly) return items;
    const filters = this.readingFilters.filter(filter => this.orderOptions.filters.includes(filter));
    if (!filters.length) return items;
    return items.filter(item => {
      const reading = this.readingById.get(item.id);
      return !reading || !filters.some(filter => hiddenByFilter(reading, filter));
    });
  }

  /** AND logic: an item must be in every selected discriminant's associatedSolutions, scope,
   *  MC and pragmatic alike (D8). */
  private narrowBySelectedDiscriminants(items: GswbSolution[]): GswbSolution[] {
    items = this.narrowByPragmatics(items);
    const selectedDiscriminants = this.getSelectedDiscriminants();
    if (selectedDiscriminants.length === 0) return items;

    let allowed: Set<string> | null = null;

    for (const d of selectedDiscriminants) {
      const ids = new Set(d.associatedSolutions ?? []);
      allowed = allowed === null ? ids : this.intersect(allowed, ids);
      if (allowed.size === 0) break;
    }

    const allowedIds = allowed ?? new Set<string>();
    return items.filter(it => allowedIds.has(it.id));
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

  /** The items the pragmatic selection keeps; hidden readings are not its business. */
  private narrowByPragmatics<T extends { id: string }>(items: T[]): T[] {
    if (!this.pragmaticEditable || !this.selectedChoiceIds.length) return items;
    const kept = new Set(narrowedByPragmatics(this.pragmaticReadings(), this.pragmaticAlternativesCache, this.selectedChoiceIds)
      .map(reading => reading.id));
    return items.filter(item => kept.has(item.id));
  }

  /** The readings every discriminant can still choose among: what the discriminants keep,
   *  without the readings hidden by hand -- a hidden reading counts as filtered out, so an
   *  alternative only hidden readings hold is inactive, like one that would leave nothing. */
  private getCurrentAllowedIds(): Set<string> {
    if (this.allowedIdsMemo) return this.allowedIdsMemo;
    const kept = this.keptByDiscriminants();
    const hidden = new Set(this.hiddenIds);
    this.allowedIdsMemo = hidden.size ? new Set([...kept].filter(id => !hidden.has(id))) : kept;
    return this.allowedIdsMemo;
  }

  /** The template asks, on every change detection, whether each discriminant and chip would
   *  narrow the survivors; with tens of thousands of readings, computing the survivors anew for
   *  each made a single selection freeze the page. The survivors and the answers are kept
   *  until the state changes: every change goes through `applyFiltersAndResetIndex` or
   *  `rebuildDiscriminantViews`, which forget them. */
  private allowedIdsMemo: Set<string> | null = null;
  private reducesMemo = new WeakMap<object, boolean>();

  private forgetDiscriminantState(): void {
    this.allowedIdsMemo = null;
    this.reducesMemo = new WeakMap();
  }

  /** What the discriminants alone keep: scope, MC and pragmatic selections over all items. */
  private keptByDiscriminants(): Set<string> {
    // Base universe: all current items (unfiltered source-of-truth!), as the pragmatic
    // selection narrows them.
    const universe = new Set(this.narrowByPragmatics(this.allItems).map(s => s.id));

    const selected = this.getSelectedDiscriminants();
    if (selected.length === 0) return universe;

    let allowed: Set<string> = universe;

    for (const d of selected) {
      allowed = this.intersect(allowed, new Set(d.associatedSolutions ?? []));
      if (allowed.size === 0) break;
    }

    return allowed;
  }

  private furtherReducesSolutions(d: { associatedSolutions?: string[] }): boolean {
    const known = this.reducesMemo.get(d);
    if (known !== undefined) return known;
    const currentAllowed = this.getCurrentAllowedIds();
    const nextAllowed = this.intersect(currentAllowed, heldBy(d));
    const reduces = nextAllowed.size !== currentAllowed.size && nextAllowed.size > 0;
    this.reducesMemo.set(d, reduces);
    return reduces;
  }

  wouldFurtherFilter(d: GswbDiscriminant): boolean {
    // If already selected, don't treat it as "inactive" (you probably want it clickable to deselect)
    const alreadySelected =
      this.selectedScopeIds.includes(d.id) || this.selectedMcIds.includes(d.id);
    if (alreadySelected) return true;

    return this.furtherReducesSolutions(d);
  }

  private rebuildDiscriminantViews(): void {
    this.forgetDiscriminantState();
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

    const survivors = this.getCurrentAllowedIds();
    const points = listedChoicePoints(this.pragmaticReadings(), this.pragmaticAlternativesCache,
      [...survivors].map(id => ({ id })), this.selectedChoiceIds)
      .map(point => ({ kind: point.kind, point: point.point, label: point.label, chips: chipsOf(point, survivors) }));
    this.anaphora_points = points.filter(point => point.kind === 'ANAPHORA');
    this.presupposition_points = points.filter(point => point.kind === 'PRESUPPOSITION');
  }

  // ---- Pragmatic discriminants (D6-D8) and hiding by hand ----
  /** A chip is selected when one of the alternatives it stands for is. */
  isChoiceSelected(chip: PragmaticChip): boolean {
    return chip.ids.some(id => this.selectedChoiceIds.includes(id));
  }

  /** Selected, or would narrow the current survivors without emptying them (D7). */
  isChoiceActive(chip: PragmaticChip): boolean {
    return this.isChoiceSelected(chip) || this.furtherReducesSolutions(chip);
  }

  /** Selects every alternative the chip stands for, or deselects them all. */
  toggleChoice(chip: PragmaticChip): void {
    if (!this.isChoiceActive(chip)) return;
    this.selectedChoiceIds = this.isChoiceSelected(chip)
      ? this.selectedChoiceIds.filter(id => !chip.ids.includes(id))
      : [...this.selectedChoiceIds, ...chip.ids.filter(id => !this.selectedChoiceIds.includes(id))];
    this.applyFiltersAndResetIndex(0, true);
    this.emitPragmaticSelection();
  }

  clearChoices(kind: 'ANAPHORA' | 'PRESUPPOSITION'): void {
    const ofKind = new Set((this.pragmaticAlternativesCache ?? []).filter(alternative => alternative.kind === kind)
      .map(alternative => alternative.id));
    this.selectedChoiceIds = this.selectedChoiceIds.filter(id => !ofKind.has(id));
    this.applyFiltersAndResetIndex(0, true);
    this.emitPragmaticSelection();
  }

  /** The selected chips of a kind: a merged chip counts once. */
  selectedChoiceCount(kind: 'ANAPHORA' | 'PRESUPPOSITION'): number {
    const points = kind === 'ANAPHORA' ? this.anaphora_points : this.presupposition_points;
    return points.flatMap(point => point.chips).filter(chip => this.isChoiceSelected(chip)).length;
  }

  activeChoiceCount(points: ChoicePointView[]): number {
    return points.flatMap(point => point.chips).filter(chip => this.furtherReducesSolutions(chip)).length;
  }

  choiceCount(points: ChoicePointView[]): number {
    return points.reduce((sum, point) => sum + point.chips.length, 0);
  }

  isCurrentReadingIn(chip: PragmaticChip): boolean {
    const current = this.items?.[this.index];
    return !!current && heldBy(chip).has(current.id);
  }

  get currentHidden(): boolean {
    const current = this.items[this.index];
    return !!current && this.hiddenIds.includes(current.id);
  }

  /** The hidden readings the discriminants keep: those "show hidden" can bring back. */
  get restorableCount(): number {
    const kept = this.keptByDiscriminants();
    return this.hiddenIds.filter(id => kept.has(id)).length;
  }

  hideCurrent(): void {
    const current = this.items[this.index];
    if (!current || this.hiddenIds.includes(current.id)) return;
    this.hiddenIds = [...this.hiddenIds, current.id];
    this.applyFiltersAndResetIndex(this.index, false);
    this.emitPragmaticSelection();
  }

  restoreCurrent(): void {
    const current = this.items[this.index];
    if (!current) return;
    this.hiddenIds = this.hiddenIds.filter(id => id !== current.id);
    this.applyFiltersAndResetIndex(this.index, true);
    this.emitPragmaticSelection();
  }

  /** Restores every hidden reading; the discriminants still decide what is shown. */
  restoreAll(): void {
    if (!this.hiddenIds.length) return;
    this.hiddenIds = [];
    this.applyFiltersAndResetIndex(0, true);
    this.emitPragmaticSelection();
  }

  toggleShowHidden(show: boolean): void {
    this.showHidden = show;
    this.applyFiltersAndResetIndex(0, true, false);
  }

  private emitPragmaticSelection(): void {
    if (this.pragmaticEditable) {
      this.pragmaticSelectionChange.emit({ choiceIds: [...this.selectedChoiceIds], hiddenReadingIds: [...this.hiddenIds] });
    }
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

    return heldBy(d).has(cur.id);
  }
}
