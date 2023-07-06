import {Component, Input, OnChanges, AfterViewInit} from '@angular/core';
import cytoscape, {Core} from 'cytoscape';
import dagre from 'cytoscape-dagre';

cytoscape.use(dagre);

@Component({
  selector: 'app-gswb-graph-vis',
  templateUrl: './gswb-graph-vis.component.html',
  styleUrls: ['./gswb-graph-vis.component.css']
})
export class GswbGraphVisComponent {

  private cy: Core;

  ngAfterViewInit(): void {

      this.cy = cytoscape({
        container: document.getElementById('gswb-cy'),
        style: [
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
        ] as cytoscape.Stylesheet[],
        layout: {
          name: 'dagre'
        }
        // rest of your cytoscape config
      });

    }


  renderGraph(graphData): void {

    if (!this.cy) {
      return;
    }
    console.log(graphData)
    this.cy.elements().remove();
    this.cy.add(graphData); // Use the updated graph data here
    this.cy.layout({ name: 'dagre' }).run(); // reapply the layout

    // Perform any additional customizations or configurations for the graph
  }

}
