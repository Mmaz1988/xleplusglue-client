import { Component } from '@angular/core';
import { APP_DEFAULTS } from '../../app-defaults';

@Component({
  selector: 'app-gswb-vis-container',
  templateUrl: './gswb-vis-container.component.html',
  styleUrls: ['./gswb-vis-container.component.css']
})
export class GswbVisContainerComponent {
  /** On its own, GSWB has no LiGER to fill its premises: it opens with a demo set. */
  readonly demoPremises = APP_DEFAULTS.gswb.demoPremises;
}
