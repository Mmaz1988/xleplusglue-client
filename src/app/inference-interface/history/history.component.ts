import {Component, Input} from '@angular/core';

@Component({
  selector: 'app-history',
  templateUrl: './history.component.html',
  styleUrls: ['./history.component.css']
})
export class HistoryComponent {

@Input() history: string[] = [];

  constructor() { }

  addHistoryEntry(entry: string): void {
    this.history.push(entry);
  }

  clearHistory(): void {
    this.history = [];
  }

  getHistory(): string[] {
    return this.history;
  }

}
