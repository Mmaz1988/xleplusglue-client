import { Component, ViewChild, AfterViewInit } from '@angular/core';
import { EditorComponent } from '../editor/editor.component';
import {GswbDiscriminant, GswbSolution} from "../models/models"; // adjust path

type DiscBucket = 0 | 1 | 2; // 0=selected, 1=active, 2=inactive
type DiscView = GswbDiscriminant & { _order: number; _bucket: DiscBucket };

@Component({
  selector: 'app-sem-vis',
  templateUrl: './sem-vis.component.html',
  styleUrls: ['./sem-vis.component.css']
})


export class SemVisComponent implements AfterViewInit {
  @ViewChild('sem') sem!: EditorComponent;

  items: GswbSolution[] = [];

  scope_discriminants: GswbDiscriminant[] = [];
  mc_discriminants: GswbDiscriminant[] = [];

  allItems: GswbSolution[] = [];

  index = 0;

  // Multi-select state (store IDs; stable + easy to compare)
  selectedScopeIds: string[] = [];
  selectedMcIds: string[] = [];

  private viewReady = false;
  private pendingValue: string | null = null;

  scope_view: DiscView[] = [];
  mc_view: DiscView[] = [];

  ngAfterViewInit(): void {
    this.viewReady = true;

    if (this.pendingValue !== null) {
      this.sem.updateContent(this.pendingValue);
      this.pendingValue = null;
    } else {
      this.applyCurrent();
    }
  }



  public setItems(items: GswbSolution[], startIndex = 0): void {
    this.allItems = Array.isArray(items) ? items : [];
    this.applyFiltersAndResetIndex(startIndex);
  }

  public setDiscriminants(items: GswbDiscriminant[]): void {
    this.scope_discriminants = items.filter(s => s.type === "scope");
    console.log("Scope discriminants", this.scope_discriminants);
    this.mc_discriminants =items.filter(s => s.type === "MCs");
    console.log("MC discriminants", this.mc_discriminants);

    this.applyFiltersAndResetIndex(0);
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
    if (!this.items.length) return;

    const value = this.items[this.index].solution ?? '';


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

    this.applyFiltersAndResetIndex(0);
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

    this.applyFiltersAndResetIndex(0);
    console.log("Selected MC IDs:", this.selectedMcIds);
  }


   applyFiltersAndResetIndex(startIndex = 0): void {
    const filtered = this.filterItemsBySelectedDiscriminants(this.allItems);

    this.items = filtered;
    this.index = this.items.length
      ? Math.min(Math.max(startIndex, 0), this.items.length - 1)
      : 0;

    this.applyCurrent();
    this.rebuildDiscriminantViews();
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

  wouldFurtherFilter(d: GswbDiscriminant): boolean {
    // If already selected, don't treat it as "inactive" (you probably want it clickable to deselect)
    const alreadySelected =
      this.selectedScopeIds.includes(d.id) || this.selectedMcIds.includes(d.id);
    if (alreadySelected) return true;

    const currentAllowed = this.getCurrentAllowedIds();
    const candidate = new Set(d.associatedSolutions ?? []);

    // intersection(currentAllowed, candidate)
    const nextAllowed = this.intersect(currentAllowed, candidate);

    // "Would not further filter" <=> nextAllowed equals currentAllowed
    return nextAllowed.size !== currentAllowed.size && nextAllowed.size > 0;
  }

  private rebuildDiscriminantViews(): void {
    const decorate = (arr: GswbDiscriminant[]): DiscView[] =>
      arr
        .map((d, i) => {
          const selected =
            this.selectedScopeIds.includes(d.id) || this.selectedMcIds.includes(d.id);

          // active = wouldFurtherFilter for unselected; selected stays in its own bucket
          const active = selected ? true : this.wouldFurtherFilter(d);

          const bucket: 0 | 1 | 2 = selected ? 0 : (active ? 1 : 2);

          return { ...d, _order: i, _bucket: bucket };
        })
        .sort((a, b) => (a._bucket - b._bucket) || (a._order - b._order));

    this.scope_view = decorate(this.scope_discriminants);
    this.mc_view = decorate(this.mc_discriminants);
  }

}
