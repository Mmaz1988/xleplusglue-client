import {Component, Input, OnChanges, OnInit} from '@angular/core';
import cytoscape, {Core} from 'cytoscape';
import dagre from 'cytoscape-dagre';
import popper from 'cytoscape-popper';
import tippy from 'tippy.js';

cytoscape.use(dagre);
cytoscape.use(popper);


@Component({
  selector: 'app-graph-vis',
  templateUrl: './graph-vis.component.html',
  styleUrls: ['./graph-vis.component.css']
})
export class GraphVisComponent implements OnInit {

   private cy: Core;

    ngOnInit(): void {

    this.cy = cytoscape({
      container: document.getElementById('cy'),
      style: [
        {
          selector: 'node[node_type="input"]',
          style: {
            'content': 'data(id)',
            'color': 'blue',
            'text-valign': 'center',
            'text-halign': 'center',
            'height': '60px',
            'width': '60px',
            "background-fill": "linear-gradient",
            "background-gradient-stop-colors": "#00FFFF white", // get data from data.color in each node
            "background-gradient-stop-positions": "0 30 60"
          }
        },
        {
          selector: 'node[node_type="annotation"]',
          style: {
            'content': 'data(id)',
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
      ] as cytoscape.Stylesheet[],
      layout: {
        name: 'dagre'
      }
      // rest of your cytoscape config
    });

  }

  makePopper(ele: any): void {
    console.log("Element: ",ele);
    console.log("popper: ",ele.popperRef());
    const ref = ele.popperRef()
    console.log("Ref value:",ref)
    ele.tippy = tippy(ref, { // tippy options:
      content: () => {
        let content = document.createElement('div');

        var attributes = ele._private.data;
        console.log(attributes);

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
    console.log("Tippy: ",ele.tippy);
  }

  createAndBindPoppers(): void {
    this.cy.nodes().forEach((ele) => {

      const data = ele.data();

      if (data.hasOwnProperty('avp')) {
        console.log("Making popper for: ", data);
        this.makePopper(ele);
         console.log("Element with tippy: ",data);

        ele.bind('mouseover', (event) => event.target.tippy.show());
        ele.bind('mouseout', (event) => event.target.tippy.hide());
      }
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
      this.createAndBindPoppers();

    // Perform any additional customizations or configurations for the graph
  }
}



