import {ChangeDetectorRef, Component, ViewChild, AfterViewInit, Output, Input, EventEmitter} from '@angular/core';
import {DomSanitizer, SafeHtml} from '@angular/platform-browser';
import { EditorComponent } from '../editor/editor.component';
import {GswbDiscriminant, GswbSolution} from "../models/models"; // adjust path

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

  @Input()
  set items(value: GswbSolution[]) {
    this.assignItems(value ?? []);
    this.applyCurrent();
    this.rebuildDiscriminantViews();
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

  allItems: GswbSolution[] = [];

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

  constructor(private sanitizer: DomSanitizer, private changeDetector: ChangeDetectorRef) {}

  private assignItems(items: GswbSolution[]): void {
    this._items = Array.isArray(items) ? items : [];
    this.allItems = this._items;
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
    console.log("Scope discriminants", this.scope_discriminants);
    this.mc_discriminants = items.filter(s => s.type === "MCs");
    console.log("MC discriminants", this.mc_discriminants);

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

    const value = this.items[this.index].solution ?? '';

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

  toggleScope(d: GswbDiscriminant): void {
    this.selectedScopeIds = this.isScopeSelected(d)
      ? this.selectedScopeIds.filter(id => id !== d.id)
      : [...this.selectedScopeIds, d.id];

    this.applyFiltersAndResetIndex(0, true);
    console.log("Selected scope IDs:", this.selectedScopeIds);
    console.log("Currently allowed:", this.getCurrentAllowedIds())
  }

  isMcSelected(d: GswbDiscriminant): boolean {
    return this.selectedMcIds.includes(d.id);
  }

  toggleMc(d: GswbDiscriminant): void {
    this.selectedMcIds = this.isMcSelected(d)
      ? this.selectedMcIds.filter(id => id !== d.id)
      : [...this.selectedMcIds, d.id];

    this.applyFiltersAndResetIndex(0, true);
    console.log("Selected MC IDs:", this.selectedMcIds);
  }


  applyFiltersAndResetIndex(startIndex = 0, preserveCurrent = true): void {
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

  private filterItemsBySelectedDiscriminants(items: GswbSolution[]): GswbSolution[] {
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
