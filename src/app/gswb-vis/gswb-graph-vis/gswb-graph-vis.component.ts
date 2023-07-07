import {Component, Input, OnChanges, AfterViewInit, ViewChild, ElementRef} from '@angular/core';
import cytoscape, {Core} from 'cytoscape';
import dagre from 'cytoscape-dagre';
import {SubGraphDialogComponent} from "../../sub-graph-dialog/sub-graph-dialog.component";
import tippy from "tippy.js";

cytoscape.use(dagre);

const styleArray = [
  {
    selector: 'node[color="yellow"]',
    style: {
      'content': 'data(id)',
      'color': 'black',
      'shape': 'rectangle',
      'text-valign': 'center',
      'text-halign': 'center',
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "yellow white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60",
      'width': 'label',  // Set the width based on the label size
      'height': 'label',  // Set the height based on the label size
      'padding': '10px' // Set the padding value as desired
    }
  },
  {
    selector: 'node[color="red"]',
    style: {
      'content': 'data(id)',
      'color': 'black',
      'shape': 'rectangle',
      'text-valign': 'center',
      'text-halign': 'center',
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "red white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60",
      'width': 'label',  // Set the width based on the label size
      'height': 'label',  // Set the height based on the label size
      'padding': '10px' // Set the padding value as desired
    }
  },
  {
    selector: 'node[color="blue"]',
    style: {
      'content': 'data(id)',
      'color': 'back',
      'shape': 'rectangle',
      'text-valign': 'center',
      'text-halign': 'center',
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "lightblue white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60",
      'width': 'label',  // Set the width based on the label size
      'height': 'label',  // Set the height based on the label size
      'padding': '10px' // Set the padding value as desired
    }
  },
  {
    selector: 'node[color="green"]',
    style: {
      'content': 'data(id)',
      'color': 'black',
      'shape': 'rectangle',
      'text-valign': 'center',
      'text-halign': 'center',
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "lightgreen white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60",
      'width': 'label',  // Set the width based on the label size
      'height': 'label',  // Set the height based on the label size
      'padding' : '10px' // Set the padding value as desired
    }
  },
  {
    selector: 'edge',
    style: {
      'width': 3,
      'line-color': '#ccc',
      'target-arrow-color': '#ccc',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier'
    }
  }
];

@Component({
  selector: 'app-gswb-graph-vis',
  templateUrl: './gswb-graph-vis.component.html',
  styleUrls: ['./gswb-graph-vis.component.css']
})
export class GswbGraphVisComponent {

  @ViewChild('graphContainer') graphContainer: ElementRef;
  @ViewChild('subgraphDialog') subgraphDialog: SubGraphDialogComponent;
  @Input() graphID!: string;
  private cy: Core;

  defaultWidth = '800px';
  defaultHeight = '600px';


  ngAfterViewInit(): void {

      this.cy = cytoscape({
        container: document.getElementById(this.graphID),
        style: styleArray as cytoscape.Stylesheet[],
        layout: {
          name: 'dagre'
        }
        // rest of your cytoscape config
      });
  }


  handleNodeDoubleClick(nodeId: string, nodeData: any): void {
    // Handle the double-click event for the specific node
    console.log("Clicked node with id: ", nodeId);

    setTimeout(() => {
      this.subgraphDialog.setContent(nodeData.graphElements);
    }, 0);

    setTimeout(() => {
      this.subgraphDialog.showDialog();
    }, 0);

    // Perform additional actions or logic based on the double-clicked node
  }



  renderGraph(graphData): void {
    this.cy = cytoscape({
      container: document.getElementById(this.graphID), // Use the appropriate container element ID
      elements: graphData,
      style: styleArray as cytoscape.Stylesheet[],
      layout: {
        name: 'dagre'
      }
      // Additional Cytoscape configuration options

    });

    this.createAndBindPoppers()

    this.cy.on('dblclick', 'node', (event) => {
      let node = event.target;
      let nodeId = node.id(); // Get the ID of the double-clicked node
      let nodeData = node.data(); // Get the data of the double-clicked node

      console.log(nodeData);
      // Check if the double-clicked node has a specific property value
      if (nodeData.hasOwnProperty('subgraph')) {
        this.handleNodeDoubleClick(nodeId, nodeData.subgraph);
      }
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

        if (attributes.hasOwnProperty("solutions")) {
          //iterate through array attributes.solutions
          for (var solution of attributes.solutions) {
            content.innerHTML = content.innerHTML + solution + "<br>";
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

      if (data.hasOwnProperty('solutions')) {
        //  console.log("Making popper for: ", data);
        this.makePopper(ele);
        //   console.log("Element with tippy: ",data);

        ele.bind('mouseover', (event) => event.target.tippy.show());
        ele.bind('mouseout', (event) => event.target.tippy.hide());
      }
    });
  }

  resizeToDefault(): void {
    const graphContainer = this.graphContainer.nativeElement;
    graphContainer.style.width = this.defaultWidth;
    graphContainer.style.height = this.defaultHeight;
  }

}
