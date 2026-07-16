import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { DataService } from '../data.service';
import { EditorComponent } from '../editor/editor.component';
import { GraphVisComponent } from '../liger-vis/liger-graph-vis/graph-vis.component';
import { LigerQuerySolution, LigerStructure, LigerStructureQueryRequest, LigerStructureRuleRequest, LigerStructureUploadRequest } from '../models/models';

@Component({
  selector: 'app-graph-inspector',
  templateUrl: './graph-inspector.component.html',
  styleUrls: ['./graph-inspector.component.css']
})
export class GraphInspectorComponent implements AfterViewInit {
  private preloadedGraphElements: any[] = [];

  constructor(private dataService: DataService) {
    const state = (typeof history !== 'undefined' ? history.state : null) as any;
    this.initializeFromRouteState(state);

    const graphElements = Array.isArray(state?.graphElements)
      ? state.graphElements
      : Array.isArray(state?.syntaxGraph)
        ? state.syntaxGraph
        : [];

    if (graphElements.length) {
      this.preloadedGraphElements = this.cloneGraphElements(graphElements);
    }
  }

  uploadedContent = '';
  uploadedFormat: 'json' | 'prolog' = 'json';
  uploadedFileName = 'uploaded-graph';
  rulesText = '';
  queryText = '';
  queryResult = '';
  loading = false;
  queryLoading = false;
  currentStructureJson = '';
  private baseGraphElements: any[] = [];
  graphElements: any[] = [];
  querySolutions: LigerQuerySolution[] = [];
  activeSolutionIndex: number | null = null;

  @ViewChild('cy1') cy1: GraphVisComponent;
  @ViewChild('errorhandle') errorhandle: ElementRef;
  @ViewChild('rulesEditor') rulesEditor: EditorComponent;
  @ViewChild('queryEditor') queryEditor: EditorComponent;

  ngAfterViewInit(): void {
    if (this.preloadedGraphElements.length) {
      this.baseGraphElements = this.cloneGraphElements(this.preloadedGraphElements);
      this.graphElements = this.cloneGraphElements(this.baseGraphElements);
      this.cy1.renderGraph(this.graphElements);
      this.displayMessage('Loaded graph.', 'green');
    }

    this.syncEditorContents();
  }

  onUploadFile(event: Event) {
    this.loadUploadedStructure(event);
  }

  downloadCurrentStructure(): void {
    if (!this.currentStructureJson.trim()) {
      return;
    }

    const blob = new Blob([this.currentStructureJson], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = this.uploadedFileName.endsWith('.json') ? this.uploadedFileName : `${this.uploadedFileName}.json`;
    link.click();
    setTimeout(() => window.URL.revokeObjectURL(url), 10000);
  }

  applyRules() {
    if (!this.uploadedContent.trim()) {
      this.displayMessage('Upload a graph first.', 'red');
      return;
    }

    this.loading = true;
    this.querySolutions = [];
    this.activeSolutionIndex = null;

    const ruleRequest: LigerStructureRuleRequest = {
      content: this.uploadedContent,
      format: this.uploadedFormat,
      id: this.uploadedFileName,
      ruleString: this.rulesText,
    };

    this.dataService.ligerApplyRulesToStructure(ruleRequest).subscribe(
      data => {
        this.loading = false;
        this.updateGraphResponse(data?.graph?.graphElements ?? []);
        this.updateCurrentStructureJson(data?.structureJson);
        this.displayMessage('Rules applied.', 'green');
      },
      error => {
        this.loading = false;
        console.error('Apply rules failed:', error);
        const message = error?.error?.message || error?.message || 'Failed to apply rules.';
        this.displayMessage(message, 'red');
      }
    );
  }

  private loadUploadedStructure(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length > 0 ? input.files[0] : null;

    if (!file) {
      return;
    }

    this.preloadedGraphElements = [];
    this.uploadedFileName = file.name;
    this.uploadedFormat = file.name.endsWith('.pl') || file.name.endsWith('.prolog') ? 'prolog' : 'json';

    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? '');
      this.uploadedContent = content;
      this.currentStructureJson = this.uploadedFormat === 'json' ? content : '';
      this.displayMessage(`Loaded ${file.name}`, 'green');
      this.renderUploadedGraph();
    };
    reader.onerror = () => {
      this.displayMessage(`Could not read ${file.name}`, 'red');
    };
    reader.readAsText(file);
  }

  private parseStructure(content: string, format: 'json' | 'prolog', id: string): LigerStructure | null {
    if (format !== 'json') {
      return null;
    }

    const parsed = JSON.parse(content) as Partial<LigerStructure>;
    return {
      id: parsed.id ?? id,
      text: parsed.text ?? id,
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
      choiceSpace: parsed.choiceSpace ?? {},
    };
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

    this.dataService.ligerRenderStructure(uploadRequest).subscribe(
      data => {
        this.loading = false;
        if (data?.graph?.graphElements?.length) {
          this.updateGraphResponse(data.graph.graphElements);
          this.updateCurrentStructureJson(data?.structureJson);
          this.displayMessage('Graph loaded.', 'green');
        } else {
          this.displayMessage('No graph elements returned.', 'red');
        }
      },
      error => {
        this.loading = false;
        console.error('Upload failed:', error);
        const message = error?.error?.message || error?.message || 'Failed to load graph.';
        this.displayMessage(message, 'red');
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
    const queryContent = this.currentStructureJson.trim() ? this.currentStructureJson : this.uploadedContent;
    const queryFormat: 'json' | 'prolog' = this.currentStructureJson.trim() ? 'json' : this.uploadedFormat;
    const queryRequest: LigerStructureQueryRequest = {
      content: queryContent,
      format: queryFormat,
      id: this.uploadedFileName,
      query: this.queryText,
    };

    this.dataService.ligerQueryStructure(queryRequest).subscribe(
      data => {
        this.queryLoading = false;
        this.updateGraphResponse(data.graph?.graphElements ?? []);
        this.querySolutions = data.solutions ?? [];
        this.activeSolutionIndex = null;
        this.updateCurrentStructureJson(data.structureJson);
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

  private initializeFromRouteState(state: any): void {
    if (typeof state?.uploadedContent === 'string' && state.uploadedContent.trim()) {
      this.uploadedContent = state.uploadedContent;
      this.uploadedFormat = state.uploadedFormat === 'prolog' ? 'prolog' : 'json';
      this.uploadedFileName = state.uploadedFileName ?? 'merged-graph.json';
      this.currentStructureJson = this.uploadedFormat === 'json' ? this.uploadedContent : '';
    }
  }

  private updateGraphResponse(graphElements: any[]): void {
    this.baseGraphElements = this.cloneGraphElements(graphElements);
    this.graphElements = this.cloneGraphElements(this.baseGraphElements);
    this.cy1.renderGraph(this.graphElements);
  }

  private updateCurrentStructureJson(structureJson?: LigerStructure | Record<string, unknown> | null): void {
    if (structureJson) {
      this.currentStructureJson = JSON.stringify(structureJson, null, 2);
    }
  }

  private syncEditorContents(): void {
    if (this.rulesEditor && typeof (this.rulesEditor as any).updateContent === 'function') {
      (this.rulesEditor as any).updateContent(this.rulesText);
    }

    if (this.queryEditor && typeof (this.queryEditor as any).updateContent === 'function') {
      (this.queryEditor as any).updateContent(this.queryText);
    }
  }

  displayMessage(message: string, color: string) {
    this.errorhandle.nativeElement.style.color = color;
    this.errorhandle.nativeElement.innerHTML = '[' + new Date().toLocaleTimeString() + '] ' + message;
  }
}
