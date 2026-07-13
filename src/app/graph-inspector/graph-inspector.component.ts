import { Component, ElementRef, ViewChild } from '@angular/core';
import { DataService } from '../data.service';
import { GraphVisComponent } from '../liger-vis/liger-graph-vis/graph-vis.component';
import { LigerQuerySolution, LigerStructureQueryRequest, LigerStructureUploadRequest } from '../models/models';

@Component({
  selector: 'app-graph-inspector',
  templateUrl: './graph-inspector.component.html',
  styleUrls: ['./graph-inspector.component.css']
})
export class GraphInspectorComponent {
  constructor(private dataService: DataService) {}

  uploadedContent = '';
  uploadedFormat: 'json' | 'prolog' = 'json';
  uploadedFileName = 'uploaded-graph';
  queryText = '';
  queryResult = '';
  loading = false;
  queryLoading = false;
  private baseGraphElements: any[] = [];
  graphElements: any[] = [];
  querySolutions: LigerQuerySolution[] = [];
  activeSolutionIndex: number | null = null;

  @ViewChild('cy1') cy1: GraphVisComponent;
  @ViewChild('errorhandle') errorhandle: ElementRef;

  onUploadFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length > 0 ? input.files[0] : null;

    if (!file) {
      return;
    }

    this.uploadedFileName = file.name;
    this.uploadedFormat = file.name.endsWith('.pl') || file.name.endsWith('.prolog') ? 'prolog' : 'json';

    const reader = new FileReader();
    reader.onload = () => {
      this.uploadedContent = String(reader.result ?? '');
      this.displayMessage(`Loaded ${file.name}`, 'green');
      this.renderUploadedGraph();
    };
    reader.onerror = () => {
      this.displayMessage(`Could not read ${file.name}`, 'red');
    };
    reader.readAsText(file);
  }

  renderUploadedGraph() {
    if (!this.uploadedContent.trim()) {
      return;
    }

    this.loading = true;
    this.querySolutions = [];
    this.activeSolutionIndex = null;
    const uploadRequest: LigerStructureUploadRequest = {
      content: this.uploadedContent,
      format: this.uploadedFormat,
      id: this.uploadedFileName,
    };

    this.dataService.ligerUploadStructure(uploadRequest).subscribe(
      data => {
        this.loading = false;
        if (data?.graph?.graphElements?.length) {
          this.baseGraphElements = data.graph.graphElements;
          this.graphElements = this.cloneGraphElements(this.baseGraphElements);
          this.cy1.renderGraph(this.graphElements);
          this.displayMessage('Graph loaded.', 'green');
        } else {
          this.displayMessage('No graph elements returned.', 'red');
        }
      },
      error => {
        this.loading = false;
        console.error('Upload failed:', error);
        this.displayMessage('Failed to load graph.', 'red');
      }
    );
  }

  runQuery() {
    if (!this.uploadedContent.trim()) {
      this.displayMessage('Upload a graph first.', 'red');
      return;
    }

    if (!this.queryText.trim()) {
      this.displayMessage('Enter a query first.', 'red');
      return;
    }

    this.queryLoading = true;
    this.displayMessage('Running query...', 'blue');
    const queryRequest: LigerStructureQueryRequest = {
      content: this.uploadedContent,
      format: this.uploadedFormat,
      id: this.uploadedFileName,
      query: this.queryText,
    };

    this.dataService.ligerQueryStructure(queryRequest).subscribe(
      data => {
        this.queryLoading = false;
        this.baseGraphElements = data.graph?.graphElements ?? [];
        this.querySolutions = data.solutions ?? [];
        this.activeSolutionIndex = null;
        this.refreshGraph();

        this.queryResult = data.success === 'true'
          ? `Query matched ${data.matchCount} solution${data.matchCount === 1 ? '' : 's'}.`
          : 'Query did not match.';
        this.displayMessage(this.queryResult, data.success === 'true' ? 'green' : 'red');
      },
      error => {
        this.queryLoading = false;
        this.querySolutions = [];
        console.error('Query failed:', error);
        this.displayMessage('Query failed.', 'red');
      }
    );
  }

  onSolutionToggle(index: number, isOpen: boolean) {
    this.activeSolutionIndex = isOpen ? index : null;
    this.refreshGraph();
  }

  isSolutionActive(index: number): boolean {
    return this.activeSolutionIndex === index;
  }

  solutionEntries(solution: LigerQuerySolution) {
    return Object.entries(solution.bindings).map(([variable, nodes]) => ({
      variable,
      nodes: Object.entries(nodes).map(([node, constraints]) => ({
        node,
        constraints,
      })),
    }));
  }

  private refreshGraph() {
    if (!this.baseGraphElements.length) {
      this.graphElements = [];
      return;
    }

    this.graphElements = this.cloneGraphElements(this.baseGraphElements);

    if (this.activeSolutionIndex === null) {
      this.cy1.renderGraph(this.graphElements);
      return;
    }

    const selectedSolution = this.querySolutions[this.activeSolutionIndex];
    if (!selectedSolution) {
      this.cy1.renderGraph(this.graphElements);
      return;
    }

    const selectedNodeIds = this.solutionNodeIds(selectedSolution);
    this.graphElements = this.graphElements.map(element => {
      if (!element?.data?.id) {
        return element;
      }

      const nextElement = this.cloneGraphElement(element);
      if (selectedNodeIds.has(String(nextElement.data.id))) {
        nextElement.data.query_selector = 'query-match';
      } else {
        delete nextElement.data.query_selector;
      }

      return nextElement;
    });

    this.cy1.renderGraph(this.graphElements);
  }

  private solutionNodeIds(solution: LigerQuerySolution): Set<string> {
    const ids = new Set<string>();

    Object.values(solution.bindings).forEach(nodes => {
      Object.keys(nodes).forEach(nodeId => ids.add(String(nodeId)));
    });

    return ids;
  }

  private cloneGraphElements(elements: any[]): any[] {
    return elements.map(element => this.cloneGraphElement(element));
  }

  private cloneGraphElement(element: any): any {
    return {
      ...element,
      data: element?.data ? {...element.data} : element?.data,
    };
  }

  displayMessage(message: string, color: string) {
    this.errorhandle.nativeElement.style.color = color;
    this.errorhandle.nativeElement.innerHTML = '[' + new Date().toLocaleTimeString() + '] ' + message;
  }
}
