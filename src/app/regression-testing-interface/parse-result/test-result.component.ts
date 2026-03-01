import { Component, Input, OnInit, ViewChild, AfterViewInit, Output, EventEmitter } from '@angular/core';
import { DialogComponent } from "../../dialog/dialog.component";

type GswbSolution = { id: string; solution: string };
type GswbDiscriminant = any;

@Component({
  selector: 'app-test-result',
  templateUrl: './test-result.component.html',
  styleUrls: ['./test-result.component.css']
})
export class TestResultComponent implements OnInit, AfterViewInit {

  @Input() data: any;
  @ViewChild('solution') dialog!: DialogComponent;

  // NEW: emitter to parent
  @Output() selectionChange = new EventEmitter<{
    sentenceId: string;
    selectedSolutionIds: string[];
  }>();

  sentence_id: string = '';
  sentence: string = '';
  numberOfAppliedRules: number = 0;
  numberOfMCsets: number = 0;
  noOfSolutions: number = 0;

  noOfSelectedSolutions: number = 0;
  selectedSolutions: string[] = []; // solution IDs

  ligerGraph: any;
  ligerMCsets: string = '';
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

  ngAfterViewInit(): void {
    setTimeout(() => {
      if (!this.dialog) return;

      this.dialog.setContent({
        kind: 'semvis',
        items: this.semvisItems,
        discriminants: this.discriminants,
        startIndex: 0
      });
    }, 0);
  }

  // Call this from your "Open" button in the test-result HTML
  openSolutionsDialog(startIndex = 0): void {
    if (!this.dialog) return;

    this.dialog.setContent({
      kind: 'semvis',
      items: this.semvisItems,
      discriminants: this.discriminants,
      startIndex
    });

    this.dialog.showDialog();
  }



  // Hooked from test-result HTML via:
  // <app-dialog #solution (semvisSelectionChange)="onSemvisSelectionChange($event)"></app-dialog>
  onSemvisSelectionChange(ev: { items: GswbSolution[] }) {
    const items = ev.items ?? [];
    this.noOfSelectedSolutions = items.length;
    this.selectedSolutions = items.map(s => s.id);
    this.emitSelection();
  }

  private emitSelection(): void {
    this.selectionChange.emit({
      sentenceId: this.sentence_id,
      selectedSolutionIds: [...this.selectedSolutions],
    });
  }
}
