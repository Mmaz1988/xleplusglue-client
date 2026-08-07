import { Component, ViewChild, AfterViewInit, OnDestroy, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import {LigerVisComponent} from "../liger-vis/liger-vis.component";
import {GswbVisComponent} from "../gswb-vis/gswb-vis.component";
import { DataService } from '../data.service';
import { GswbProofInput, GswbSolution, LigerRuleAnnotation, LigerRuleAnnotationResponse, LigerStructure } from '../models/models';
import { AnalysisWorkspaceStateService } from '../analysis-workspace-state.service';
import { GraphInspectorComponent } from '../graph-inspector/graph-inspector.component';
import { SemVisComponent } from '../sem-vis/sem-vis.component';

interface PostProcessingResult {
  semanticSolution: GswbSolution;
  structureContent: string;
  graphElements: any[];
  ruleAnnotations: LigerRuleAnnotation[];
  rulesApplied: boolean;
  annotatedStructureContent?: string;
  annotatedGraphElements?: any[];
}

@Component({
  selector: 'app-glue-interface',
  templateUrl: './glue-interface.component.html',
  styleUrls: ['./glue-interface.component.css']
})
export class GlueInterfaceComponent implements AfterViewInit, OnDestroy {

  @ViewChild('l1') liger: LigerVisComponent;
  @ViewChild('g1') glue: GswbVisComponent;
  @ViewChild('postProcessingSection') postProcessingSection?: ElementRef<HTMLElement>;
  @ViewChild('pcdrsResults') pcdrsResults?: ElementRef<HTMLElement>;
  @ViewChild(GraphInspectorComponent) inlineGraphInspector?: GraphInspectorComponent;
  @ViewChild('pcdrsSemvis') pcdrsSemvis?: SemVisComponent;

  isFirstDivMinimized = false;
  isSecondDivMinimized = false;
  showInlinePostProcessing = false;
  postProcessingLoading = false;
  pcdrsLoading = false;
  collapseAnaphoraLoading = false;
  showCollapsedAnaphora = false;
  mergedStructureContent = '';
  mergedStructureFileName = 'merged-graph.json';
  mergedGraphElements: any[] = [];
  postProcessingResults: PostProcessingResult[] = [];
  postProcessingResultsReady = false;
  selectedPostProcessingIndex = 0;
  rulesApplicationLoading = false;
  pcdrsSolutions: GswbSolution[] = [];
  pcdrsDisplaySolutions: GswbSolution[] = [];
  collapsedPcdrsById: Record<string, GswbSolution> = {};
  previousSemanticGraphs: LigerStructure[] = [];
  previousSemanticStrings: string[] = [];
  private lastSequenceLength = 0;
  private syntaxBySolutionKey: Record<string, LigerStructure> = {};

  constructor(private router: Router, private dataService: DataService, private workspaceState: AnalysisWorkspaceStateService) {}

  ngAfterViewInit() {
    if (this.liger?.changeDetector && this.glue?.editor1) {
      this.liger.changeDetector.subscribe(newValue => {
        const sequenceLength = this.liger.sequenceSentences.length;
        if (sequenceLength <= 1) {
          this.previousSemanticGraphs = [];
          this.previousSemanticStrings = [];
        } else if (sequenceLength !== this.lastSequenceLength) {
          const semvis = this.glue.semvis;
          const hasDiscriminantSelection = (semvis.selectedScopeIds?.length ?? 0) > 0
            || (semvis.selectedMcIds?.length ?? 0) > 0;
          const solutions = hasDiscriminantSelection
            ? semvis.items
            : (semvis.allItems ?? semvis.items);
          const eligible = (Array.isArray(solutions) ? solutions : [])
            .filter(solution => !!solution?.graph);
          this.previousSemanticGraphs = eligible.map(solution => solution.graph as LigerStructure);
          this.previousSemanticStrings = eligible
            .map(solution => solution.semantic ?? '');
          console.info('[Analysis] captured previous semantic context before sequence append', {
            previousSequenceLength: this.lastSequenceLength,
            newSequenceLength: sequenceLength,
            previousSolutionCount: eligible.length,
            previousSolutionIds: eligible.map(solution => solution.id),
            previousGraphSizes: this.previousSemanticGraphs.map(graph => ({
              constraints: graph.constraints?.length ?? 0,
              annotations: graph.annotations?.length ?? 0,
            })),
            previousSemanticLengths: this.previousSemanticStrings.map(semantic => semantic.length),
          });
        }
        this.lastSequenceLength = sequenceLength;
        // Update glue's variable here
        this.glue.editor1.updateContent(newValue);
        this.glue.semanticSolutionReady = false;
      });
      this.liger.proofInputChange.subscribe((proofInputs: GswbProofInput[]) => {
        this.syntaxBySolutionKey = {};
        proofInputs.forEach(input => {
          if (input.solutionKey && input.structure) {
            this.syntaxBySolutionKey[input.solutionKey] = input.structure;
          }
        });
        this.glue.setProofInputs(proofInputs);
        console.info('[Analysis] updated GSWB proof inputs from LiGER', {
          proofCount: proofInputs.length,
          proofInputs: proofInputs.map(input => ({
            proofId: input.proofId,
            solutionKey: input.solutionKey,
            mcSetId: input.mcSetId,
            meaningConstructorsLength: input.meaningConstructors?.length ?? 0,
            structureConstraints: input.structure?.constraints?.length ?? 0,
            structureAnnotations: input.structure?.annotations?.length ?? 0,
          })),
        });
      });
    }

    setTimeout(() => this.restoreWorkspaceState(), 0);
  }

  ngOnDestroy(): void {
    this.saveWorkspaceState();
  }

  handlePostProcessing(mode: 'inline' | 'standalone'): void {
    const semanticSolutions = this.semanticSolutionsForPostProcessing();

    if (!semanticSolutions.length || this.postProcessingLoading) {
      return;
    }

    this.inlineGraphInspector?.resetForNewStructure();
    this.postProcessingResultsReady = false;
    this.postProcessingLoading = true;
    console.info('[Analysis] starting post-processing for semantic solutions', {
      mode,
      solutionCount: semanticSolutions.length,
      solutionIds: semanticSolutions.map(solution => solution.id),
      solutionKeys: semanticSolutions.map(solution => solution.solutionKey),
    });
    forkJoin(semanticSolutions.map(semanticSolution => this.dataService.ligerMergeStructure({
      syntax: this.syntaxForSolution(semanticSolution),
      drs: semanticSolution.graph as LigerStructure,
    }))).subscribe(responses => {
      console.info('[Analysis] LiGER merged semantic solutions with syntax', {
        responseCount: responses.length,
        structures: responses.map(response => ({
          constraints: Array.isArray(response?.structureJson?.['constraints'])
            ? response.structureJson['constraints'].length : 0,
          annotations: Array.isArray(response?.structureJson?.['annotations'])
            ? response.structureJson['annotations'].length : 0,
          graphElements: response?.graph?.graphElements?.length ?? 0,
        })),
      });
      this.postProcessingResults = responses.map((response, index) => ({
        semanticSolution: semanticSolutions[index],
        structureContent: typeof response?.structureJson === 'string'
          ? response.structureJson
          : JSON.stringify(response?.structureJson ?? {}, null, 2),
        graphElements: response?.graph?.graphElements ?? [],
        ruleAnnotations: [],
        rulesApplied: false,
      }));
      this.selectedPostProcessingIndex = 0;
      this.postProcessingResultsReady = true;
      this.postProcessingLoading = false;
      this.selectPostProcessingResult(0, false);

      if (mode === 'standalone') {
        this.router.navigate(['/graph-inspector'], {
          state: {
            uploadedContent: this.mergedStructureContent,
            uploadedFormat: 'json',
            uploadedFileName: 'merged-graph.json',
            graphElements: this.mergedGraphElements,
          }
        });
        return;
      }

      this.mergedStructureFileName = 'merged-graph.json';
      this.pcdrsSolutions = [];
      this.pcdrsDisplaySolutions = [];
      this.collapsedPcdrsById = {};
      this.showCollapsedAnaphora = false;
      this.showInlinePostProcessing = true;
      setTimeout(() => this.postProcessingSection?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    }, () => {
      this.postProcessingLoading = false;
      this.postProcessingResultsReady = false;
      this.postProcessingResults = [];
    });
  }

  private syntaxForSolution(solution: GswbSolution): LigerStructure | null {
    return (solution.solutionKey ? this.syntaxBySolutionKey[solution.solutionKey] : undefined)
      ?? this.liger?.structureJson
      ?? null;
  }

  selectPostProcessingResult(index: number, resetDownstream = true): void {
    const result = this.postProcessingResults[index];
    if (!result) {
      return;
    }

    this.selectedPostProcessingIndex = index;
    const annotatedContent = result.annotatedStructureContent;
    const annotatedGraph = result.annotatedGraphElements;
    const displayContent = result.rulesApplied && annotatedContent
      ? annotatedContent
      : result.structureContent;
    const displayGraph = result.rulesApplied && annotatedGraph
      ? annotatedGraph
      : result.graphElements;
    this.mergedStructureContent = displayContent;
    this.mergedGraphElements = displayGraph;
    if (typeof this.inlineGraphInspector?.showStructure === 'function') {
      this.inlineGraphInspector.showStructure(displayContent, displayGraph);
    }
    if (result.rulesApplied && result.ruleAnnotations.length
      && typeof this.inlineGraphInspector?.showRuleAnnotations === 'function') {
      this.inlineGraphInspector?.showRuleAnnotations(result.ruleAnnotations);
    }
    if (resetDownstream) {
      this.pcdrsSolutions = [];
      this.pcdrsDisplaySolutions = [];
      this.collapsedPcdrsById = {};
      this.showCollapsedAnaphora = false;
    }
  }

  previousPostProcessingResult(): void {
    if (!this.canNavigatePostProcessing()) {
      return;
    }
    const index = (this.selectedPostProcessingIndex - 1 + this.postProcessingResults.length)
      % this.postProcessingResults.length;
    this.selectPostProcessingResult(index);
  }

  nextPostProcessingResult(): void {
    if (!this.canNavigatePostProcessing()) {
      return;
    }
    const index = (this.selectedPostProcessingIndex + 1) % this.postProcessingResults.length;
    this.selectPostProcessingResult(index);
  }

  canNavigatePostProcessing(): boolean {
    return this.postProcessingResultsReady
      && !this.postProcessingLoading
      && !this.rulesApplicationLoading
      && !this.inlineGraphInspector?.loading
      && this.postProcessingResults.length > 1;
  }

  onRulesApplied(response: LigerRuleAnnotationResponse): void {
    if (!this.postProcessingResults.length || this.rulesApplicationLoading) {
      return;
    }

    const activeIndex = this.selectedPostProcessingIndex;
    const ruleString = this.inlineGraphInspector?.rulesText ?? '';
    this.rulesApplicationLoading = true;
    if (typeof this.inlineGraphInspector?.displayMessage === 'function') {
      this.inlineGraphInspector.displayMessage('Now applying rules ...', 'blue');
    }

    const requests = this.postProcessingResults.map((result, index) => {
      if (index === activeIndex) {
        return of(response);
      }
      return this.dataService.ligerApplyRulesToStructure({
        content: result.structureContent,
        format: 'json',
        id: `merged-graph-${index + 1}.json`,
        ruleString,
      });
    });

    console.info('[Analysis] applying post-processing rules', {
      resultCount: requests.length,
      ruleStringLength: ruleString.length,
      structureSizes: this.postProcessingResults.map(result => ({
        contentLength: result.structureContent.length,
        rulesAlreadyApplied: result.rulesApplied,
      })),
    });

    forkJoin(requests).subscribe(responses => {
      responses.forEach((result, index) => {
        const target = this.postProcessingResults[index];
        target.ruleAnnotations = result?.annotations ?? [];
        target.rulesApplied = true;
        const firstAnnotation = target.ruleAnnotations.find(annotation =>
          !!annotation?.structureJson || !!annotation?.graph?.graphElements);
        if (firstAnnotation?.structureJson) {
          target.annotatedStructureContent = JSON.stringify(firstAnnotation.structureJson, null, 2);
        }
        if (firstAnnotation?.graph?.graphElements) {
          target.annotatedGraphElements = firstAnnotation.graph.graphElements;
        }
      });
      console.info('[Analysis] post-processing rules completed', {
        resultCount: responses.length,
        annotationCounts: responses.map(result => result?.annotations?.length ?? 0),
        appliedRuleCounts: responses.map(result => result?.annotations?.[0]?.appliedRules?.length ?? 0),
      });
      this.rulesApplicationLoading = false;
      if (typeof this.inlineGraphInspector?.displayMessage === 'function') {
        this.inlineGraphInspector.displayMessage('Rules applied.', 'green');
      }
      this.selectPostProcessingResult(activeIndex, false);
    }, () => {
      this.rulesApplicationLoading = false;
    });
  }

  openMergedGraphInspector(): void {
    this.handlePostProcessing('standalone');
  }

  generatePcdrs(selectedOnly = false): void {
    const structureContent = this.currentPostProcessedStructureContent();
    if (!structureContent || this.pcdrsLoading || this.rulesApplicationLoading) {
      return;
    }

    const results = this.postProcessingResults.length
      ? this.postProcessingResults
      : (() => {
        const selected = this.selectedSemanticSolution();
        const structure = this.parseStructureContent(structureContent);
        return selected?.semantic && structure
          ? [{ semanticSolution: selected, structureContent, graphElements: [], ruleAnnotations: [], rulesApplied: false }]
          : [];
      })();
    const indexedResults = results.map((result, index) => ({ result, graphIndex: index }));
    const resultsToProcess = selectedOnly && this.postProcessingResults.length
      ? indexedResults.filter(({ graphIndex }) => graphIndex === this.selectedPostProcessingIndex)
      : indexedResults;
    const candidates = resultsToProcess.flatMap(({ result, graphIndex }) => {
      const annotations = result.ruleAnnotations.length
        ? result.ruleAnnotations
        : result.rulesApplied
          ? []
          : [{ structureJson: this.parseStructureContent(result.structureContent) } as LigerRuleAnnotation]
            .filter(annotation => !!annotation.structureJson);
      return annotations.map((annotation, annotationIndex) => ({
        result,
        graphIndex,
        annotation,
        annotationIndex,
      }));
    });
    if (!candidates.length) {
      return;
    }

    this.pcdrsLoading = true;
    console.info('[Analysis] generating PCDRS from annotated structures', {
      candidateCount: candidates.length,
      candidates: candidates.map(candidate => ({
        solutionId: candidate.result.semanticSolution.id,
        graphIndex: candidate.graphIndex,
        annotationIndex: candidate.annotationIndex,
        constraints: candidate.annotation.structureJson?.constraints?.length ?? 0,
        annotations: candidate.annotation.structureJson?.annotations?.length ?? 0,
      })),
    });
    forkJoin(candidates.map(candidate => this.dataService.gswbGeneratePcdrs({
      semantic: candidate.result.semanticSolution.semantic ?? '',
      parentSolutionId: this.postProcessingResults.length
        ? `${candidate.result.semanticSolution.id}-graph-${candidate.graphIndex + 1}-rule-${candidate.annotationIndex + 1}`
        : candidate.result.semanticSolution.id,
      mergedStructure: candidate.annotation.structureJson as LigerStructure,
    }))).subscribe(responses => {
      this.pcdrsLoading = false;
      console.info('[Analysis] PCDRS generation completed', {
        responseCount: responses.length,
        solutionCounts: responses.map(response => response?.solutions?.length ?? 0),
        solutionIds: responses.flatMap(response => (response?.solutions ?? []).map(solution => solution.id)),
      });
      this.pcdrsSolutions = responses.flatMap(response => response?.solutions ?? []);
      this.collapsedPcdrsById = {};
      this.showCollapsedAnaphora = false;
      this.refreshPcdrsDisplay();
      this.focusPcdrsResults();
    }, () => {
      this.pcdrsLoading = false;
      this.pcdrsSolutions = [];
    });
  }

  canGeneratePcdrs(): boolean {
    return this.showInlinePostProcessing
      && !!this.currentPostProcessedStructureContent()
      && !this.rulesApplicationLoading
      && (this.postProcessingResults.length > 0 || !!this.selectedSemanticSolution()?.semantic);
  }

  canGenerateSelectedPcdrs(): boolean {
    return this.canGeneratePcdrs()
      && (!this.postProcessingResults.length || !!this.postProcessingResults[this.selectedPostProcessingIndex]);
  }

  rulesApplicationInProgress(): boolean {
    return this.rulesApplicationLoading || !!this.inlineGraphInspector?.loading;
  }

  allPostProcessingRulesApplied(): boolean {
    return this.postProcessingResults.length > 0
      && !this.rulesApplicationInProgress()
      && this.postProcessingResults.every(result => result.rulesApplied);
  }

  collapseAllAnaphora(): void {
    const candidates = this.pcdrsSolutions.filter(solution =>
      !!solution.semantic && !this.collapsedPcdrsById[solution.id]);
    if (!candidates.length || this.collapseAnaphoraLoading) {
      return;
    }

    this.collapseAnaphoraLoading = true;
    forkJoin(candidates.map(solution => this.dataService.gswbCollapseAnaphora({
      semantic: solution.semantic as string,
      parentSolutionId: solution.id,
    }))).subscribe(responses => {
      this.collapseAnaphoraLoading = false;
      responses.forEach((response, index) => {
        if (response) {
          this.collapsedPcdrsById[candidates[index].id] = response;
        }
      });
      if (responses.length) {
        this.showCollapsedAnaphora = true;
      }
      this.refreshPcdrsDisplay();
    }, () => {
      this.collapseAnaphoraLoading = false;
    });
  }

  canCollapseAllAnaphora(): boolean {
    return this.pcdrsSolutions.some(solution =>
      !!solution.semantic && !this.collapsedPcdrsById[solution.id]);
  }

  canToggleCollapsedAnaphora(): boolean {
    const selected = this.selectedPcdrsSolution();
    return !!selected && !!this.collapsedPcdrsById[selected.id];
  }

  toggleCollapsedAnaphora(): void {
    if (!this.canToggleCollapsedAnaphora()) {
      return;
    }
    this.showCollapsedAnaphora = !this.showCollapsedAnaphora;
    this.refreshPcdrsDisplay();
  }

  canOpenMergedGraphInspector(): boolean {
    const betaReduce = this.glue?.gswbPreferences?.gswbPreferences?.betaReduce;
    return betaReduce === true && !!this.liger?.structureJson
      && this.semanticSolutionsForPostProcessing().length > 0;
  }

  hasGswbSemanticSolution(): boolean {
    if (!this.glue?.semanticSolutionReady) {
      return false;
    }
    const solutions = this.glue.semvis?.items;
    return Array.isArray(solutions) && solutions.some(solution =>
      typeof solution?.semantic === 'string' && solution.semantic.trim().length > 0);
  }

  private semanticSolutionsForPostProcessing(): GswbSolution[] {
    const semvis = this.glue?.semvis;
    if (!semvis) {
      return [];
    }

    const hasDiscriminantSelection = (semvis.selectedScopeIds?.length ?? 0) > 0
      || (semvis.selectedMcIds?.length ?? 0) > 0;
    const solutions = hasDiscriminantSelection ? semvis.items : (semvis.allItems ?? semvis.items);
    return (Array.isArray(solutions) ? solutions : []).filter(solution => !!solution?.graph);
  }

  private parseStructureContent(content: string): LigerStructure | null {
    try {
      return JSON.parse(content) as LigerStructure;
    } catch {
      return null;
    }
  }

  private selectedSemanticSolution(): GswbSolution | undefined {
    const selectedIndex = this.glue?.semvis?.index ?? 0;
    return this.glue?.semvis?.items?.[selectedIndex] as GswbSolution | undefined;
  }

  private currentPostProcessedStructureContent(): string {
    return this.inlineGraphInspector?.currentStructureJson?.trim()
      || this.mergedStructureContent.trim();
  }

  private selectedPcdrsSolution(): GswbSolution | undefined {
    const selectedIndex = this.pcdrsSemvis?.index ?? 0;
    const displayed = this.pcdrsSemvis?.items?.[selectedIndex];
    if (!displayed) {
      return undefined;
    }
    const original = this.pcdrsSolutions.find(solution => solution.id === displayed.id);
    if (original) {
      return original;
    }
    const collapsedEntry = Object.entries(this.collapsedPcdrsById)
      .find(([, collapsed]) => collapsed.id === displayed.id);
    return collapsedEntry
      ? this.pcdrsSolutions.find(solution => solution.id === collapsedEntry[0])
      : undefined;
  }

  private refreshPcdrsDisplay(): void {
    this.pcdrsDisplaySolutions = this.pcdrsSolutions.map(solution =>
      this.showCollapsedAnaphora && this.collapsedPcdrsById[solution.id]
        ? this.collapsedPcdrsById[solution.id]
        : solution);
  }

  private focusPcdrsResults(): void {
    setTimeout(() => {
      const target = this.pcdrsResults?.nativeElement;
      if (!target) {
        return;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.focus({ preventScroll: true });
    }, 0);
  }

  private saveWorkspaceState(): void {
    const ligerState = typeof this.liger?.captureState === 'function'
      ? this.liger.captureState()
      : null;
    const gswbState = typeof this.glue?.captureState === 'function'
      ? this.glue.captureState()
      : null;

    if (ligerState) {
      this.workspaceState.saveLiger(ligerState);
    }

    if (gswbState) {
      this.workspaceState.saveGswb(gswbState);
    }
  }

  private restoreWorkspaceState(): void {
    const state = this.workspaceState.getState();

    if (state.liger) {
      this.liger?.restoreState(state.liger);
    }

    if (state.gswb) {
      this.glue?.restoreState(state.gswb);
    }
  }

}
