import {ChangeDetectionStrategy, Component, EventEmitter, HostBinding, Input, Output, ViewChild} from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';
import { OverlayModule } from '@angular/cdk/overlay';
import { ConnectedPosition } from '@angular/cdk/overlay';
import {EditorComponent} from "../../editor/editor.component";



type PillVariant = 'glyph-grid' | 'text' | 'editor';

@Component({
  selector: 'app-pill',
  templateUrl: './pill.component.html',
  styleUrls: ['./pill.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PillComponent {
  @Input() badge = 'V';
  @Input() closeOnly = false;

  @Input() variant: PillVariant = 'glyph-grid';

  // Prefer SafeHtml[] if you sanitize upstream; otherwise use string[]
  @Input() glyphs: SafeHtml[] = [];

  @ViewChild('glue') glueEditor: EditorComponent;

  @Input() gridSize = 1;
  @Input() text = '';

  @Input() minimizedColor = '#2e7d32';

  @HostBinding('style.--pill-min-color')
  get pillMinColor(): string {
    return this.minimizedColor;
  }

  private needsEditorSync = false;
  private lastEditorText = '';

  positions: ConnectedPosition[] = [
    // above centered
    { originX: 'center', originY: 'top',    overlayX: 'center', overlayY: 'bottom', offsetY: -8 },

    // below centered
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top',    offsetY:  8 },

    // left of origin (center vertically)
    { originX: 'start',  originY: 'center', overlayX: 'end',    overlayY: 'center', offsetX: -8 },

    // right of origin (center vertically)
    { originX: 'end',    originY: 'center', overlayX: 'start',  overlayY: 'center', offsetX:  8 },
  ];

  open = false;

  @Output() opened = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  trackByIdx = (i: number) => i;

  toggle(): void {
    if (this.closeOnly && this.open) return;
    this.open = !this.open;
    (this.open ? this.opened : this.closed).emit();

    if (this.open && this.variant === 'editor') {
      // wait for the editor to exist in the DOM
      setTimeout(() => this.glueEditor?.updateContent(this.text), 0);
    }
  }

  close(e: MouseEvent): void {
    e.stopPropagation();
    if (!this.open) return;
    this.open = false;
    this.closed.emit();
  }

    ngAfterViewChecked(): void {
      // Runs after Angular updates the view; safe time to touch ViewChild
      if (!this.open || this.variant !== 'editor') return;

    // If editor exists and we need to sync (or text changed), update once
    const editor = this.glueEditor;
    if (!editor) return;

    if (this.needsEditorSync || this.text !== this.lastEditorText) {
      this.glueEditor.updateContent(this.text);
      this.lastEditorText = this.text;
      this.needsEditorSync = false;
    }
  }
}
