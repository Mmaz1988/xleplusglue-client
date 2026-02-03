import { Component,ViewChild, ElementRef } from '@angular/core';
import {GswbGraphVisComponent} from "../gswb-vis/gswb-graph-vis/gswb-graph-vis.component";
import {EditorComponent} from "../editor/editor.component";

@Component({
  selector: 'app-dialog',
  templateUrl: './dialog.component.html',
  styleUrls: ['./dialog.component.css']
})
export class DialogComponent {

  @ViewChild('dialog') dialog: ElementRef
  @ViewChild('graphVis') graphVis: GswbGraphVisComponent
  @ViewChild('editorVis') editorVis: EditorComponent

  showEdit: boolean;
  showGraph: boolean;
  content:any;

  ngAfterViewInit(): void {
    // Check if the child components are available
    this.showEdit = false;
    this.showGraph = false;
  }


  setContent(content: any) {
    console.log("Content of dialog window:", content);

    if (typeof content === 'string' || content instanceof String) {
      // Prepare editor
      this.showGraph = false;
      this.showEdit = true;

      content = content.toString();

      // Wait for view to update and <app-editor> to be instantiated
      setTimeout(() => {
        if (this.editorVis) {
          this.editorVis.updateContent(content);
        } else {
          console.warn('Editor component not initialized yet');
        }
      }, 0);

    } else {
      // Prepare graph
      this.showEdit = false;
      this.showGraph = true;

      setTimeout(() => {
        if (this.graphVis) {
          this.graphVis.renderGraph(content);
        } else {
          console.warn('Graph component not initialized yet');
        }
      }, 0);
    }
  }


  showDialog(){
    this.dialog.nativeElement.show();
  }

}
