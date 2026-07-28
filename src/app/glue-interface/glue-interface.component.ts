import { Component, ViewChild, AfterViewInit, OnDestroy, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import {LigerVisComponent} from "../liger-vis/liger-vis.component";
import {GswbVisComponent} from "../gswb-vis/gswb-vis.component";
import { DataService } from '../data.service';
import { GswbSolution, LigerStructure } from '../models/models';
import { AnalysisWorkspaceStateService } from '../analysis-workspace-state.service';
import { GraphInspectorComponent } from '../graph-inspector/graph-inspector.component';
import { SemVisComponent } from '../sem-vis/sem-vis.component';

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
  pcdrsSolutions: GswbSolution[] = [];
  pcdrsDisplaySolutions: GswbSolution[] = [];
  collapsedPcdrsById: Record<string, GswbSolution> = {};
  previousSemanticGraphs: LigerStructure[] = [];
  private lastSequenceLength = 0;

  constructor(private router: Router, private dataService: DataService, private workspaceState: AnalysisWorkspaceStateService) {}

  ngAfterViewInit() {
    if (this.liger?.changeDetector && this.glue?.editor1) {
      this.liger.changeDetector.subscribe(newValue => {
        const sequenceLength = this.liger.sequenceSentences.length;
        if (sequenceLength <= 1) {
          this.previousSemanticGraphs = [];
        } else if (sequenceLength !== this.lastSequenceLength) {
          const selected = this.selectedSemanticSolution();
          if (selected?.graph) {
            this.previousSemanticGraphs = [selected.graph];
          }
        }
        this.lastSequenceLength = sequenceLength;
        // Update glue's variable here
        this.glue.editor1.updateContent(newValue);
        this.glue.semanticSolutionReady = false;
      });
    }

    setTimeout(() => this.restoreWorkspaceState(), 0);
  }

  ngOnDestroy(): void {
    this.saveWorkspaceState();
  }

  handlePostProcessing(mode: 'inline' | 'standalone'): void {
    const syntax = this.liger?.structureJson ?? null;
    const semanticStructure = this.currentSemanticStructure();

    if (!syntax || !semanticStructure || this.postProcessingLoading) {
      return;
    }

    this.postProcessingLoading = true;
    this.dataService.ligerMergeStructure({
      syntax,
      drs: semanticStructure,
    }).subscribe(response => {
      const structureJson = typeof response?.structureJson === 'string'
        ? response.structureJson
        : JSON.stringify(response?.structureJson ?? {}, null, 2);

      this.postProcessingLoading = false;

      if (mode === 'standalone') {
        this.router.navigate(['/graph-inspector'], {
          state: {
            uploadedContent: structureJson,
            uploadedFormat: 'json',
            uploadedFileName: 'merged-graph.json',
            graphElements: response.graph?.graphElements ?? [],
          }
        });
        return;
      }

      this.mergedStructureContent = structureJson;
      this.mergedStructureFileName = 'merged-graph.json';
      this.mergedGraphElements = response.graph?.graphElements ?? [];
      this.pcdrsSolutions = [];
      this.pcdrsDisplaySolutions = [];
      this.collapsedPcdrsById = {};
      this.showCollapsedAnaphora = false;
      this.showInlinePostProcessing = true;
      setTimeout(() => this.postProcessingSection?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    }, () => {
      this.postProcessingLoading = false;
    });
  }

  openMergedGraphInspector(): void {
    this.handlePostProcessing('standalone');
  }

  generatePcdrs(): void {
    const selected = this.selectedSemanticSolution();
    const structureContent = this.currentPostProcessedStructureContent();
    if (!selected?.semantic || !structureContent || this.pcdrsLoading) {
      return;
    }

    let mergedStructure: any;
    try {
      mergedStructure = JSON.parse(structureContent);
    } catch {
      return;
    }

    this.pcdrsLoading = true;
    this.dataService.gswbGeneratePcdrs({
      semantic: selected.semantic,
      parentSolutionId: selected.id,
      mergedStructure,
    }).subscribe(response => {
      this.pcdrsLoading = false;
      this.pcdrsSolutions = response?.solutions ?? [];
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
      && !!this.selectedSemanticSolution()?.semantic;
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
    return betaReduce === true && !!this.liger?.structureJson && !!this.currentSemanticStructure();
  }

  hasGswbSemanticSolution(): boolean {
    if (!this.glue?.semanticSolutionReady) {
      return false;
    }
    const solutions = this.glue.semvis?.items;
    return Array.isArray(solutions) && solutions.some(solution =>
      typeof solution?.semantic === 'string' && solution.semantic.trim().length > 0);
  }

  private currentSemanticStructure(): LigerStructure | null {
    const selected = this.selectedSemanticSolution();

    return selected?.graph ?? null;
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
