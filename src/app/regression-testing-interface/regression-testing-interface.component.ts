import { Component, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { DataService } from "../data.service";
import { proofInputsFrom } from '../document-builder/proof-inputs';
import { GraphVisComponent } from "../liger-vis/liger-graph-vis/graph-vis.component";
import { ActivatedRoute } from '@angular/router';
import {
  LigerRuleAnnotation,
  LigerStructure,
  GswbMultipleRequest,
  GswbBatchOutput,
  GswbOutput,
  GswbPreferences,
  GswbSolution,
  ReasoningCheckSet,
  ReasoningUpdate,
  SemanticAnalysis,
  AnaphoraMappingModel,
  DiscourseAnalysis,
  GswbProofInput,
  GswbRequest,
  LigerWebGraph,
  LigerSolutionAnnotationResponse,
  SentenceAnalysis,
  SequenceAnalysis,
  XlePlusGlueDocument,
  SynSemMapping,
  SyntacticAnalysis,
  RegressionInferenceResult,
  RegressionParseResult,
  RegressionSessionSummary,
  RegressionTestingSession,
  createRegressionAnalysisDocument,
  createRegressionTestingSession,
  regressionDocumentToSession,
  regressionSessionToDocument,
  RegressionSessionDocument,
  nliItem,
  vampireMultipleRequest,
  check,
  VampireSessionSummary
} from '../models/models';
import { GswbSettingsComponent } from "../gswb-vis/gswb-settings/gswb-settings.component";
import { EditorComponent } from "../editor/editor.component";
import { catchError, EMPTY, Observable, concatMap, forkJoin, finalize, from, timeout, map, of, switchMap, toArray } from "rxjs";
import { tap } from "rxjs/operators";
import { InferenceSettingsComponent } from "../inference-interface/inference-settings/inference-settings.component";
import {SemvisDialogComponent} from "../utilities/semvis-dialog/semvis-dialog.component";
import { APP_DEFAULTS } from '../app-defaults';
import {
  compositeAnalysisId,
  inferenceResultsFromDocument,
  majorityVerdict,
  parseReasoningAssignmentId,
  reasoningUpdateId,
  validateReasoningUpdate,
} from '../analysis-model';
import { PreparedReasoningPair, ReasoningPipelineService } from '../reasoning/reasoning-pipeline.service';
import { DocumentBuilderService, SequenceMergePreviousContext } from '../document-builder/document-builder.service';

/** One NLI item's premise/hypothesis sentence ids, in order, plus the update id every
 *  branch of its sequence build shares. */
type NliItemBuild = {
  itemId: string;
  updateId: string;
  premiseSentenceIds: string[];
  hypothesisSentenceIds: string[];
};

/** One reading-path through an NLI item's chained sequence build -- one selected
 *  reading of every sentence folded in so far, in order. `element`/`semantic` are the
 *  running prior fed to the NEXT `mergeSequence` rebase call; `sequenceStructure`/
 *  `merged` are the latest merge's own output, unset until at least one merge has run
 *  (i.e. until a second sentence has been folded in -- every item has at least a
 *  premise and a hypothesis, so both are always set by the time the chain completes). */
interface NliChainBranch {
  element: SentenceAnalysis | SequenceAnalysis;
  semantic: SemanticAnalysis;
  sentenceIdsSoFar: string[];
  sequenceStructure?: LigerStructure;
  merged?: GswbSolution;
  /** The running merged premises' own semantic text, captured once at the
   *  premise/hypothesis boundary -- the `Q` context axiom input, never re-derived once
   *  the hypothesis starts folding in. */
  premiseSemantic?: string;
  premiseSemanticIds: string[];
  hypothesisSemanticIds: string[];
  premiseAsts: LigerStructure[];
  hypothesisAsts: LigerStructure[];
}

type PreparedNliPair = PreparedReasoningPair & { itemId: string };

type ParsedRegressionRunSnapshot = {
  regressionTestItems: any[];
  regressionTestResults: RegressionParseResult[];
  inferenceResults: RegressionInferenceResult[];
  sentenceMap: Record<string, string>;
  annotations: Record<string, LigerSolutionAnnotationResponse> | null;
  gswbOutputs: Record<string, GswbOutput> | null;
};

@Component({
  selector: 'app-regression-testing-interface',
  templateUrl: './regression-testing-interface.component.html',
  styleUrls: ['./regression-testing-interface.component.css']
})
export class RegressionTestingInterfaceComponent implements AfterViewInit, OnDestroy {

  private readonly activeSessionStorageKey = 'regression-testing-active-session-key';

  constructor(
    private dataService: DataService,
    private route: ActivatedRoute,
    private reasoningPipeline: ReasoningPipelineService,
    private documentBuilder: DocumentBuilderService,
  ) {
    this.lastSavedSessionFingerprint = this.buildSessionFingerprint(regressionSessionToDocument(this.session));
  }

  session: RegressionTestingSession = this.createInitialSession();

  /** Branches of the last NLI preparation that could not be prepared at all, and those
   *  that were reasoned over only after dropping their anaphora binding. Run state, not
   *  session state: they describe the last preparation, not the stored analysis. */
  nliPreparationFailures: string[] = [];
  nliPreparationDegradations: string[] = [];

  /** The last preparation's assignments, kept until Vampire's verdicts come back so each
   *  verdict can be paired with the branch it was computed for, by the assignment id
   *  Vampire echoes. Not persisted -- the document is what gets stored. */
  private preparedNliPairs: PreparedNliPair[] = [];

  @ViewChild('arcy') cy1: GraphVisComponent;
  @ViewChild('ligerreport') ligerreport: ElementRef;
  @ViewChild('gswbreport') gswbreport: ElementRef;
  @ViewChild('gswbSettings') gswbPreferences: GswbSettingsComponent;

  @ViewChild('vampirePrefs') vampirePreferences!: InferenceSettingsComponent;
  @ViewChild('contextPruning') contextPruning!: ElementRef;
  @ViewChild('axiomEdit') axiomEdit: EditorComponent;

  @ViewChild('testfile') testfile: EditorComponent;
  @ViewChild('ligerRules') ligerRules: EditorComponent;
  @ViewChild('errorhandle') errorhandle: ElementRef;

  @ViewChild('semvisDialog') semvisDialog: SemvisDialogComponent;

  gswbMultipleRequest: GswbMultipleRequest;

  inferenceSummary = "";
  parsingSummary = "";
  loading: boolean = false;
  sessionLoadState: 'idle' | 'loading' | 'success' | 'error' = 'idle';
  sessionLoadMessage = '';
  sessionLoadDetails = '';
  private gswbSummaryPollTimer: ReturnType<typeof setInterval> | null = null;
  private vampireSummaryPollTimer: ReturnType<typeof setInterval> | null = null;
  private vampireProgressPollTimer: ReturnType<typeof setInterval> | null = null;
  /** Count of items already completed in a prior run of this session (from
   *  `lastVampireResults`), captured once when a rerun/append starts. Added to this run's
   *  own submitted-item count so the progress bar's denominator reflects the full
   *  regression bank rather than just today's subset -- see
   *  docs/archive/vampire-rerun-fix-plan.txt and REGRESSION_ALIGNMENT_PLAN.md Stage 2. */
  private vampireProgressBaselineCount = 0;
  private sessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionPersistenceEnabled = false;
  private isBootstrapping = true;
  private lastSavedSessionFingerprint = '';
  private saveOperationInProgress = false;
  private pendingAutosave = false;
  private abortRequestInFlight = false;
  private activeSaveAction: 'current' | 'as' | null = null;
  private activeGswbRunStartedAt: number | null = null;
    private gswbRunToken = 0;
  private vampirePendingItemCount: number | null = null;
  private vampireCurrentRunItemCount: number = 0;
  private vampireReprocessingItemCount: number = 0;
  private vampireNewItemCount: number = 0;
  private activeVampireRunStartedAt: number | null = null;
  private vampireRunToken = 0;
  private vampireSummaryRequestInFlight = false;
  private pendingVampireFinalSnapshot: { startedAt: number; runToken: number } | null = null;
  private readonly vampireSummaryRequestTimeoutMs = 30000;
  vampireProgressItemCount: number | null = null;
  vampireProgressProofCount: number | null = null;
  vampireProgressTotalCount: number | null = null;
  /** Total check bundles this run submitted -- the unit the backend's `proofCount`
   *  actually counts, and the only one that advances more than once per item.
   *  `vampireProgressTotalCount` counts ITEMS, so a 3-item run could only ever move in
   *  thirds and sat still through everything slow. Null when unknown (a rerun hydrated
   *  from a stored session), in which case the bar falls back to items. */
  private vampireExpectedProofCount: number | null = null;
  private vampireProofBaselineCount = 0;
  private vampireProgressInProgress = false;
  private vampirePreserveExistingResults = false;
  private currentVampireRunKind: 'initial' | 'append' | 'rerun' = 'initial';
  private isHydratingSession = true;
  private writeSnapshot: ParsedRegressionRunSnapshot | null = null;
  private appendSnapshot: ParsedRegressionRunSnapshot | null = null;
  private appendUpdatedSentenceIds: Set<string> | null = null;

  saveAsSessionName = '';
  testsuiteUpdateMode: 'write' | 'append' = 'write';
  testsuiteEditorMode: 'nli' | 'json' = 'nli';

  recentSessions: RegressionSessionSummary[] = [];
  selectedSessionKey = '';

  labels = ['1', '0', '-1'] as const;
  labelName = { '1': 'Entailment', '0': 'Neutral', '-1': 'Contradiction' } as const;

  cmView: {
    gold: string;
    rows: {
      pred: string;
      v: number;
      pct: string;
      intensity: number;
      diag: boolean;
    }[];
  }[] = [];

  cellIds: string[][][] = Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => [])
  );

  // UI toggle for the disambiguation flow. Persisted alongside disambiguationMode (not
  // component-local) so a reload during a paused run does not leave disambiguationMode
  // true with no visible way to see or exit the pause -- Continue/Skip render only when
  // both are true.
  get enableDisambiguation(): boolean {
    return this.session.enableDisambiguation;
  }

  set enableDisambiguation(value: boolean) {
    this.session.enableDisambiguation = value;
  }

  get disambiguationMode(): boolean {
    return this.session.disambiguationMode;
  }

  set disambiguationMode(value: boolean) {
    this.session.disambiguationMode = value;
  }

  get regressionTestResults(): RegressionParseResult[] {
    return this.session.regressionTestResults;
  }

  set regressionTestResults(value: RegressionParseResult[]) {
    this.session.regressionTestResults = value;
  }

  get inferenceResults(): RegressionInferenceResult[] {
    return this.session.inferenceResults;
  }

  set inferenceResults(value: RegressionInferenceResult[]) {
    this.session.inferenceResults = value;
  }

  get regressionTestItems(): any[] {
    return this.session.regressionTestItems;
  }

  set regressionTestItems(value: any[]) {
    this.session.regressionTestItems = value;
  }

  get sentenceMap(): Record<string, string> {
    return this.session.sentenceMap;
  }

  set sentenceMap(value: Record<string, string>) {
    this.session.sentenceMap = value;
  }

  get sortedMCmap(): Record<string, any> {
    return this.session.sortedMCmap;
  }

  set sortedMCmap(value: Record<string, any>) {
    this.session.sortedMCmap = value;
  }

  // Per-sentence solution selections are persisted with the session.

  // Virtual scroll row-height estimates.
  itemSizeParse = 220;  // app-test-result row height estimate
  itemSizeInfer = 180;  // app-inference-result row height estimate

  // Prefetch buffer for smoother scrolling.
  minBufferPx = 600;
  maxBufferPx = 1200;

  ngAfterViewInit() {
    if (this.gswbPreferences) {
      this.gswbPreferences.gswbPreferences = { ...APP_DEFAULTS.gswb.preferences };
      this.gswbPreferences.updateFormFromPreferences(this.gswbPreferences.gswbPreferences);
    } else {
      console.error("ERROR: `gswbPreferences` ViewChild not initialized!");
    }

    if (this.vampirePreferences) {
      this.vampirePreferences.vampirePreferences = { ...APP_DEFAULTS.vampire.regression };
      this.vampirePreferences.updateFormFromPreferences(this.vampirePreferences.vampirePreferences);
    } else {
      console.error("ERROR: `vampirePreferences` ViewChild not initialized!");
    }

    this.selectedSessionKey = this.getPersistedActiveSessionKey() || this.session.redisSessionKey;
    this.session.gswbPreferences = { ...this.gswbPreferences.gswbPreferences };
    this.session.vampirePreferences = { ...this.vampirePreferences.vampirePreferences };
    this.session.testsuiteText = this.testfile.getContent();
    this.session.rulesText = this.ligerRules.getContent();
    this.session.axiomsText = this.axiomEdit.getContent();
    this.isHydratingSession = false;

    this.gswbPreferences.gswbPreferencesForm.valueChanges.subscribe(() => {
      this.syncSessionStateFromUi();
      this.scheduleSessionSave();
    });

    this.vampirePreferences.vampirePreferencesForm.valueChanges.subscribe(() => {
      this.syncSessionStateFromUi();
      this.scheduleSessionSave();
    });

    // Load the session list before restoring any specific session.
    this.loadRecentSessions();

    const querySessionKey = this.route.snapshot.queryParamMap.get('session') ?? '';
    if (querySessionKey) {
      this.loadSessionFromRecent(querySessionKey, true);
      return;
    }

    const persistedSessionKey = this.getPersistedActiveSessionKey();
    if (persistedSessionKey) {
      this.loadSessionFromRecent(persistedSessionKey, true);
    }

    // Release bootstrap protection after the initial render tick completes.
    setTimeout(() => {
      this.isBootstrapping = false;
    }, 0);
  }

  get redisSessionKey(): string {
    return this.session.redisSessionKey || 'last_session';
  }

  private createInitialSession(): RegressionTestingSession {
    const session = createRegressionTestingSession();
    const persistedSessionKey = this.getPersistedActiveSessionKey();

    if (persistedSessionKey) {
      session.id = persistedSessionKey;
      session.redisSessionKey = persistedSessionKey;
    }

    return session;
  }

  private syncSessionStateFromUi(): void {
    if (this.isHydratingSession) return;

    // Copy the current editor/settings state into the persisted session object.
    this.session.updatedAt = new Date().toISOString();
    this.session.gswbPreferences = { ...this.gswbPreferences.gswbPreferences };
    this.session.vampirePreferences = { ...this.vampirePreferences.vampirePreferences };
    this.session.testsuiteText = this.testfile.getContent();
    this.session.rulesText = this.ligerRules.getContent();
    this.session.axiomsText = this.axiomEdit.getContent();
  }

  private isModified(currentText: string, loadedText: string): boolean {
    return (currentText ?? '') !== (loadedText ?? '');
  }

  getGrammarDisplay(): string {
    return this.session.grammarPath || 'Not loaded';
  }

  getTrackedFileDisplay(kind: 'testsuite' | 'rules' | 'axioms'): string {
    // Loader components keep these fields aligned with what was loaded.
    const metadata = {
      testsuite: {
        filename: this.session.testsuiteFilename,
        current: this.session.testsuiteText,
        loaded: this.session.testsuiteLoadedText,
      },
      rules: {
        filename: this.session.rulesFilename,
        current: this.session.rulesText,
        loaded: this.session.rulesLoadedText,
      },
      axioms: {
        filename: this.session.axiomsFilename,
        current: this.session.axiomsText,
        loaded: this.session.axiomsLoadedText,
      },
    }[kind];

    const name = metadata.filename || 'Not loaded';
    return this.isModified(metadata.current, metadata.loaded) ? `${name} (modified)` : name;
  }

  private getFileStateLabel(filename: string, loadedText: string, currentText: string): string {
    const name = filename || 'Not loaded';
    return this.isModified(currentText, loadedText) ? `${name} (modified)` : name;
  }

  private cloneParsedRegressionSnapshot(snapshot: ParsedRegressionRunSnapshot | null): ParsedRegressionRunSnapshot | null {
    if (!snapshot) return null;

    return {
      regressionTestItems: snapshot.regressionTestItems.map(item => ({ ...item })),
      regressionTestResults: snapshot.regressionTestResults.map(result => ({ ...result })),
      inferenceResults: snapshot.inferenceResults.map(result => ({ ...result })),
      sentenceMap: { ...snapshot.sentenceMap },
      annotations: snapshot.annotations ? { ...snapshot.annotations } : null,
      gswbOutputs: snapshot.gswbOutputs ? { ...snapshot.gswbOutputs } : null,
    };
  }

  private captureParsedRegressionSnapshot(): ParsedRegressionRunSnapshot {
    return {
      regressionTestItems: (this.regressionTestItems ?? []).map(item => ({ ...item })),
      regressionTestResults: (this.regressionTestResults ?? []).map(result => ({ ...result })),
      inferenceResults: (this.inferenceResults ?? []).map(result => ({ ...result })),
      sentenceMap: { ...(this.sentenceMap ?? {}) },
      annotations: this.session.lastAnnotations ? { ...this.session.lastAnnotations } : null,
      gswbOutputs: this.session.lastGswbOutputs ? { ...this.session.lastGswbOutputs } : null,
    };
  }

  private commitParsedRegressionSnapshot(): void {
    this.writeSnapshot = this.captureParsedRegressionSnapshot();
    this.appendSnapshot = null;
  }

  private logBackendPayload(stage: string, mode: 'write' | 'append', payload: unknown): void {
    console.info(`[regression parse-all][${mode}] ${stage}`, payload);
  }

  private getPersistedActiveSessionKey(): string {
    try {
      return localStorage.getItem(this.activeSessionStorageKey) ?? '';
    } catch {
      return '';
    }
  }

  private hasExistingRegressionSessionData(): boolean {
    return Boolean(
      (this.regressionTestItems?.length ?? 0) > 0 ||
      (this.regressionTestResults?.length ?? 0) > 0 ||
      (this.inferenceResults?.length ?? 0) > 0 ||
      Object.keys(this.sentenceMap ?? {}).length > 0 ||
      (this.session.lastGswbOutputs && Object.keys(this.session.lastGswbOutputs).length > 0) ||
      (this.session.lastAnnotations && Object.keys(this.session.lastAnnotations).length > 0) ||
      (this.session.lastVampireResults && Object.keys(this.session.lastVampireResults).length > 0) ||
      (this.session.testsuiteText ?? '').trim().length > 0 ||
      (this.session.rulesText ?? '').trim().length > 0 ||
      (this.session.axiomsText ?? '').trim().length > 0
    );
  }

  private confirmWriteModeOverwrite(): boolean {
    const message = [
      'Write mode will overwrite the current regression session results.',
      'Existing parse and inference data will be replaced.',
      '',
      'Continue?'
    ].join('\n');

    return typeof window === 'undefined' ? true : window.confirm(message);
  }

  private setPersistedActiveSessionKey(sessionKey: string): void {
    try {
      if (sessionKey) {
        localStorage.setItem(this.activeSessionStorageKey, sessionKey);
      } else {
        localStorage.removeItem(this.activeSessionStorageKey);
      }
    } catch {
      // Ignore storage failures; session persistence still works server-side.
    }
  }

  private scheduleSessionSave(immediate = false): void {
    if (this.isHydratingSession || !this.sessionPersistenceEnabled) return;

    if (this.abortRequestInFlight) {
      if (this.sessionSaveTimer !== null) {
        clearTimeout(this.sessionSaveTimer);
        this.sessionSaveTimer = null;
      }
      this.pendingAutosave = false;
      return;
    }

    if (this.saveOperationInProgress) {
      this.pendingAutosave = true;
      if (this.sessionSaveTimer !== null) {
        clearTimeout(this.sessionSaveTimer);
        this.sessionSaveTimer = null;
      }
      return;
    }

    if (this.sessionSaveTimer !== null) {
      clearTimeout(this.sessionSaveTimer);
      this.sessionSaveTimer = null;
    }

    const save = () => {
      this.sessionSaveTimer = null;
      this.saveSessionSnapshot(undefined, undefined, undefined, 'autosave');
    };
    if (immediate) {
      save();
      return;
    }

    this.sessionSaveTimer = setTimeout(save, 300);
  }

  private loadRecentSessions(): void {
    this.dataService.listRegressionSessions().subscribe({
      next: sessions => {
        this.recentSessions = sessions ?? [];
      },
      error: error => console.warn("Unable to load recent sessions.", error)
    });
  }

  private saveSessionSnapshot(
    onSuccess?: () => void,
    successMessage?: string,
    onComplete?: () => void,
    action: 'autosave' | 'current' | 'as' = 'autosave',
    lockAlreadyHeld = false
  ): void {
    if (this.isHydratingSession || !this.sessionPersistenceEnabled) return;

    if (this.abortRequestInFlight && action === 'autosave') return;

    if (this.saveOperationInProgress && !lockAlreadyHeld) {
      this.pendingAutosave = true;
      return;
    }

    this.syncSessionStateFromUi();
    const snapshot = this.buildSessionSnapshot();
    // Serialized ONCE and reused as both the change fingerprint and the request body.
    // A saved session is routinely 8-12 MB, and stringifying it twice per autosave was
    // pure duplicated work on the main thread.
    const serialized = this.serializeSessionSnapshot(snapshot);
    const fingerprint = serialized;
    if (fingerprint === this.lastSavedSessionFingerprint) {
      if (action === 'current') {
        this.setSessionLoadStatus('success', 'Nothing to save.', 'Current session is already up to date.');
      } else if (successMessage) {
        this.displayMessage('No changes to save.', 'blue');
      }
      if (onSuccess) {
        onSuccess();
      }
      if (onComplete) {
        onComplete();
      }
      return;
    }

    this.saveOperationInProgress = true;
    this.activeSaveAction = action === 'autosave' ? null : action;
    let saveSucceeded = false;

    this.dataService.saveRegressionSession(this.redisSessionKey, serialized).pipe(
      finalize(() => {
        this.saveOperationInProgress = false;
        this.activeSaveAction = null;
        const shouldRetry = saveSucceeded && this.pendingAutosave && !this.abortRequestInFlight;
        this.pendingAutosave = false;
        if (onComplete) {
          onComplete();
        }
        if (shouldRetry) {
          this.scheduleSessionSave(true);
        }
      })
    ).subscribe({
      next: (response: any) => {
        saveSucceeded = true;
        this.lastSavedSessionFingerprint = fingerprint;
        this.setPersistedActiveSessionKey(this.redisSessionKey);
        if (response?.recent_sessions) {
          this.recentSessions = response.recent_sessions;
        } else {
          this.loadRecentSessions();
        }

        if (successMessage) {
          this.setSessionLoadStatus('success', successMessage, `Session key: ${this.redisSessionKey}`);
        }

        if (onSuccess) {
          onSuccess();
        }
      },
      error: error => {
        console.warn("Unable to save regression session.", error);
        // Surfaced, not just logged. A save that silently does nothing is how a session's
        // work goes missing without anyone noticing until they reload -- and the previous
        // failure mode here (a request to a dead service that hangs forever rather than
        // erroring) showed only as a permanently "autosaving" UI with no stated cause.
        const detail = error?.name === 'TimeoutError'
          ? 'the session service did not respond'
          : (error?.message ?? 'unknown error');
        this.setSessionLoadStatus('error',
          `Could not save session ${this.redisSessionKey}`,
          `${detail}. Your work is still in the browser; try saving again once the services are up.`);
      }
    });
  }

  saveCurrentSession(): void {
    if (this.isSessionActionLocked) return;

    if (!this.sessionPersistenceEnabled) {
      this.displayMessage('No active session is available to save yet.', 'blue');
      return;
    }

    this.saveOperationInProgress = true;
    this.activeSaveAction = 'current';
    this.saveSessionSnapshot(
      undefined,
      `Saved current session ${this.redisSessionKey}`,
      () => {
        this.saveOperationInProgress = false;
        this.activeSaveAction = null;
      },
      'current',
      true
    );
  }

  setTestsuiteEditorMode(mode: 'nli' | 'json'): void {
    if (this.testsuiteEditorMode === mode) return;

    const previousMode = this.testsuiteEditorMode;
    this.testsuiteEditorMode = mode;

    const currentText = this.testfile?.getContent?.() ?? this.session.testsuiteText ?? '';
    if (!currentText.trim()) {
      return;
    }

    try {
      if (previousMode === 'json') {
        this.parse_json_testfile(currentText);
      } else {
        this.parse_block_testfile(currentText);
      }

      const converted = mode === 'json'
        ? JSON.stringify(this.buildProcessedTestsuiteItems(), null, 2)
        : this.serializeProcessedTestsuiteAsBlocks();

      this.session.testsuiteText = converted;
      this.testfile.updateContent(converted);
      this.syncSessionStateFromUi();
      this.scheduleSessionSave();
    } catch (error) {
      this.testsuiteEditorMode = previousMode;
      console.warn('Unable to convert testsuite format.', error);
      this.displayMessage('Unable to convert the testsuite format.', 'red');
    }
  }

  private buildSessionSnapshot(): RegressionSessionDocument {
    return regressionSessionToDocument({
      ...this.session,
      updatedAt: new Date().toISOString(),
      gswbPreferences: { ...this.gswbPreferences.gswbPreferences },
      vampirePreferences: { ...this.vampirePreferences.vampirePreferences },
      testsuiteText: this.testfile.getContent(),
      rulesText: this.ligerRules.getContent(),
      axiomsText: this.axiomEdit.getContent(),
    });
  }

  /** ONE pass over the snapshot, serving as both the request body and the change
   *  fingerprint autosave compares against. A saved session is routinely 8-12 MB and this
   *  used to be stringified twice per autosave.
   *
   *  `metadata.updatedAt` is dropped, which is what lets one string do both jobs: it
   *  changes on every snapshot, so including it would make every fingerprint unique and
   *  turn autosave into a loop -- and the store overwrites it server-side anyway
   *  (`_prepare_regression_session_payload`: `metadata["updatedAt"] = now`), so sending it
   *  was never load-bearing. `createdAt` is untouched and still sent. */
  private serializeSessionSnapshot(snapshot: RegressionSessionDocument): string {
    const { metadata, ...rest } = snapshot;
    const { updatedAt, ...metadataRest } = metadata;
    return JSON.stringify({ ...rest, metadata: metadataRest });
  }

  private buildSessionFingerprint(snapshot: RegressionSessionDocument): string {
    return this.serializeSessionSnapshot(snapshot);
  }

  private resetRuntimeStatus(): void {
    this.clearStatusMessage();
    this.clearVampireProgressIndicator();
    this.pendingVampireFinalSnapshot = null;
    this.vampireSummaryRequestInFlight = false;
    this.vampirePendingItemCount = null;
    this.activeVampireRunStartedAt = null;
    this.vampireCurrentRunItemCount = 0;
    this.vampireReprocessingItemCount = 0;
    this.vampireNewItemCount = 0;
  }

  private initializeBlankSession(): void {
    this.isHydratingSession = true;
    this.setSessionLoadStatus('idle', '', '');
    this.resetRuntimeStatus();
    this.saveOperationInProgress = false;
    this.pendingAutosave = false;
    this.activeSaveAction = null;

    this.session = createRegressionTestingSession();
    this.selectedSessionKey = this.redisSessionKey;
    this.recentSessions = this.recentSessions.filter(session => session.sessionKey !== this.redisSessionKey);
    this.testsuiteUpdateMode = this.session.testsuiteUpdateMode;
    this.testsuiteEditorMode = 'nli';
    this.regressionTestResults = [];
    this.inferenceResults = [];
    this.regressionTestItems = [];
    this.sentenceMap = {};
    this.cellIds = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => []));
    this.selectedIds.clear();
    this.selectedGoldIdx = this.selectedPredIdx = null;
    this.inferenceSummary = '';
    this.parsingSummary = '';
    this.updateConfusionMatrixView(Array.from({ length: 3 }, () => Array(3).fill(0)));
    this.testfile.updateContent('');
    this.ligerRules.updateContent('');
    this.axiomEdit.updateContent('');
    this.writeSnapshot = this.captureParsedRegressionSnapshot();
    this.appendSnapshot = null;
    this.lastSavedSessionFingerprint = this.buildSessionFingerprint(this.buildSessionSnapshot());
    this.sessionPersistenceEnabled = true;
    this.isHydratingSession = false;
    this.setPersistedActiveSessionKey('');
  }

  private hydrateSession(snapshot: RegressionTestingSession | RegressionSessionDocument): void {
    this.isHydratingSession = true;
    this.resetRuntimeStatus();
    this.pendingAutosave = false;

    const runtimeSnapshot = 'analysis' in snapshot ? regressionDocumentToSession(snapshot) : snapshot;

    // Restore saved session state into the live view model and editors.
    this.session = {
      ...createRegressionTestingSession(),
      ...runtimeSnapshot,
      redisSessionKey: runtimeSnapshot.redisSessionKey || runtimeSnapshot.id,
      gswbPreferences: runtimeSnapshot.gswbPreferences ?? this.gswbPreferences.gswbPreferences,
      vampirePreferences: runtimeSnapshot.vampirePreferences ?? this.vampirePreferences.vampirePreferences,
      testsuiteText: runtimeSnapshot.testsuiteText ?? '',
      rulesText: runtimeSnapshot.rulesText ?? '',
      axiomsText: runtimeSnapshot.axiomsText ?? '',
      grammarPath: runtimeSnapshot.grammarPath ?? '',
      testsuiteFilename: runtimeSnapshot.testsuiteFilename ?? '',
      rulesFilename: runtimeSnapshot.rulesFilename ?? '',
      axiomsFilename: runtimeSnapshot.axiomsFilename ?? '',
      testsuiteLoadedText: runtimeSnapshot.testsuiteLoadedText ?? runtimeSnapshot.testsuiteText ?? '',
      rulesLoadedText: runtimeSnapshot.rulesLoadedText ?? runtimeSnapshot.rulesText ?? '',
      axiomsLoadedText: runtimeSnapshot.axiomsLoadedText ?? runtimeSnapshot.axiomsText ?? '',
      testsuiteUpdateMode: runtimeSnapshot.testsuiteUpdateMode ?? 'write',
      lastVampireResults: runtimeSnapshot.lastVampireResults ?? null,
    };

    this.selectedSessionKey = this.redisSessionKey;
    this.gswbPreferences.gswbPreferences = { ...this.session.gswbPreferences };
    this.gswbPreferences.updateFormFromPreferences(this.session.gswbPreferences);
    this.vampirePreferences.vampirePreferences = { ...this.session.vampirePreferences };
    this.vampirePreferences.updateFormFromPreferences(this.session.vampirePreferences);

    this.testfile.updateContent(this.session.testsuiteText || '');
    this.ligerRules.updateContent(this.session.rulesText || '');
    this.axiomEdit.updateContent(this.session.axiomsText || '');
    this.testsuiteUpdateMode = this.session.testsuiteUpdateMode ?? 'write';
    this.testsuiteEditorMode = this.inferTestsuiteEditorMode(this.session.testsuiteText || '');

    this.regressionTestItems = this.session.regressionTestItems ?? [];
    this.regressionTestResults = this.session.regressionTestResults ?? [];
    this.inferenceResults = this.session.inferenceResults ?? [];
    this.vampireCurrentRunItemCount = 0;

    if (this.session.lastVampireResults && Object.keys(this.session.lastVampireResults).length > 0) {
      this.vampirePreserveExistingResults = true;
      this.vampireCurrentRunItemCount = Object.keys(this.session.lastVampireResults).length;
      this.renderVampireResults(
        this.session.lastVampireResults,
        { item_count: Object.keys(this.session.lastVampireResults).length, proof_count: 0 },
        true,
        true
      );
    } else if (this.inferenceResults.length > 0) {
      this.renderSavedInferenceResults(this.inferenceResults);
    } else {
      this.inferenceSummary = '';
      this.parsingSummary = '';
      this.updateConfusionMatrixView(Array.from({ length: 3 }, () => Array(3).fill(0)));
    }

    this.writeSnapshot = this.captureParsedRegressionSnapshot();
    this.appendSnapshot = null;
    this.lastSavedSessionFingerprint = this.buildSessionFingerprint(this.buildSessionSnapshot());

    this.isHydratingSession = false;
    this.sessionPersistenceEnabled = true;
  }

  loadSessionFromRecent(sessionKey: string, force = false): void {
    if (this.isSessionActionLocked) return;
    if (!sessionKey || (!force && sessionKey === this.redisSessionKey)) return;

    this.setSessionLoadStatus('loading', `Loading session ${sessionKey}...`, `Session key: ${sessionKey}`);
    this.inferenceSummary = '';
    this.parsingSummary = '';
    this.clearStatusMessage();

    this.dataService.loadRegressionSession(sessionKey).subscribe({
      next: snapshot => {
        const runtimeSnapshot = regressionDocumentToSession(snapshot);
        this.hydrateSession(runtimeSnapshot);
        this.setPersistedActiveSessionKey(sessionKey);
        const parseCount = runtimeSnapshot?.regressionTestResults?.length ?? 0;
        const inferenceCount = runtimeSnapshot?.inferenceResults?.length ?? 0;
        this.setSessionLoadStatus(
          'success',
          `Loaded ${sessionKey}`,
          [
            `Parses: ${parseCount}`,
            `Inference results: ${inferenceCount}`,
            `Grammar: ${runtimeSnapshot?.grammarPath || 'Not loaded'}`,
            `Testsuite: ${this.getFileStateLabel(runtimeSnapshot?.testsuiteFilename ?? '', runtimeSnapshot?.testsuiteLoadedText ?? runtimeSnapshot?.testsuiteText ?? '', runtimeSnapshot?.testsuiteText ?? '')}`,
            `Rules: ${this.getFileStateLabel(runtimeSnapshot?.rulesFilename ?? '', runtimeSnapshot?.rulesLoadedText ?? runtimeSnapshot?.rulesText ?? '', runtimeSnapshot?.rulesText ?? '')}`,
            `Axioms: ${this.getFileStateLabel(runtimeSnapshot?.axiomsFilename ?? '', runtimeSnapshot?.axiomsLoadedText ?? runtimeSnapshot?.axiomsText ?? '', runtimeSnapshot?.axiomsText ?? '')}`,
          ].join('\n')
        );
      },
      error: error => {
        console.warn("Unable to load regression session.", error);
        if (this.getPersistedActiveSessionKey() === sessionKey) {
          this.setPersistedActiveSessionKey('');
        }
        this.initializeBlankSession();
        // AFTER the reset, not before: initializeBlankSession() sets the session status
        // to idle/'' , so a message posted first was wiped and the failure showed as a
        // silent reset to a blank session -- indistinguishable from starting a new one on
        // purpose. Reported live 2026-08-21 as "it simply resets, not even a failed load
        // error message".
        this.setSessionLoadStatus('error',
          `Could not load session ${sessionKey}`,
          `${this.describeLoadFailure(error)}\nStarted a new session instead; `
          + `${sessionKey} is still stored and can be loaded again.`);
      }
    });
  }

  /** Why a session load failed, in the user's terms. A timeout and a 404 mean very
   *  different things -- "the service is slow or down, try again" versus "this session is
   *  gone" -- and a bare "could not restore" tells the user neither. */
  private describeLoadFailure(error: any): string {
    if (error?.name === 'TimeoutError') {
      return 'The session service did not respond in time.';
    }
    if (error?.status === 0) {
      return 'The session service is unreachable (is the vampire container running?).';
    }
    if (error?.status === 404) {
      return 'No session is stored under that key.';
    }
    if (error?.status === 409) {
      return `The stored session is not readable by this version: ${error?.error?.detail ?? 'schema mismatch'}.`;
    }
    if (error?.status) {
      return `The session service answered HTTP ${error.status}.`;
    }
    return error?.message ?? 'Unknown error.';
  }

  saveSessionAs(): void {
    if (this.isSessionActionLocked) return;

    const sessionKey = this.saveAsSessionName.trim();
    if (!sessionKey) {
      this.displayMessage('Please enter a session name before saving.', 'red');
      return;
    }

    const snapshot = this.buildSessionSnapshot();
    snapshot.metadata.id = sessionKey;
    snapshot.metadata.redisSessionKey = sessionKey;
    snapshot.metadata.updatedAt = new Date().toISOString();
    snapshot.metadata.createdAt = snapshot.metadata.updatedAt;

    this.saveOperationInProgress = true;
    this.activeSaveAction = 'as';
    let saveSucceeded = false;
    this.displayMessage(`Saving session as ${sessionKey}...`, 'blue');

    this.dataService.saveRegressionSession(sessionKey, snapshot).pipe(
      finalize(() => {
        this.saveOperationInProgress = false;
        this.activeSaveAction = null;
        const shouldRetry = saveSucceeded && this.pendingAutosave;
        this.pendingAutosave = false;
        if (shouldRetry) {
          this.scheduleSessionSave(true);
        }
      })
    ).subscribe({
      next: (response: any) => {
        saveSucceeded = true;
        const savedSession = response?.session ?? snapshot;
        this.saveAsSessionName = '';
        this.hydrateSession(savedSession);
        this.selectedSessionKey = this.redisSessionKey;
        this.setPersistedActiveSessionKey(this.selectedSessionKey);
        this.loadRecentSessions();
        this.setSessionLoadStatus('success', `Saved session as ${sessionKey}`, `Session key: ${sessionKey}`);
      },
      error: error => {
        console.warn('Unable to save session as.', error);
        this.setSessionLoadStatus('error', `Failed to save session as ${sessionKey}`, 'The session could not be stored.');
      }
    });
  }

  createNewSession(): void {
    if (this.isSessionActionLocked) return;
    this.initializeBlankSession();
  }

  private renderSavedInferenceResults(results: RegressionInferenceResult[]): void {
    const idx = { '1': 0, '0': 1, '-1': 2 };
    const cm = Array.from({ length: 3 }, () => Array(3).fill(0));
    const previousSelection = { goldIdx: this.selectedGoldIdx, predIdx: this.selectedPredIdx };

    this.cellIds = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => []));
    this.selectedIds.clear();
    this.selectedGoldIdx = this.selectedPredIdx = null;

    for (const result of results) {
      const gold = result.goldLabel;
      const pred = result.predictedLabel;
      if (idx[gold] !== undefined && idx[pred] !== undefined) {
        cm[idx[gold]][idx[pred]] += 1;
        this.cellIds[idx[gold]][idx[pred]].push(result.id);
      }
    }

    this.updateConfusionMatrixView(cm, results.length);
    if (previousSelection.goldIdx !== null && previousSelection.predIdx !== null) {
      this.selectedGoldIdx = previousSelection.goldIdx;
      this.selectedPredIdx = previousSelection.predIdx;
      this.selectedIds = new Set(this.cellIds[previousSelection.goldIdx][previousSelection.predIdx] ?? []);
    }
    this.inferenceSummary =
      `Inference results summary:\n` +
      `Processed items: ${results.length} of ${this.regressionTestItems.length}\n` +
      `Loaded from session: ${this.redisSessionKey}`;
  }

  private startGswbSummaryPolling(runStartedAt: number, runToken: number): void {
    this.stopGswbSummaryPolling();

    this.gswbSummaryPollTimer = setInterval(() => {
      this.loadAndRenderGswbState(false, runStartedAt, runToken);
    }, 15000);
  }

  private stopGswbSummaryPolling(): void {
    if (this.gswbSummaryPollTimer !== null) {
      clearInterval(this.gswbSummaryPollTimer);
      this.gswbSummaryPollTimer = null;
    }
  }

  private loadAndRenderGswbState(finalSnapshot: boolean, runStartedAt: number, runToken: number, afterRender?: () => void): void {
    if (runToken !== this.gswbRunToken) return;
    if (!this.loading && !finalSnapshot) return;

    this.dataService.getLastGswbSession(this.redisSessionKey).subscribe({
      next: snapshot => {
        if (runToken !== this.gswbRunToken) return;

        const outputs = snapshot?.outputs ?? {};
        this.renderGswbResults(outputs);

        const totalCount = Object.keys(this.sentenceMap ?? {}).length;
        if (finalSnapshot) {
          this.displayMessage(`Parsed ${totalCount} of ${totalCount} sentences!`, "green");
        } else if (Object.keys(outputs).length > 0) {
          this.displayMessage(`Parsing in progress...`, "blue");
        }

        if (finalSnapshot) {
          this.session.timing.parseMs = Date.now() - runStartedAt;
          this.session.lastGswbOutputs = outputs;
          this.loading = false;
          this.activeGswbRunStartedAt = null;
          this.session.lastLogicType = this.session.lastLogicType ?? 'fof';
          this.saveSessionSnapshot();
          if (afterRender) afterRender();
        }
      },
      error: error => {
        if (runToken !== this.gswbRunToken) return;

        console.warn("Unable to load GSWB progress summary.", error);
        if (finalSnapshot) {
          this.loading = false;
          this.activeGswbRunStartedAt = null;
          this.saveSessionSnapshot();
          this.displayMessage("Batch processing completed, but Redis state could not be reloaded.", "red");
          if (afterRender) afterRender();
        }
      }
    });
  }

  private renderGswbResults(gswbOutputs: Record<string, GswbOutput>): void {
    const outputs = this.appendSnapshot
      ? { ...(this.appendSnapshot.gswbOutputs ?? {}), ...gswbOutputs }
      : gswbOutputs;
    const annotations = this.session.lastAnnotations ?? {};

    let successFullKeys: string[] = [];

    const currentRegressionTestResults: RegressionParseResult[] = [];

    for (let key of Object.keys(this.sentenceMap)) {
      const out = outputs[key];
      if (!out) continue;

      const sols = out?.solutions ?? [];

      if (sols.length > 0) {
        successFullKeys.push(key);
      }

      if (!this.session.selectedSolutionIdsBySentence[key] || this.session.selectedSolutionIdsBySentence[key].length === 0) {
        this.session.selectedSolutionIdsBySentence[key] = sols.map(s => s.id);
      }

      const regressionTestResult: RegressionParseResult = {
        sentence_id: key,
        sentence: this.sentenceMap[key],
        // Aggregated across this sentence's syntactic analyses, which the batch endpoint
        // now returns individually instead of pre-flattening into one annotation.
        noOfAppliedRules: this.distinctAppliedRuleCount(annotations[key]),
        noOfMCsets: (annotations[key]?.solutions ?? [])
          .reduce((sum, solution) => sum + (solution.numberOfMCsets ?? 0), 0),
        noOfSolutions: sols.length,
        ligerGraph: annotations[key]?.solutions?.[0]?.graph,
        ligerMCsets: (annotations[key]?.solutions ?? [])
          .map(solution => solution.meaningConstructors ?? '').join('\n'),
        allMCs: this.sortedMCmap[key],
        gswbSolutions: sols,
        gswbDerivation: out?.derivation,
        result_type: 'parseResult',
        discriminants: out?.discriminants
      };

      currentRegressionTestResults.push(regressionTestResult);
    }

    this.regressionTestResults = currentRegressionTestResults;
    this.session.lastGswbOutputs = outputs;
    this.session.regressionTestResults = currentRegressionTestResults;
    this.resetAnalysisDocuments();
    if (!this.isHydratingSession) {
      this.scheduleSessionSave();
    }

    this.parsingSummary =
      `Parsing summary:\n` +
      `Parsed ${currentRegressionTestResults.length} of ${Object.keys(this.sentenceMap).length} sentences!`;
  }

  /** Resets the per-item documents for a fresh parse.
   *
   *  Deliberately does NOT populate them. An item's document holds the readings that
   *  item's chain actually used -- registered by `registerBatchParsedSentence` for the
   *  seed and `foldSentenceIntoBranches`/`registerFinalSequence` for the rest -- exactly
   *  as chat's document holds the readings its turns used.
   *
   *  Registering the batch parse here as well was the root cause of a broken
   *  `SYNSEM_MAPPING`. Both registrations write the SAME sentence into the same document
   *  entry under different syntax ids: GSWB mints reading ids as
   *  `sentenceId + "-s" + index` for both the batch deduce and the sequence-scoped one,
   *  so `S1-s1` exists in both, and `upsertSentenceAnalyses` unions their mappings. The
   *  result was a semantic listed under two syntax ids and a syntax owning readings whose
   *  `syntacticOrigin` named a different one -- so `(syn_id, sem_id)` stopped being
   *  recoverable, which is the whole point of the mapping.
   *
   *  The batch parse is not lost: it is the parse phase's own record, and lives where it
   *  belongs -- `session.lastGswbOutputs`/`lastAnnotations` for the semvis dialog and
   *  disambiguation, `regressionTestResults` for the parsing report. It is simply not an
   *  item's discourse.
   */
  private resetAnalysisDocuments(): void {
    // Replaced wholesale rather than merged: a re-parse produces new readings, and an
    // item's previous document describes readings that no longer exist.
    this.session.analysisDocuments = {};
  }

  /** The document for one NLI item (or one sentence, in a parse-only run). Created on
   *  demand so a run that reaches an item the parse phase never registered still gets a
   *  well-formed, empty discourse to build into rather than a missing one. */
  private documentFor(documentId: string): XlePlusGlueDocument {
    let document = this.session.analysisDocuments[documentId];
    if (!document) {
      document = createRegressionAnalysisDocument(`${this.session.id}-${documentId}`);
      this.session.analysisDocuments = { ...this.session.analysisDocuments, [documentId]: document };
    }
    return document;
  }

  ngOnDestroy(): void {
    this.stopGswbSummaryPolling();
    this.stopVampireSummaryPolling();
    if (this.sessionSaveTimer !== null) {
      clearTimeout(this.sessionSaveTimer);
      this.sessionSaveTimer = null;
    }
  }

  // Button handler (appears only when disambiguationMode is true)
  continueAfterDisambiguation(): void {
    this.runVampireFromCurrentState(/*useDisambiguated*/ true);
  }

  // Optional: allow skipping disambiguation
  skipDisambiguation(): void {
    this.runVampireFromCurrentState(/*useDisambiguated*/ false);
  }

  resendVampire(): void {
    if (!this.hasParsedExamples) return;
    this.runVampireFromCurrentState(/*useDisambiguated*/ true);
  }

  abortCurrentRun(): void {
    if (!this.loading || (this.saveOperationInProgress && this.activeSaveAction !== null) || this.abortRequestInFlight) return;

    this.abortRequestInFlight = true;
    if (this.sessionSaveTimer !== null) {
      clearTimeout(this.sessionSaveTimer);
      this.sessionSaveTimer = null;
    }
    this.pendingAutosave = false;
    this.displayMessage('Requesting run abort...', 'blue');
    this.dataService.requestVampireCancel(this.redisSessionKey).subscribe({
      next: () => {
        this.gswbRunToken++;
        this.vampireRunToken++;
        this.stopGswbSummaryPolling();
        this.stopVampireSummaryPolling();
        this.pendingVampireFinalSnapshot = null;
        this.vampireSummaryRequestInFlight = false;
        this.pendingAutosave = false;
        this.session.disambiguationMode = false;

        this.loadAndRenderVampireState(true, this.activeVampireRunStartedAt ?? Date.now(), this.vampireRunToken);
      },
      error: error => {
        console.warn('Unable to request Vampire cancel.', error);
        this.displayMessage('Unable to abort current run.', 'red');
        this.abortRequestInFlight = false;
      }
    });
  }

  get hasParsedExamples(): boolean {
    return this.regressionTestResults.length > 0;
  }

  get vampireDiscriminantStatus(): string {
    if (!this.hasParsedExamples) return '';
    if (!this.session.hasRunVampire) return 'Vampire has not been run yet.';

    return this.haveDiscriminantSelectionsChangedSinceLastVampire()
      ? 'Discriminant selections have changed since the last Vampire call.'
      : 'Discriminant selections are unchanged since the last Vampire call.';
  }

  get canResendVampire(): boolean {
    return this.hasParsedExamples && !this.isSessionActionLocked && !!this.session.lastGswbOutputs;
  }

  get canAbortRun(): boolean {
    return (this.loading || this.activeGswbRunStartedAt !== null || this.activeVampireRunStartedAt !== null) && !(this.saveOperationInProgress && this.activeSaveAction !== null) && !this.abortRequestInFlight;
  }

  get isAbortInProgress(): boolean {
    return this.abortRequestInFlight;
  }

  get isVampireProgressVisible(): boolean {
    return this.activeVampireRunStartedAt !== null || this.vampireProgressTotalCount !== null;
  }

  get isVampireProgressAnimating(): boolean {
    return this.isVampireProgressVisible && this.vampireProgressInProgress;
  }

  get vampireProgressPercent(): number {
    // Prefer bundles over items: `proofCount` ticks on every check bundle the backend
    // finishes, while `itemCount` only moves when a whole item completes. On a run whose
    // items take minutes that is the difference between a bar that creeps and a bar that
    // sits at 0% and then jumps by a third.
    const expected = this.vampireExpectedProofCount;
    if (expected !== null && expected > 0 && this.vampireProgressProofCount !== null) {
      const proofs = Math.min(this.vampireProgressProofCount + this.vampireProofBaselineCount,
        expected + this.vampireProofBaselineCount);
      const total = expected + this.vampireProofBaselineCount;
      return Math.max(0, Math.min(100, Math.round((proofs / total) * 100)));
    }

    const total = this.vampireProgressTotalCount ?? 0;
    if (total <= 0) return 0;
    const count = Math.min(this.vampireProgressItemCount ?? 0, total);
    return Math.max(0, Math.min(100, Math.round((count / total) * 100)));
  }

  get vampireProgressLabel(): string {
    const progress = this.buildVampireProgressDescription();
    return progress ? `${progress}...` : 'Processing Vampire items...';
  }

  private buildVampireProgressDescription(): string {
    const reprocessingCount = this.vampireReprocessingItemCount ?? 0;
    const newItemCount = this.vampireNewItemCount ?? 0;

    let what: string;
    if (reprocessingCount > 0 && newItemCount > 0) {
      what = `Re-processing ${reprocessingCount} items and processing ${newItemCount} new items`;
    } else if (reprocessingCount > 0) {
      what = `Re-processing ${reprocessingCount} items`;
    } else if (newItemCount > 0) {
      what = `Processing ${newItemCount} new items`;
    } else {
      what = 'Processing Vampire items';
    }

    // Say where it is, in the unit that actually moves. Without this the label was
    // constant for the whole run and the bar was the only signal -- and the bar could
    // only change once per item.
    const expected = this.vampireExpectedProofCount;
    if (expected !== null && expected > 0 && this.vampireProgressProofCount !== null) {
      return `${what} -- ${Math.min(this.vampireProgressProofCount, expected)}/${expected} check bundles`;
    }
    const totalItems = this.vampireProgressTotalCount ?? 0;
    if (totalItems > 0 && this.vampireProgressItemCount !== null) {
      return `${what} -- ${Math.min(this.vampireProgressItemCount, totalItems)}/${totalItems} items`;
    }
    return what;
  }

  private buildVampireCompletionDescription(summary: VampireSessionSummary | null | undefined): string {
    const processedCount = summary?.item_count ?? 0;
    return `Processed ${processedCount} items`;
  }

  get hasTimingInfo(): boolean {
    return this.session.timing.parseMs !== null ||
      this.session.timing.totalMs !== null ||
      this.activeVampireRunStartedAt !== null ||
      this.session.lastVampireResults !== null;
  }

  get parseResultCount(): number {
    return this.regressionTestResults.length;
  }

  get expectedParseCount(): number {
    return Object.keys(this.sentenceMap ?? {}).length;
  }

  get inferenceResultCount(): number {
    return this.inferenceResults.length;
  }

  get expectedInferenceCount(): number {
    return this.regressionTestItems.length;
  }

  /** Items the "Inference report (N of M)" count silently drops: submitted but never
   *  produced a majority verdict, whether because their reading-pair preparation failed
   *  outright (0 assignments -- e.g. a GSWB merge_sequence_semantics error, or the reading-
   *  matching failure the document-first Stage 4 rework removes) or because Vampire was
   *  never reached for them at all this run. Built from the persisted document, not the
   *  transient nliPreparationFailures array, so it also works when reviewing a reloaded
   *  session rather than only live during a run -- see REGRESSION_ALIGNMENT_PLAN.md, found
   *  live when a 16-item run silently reported "13 of 16" with no indication of why the
   *  other 3 were missing. */
  get failedInferenceItems(): { id: string; sentences: string; reason: string }[] {
    const failed: { id: string; sentences: string; reason: string }[] = [];

    // PENDING IS NOT FAILED. While a run is in flight, an item either has no reasoning
    // update yet or has one whose assignments carry no verdict yet (the immediate
    // loadAndRenderVampireState at submit time writes those). Reporting either made the
    // panel accuse the entire testsuite for the first seconds of every run, clearing
    // itself as verdicts landed. The one thing that IS known at that point and worth
    // showing immediately is a preparation failure, so `update.failure` still reports.
    const runInFlight = this.activeVampireRunStartedAt !== null;
    for (const item of this.regressionTestItems) {
      const itemId = String(item?.id ?? '');
      const update = (this.session.analysisDocuments[itemId]?.reasoningUpdates ?? [])
        .find(candidate => candidate.id === `ru-${itemId}`);
      if (update && majorityVerdict(update.assignments ?? [])) continue;
      if (runInFlight && !update?.failure) continue;
      if (!update && !this.session.hasRunVampire) continue;

      const sentences = [...(item?.premises ?? []), ...(item?.conclusion ?? [])]
        .map((sid: string) => this.sentenceMap[sid])
        .filter((s: any) => typeof s === 'string' && s.trim().length > 0)
        .join(' / ');
      const reason = update?.failure || (update ? 'No reading assignment produced a verdict.' : 'Never attempted.');
      failed.push({ id: itemId, sentences, reason });
    }

    return failed;
  }

  get processingTimingSummary(): string {
    const timing = this.session.timing;

    if (timing.totalMs !== null) {
      return `Overall ${this.formatDuration(timing.totalMs)}`;
    }

    if (timing.parseMs !== null) {
      if (this.activeVampireRunStartedAt !== null) {
        return `Parse ${this.formatDuration(timing.parseMs)} · Vampire pending`;
      }

      if (this.session.hasRunVampire && this.inferenceResultCount < this.expectedInferenceCount) {
        return `Parse ${this.formatDuration(timing.parseMs)} · Vampire call incomplete`;
      }

      return `Parse ${this.formatDuration(timing.parseMs)}`;
    }

    return '';
  }

  get processingTimingDetails(): string {
    const timing = this.session.timing;
    const lines: string[] = [];

    if (timing.startedAt) lines.push(`Started: ${timing.startedAt}`);
    if (timing.parseMs !== null) {
      lines.push(`Parse phase: ${this.formatDuration(timing.parseMs, true)} · ${this.parseResultCount}/${this.expectedParseCount} parses`);
    }
    if (timing.vampireMs !== null) {
      lines.push(`Vampire phase: ${this.formatDuration(timing.vampireMs, true)} · ${this.inferenceResultCount}/${this.expectedInferenceCount} items`);
    } else if (this.session.hasRunVampire) {
      lines.push(`Vampire phase: incomplete · ${this.inferenceResultCount}/${this.expectedInferenceCount} items`);
    }
    if (this.session.lastGswbOutputs !== null) {
      lines.push(`Disambiguated sentences: ${this.disambiguatedSentenceCount} total`);
    }
    if (this.session.hasRunVampire || this.session.lastVampireResults !== null || this.vampireProgressProofCount !== null) {
      lines.push(`Proofs: ${this.vampireProofCount} total`);
    }
    if (timing.totalMs !== null) lines.push(`Overall: ${this.formatDuration(timing.totalMs, true)}`);

    return lines.join('\n');
  }

  get disambiguatedSentenceCount(): number {
    const outputs = this.session.lastGswbOutputs ?? {};
    let count = 0;

    for (const [sentenceId, output] of Object.entries(outputs)) {
      const sols = output?.solutions ?? [];
      if (sols.length === 0) continue;

      const selectedIds = this.getSelectedSolutionIds({ sentence_id: sentenceId, gswbSolutions: sols });
      const allIds = sols.map(solution => String(solution.id));

      if (!this.sameSelectionIds(selectedIds, allIds)) {
        count++;
      }
    }

    return count;
  }

  get vampireProofCount(): number {
    if (this.vampireProgressProofCount !== null) {
      return this.vampireProgressProofCount;
    }

    const results = this.session.lastVampireResults ?? {};
    let count = 0;

    for (const checks of Object.values(results)) {
      for (const check of checks ?? []) {
        count += (check?.proof_files ?? []).length;
      }
    }

    return count;
  }

  batchParse(sentences: string, rules: string) {
    if (this.runLocked) return;
    if (this.testsuiteUpdateMode === 'write' && this.hasExistingRegressionSessionData()) {
      const confirmed = this.confirmWriteModeOverwrite();
      if (!confirmed) {
        this.displayMessage('Parse all cancelled.', 'blue');
        return;
      }
    }

    this.errorhandle.nativeElement.textContent = "";
    this.sessionPersistenceEnabled = true;
    this.loading = true;
    const runStartedAt = Date.now();
    const baseSnapshot = this.captureParsedRegressionSnapshot();

    this.writeSnapshot = baseSnapshot;
    this.appendSnapshot = this.testsuiteUpdateMode === 'append'
      ? this.cloneParsedRegressionSnapshot(this.writeSnapshot)
      : null;
    this.currentVampireRunKind = 'initial';

    const baseSentenceKeys = new Set(Object.keys(baseSnapshot.sentenceMap ?? {}));
    this.session.testsuiteText = sentences;
    this.session.rulesText = rules;
    this.session.axiomsText = this.axiomEdit.getContent();
    this.syncSessionStateFromUi();

    this.session.timing = {
      startedAt: new Date(runStartedAt).toISOString(),
      parseMs: null,
      vampireMs: null,
      totalMs: null,
    };

    const gswbRunToken = ++this.gswbRunToken;

    if (this.testsuiteUpdateMode === 'write') {
      this.regressionTestResults = [];
      this.regressionTestItems = [];
      this.inferenceResults = [];
      this.vampirePreserveExistingResults = false;
      this.inferenceSummary = "";
      this.parsingSummary = "";
      this.updateConfusionMatrixView(Array.from({ length: 3 }, () => Array(3).fill(0)));
    }

    // reset disambiguation state per run
    this.session.disambiguationMode = false;
    if (this.testsuiteUpdateMode === 'write') {
      this.session.selectedSolutionIdsBySentence = {};
      this.session.lastGswbOutputs = null;
      this.session.lastAnnotations = null;
      this.session.lastVampireResults = null;
      this.session.lastVampireScopeIdsBySentence = {};
      this.session.lastVampireMcIdsBySentence = {};
      this.session.lastVampireSolutionIdsBySentence = {};
      this.session.hasRunVampire = false;
      this.session.sortedMCmap = {};
      this.session.selectedScopeIdsBySentence = {};
      this.session.selectedMcIdsBySentence = {};

      this.dataService.resetLastGswbSession(this.redisSessionKey).subscribe({
        next: () => console.log(`Reset GSWB session ${this.redisSessionKey}`),
        error: error => console.warn("Unable to reset GSWB session before parse.", error)
      });

      this.dataService.resetLastSession(this.redisSessionKey).subscribe({
        next: () => console.log(`Reset Redis session ${this.redisSessionKey}`),
        error: error => console.warn("Unable to reset Redis session before parse.", error)
      });
    }



    this.gswbPreferences.onSubmit();

    const logicType: 'fof' | 'tff' =
      this.vampirePreferences.vampirePreferences.logic_type === 0 ? 'fof' : 'tff';

    this.parse_testfile(sentences);

    this.displayMessage("Sending testsuite to LiGER for parsing ...", "blue");

    const appendSentences = Object.fromEntries(
      Object.entries(this.sentenceMap ?? {}).filter(([key]) => !baseSentenceKeys.has(key))
    );
    const ligerMultipleRequest = {
      sentences: this.testsuiteUpdateMode === 'append' ? appendSentences : this.sentenceMap,
      ruleString: rules,
      logicType: logicType
    };
    this.logBackendPayload('LiGER batch annotate request', this.testsuiteUpdateMode, ligerMultipleRequest);

    this.dataService.ligerBatchAnnotate(ligerMultipleRequest).subscribe(
      data => {
        if (gswbRunToken !== this.gswbRunToken) return;

        if (data.hasOwnProperty("annotations")) {
          console.log("Annotations:", data.annotations);

          // One GswbRequest per sentence, built from that sentence's OWN per-variant
          // solutions -- the same shape glue-vis and chat send to /deduce, one
          // GswbProofInput per syntactic analysis carrying its own structure. The batch
          // used to send flat concatenated meaning constructors with no structure, which
          // is why its discriminants came back with no surface labels and no origin ids,
          // and why every sentence's solution ids were a bare `s0`.
          const sortedIds = Object.keys(data.annotations ?? {}).sort((a, b) => {
            const aNum = parseInt(a.match(/\d+/)?.[0] ?? '0');
            const bNum = parseInt(b.match(/\d+/)?.[0] ?? '0');
            return aNum - bNum;
          });

          const items: Record<string, GswbRequest> = {};
          const sortedMcMap: Record<string, string> = {};
          for (const key of sortedIds) {
            const proofs = this.batchProofInputs(key, data.annotations[key]);
            if (!proofs.length) continue;
            sortedMcMap[key] = proofs.map(proof => proof.meaningConstructors).join('\n');
            items[key] = {
              premises: sortedMcMap[key],
              gswbPreferences: this.gswbPreferences.gswbPreferences,
              structure: proofs[0].structure,
              proofs,
            };
          }

          this.sortedMCmap = sortedMcMap;

          this.gswbMultipleRequest = {
            items,
            gswbPreferences: this.gswbPreferences.gswbPreferences,
            sessionKey: this.redisSessionKey
          };
          this.logBackendPayload('GSWB batch deduce request', this.testsuiteUpdateMode, this.gswbMultipleRequest);

          this.session.lastGswbOutputs = null;
          this.session.lastAnnotations = data.annotations;
          this.session.lastLogicType = logicType;
          this.saveSessionSnapshot();
        }

        if (data.hasOwnProperty("ruleApplicationGraph")) {
          console.log("Rule application graph: ", data.ruleApplicationGraph);
          this.cy1.renderGraph(data.ruleApplicationGraph);
        }

        this.displayMessage("Sending parsing results to GSWB for deduction ...", "blue");

        this.loading = true;
        this.activeGswbRunStartedAt = runStartedAt;
        this.startGswbSummaryPolling(runStartedAt, gswbRunToken);
        this.loadAndRenderGswbState(false, runStartedAt, gswbRunToken);

        this.batchDeduce(this.gswbMultipleRequest).subscribe((result: GswbBatchOutput) => {
          if (gswbRunToken !== this.gswbRunToken) return;

          this.stopGswbSummaryPolling();

          const outputs = result.outputs ?? {};
          this.applyAppendSnapshotToParsedState(outputs);
          this.renderGswbResults(outputs);
          this.commitParsedRegressionSnapshot();
          this.session.timing.parseMs = Date.now() - runStartedAt;
          this.loading = false;
          this.activeGswbRunStartedAt = null;
          this.saveSessionSnapshot();
          this.displayMessage(
            this.testsuiteUpdateMode === 'append'
              ? "Append parsing completed successfully."
              : "Batch processing completed successfully.",
            "green"
          );

          // ========= PAUSE HERE if flag is set =========
          if (this.enableDisambiguation) {
            this.session.disambiguationMode = true;
            this.displayMessage(
              "Disambiguation enabled: open solutions dialogs, select discriminants, then click Continue.",
              "blue"
            );
            return;
          }

          // Otherwise proceed immediately using the selected solutions.
          this.runVampireFromCurrentState(true);
        });
      },
      error => {
        this.stopGswbSummaryPolling();
        console.error('An error occurred:', error);
        this.saveSessionSnapshot();
        this.displayMessage("An error occurred during batch parsing.", "red");
        this.loading = false;
        this.activeGswbRunStartedAt = null;
      }
    );
  }

  private applyAppendSnapshotToParsedState(currentOutputs: Record<string, GswbOutput>): void {
    if (!this.appendSnapshot) {
      this.session.lastGswbOutputs = currentOutputs;
      this.appendUpdatedSentenceIds = new Set(Object.keys(currentOutputs ?? {}));
      return;
    }

    const baseSnapshot = this.writeSnapshot ?? this.appendSnapshot;
    this.sentenceMap = { ...(baseSnapshot?.sentenceMap ?? {}), ...this.sentenceMap };
    this.regressionTestItems = this.mergeItemsById(baseSnapshot?.regressionTestItems ?? [], this.regressionTestItems);
    this.regressionTestResults = this.mergeParseResultsBySentenceId(baseSnapshot?.regressionTestResults ?? [], this.regressionTestResults);
    this.session.lastAnnotations = { ...(baseSnapshot?.annotations ?? {}), ...(this.session.lastAnnotations ?? {}) };
    this.session.lastGswbOutputs = { ...(baseSnapshot?.gswbOutputs ?? {}), ...currentOutputs };
    this.session.selectedSolutionIdsBySentence = { ...(this.session.selectedSolutionIdsBySentence ?? {}) };
    this.session.selectedScopeIdsBySentence = { ...(this.session.selectedScopeIdsBySentence ?? {}) };
    this.session.selectedMcIdsBySentence = { ...(this.session.selectedMcIdsBySentence ?? {}) };
    this.appendUpdatedSentenceIds = new Set(Object.keys(currentOutputs ?? {}));
  }

  private mergeItemsById(existingItems: any[], newItems: any[]): any[] {
    const byId = new Map<string, any>();
    (existingItems ?? []).forEach(item => {
      const id = String(item?.id ?? '');
      if (id) byId.set(id, item);
    });
    (newItems ?? []).forEach(item => {
      const id = String(item?.id ?? '');
      if (id) byId.set(id, item);
    });
    return Array.from(byId.values());
  }

  private mergeParseResultsBySentenceId(existingResults: RegressionParseResult[], newResults: RegressionParseResult[]): RegressionParseResult[] {
    const byId = new Map<string, RegressionParseResult>();
    (existingResults ?? []).forEach(result => byId.set(result.sentence_id, result));
    (newResults ?? []).forEach(result => byId.set(result.sentence_id, result));
    return Array.from(byId.values());
  }

  // Builds NLI items + runs Vampire.
  // If useDisambiguated=true, filters each sentence’s solutions by selectedSolutionIdsBySentence.
  private runVampireFromCurrentState(useDisambiguated: boolean): void {
    if (!this.session.lastGswbOutputs || !this.session.lastAnnotations) {
      console.warn("No stored GSWB/LiGER state to proceed to Vampire.");
      return;
    }

    const gswbOutputs = this.session.lastGswbOutputs;
    const annotations = this.session.lastAnnotations;
    const logicType = this.session.lastLogicType;
    const vampireStartedAt = Date.now();
    const vampireRunToken = ++this.vampireRunToken;
    this.vampirePreserveExistingResults = Object.keys(this.session.lastVampireResults ?? {}).length > 0;
    // Dropped up front: these describe the last preparation, and a run that prepares
    // nothing (a non-LFGxDRT run, or an aborted one) must not write the previous run's
    // branches into the document against this run's verdicts.
    this.preparedNliPairs = [];
    this.nliPreparationFailures = [];
    this.nliPreparationDegradations = [];
    this.vampireCurrentRunItemCount = 0;
    this.vampireReprocessingItemCount = 0;
    this.vampireNewItemCount = 0;
    this.currentVampireRunKind = this.testsuiteUpdateMode === 'append'
      ? 'append'
      : (this.vampirePreserveExistingResults ? 'rerun' : 'initial');
    const appendMode = this.testsuiteUpdateMode === 'append' && !!this.appendSnapshot;
    const priorItemIds = new Set((this.appendSnapshot?.regressionTestItems ?? []).map(item => String(item?.id ?? '')));
    const priorInferenceIds = new Set((this.appendSnapshot?.inferenceResults ?? this.inferenceResults ?? []).map(result => String(result?.id ?? '')));
    const updatedSentenceIds = this.appendUpdatedSentenceIds ?? new Set<string>();

    const previousVampireScopeIdsBySentence = this.cloneSelectionRecord(this.session.lastVampireScopeIdsBySentence);
    const previousVampireMcIdsBySentence = this.cloneSelectionRecord(this.session.lastVampireMcIdsBySentence);
    const previousVampireSolutionIdsBySentence = this.cloneSelectionRecord(this.session.lastVampireSolutionIdsBySentence ?? {});
    const previousVampireResults = this.session.lastVampireResults ?? {};

    this.session.disambiguationMode = false;

    this.displayMessage("Sending NLI items to Vampire ...", "blue");
    console.log("Preparing call to Vampire ...");

    const inference_items: Record<string, nliItem> = {};

    const itemsToConsider = this.regressionTestItems;

    for (let item of itemsToConsider) {
      const itemId = String(item?.id ?? '');
      const isNewlyAppended = appendMode && itemId !== '' && !priorItemIds.has(itemId);
      const isAlreadyProcessed = priorInferenceIds.has(itemId);
      const selectionChanged = this.hasVampireSelectionChangedForItem(
        item,
        previousVampireScopeIdsBySentence,
        previousVampireMcIdsBySentence,
        previousVampireSolutionIdsBySentence
      );
      const parseChanged = appendMode && this.itemTouchesUpdatedSentences(item, updatedSentenceIds);

      if (!isNewlyAppended && isAlreadyProcessed && !selectionChanged && !parseChanged) continue;
      if (appendMode && !isNewlyAppended && !selectionChanged && !parseChanged) continue;

      let axioms = this.axiomEdit.getContent();
      let axiomCounter = 0;

      const premise_strings: string[] = [];
      for (let premise of item.premises) {
        if (gswbOutputs[premise] && gswbOutputs[premise].solutions.length > 0) {
          // One selection, then text/graph/id read off the same solutions. They used to be
          // selected twice, by two filters that could disagree -- a solution without a
          // graph left the text list one longer than the graph list, and the two were then
          // indexed against each other.
          const solutions = this.selectedSolutions(premise, gswbOutputs, useDisambiguated);
          const sols = solutions.map(solution => this.solutionText(solution));
          if (sols.length > 0) {
            premise_strings.push(sols.join('\n'));
          }

          // Axioms are per syntactic analysis now; collect across all of them, deduped
          // by the existing `axioms.includes` guard below.
          const premiseAxioms = (annotations[premise]?.solutions ?? [])
            .flatMap(solution => solution.axioms ?? []);
          if (premiseAxioms.length) {
            for (let axiom of premiseAxioms) {
              if (axiom.trim() !== '' && !axioms.includes(axiom.trim())) {
                axioms += logicType + "(" +
                  "axiom" + axiomCounter + ",axiom," + axiom + ').\n';
                axiomCounter++;
              }
            }
          } else {
            // optional: console.log("No axioms for premise:", premise);
          }
        }
      }

      const conclusion_strings: string[] = [];
      for (let conclusion of item.conclusion) {
        if (gswbOutputs[conclusion] && gswbOutputs[conclusion].solutions.length > 0) {
          const solutions = this.selectedSolutions(conclusion, gswbOutputs, useDisambiguated);
          const sols = solutions.map(solution => this.solutionText(solution));
          if (sols.length > 0) {
            conclusion_strings.push(sols.join('\n'));
          }

          const conclusionAxioms = (annotations[conclusion]?.solutions ?? [])
            .flatMap(solution => solution.axioms ?? []);
          if (conclusionAxioms.length) {
            for (let axiom of conclusionAxioms) {
              if (axiom.trim() !== '' && !axioms.includes(axiom.trim())) {
                axioms += logicType + "(" +
                  "axiom" + axiomCounter + ",axiom," + axiom + ').\n';
                axiomCounter++;
              }
            }
          } else {
            // optional: console.log("No axioms for conclusion:", conclusion);
          }
        }
      }

      if (premise_strings.length > 0 && conclusion_strings.length > 0) {
        inference_items[item.id] = {
          premises: premise_strings,
          hypothesis: conclusion_strings,
          axioms: axioms,
          premise_sentence_ids: item.premises,
          hypothesis_sentence_ids: item.conclusion
        };
        if (previousVampireResults[item.id] && previousVampireResults[item.id].length > 0) {
          this.vampireReprocessingItemCount++;
        } else {
          this.vampireNewItemCount++;
        }
      }
    }

    this.vampireCurrentRunItemCount = Object.keys(inference_items).length;
    if (Object.keys(inference_items).length === 0) {
      this.displayMessage("No missing Vampire items to process.", "blue");
      return;
    }

    if (Number(this.session.gswbPreferences.outputstyle) !== 5) {
      this.submitVampireRequest(
        inference_items,
        this.contextPruning.nativeElement.checked,
        vampireStartedAt,
        vampireRunToken,
        false
      );
      return;
    }

    this.displayMessage("Building TPTP reasoning checks ...", "blue");
    const typed = logicType === 'tff';
    const pruning = this.contextPruning.nativeElement.checked;
    const itemBuilds: NliItemBuild[] = [];
    for (const [id, item] of Object.entries(inference_items)) {
      const premiseSentenceIds = item.premise_sentence_ids ?? [];
      const hypothesisSentenceIds = item.hypothesis_sentence_ids ?? [];
      if (!premiseSentenceIds.length || !hypothesisSentenceIds.length) continue;
      // The regression item id IS the reasoning update id -- ru-n3, not the element-pair
      // form chat gets. Every branch of the item's chained sequence build below is
      // another assignment of that one update.
      const updateId = reasoningUpdateId(premiseSentenceIds, hypothesisSentenceIds, id);
      itemBuilds.push({ itemId: id, updateId, premiseSentenceIds, hypothesisSentenceIds });
    }

    if (!itemBuilds.length) {
      this.displayMessage("No reading assignments to build TPTP reasoning checks from.", "red");
      this.loading = false;
      return;
    }

    // Strictly one item at a time. Two of these chains in flight at once has been observed
    // to leave an HttpClient observable that never emits -- the reason
    // ReasoningPipelineService exposes a sequential driver at all -- and this used to be a
    // forkJoin over every pair of every item at once. concatMap over the whole per-item
    // chain also serializes the sequence/merge calls that precede the pipeline, which the
    // service's own sequential driver cannot do because they happen before its input exists.
    from(itemBuilds).pipe(
      concatMap(build => this.prepareNliItem(build, gswbOutputs, useDisambiguated, typed, logicType, pruning)),
      toArray()
    ).subscribe({
      next: prepared => {
        for (const item of Object.values(inference_items)) item.tptp_checks = [];
        const failures: string[] = [];
        const degradations: string[] = [];
        for (const preparedPair of prepared) {
          failures.push(...preparedPair.failures);
          degradations.push(...preparedPair.degradations);
          inference_items[preparedPair.itemId].tptp_checks!.push(
            ...preparedPair.assignments.map(assignment => ({
              pairId: assignment.pairId,
              assignmentId: assignment.assignmentId,
              mappingId: assignment.mappingId,
              checks: assignment.checks,
              contextTptp: assignment.contextTptp,
            } as any))
          );
        }
        // Kept as run state so the results view can show what was NOT cleanly reasoned
        // over. A branch that lost its anaphora binding still produces a usable bundle;
        // presenting it as a clean result is the thing to avoid.
        this.nliPreparationFailures = failures;
        this.nliPreparationDegradations = degradations;
        this.preparedNliPairs = prepared;
        const bundleCount = prepared.reduce((sum, pair) => sum + pair.assignments.length, 0);
        console.info('[Regression] NLI reasoning bundles prepared',
          { pairCount: prepared.length, bundleCount, failures, degradations });
        if (!bundleCount) {
          this.displayMessage("Could not build TPTP reasoning checks for any reading.", "red");
          this.loading = false;
          return;
        }
        if (failures.length || degradations.length) {
          this.displayMessage(
            `Built ${bundleCount} reasoning bundle(s); ${failures.length} branch(es) failed, `
            + `${degradations.length} lost their anaphora binding.`, "blue");
        }
        this.submitVampireRequest(
          inference_items,
          pruning,
          vampireStartedAt,
          vampireRunToken,
          true
        );
      },
      error: error => {
        console.warn('[Regression] NLI reasoning preparation failed', error);
        this.displayMessage("Could not build TPTP reasoning checks.", "red");
        this.loading = false;
      }
    });
  }

  /** One NLI item, all the way to prepared bundles -- built document-first, the way chat
   *  builds a discourse: register the first premise sentence's own (disambiguated)
   *  batch-parse reading(s) as the seed, then rebase-merge every remaining sentence in
   *  order (later premises, then the hypothesis) via
   *  DocumentBuilderService.mergeSequence, letting LiGER re-derive and positionally
   *  renumber each new sentence inside the growing sequence instead of matching it back
   *  to an independent reading afterward. No pruning until
   *  ReasoningPipelineService.prepareReasoningChecks's own `prune` at the very end --
   *  every branch (one full reading-path through every sentence) is reasoned over.
   *
   *  Replaces the old sequenceSolution/rebasedReadings/matchReading/conditionSignature/
   *  readingRank chain, whose string-based reading match threw on any alphabetic-variant
   *  renaming introduced by rebasing (confirmed live on "A boxer with an injury lost a
   *  fight" -- see docs/plans/REGRESSION_STAGE4_HANDOFF.md). Also removes a redundancy
   *  that chain had: the syntax merge and every sentence's deduce used to run once per
   *  (premise reading x hypothesis reading) pair; each fold step below runs once per item,
   *  fanned out over every surviving branch in one shared `mergeSequence` call. */
  private prepareNliItem(
    build: NliItemBuild,
    gswbOutputs: Record<string, GswbOutput>,
    useDisambiguated: boolean,
    typed: boolean,
    logicType: 'fof' | 'tff',
    pruning: boolean
  ): Observable<PreparedNliPair> {
    const ruleString = this.session.rulesText;
    const gswbPreferences = this.session.gswbPreferences;
    const resolveDrs = !!this.session.gswbPreferences?.resolveDrs;
    // This item's own discourse. Every registration below writes here and nowhere else,
    // so one item's build cannot see or corrupt another's -- see registerAnalysisSentences.
    const document = this.documentFor(build.itemId);

    const remaining: Array<{ sentenceId: string; side: 'premise' | 'hypothesis' }> = [
      ...build.premiseSentenceIds.slice(1).map(sentenceId => ({ sentenceId, side: 'premise' as const })),
      ...build.hypothesisSentenceIds.map(sentenceId => ({ sentenceId, side: 'hypothesis' as const })),
    ];

    return this.seedNliChainBranches(document, build.premiseSentenceIds[0], gswbOutputs, useDisambiguated, ruleString, logicType).pipe(
      map(seed => {
        if (!seed.length) {
          throw new Error(`No selected reading for ${build.premiseSentenceIds[0]}.`);
        }
        return seed;
      }),
      switchMap(seedBranches => remaining.reduce(
        (branches$, next) => branches$.pipe(
          switchMap(branches => this.foldSentenceIntoBranches(
            document, branches, next, ruleString, logicType, gswbPreferences, resolveDrs,
            this.selectedDiscriminantIdentifiers(next.sentenceId, gswbOutputs, useDisambiguated)))),
        of(seedBranches)
      )),
      switchMap(branches => {
        this.registerFinalSequence(document, build, branches);
        return from(branches).pipe(
          concatMap((branch, index) => this.prepareBranchChecks(build, branch, index, typed, pruning)),
          toArray(),
          // The pragmatic layer. Written BEFORE the reasoning updates, because a
          // ReasoningAssignment's id names the anaphora branch it was built from and
          // validateReasoningUpdate resolves that hop.
          tap(prepared => this.registerDiscourseUpdate(document, build, branches, prepared)),
          map(prepared => ({
            itemId: build.itemId,
            scopeId: build.updateId,
            assignments: prepared.flatMap(result => result.assignments),
            failures: prepared.flatMap(result => result.failures),
            degradations: prepared.flatMap(result => result.degradations),
          } as PreparedNliPair))
        );
      }),
      // One item's failure used to abort the whole batch: every pair of every item used
      // to live in one forkJoin under a single error handler. An item that cannot be
      // prepared at all is now a reported failure of that item alone; a branch that fails
      // only its own final reasoning call is isolated further, in prepareBranchChecks.
      catchError(error => {
        const reason = `${build.itemId}: ${error?.message ?? String(error)}`;
        console.warn('[Regression] NLI item could not be prepared', { itemId: build.itemId, error });
        return of({
          itemId: build.itemId, scopeId: build.updateId,
          assignments: [], failures: [reason], degradations: [],
        } as PreparedNliPair);
      })
    );
  }

  /** The starting branch(es) for one item's chain: one per selected reading of its FIRST
   *  premise sentence, registered from its independent batch-parse reading. No LiGER
   *  re-derivation of the SEMANTICS is needed for a lone first sentence -- positional
   *  SYN-ID numbering only matters relative to other sentences already in the sequence,
   *  and there are none yet -- but the SYNTAX still comes from a fresh one-sentence
   *  `ligerSequence` call; see `seedSentenceSyntax`. */
  private seedNliChainBranches(
    document: XlePlusGlueDocument,
    sentenceId: string,
    gswbOutputs: Record<string, GswbOutput>,
    useDisambiguated: boolean,
    ruleString: string,
    logicType: 'fof' | 'tff',
  ): Observable<NliChainBranch[]> {
    return this.registerBatchParsedSentence(document, sentenceId, gswbOutputs, useDisambiguated, ruleString, logicType).pipe(
      map(registered => {
        if (!registered) return [];
        return registered.semantics.map(semantic => ({
          element: {
            id: sentenceId,
            text: this.sentenceMap[sentenceId] ?? '',
            syntax: [registered.syntax],
            semantics: [semantic],
            synSemMapping: { [registered.syntax.synId]: [semantic.semId] },
          },
          semantic,
          sentenceIdsSoFar: [sentenceId],
          // A single premise needs no merge call: its own semantic IS the prior. See
          // ReasoningPairRequest.premiseSemantic.
          premiseSemantic: semantic.semString,
          premiseSemanticIds: [semantic.semId],
          hypothesisSemanticIds: [],
          premiseAsts: [semantic.graph as LigerStructure],
          hypothesisAsts: [],
        }));
      })
    );
  }

  /** The seed sentence's own syntax, sourced from a bare one-sentence `ligerSequence`
   *  call -- mirroring chat's turn 1 (`chat.component.ts`'s own comment on why: keeps
   *  LiGER's solution-key numbering consistent with what a later rebase fold expects) --
   *  rather than `session.lastAnnotations[sentenceId].structureJson`. Confirmed live and
   *  against the LiGER source (2026-08-21) that the batch-parse endpoint
   *  (`/apply_rules_to_batch`, `LigerController.applyRulesToTestsuiteNew`) unconditionally
   *  builds its `LigerRuleAnnotation` via the 6-arg constructor, which never sets
   *  `structureJson` and always leaves `structureVariants` empty -- true for every
   *  sentence, ambiguous or not, not just an edge case. Only `.graph` (display-only,
   *  a `LigerWebGraph`) is populated from that endpoint. */
  private seedSentenceSyntax(
    sentenceId: string, ruleString: string, logicType: 'fof' | 'tff'
  ): Observable<SyntacticAnalysis> {
    return this.dataService.ligerSequence({
      sentences: [this.sentenceMap[sentenceId] ?? ''],
      sentenceIds: [sentenceId],
      ruleString,
      logicType,
    }).pipe(
      map(sequence => {
        const solution = sequence?.solutions?.[0];
        const structureJson = solution?.structureJson;
        if (!structureJson) {
          throw new Error(`LiGER returned no structure for ${sentenceId}.`);
        }
        const synId = solution?.sequenceAnalysis?.sentences?.[0]?.syntax?.[0]?.synId ?? `${sentenceId}-syn`;
        return {
          synId,
          structure: structureJson as LigerStructure,
          graph: this.session.lastAnnotations?.[sentenceId]?.solutions?.[0]?.graph,
        };
      })
    );
  }

  /** Registers one sentence's independent batch-parse reading(s) into the document,
   *  filtered to this run's disambiguation selection (matching every other reader of
   *  `selectedSolutions`), paired with a freshly-fetched syntax (`seedSentenceSyntax`).
   *  The semantic content itself is NOT re-derived -- only the syntax needs a real
   *  `ligerSequence`-consistent structure; the selected GSWB solution's own reading is
   *  used verbatim, so there is no reading to match back against anything. */
  private registerBatchParsedSentence(
    document: XlePlusGlueDocument,
    sentenceId: string,
    gswbOutputs: Record<string, GswbOutput>,
    useDisambiguated: boolean,
    ruleString: string,
    logicType: 'fof' | 'tff',
  ): Observable<{ syntax: SyntacticAnalysis; semantics: SemanticAnalysis[] } | null> {
    const solutions = this.selectedSolutions(sentenceId, gswbOutputs, useDisambiguated);
    if (!solutions.length) return of(null);

    return this.seedSentenceSyntax(sentenceId, ruleString, logicType).pipe(
      map(syntax => {
        const semantics: SemanticAnalysis[] = solutions.map(solution => ({
          ...(solution.semanticAnalysis ?? {
            syntacticOrigin: syntax.synId,
            semId: solution.id,
            semString: solution.semantic || solution.solution || '',
            graph: solution.graph,
            semType: 'lfgxdrt',
          }),
          // Must resolve to a synId registered under this SAME sentence entry -- see
          // SequenceMergePair.currentSyntax's doc on why the fallback above is not trusted
          // as-is even when a server-provided semanticAnalysis is present.
          syntacticOrigin: syntax.synId,
        }));
        const synSemMapping: SynSemMapping = { [syntax.synId]: semantics.map(semantic => semantic.semId) };

        this.documentBuilder.upsertSentenceAnalyses(document, [{
          id: sentenceId,
          text: this.sentenceMap[sentenceId] ?? '',
          syntax: [syntax],
          semantics,
          synSemMapping,
        }]);
        return { syntax, semantics };
      })
    );
  }

  /** Folds one more sentence (a later premise, or the hypothesis) into every surviving
   *  branch at once -- one `mergeSequence` rebase call for however many branches there
   *  are, not one per branch, since a shared previous-context set is exactly what
   *  `mergeSequence`'s own concatMap-based fan-out is for. Matched back to its
   *  originating branch by object identity, same as chat's own `previousContextByElement`
   *  Map, because several branches can legitimately share one elementId (several
   *  readings of the same prior). */
  private foldSentenceIntoBranches(
    document: XlePlusGlueDocument,
    branches: NliChainBranch[],
    next: { sentenceId: string; side: 'premise' | 'hypothesis' },
    ruleString: string,
    logicType: 'fof' | 'tff',
    gswbPreferences: GswbPreferences,
    resolveDrs: boolean,
    selectedDiscriminantIdentifiers: string[] = [],
  ): Observable<NliChainBranch[]> {
    const branchByElement = new Map(branches.map(branch => [branch.element, branch]));
    const previousContexts: SequenceMergePreviousContext[] = branches.map(branch =>
      ({ semantic: branch.semantic, element: branch.element }));
    const newSentenceText = this.sentenceMap[next.sentenceId] ?? '';

    return this.documentBuilder.mergeSequence({
      current: [],
      previousContexts,
      knownSentences: document.sentences,
      resolveDrs,
      rebase: {
        newSentence: { id: next.sentenceId, text: newSentenceText },
        ruleString,
        logicType,
        gswbPreferences,
        selectedDiscriminantIdentifiers,
      },
    }).pipe(
      map(result => {
        if (!result.pairs.length) {
          // Say WHY. This used to be the whole message, which is how a real
          // /apply_rules_xle_sequence 500 surfaced as an unexplained fold failure --
          // see docs/bug_reports/regression_second_fold_null_structure_500.md.
          const detail = result.failures.length ? ` ${result.failures.join(' ')}` : '';
          throw new Error(`Could not fold ${next.sentenceId} into any branch.${detail}`);
        }

        // The reading used for reasoning is the one derived here, freshly, inside the
        // sequence (see DocumentBuilderService.SequenceMergeRebase) -- register it under
        // this sentence's OWN document entry now, unioned with whatever it already had
        // from batch parse. The independent batch-parse reading stays too, for the
        // parsing report panel and disambiguation.
        const syntaxById = new Map<string, SyntacticAnalysis>();
        const semanticById = new Map<string, SemanticAnalysis>();
        const synSemMapping: SynSemMapping = {};
        result.pairs.forEach(pair => {
          if (!pair.currentSyntax || !pair.currentSemantic) return;
          syntaxById.set(pair.currentSyntax.synId, pair.currentSyntax);
          semanticById.set(pair.currentSemantic.semId, pair.currentSemantic);
          const mapped = synSemMapping[pair.currentSyntax.synId] ?? [];
          if (!mapped.includes(pair.currentSemantic.semId)) mapped.push(pair.currentSemantic.semId);
          synSemMapping[pair.currentSyntax.synId] = mapped;
        });
        if (syntaxById.size) {
          this.documentBuilder.upsertSentenceAnalyses(document, [{
            id: next.sentenceId,
            text: newSentenceText,
            syntax: Array.from(syntaxById.values()),
            semantics: Array.from(semanticById.values()),
            synSemMapping,
          }]);
        }

        const isPremise = next.side === 'premise';
        const folded: NliChainBranch[] = [];
        result.pairs.forEach(pair => {
          const branch = branchByElement.get(pair.previousElement);
          if (!branch || !pair.currentSemantic || !pair.sequenceStructure || !pair.merged.semanticAnalysis) {
            console.error('[Regression] merged pair is missing a required field; dropping this branch', {
              sentenceId: next.sentenceId, previousElementId: pair.previousElement.id,
            });
            return;
          }
          const sentenceIdsSoFar = [...branch.sentenceIdsSoFar, next.sentenceId];
          const currentGraph = pair.currentSemantic.graph as LigerStructure;
          folded.push({
            element: {
              id: compositeAnalysisId(sentenceIdsSoFar),
              text: sentenceIdsSoFar.map(id => this.sentenceMap[id] ?? '').join(' '),
              sentenceIds: sentenceIdsSoFar,
              syntax: pair.currentSyntax ? [pair.currentSyntax] : [],
              semantics: [pair.merged.semanticAnalysis],
              synSemMapping: pair.currentSyntax
                ? { [pair.currentSyntax.synId]: [pair.merged.semanticAnalysis.semId] } : {},
            },
            semantic: pair.merged.semanticAnalysis,
            sentenceIdsSoFar,
            sequenceStructure: pair.sequenceStructure,
            merged: pair.merged,
            // Kept exactly as it was once the hypothesis starts folding in -- the prior
            // (`Q`) is the merged premises alone, never premises + conclusion.
            premiseSemantic: isPremise ? pair.merged.semantic : branch.premiseSemantic,
            premiseSemanticIds: isPremise
              ? [...branch.premiseSemanticIds, pair.currentSemantic.semId]
              : branch.premiseSemanticIds,
            hypothesisSemanticIds: isPremise
              ? branch.hypothesisSemanticIds
              : [...branch.hypothesisSemanticIds, pair.currentSemantic.semId],
            premiseAsts: isPremise ? [...branch.premiseAsts, currentGraph] : branch.premiseAsts,
            hypothesisAsts: isPremise ? branch.hypothesisAsts : [...branch.hypothesisAsts, currentGraph],
          });
        });
        if (!folded.length) {
          throw new Error(`Every branch lost a required field while folding in ${next.sentenceId}.`);
        }
        return folded;
      })
    );
  }

  /** Registers the item's complete premises+hypothesis sequence once, aggregating every
   *  surviving branch's own final reading into one SequenceAnalysis -- mirrors chat's
   *  `upsertSequenceFromContexts`, unconditional here (every branch is kept, not just
   *  Vampire-accepted ones: an NLI item's premises/hypothesis are given up front, not
   *  discovered turn by turn). Intermediate (premises-only, or partial-hypothesis)
   *  sequences along the chain are never registered as document elements -- nothing else
   *  needs to reference them, only the complete item sequence a ReasoningUpdate's
   *  sourceElementId points at. */
  private registerFinalSequence(
    document: XlePlusGlueDocument, build: NliItemBuild, branches: NliChainBranch[]
  ): void {
    const allSentenceIds = [...build.premiseSentenceIds, ...build.hypothesisSentenceIds];
    const sequenceId = compositeAnalysisId(allSentenceIds);
    const syntaxById = new Map<string, SyntacticAnalysis>();
    const semanticsById = new Map<string, SemanticAnalysis>();
    const synSemMapping: SynSemMapping = {};

    branches.forEach(branch => {
      const semantic = branch.merged?.semanticAnalysis;
      if (!semantic || !branch.sequenceStructure) return;
      const synId = semantic.syntacticOrigin;
      if (synId && !syntaxById.has(synId)) {
        // As chat's own upsertSequenceFromContexts does: .graph is display-only and
        // unused by mergeSequence's syntax merge, so the merged structure stands in for
        // both fields rather than leaving a real LigerWebGraph unbuilt here.
        syntaxById.set(synId, { synId, structure: branch.sequenceStructure, graph: branch.sequenceStructure } as unknown as SyntacticAnalysis);
      }
      if (!semanticsById.has(semantic.semId)) semanticsById.set(semantic.semId, semantic);
      if (synId) {
        const mapped = synSemMapping[synId] ?? [];
        if (!mapped.includes(semantic.semId)) mapped.push(semantic.semId);
        synSemMapping[synId] = mapped;
      }
    });

    if (!semanticsById.size) return;

    this.documentBuilder.upsertSequenceAnalyses(document, [{
      id: sequenceId,
      text: allSentenceIds.map(id => this.sentenceMap[id] ?? '').join(' '),
      sentenceIds: allSentenceIds,
      syntax: Array.from(syntaxById.values()),
      semantics: Array.from(semanticsById.values()),
      synSemMapping,
    }]);
  }

  /** One branch's final reasoning call, isolated so one branch's failure never drops the
   *  others -- mirrors the old per-pair catchError, just at branch instead of pair
   *  granularity now that the syntax merge and per-sentence deduce run once per item. */
  /** Records this item's pragmatic analyses -- one `DiscourseAnalysis` per PCDRS branch,
   *  linked to the merged reading it annotates.
   *
   *  Regression never wrote these. The data was always there: `prepareReasoningChecks`
   *  returns each assignment's `mapping`, `baseStructure`/`mergedStructure` and their
   *  graphs, and regression consumed them to build the Vampire bundles and then dropped
   *  them. Chat and glue-vis take the same values and register them, which is why only
   *  regression's documents had no `prag` layer at all -- and it was categorical, not a
   *  property of the examples: chat writes a DiscourseUpdate even for a pronoun-free
   *  discourse, where `anaphoraMapping.relations` is legitimately empty. "Post-processing
   *  ran and bound nothing" is a different fact from "post-processing never ran", and
   *  only the first is recoverable from a stored document.
   *
   *  With this, `(syn_id, sem_id, prag_id)` is recoverable for an item without
   *  materialising the triples: syntax -> semantics via the sentence/sequence
   *  `synSemMapping`, semantics -> pragmatics via `semDiscourseMapping`. */
  private registerDiscourseUpdate(
    document: XlePlusGlueDocument,
    build: NliItemBuild,
    branches: NliChainBranch[],
    prepared: PreparedReasoningPair[],
  ): void {
    const sequenceId = compositeAnalysisId([...build.premiseSentenceIds, ...build.hypothesisSentenceIds]);
    if (!document.sequences.some(sequence => sequence.id === sequenceId)) {
      return;
    }

    const structures: Record<string, LigerStructure> = {};
    const mergedGraphs: Record<string, LigerWebGraph> = {};
    const discourse: DiscourseAnalysis[] = [];
    const semDiscourseMapping: Record<string, string[]> = {};

    // `prepared` is built by concatMap over `branches`, so index i belongs to branch i.
    prepared.forEach((pair, index) => {
      const semId = branches[index]?.merged?.semanticAnalysis?.semId;
      if (!semId) return;

      (pair.assignments ?? []).forEach(assignment => {
        if (assignment.baseStructure) {
          structures[assignment.baseStructureId] = assignment.baseStructure;
          if (assignment.baseGraph) mergedGraphs[assignment.baseStructureId] = assignment.baseGraph;
        }
        if (assignment.mergedStructure) {
          structures[assignment.structureId] = assignment.mergedStructure;
          if (assignment.mergedGraph) mergedGraphs[assignment.structureId] = assignment.mergedGraph;
        }

        const discourseId = assignment.mappingId
          ?? `${semId}-pcdrs-${assignment.ruleBranchIndex}`;
        if (discourse.some(entry => entry.id === discourseId)) return;

        const mapped = semDiscourseMapping[semId] ?? [];
        if (!mapped.includes(discourseId)) mapped.push(discourseId);
        semDiscourseMapping[semId] = mapped;

        discourse.push({
          id: discourseId,
          semanticOrigin: semId,
          drsString: assignment.mapping?.semantic ?? '',
          drsGraph: assignment.mapping?.graph,
          structureId: assignment.structureId,
          anaphoraMapping: {
            relations: assignment.mapping?.anaphoraRelations ?? [],
          } as AnaphoraMappingModel,
          collapsed: (assignment.mapping?.anaphoraRelations?.length ?? 0) > 0,
        });
      });
    });

    if (!discourse.length) return;

    document.discourseUpdates = [
      ...(document.discourseUpdates ?? []).filter(existing => existing.id !== `du-${sequenceId}`),
      {
        id: `du-${sequenceId}`,
        sourceElementId: sequenceId,
        sourceElementKind: 'sequence',
        structures,
        mergedGraphs,
        discourse,
        semDiscourseMapping,
      },
    ];
    console.info('[Regression] discourse update registered', {
      itemId: build.itemId, sequenceId, branches: discourse.length,
      anaphoraResolved: discourse.filter(entry => entry.collapsed).length,
    });
  }

  private prepareBranchChecks(
    build: NliItemBuild,
    branch: NliChainBranch,
    branchIndex: number,
    typed: boolean,
    pruning: boolean,
  ): Observable<PreparedReasoningPair> {
    const pairId = `pxq-${build.itemId}-${branchIndex + 1}`;
    if (!branch.sequenceStructure || !branch.merged) {
      return of({
        scopeId: pairId, assignments: [],
        failures: [`${pairId}: no merged sequence for this branch.`], degradations: [],
      });
    }
    return this.reasoningPipeline.prepareReasoningChecks({
      scopeId: pairId,
      scope: {
        updateId: build.updateId,
        premiseSemanticIds: branch.premiseSemanticIds,
        hypothesisSemanticIds: branch.hypothesisSemanticIds,
      },
      merged: branch.merged,
      premiseSemantic: branch.premiseSemantic,
      sequenceStructure: branch.sequenceStructure,
      premiseAsts: branch.premiseAsts,
      hypothesisAsts: branch.hypothesisAsts,
      typed,
      prune: pruning,
      ruleString: APP_DEFAULTS.graphInspector.rulesText,
    }).pipe(
      catchError(error => {
        const reason = `${pairId}: ${error?.message ?? String(error)}`;
        console.warn('[Regression] NLI branch could not be prepared', { itemId: build.itemId, error });
        return of({ scopeId: pairId, assignments: [], failures: [reason], degradations: [] } as PreparedReasoningPair);
      })
    );
  }

  private submitVampireRequest(
    inference_items: Record<string, nliItem>,
    pruning: boolean,
    vampireStartedAt: number,
    vampireRunToken: number,
    tptpMode: boolean
  ): void {
    const tptpItems: Record<string, nliItem> = Object.fromEntries(
      Object.entries(inference_items).map(([id, item]) => [id, {
        premises: tptpMode ? [] : item.premises,
        hypothesis: tptpMode ? [] : item.hypothesis,
        axioms: item.axioms,
        ...(tptpMode ? { tptp_checks: item.tptp_checks ?? [] } : {})
      }])
    );
    const vampireRequest: vampireMultipleRequest = {
      nli_items: tptpItems,
      vampire_preferences: this.vampirePreferences.vampirePreferences,
      pruning,
      session_key: this.redisSessionKey
    };

    this.logBackendPayload('Vampire batch request', this.testsuiteUpdateMode, vampireRequest);
    console.log("Vampire request: ", vampireRequest);

    this.session.lastVampireScopeIdsBySentence = this.cloneSelectionRecord(this.session.selectedScopeIdsBySentence);
    this.session.lastVampireMcIdsBySentence = this.cloneSelectionRecord(this.session.selectedMcIdsBySentence);
    this.session.lastVampireSolutionIdsBySentence = this.cloneSelectionRecord(this.session.selectedSolutionIdsBySentence);
    this.session.hasRunVampire = true;
    this.saveSessionSnapshot();

    this.loading = true;
    this.vampirePendingItemCount = Object.keys(inference_items).length;
    this.activeVampireRunStartedAt = vampireStartedAt;
    this.vampireProgressBaselineCount = this.currentVampireRunKind === 'initial'
      ? 0
      : Object.keys(this.session.lastVampireResults ?? {}).length;
    // Bundles already on record for items this run is not redoing -- the same
    // already-done offset vampireProgressBaselineCount applies at item granularity.
    this.vampireProofBaselineCount = this.currentVampireRunKind === 'initial'
      ? 0
      : Object.values(this.session.lastVampireResults ?? {})
        .reduce((sum, checks) => sum + (checks?.length ?? 0), 0);
    this.startVampireProgressIndicator(
      this.vampireCurrentRunItemCount + this.vampireProgressBaselineCount,
      this.submittedProofBundleCount(vampireRequest));

    // Clear the PREVIOUS run's progress record before polling starts. It is only cleared
    // automatically on cancel, so after a normal run it stays in Redis describing a
    // completed run (itemCount == totalItemCount) -- and the first poll below fires
    // before the vampire service has written this run's own "running" snapshot, so it
    // read that stale record and painted a full bar until the real snapshot landed a
    // couple of seconds later. A failed clear must not block the run: worst case the bar
    // is briefly wrong again, which is strictly better than not running.
    this.dataService.clearVampireProgress(this.redisSessionKey).pipe(
      catchError(error => {
        console.warn('Unable to clear the previous run\'s Vampire progress record.', error);
        return of(null);
      })
    ).subscribe(() => {
      if (vampireRunToken !== this.vampireRunToken) return;
      this.startVampireSummaryPolling(vampireStartedAt, vampireRunToken);
    });
    this.loadAndRenderVampireState(false, vampireStartedAt, vampireRunToken);

    this.batchVampire(vampireRequest).subscribe({
      next: () => {
        this.stopVampireSummaryPolling();
        this.loadAndRenderVampireState(true, vampireStartedAt, vampireRunToken);
      },
      error: () => {
        this.stopVampireSummaryPolling();
        this.vampirePendingItemCount = null;
        this.activeVampireRunStartedAt = null;
        this.loading = false;
        this.clearVampireProgressIndicator();
        this.saveSessionSnapshot();
      }
    });
  }

  private itemTouchesUpdatedSentences(item: any, updatedSentenceIds: Set<string>): boolean {
    if (!updatedSentenceIds.size) return false;

    const sentenceIds = [...(item?.premises ?? []), ...(item?.conclusion ?? [])].map((sid: any) => String(sid ?? ''));
    return sentenceIds.some(sentenceId => updatedSentenceIds.has(sentenceId));
  }

  /** The solutions of one sentence that this run should reason over.
   *
   *  The single selection point: text, semantic graph and solution id are all read off
   *  what this returns, so they cannot drift apart. It also owns the one filter that used
   *  to live only on the graph side -- an LFGxDRT reading with no graph cannot be a
   *  premise AST, and dropping it here (loudly) is what keeps the remaining lists aligned
   *  instead of shifting one against the other. */
  /** The user's disambiguation choice for one sentence, as stable discriminant
   *  **identifiers**.
   *
   *  The session stores scope/MC selections as discriminant ids (`sc1`, `mc21`), which are
   *  per-response counters, and solution selections as solution ids -- neither survives
   *  rebasing. A discriminant's `identifier` does (verified live), so it is what gets
   *  handed to the fold. See SequenceMergeRebase.selectedDiscriminantIdentifiers.
   *
   *  Returns [] when nothing is selected or disambiguation is off, which the fold reads as
   *  "no pruning". */
  /** Rules applied across a sentence's syntactic analyses, counted once each.
   *  Per-analysis now that the batch endpoint returns them separately; it used to be a
   *  single cumulative number that (because one RuleParser was shared across every
   *  sentence) also included rules applied to earlier sentences. */
  private distinctAppliedRuleCount(annotation: LigerSolutionAnnotationResponse | undefined): number {
    const seen = new Set<string>();
    for (const solution of annotation?.solutions ?? []) {
      for (const rule of solution.appliedRules ?? []) {
        seen.add(String((rule as any)?.index ?? (rule as any)?.rule ?? rule));
      }
    }
    return seen.size;
  }

  /** One `GswbProofInput` per syntactic analysis of a batch-parsed sentence. Shared with
   *  the analysis view and DocumentBuilderService -- see proof-inputs.ts. */
  private batchProofInputs(
    sentenceId: string, annotation: LigerSolutionAnnotationResponse | undefined
  ): GswbProofInput[] {
    // The testsuite's own sentence id, stated rather than read back from the response:
    // GSWB prefixes every reading id with it, and a solution key is not a sentence id.
    return proofInputsFrom(annotation?.solutions, { idPrefix: sentenceId, sentenceId });
  }

  private selectedDiscriminantIdentifiers(
    sentenceId: string,
    gswbOutputs: Record<string, GswbOutput>,
    useDisambiguated: boolean
  ): string[] {
    if (!useDisambiguated) return [];
    const chosenIds = new Set([
      ...(this.session.selectedScopeIdsBySentence[sentenceId] ?? []),
      ...(this.session.selectedMcIdsBySentence[sentenceId] ?? []),
    ]);
    if (!chosenIds.size) return [];

    const identifiers = (gswbOutputs[sentenceId]?.discriminants ?? [])
      .filter(discriminant => chosenIds.has(String(discriminant?.id)))
      .map(discriminant => discriminant?.identifier)
      .filter((identifier): identifier is string => typeof identifier === 'string' && !!identifier);

    if (chosenIds.size && !identifiers.length) {
      // Said out loud rather than degrading to "no pruning": a selection that resolves to
      // nothing means the fold will reason over every reading, which is the failure mode
      // this whole path exists to remove.
      console.warn('[Regression] disambiguation choice could not be resolved to identifiers',
        { sentenceId, chosenIds: [...chosenIds] });
    }
    return identifiers;
  }

  private selectedSolutions(
    sentenceId: string,
    gswbOutputs: Record<string, GswbOutput>,
    useDisambiguated: boolean
  ): GswbSolution[] {
    const solutions = gswbOutputs[sentenceId]?.solutions ?? [];
    const selectedIds = this.session.selectedSolutionIdsBySentence[sentenceId];

    let selected = solutions;
    if (useDisambiguated) {
      // In disambiguated mode, only the chosen solutions should be sent onward.
      if (!selectedIds || selectedIds.length === 0) return [];
      const chosen = new Set(selectedIds);
      selected = solutions.filter(solution => chosen.has(solution.id));
    }

    if (!this.usesLfgxDrt()) return selected;

    const withGraph = selected.filter(solution => !!solution.graph);
    if (withGraph.length !== selected.length) {
      console.warn('[Regression] some readings have no semantic graph and cannot be '
        + 'reasoned over in lfgxdrt mode', {
        sentenceId,
        dropped: selected.filter(solution => !solution.graph).map(solution => solution.id),
      });
    }
    return withGraph;
  }

  private usesLfgxDrt(): boolean {
    return Number(this.session.gswbPreferences?.outputstyle) === 5;
  }

  private solutionText(solution: GswbSolution): string {
    return this.usesLfgxDrt() ? (solution.semantic || solution.solution) : solution.solution;
  }

  /** How many check bundles this request actually submits -- the denominator the
   *  backend's `proofCount` counts up to. Null when the request carries no per-item
   *  bundles (the legacy Prolog/DRS path), so the bar falls back to item granularity. */
  private submittedProofBundleCount(request: any): number | null {
    const items = Object.values(request?.nli_items ?? {}) as any[];
    if (!items.length) return null;
    let total = 0;
    let sawBundles = false;
    for (const item of items) {
      const bundles = item?.tptp_checks;
      if (Array.isArray(bundles)) {
        sawBundles = true;
        total += bundles.length;
      }
    }
    return sawBundles && total > 0 ? total : null;
  }

  private startVampireSummaryPolling(vampireStartedAt: number, runToken: number): void {
    this.stopVampireSummaryPolling();

    // Results (last_session) poll: infrequent, since it drives the parse/inference report
    // panel, not the moving bar.
    this.vampireSummaryPollTimer = setInterval(() => {
      this.loadAndRenderVampireState(false, vampireStartedAt, runToken);
    }, 15000);

    // Progress poll: the live per-request record (vampire_progress:<key>) updates on
    // every branch, not just once an item finishes, so this can run much more often
    // without depending on results ever being persisted at all.
    this.vampireProgressPollTimer = setInterval(() => {
      this.pollVampireProgress(runToken);
    }, 2000);
    this.pollVampireProgress(runToken);
  }

  private stopVampireSummaryPolling(): void {
    if (this.vampireSummaryPollTimer !== null) {
      clearInterval(this.vampireSummaryPollTimer);
      this.vampireSummaryPollTimer = null;
    }
    if (this.vampireProgressPollTimer !== null) {
      clearInterval(this.vampireProgressPollTimer);
      this.vampireProgressPollTimer = null;
    }
  }

  private pollVampireProgress(runToken: number): void {
    if (runToken !== this.vampireRunToken) return;

    this.dataService.getVampireProgress(this.redisSessionKey).subscribe({
      next: progress => {
        if (runToken !== this.vampireRunToken) return;
        this.vampireProgressItemCount = (progress?.itemCount ?? 0) + this.vampireProgressBaselineCount;
        this.vampireProgressProofCount = progress?.proofCount ?? this.vampireProgressProofCount;

        // A run that died server-side is terminal. Polling it forever is how a crash came
        // to look like a run that had merely stopped progressing -- the request had 500'd
        // half an hour earlier and only this service's log said so.
        if (progress?.state === 'failed') {
          this.stopVampireSummaryPolling();
          this.vampirePendingItemCount = null;
          this.activeVampireRunStartedAt = null;
          this.loading = false;
          this.clearVampireProgressIndicator();
          const reason = progress.failure ?? 'the inference service reported no reason';
          this.displayMessage(
            `Vampire run failed after ${progress.itemCount ?? 0} of ${progress.totalItemCount ?? 0} items: ${reason}`,
            'red');
          this.setSessionLoadStatus('error', 'Vampire run failed',
            `${reason}\nCompleted items are saved; re-running continues from them.`);
          this.saveSessionSnapshot();
        }
      },
      error: error => console.warn('Unable to load live Vampire progress.', error)
    });
  }

  private startVampireProgressIndicator(totalCount: number, expectedProofCount: number | null = null): void {
    this.vampireProgressTotalCount = totalCount;
    this.vampireProgressItemCount = 0;
    this.vampireProgressProofCount = 0;
    this.vampireExpectedProofCount = expectedProofCount;
    this.vampireProgressInProgress = true;
  }

  private clearVampireProgressIndicator(): void {
    this.vampireProgressItemCount = null;
    this.vampireProgressProofCount = null;
    this.vampireProgressTotalCount = null;
    this.vampireExpectedProofCount = null;
    this.vampireProofBaselineCount = 0;
    this.vampireProgressInProgress = false;
    this.vampireProgressBaselineCount = 0;
  }

  private clearPendingVampireFinalSnapshot(): void {
    this.pendingVampireFinalSnapshot = null;
  }

  private releaseVampireSummaryRequestLock(): void {
    this.vampireSummaryRequestInFlight = false;

    if (this.pendingVampireFinalSnapshot !== null) {
      const pendingStartedAt = this.pendingVampireFinalSnapshot;
      this.clearPendingVampireFinalSnapshot();
      this.loadAndRenderVampireState(true, pendingStartedAt.startedAt, pendingStartedAt.runToken);
    }
  }

  private loadAndRenderVampireState(finalSnapshot: boolean, vampireStartedAt: number, runToken: number): void {
    if (runToken !== this.vampireRunToken) return;
    if (!this.loading && !finalSnapshot) return;
    if (this.vampireSummaryRequestInFlight) {
      if (finalSnapshot) {
        this.pendingVampireFinalSnapshot = { startedAt: vampireStartedAt, runToken };
      }
      return;
    }

    this.vampireSummaryRequestInFlight = true;

    forkJoin({
      session: this.dataService.getLastSession(this.redisSessionKey),
      summary: this.dataService.getLastSessionSummary(this.redisSessionKey)
    }).pipe(
      timeout(this.vampireSummaryRequestTimeoutMs),
      finalize(() => this.releaseVampireSummaryRequestLock())
    ).subscribe({
      next: ({ session, summary }) => {
        if (runToken !== this.vampireRunToken) return;

        // A non-empty submission that comes back with a zero item count is a failed run,
        // not an empty-but-successful one -- the TPTP branch used to silently drop its
        // results this way (see REGRESSION_ALIGNMENT_PLAN.md Stage 1/2). Surface it and
        // leave the previous results/inferenceResults alone rather than overwriting them
        // with {}.
        if (finalSnapshot && this.vampireCurrentRunItemCount > 0 && (summary?.item_count ?? 0) === 0) {
          this.loading = false;
          this.vampirePendingItemCount = null;
          this.activeGswbRunStartedAt = null;
          this.activeVampireRunStartedAt = null;
          this.stopVampireSummaryPolling();
          this.clearVampireProgressIndicator();
          this.saveSessionSnapshot(undefined, undefined, undefined, this.abortRequestInFlight ? 'current' : 'autosave');
          this.abortRequestInFlight = false;
          this.displayMessage(
            "Vampire run failed: no items were processed despite a non-empty submission. Previous results were kept.",
            "red"
          );
          return;
        }

        this.renderVampireResults(session?.results ?? {}, summary, finalSnapshot, this.vampirePreserveExistingResults);

        const progressDescription = finalSnapshot
          ? this.buildVampireCompletionDescription(summary)
          : this.buildVampireProgressDescription();
        const message = this.currentVampireRunKind === 'append'
          ? `${finalSnapshot ? 'Append inference summary' : 'Append inference progress'}: ${progressDescription}.`
          : this.vampirePreserveExistingResults
            ? `${finalSnapshot ? 'Vampire rerun summary' : 'Vampire rerun'}: ${progressDescription}.`
            : `${finalSnapshot ? 'Inference results summary' : 'Vampire progress'}: ${progressDescription}.`;

        console.log(message);
        this.displayMessage(message, finalSnapshot ? "green" : "blue");
        if (!this.isHydratingSession) {
          this.scheduleSessionSave();
        }

        if (finalSnapshot) {
          this.session.timing.vampireMs = Date.now() - vampireStartedAt;
          if (this.session.timing.startedAt) {
            this.session.timing.totalMs = Date.now() - new Date(this.session.timing.startedAt).getTime();
          }
          this.loading = false;
          this.vampirePendingItemCount = null;
          this.activeGswbRunStartedAt = null;
          this.activeVampireRunStartedAt = null;
          this.stopVampireSummaryPolling();
          this.clearVampireProgressIndicator();
          this.saveSessionSnapshot(undefined, undefined, undefined, this.abortRequestInFlight ? 'current' : 'autosave');
          this.abortRequestInFlight = false;
        }
      },
      error: error => {
        if (runToken !== this.vampireRunToken) return;

        console.warn("Unable to load Vampire progress summary.", error);
        if (finalSnapshot) {
          this.loading = false;
          this.vampirePendingItemCount = null;
          this.activeGswbRunStartedAt = null;
          this.activeVampireRunStartedAt = null;
          this.stopVampireSummaryPolling();
          this.clearVampireProgressIndicator();
          this.saveSessionSnapshot(undefined, undefined, undefined, this.abortRequestInFlight ? 'current' : 'autosave');
          this.abortRequestInFlight = false;
          this.displayMessage("Batch processing completed, but Redis state could not be reloaded.", "red");
        }
      }
    });
  }

  /** Writes this run's reasoning into the session's XlePlusGlueDocument: one
   *  ReasoningUpdate per NLI item (`ru-n3`), one assignment per prepared branch.
   *
   *  Verdicts are paired to assignments by the id Vampire echoes back, not by position in
   *  the item's result array -- position stops being identity the moment a branch is
   *  filtered out, and regression filters routinely.
   *
   *  A branch that could not be prepared never got an assignment id, so it cannot be
   *  recorded as an assignment; those reasons go on the update's own `failure` instead, so
   *  a stored session still says that readings were attempted and lost. Branches that were
   *  translated only by dropping their anaphora mapping DO have ids, and carry their
   *  reasons on the assignment. */
  private upsertReasoningUpdates(results: Record<string, check[]>): void {
    if (!this.preparedNliPairs.length) return;

    const verdictByAssignment = new Map<string, check>();
    Object.values(results ?? {}).forEach(checks => (checks ?? []).forEach(item => {
      if (item?.assignment_id) verdictByAssignment.set(item.assignment_id, item);
    }));

    const itemsById = new Map(this.regressionTestItems.map(item => [String(item?.id ?? ''), item]));
    const updates = new Map<string, ReasoningUpdate>();
    const computedAt = new Date().toISOString();

    for (const pair of this.preparedNliPairs) {
      const item = itemsById.get(pair.itemId);
      if (!item) continue;
      const updateId = reasoningUpdateId(item.premises ?? [], item.conclusion ?? [], pair.itemId);

      if (!updates.has(updateId)) {
        // Only set when registerFinalSequence actually registered it -- an item whose
        // sequence build failed outright (caught in prepareNliItem's own catchError) never
        // reaches that call, and validateReasoningUpdate throws on a sourceElementId that
        // does not resolve, which would drop this update's failure message too.
        const sequenceId = compositeAnalysisId([...(item.premises ?? []), ...(item.conclusion ?? [])]);
        const sequenceRegistered = (this.session.analysisDocuments[pair.itemId]?.sequences ?? [])
          .some(sequence => sequence.id === sequenceId);
        updates.set(updateId, {
          id: updateId,
          premiseElementIds: [...(item.premises ?? [])],
          hypothesisElementIds: [...(item.conclusion ?? [])],
          ...(sequenceRegistered ? { sourceElementId: sequenceId, sourceElementKind: 'sequence' as const } : {}),
          itemId: pair.itemId,
          logicType: this.session.lastLogicType === 'tff' ? 'tff' : 'fof',
          ruleString: APP_DEFAULTS.graphInspector.rulesText,
          pruned: this.contextPruning?.nativeElement?.checked ?? false,
          assignments: [],
          createdAt: computedAt,
        });
      }
      const update = updates.get(updateId)!;
      if (pair.failures.length) {
        update.failure = [update.failure, ...pair.failures].filter(Boolean).join('; ');
      }

      for (const assignment of pair.assignments) {
        if (!assignment.assignmentId
          || update.assignments.some(existing => existing.id === assignment.assignmentId)) continue;
        const verdict = verdictByAssignment.get(assignment.assignmentId);
        update.assignments.push({
          id: assignment.assignmentId,
          premiseSemanticIds: parseReasoningAssignmentId(assignment.assignmentId).premiseSemanticIds,
          hypothesisSemanticIds: parseReasoningAssignmentId(assignment.assignmentId).hypothesisSemanticIds,
          ruleBranchIndex: assignment.ruleBranchIndex,
          contextTptp: assignment.contextTptp,
          checks: assignment.checks as ReasoningCheckSet,
          ...(assignment.degradations?.length ? { degradations: assignment.degradations } : {}),
          verdict: verdict ? {
            consistent: !!verdict.consistent,
            informative: !!verdict.informative,
            relevant: !!verdict.relevant,
            glyph: verdict.glyph,
            proofFiles: verdict.proof_files,
            computedAt,
          } : undefined,
        });
      }
    }

    // Each update is written into ITS OWN item's document -- the item id is carried on the
    // update, so no partitioning is needed here.
    updates.forEach(update => {
      update.verdict = majorityVerdict(update.assignments);
      update.updatedAt = computedAt;
      const documentId = String(update.itemId ?? '');
      const document = this.session.analysisDocuments[documentId];
      if (!document) {
        console.warn('[Regression] no document for this item; reasoning update not written',
          { updateId: update.id, itemId: documentId });
        return;
      }
      const next = [
        ...(document.reasoningUpdates ?? []).filter(existing => existing.id !== update.id),
        update,
      ];
      try {
        // Validated against a candidate document, so a rejected update leaves the stored
        // one exactly as it was rather than half-applied.
        const candidate = { ...document, reasoningUpdates: next };
        validateReasoningUpdate(candidate, update);
        this.session.analysisDocuments = {
          ...this.session.analysisDocuments,
          [documentId]: { ...candidate, updatedAt: computedAt },
        };
      } catch (error) {
        console.warn('[Regression] reasoning update rejected by document invariants',
          { updateId: update.id, itemId: documentId, error });
      }
    });

    console.info('[Regression] reasoning updates written', {
      updateCount: updates.size,
      assignmentCount: [...updates.values()].reduce((sum, update) => sum + update.assignments.length, 0),
      documentCount: Object.keys(this.session.analysisDocuments).length,
      storedUpdateCount: Object.values(this.session.analysisDocuments)
        .reduce((sum, document) => sum + (document.reasoningUpdates ?? []).length, 0),
    });
  }

  private renderVampireResults(results: Record<string, check[]>, _summary: VampireSessionSummary, finalSnapshot: boolean, preserveExisting = false): void {
    const mergedResults: Record<string, check[]> = preserveExisting && this.session.lastVampireResults
      ? { ...this.session.lastVampireResults, ...results }
      : { ...results };

    const idx = { '1': 0, '0': 1, '-1': 2 };
    const cm = Array.from({ length: 3 }, () => Array(3).fill(0));
    const previousSelection = { goldIdx: this.selectedGoldIdx, predIdx: this.selectedPredIdx };
    this.cellIds = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => []));

    this.selectedIds.clear();
    this.selectedGoldIdx = this.selectedPredIdx = null;

    let all_entailment_predictions = 0;
    let all_neutral_predictions = 0;
    let all_contradiction_predictions = 0;

    let successful_entailment_predictions = 0;
    let successful_neutral_predictions = 0;
    let successful_contradiction_predictions = 0;

    // Written before the loop below reads it: the loop prefers the document's verdict for
    // any item that has one, so the document is the record and `inferenceResults` the view.
    this.upsertReasoningUpdates(mergedResults);
    // Each item's verdict is read from its own document and the per-item results merged
    // into one map, which is what the confusion matrix and the report below consume. The
    // aggregation is the only place the per-item split has to be undone.
    const documentResults: Record<string, RegressionInferenceResult> = {};
    for (const item of this.regressionTestItems) {
      const itemId = String(item?.id ?? '');
      const document = this.session.analysisDocuments[itemId];
      if (!document) continue;
      Object.assign(documentResults,
        inferenceResultsFromDocument(document, [item], this.sentenceMap));
    }

    const currentInferenceResults: RegressionInferenceResult[] = [];

    for (const testItem of this.regressionTestItems) {
      const value = mergedResults?.[testItem.id];
      // The document's verdict for this item, when it has one. Same majority rule and
      // same label mapping, but computed over the assignments the verdicts were paired
      // to by id rather than over whatever came back in this item's array -- so a run
      // where some branches were filtered out still attributes each verdict correctly.
      // Consulted BEFORE deciding to skip: an item can have a document verdict with no
      // entry in mergedResults (e.g. every branch for it was filtered upstream), and the
      // document is then the only source of truth for it, not a reason to drop it.
      const fromDocument = documentResults[testItem.id];
      if ((!value || value.length === 0) && !fromDocument) continue;

      let entailment_label = '0';
      if (value && value.length > 0) {
        const infoCount = value.filter(check => check.informative).length;
        const consistentCount = value.filter(check => check.consistent).length;

        const infoSuccess = infoCount > value.length / 2;
        const consistentSuccess = consistentCount > value.length / 2;

        if (infoSuccess && consistentSuccess) entailment_label = '0';
        else if (!infoSuccess && consistentSuccess) entailment_label = '1';
        else if (!consistentSuccess) entailment_label = '-1';
      }

      if (fromDocument) {
        entailment_label = fromDocument.predictedLabel;
      }
      const glyphs: string[] = fromDocument?.glyphs ?? (value ?? []).map(check => check.glyph);

      if (testItem.gold_label === entailment_label) {
        if (entailment_label === '1') successful_entailment_predictions++;
        else if (entailment_label === '0') successful_neutral_predictions++;
        else if (entailment_label === '-1') successful_contradiction_predictions++;
      }

      if (testItem.gold_label === '1') all_entailment_predictions++;
      else if (testItem.gold_label === '0') all_neutral_predictions++;
      else if (testItem.gold_label === '-1') all_contradiction_predictions++;

      const premiseSentences: string[] = (testItem?.premises ?? [])
        .map((sid: string) => this.sentenceMap[sid])
        .filter((s: any) => typeof s === 'string' && s.trim().length > 0);

      const conclusionSentences: string[] = (testItem?.conclusion ?? [])
        .map((sid: string) => this.sentenceMap[sid])
        .filter((s: any) => typeof s === 'string' && s.trim().length > 0);

      currentInferenceResults.push({
        id: testItem.id,
        premises: premiseSentences,
        conclusion: conclusionSentences.join(' '),
        predictedLabel: entailment_label,
        goldLabel: testItem?.gold_label ?? 'unknown',
        premiseIds: testItem?.premises ?? [],
        conclusionIds: testItem?.conclusion ?? [],
        mismatch: (testItem?.gold_label ?? '') !== entailment_label,
        glyphs: glyphs
      });

      if (idx[testItem.gold_label] !== undefined && idx[entailment_label] !== undefined) {
        const gi = idx[testItem.gold_label];
        const pj = idx[entailment_label];
        cm[gi][pj] += 1;
        this.cellIds[gi][pj].push(testItem.id);
      }
    }

    this.inferenceResults = currentInferenceResults;
    this.session.lastVampireResults = mergedResults;
    this.updateConfusionMatrixView(cm, Object.keys(mergedResults ?? {}).length);
    if (previousSelection.goldIdx !== null && previousSelection.predIdx !== null) {
      this.selectedGoldIdx = previousSelection.goldIdx;
      this.selectedPredIdx = previousSelection.predIdx;
      this.selectedIds = new Set(this.cellIds[previousSelection.goldIdx][previousSelection.predIdx] ?? []);
    }

    const totalCorrectItems = successful_entailment_predictions + successful_neutral_predictions + successful_contradiction_predictions;
    const totalSessionItems = Object.keys(mergedResults ?? {}).length;
    const formatRatio = (successful: number, total: number) => total === 0 ? 'n/a' : String(successful / total);

    this.inferenceSummary =
      `Inference results summary:\n` +
      `Successful entailment prediction ratio: ${formatRatio(successful_entailment_predictions, all_entailment_predictions)} ` +
      `(${successful_entailment_predictions} of ${all_entailment_predictions})\n` +
      `Successful neutral prediction ratio: ${formatRatio(successful_neutral_predictions, all_neutral_predictions)} ` +
      `(${successful_neutral_predictions} of ${all_neutral_predictions})\n` +
      `Successful contradiction prediction ratio: ${formatRatio(successful_contradiction_predictions, all_contradiction_predictions)} ` +
      `(${successful_contradiction_predictions} of ${all_contradiction_predictions})\n` +
      `Overall accuracy: ${totalSessionItems === 0 ? 'n/a' : String(totalCorrectItems / totalSessionItems)}`;

    if (finalSnapshot) {
      this.commitParsedRegressionSnapshot();
    }
  }

  private formatDuration(ms: number | null, precise = false): string {
    if (ms === null || Number.isNaN(ms)) return 'n/a';

    if (ms < 1000) return `${Math.round(ms)}ms`;
    const seconds = ms / 1000;
    return precise ? `${seconds.toFixed(2)}s` : `${seconds.toFixed(1)}s`;
  }

  batchMultistage(sentences: String) {
    if (this.runLocked) return;
    this.gswbPreferences.onSubmit();

    let sentencesArray = sentences.split("\n").filter(line => {
      let trimmedLine = line.trim();
      return trimmedLine !== '' && !trimmedLine.startsWith("#");
    });

    let sentenceMap = {};
    for (let i = 0; i < sentencesArray.length; i++) {
      sentenceMap["S" + i] = sentencesArray[i];
    }

    const ligerMultipleRequest = { sentences: sentenceMap, ruleString: null };

    this.dataService.ligerBatchMultistage(ligerMultipleRequest).subscribe(
      data => {
        if (data.hasOwnProperty("annotations")) {
          // `/multistage_to_batch` was NOT migrated to the per-variant shape (different
          // semantics, no coverage here), so it still returns one annotation per sentence
          // with concatenated meaning constructors. Sent as premises-only items, which is
          // the flat path GSWB still supports -- see LigerRuleAnnotationBatchAnalysis.
          const items: Record<string, GswbRequest> = {};
          for (const [key, value] of Object.entries(data.annotations) as [string, LigerRuleAnnotation][]) {
            items[key] = {
              premises: value.meaningConstructors,
              gswbPreferences: this.gswbPreferences.gswbPreferences,
            };
          }

          this.gswbMultipleRequest = {
            items,
            gswbPreferences: this.gswbPreferences.gswbPreferences
          };

        }

        if (data.hasOwnProperty("report")) {
          this.ligerreport.nativeElement.innerHTML = data.report;
        }

        this.batchDeduce(this.gswbMultipleRequest);
      },
      error => {
        console.error('An error occurred:', error);
        this.saveSessionSnapshot();
        this.loading = false;
      }
    );
  }

  updateGrammar(grammarPath: string) {
    // Grammar selection is part of the session metadata.
    this.session.grammarPath = grammarPath;
    this.syncSessionStateFromUi();
    this.scheduleSessionSave();
  }

  onTestsuiteStateChange(state: { path: string; loadedContent: string }): void {
    // Keep the loaded file snapshot in sync for modified-state checks.
    this.session.testsuiteFilename = state?.path ?? '';
    this.session.testsuiteLoadedText = state?.loadedContent ?? '';
  }

  updateRules(file: { path: string; content: string }) {
    // Loading a rules file replaces the editor content and snapshot metadata.
    this.session.rulesFilename = file?.path ?? '';
    this.session.rulesLoadedText = file?.content ?? '';
    this.session.rulesText = file?.content ?? '';
    this.ligerRules.updateContent(file?.content ?? '');
    this.syncSessionStateFromUi();
    this.scheduleSessionSave();
  }

  onRulesStateChange(state: { path: string; loadedContent: string }): void {
    // Persist the exact loaded rules file content for later comparisons.
    this.session.rulesFilename = state?.path ?? '';
    this.session.rulesLoadedText = state?.loadedContent ?? '';
  }

  updateRulesText(ruleFile: string) {
    this.session.rulesText = ruleFile;
    this.ligerRules.updateContent(ruleFile);
    this.syncSessionStateFromUi();
    this.scheduleSessionSave();
  }

  onAxiomsStateChange(state: { path: string; loadedContent: string }): void {
    // Persist the exact loaded axioms file content for later comparisons.
    this.session.axiomsFilename = state?.path ?? '';
    this.session.axiomsLoadedText = state?.loadedContent ?? '';
  }

  updateTestsuite(file: { path: string; content: string }) {
    // Loading a testsuite file replaces the editor content and snapshot metadata.
    this.session.testsuiteFilename = file?.path ?? '';
    this.session.testsuiteLoadedText = file?.content ?? '';
    this.session.testsuiteText = file?.content ?? '';
    this.testfile.updateContent(file?.content ?? '');
    this.syncSessionStateFromUi();
    this.scheduleSessionSave();
  }

  updateTestsuiteText(ruleFile: string) {
    this.session.testsuiteText = ruleFile;
    this.testfile.updateContent(ruleFile);
    this.syncSessionStateFromUi();
    this.scheduleSessionSave();
  }

  updateAxioms(file: { path: string; content: string }) {
    // Loading axioms follows the same persisted state pattern as rules/testsuites.
    this.session.axiomsFilename = file?.path ?? '';
    this.session.axiomsLoadedText = file?.content ?? '';
    this.session.axiomsText = file?.content ?? '';
    this.axiomEdit.updateContent(file?.content ?? '');
    this.syncSessionStateFromUi();
    this.scheduleSessionSave();
  }

  updateAxiomsText(ruleFile: string) {
    this.session.axiomsText = ruleFile;
    this.axiomEdit.updateContent(ruleFile);
    this.syncSessionStateFromUi();
    this.scheduleSessionSave();
  }

  setTestsuiteUpdateMode(mode: 'write' | 'append'): void {
    this.testsuiteUpdateMode = mode;
    this.session.testsuiteUpdateMode = mode;
    this.scheduleSessionSave();
  }

  updateTestsuiteFromProcessedItems(): void {
    const updated = this.testsuiteEditorMode === 'json'
      ? JSON.stringify(this.buildProcessedTestsuiteItems(), null, 2)
      : this.serializeProcessedTestsuiteAsBlocks();
    this.session.testsuiteText = updated;
    this.testfile.updateContent(updated);
    this.syncSessionStateFromUi();
    this.scheduleSessionSave(true);
  }

  private buildProcessedTestsuiteItems(): Array<{ id: string; premises: string[]; conclusion: string[]; gold_label: string | null }> {
    return (this.regressionTestItems ?? []).map((item: any, index: number) => ({
      id: String(item?.id ?? `n${index}`),
      premises: (item?.premises ?? []).map((sid: string) => this.sentenceMap[sid]).filter((s: any) => typeof s === 'string' && s.trim().length > 0),
      conclusion: (item?.conclusion ?? []).map((sid: string) => this.sentenceMap[sid]).filter((s: any) => typeof s === 'string' && s.trim().length > 0),
      gold_label: item?.gold_label ?? null,
    }));
  }

  private inferTestsuiteEditorMode(value: string): 'nli' | 'json' {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return 'nli';

    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? 'json' : 'nli';
    } catch {
      return 'nli';
    }
  }

  private serializeProcessedTestsuiteAsBlocks(): string {
    return this.buildProcessedTestsuiteItems()
      .map(item => {
        const premises = item.premises.join('\n');
        const conclusion = item.conclusion.join('\n');
        const labelLine = item.gold_label !== null && item.gold_label !== undefined ? `>>> ${item.gold_label}` : '';

        return [
          '{',
          premises,
          '====',
          conclusion,
          labelLine,
          '}'
        ].filter(line => String(line).length > 0).join('\n');
      })
      .join('\n\n');
  }

  onEditorContentChange(field: 'testsuiteText' | 'rulesText' | 'axiomsText', value: string): void {
    if (this.isHydratingSession) return;

    this.session[field] = value;
    this.syncSessionStateFromUi();
    this.scheduleSessionSave();
  }

  batchVampire(vampireMultipleRequest: vampireMultipleRequest): Observable<any> {
    return this.dataService.callBatchVampire(vampireMultipleRequest).pipe(
      tap(data => {
      }),
      catchError(err => {
        console.error("An error occurred:", err);
        this.displayMessage("An error occurred during Vampire processing.", "red");
        this.loading = false;
        return EMPTY;
      })
    );
  }

  batchDeduce(gswbMultipleRequest: GswbMultipleRequest): Observable<GswbBatchOutput> {
    return this.dataService.gswbBatchDeduce(gswbMultipleRequest).pipe(
      tap(data => {
        if (data.hasOwnProperty("outputs")) {
        }
      }),
      catchError(err => {
        console.error("An error occurred:", err);
        this.displayMessage("An error occurred during GSWB deduction.", "red");
        this.loading = false;
        this.saveSessionSnapshot();
        return EMPTY;
      })
    );
  }

  displayMessage(message: string, color: string) {
    this.errorhandle.nativeElement.style.color = color;
    this.errorhandle.nativeElement.textContent = "[" + new Date().toLocaleTimeString() + "] " + message;
  }

  private setSessionLoadStatus(state: 'idle' | 'loading' | 'success' | 'error', message: string, details: string): void {
    this.sessionLoadState = state;
    this.sessionLoadMessage = message ? `[${new Date().toLocaleTimeString()}] ${message}` : '';
    this.sessionLoadDetails = details;
  }

  clearStatusMessage(): void {
    if (this.errorhandle?.nativeElement) {
      this.errorhandle.nativeElement.textContent = "";
    }
  }


  parse_testfile(testfile: string) {
    try {
      this.parse_json_testfile(testfile);
    } catch (err) {
      this.parse_block_testfile(testfile);
    }
  }


  parse_block_testfile(testfile: string) {
    let parseItems: any[] = [];
    let lines = testfile.split('\n');

    const appendMode = this.testsuiteUpdateMode === 'append';
    if (!appendMode) this.regressionTestItems = [];
    const sentence_map: Record<string, string> = appendMode ? { ...(this.sentenceMap ?? {}) } : {};
    let sentence_id = appendMode ? this.getNextSentenceId(sentence_map) : 0;
    let item_id = appendMode ? this.getNextItemId(this.regressionTestItems ?? []) : 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;
      if (line.trim().startsWith('#')) continue;
      if (line.trim().length > 2) {
        sentence_map["S" + sentence_id] = line.trim();
        sentence_id++;
      }
      if (line.trim() === "{") {
        i++;
        let sentences: string[] = [];
        let premise_ids = [];
        let conclusion_ids = [];
        let gold_label = null;
        let premises: boolean = true;

        while (lines[i].trim() !== "}" && i < lines.length) {
          const innerLine = lines[i];
          if (innerLine.trim() === '') { i++; continue; }
          if (innerLine.trim().startsWith('}')) { break; }
          if (innerLine.trim().startsWith('#')) { i++; continue; }

          if (innerLine.trim() === "====") {
            premises = false;
            i++;
            continue;
          } else if (innerLine.trim().startsWith(">>>")) {
            gold_label = innerLine.trim().substring(3).trim();
          } else if (innerLine.trim().length > 2) {
            sentences.push(innerLine.trim());
            if (premises) {
              premise_ids.push('S' + sentence_id);
              sentence_map['S' + sentence_id] = innerLine.trim();
              sentence_id++;
            } else {
              conclusion_ids.push('S' + sentence_id);
              sentence_map['S' + sentence_id] = innerLine.trim();
              sentence_id++;
            }
          }
          i++;
        }

        let item = { id: "n" + item_id, sentences, premises: premise_ids, conclusion: conclusion_ids, gold_label };
        item_id++;
        parseItems.push(item);
      }
    }

    this.sentenceMap = sentence_map;
    this.regressionTestItems.push(...parseItems);
  }

  parse_json_testfile(testfile: string) {
    let parseItems: any[] = [];
    let parsed = JSON.parse(testfile);

    if (!Array.isArray(parsed)) {
      throw new Error("JSON testfile must be a list.");
    }

    const appendMode = this.testsuiteUpdateMode === 'append';
    if (!appendMode) this.regressionTestItems = [];
    const sentence_map: Record<string, string> = appendMode ? { ...(this.sentenceMap ?? {}) } : {};
    let sentence_id = appendMode ? this.getNextSentenceId(sentence_map) : 0;
    let item_id = appendMode ? this.getNextItemId(this.regressionTestItems ?? []) : 0;

    for (let i = 0; i < parsed.length; i++) {
      const obj = parsed[i];

      if (!obj.premises || !Array.isArray(obj.premises)) {
        throw new Error("Each JSON item must have a premises array.");
      }

      let sentences: string[] = [];
      let premise_ids = [];
      let conclusion_ids = [];
      let gold_label = obj.gold_label ?? null;

      for (let j = 0; j < obj.premises.length; j++) {
        const premise = String(obj.premises[j]).trim();
        if (premise.length === 0) continue;

        sentences.push(premise);
        premise_ids.push("S" + sentence_id);
        sentence_map["S" + sentence_id] = premise;
        sentence_id++;
      }

      let conclusions = Array.isArray(obj.conclusion) ? obj.conclusion : [obj.conclusion];
      for (let j = 0; j < conclusions.length; j++) {
        const conclusion = String(conclusions[j]).trim();
        if (conclusion.length === 0) continue;

        sentences.push(conclusion);
        conclusion_ids.push("S" + sentence_id);
        sentence_map["S" + sentence_id] = conclusion;
        sentence_id++;
      }

      let item = {
        id: "n" + item_id,
        sentences,
        premises: premise_ids,
        conclusion: conclusion_ids,
        gold_label
      };
      item_id++;
      parseItems.push(item);
    }

    this.sentenceMap = sentence_map;
    this.regressionTestItems.push(...parseItems);
  }

  private getNextSentenceId(sentenceMap: Record<string, string>): number {
    return Object.keys(sentenceMap ?? {}).reduce((max, key) => {
      const match = /^S(\d+)$/.exec(key);
      return match ? Math.max(max, Number(match[1]) + 1) : max;
    }, 0);
  }

  private getNextItemId(items: any[]): number {
    return (items ?? []).reduce((max, item) => {
      const match = /^n(\d+)$/.exec(String(item?.id ?? ''));
      return match ? Math.max(max, Number(match[1]) + 1) : max;
    }, 0);
  }


  sortResultsByTrueCount(resultsObj: any): any {
    const sortedResults: any = { ...resultsObj };
    Object.keys(sortedResults.results).forEach(key => {
      sortedResults.results[key] = sortedResults.results[key].sort(
        (a: any, b: any) => this.countTrues(b) - this.countTrues(a)
      );
    });
    return sortedResults;
  }

  private countTrues(obj: any): number {
    return Object.values(obj).filter(v => v === true).length;
  }

  updateConfusionMatrixView(cm: number[][], total?: number): void {
    const denom =
      (typeof total === 'number' && total > 0)
        ? total
        : cm.reduce((acc, row) => acc + row.reduce((a, b) => a + b, 0), 0);

    this.cmView = this.labels.map((g, i) => ({
      gold: g,
      rows: this.labels.map((p, j) => {
        const v = cm[i][j];
        const pctNum = denom ? (100 * v) / denom : 0;
        return {
          pred: p,
          v,
          pct: pctNum.toFixed(1),
          intensity: pctNum / 100,
          diag: i === j,
        };
      }),
    }));
  }

  selectedGoldIdx: number | null = null;
  selectedPredIdx: number | null = null;
  selectedIds = new Set<string>();

  selectCell(gi: number, pj: number): void {
    if (this.selectedGoldIdx === gi && this.selectedPredIdx === pj) {
      this.clearSelection();
      return;
    }
    this.selectedGoldIdx = gi;
    this.selectedPredIdx = pj;
    this.selectedIds = new Set(this.cellIds[gi][pj] ?? []);
  }

  clearSelection(): void {
    this.selectedGoldIdx = this.selectedPredIdx = null;
    this.selectedIds.clear();
  }

  get runLocked(): boolean {
    return this.loading || this.saveOperationInProgress || (this.enableDisambiguation && this.disambiguationMode);
  }

  /** Continue/Skip are only ever shown *during* the disambiguation pause -- gating them on
   *  the same `enableDisambiguation && disambiguationMode` clause `runLocked` uses for
   *  Parse all/Multistage made them permanently disabled the moment they appeared, since
   *  that condition is exactly when they are visible. This is the narrower lock: still
   *  blocked while an actual run/save/abort is in flight, never by the pause itself. */
  get disambiguationActionLocked(): boolean {
    return this.loading || this.saveOperationInProgress || this.abortRequestInFlight
      || this.sessionLoadState === 'loading';
  }

  get isSessionActionLocked(): boolean {
    return this.loading || this.sessionLoadState === 'loading' || this.saveOperationInProgress || this.abortRequestInFlight;
  }

  get isSaveCurrentInProgress(): boolean {
    return this.saveOperationInProgress && this.activeSaveAction === 'current';
  }

  get isSaveAsInProgress(): boolean {
    return this.saveOperationInProgress && this.activeSaveAction === 'as';
  }

  get isAutosavingInProgress(): boolean {
    return this.saveOperationInProgress && this.activeSaveAction === null;
  }

  trackBySentenceId = (_: number, x: any) => x?.sentence_id ?? _;
  trackByInferenceId = (_: number, x: any) => x?.id ?? _;




  getSelectedSolutionIds(element: any): string[] {
    const fromUser = this.session.selectedSolutionIdsBySentence[element.sentence_id];
    if (fromUser !== undefined) return fromUser;

    const sols = element?.gswbSolutions ?? [];
    return Array.isArray(sols) ? sols.map((s: any) => String(s.id)) : [];
  }

  onSemvisSelectionChange(ev: { sentenceId: string; items: { id: string }[]; selectedScopeIds: string[]; selectedMcIds: string[] }) {
    const sid = ev.sentenceId;

    // persist solution IDs
    this.session.selectedSolutionIdsBySentence[sid] = (ev.items ?? []).map(x => x.id);

    // persist discriminant selection state
    this.session.selectedScopeIdsBySentence[sid] = [...(ev.selectedScopeIds ?? [])];
    this.session.selectedMcIdsBySentence[sid] = [...(ev.selectedMcIds ?? [])];
    this.scheduleSessionSave();
  }

  private cloneSelectionRecord(source: Record<string, string[]>): Record<string, string[]> {
    const copy: Record<string, string[]> = {};
    Object.entries(source).forEach(([sid, ids]) => { copy[sid] = [...ids]; });
    return copy;
  }

  private haveDiscriminantSelectionsChangedSinceLastVampire(): boolean {
    return this.selectionRecordsDiffer(this.session.selectedScopeIdsBySentence, this.session.lastVampireScopeIdsBySentence)
      || this.selectionRecordsDiffer(this.session.selectedMcIdsBySentence, this.session.lastVampireMcIdsBySentence)
      || this.selectionRecordsDiffer(this.session.selectedSolutionIdsBySentence, this.session.lastVampireSolutionIdsBySentence ?? {});
  }

  private hasVampireSelectionChangedForItem(
    item: any,
    previousScopeIds: Record<string, string[]>,
    previousMcIds: Record<string, string[]>,
    previousSolutionIds: Record<string, string[]>
  ): boolean {
    const sentenceIds = [...(item?.premises ?? []), ...(item?.conclusion ?? [])];

    return sentenceIds.some((sentenceId: string) => {
      return this.sameSelectionIds(
        this.session.selectedScopeIdsBySentence[sentenceId] ?? [],
        previousScopeIds[sentenceId] ?? []
      ) === false
        || this.sameSelectionIds(
          this.session.selectedMcIdsBySentence[sentenceId] ?? [],
          previousMcIds[sentenceId] ?? []
        ) === false
        || this.sameSelectionIds(
          this.session.selectedSolutionIdsBySentence[sentenceId] ?? [],
          previousSolutionIds[sentenceId] ?? []
        ) === false;
    });
  }

  private selectionRecordsDiffer(current: Record<string, string[]>, previous: Record<string, string[]>): boolean {
    const currentKeys = Object.keys(current);
    const previousKeys = Object.keys(previous);
    if (currentKeys.length !== previousKeys.length) return true;

    for (const sentenceId of currentKeys) {
      const prior = previous[sentenceId];
      if (!prior) return true;

      if (!this.sameSelectionIds(current[sentenceId], prior)) return true;
    }

    return false;
  }

  private sameSelectionIds(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;

    const normalize = (ids: string[]) => [...new Set(ids.map(id => String(id)))].sort();
    const a = normalize(left);
    const b = normalize(right);

    if (a.length !== b.length) return false;
    return a.every((id, index) => id === b[index]);
  }

  openSemVisDialog(payload: any): void {
    const sid = payload.sentenceId;

    this.semvisDialog.open({
      ...payload,
      svgSolutions: this.session.gswbPreferences.outputstyle === 5,
      selectedScopeIds: this.session.selectedScopeIdsBySentence[sid] ?? [],
      selectedMcIds: this.session.selectedMcIdsBySentence[sid] ?? [],
    });
  }



}
