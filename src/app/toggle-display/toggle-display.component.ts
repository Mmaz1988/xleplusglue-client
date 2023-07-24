import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-toggle-display',
  template: `
    <div [style.display]="isHidden ? 'none' : 'block'">
      <ng-content></ng-content>
    </div>
    <button (click)="toggleDisplay()" class="hide-button">{{isHidden ? showText : hideText}}</button>
  `
})
export class ToggleDisplayComponent {
  @Input() showText = 'Show Content'; // Default text
  @Input() hideText = 'Hide Content'; // Default text

  isHidden = false;

  toggleDisplay() {
    this.isHidden = !this.isHidden;
  }
}
