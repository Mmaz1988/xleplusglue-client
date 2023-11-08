import {Component, Input} from '@angular/core';

@Component({
  selector: 'app-tab',
  template: `
    <div *ngIf="active" class="tab-content">
      <ng-content></ng-content>
    </div>
  `,
  styleUrls: ['./tab.component.css']
})
export class TabComponent {
  @Input() title: string = '';
  @Input() active: boolean = false;
}
