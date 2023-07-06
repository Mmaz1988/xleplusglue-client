import { Component, ViewChild } from '@angular/core';
import { EditorComponent } from "../../editor/editor.component";
import { GswbGraphVisComponent } from "../gswb-graph-vis/gswb-graph-vis.component";
import {SubGraphDialogComponent} from "../sub-graph-dialog/sub-graph-dialog.component";

@Component({
  selector: 'app-derivation-container',
  templateUrl: './derivation-container.component.html',
  styleUrls: ['./derivation-container.component.css']
})


export class DerivationContainerComponent {

  @ViewChild('editorVis') editorVis: EditorComponent;
  @ViewChild('graphVis') graphVis: GswbGraphVisComponent;


  showEditor: boolean; // Set to true to display the editor component
  showGraph: boolean; // Set to true to display the graph component



  ngAfterViewInit(): void {
    // Check if the child components are available
    this.showEditor = false;
    this.showGraph = false;
  }

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
