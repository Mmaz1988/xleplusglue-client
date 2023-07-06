import { Component,ViewChild, ElementRef } from '@angular/core';
import {GswbGraphVisComponent} from "../gswb-graph-vis/gswb-graph-vis.component";
import {EditorComponent} from "../../editor/editor.component";

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


  setContent(content: any)
  {
    console.log(content)
    if (!(typeof content === 'string' || content instanceof String))
    {
      this.showGraph = true;
      this.showEdit = false;

      setTimeout(() => {
        this.graphVis.renderGraph(content);
      }, 0);

    } else
    {
      this.showGraph = false;
      this.showEdit = true;

      content = content.toString()

      setTimeout(() => {
        this.editorVis.updateContent(content);
      }, 0);
    }

  }

  showDialog(){
    this.dialog.nativeElement.show();
  }

}
