import {Component, ElementRef, Input, ViewChild} from '@angular/core';
import {SubGraphComponent} from "../sub-graph/sub-graph.component";

@Component({
  selector: 'app-sub-graph-dialog',
  templateUrl: './sub-graph-dialog.component.html',
  styleUrls: ['./sub-graph-dialog.component.css']
})
export class SubGraphDialogComponent {
  @ViewChild('subgraphVis') subgraphVis: SubGraphComponent;
  @ViewChild('subGraphDialog') subGraphDialog: ElementRef;

 // private subgraphID: string

  @Input() subgraphID!: string;

  setContent(content: any)
  {
    console.log(content)
      setTimeout(() => {
        this.subgraphVis.renderGraph(content);
      }, 0);
  }

  showDialog(){
    this.subGraphDialog.nativeElement.show();
  }
}
