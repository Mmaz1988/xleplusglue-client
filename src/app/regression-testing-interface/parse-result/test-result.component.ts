import { Component, Input, OnInit, ViewChild, AfterViewInit, Output, EventEmitter } from '@angular/core';

type GswbSolution = { id: string; solution: string };
type GswbDiscriminant = any;

@Component({
  selector: 'app-test-result',
  templateUrl: './test-result.component.html',
  styleUrls: ['./test-result.component.css']
})
export class TestResultComponent implements OnInit {

  @Input() data: any;
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

  ngOnInit(): void {
    if (!this.data) return;

    this.sentence_id = this.data.sentence_id;
    this.sentence = this.data.sentence;
    this.numberOfAppliedRules = this.data.noOfAppliedRules;
    this.numberOfMCsets = this.data.noOfMCsets;
    this.noOfSolutions = this.data.noOfSolutions;

    this.gswbDerivation = this.data.gswbDerivation;
    this.ligerGraph = this.data.ligerGraph;
    this.ligerMCsets = this.data.ligerMCsets;
    this.allMCs = this.data.allMCs;

    this.semvisItems = (this.data.gswbSolutions ?? []) as GswbSolution[];

    this.discriminants = Array.isArray(this.data.discriminants)
      ? this.data.discriminants
      : [];

    // Default: all solutions selected
    this.selectedSolutions = this.semvisItems.map(s => s.id);
    this.noOfSelectedSolutions = this.selectedSolutions.length;

    // Emit initial state so parent has a selection even if user doesn't open dialog
    this.emitSelection();
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
