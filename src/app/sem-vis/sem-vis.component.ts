import { Component, ViewChild, AfterViewInit } from '@angular/core';
import { EditorComponent } from '../editor/editor.component'; // adjust path

@Component({
  selector: 'app-sem-vis',
  templateUrl: './sem-vis.component.html',
  styleUrls: ['./sem-vis.component.css']
})
export class SemVisComponent implements AfterViewInit {
  @ViewChild('sem') sem!: EditorComponent;

  items: string[] = [];
  index = 0;

  private viewReady = false;
  private pendingValue: string | null = null;

  ngAfterViewInit(): void {
    this.viewReady = true;

    if (this.pendingValue !== null) {
      this.sem.updateContent(this.pendingValue);
      this.pendingValue = null;
    } else {
      this.applyCurrent();
    }
  }

  /** Call this from a parent via ViewChild to replace the list. */
  public setItems(items: string[], startIndex = 0): void {
    this.items = Array.isArray(items) ? items : [];
    this.index = this.items.length ? Math.min(Math.max(startIndex, 0), this.items.length - 1) : 0;
    this.applyCurrent();
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

    const value = this.items[this.index] ?? '';

    if (this.viewReady && this.sem) {
      this.sem.updateContent(value);
    } else {
      this.pendingValue = value;
    }
  }
}
