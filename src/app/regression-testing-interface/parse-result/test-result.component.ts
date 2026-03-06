import { Component, Input, OnInit, ViewChild, AfterViewInit, Output, EventEmitter } from '@angular/core';



type GswbSolution = { id: string; solution: string };
type GswbDiscriminant = any;

@Component({
  selector: 'app-test-result',
  templateUrl: './test-result.component.html',
  styleUrls: ['./test-result.component.css']
})
export class TestResultComponent  {

  @Input() selectedSolutionIds: string[] = [];

  // NEW: emitter to parent
  @Output() selectionChange = new EventEmitter<{
    sentenceId: string;
    selectedSolutionIds: string[];
  }>();

  @Output() openSemVis = new EventEmitter<{
    sentenceId: string;
    items: any[];
    discriminants?: any[];
    startIndex?: number;
    meaningConstructors?: any;
  }>();

  @Input() disambiguationActive = false;

  sentence_id: string = '';
  sentence: string = '';
  numberOfAppliedRules: number = 0;
  numberOfMCsets: number = 0;
  noOfSolutions: number = 0;

  noOfSelectedSolutions: number = 0;
  selectedSolutions: string[] = []; // solution IDs

  ligerGraph: any;
  ligerMCsets: string = '';
  allMCs: string[] = [];
  gswbDerivation: any;

  private semvisItems: GswbSolution[] = [];
  private discriminants: GswbDiscriminant[] = [];

  // test-result.component.ts
  private _data: any;

  @Input()
  set data(v: any) {
    this._data = v;
    this.hydrateFromData();
  }
  get data(): any { return this._data; }

  private hydrateFromData(): void {
    if (!this._data) return;

    this.sentence_id = this._data.sentence_id;
    this.sentence = this._data.sentence;
    this.numberOfAppliedRules = this._data.noOfAppliedRules;
    this.numberOfMCsets = this._data.noOfMCsets;
    this.noOfSolutions = this._data.noOfSolutions;

    this.gswbDerivation = this._data.gswbDerivation;
    this.ligerGraph = this._data.ligerGraph;
    this.ligerMCsets = this._data.ligerMCsets;
    this.allMCs = this._data.allMCs;

    this.semvisItems = (this._data.gswbSolutions ?? []) as GswbSolution[];
    this.discriminants = Array.isArray(this._data.discriminants) ? this._data.discriminants : [];

    // If you still want defaults:
    this.selectedSolutions = this.semvisItems.map(s => s.id);
    this.noOfSelectedSolutions = this.selectedSolutions.length;

    this.emitSelection(); // only if you really want this on every recycle; otherwise guard it
  }


  openSolutionsDialog(startIndex = 0): void {
    this.openSemVis.emit({
      sentenceId: this.sentence_id,
      items: this.semvisItems,
      discriminants: this.discriminants,
      startIndex,
      meaningConstructors: this.allMCs,
    });
  }

  private emitSelection(): void {
    this.selectionChange.emit({
      sentenceId: this.sentence_id,
      selectedSolutionIds: [...this.selectedSolutions],
    });
  }






}
