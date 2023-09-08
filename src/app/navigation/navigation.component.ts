import { Component } from '@angular/core';
import {HideComponentsService} from "../hide-components.service";

@Component({
  selector: 'app-navigation',
  templateUrl: './navigation.component.html',
  styleUrls: ['./navigation.component.css']
})

export class NavigationComponent {
  isNavigationVisible: boolean = false;
  isAllHidden = false;

  constructor(private hideComponentsService: HideComponentsService) {}

  toggleAll() {
    if (this.isAllHidden) {
      this.hideComponentsService.showAllComponents("liger");
    } else {
      this.hideComponentsService.hideAllComponents("liger");
    }
    this.isAllHidden = !this.isAllHidden;
  }


  showNavigation() {
    this.isNavigationVisible = true;
  }

  hideNavigation() {
    this.isNavigationVisible = false;
  }

}
