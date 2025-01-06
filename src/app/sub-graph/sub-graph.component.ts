import {Component, Input} from '@angular/core';
import cytoscape, {Core} from "cytoscape";
import cise from "cytoscape-cise";
import dagre from "cytoscape-dagre";
import tippy from "tippy.js";

cytoscape.use(cise);
cytoscape.use(dagre);

const ligerStyle = [
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
      "background-gradient-stop-colors": "lightblue white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60"
    }
  },
  {
    selector: 'node[node_type="cnode"]',
    style: {
      'content': 'data(id)',
      'color': 'blue',
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
];

const gswbStyle = [
  {
    selector: 'node[color="yellow"]',
    style: {
      'shape': 'rectangle',
      'background-image': (ele) => {
        const svgString = ele.data('text'); // Retrieve the SVG string from data
        console.log(`Node ${ele.data('id')} background-image:`, `data:image/svg+xml,${encodeURIComponent(svgString)}`);
        return `data:image/svg+xml,${encodeURIComponent(svgString)}`;
      },
      'background-fit': 'contain contain',
      'background-clip': 'none',
      'background-opacity': 1,
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "yellow white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60", // Fallback color
      'width': (ele) => {
        const svgString = ele.data('text');
        if (!svgString) {
          console.warn(`Node ${ele.data('id')} has no SVG string.`);
          return 50; // Default width
        }

        const dummy = document.createElement('div');
        dummy.innerHTML = svgString.trim(); // Trim to remove any extra whitespace
        const svgElement = dummy.firstElementChild;

        if (!svgElement || svgElement.tagName !== 'svg') {
          console.warn(`Node ${ele.data('id')} has invalid SVG content.`);
          return 50; // Default width
        }

        const width = svgElement.getAttribute('width');
        return parseFloat(width) || 50; // Default width if not specified
      },
      'height': (ele) => {
        const svgString = ele.data('text');
        if (!svgString) {
          console.warn(`Node ${ele.data('id')} has no SVG string.`);
          return 50; // Default height
        }

        const dummy = document.createElement('div');
        dummy.innerHTML = svgString.trim();
        const svgElement = dummy.firstElementChild;

        if (!svgElement || svgElement.tagName !== 'svg') {
          console.warn(`Node ${ele.data('id')} has invalid SVG content.`);
          return 50; // Default height
        }

        const height = svgElement.getAttribute('height');
        return parseFloat(height) || 50; // Default height if not specified
      },
      'padding': '10px',
    }
    },
  {
    selector: 'node[color="red"]',
    style: {
      'shape': 'rectangle',
      'background-image': (ele) => {
        const svgString = ele.data('text'); // Retrieve the SVG string from data
        console.log(`Node ${ele.data('id')} background-image:`, `data:image/svg+xml,${encodeURIComponent(svgString)}`);
        return `data:image/svg+xml,${encodeURIComponent(svgString)}`;
      },
      'background-fit': 'contain contain',
      'background-clip': 'none',
      'background-opacity': 1,
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "red white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60",
      'width': (ele) => {
        const svgString = ele.data('text');
        if (!svgString) {
          console.warn(`Node ${ele.data('id')} has no SVG string.`);
          return 50; // Default width
        }

        const dummy = document.createElement('div');
        dummy.innerHTML = svgString.trim(); // Trim to remove any extra whitespace
        const svgElement = dummy.firstElementChild;

        if (!svgElement || svgElement.tagName !== 'svg') {
          console.warn(`Node ${ele.data('id')} has invalid SVG content.`);
          return 50; // Default width
        }

        const width = svgElement.getAttribute('width');
        return parseFloat(width) || 50; // Default width if not specified
      },
      'height': (ele) => {
        const svgString = ele.data('text');
        if (!svgString) {
          console.warn(`Node ${ele.data('id')} has no SVG string.`);
          return 50; // Default height
        }

        const dummy = document.createElement('div');
        dummy.innerHTML = svgString.trim();
        const svgElement = dummy.firstElementChild;

        if (!svgElement || svgElement.tagName !== 'svg') {
          console.warn(`Node ${ele.data('id')} has invalid SVG content.`);
          return 50; // Default height
        }

        const height = svgElement.getAttribute('height');
        return parseFloat(height) || 50; // Default height if not specified
      },

      'padding': '10px',
    }
  },
  {
    selector: 'node[color="blue"][type="category"]',
    style: {
      'shape': 'rectangle',
      'background-image': (ele) => {
        const svgString = ele.data('text'); // Retrieve the SVG string from data
        console.log(`Node ${ele.data('id')} background-image:`, `data:image/svg+xml,${encodeURIComponent(svgString)}`);
        return `data:image/svg+xml,${encodeURIComponent(svgString)}`;
      },
      'background-fit': 'contain contain',
      'background-clip': 'none',
      'background-opacity': 1,
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "lightblue white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60", // Fallback color
      'width': (ele) => {
        const svgString = ele.data('text');
        if (!svgString) {
          console.warn(`Node ${ele.data('id')} has no SVG string.`);
          return 50; // Default width
        }

        const dummy = document.createElement('div');
        dummy.innerHTML = svgString.trim(); // Trim to remove any extra whitespace
        const svgElement = dummy.firstElementChild;

        if (!svgElement || svgElement.tagName !== 'svg') {
          console.warn(`Node ${ele.data('id')} has invalid SVG content.`);
          return 50; // Default width
        }

        const width = svgElement.getAttribute('width');
        return parseFloat(width) || 50; // Default width if not specified
      },
      'height': (ele) => {
        const svgString = ele.data('text');
        if (!svgString) {
          console.warn(`Node ${ele.data('id')} has no SVG string.`);
          return 50; // Default height
        }

        const dummy = document.createElement('div');
        dummy.innerHTML = svgString.trim();
        const svgElement = dummy.firstElementChild;

        if (!svgElement || svgElement.tagName !== 'svg') {
          console.warn(`Node ${ele.data('id')} has invalid SVG content.`);
          return 50; // Default height
        }

        const height = svgElement.getAttribute('height');
        return parseFloat(height) || 50; // Default height if not specified
      },

      'padding': '10px'
    }
  },
  {
    selector: 'node[color="blue"][type="connector"]',
    style: {
      'shape': 'circle',
      'background-image': (ele) => {
        const svgString = ele.data('text'); // Retrieve the SVG string from data
        console.log(`Node ${ele.data('id')} background-image:`, `data:image/svg+xml,${encodeURIComponent(svgString)}`);
        return `data:image/svg+xml,${encodeURIComponent(svgString)}`;
      },
      'background-fit': 'contain contain',
      'background-clip': 'none',
      'background-opacity': 1,
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "lightblue white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60", // Fallback color
      'width': (ele) => {
        const svgString = ele.data('text');
        if (!svgString) {
          console.warn(`Node ${ele.data('id')} has no SVG string.`);
          return 50; // Default width
        }

        const dummy = document.createElement('div');
        dummy.innerHTML = svgString.trim(); // Trim to remove any extra whitespace
        const svgElement = dummy.firstElementChild;

        if (!svgElement || svgElement.tagName !== 'svg') {
          console.warn(`Node ${ele.data('id')} has invalid SVG content.`);
          return 50; // Default width
        }

        const width = svgElement.getAttribute('width');
        return parseFloat(width) || 50; // Default width if not specified
      },
      'height': (ele) => {
        const svgString = ele.data('text');
        if (!svgString) {
          console.warn(`Node ${ele.data('id')} has no SVG string.`);
          return 50; // Default height
        }

        const dummy = document.createElement('div');
        dummy.innerHTML = svgString.trim();
        const svgElement = dummy.firstElementChild;

        if (!svgElement || svgElement.tagName !== 'svg') {
          console.warn(`Node ${ele.data('id')} has invalid SVG content.`);
          return 50; // Default height
        }

        const height = svgElement.getAttribute('height');
        return parseFloat(height) || 50; // Default height if not specified
      },

      'padding': '10px'
    }
  },
  {
    selector: 'node[color="green"]',
    style: {
      'shape': 'rectangle',
      'background-image': (ele) => {
        const svgString = ele.data('text'); // Retrieve the SVG string from data
        console.log(`Node ${ele.data('id')} background-image:`, `data:image/svg+xml,${encodeURIComponent(svgString)}`);
        return `data:image/svg+xml,${encodeURIComponent(svgString)}`;
      },
      'background-fit': 'contain contain',
      'background-clip': 'none',
      'background-opacity': 1,
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "lightgreen white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60",
      'width': (ele) => {
        const svgString = ele.data('text');
        if (!svgString) {
          console.warn(`Node ${ele.data('id')} has no SVG string.`);
          return 50; // Default width
        }

        const dummy = document.createElement('div');
        dummy.innerHTML = svgString.trim(); // Trim to remove any extra whitespace
        const svgElement = dummy.firstElementChild;

        if (!svgElement || svgElement.tagName !== 'svg') {
          console.warn(`Node ${ele.data('id')} has invalid SVG content.`);
          return 50; // Default width
        }

        const width = svgElement.getAttribute('width');
        return parseFloat(width) || 50; // Default width if not specified
      },
      'height': (ele) => {
        const svgString = ele.data('text');
        if (!svgString) {
          console.warn(`Node ${ele.data('id')} has no SVG string.`);
          return 50; // Default height
        }

        const dummy = document.createElement('div');
        dummy.innerHTML = svgString.trim();
        const svgElement = dummy.firstElementChild;

        if (!svgElement || svgElement.tagName !== 'svg') {
          console.warn(`Node ${ele.data('id')} has invalid SVG content.`);
          return 50; // Default height
        }

        const height = svgElement.getAttribute('height');
        return parseFloat(height) || 50; // Default height if not specified
      },

      'padding': '10px'
    }
  },
  {
    selector: 'node[color="orange"]',
    style: {
      'shape': 'rectangle',
      'background-image': (ele) => {
        const svgString = ele.data('text'); // Retrieve the SVG string from data
        console.log(`Node ${ele.data('id')} background-image:`, `data:image/svg+xml,${encodeURIComponent(svgString)}`);
        return `data:image/svg+xml,${encodeURIComponent(svgString)}`;
      },
      'background-fit': 'contain contain',
      'background-clip': 'none',
      'background-opacity': 1,
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "orange white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60",
      'width': (ele) => {
        const svgString = ele.data('text');
        if (!svgString) {
          console.warn(`Node ${ele.data('id')} has no SVG string.`);
          return 50; // Default width
        }

        const dummy = document.createElement('div');
        dummy.innerHTML = svgString.trim(); // Trim to remove any extra whitespace
        const svgElement = dummy.firstElementChild;

        if (!svgElement || svgElement.tagName !== 'svg') {
          console.warn(`Node ${ele.data('id')} has invalid SVG content.`);
          return 50; // Default width
        }

        const width = svgElement.getAttribute('width');
        return parseFloat(width) || 50; // Default width if not specified
      },
      'height': (ele) => {
        const svgString = ele.data('text');
        if (!svgString) {
          console.warn(`Node ${ele.data('id')} has no SVG string.`);
          return 50; // Default height
        }

        const dummy = document.createElement('div');
        dummy.innerHTML = svgString.trim();
        const svgElement = dummy.firstElementChild;

        if (!svgElement || svgElement.tagName !== 'svg') {
          console.warn(`Node ${ele.data('id')} has invalid SVG content.`);
          return 50; // Default height
        }

        const height = svgElement.getAttribute('height');
        return parseFloat(height) || 50; // Default height if not specified
      },

      'padding': '10px'
    }
  },
  {
    selector: 'edge[edge_type="default"]',
    style: {
      'width': 3,
      'line-color': '#ccc',
      'target-arrow-color': '#ccc',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier'
    }
  },
  {
    selector: 'edge[edge_type="external"]',
    style: {
      'width': 3,
      'line-color': '#ccc',
      'target-arrow-color': '#ccc',
      'line-style': 'dashed',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier'
    }
  },
  {
    selector: 'edge[edge_type="parent"]',
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
  selector: 'app-sub-graph',
  templateUrl: './sub-graph.component.html',
  styleUrls: ['./sub-graph.component.css']
})
export class SubGraphComponent {
  @Input() graphStyle!: string;
  @Input() graphID!: string;
  private cy: Core;
  private styleArray;
  private layout;

    ngAfterViewInit(): void {
      if (this.graphStyle == 'liger')
      {
        this.styleArray = ligerStyle;
        this.layout = 'dagre'
      } else if (this.graphStyle == 'glue')
      {
        this.styleArray = gswbStyle;
        this.layout = 'cise'
      }




    this.cy = cytoscape({
      container: document.getElementById(this.graphID),
      style: this.styleArray as cytoscape.Stylesheet[],
      layout: {
        name: this.layout // Adjust alignment as needed
      }
    });
  }


  renderGraph(graphData): void {
    this.cy = cytoscape({
        container: document.getElementById(this.graphID), // Use the appropriate container element ID
        elements: graphData,
        style: this.styleArray as cytoscape.Stylesheet[],
        layout: {
          name: this.layout
        }
      }
    );
    console.log("Container of the subgraph: ",this.cy.container().id);
    console.log("Cy element with data:", this.cy)

    if (this.graphStyle == 'liger'){
      this.createAndBindLigerPoppers()
    } else if (this.graphStyle == 'glue'){
      this.createAndBindGswbPoppers()
    }

  }

  makeLigerPopper(ele: any): void {
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

  createAndBindLigerPoppers(): void {
    this.cy.nodes().forEach((ele) => {

      const data = ele.data();

      if (data.hasOwnProperty('avp')) {
        //  console.log("Making popper for: ", data);
        this.makeLigerPopper(ele);
        //   console.log("Element with tippy: ",data);

        ele.bind('mouseover', (event) => event.target.tippy.show());
        ele.bind('mouseout', (event) => event.target.tippy.hide());
      }
    });
  }


  makeGswbPopper(ele: any): void {
    //   console.log("Element: ",ele);
    //   console.log("popper: ",ele.popperRef());
    const ref = ele.popperRef()
    //   console.log("Ref value:",ref)
    ele.tippy = tippy(ref, { // tippy options:
      content: () => {
        let content = document.createElement('div');
        content.style.backgroundColor = 'black';
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

  createAndBindGswbPoppers(): void {
    this.cy.nodes().forEach((ele) => {

      const data = ele.data();

      if (data.hasOwnProperty('solutions')) {
        //  console.log("Making popper for: ", data);
        this.makeGswbPopper(ele);
        //   console.log("Element with tippy: ",data);

        ele.bind('mouseover', (event) => event.target.tippy.show());
        ele.bind('mouseout', (event) => event.target.tippy.hide());
      }
    });
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
