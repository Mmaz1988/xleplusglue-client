import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { DataService } from '../data.service';
import { EditorComponent } from '../editor/editor.component';
import { GraphVisComponent } from '../liger-vis/liger-graph-vis/graph-vis.component';
import { LigerQuerySolution, LigerRule, LigerRuleAnnotation, LigerRuleAnnotationFact, LigerRuleAnnotationResponse, LigerStructure, LigerStructureQueryRequest, LigerStructureRuleRequest, LigerStructureUploadRequest } from '../models/models';
import { APP_DEFAULTS } from '../app-defaults';

@Component({
  selector: 'app-graph-inspector',
  templateUrl: './graph-inspector.component.html',
  styleUrls: ['./graph-inspector.component.css']
})
export class GraphInspectorComponent implements AfterViewInit, OnChanges {
  private preloadedGraphElements: any[] = [];


  @Input() initialUploadedContent = '';
  @Input() initialUploadedFileName = 'uploaded-graph';
  @Input() initialGraphElements: any[] = [];
  @Output() rulesApplied = new EventEmitter<LigerRuleAnnotationResponse>();

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
  private packedStructureJson = '';
  private packedGraphElements: any[] = [];
  graphElements: any[] = [];
  structureVariants: any[] = [];
  structureVariantGraphs: any[] = [];
  activeStructureVariantIndex: number | null = null;
  activeResultKind: 'query' | 'rules' | null = null;
  querySolutions: LigerQuerySolution[] = [];
  appliedRules: LigerRule[] = [];
  appliedRuleFactsByIndex: Record<number, LigerRuleAnnotationFact[]> = {};
  appliedRuleHighlightIdsByIndex: Record<number, Set<string>> = {};
  appliedMeaningConstructors = '';
  appliedNumberOfMCsets = 0;
  ruleAnnotations: LigerRuleAnnotation[] = [];
  private highlightedNodeIds = new Set<string>();
  private viewInitialized = false;
  activeSolutionIndex: number | null = null;
  activeRuleIndex: number | null = null;
  activeRuleAnnotationIndex: number | null = null;
  activeRuleVariantIndex: number | null = null;

  @ViewChild('cy1') cy1: GraphVisComponent;
  @ViewChild('graphResults') graphResults: ElementRef<HTMLElement>;
  @ViewChild('errorhandle') errorhandle: ElementRef;
  @ViewChild('rulesEditor') rulesEditor: EditorComponent;
  @ViewChild('queryEditor') queryEditor: EditorComponent;

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    if (this.preloadedGraphElements.length) {
      this.baseGraphElements = this.cloneGraphElements(this.preloadedGraphElements);
      this.graphElements = this.cloneGraphElements(this.baseGraphElements);
      this.cy1.renderGraph(this.graphElements);
      this.displayMessage('Loaded graph.', 'green');
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['initialUploadedContent'] && !changes['initialUploadedFileName'] && !changes['initialGraphElements']) {
      return;
    }

    if (this.initialUploadedContent.trim()) {
      this.uploadedContent = this.initialUploadedContent;
      this.currentStructureJson = this.initialUploadedContent;
      this.uploadedFileName = this.initialUploadedFileName || 'uploaded-graph';
    }

    if (Array.isArray(this.initialGraphElements)) {
      this.preloadedGraphElements = this.cloneGraphElements(this.initialGraphElements);
      if (this.viewInitialized) {
        this.baseGraphElements = this.cloneGraphElements(this.preloadedGraphElements);
        this.graphElements = this.cloneGraphElements(this.baseGraphElements);
        this.cy1?.renderGraph(this.graphElements);
      }
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
    const ruleContent = this.packedStructureJson.trim() || this.currentStructureJson.trim() || this.uploadedContent;
    const ruleFormat: 'json' | 'prolog' = (this.packedStructureJson.trim() || this.currentStructureJson.trim()) ? 'json' : this.uploadedFormat;

    if (!ruleContent.trim()) {
      this.displayMessage('Upload a graph first.', 'red');
      return;
    }

    this.loading = true;
    this.displayMessage('Now applying rules ...', 'blue');
    this.activeResultKind = 'rules';
    this.querySolutions = [];
    this.activeSolutionIndex = null;
    this.appliedRules = [];
    this.appliedRuleFactsByIndex = {};
    this.appliedRuleHighlightIdsByIndex = {};
    this.appliedMeaningConstructors = '';
    this.appliedNumberOfMCsets = 0;
    this.ruleAnnotations = [];
    this.highlightedNodeIds = new Set<string>();
    this.activeRuleIndex = null;
    this.activeRuleAnnotationIndex = null;
    this.activeRuleVariantIndex = null;
    const ruleRequestStartedAt = performance.now();

    const ruleRequest: LigerStructureRuleRequest = {
      content: ruleContent,
      format: ruleFormat,
      id: this.uploadedFileName,
      ruleString: this.rulesText,
    };

    this.dataService.ligerApplyRulesToStructure(ruleRequest).subscribe(
      data => {
        this.loading = false;
        console.info('[LiGER][post-processing] rule request completed', {
          elapsedMs: Math.round(performance.now() - ruleRequestStartedAt),
          annotationCount: Array.isArray(data?.annotations) ? data.annotations.length : 0,
          structure: this.structureSummary(data?.annotations?.[0]?.structureJson),
        });
        console.debug('[GraphInspector] applyRules response', data);
        this.ruleAnnotations = Array.isArray(data?.annotations) ? data.annotations : [];
        if (this.ruleAnnotations.length) {
          this.selectRuleAnnotation(0);
        } else {
          this.appliedRules = [];
          this.appliedRuleFactsByIndex = {};
          this.appliedMeaningConstructors = '';
          this.appliedNumberOfMCsets = 0;
          this.highlightedNodeIds = new Set<string>();
          this.refreshGraph();
          this.displayMessage('No rule results returned.', 'red');
          return;
        }
        this.displayMessage('Rules applied.', 'green');
        this.rulesApplied.emit(data);
        this.focusGraphResults();
      },
      error => {
        this.loading = false;
        console.error('[LiGER][post-processing] rule request failed', {
          elapsedMs: Math.round(performance.now() - ruleRequestStartedAt),
          error,
        });
        console.error('Apply rules failed:', error);
        const message = error?.error?.message || error?.message || 'Failed to apply rules.';
        this.displayMessage(message, 'red');
      }
    );
  }

  showRuleAnnotations(annotations: LigerRuleAnnotation[]): void {
    this.activeResultKind = 'rules';
    this.ruleAnnotations = Array.isArray(annotations) ? annotations : [];
    this.activeRuleAnnotationIndex = null;
    if (this.ruleAnnotations.length) {
      this.selectRuleAnnotation(0);
    } else {
      this.appliedRules = [];
      this.appliedRuleFactsByIndex = {};
      this.appliedRuleHighlightIdsByIndex = {};
      this.highlightedNodeIds = new Set<string>();
      this.refreshGraph();
    }
  }

  showStructure(structureContent: string, graphElements: any[], structureVariants: any[] = [], structureVariantGraphs: any[] = []): void {
    this.resetForNewStructure();
    this.currentStructureJson = structureContent ?? '';
    this.packedStructureJson = this.currentStructureJson;
    this.packedGraphElements = this.cloneGraphElements(graphElements ?? []);
    this.structureVariants = Array.isArray(structureVariants) ? structureVariants : [];
    this.structureVariantGraphs = Array.isArray(structureVariantGraphs) ? structureVariantGraphs : [];
    this.activeStructureVariantIndex = null;
    this.baseGraphElements = this.cloneGraphElements(graphElements ?? []);
    this.graphElements = this.cloneGraphElements(this.baseGraphElements);
    this.cy1.renderGraph(this.graphElements);
  }

  selectStructureVariant(index: number | null): void {
    if (index === null) {
      this.activeStructureVariantIndex = null;
      this.currentStructureJson = this.packedStructureJson;
      this.baseGraphElements = this.cloneGraphElements(this.packedGraphElements);
      this.graphElements = this.cloneGraphElements(this.baseGraphElements);
      this.cy1?.renderGraph(this.graphElements);
      return;
    }

    if (index < 0 || index >= this.structureVariants.length) {
      return;
    }

    this.activeStructureVariantIndex = index;
    this.currentStructureJson = JSON.stringify(this.structureVariants[index], null, 2);
    this.graphElements = this.cloneGraphElements(this.structureVariantGraphs[index]?.graphElements ?? []);
    this.cy1?.renderGraph(this.graphElements);
  }

  resetForNewStructure(): void {
    this.currentStructureJson = '';
    this.packedStructureJson = '';
    this.packedGraphElements = [];
    this.structureVariants = [];
    this.structureVariantGraphs = [];
    this.activeStructureVariantIndex = null;
    this.ruleAnnotations = [];
    this.appliedRules = [];
    this.appliedRuleFactsByIndex = {};
    this.appliedRuleHighlightIdsByIndex = {};
    this.appliedMeaningConstructors = '';
    this.appliedNumberOfMCsets = 0;
    this.highlightedNodeIds = new Set<string>();
    this.activeResultKind = null;
    this.activeSolutionIndex = null;
    this.activeRuleIndex = null;
    this.activeRuleAnnotationIndex = null;
    this.baseGraphElements = [];
    this.graphElements = [];
    this.cy1?.renderGraph([]);
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
      this.appliedRuleFactsByIndex = {};
      this.ruleAnnotations = [];
      this.querySolutions = [];
      this.activeRuleIndex = null;
      this.activeRuleAnnotationIndex = null;
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
    this.appliedRuleFactsByIndex = {};
    this.appliedRuleHighlightIdsByIndex = {};
    this.appliedMeaningConstructors = '';
    this.appliedNumberOfMCsets = 0;
    this.ruleAnnotations = [];
    this.activeRuleIndex = null;
    this.activeRuleAnnotationIndex = null;
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
    this.appliedRuleFactsByIndex = {};
    this.appliedMeaningConstructors = '';
    this.appliedNumberOfMCsets = 0;
    this.ruleAnnotations = [];
    this.highlightedNodeIds = new Set<string>();
    this.activeRuleIndex = null;
    this.activeRuleAnnotationIndex = null;
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

  onRuleToggle(index: number, isOpen: boolean) {
    this.activeRuleIndex = isOpen ? index : null;
    this.refreshGraph();
  }

  selectRuleAnnotation(index: number): void {
    if (index < 0 || index >= this.ruleAnnotations.length) {
      return;
    }

    this.activeRuleAnnotationIndex = index;
    this.activeRuleIndex = null;
    this.activeRuleVariantIndex = null;

    const selectedAnnotation = this.ruleAnnotations[index];
    this.appliedRules = Array.isArray(selectedAnnotation?.appliedRules) ? selectedAnnotation.appliedRules : [];
    this.appliedRuleFactsByIndex = this.extractRuleFactsByIndex(selectedAnnotation);
    this.appliedRuleHighlightIdsByIndex = this.extractRuleHighlightIdsByIndex(selectedAnnotation);
    this.appliedMeaningConstructors = typeof selectedAnnotation?.meaningConstructors === 'string' ? selectedAnnotation.meaningConstructors : '';
    this.appliedNumberOfMCsets = Number.isFinite(selectedAnnotation?.numberOfMCsets) ? selectedAnnotation.numberOfMCsets : 0;
    this.highlightedNodeIds = this.extractHighlightedNodeIds(selectedAnnotation);

    if (selectedAnnotation?.graph?.graphElements) {
      this.updateGraphResponse(selectedAnnotation.graph.graphElements);
    }

    if (selectedAnnotation?.structureJson) {
      this.currentStructureJson = JSON.stringify(selectedAnnotation.structureJson, null, 2);
    }
  }

  selectRuleVariant(index: number | null): void {
    const annotation = this.ruleAnnotations[this.activeRuleAnnotationIndex ?? 0];
    if (!annotation) {
      return;
    }

    if (index === null) {
      this.activeRuleVariantIndex = null;
      this.updateGraphResponse(annotation.graph?.graphElements ?? []);
      if (annotation.structureJson) {
        this.currentStructureJson = JSON.stringify(annotation.structureJson, null, 2);
      }
      return;
    }

    const structures = annotation.structureVariants ?? [];
    const graphs = annotation.structureVariantGraphs ?? [];
    if (index < 0 || index >= structures.length) {
      return;
    }

    this.activeRuleVariantIndex = index;
    this.updateGraphResponse(graphs[index]?.graphElements ?? []);
    this.currentStructureJson = JSON.stringify(structures[index], null, 2);
  }

  previousRuleVariant(): void {
    if (!this.ruleAnnotations.length) {
      return;
    }

    const nextIndex = (this.activeRuleAnnotationIndex === null ? 0 : this.activeRuleAnnotationIndex - 1 + this.ruleAnnotations.length) % this.ruleAnnotations.length;
    this.selectRuleAnnotation(nextIndex);
  }

  nextRuleVariant(): void {
    if (!this.ruleAnnotations.length) {
      return;
    }

    const nextIndex = (this.activeRuleAnnotationIndex === null ? 0 : this.activeRuleAnnotationIndex + 1) % this.ruleAnnotations.length;
    this.selectRuleAnnotation(nextIndex);
  }

  isSolutionActive(index: number): boolean {
    return this.activeSolutionIndex === index;
  }

  isRuleActive(index: number): boolean {
    return this.activeRuleIndex === index;
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
      this.graphElements = this.applyQueryHighlights(this.graphElements, this.ruleHighlightedNodeIds());
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

  private ruleHighlightedNodeIds(): Set<string> {
    if (!this.appliedRules.length) {
      return this.highlightedNodeIds;
    }

    const selectedRules = this.activeRuleIndex === null
      ? this.appliedRules
      : [this.appliedRules[this.activeRuleIndex]].filter(Boolean);

    const ids = this.collectRuleHighlightedNodeIds(selectedRules.length ? selectedRules : this.appliedRules);
    if (this.activeRuleIndex !== null) {
      console.debug('[GraphInspector] ruleHighlightedNodeIds', {
        activeRuleIndex: this.activeRuleIndex,
        selectedRuleIndexes: (selectedRules.length ? selectedRules : this.appliedRules).map(rule => rule.index),
        ids: Array.from(ids),
      });
      return ids;
    }

    if (ids.size) {
      console.debug('[GraphInspector] ruleHighlightedNodeIds', {
        activeRuleIndex: this.activeRuleIndex,
        selectedRuleIndexes: (selectedRules.length ? selectedRules : this.appliedRules).map(rule => rule.index),
        ids: Array.from(ids),
      });
      return ids;
    }

    console.debug('[GraphInspector] ruleHighlightedNodeIds', {
      activeRuleIndex: this.activeRuleIndex,
      selectedRuleIndexes: (selectedRules.length ? selectedRules : this.appliedRules).map(rule => rule.index),
      ids: Array.from(this.highlightedNodeIds),
    });
    return this.highlightedNodeIds;
  }

  private collectRuleHighlightedNodeIds(rules: LigerRule[]): Set<string> {
    const ids = new Set<string>();

    rules.forEach(rule => {
      const explicitIds = this.appliedRuleHighlightIdsByIndex[rule.index];
      if (explicitIds) {
        explicitIds.forEach(id => ids.add(id));
        return;
      }

      const facts = this.appliedRuleFactsByIndex[rule.index] ?? [];
      facts.forEach(fact => this.collectNodeIdsFromFact(fact).forEach(id => ids.add(id)));
    });

    return ids;
  }

  private collectNodeIdsFromFact(fact: LigerRuleAnnotationFact): Set<string> {
    const ids = new Set<string>();

    const sourceNode = fact?.fsNode ?? fact?.sourceNode;
    if (sourceNode !== undefined && sourceNode !== null && String(sourceNode).trim()) {
      const source = String(sourceNode).replace(/^#/, '');
      if (this.graphHasNodeId(source)) {
        ids.add(source);
      }
    }

    const targetNode = fact?.fsValue ?? fact?.targetNode;
    if (targetNode !== undefined && targetNode !== null && String(targetNode).trim()) {
      const target = String(targetNode).replace(/^#/, '');
      if (/^-?\d+$/.test(target) || this.graphHasNodeId(target)) {
        ids.add(target);
      }
    }

    return ids;
  }

  private graphHasNodeId(nodeId: string): boolean {
    return this.baseGraphElements.some(element => String(element?.data?.id) === nodeId);
  }

  private extractRuleFactsByIndex(payload: any): Record<number, LigerRuleAnnotationFact[]> {
    const factsByIndex: Record<number, LigerRuleAnnotationFact[]> = {};
    const rawFacts = payload?.addedAnnotationsByRule;

    if (!rawFacts || typeof rawFacts !== 'object') {
      return factsByIndex;
    }

    Object.entries(rawFacts).forEach(([ruleIndex, facts]) => {
      const factList = Array.isArray(facts)
        ? facts
        : facts && typeof facts === 'object'
          ? Object.values(facts)
          : [];
      factsByIndex[Number(ruleIndex)] = factList
        .filter(fact => fact && typeof fact === 'object')
        .map(fact => ({ ...(fact as LigerRuleAnnotationFact) }));
    });

    console.debug('[GraphInspector] parsed addedAnnotationsByRule', factsByIndex);

    return factsByIndex;
  }

  private extractRuleHighlightIdsByIndex(payload: any): Record<number, Set<string>> {
    const highlightsByIndex: Record<number, Set<string>> = {};
    const rawHighlights = payload?.highlightedNodeIdsByRule;

    if (!rawHighlights || typeof rawHighlights !== 'object') {
      return highlightsByIndex;
    }

    Object.entries(rawHighlights).forEach(([ruleIndex, ids]) => {
      if (Array.isArray(ids)) {
        highlightsByIndex[Number(ruleIndex)] = new Set(
          ids
            .filter(id => id !== undefined && id !== null && String(id).trim())
            .map(id => String(id))
        );
      }
    });

    return highlightsByIndex;
  }

  ruleFacts(rule: LigerRule): LigerRuleAnnotationFact[] {
    const ruleIndex = Number(rule?.index);
    return Number.isInteger(ruleIndex) ? this.appliedRuleFactsByIndex[ruleIndex] ?? [] : [];
  }

  ruleFactText(fact: LigerRuleAnnotationFact): string {
    const sourceNode = String(fact?.fsNode ?? fact?.sourceNode ?? '?').replace(/^#/, '');
    const relationLabel = fact?.relationLabel ?? '?';
    const rawTargetNode = String(fact?.fsValue ?? fact?.targetNode ?? '?');
    const normalizedTargetNode = rawTargetNode.replace(/^#/, '');
    const targetNode = /^-?\d+$/.test(normalizedTargetNode)
      || normalizedTargetNode === sourceNode
      || this.graphHasNodeId(normalizedTargetNode)
      ? `#${normalizedTargetNode}`
      : rawTargetNode;
    return `#${sourceNode} ${relationLabel} ${targetNode}`;
  }

  private extractHighlightedNodeIds(payload: any): Set<string> {
    const ids = new Set<string>();
    const hasExplicitHighlightSet = payload != null && Object.prototype.hasOwnProperty.call(payload, 'highlightedNodeIds');

    if (hasExplicitHighlightSet) {
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

      return ids;
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

  private focusGraphResults(): void {
    setTimeout(() => {
      const target = this.graphResults?.nativeElement;
      if (!target) {
        return;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.focus({ preventScroll: true });
    }, 0);
  }

  private updateCurrentStructureJson(structureJson?: LigerStructure | Record<string, unknown> | null): void {
    if (structureJson) {
      this.currentStructureJson = JSON.stringify(structureJson, null, 2);
    }
  }

  private structureSummary(structure: any): Record<string, unknown> {
    if (!structure || typeof structure !== 'object') {
      return { present: false };
    }
    const choiceSpace = structure.choiceSpace ?? {};
    return {
      present: true,
      id: structure.id,
      constraints: Array.isArray(structure.constraints) ? structure.constraints.length : 0,
      annotations: Array.isArray(structure.annotations) ? structure.annotations.length : 0,
      choices: Array.isArray(choiceSpace.choices) ? choiceSpace.choices.length : 0,
      choiceNodes: Array.isArray(choiceSpace.choiceNodes) ? choiceSpace.choiceNodes.length : 0,
      allVariables: Array.isArray(choiceSpace.allVariables) ? choiceSpace.allVariables : [],
    };
  }

  displayMessage(message: string, color: string) {
    this.errorhandle.nativeElement.style.color = color;
    this.errorhandle.nativeElement.innerHTML = '[' + new Date().toLocaleTimeString() + '] ' + message;
  }
}
