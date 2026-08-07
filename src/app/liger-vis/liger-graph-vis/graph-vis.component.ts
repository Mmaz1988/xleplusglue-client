import {ChangeDetectorRef, Component, Input, OnInit, ViewChild, ElementRef} from '@angular/core';
import cytoscape, {Core} from 'cytoscape';
import dagre from 'cytoscape-dagre';
import popper from 'cytoscape-popper';
import tippy from 'tippy.js';
import {SubGraphDialogComponent} from "../../sub-graph-dialog/sub-graph-dialog.component";

type StructureType = 'c' | 'f' | 'd' | 'g' | 'annotation';

cytoscape.use(dagre);
cytoscape.use(popper);



const style = [
  {
    selector: 'node[node_type="input"]',
    style: {
      'content': 'data(label)',
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
      'content': 'data(label)',
      'color': 'blue',
      'text-valign': 'center',
      'text-halign': 'center',
      'height': '60px',
      'width': '60px',
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "lightgreen white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60"
    }
  }
  ,
  {
    selector: 'node[node_type="gnode"]',
    style: {
      'content': 'data(label)',
      'color': 'blue',
      'text-valign': 'center',
      'text-halign': 'center',
      'height': '60px',
      'width': '60px',
      "background-fill": "linear-gradient",
      "background-gradient-stop-colors": "orange white", // get data from data.color in each node
      "background-gradient-stop-positions": "0 30 60"
    }
  },
  {
    selector: 'node[node_type="annotation"]',
    style: {
      'content': 'data(label)',
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
    selector: 'node[node_type="root"]',
    style: {
      'content': 'data(label)',
      'color': 'white',
      'text-valign': 'center',
      'text-halign': 'center',
      'height': '60px',
      'width': '60px',
      'background-fill': 'linear-gradient',
      'background-gradient-stop-colors': '#4b0082 white',
      'background-gradient-stop-positions': '0 30 60'
    }
  },
  {
    selector: 'node[node_type="state"]',
    style: {
      'content': 'data(label)',
      'color': 'white',
      'text-valign': 'center',
      'text-halign': 'center',
      'height': '60px',
      'width': '60px',
      'background-fill': 'linear-gradient',
      'background-gradient-stop-colors': '#7b2cbf white',
      'background-gradient-stop-positions': '0 30 60'
    }
  },
  {
    selector: 'node[node_type="referent"]',
    style: {
      'content': 'data(label)',
      'color': 'white',
      'text-valign': 'center',
      'text-halign': 'center',
      'height': '60px',
      'width': '60px',
      'background-fill': 'linear-gradient',
      'background-gradient-stop-colors': '#0b3d91 white',
      'background-gradient-stop-positions': '0 30 60'
    }
  },
  {
    selector: 'node[node_type="value"]',
    style: {
      'content': 'data(label)',
      'color': 'white',
      'text-valign': 'center',
      'text-halign': 'center',
      'height': '60px',
      'width': '60px',
      'background-fill': 'linear-gradient',
      'background-gradient-stop-colors': '#455a64 white',
      'background-gradient-stop-positions': '0 30 60'
    }
  },
  {
    selector: 'node[node_type="condition"]',
    style: {
      'content': 'data(label)',
      'color': 'white',
      'text-valign': 'center',
      'text-halign': 'center',
      'height': '60px',
      'width': '60px',
      'background-fill': 'linear-gradient',
      'background-gradient-stop-colors': '#2e7d32 white',
      'background-gradient-stop-positions': '0 30 60'
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
  },
  {
    selector: 'node[query_selector="query-match"]',
    style: {
      'border-width': 5,
      'border-color': '#ff8f00',
      'background-color': '#fff3e0'
    }
  },
  {
    selector: 'edge[query_selector="query-match"]',
    style: {
      'width': 5,
      'line-color': '#ff8f00',
      'target-arrow-color': '#ff8f00'
    }
  }
];

@Component({
  selector: 'app-graph-vis',
  templateUrl: './graph-vis.component.html',
  styleUrls: ['./graph-vis.component.css']
})
export class GraphVisComponent implements OnInit {

  constructor(private changeDetector: ChangeDetectorRef) {}

  @ViewChild('graphContainer') graphContainer: ElementRef;
  @ViewChild('subgraphDialog') subgraphDialog: SubGraphDialogComponent;

  @Input() graphID!: string;
  @Input() graphStyle: 'liger' = 'liger';
  readonly structureFilters: Array<{ key: StructureType; label: string }> = [
    { key: 'c', label: 'Show c-structure' },
    { key: 'f', label: 'Show f-structure' },
    { key: 'd', label: 'Show d-structure' },
    { key: 'g', label: 'Show g-structure' },
    { key: 'annotation', label: 'Show annotations' },
  ];
  private structureVisibility: Record<StructureType, boolean> = {
    c: true,
    f: true,
    d: true,
    g: true,
    annotation: true,
  };
  availableStructureFilters: Array<{ key: StructureType; label: string }> = [];
  private cy: Core;
  private nodesHidden: boolean = false;
  private selector = 'node[node_type="cnode"]';
  private readonly typeCompactionRankTolerance = 28;
  private readonly typeCompactionPullStrength = 0.28;
  private readonly typeCompactionMaxShift = 90;
  private lastNodePositions = new Map<string, { x: number; y: number }>();
  private lastGraphData: any[] = [];

  defaultWidth = '800px';
  defaultHeight = '600px';

  ngOnInit(): void {
    // The host element is not available until after view initialization.
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

  renderGraph(graphData, preserveLayout = false): void {
    const container = document.getElementById(this.graphID || 'cy');
    if (!container) {
      return;
    }
    this.lastGraphData = this.cloneGraphElements(graphData ?? []);
    this.updateAvailableStructureFilters(this.lastGraphData);
    const canPreserveLayout = preserveLayout && this.lastNodePositions.size > 0;

    if (this.cy) {
      if (canPreserveLayout) {
        this.captureCurrentPositions();
      } else {
        this.lastNodePositions.clear();
      }
      this.cy.destroy();
    }

    const normalizedElements = this.normalizeGraphElements(this.visibleGraphElements(this.lastGraphData));
    const elements = this.applyPresetPositions(normalizedElements, canPreserveLayout);

    this.cy = cytoscape({
        container,
        elements: elements,
        style: style as cytoscape.Stylesheet[]
      }
    );

    if (canPreserveLayout) {
      this.createAndBindPoppers();
      this.cy.fit(undefined, 24);
    } else {
      const layoutOptions: any = {
        name: 'dagre',
        rankDir: 'TB',
        rankSep: 70,
        nodeSep: 40,
        edgeSep: 12,
        ranker: 'network-simplex'
      };

      const layout = this.cy.layout(layoutOptions);

      layout.on('layoutstop', () => {
        this.compactByNodeType();
        this.createAndBindPoppers();
        this.cy.fit(undefined, 24);
        this.captureCurrentPositions();
      });

      layout.run();
    }
    console.log("Container of the subgraph: ",this.cy.container().id);
    console.log("Cy element with data:", this.cy)
  }

  updateGraph(graphData: any[]): void {
    this.lastGraphData = this.cloneGraphElements(graphData ?? []);
    this.updateAvailableStructureFilters(this.lastGraphData);
    if (!this.cy) {
      this.renderGraph(this.lastGraphData);
      return;
    }

    const normalizedGraphData = this.normalizeGraphElements(this.visibleGraphElements(this.lastGraphData));

    console.debug('[GraphVis] updateGraph', {
      incomingCount: Array.isArray(normalizedGraphData) ? normalizedGraphData.length : 0,
      sampleIds: normalizedGraphData.slice(0, 12).map((element) => element?.data?.id),
    });

    const currentIds = new Set<string>();
    this.cy.nodes().forEach((node) => {
      currentIds.add(String(node.id()));
    });
    this.cy.edges().forEach((edge) => {
      currentIds.add(String(edge.id()));
    });

    const nextIds = new Set<string>();
    for (const element of normalizedGraphData) {
      const id = element?.data?.id;
      if (id) {
        nextIds.add(String(id));
      }
    }

    const sameShape = currentIds.size === nextIds.size && [...currentIds].every(id => nextIds.has(id));
    if (!sameShape) {
      this.renderGraph(normalizedGraphData);
      return;
    }

    this.cy.batch(() => {
      for (const element of normalizedGraphData) {
        const data = element?.data;
        if (!data?.id) {
          continue;
        }

        const existing: any = this.cy.getElementById(String(data.id)) as any;
        if (!existing || (typeof existing.empty === 'function' && existing.empty())) {
          continue;
        }

        if (existing.isNode()) {
          if (data.query_selector === undefined) {
            existing.removeData('query_selector');
          }
          existing.data({ ...existing.data(), ...data });
        } else {
          if (data.query_selector === undefined) {
            existing.removeData('query_selector');
          }
          existing.data({ ...existing.data(), ...data });
        }

        if (element?.classes !== undefined) {
          existing.classes(String(element.classes).split(/\s+/).filter(Boolean));
        }

        if (element?.position && existing.isNode()) {
          existing.position({ ...element.position });
        }
      }
    });

    this.cy.style().update();
    this.createAndBindPoppers();
  }

  private normalizeGraphElements(graphData: any[]): any[] {
    const elements = (graphData ?? []).map((element) => ({
      ...element,
      data: element?.data ? { ...element.data } : element?.data,
      position: element?.position ? { ...element.position } : element?.position,
    }));

    const seenIds = new Map<string, number>();

    return elements.map((element, index) => {
      if (!element.data) {
        element.data = {};
      }

      const currentId = element.data.id !== undefined && element.data.id !== null
        ? String(element.data.id).trim()
        : '';
      const baseId = currentId || this.buildFallbackElementId(element, index);
      const seenCount = seenIds.get(baseId) ?? 0;
      seenIds.set(baseId, seenCount + 1);

      element.data.id = seenCount === 0 ? baseId : `${baseId}__${seenCount + 1}`;
      return element;
    });
  }

  private buildFallbackElementId(element: any, index: number): string {
    const data = element?.data ?? {};

    if (data.source !== undefined || data.target !== undefined) {
      const source = String(data.source ?? 'source');
      const relation = String(data.label ?? data.relationLabel ?? data.edge_type ?? 'edge');
      const target = String(data.target ?? 'target');
      return `edge:${source}:${relation}:${target}:${index}`;
    }

    const label = String(data.label ?? data.node_type ?? 'node');
    return `node:${label}:${index}`;
  }

  private captureCurrentPositions(): void {
    if (!this.cy) {
      return;
    }

    this.cy.nodes().forEach((node) => {
      const position = node.position();
      this.lastNodePositions.set(String(node.id()), { x: position.x, y: position.y });
    });
  }

  private applyPresetPositions(graphData: any[], preserveLayout: boolean): any[] {
    if (!preserveLayout || !this.lastNodePositions.size) {
      return graphData;
    }

    const elements = graphData.map((element) => ({
      ...element,
      data: element?.data ? { ...element.data } : element?.data,
      position: element?.position ? { ...element.position } : element?.position,
    }));

    const incomingById = new Map<string, any>();
    const adjacency = new Map<string, string[]>();

    for (const element of elements) {
      const data = element?.data;
      if (!data) continue;

      if (data.source && data.target) {
        const source = String(data.source);
        const target = String(data.target);
        if (!adjacency.has(source)) adjacency.set(source, []);
        if (!adjacency.has(target)) adjacency.set(target, []);
        adjacency.get(source)!.push(target);
        adjacency.get(target)!.push(source);
      } else if (data.id) {
        incomingById.set(String(data.id), element);
      }
    }

    let fallbackIndex = 0;
    const fallbackPosition = () => ({ x: 120 + (fallbackIndex++ % 6) * 70, y: 120 + Math.floor(fallbackIndex / 6) * 70 });

    for (const [id, element] of incomingById.entries()) {
      const previous = this.lastNodePositions.get(id);
      if (previous) {
        element.position = { ...previous };
        continue;
      }

      const neighbors = adjacency.get(id) ?? [];
      const anchoredNeighbor = neighbors.find((neighbor) => this.lastNodePositions.has(neighbor));
      if (anchoredNeighbor) {
        const base = this.lastNodePositions.get(anchoredNeighbor)!;
        const offset = (neighbors.indexOf(anchoredNeighbor) + 1) * 18;
        element.position = { x: base.x + offset, y: base.y + offset };
      } else {
        element.position = fallbackPosition();
      }
    }

    return elements;
  }

  resizeToDefault(): void {
    const graphContainer = this.graphContainer.nativeElement;
    graphContainer.style.width = this.defaultWidth;
    graphContainer.style.height = this.defaultHeight;
  }

  isStructureVisible(type: StructureType): boolean {
    return this.structureVisibility[type];
  }

  setStructureVisibility(type: StructureType, visible: boolean): void {
    this.structureVisibility[type] = visible;
    // Re-run Dagre after filtering so the remaining graph gets a fresh layout.
    this.renderGraph(this.lastGraphData);
  }

  showDialog(){

      this.subgraphDialog.subgraphStyle = this.graphStyle
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

  private visibleGraphElements(elements: any[]): any[] {
    const hiddenNodeIds = new Set(
      elements
        .filter(element => !element?.data?.source && !element?.data?.target)
        .filter(element => {
          const type = this.structureType(element);
          return type !== null && !this.isStructureVisible(type);
        })
        .map(element => String(element.data.id))
    );

    return elements.filter(element => {
      const data = element?.data;
      if (!data) {
        return false;
      }

      if (data.source !== undefined || data.target !== undefined) {
        return !hiddenNodeIds.has(String(data.source)) && !hiddenNodeIds.has(String(data.target));
      }

      return !hiddenNodeIds.has(String(data.id));
    });
  }

  private structureType(element: any): StructureType | null {
    const data = element?.data ?? {};
    const rawType = String(data.node_type ?? data.structure_type ?? data.structure ?? '').toLowerCase();
    const normalizedType = rawType.replace(/[_\s]/g, '-');

    if (normalizedType === 'c' || normalizedType === 'cnode' || normalizedType === 'c-structure') return 'c';
    if (normalizedType === 'f' || normalizedType === 'fnode' || normalizedType === 'f-structure' || normalizedType === 'input') return 'f';
    if (normalizedType === 'd' || normalizedType === 'dnode' || normalizedType === 'd-structure'
      || normalizedType === 'drt' || ['root', 'state', 'referent', 'value', 'condition'].includes(normalizedType)) return 'd';
    if (normalizedType === 'g' || normalizedType === 'gnode' || normalizedType === 'g-structure' || normalizedType === 'glue') return 'g';
    if (normalizedType === 'annotation' || normalizedType === 'anode') return 'annotation';

    return null;
  }

  private updateAvailableStructureFilters(elements: any[]): void {
    const presentTypes = new Set<StructureType>();

    elements
      .filter(element => !element?.data?.source && !element?.data?.target)
      .forEach(element => {
        const type = this.structureType(element);
        if (type) {
          presentTypes.add(type);
        }
      });

    this.availableStructureFilters = this.structureFilters.filter(structure => presentTypes.has(structure.key));
    setTimeout(() => this.changeDetector.detectChanges());
  }

  private cloneGraphElements(elements: any[]): any[] {
    return elements.map(element => ({
      ...element,
      data: element?.data ? { ...element.data } : element?.data,
      position: element?.position ? { ...element.position } : element?.position,
    }));
  }

  private compactByNodeType(): void {
    if (!this.cy) {
      return;
    }

    const nodes = this.cy.nodes().filter((node) => !!node.data('node_type')).toArray() as cytoscape.NodeSingular[];
    if (nodes.length === 0) {
      return;
    }

    const orderedNodes = nodes.sort((a, b) => {
      const yDiff = a.position('y') - b.position('y');
      if (Math.abs(yDiff) > this.typeCompactionRankTolerance) {
        return yDiff;
      }

      return a.position('x') - b.position('x');
    });

    const ranks: cytoscape.NodeSingular[][] = [];
    let currentRank: cytoscape.NodeSingular[] = [];
    let currentRankY = orderedNodes[0].position('y');

    orderedNodes.forEach((node) => {
      if (currentRank.length && Math.abs(node.position('y') - currentRankY) > this.typeCompactionRankTolerance) {
        ranks.push(currentRank);
        currentRank = [node];
        currentRankY = node.position('y');
        return;
      }

      currentRank.push(node);
      currentRankY = (currentRankY * (currentRank.length - 1) + node.position('y')) / currentRank.length;
    });

    if (currentRank.length) {
      ranks.push(currentRank);
    }

    this.cy.batch(() => {
      ranks.forEach((rank) => {
        const typeMap = new Map<string, cytoscape.NodeSingular[]>();

        rank.forEach((node) => {
          const nodeType = String(node.data('node_type') ?? '');
          if (!typeMap.has(nodeType)) {
            typeMap.set(nodeType, []);
          }
          typeMap.get(nodeType)!.push(node);
        });

        typeMap.forEach((members) => {
          if (members.length < 2) {
            return;
          }

          const sortedMembers = members.sort((a, b) => a.position('x') - b.position('x'));
          const targetX = sortedMembers.reduce((sum, node) => sum + node.position('x'), 0) / sortedMembers.length;

          sortedMembers.forEach((node, index) => {
            const currentX = node.position('x');
            const offset = targetX - currentX;
            const maxShift = Math.max(this.typeCompactionMaxShift - index * 8, 24);
            const shift = Math.max(-maxShift, Math.min(maxShift, offset * this.typeCompactionPullStrength));

            node.position({
              x: currentX + shift,
              y: node.position('y'),
            });
          });
        });
      });
    });
  }

}
