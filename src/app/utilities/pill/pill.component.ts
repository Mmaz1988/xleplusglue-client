import { ChangeDetectionStrategy, Component, EventEmitter, HostBinding, Input, Output } from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';
import { OverlayModule } from '@angular/cdk/overlay';
import { ConnectedPosition } from '@angular/cdk/overlay';



type PillVariant = 'glyph-grid' | 'text';

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

  @Input() gridSize = 1;
  @Input() text = '';

  @Input() minimizedColor = '#2e7d32';

  @HostBinding('style.--pill-min-color')
  get pillMinColor(): string {
    return this.minimizedColor;
  }

  positions: ConnectedPosition[] = [
    // Prefer above, centered
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
    // Fallback below, centered
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
  ];

  open = false;

  @Output() opened = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  trackByIdx = (i: number) => i;

  toggle(): void {
    if (this.closeOnly && this.open) return;
    this.open = !this.open;
    (this.open ? this.opened : this.closed).emit();
  }

  close(e: MouseEvent): void {
    e.stopPropagation();
    if (!this.open) return;
    this.open = false;
    this.closed.emit();
  }
}
