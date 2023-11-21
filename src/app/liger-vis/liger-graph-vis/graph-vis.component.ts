import {Component, Input, OnInit, ViewChild, ElementRef} from '@angular/core';
import cytoscape, {Core} from 'cytoscape';
import dagre from 'cytoscape-dagre';
import popper from 'cytoscape-popper';
import tippy from 'tippy.js';
import {SubGraphDialogComponent} from "../../sub-graph-dialog/sub-graph-dialog.component";

cytoscape.use(dagre);
cytoscape.use(popper);



const style = [
  {
    selector: 'node[node_type="input"]',
    style: {
      'content': 'data(avp.text)',
      'color': 'blue',
      'shape': 'rectangle',
      'text-valign': 'center',
      'text-halign': 'center',
      'height': '40px',
      'width': '120px',
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "lightblue white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60"
    }
  },
  {
    selector: 'node[node_type="cnode"]',
    style: {
      'content': 'data(avp.text)',
      'color': 'blue',
      'shape': 'rectangle',
      'text-valign': 'center',
      'text-halign': 'center',
      'height': '60px',
      'width': '60px',
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "lightgreen white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60"
    }
  },
  {
    selector: 'node[node_type="annotation"]',
    style: {
      'content': 'data(avp.text)',
      'color': 'blue',
      'text-valign': 'center',
      'text-halign': 'center',
      'height': '60px',
      'width': '60px',
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "red white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60"
    }
  },
  {
    selector: 'edge[edge_type="edge"]',
    style: {
      'width': 3,
      'line-color': '#ccc',
      'target-arrow-color': '#ccc',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier'
    }
  },
  {
    selector: 'edge[edge_type="proj"]',
    style: {
      'width': 3,
      'line-color': '#ccc',
      'line-style': 'dashed',
      'target-arrow-color': '#ccc',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier'
    }
  },
  {
    selector: 'edge[label]',
    style: {
      'label': 'data(label)',
      'text-rotation': 'autorotate',
      'text-margin-x': 15, // Adjusted to a number value
      'text-margin-y': 0 // Adjusted to a number value
    }
  }
];

@Component({
  selector: 'app-graph-vis',
  templateUrl: './graph-vis.component.html',
  styleUrls: ['./graph-vis.component.css']
})
export class GraphVisComponent implements OnInit {

  @ViewChild('graphContainer') graphContainer: ElementRef;
  @ViewChild('subgraphDialog') subgraphDialog: SubGraphDialogComponent;

  @Input() graphID!: string;
  private cy: Core;
  private nodesHidden: boolean = false;
  private selector = 'node[node_type="cnode"]';

  defaultWidth = '800px';
  defaultHeight = '600px';

    ngOnInit(): void {

    this.cy = cytoscape({
      container: document.getElementById('cy'),
      style: style as cytoscape.Stylesheet[],
      layout: {
        name: 'dagre'
      }
      // rest of your cytoscape config
    });

  }

  makePopper(ele: any): void {
 //   console.log("Element: ",ele);
 //   console.log("popper: ",ele.popperRef());
    const ref = ele.popperRef()
 //   console.log("Ref value:",ref)
    ele.tippy = tippy(ref, { // tippy options:
      content: () => {
        let content = document.createElement('div');

        var attributes = ele._private.data;
       // console.log(attributes);

        if (attributes.hasOwnProperty("avp")) {
          for (var key in attributes.avp) {
            content.innerHTML = content.innerHTML + key + " : " + attributes.avp[key] + "<br>";
          }
        }

        //content.innerHTML = ele.id();

        return content;
      },
      trigger: 'manual' // probably want manual mode
    });
  //  console.log("Tippy: ",ele.tippy);
  }

  createAndBindPoppers(): void {
    this.cy.nodes().forEach((ele) => {

      const data = ele.data();

      if (data.hasOwnProperty('avp')) {
      //  console.log("Making popper for: ", data);
        this.makePopper(ele);
      //   console.log("Element with tippy: ",data);

        ele.bind('mouseover', (event) => event.target.tippy.show());
        ele.bind('mouseout', (event) => event.target.tippy.hide());
      }
    });
  }

  renderGraph(graphData): void {
    this.cy = cytoscape({
        container: document.getElementById(this.graphID), // Use the appropriate container element ID
        elements: graphData,
        style: style as cytoscape.Stylesheet[],
        layout: {
          name: 'dagre'
        }
      }
    );
    this.createAndBindPoppers();
    console.log("Container of the subgraph: ",this.cy.container().id);
    console.log("Cy element with data:", this.cy)
  }

  resizeToDefault(): void {
    const graphContainer = this.graphContainer.nativeElement;
    graphContainer.style.width = this.defaultWidth;
    graphContainer.style.height = this.defaultHeight;
  }

  showDialog(){

      this.subgraphDialog.setContent(this.cy.data())
      this.subgraphDialog.showDialog()
  }

  toggleNodes() {
    const nodes = this.cy.nodes(this.selector);

    this.cy.batch(() => {
      if (this.nodesHidden) {
        nodes.style('display', 'element');
      } else {
        nodes.style('display', 'none');
      }

      this.nodesHidden = !this.nodesHidden;
    });
  }

}



