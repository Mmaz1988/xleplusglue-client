import { Component, Input, Output, EventEmitter } from '@angular/core';
import { context } from "../../models/models";

@Component({
  selector: 'app-history',
  templateUrl: './history.component.html',
  styleUrls: ['./history.component.css']
})
export class HistoryComponent {
  @Input() history: context[][] = [];
  @Output() selectionChanged = new EventEmitter<number[]>();  // Event emitter for selection updates

  selectedIndices: number[] = []; // Stores selected box indices

  constructor() {}

  addHistoryEntry(entry: context[]): void {
    this.history.push(entry);
    this.selectedIndices = []; // Reset selection when new entry is added
    this.emitSelection(); // Notify parent of empty selection
  }

  clearHistory(): void {
    this.history = [];
    this.selectedIndices = [];
    this.emitSelection();
  }

  toggleSelection(index: number): void {
    if (this.selectedIndices.includes(index)) {
      this.selectedIndices = this.selectedIndices.filter(i => i !== index);
    } else {
      this.selectedIndices.push(index);
    }
    this.emitSelection(); // Emit updated selection
  }

  selectAllLastEntry(): void {
    if (this.history.length > 0) {
      const lastEntryIndex = this.history.length - 1;
      this.selectedIndices = this.history[lastEntryIndex].map((_, i) => i);
      this.emitSelection();
    }
  }

  clearSelection(): void {
    this.selectedIndices = [];
    this.selectionChanged.emit(this.selectedIndices);  // Notify parent
    console.log("Selection cleared in history component", this.selectedIndices);
  }

  isSelected(index: number): boolean {
    return this.selectedIndices.includes(index);
  }

  private emitSelection(): void {
    this.selectionChanged.emit(this.selectedIndices);
  }
}
