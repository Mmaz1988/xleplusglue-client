import {Component, ElementRef, Input, ViewChild} from '@angular/core';
import dagre from 'cytoscape-dagre';
import popper from 'cytoscape-popper';
import tippy from 'tippy.js';
import {SubGraphDialogComponent} from "../../sub-graph-dialog/sub-graph-dialog.component";
import cytoscape, {Core} from "cytoscape";
import { LigerBatchParsingAnalysis, LigerRule, LigerRuleAnnotation, LigerWebGraph, LigerGraphComponent } from '../../models/models';



cytoscape.use(dagre);
cytoscape.use(popper);




@Component({
  selector: 'app-applied-rules-graph',
  templateUrl: './applied-rules-graph.component.html',
  styleUrls: ['./applied-rules-graph.component.css']
})
export class AppliedRulesGraphComponent {

  style = [
    {
      selector: 'node[node_type="rule"]',
      style: {
        'content': 'data(id)',
        'color': 'blue',
        'text-valign': 'center',
        'text-halign': 'center',
        'height': '60px',
        'width': '60px',
        "background-fill": "linear-gradient",
        'background-gradient-stop-colors': "yellow red",
        'background-gradient-stop-positions': "0 30 60"
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
    }
  ];


  @ViewChild('graphContainer') graphContainer: ElementRef;
  @ViewChild('subgraphDialog') subgraphDialog: SubGraphDialogComponent;

  @Input() graphID!: string;
  private cy: Core;

  defaultWidth = '800px';
  defaultHeight = '600px';

  ngOnInit(): void {

    this.cy = cytoscape({
      container: document.getElementById('cy'),
      style: this.style as cytoscape.Stylesheet[],
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
       //  console.log("Attributes: ",  attributes);

        if (attributes.hasOwnProperty("rule")) {
          content.innerHTML = content.innerHTML + "Rule " + attributes.id + ": " + attributes.rule + "at line: " + attributes.line + "<br>";
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

      if (data.hasOwnProperty('rule')) {
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
         style: this.calculateStyle(graphData),
        layout: {
          name: 'dagre'
        }
      }
    );

    this.createAndBindPoppers();

    console.log("Container of the subgraph: ",this.cy.container().id);
    console.log("Cy element with data:", this.cy)
  }

  calculateStyle(graphData: LigerGraphComponent[]): any[] {

    //sort graphData by "id"

    let nodes = graphData.filter((element) => element.data.hasOwnProperty("rule"));

    //sort graphdata according to .data.id
    nodes.sort((a, b) => (a.data['id'] > b.data['id']) ? 1 : -1)

    console.log("Sorted nodes: ", nodes);

    //divide number of elements in graphData by 10 and return corresponding int
    const nodeBucket = Math.floor(nodes.length / 10);
    console.log("NodeBucket: ", nodeBucket)



    /*
    {
      selector: 'node[node_type="rule"]',
      style: {
        'content': 'data(id)',
        'color': 'blue',
        'text-valign': 'center',
        'text-halign': 'center',
        'height': '60px',
        'width': '60px',
        "background-fill": "linear-gradient",
        'background-gradient-stop-colors': "yellow red",
        'background-gradient-stop-positions': "0 30 60"
      }
    },
     */

    let styleIndex = 0;
    //create array styles
    let styles = [];

    for (let i = 0; i < nodes.length; i++) {

      //increase styleIndex by 1 everytime i is dividable by nodeBucket without remainder
      if (i % nodeBucket == 0) {
        styleIndex++;
      }
      let currentStyle = "style" + styleIndex;

      //add style to graphData[i]
      nodes[i].data['node_style'] = currentStyle;

      //if styles does not contain currentStyle add it
      if (!styles.includes(currentStyle)) {
        styles.push(currentStyle);
      }
    }

    console.log("Styles: ", styles);

    let cytoStyles = [];

    let colors = this.calculateColorStops("#FFFF00","#FF0000", styles.length);

    for (let i = 0; i < styles.length; i++) {

      //increase styleIndex by 1 everytime i is dividable by nodeBucket without remainder

      //get element at i of styles
      let currentStyle = styles[i];

      let color = colors[i] + " white";
      //calculate percentage i takes f rom styles.length
      //let percentage =  Math.floor((i / styles.length) * 60);
      //let stoppositions =  "0 " + (80 - percentage) + " 100";

      let currentCytoStyle =     {
        selector: 'node[node_style="' + currentStyle + '"]',
        style: {
          'content': 'data(id)',
          'color': 'blue',
          'text-valign': 'center',
          'text-halign': 'center',
          'height': '60px',
          'width': '60px',
          "background-fill": "linear-gradient",
          'background-gradient-stop-colors': color,
          'background-gradient-stop-positions': "100 100"
        }
      }

      console.log("Current cyto style: ", currentCytoStyle)

      cytoStyles.push(currentCytoStyle);

    }

    return cytoStyles;

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

  calculateColorStops(startColor: string, endColor: string, steps: number): string[] {
    let gradientColors = [];

    for (let i = 0; i < steps; i++) {
      const position = i / (steps - 1); // position will be between 0 and 1
      const color = this.calculateColor(startColor, endColor, position);
      gradientColors.push(color);
    }

    return gradientColors;
  }

  calculateColor(startColor: string, endColor: string, position: number): string {
    const r = Math.round(this.interpolate(startColor.slice(1, 3), endColor.slice(1, 3), position));
    const g = Math.round(this.interpolate(startColor.slice(3, 5), endColor.slice(3, 5), position));
    const b = Math.round(this.interpolate(startColor.slice(5, 7), endColor.slice(5, 7), position));

    return `#${this.componentToHex(r)}${this.componentToHex(g)}${this.componentToHex(b)}`;
  }

  interpolate(start: string, end: string, position: number): number {
    return (1 - position) * parseInt(start, 16) + position * parseInt(end, 16);
  }

  componentToHex(c: number): string {
    const hex = c.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }

}
