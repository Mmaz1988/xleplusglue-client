import { Component } from '@angular/core';

@Component({
  selector: 'app-center-container',
  templateUrl: './center-container.component.html',
  styleUrls: ['./center-container.component.css'],
  // The standalone LiGER and GSWB views: one column of fluid boxes, like regression testing.
  host: { class: 'fluid-boxes' },
})
export class CenterContainerComponent {

}
