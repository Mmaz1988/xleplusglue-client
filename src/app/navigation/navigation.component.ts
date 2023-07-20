import { Component } from '@angular/core';

@Component({
  selector: 'app-navigation',
  templateUrl: './navigation.component.html',
  styleUrls: ['./navigation.component.css']
})

export class NavigationComponent {
  isNavigationVisible: boolean = false;

  showNavigation() {
    this.isNavigationVisible = true;
  }

  hideNavigation() {
    this.isNavigationVisible = false;
  }

}
