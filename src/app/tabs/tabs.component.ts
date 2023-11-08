import {AfterContentInit, Component, ContentChildren, QueryList} from '@angular/core';
import {TabComponent} from "../tab/tab.component";

@Component({
  selector: 'app-tabs',
  template: `
    <ul class="tabs">
      <li *ngFor="let tab of tabs" (click)="selectTab(tab)"
          [class.active]="tab.active">
        {{ tab.title }}
      </li>
    </ul>
    <ng-content></ng-content>
  `,
  styleUrls: ['./tabs.component.css']
})

export class TabsComponent implements AfterContentInit {
  @ContentChildren(TabComponent) tabs!: QueryList<TabComponent>;

  // ContentChildren are set
  ngAfterContentInit() {
    // Get all active tabs
    const activeTabs = this.tabs.filter(tab => tab.active);

    // If there is no active tab set, activate the first
    if (activeTabs.length === 0) {
      this.selectTab(this.tabs.first);
    }
  }

  selectTab(tab: TabComponent) {
    // Deactivate all tabs
    this.tabs.toArray().forEach(t => t.active = false);

    // Activate the selected tab
    tab.active = true;
  }
}
