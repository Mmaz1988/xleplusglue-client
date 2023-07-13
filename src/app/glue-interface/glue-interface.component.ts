import { Component, ViewChild, AfterViewInit } from '@angular/core';
import {LigerVisComponent} from "../liger-vis/liger-vis.component";
import {GswbVisComponent} from "../gswb-vis/gswb-vis.component";

@Component({
  selector: 'app-glue-interface',
  templateUrl: './glue-interface.component.html',
  styleUrls: ['./glue-interface.component.css']
})
export class GlueInterfaceComponent {

  @ViewChild('l1') liger: LigerVisComponent;
  @ViewChild('g1') glue: GswbVisComponent;

  isFirstDivMinimized = false;
  isSecondDivMinimized = false;


  ngAfterViewInit() {
    this.liger.changeDetector.subscribe(newValue => {
      // Update glue's variable here
      this.glue.editor1.updateContent(newValue);
    });
  }


}
