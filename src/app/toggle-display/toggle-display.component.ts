import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { HideComponentsService, ToggleAction } from '../hide-components.service'
import { Subscription } from 'rxjs';



@Component({
  selector: 'app-toggle-display',
  template: `
    <div [style.display]="isHidden ? 'none' : 'block'">
      <ng-content></ng-content>
    </div>
    <button (click)="toggleDisplay()" class="hide-button">{{isHidden ? showText : hideText}}</button>
  `
})
export class ToggleDisplayComponent implements OnInit, OnDestroy {
  @Input() type;
  @Input() showText = 'Show Content'; // Default text
  @Input() hideText = 'Hide Content'; // Default text

  isHidden = false;
  private hideSubscription: Subscription;

  constructor(private hideComponentService: HideComponentsService) {}
  ngOnInit() {
    this.hideSubscription = this.hideComponentService.toggleObservable.subscribe(payload => {
      // Check if the type matches or if type is not defined (which means all components)
      if (!payload.type || payload.type === this.type) {
        switch (payload.action) {
          case ToggleAction.Hide:
            this.isHidden = true;
            break;
          case ToggleAction.Show:
            this.isHidden = false;
            break;
        }
      }
    });
  }



  ngOnDestroy() {
    this.hideSubscription.unsubscribe();
  }

  toggleDisplay() {
    this.isHidden = !this.isHidden;
  }
}
