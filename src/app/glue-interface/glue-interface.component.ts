import { Component, ViewChild, AfterViewInit, OnDestroy, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import {LigerVisComponent} from "../liger-vis/liger-vis.component";
import {GswbVisComponent} from "../gswb-vis/gswb-vis.component";
import { DataService } from '../data.service';
import { DiscourseAnalysis, DiscourseUpdate, GswbProofInput, GswbSolution, LigerRuleAnnotation, LigerRuleAnnotationResponse, LigerStructure, SemDiscourseMapping, SentenceAnalysis, SequenceAnalysis, XlePlusGlueDocument, XlePlusGlueElementRef } from '../models/models';
import { AnalysisWorkspaceStateService } from '../analysis-workspace-state.service';
import { GraphInspectorComponent } from '../graph-inspector/graph-inspector.component';
import { SemVisComponent } from '../sem-vis/sem-vis.component';
import { discourseStructureId, validateAnalysisDocument } from '../analysis-model';

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
  private lastSequenceLength = 0;
  private sentenceAnalyses: SentenceAnalysis[] = [];
  private sequenceAnalyses: SequenceAnalysis[] = [];
  previousSentenceAnalyses: SentenceAnalysis[] = [];
  previousSequenceAnalyses: SequenceAnalysis[] = [];
  private readonly analysisDocumentSessionKey = this.newAnalysisSessionKey();
  private analysisDocument: XlePlusGlueDocument = this.newAnalysisDocument();
  private pendingDocumentSave: XlePlusGlueDocument | null = null;
  private documentSaveInProgress = false;

  constructor(private router: Router, private dataService: DataService, private workspaceState: AnalysisWorkspaceStateService) {}

  /** Canonical, always-fully-enriched sentence registry, passed to <app-gswb-vis> so it
   *  can resolve a SequenceAnalysis's sentenceIds without embedding stale copies. */
  get knownSentences(): SentenceAnalysis[] {
    return this.analysisDocument.sentences;
  }

  ngAfterViewInit() {
    this.dataService.clearAnalysisDocument(this.analysisDocumentSessionKey).subscribe({
      next: () => console.info('[Analysis] cleared volatile Redis document for new session'),
      error: error => console.warn('[Analysis] could not clear volatile Redis document', error),
    });
    if (this.liger?.changeDetector && this.glue?.editor1) {
      this.liger.changeDetector.subscribe(newValue => {
        const sequenceLength = this.liger.sequenceSentences.length;
        if (sequenceLength <= 1) {
          this.previousSentenceAnalyses = [];
          this.previousSequenceAnalyses = [];
        } else if (sequenceLength !== this.lastSequenceLength) {
          this.previousSequenceAnalyses = this.sequenceAnalyses;
          this.previousSentenceAnalyses = this.sentenceAnalyses;
          console.info('[Analysis] captured previous semantic context before sequence append', {
            previousSequenceLength: this.lastSequenceLength,
            newSequenceLength: sequenceLength,
            previousSentenceCount: this.previousSentenceAnalyses.length,
            previousSequenceCount: this.previousSequenceAnalyses.length,
            previousSentences: this.previousSentenceAnalyses.map(analysis => analysis.text),
            previousSequenceSentences: this.previousSequenceAnalyses.map(analysis => analysis.text),
          });
        }
        this.lastSequenceLength = sequenceLength;
        // Update glue's variable here
        this.glue.editor1.updateContent(newValue);
        this.glue.semanticSolutionReady = false;
      });
      this.liger.proofInputChange.subscribe((proofInputs: GswbProofInput[]) => {
        this.glue.setProofInputs(proofInputs);
        this.upsertSentenceAnalyses(
          proofInputs.map(input => input.sentenceAnalysis).filter((analysis): analysis is SentenceAnalysis => !!analysis)
        );
        console.info('[Analysis] updated GSWB proof inputs from LiGER', {
          proofCount: proofInputs.length,
          proofInputs: proofInputs.map(input => ({
            proofId: input.proofId,
            solutionKey: input.solutionKey,
            mcSetId: input.mcSetId,
            sentence: input.sentenceAnalysis?.text ?? input.sequenceAnalysis?.text,
            meaningConstructorsLength: input.meaningConstructors?.length ?? 0,
            structureConstraints: input.structure?.constraints?.length ?? 0,
            structureAnnotations: input.structure?.annotations?.length ?? 0,
          })),
        });
      });
      this.glue.sequenceAnalysisChange.subscribe((analyses: SequenceAnalysis[]) => {
        const snapshots = analyses.map(analysis => this.snapshotSequenceAnalysis(analysis));
        this.sequenceAnalyses = snapshots;
        snapshots[0] && this.liger.displaySequenceAnalysis(snapshots[0]);
        this.upsertSequenceAnalyses(snapshots);
        this.persistAnalysisDocument();
        console.info('[Analysis] canonical sequence analyses updated', {
          count: analyses.length,
          analyses: snapshots.map(analysis => ({
            id: analysis.id,
            text: analysis.text,
            sentenceCount: analysis.sentenceIds.length,
            syntaxCount: analysis.syntax.length,
            semanticCount: analysis.semantics.length,
            mapping: analysis.synSemMapping,
          })),
        });
      });
      this.glue.sentenceAnalysisChange.subscribe((analyses: SentenceAnalysis[]) => {
        this.sentenceAnalyses = analyses;
        this.upsertSentenceAnalyses(analyses);
        console.info('[Analysis] canonical sentence analyses updated', {
          count: analyses.length,
          analyses: analyses.map(analysis => ({ id: analysis.id, text: analysis.text })),
        });
      });
    }

    setTimeout(() => this.restoreWorkspaceState(), 0);
  }

  private newAnalysisDocument(): XlePlusGlueDocument {
    return {
      id: this.analysisDocumentSessionKey,
      semanticType: 'lfgxdrt',
      sentences: [],
      sequences: [],
      elements: [],
    };
  }

  private newAnalysisSessionKey(): string {
    const random = Math.random().toString(36).slice(2, 10);
    return `analysis-${Date.now()}-${random}`;
  }

  private snapshotSequenceAnalysis(analysis: SequenceAnalysis): SequenceAnalysis {
    return {
      ...analysis,
      sentenceIds: [...analysis.sentenceIds],
      syntax: [...analysis.syntax],
      semantics: [...analysis.semantics],
      synSemMapping: Object.fromEntries(
        Object.entries(analysis.synSemMapping).map(([syntaxId, semanticIds]) => [syntaxId, [...semanticIds]])
      ),
    };
  }

  private upsertSentenceAnalyses(analyses: SentenceAnalysis[], persist = true): void {
    analyses.forEach(incoming => {
      const existing = this.analysisDocument.sentences.find(sentence => sentence.id === incoming.id);
      if (!existing) {
        this.analysisDocument.sentences.push({
          ...incoming,
          syntax: [...incoming.syntax],
          semantics: [...incoming.semantics],
          synSemMapping: { ...incoming.synSemMapping },
          discriminants: [...(incoming.discriminants ?? [])],
          selectedSemanticIds: [...(incoming.selectedSemanticIds ?? incoming.semantics.map(semantic => semantic.semId))],
          selectedScopeIds: [...(incoming.selectedScopeIds ?? [])],
          selectedMcIds: [...(incoming.selectedMcIds ?? [])],
        });
        this.upsertElementRef({ kind: 'sentence', id: incoming.id });
        this.analysisDocument.activeElementId = incoming.id;
        return;
      }

      existing.syntax = this.mergeById(existing.syntax, incoming.syntax, item => item.synId);
      existing.semantics = this.mergeById(existing.semantics, incoming.semantics, item => item.semId);
      existing.discriminants = [...(incoming.discriminants ?? existing.discriminants ?? [])];
      existing.selectedSemanticIds = [...(incoming.selectedSemanticIds ?? existing.selectedSemanticIds ?? [])];
      existing.selectedScopeIds = [...(incoming.selectedScopeIds ?? existing.selectedScopeIds ?? [])];
      existing.selectedMcIds = [...(incoming.selectedMcIds ?? existing.selectedMcIds ?? [])];
      Object.entries(incoming.synSemMapping).forEach(([syntaxId, semanticIds]) => {
        existing.synSemMapping[syntaxId] = Array.from(new Set([
          ...(existing.synSemMapping[syntaxId] ?? []),
          ...semanticIds,
        ]));
      });
      // No `elements` write needed: the ref for `existing.id` already occupies the right
      // position and never changes -- only the registry entry's own fields are mutated.
    });
    if (persist) {
      this.persistAnalysisDocument();
    }
  }

  /** Upserts sequences into the canonical `sequences` registry by id, preserving each
   *  sequence's position on update (matching sentence-upsert semantics) rather than
   *  moving it to the end of the timeline. */
  private upsertSequenceAnalyses(analyses: SequenceAnalysis[]): void {
    analyses.forEach(incoming => {
      const index = this.analysisDocument.sequences.findIndex(sequence => sequence.id === incoming.id);
      if (index === -1) {
        this.analysisDocument.sequences.push(incoming);
      } else {
        this.analysisDocument.sequences[index] = incoming;
      }
      this.upsertElementRef({ kind: 'sequence', id: incoming.id });
      this.analysisDocument.activeElementId = incoming.id;
    });
  }

  /** Appends a ref if this id isn't already registered in `elements`; a no-op otherwise,
   *  so callers can call it unconditionally on every upsert without disturbing the
   *  existing position of an already-registered sentence/sequence. */
  private upsertElementRef(ref: XlePlusGlueElementRef): void {
    if (!this.analysisDocument.elements.some(existingRef => existingRef.id === ref.id)) {
      this.analysisDocument.elements = [...this.analysisDocument.elements, ref];
    }
  }

  private mergeById<T>(existing: T[], incoming: T[], id: (item: T) => string): T[] {
    const merged = new Map(existing.map(item => [id(item), item]));
    incoming.forEach(item => merged.set(id(item), item));
    return Array.from(merged.values());
  }

  private discourseUpdateFor(sourceElementId: string): DiscourseUpdate | undefined {
    return this.analysisDocument.discourseUpdates?.find(update => update.sourceElementId === sourceElementId);
  }

  private discourseUpdateContaining(discourseId: string): DiscourseUpdate | undefined {
    return this.analysisDocument.discourseUpdates?.find(update =>
      update.discourse.some(discourse => discourse.id === discourseId));
  }

  private upsertDiscourseUpdate(update: DiscourseUpdate): void {
    this.analysisDocument.discourseUpdates = [
      ...(this.analysisDocument.discourseUpdates ?? []).filter(existing => existing.id !== update.id),
      update,
    ];
    this.persistAnalysisDocument();
  }

  private persistAnalysisDocument(): void {
    try {
      validateAnalysisDocument(this.analysisDocument);
    } catch (error) {
      console.warn('[Analysis] document invariant failed before persistence', error);
    }
    this.pendingDocumentSave = JSON.parse(JSON.stringify(this.analysisDocument));
    if (this.documentSaveInProgress) return;
    this.saveNextAnalysisDocument();
  }

  /**
   * Dumps the current XlePlusGlueDocument (sentences, elements,
   * discourseUpdates) as a downloaded JSON file, alongside its current
   * validateAnalysisDocument() status -- for inspecting how the data model
   * evolves at each analysis step, independent of the Redis persistence path.
   */
  downloadDataModelSnapshot(): void {
    let validationError: string | null = null;
    try {
      validateAnalysisDocument(this.analysisDocument);
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error);
    }
    const snapshot = {
      capturedAt: new Date().toISOString(),
      sessionKey: this.analysisDocumentSessionKey,
      valid: validationError === null,
      validationError,
      document: this.analysisDocument,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `analysis-document-${Date.now()}.json`;
    link.click();
    setTimeout(() => window.URL.revokeObjectURL(url), 10000);
  }

  private saveNextAnalysisDocument(): void {
    if (!this.pendingDocumentSave) return;
    const document = this.pendingDocumentSave;
    this.pendingDocumentSave = null;
    this.documentSaveInProgress = true;
    this.dataService.saveAnalysisDocument(this.analysisDocumentSessionKey, document).subscribe({
      next: response => {
        this.analysisDocument.revision = response.document.revision;
        this.analysisDocument.createdAt = response.document.createdAt;
        this.analysisDocument.updatedAt = response.document.updatedAt;
      },
      error: error => {
        console.warn('[Analysis] could not persist volatile document', error);
        this.documentSaveInProgress = false;
        if (this.pendingDocumentSave) this.saveNextAnalysisDocument();
      },
      complete: () => {
        this.documentSaveInProgress = false;
        if (this.pendingDocumentSave) this.saveNextAnalysisDocument();
      },
    });
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

      const sourceElement = semanticSolutions
        .map(solution => solution.sequenceAnalysis ?? solution.sentenceAnalysis)
        .find((analysis): analysis is SentenceAnalysis | SequenceAnalysis => !!analysis);
      if (sourceElement) {
        const existingUpdate = this.discourseUpdateFor(sourceElement.id);
        const structures = { ...(existingUpdate?.structures ?? {}) };
        const mergedGraphs = { ...(existingUpdate?.mergedGraphs ?? {}) };
        responses.forEach((response, index) => {
          const semanticSolutionId = semanticSolutions[index].id;
          if (response?.structureJson) {
            structures[discourseStructureId(semanticSolutionId)] = response.structureJson as unknown as LigerStructure;
          }
          if (response?.graph) {
            mergedGraphs[discourseStructureId(semanticSolutionId)] = response.graph;
          }
        });
        this.upsertDiscourseUpdate({
          id: `du-${sourceElement.id}`,
          sourceElementId: sourceElement.id,
          sourceElementKind: 'sentenceIds' in sourceElement ? 'sequence' : 'sentence',
          ruleString: existingUpdate?.ruleString,
          structures,
          mergedGraphs,
          discourse: existingUpdate?.discourse ?? [],
          semDiscourseMapping: existingUpdate?.semDiscourseMapping ?? {},
        });
      }

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
    return solution.sequenceAnalysis?.syntax?.[0]?.structure
      ?? solution.sentenceAnalysis?.syntax?.[0]?.structure
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

      const sourceElement = this.postProcessingResults
        .map(result => result.semanticSolution.sequenceAnalysis ?? result.semanticSolution.sentenceAnalysis)
        .find((analysis): analysis is SentenceAnalysis | SequenceAnalysis => !!analysis);
      if (sourceElement) {
        const existingUpdate = this.discourseUpdateFor(sourceElement.id);
        const structures = { ...(existingUpdate?.structures ?? {}) };
        const mergedGraphs = { ...(existingUpdate?.mergedGraphs ?? {}) };
        this.postProcessingResults.forEach(result => {
          const semanticSolutionId = result.semanticSolution.id;
          result.ruleAnnotations.forEach((annotation, annotationIndex) => {
            // 1-based, matching the parentSolutionId sent to GSWB in generatePcdrs -- the two
            // used to disagree (structures 0-based, parentSolutionId 1-based), which made the
            // rule branch a given structure belonged to needlessly hard to read off.
            const structureId = discourseStructureId(semanticSolutionId, annotationIndex + 1);
            if (annotation?.structureJson) {
              structures[structureId] = annotation.structureJson;
            }
            if (annotation?.graph) {
              mergedGraphs[structureId] = annotation.graph;
            }
          });
        });
        this.upsertDiscourseUpdate({
          id: `du-${sourceElement.id}`,
          sourceElementId: sourceElement.id,
          sourceElementKind: 'sentenceIds' in sourceElement ? 'sequence' : 'sentence',
          ruleString,
          structures,
          mergedGraphs,
          discourse: existingUpdate?.discourse ?? [],
          semDiscourseMapping: existingUpdate?.semDiscourseMapping ?? {},
        });
      }

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

      const sourceElement = candidates
        .map(candidate => candidate.result.semanticSolution.sequenceAnalysis ?? candidate.result.semanticSolution.sentenceAnalysis)
        .find((analysis): analysis is SentenceAnalysis | SequenceAnalysis => !!analysis);
      if (sourceElement) {
        const existingUpdate = this.discourseUpdateFor(sourceElement.id);
        const structures = { ...(existingUpdate?.structures ?? {}) };
        const semDiscourseMapping: SemDiscourseMapping = {};
        const discourse: DiscourseAnalysis[] = [];
        candidates.forEach((candidate, candidateIndex) => {
          const semanticSolutionId = candidate.result.semanticSolution.id;
          // Rule-applied candidates were already stored by onRulesApplied under this key (tier B,
          // the interconnected structure); the no-rules fallback candidate reuses the tier-A
          // union stored by handlePostProcessing, since without rules there is no tier B.
          const structureId = candidate.result.rulesApplied
            ? discourseStructureId(semanticSolutionId, candidate.annotationIndex + 1)
            : discourseStructureId(semanticSolutionId);
          if (!structures[structureId] && candidate.annotation.structureJson) {
            structures[structureId] = candidate.annotation.structureJson;
          }
          (responses[candidateIndex]?.solutions ?? []).forEach(solution => {
            discourse.push({
              id: solution.id,
              semanticOrigin: semanticSolutionId,
              drsString: solution.semantic ?? solution.solution,
              drsGraph: solution.graph,
              structureId,
              svg: solution.solution,
              anaphoraMapping: { relations: solution.anaphoraRelations ?? [] },
              collapsed: false,
            });
            semDiscourseMapping[semanticSolutionId] = [
              ...(semDiscourseMapping[semanticSolutionId] ?? []),
              solution.id,
            ];
          });
        });
        this.upsertDiscourseUpdate({
          id: `du-${sourceElement.id}`,
          sourceElementId: sourceElement.id,
          sourceElementKind: 'sentenceIds' in sourceElement ? 'sequence' : 'sentence',
          ruleString: existingUpdate?.ruleString,
          structures,
          mergedGraphs: existingUpdate?.mergedGraphs ?? {},
          discourse,
          semDiscourseMapping,
        });
      }

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

      const updatesById = new Map<string, DiscourseUpdate>();
      responses.forEach((response, index) => {
        if (!response) return;
        const discourseId = candidates[index].id;
        const update = updatesById.get(this.discourseUpdateContaining(discourseId)?.id ?? '')
          ?? this.discourseUpdateContaining(discourseId);
        if (!update) return;
        const discourse = update.discourse.map(entry => entry.id === discourseId
          ? {
              ...entry,
              drsString: response.semantic ?? entry.drsString,
              drsGraph: response.graph ?? entry.drsGraph,
              svg: response.solution ?? entry.svg,
              anaphoraMapping: { relations: response.anaphoraRelations ?? entry.anaphoraMapping.relations },
              collapsed: true,
            }
          : entry);
        updatesById.set(update.id, { ...update, discourse });
      });
      updatesById.forEach(update => this.upsertDiscourseUpdate(update));

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
