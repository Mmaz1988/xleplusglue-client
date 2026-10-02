import { Component, ViewChild } from '@angular/core';
import { EditorComponent } from "../../editor/editor.component";
import { GswbGraphVisComponent } from "../gswb-graph-vis/gswb-graph-vis.component";
import {SubGraphDialogComponent} from "../../sub-graph-dialog/sub-graph-dialog.component";

@Component({
  selector: 'app-derivation-container',
  templateUrl: './derivation-container.component.html',
  styleUrls: ['./derivation-container.component.css']
})


export class DerivationContainerComponent {

  @ViewChild('editorVis') editorVis: EditorComponent;
  @ViewChild('graphVis') graphVis: GswbGraphVisComponent;


  // Both hidden until gswb-vis picks one. Set here, not in ngAfterViewInit: changing them
  // after the first check is an ExpressionChangedAfterItHasBeenChecked error in dev mode.
  showEditor = false; // Set to true to display the editor component
  showGraph = false; // Set to true to display the graph component

  editorVisUpdateContent(content: string)
  {
    console.log(this.editorVis)
    this.editorVis.updateContent(content);
  }

  graphVisUpdateContent(content: any)
  {
    console.log(this.graphVis);
    this.graphVis.renderGraph(content);
  }

}
