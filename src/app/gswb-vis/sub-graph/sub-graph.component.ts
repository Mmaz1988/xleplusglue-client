import {Component, Input} from '@angular/core';
import cytoscape, {Core} from "cytoscape";
import cise from "cytoscape-cise";

cytoscape.use(cise);

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
]

@Component({
  selector: 'app-sub-graph',
  templateUrl: './sub-graph.component.html',
  styleUrls: ['./sub-graph.component.css']
})
export class SubGraphComponent {
  @Input() graphID!: string;
  private cy: Core;

    ngAfterViewInit(): void {

    this.cy = cytoscape({
      container: document.getElementById(this.graphID),
      style: styleArray as cytoscape.Stylesheet[],
      layout: {
        name: 'cise' // Adjust alignment as needed
      }
    });

    this.cy.on('layoutstop', (event) => {
      if (event.layout.options.name === 'cise') {
        // Check if any errors occurred during the layout
        if (event.layout.failed) {
          console.log('Error applying layout!');
        } else {
          console.log('Layout applied successfully!');
        }
      }
    });

  }


  renderGraph(graphData): void {
    this.cy = cytoscape({
        container: document.getElementById(this.graphID), // Use the appropriate container element ID
        elements: graphData,
        style: styleArray as cytoscape.Stylesheet[],
        layout: {
          name: 'cise'
        }
      }
    );
    console.log("Container of the subgraph: ",this.cy.container().id);
    console.log("Cy element with data:", this.cy)
  }

/*
  renderGraph(graphData): void {

    if (!this.cy) {
      return;
    }
    console.log("Container of the subgraph: ",this.cy.container().id)
    console.log(graphData)
    try {
      this.cy.elements().remove();
    } catch (e)
    {
      console.log("Error while removing data...")
    }

    try {
      this.cy.add(graphData); // Use the updated graph data here
    } catch(e)
    {
      console.log("Error while adding data!")
    }
    console.log("Cy element with data:", this.cy)
    try {
      this.cy.layout({name: 'cola'}).run(); // reapply the layout
    } catch (e)
    {
      console.log("Error applying layout!")
    }

    // Perform any additional customizations or configurations for the graph
  }

 */
}
