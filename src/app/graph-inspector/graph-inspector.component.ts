import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { DataService } from '../data.service';
import { EditorComponent } from '../editor/editor.component';
import { GraphVisComponent } from '../liger-vis/liger-graph-vis/graph-vis.component';
import { LigerQuerySolution, LigerRule, LigerStructure, LigerStructureQueryRequest, LigerStructureRuleRequest, LigerStructureUploadRequest } from '../models/models';
import { APP_DEFAULTS } from '../app-defaults';

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
  rulesText = APP_DEFAULTS.graphInspector.rulesText;
  queryText = APP_DEFAULTS.graphInspector.queryText;
  queryResult = '';
  loading = false;
  queryLoading = false;
  currentStructureJson = '';
  private baseGraphElements: any[] = [];
  graphElements: any[] = [];
  activeResultKind: 'query' | 'rules' | null = null;
  querySolutions: LigerQuerySolution[] = [];
  appliedRules: LigerRule[] = [];
  appliedMeaningConstructors = '';
  appliedNumberOfMCsets = 0;
  private highlightedNodeIds = new Set<string>();
  activeSolutionIndex: number | null = null;

  get highlightedNodeIdList(): string[] {
    return Array.from(this.highlightedNodeIds);
  }

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
    this.activeResultKind = 'rules';
    this.querySolutions = [];
    this.activeSolutionIndex = null;
    this.appliedRules = [];
    this.appliedMeaningConstructors = '';
    this.appliedNumberOfMCsets = 0;
    this.highlightedNodeIds = new Set<string>();

    const ruleRequest: LigerStructureRuleRequest = {
      content: this.uploadedContent,
      format: this.uploadedFormat,
      id: this.uploadedFileName,
      ruleString: this.rulesText,
    };

    this.dataService.ligerApplyRulesToStructure(ruleRequest).subscribe(
      data => {
        this.loading = false;
        this.highlightedNodeIds = this.extractHighlightedNodeIds(data);
        this.updateGraphResponse(data?.graph?.graphElements ?? []);
        this.updateCurrentStructureJson(data?.structureJson);
        this.appliedRules = Array.isArray(data?.appliedRules) ? data.appliedRules : [];
        this.appliedMeaningConstructors = typeof data?.meaningConstructors === 'string' ? data.meaningConstructors : '';
        this.appliedNumberOfMCsets = Number.isFinite(data?.numberOfMCsets) ? data.numberOfMCsets : 0;
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
      this.highlightedNodeIds = new Set<string>();
      this.appliedRules = [];
      this.querySolutions = [];
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
    this.activeResultKind = null;
    this.querySolutions = [];
    this.activeSolutionIndex = null;
    this.highlightedNodeIds = new Set<string>();
    this.appliedRules = [];
    this.appliedMeaningConstructors = '';
    this.appliedNumberOfMCsets = 0;
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
    this.activeResultKind = 'query';
    this.appliedRules = [];
    this.appliedMeaningConstructors = '';
    this.appliedNumberOfMCsets = 0;
    this.highlightedNodeIds = new Set<string>();
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

    if (this.activeResultKind === 'rules') {
      this.graphElements = this.applyRuleHighlights(this.graphElements);
      this.cy1.updateGraph(this.graphElements);
      return;
    }

    if (this.activeSolutionIndex === null) {
      this.cy1.updateGraph(this.graphElements);
      return;
    }

    const selectedSolution = this.querySolutions[this.activeSolutionIndex];
    if (!selectedSolution) {
      this.cy1.renderGraph(this.graphElements, true);
      return;
    }

    const selectedNodeIds = this.solutionNodeIds(selectedSolution);
    this.graphElements = this.applyQueryHighlights(this.graphElements, selectedNodeIds);

    this.cy1.updateGraph(this.graphElements);
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

  private applyQueryHighlights(elements: any[], highlightedIds: Set<string>): any[] {
    if (!highlightedIds.size) {
      return elements;
    }

    return elements.map(element => {
      const nodeId = element?.data?.id;
      if (!nodeId) {
        return element;
      }

      const nextElement = this.cloneGraphElement(element);
      if (highlightedIds.has(String(nextElement.data.id))) {
        nextElement.data.query_selector = 'query-match';
      } else {
        delete nextElement.data.query_selector;
      }
      return nextElement;
    });
  }

  private applyRuleHighlights(elements: any[]): any[] {
    if (!this.highlightedNodeIds.size) {
      return elements;
    }

    return elements.map(element => {
      const nodeId = element?.data?.id;
      if (!nodeId) {
        return element;
      }

      const nextElement = this.cloneGraphElement(element);
      if (this.highlightedNodeIds.has(String(nextElement.data.id))) {
        nextElement.data.query_selector = 'query-match';
      } else {
        delete nextElement.data.query_selector;
      }
      return nextElement;
    });
  }

  private extractHighlightedNodeIds(payload: any): Set<string> {
    const ids = new Set<string>();

    const explicit = payload?.highlightedNodeIds;
    if (Array.isArray(explicit)) {
      explicit.forEach(value => {
        if (value !== undefined && value !== null && String(value).trim()) {
          ids.add(String(value));
        }
      });
    } else if (explicit instanceof Set) {
      explicit.forEach(value => ids.add(String(value)));
    }

    const addFromAnnotation = (annotation: any) => {
      const nodeId = annotation?.fsNode ?? annotation?.nodeId ?? annotation?.id ?? annotation?.data?.id;
      if (nodeId !== undefined && nodeId !== null && String(nodeId).trim()) {
        ids.add(String(nodeId));
      }
    };

    const annotations = payload?.annotations;
    if (Array.isArray(annotations)) {
      annotations.forEach(addFromAnnotation);
    } else if (annotations && typeof annotations === 'object') {
      Object.values(annotations).forEach(addFromAnnotation);
    }

    const structureAnnotations = payload?.structureJson?.annotations;
    if (Array.isArray(structureAnnotations)) {
      structureAnnotations.forEach(addFromAnnotation);
    }

    return ids;
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

    if (typeof state?.rulesText === 'string' && state.rulesText.trim()) {
      this.rulesText = state.rulesText;
    }

    if (typeof state?.queryText === 'string' && state.queryText.trim()) {
      this.queryText = state.queryText;
    }
  }

  private updateGraphResponse(graphElements: any[]): void {
    this.baseGraphElements = this.cloneGraphElements(graphElements);
    this.refreshGraph();
  }

  private updateCurrentStructureJson(structureJson?: LigerStructure | Record<string, unknown> | null): void {
    if (structureJson) {
      this.currentStructureJson = JSON.stringify(structureJson, null, 2);
    }
  }

  displayMessage(message: string, color: string) {
    this.errorhandle.nativeElement.style.color = color;
    this.errorhandle.nativeElement.innerHTML = '[' + new Date().toLocaleTimeString() + '] ' + message;
  }
}
