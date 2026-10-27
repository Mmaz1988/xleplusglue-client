import { Component, ViewChild, AfterViewInit, OnDestroy, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import {LigerVisComponent} from "../liger-vis/liger-vis.component";
import {GswbVisComponent} from "../gswb-vis/gswb-vis.component";
import { DataService } from '../data.service';
import { MISSING_PRAGMATICS_MESSAGE, AnaphoraRankerSelection, AnaphoraRanking, DiscourseUpdate, GswbProofInput, GswbSolution, LigerRuleAnnotation, LigerRuleAnnotationResponse, LigerStructure, persistedAnalysisDocument, SentenceAnalysis, SequenceAnalysis, VampirePreferences, XlePlusGlueDocument } from '../models/models';
import { LigerWorkspaceService } from '../liger-workspace/liger-workspace.service';
import { AnalysisWorkspaceStateService } from '../analysis-workspace-state.service';
import { GraphInspectorComponent } from '../graph-inspector/graph-inspector.component';
import { APP_DEFAULTS } from '../app-defaults';
import { AnaphoraRankingTable, anaphoraRankerSelection, anaphoraRankingCaption, anaphoraRankingTable, carryAnaphoraRanking, needsAnaphoraRanking, validateAnalysisDocument } from '../analysis-model';
import { AnaphoraRankingResult, AnaphoraRankingService } from '../reasoning/anaphora-ranking.service';
import { DocumentBuilderService } from '../document-builder/document-builder.service';
import { discourseUpdateOf } from '../document-builder/pcdrs-readings';
import { DEFAULT_READING_SELECTION, ReadingOrderContext, ReadingSelection, normalizedReadingSelection } from '../reading-order';

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
  styleUrls: ['./glue-interface.component.css'],
  // Its boxes (editors, graphs, the rule set, semantics) fill their column rather than
  // keeping stand-alone pixel sizes; see ANALYSIS_LAYOUT_PLAN.md.
  host: { class: 'fluid-boxes' },
})
export class GlueInterfaceComponent implements AfterViewInit, OnDestroy {

  @ViewChild('l1') liger: LigerVisComponent;
  @ViewChild('g1') glue: GswbVisComponent;
  @ViewChild('postProcessingSection') postProcessingSection?: ElementRef<HTMLElement>;
  @ViewChild('pcdrsResults') pcdrsResults?: ElementRef<HTMLElement>;
  @ViewChild(GraphInspectorComponent) inlineGraphInspector?: GraphInspectorComponent;

  isFirstDivMinimized = false;
  isSecondDivMinimized = false;
  showInlinePostProcessing = false;
  postProcessingLoading = false;
  pcdrsLoading = false;
  mergedStructureContent = '';
  mergedStructureFileName = 'merged-graph.json';
  mergedGraphElements: any[] = [];
  postProcessingResults: PostProcessingResult[] = [];
  postProcessingResultsReady = false;
  selectedPostProcessingIndex = 0;
  rulesApplicationLoading = false;
  pcdrsSolutions: GswbSolution[] = [];
  pcdrsDisplaySolutions: GswbSolution[] = [];
  /** Captions for pcdrsDisplaySolutions, index-aligned: rank, score and each binding's cosine. */
  pcdrsDisplayLabels: string[] = [];
  pcdrsDisplayRankings: (AnaphoraRankingTable | null)[] = [];
  /** The discourse update the shown PCDRS solutions belong to. */
  pcdrsUpdateId: string | null = null;
  /** What the sem view orders and filters the shown PCDRS with (N4); set with them, so the
   *  view gets a new one only when they change. */
  pcdrsReadingOrder: ReadingOrderContext | null = null;
  /** The shown discourse's reading selection (N4 6d): its own, else the built-in default.
   *  Display and storage only, analysis has no Vampire. */
  pcdrsReadingSelection: { selection: ReadingSelection; own: boolean } | null = null;
  /** Latest ranking outcome per discourse update id; 'pending' while lm is working. */
  anaphoraRankingStatus: Record<string, AnaphoraRankingResult | { status: 'pending' }> = {};
  /** The anaphora rankers this view ranks with: the same preferences fields as regression's and
   *  chat's Vampire settings, held here because analysis has no Vampire settings. */
  anaphoraRankerPreferences: Pick<VampirePreferences, 'anaphora_rankers' | 'anaphora_averager'> = {
    anaphora_rankers: [...APP_DEFAULTS.anaphoraRanking.rankers],
    anaphora_averager: APP_DEFAULTS.anaphoraRanking.averager,
  };
  private lastSequenceLength = 0;
  private sentenceAnalyses: SentenceAnalysis[] = [];
  private sequenceAnalyses: SequenceAnalysis[] = [];
  previousSentenceAnalyses: SentenceAnalysis[] = [];
  previousSequenceAnalyses: SequenceAnalysis[] = [];
  private analysisDocumentSessionKey = this.newAnalysisSessionKey();
  private analysisDocument: XlePlusGlueDocument = this.documentBuilder.newDocument(this.analysisDocumentSessionKey, 'lfgxdrt');
  private pendingDocumentSave: XlePlusGlueDocument | null = null;
  private documentSaveInProgress = false;

  constructor(
    private router: Router,
    private dataService: DataService,
    private workspaceState: AnalysisWorkspaceStateService,
    private documentBuilder: DocumentBuilderService,
    private anaphoraRanking: AnaphoraRankingService,
    private ligerWorkspace: LigerWorkspaceService,
  ) {}

  get analysisDocumentSessionId(): string {
    return this.analysisDocumentSessionKey;
  }

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
        this.tryUpsertSentenceAnalyses(
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
        this.documentBuilder.upsertSequenceAnalyses(this.analysisDocument, snapshots);
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
        this.tryUpsertSentenceAnalyses(analyses);
        console.info('[Analysis] canonical sentence analyses updated', {
          count: analyses.length,
          analyses: analyses.map(analysis => ({ id: analysis.id, text: analysis.text })),
        });
      });
      this.liger.discourseReset.subscribe(() => {
        // A fresh "Parse and rewrite" IS starting a new discourse by design -- no
        // separate action should be required. Reset the document/gswb-vis side only;
        // liger's own state was just correctly set by the parse that triggered this and
        // must not be wiped (see docs/plans/DOCUMENT_BUILDER_UNIFICATION_PLAN.md).
        this.resetDocumentForNewDiscourse();
        this.glue?.resetForNewDiscourse();
        console.info('[Analysis] new discourse started automatically by Parse and rewrite', {
          sessionKey: this.analysisDocumentSessionKey,
        });
      });
    }

    setTimeout(() => this.restoreWorkspaceState(), 0);
  }

  private newAnalysisSessionKey(): string {
    const random = Math.random().toString(36).slice(2, 10);
    return `analysis-${Date.now()}-${random}`;
  }

  /** Manual escape hatch: fully resets the document AND both child views' in-progress
   *  parse/semantic state, including anything typed but not yet parsed. Not the primary
   *  mechanism for starting a new discourse -- a fresh "Parse and rewrite" already does
   *  that automatically (see the `liger.discourseReset` subscription in
   *  `ngAfterViewInit`, and `resetDocumentForNewDiscourse` below) -- this button exists
   *  for clearing state without necessarily typing a new sentence right away. */
  startNewDiscourse(): void {
    this.resetDocumentForNewDiscourse();
    this.liger?.resetForNewDiscourse();
    this.glue?.resetForNewDiscourse();
    console.info('[Analysis] started new discourse (manual)', { sessionKey: this.analysisDocumentSessionKey });
  }

  /** The document/local-state half of starting a new discourse: clears the old volatile
   *  Redis document, mints a new session key/document, and resets every piece of local
   *  state that would otherwise let a new discourse's sentence ids collide with the old
   *  discourse's (see docs/plans/DOCUMENT_BUILDER_UNIFICATION_PLAN.md, "starting a new
   *  discourse does not reset the document" -- glue-interface previously had no reset
   *  path at all, so a second discourse's `sentence-1` silently merged into the first's).
   *  Deliberately does NOT touch `liger`'s own component state -- callers that are
   *  reacting to a parse already in progress (the automatic path) must not wipe out
   *  what that parse just legitimately set. */
  private resetDocumentForNewDiscourse(): void {
    this.dataService.clearAnalysisDocument(this.analysisDocumentSessionKey).subscribe({
      error: error => console.warn('[Analysis] could not clear volatile Redis document', error),
    });
    this.analysisDocumentSessionKey = this.newAnalysisSessionKey();
    this.analysisDocument = this.documentBuilder.newDocument(this.analysisDocumentSessionKey, 'lfgxdrt');
    this.pendingDocumentSave = null;
    this.documentSaveInProgress = false;

    this.sentenceAnalyses = [];
    this.sequenceAnalyses = [];
    this.previousSentenceAnalyses = [];
    this.previousSequenceAnalyses = [];
    this.lastSequenceLength = 0;

    this.postProcessingResults = [];
    this.postProcessingResultsReady = false;
    this.selectedPostProcessingIndex = 0;
    this.showInlinePostProcessing = false;
    this.mergedStructureContent = '';
    this.mergedGraphElements = [];
    this.pcdrsSolutions = [];
    this.pcdrsDisplaySolutions = [];
    this.pcdrsDisplayLabels = [];
    this.pcdrsDisplayRankings = [];
    this.pcdrsUpdateId = null;
    this.anaphoraRankingStatus = {};
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

  /** Thin wrapper around DocumentBuilderService.upsertSentenceAnalyses: that call now
   *  throws if an incoming sentence's text disagrees with an already-registered sentence
   *  under the same id (see its doc comment) -- a signal that the document was never
   *  reset for a new discourse. Caught and surfaced loudly here rather than left to
   *  crash the subscription it's called from, since a live document-corruption bug is
   *  more useful reported than silently swallowed. */
  private tryUpsertSentenceAnalyses(analyses: SentenceAnalysis[], persist = true): void {
    try {
      this.documentBuilder.upsertSentenceAnalyses(this.analysisDocument, analyses);
    } catch (error) {
      console.error('[Analysis] could not register sentence analyses', error);
      return;
    }
    if (persist) {
      this.persistAnalysisDocument();
    }
  }

  private discourseUpdateFor(sourceElementId: string): DiscourseUpdate | undefined {
    return this.analysisDocument.discourseUpdates?.find(update => update.sourceElementId === sourceElementId);
  }

  private discourseUpdateContaining(discourseId: string): DiscourseUpdate | undefined {
    return this.analysisDocument.discourseUpdates?.find(update =>
      update.discourse.some(discourse => discourse.id === discourseId));
  }

  private upsertDiscourseUpdate(update: DiscourseUpdate): void {
    const rankers = this.anaphoraRankers();
    const stored = carryAnaphoraRanking(this.discourseUpdateById(update.id), update, rankers);
    this.storeDiscourseUpdate(stored);
    if (needsAnaphoraRanking(stored, rankers)) {
      this.rankDiscourseUpdate(stored);
    }
  }

  private storeDiscourseUpdate(update: DiscourseUpdate): void {
    this.analysisDocument.discourseUpdates = [
      ...(this.analysisDocument.discourseUpdates ?? []).filter(existing => existing.id !== update.id),
      update,
    ];
    this.persistAnalysisDocument();
  }

  private anaphoraRankers(): AnaphoraRankerSelection {
    return anaphoraRankerSelection(this.anaphoraRankerPreferences);
  }

  /** A changed ranker selection re-ranks the stored discourse updates right away: this view
   *  shows their rankings, and an lm call per update is cheap here. */
  onAnaphoraRankersChange(selection: AnaphoraRankerSelection): void {
    this.anaphoraRankerPreferences = { anaphora_rankers: selection.rankers, anaphora_averager: selection.averager };
    (this.analysisDocument.discourseUpdates ?? [])
      .filter(update => needsAnaphoraRanking(update, selection) && this.anaphoraRankingStatus[update.id]?.status !== 'pending')
      .forEach(update => this.rankDiscourseUpdate(update));
  }

  /** Stored first, ranked afterwards: nothing here waits for lm, and an unavailable lm only
   *  leaves the update unranked. */
  private rankDiscourseUpdate(update: DiscourseUpdate): void {
    this.anaphoraRankingStatus[update.id] = { status: 'pending' };
    const asked = this.anaphoraRankers();
    this.anaphoraRanking.rankAndAttach(() => this.analysisDocument, update, asked).subscribe(({ result, update: ranked }) => {
      this.anaphoraRankingStatus[update.id] = result;
      if (ranked) {
        // Stored as lm answered, never re-requested on its account: a ranking that does not
        // match what was asked (an older lm) would otherwise be requested again forever.
        this.storeDiscourseUpdate(ranked);
        const current = this.anaphoraRankers();
        if (JSON.stringify(current) !== JSON.stringify(asked)) {
          // The selection changed while lm was working.
          this.rankDiscourseUpdate(ranked);
        }
      }
      this.refreshPcdrsDisplay();
    });
  }

  private discourseUpdateById(id: string): DiscourseUpdate | undefined {
    return this.analysisDocument.discourseUpdates?.find(update => update.id === id);
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
    // Narrowed the same way chat and regression narrow theirs, so the three surfaces keep
    // producing one stored shape.
    this.dataService.saveAnalysisDocument(this.analysisDocumentSessionKey, persistedAnalysisDocument(document)).subscribe({
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

    if (!semanticSolutions.length || this.postProcessingLoading || this.postProcessingBlockedReason()) {
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
      drs: semanticSolution.semanticAnalysis?.graph as LigerStructure,
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

      // No DiscourseUpdate is written here. This step produces tier A -- merged syntax and
      // merged semantics co-present but unlinked -- which is a derived join over the
      // element's own stored syntax and semantics and carries no pragmatic content of its
      // own. The discourse layer for this element starts at generatePcdrs().

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
      this.pcdrsDisplayLabels = [];
    this.pcdrsDisplayRankings = [];
      this.pcdrsUpdateId = null;
      this.showInlinePostProcessing = true;
      setTimeout(() => this.postProcessingSection?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    }, () => {
      this.postProcessingLoading = false;
      this.postProcessingResultsReady = false;
      this.postProcessingResults = [];
    });
  }

  /** The structure of the syntax THIS reading came from. A sequence's analysis holds every
   *  parse pairing of its sentences, and the reading's SRC ids only line up with the
   *  SYN-IDs of its own: joined against another pairing's structure, post-processing links
   *  referents to the wrong words ("it was cute": the pronoun's referent to "be"). */
  private syntaxForSolution(solution: GswbSolution): LigerStructure | null {
    const analysis = solution.sequenceAnalysis ?? solution.sentenceAnalysis;
    if (!analysis) {
      return this.liger?.structureJson ?? null;
    }
    const semId = solution.semanticAnalysis?.semId ?? solution.id;
    const origin = analysis.semantics.find(semantic => semantic.semId === semId)?.syntacticOrigin;
    const own = analysis.syntax.find(syntax => syntax.synId === origin)
      ?? (analysis.syntax.length === 1 ? analysis.syntax[0] : undefined);
    if (!own) {
      console.error('[Analysis] cannot tell which syntax a reading came from; not guessing one', {
        solutionId: solution.id, semId, origin, syntaxIds: analysis.syntax.map(syntax => syntax.synId),
      });
      return null;
    }
    return own.structure;
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
      this.pcdrsDisplayLabels = [];
    this.pcdrsDisplayRankings = [];
      this.pcdrsUpdateId = null;
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
        // Records the rule text and nothing else. The tier-B structures these rules just
        // produced are not persisted: they exist to give the anaphora rules SYNSEM edges to
        // gate on, cannot be reused by a later discourse update, and are recomputable from
        // this element's stored syntax and semantics. The rule string is what makes that
        // recomputation reproducible, so it is the part worth keeping.
        const existingUpdate = this.discourseUpdateFor(sourceElement.id);
        this.upsertDiscourseUpdate({
          id: `du-${sourceElement.id}`,
          sourceElementId: sourceElement.id,
          sourceElementKind: 'sentenceIds' in sourceElement ? 'sequence' : 'sentence',
          ruleString,
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
      const deleted = responses.map(result => result?.failureMessage).filter((message): message is string => !!message);
      if (typeof this.inlineGraphInspector?.displayMessage === 'function') {
        this.inlineGraphInspector.displayMessage(deleted.length
          ? `Rules applied; no reading left: ${deleted.join('; ')}` : 'Rules applied.', deleted.length ? 'red' : 'green');
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
        return selected?.semanticAnalysis?.semString && structure
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
    this.documentBuilder.generatePcdrsReadings({
      scopeId: 'analysis-pcdrs',
      branches: candidates.map(candidate => ({
        semantic: candidate.result.semanticSolution.semanticAnalysis?.semString ?? '',
        semanticOrigin: candidate.result.semanticSolution.id,
        structure: candidate.annotation.structureJson as LigerStructure,
        parentSolutionId: this.postProcessingResults.length
          ? `${candidate.result.semanticSolution.id}-graph-${candidate.graphIndex + 1}-rule-${candidate.annotationIndex + 1}`
          : candidate.result.semanticSolution.id,
        // 1-based, matching the parentSolutionId. The no-rules fallback builds exactly one
        // candidate, so it is branch 1 -- chat and regression number their branches the
        // same way, which is what keeps the three documents comparable.
        ruleBranchIndex: candidate.annotationIndex + 1,
        rulesApplied: candidate.result.rulesApplied,
      })),
      // The analysis view shows every reading.
      includeSvg: true,
    }).subscribe(readings => {
      this.pcdrsLoading = false;
      this.pcdrsSolutions = readings.map(({ mapping }) => mapping as GswbSolution);
      this.pcdrsUpdateId = null;

      const sourceElement = candidates
        .map(candidate => candidate.result.semanticSolution.sequenceAnalysis ?? candidate.result.semanticSolution.sentenceAnalysis)
        .find((analysis): analysis is SentenceAnalysis | SequenceAnalysis => !!analysis);
      if (sourceElement) {
        const update = discourseUpdateOf(
          { id: sourceElement.id, kind: 'sentenceIds' in sourceElement ? 'sequence' : 'sentence' },
          readings,
          this.discourseUpdateFor(sourceElement.id)?.ruleString);
        this.pcdrsUpdateId = update.id;
        this.upsertDiscourseUpdate(update);
      }

      this.refreshPcdrsDisplay();
      this.focusPcdrsResults();
    }, error => {
      // Every reading the rules allow may be rejected by the collapse: the error says why.
      console.warn('[Analysis] PCDRS generation failed', { error });
      this.pcdrsLoading = false;
      this.pcdrsSolutions = [];
      this.pcdrsUpdateId = null;
      this.refreshPcdrsDisplay();
      if (typeof this.inlineGraphInspector?.displayMessage === 'function') {
        this.inlineGraphInspector.displayMessage(error?.message ?? String(error), 'red');
      }
    });
  }

  canGeneratePcdrs(): boolean {
    return this.showInlinePostProcessing
      && !!this.currentPostProcessedStructureContent()
      && !this.rulesApplicationLoading
      && (this.postProcessingResults.length > 0 || !!this.selectedSemanticSolution()?.semanticAnalysis?.semString);
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

  /** Why post-processing is blocked even with a semantic solution: pragmatics rules are
   *  what post-processing runs, and the loaded rule set may list none (a single rule file
   *  never does). Null while nothing blocks it. */
  postProcessingBlockedReason(): string | null {
    return this.ligerWorkspace.pragmatics?.trim() ? null : MISSING_PRAGMATICS_MESSAGE;
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
    return Array.isArray(solutions) && solutions.some(solution => !!solution?.semanticAnalysis?.semString?.trim());
  }

  private semanticSolutionsForPostProcessing(): GswbSolution[] {
    const semvis = this.glue?.semvis;
    if (!semvis) {
      return [];
    }

    const hasDiscriminantSelection = (semvis.selectedScopeIds?.length ?? 0) > 0
      || (semvis.selectedMcIds?.length ?? 0) > 0;
    const solutions = hasDiscriminantSelection ? semvis.items : (semvis.allItems ?? semvis.items);
    // Derived or merged readings only (the list can also hold gswb-vis's "no solutions" note).
    return (Array.isArray(solutions) ? solutions : []).filter(solution => !!solution?.semanticAnalysis?.graph);
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

  private refreshPcdrsDisplay(): void {
    const update = this.pcdrsUpdateId ? this.discourseUpdateById(this.pcdrsUpdateId) : undefined;
    // In generation order: the sem view orders them (its options), and collapsing is its own
    // view of these items too (Collapse, then a toggle).
    this.pcdrsDisplaySolutions = this.pcdrsSolutions;
    this.pcdrsDisplayLabels = this.pcdrsSolutions.map(solution => update ? anaphoraRankingCaption(update, solution.id) : '');
    this.pcdrsDisplayRankings = this.pcdrsSolutions.map(solution => update ? anaphoraRankingTable(update, solution.id) : null);
    this.pcdrsReadingOrder = update ? {
      updates: [update],
      discriminants: this.analysisDocument.sentences.flatMap(sentence => sentence.discriminants ?? []),
      averager: this.anaphoraRankers().averager,
    } : null;
    this.pcdrsReadingSelection = update ? this.readingSelectionOf(update) : null;
  }

  private readingSelectionOf(update: DiscourseUpdate): { selection: ReadingSelection; own: boolean } {
    return update.readingSelection
      ? { selection: normalizedReadingSelection(update.readingSelection), own: true }
      : { selection: { ...DEFAULT_READING_SELECTION }, own: false };
  }

  /** Stores a sem-view change with the shown discourse (null: back to the default). */
  onPcdrsReadingSelectionChange(selection: ReadingSelection | null): void {
    const update = this.pcdrsUpdateId ? this.discourseUpdateById(this.pcdrsUpdateId) : undefined;
    if (!update) return;
    if (selection) {
      update.readingSelection = normalizedReadingSelection(selection);
    } else {
      delete update.readingSelection;
    }
    this.pcdrsReadingSelection = this.readingSelectionOf(update);
    this.persistAnalysisDocument();
  }

  private currentPcdrsRanking(): AnaphoraRanking | undefined {
    return this.pcdrsUpdateId ? this.discourseUpdateById(this.pcdrsUpdateId)?.anaphoraRanking : undefined;
  }

  /** What the PCDRS header says about the ranking of the shown solutions. */
  pcdrsRankingStatusText(): string {
    const status = this.pcdrsUpdateId ? this.anaphoraRankingStatus[this.pcdrsUpdateId] : undefined;
    const ranking = this.currentPcdrsRanking();
    if (ranking) {
      return `Ranked by ${ranking.model} (${ranking.method})`;
    }
    switch (status?.status) {
      case 'pending': return 'Ranking with the language model…';
      case 'unavailable': return `Ranking unavailable: ${status.reason}.`;
      case 'not-applicable': return `Not ranked: ${status.reason}.`;
      default: return '';
    }
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
