import { Component, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { DataService } from "../data.service";
import { GraphVisComponent } from "../liger-vis/liger-graph-vis/graph-vis.component";
import { ActivatedRoute } from '@angular/router';
import {
  LigerRuleAnnotation,
  GswbMultipleRequest,
  GswbBatchOutput,
  GswbOutput,
  RegressionInferenceResult,
  RegressionParseResult,
  RegressionSessionSummary,
  RegressionTestingSession,
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
import { catchError, EMPTY, Observable, forkJoin, finalize, timeout } from "rxjs";
import { tap } from "rxjs/operators";
import { InferenceSettingsComponent } from "../inference-interface/inference-settings/inference-settings.component";
import {SemvisDialogComponent} from "../utilities/semvis-dialog/semvis-dialog.component";

type ParsedRegressionRunSnapshot = {
  regressionTestItems: any[];
  regressionTestResults: RegressionParseResult[];
  inferenceResults: RegressionInferenceResult[];
  sentenceMap: Record<string, string>;
  annotations: Record<string, LigerRuleAnnotation> | null;
  gswbOutputs: Record<string, GswbOutput> | null;
};

@Component({
  selector: 'app-regression-testing-interface',
  templateUrl: './regression-testing-interface.component.html',
  styleUrls: ['./regression-testing-interface.component.css']
})
export class RegressionTestingInterfaceComponent implements AfterViewInit, OnDestroy {

  private readonly activeSessionStorageKey = 'regression-testing-active-session-key';

  constructor(private dataService: DataService, private route: ActivatedRoute) {
    this.lastSavedSessionFingerprint = this.buildSessionFingerprint(regressionSessionToDocument(this.session));
  }

  session: RegressionTestingSession = this.createInitialSession();

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
  private sessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionPersistenceEnabled = false;
  private isBootstrapping = true;
  private lastSavedSessionFingerprint = '';
  private saveOperationInProgress = false;
  private pendingAutosave = false;
  private activeSaveAction: 'current' | 'as' | null = null;
  private activeGswbRunStartedAt: number | null = null;
    private gswbRunToken = 0;
  private vampirePendingItemCount: number | null = null;
  private vampireCurrentRunItemCount: number = 0;
  private activeVampireRunStartedAt: number | null = null;
  private vampireRunToken = 0;
  private vampireSummaryRequestInFlight = false;
  private pendingVampireFinalSnapshot: { startedAt: number; runToken: number } | null = null;
  private readonly vampireSummaryRequestTimeoutMs = 30000;
  vampireProgressItemCount: number | null = null;
  vampireProgressProofCount: number | null = null;
  vampireProgressTotalCount: number | null = null;
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

  // UI toggle for the disambiguation flow.
  enableDisambiguation = false;
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

  // Called from template on each <app-test-result ... (selectionChange)="onSelectionChange($event)">
  onSelectionChange(ev: { sentenceId: string; selectedSolutionIds: string[] }) {
    if (!ev?.sentenceId) return;
    this.session.selectedSolutionIdsBySentence[ev.sentenceId] = [...(ev.selectedSolutionIds ?? [])];
    this.scheduleSessionSave();
  }

  ngAfterViewInit() {
    if (this.gswbPreferences) {
      this.gswbPreferences.gswbPreferences = {
        prover: 1,
        debugging: false,
        outputstyle: 4,
        parseSem: false,
        resolveDrs: true,
        betaReduce: true,
        glueOnly: false,
        meaningOnly: false,
        explainFail: false,
        naturalDeductionStyle: 0,
      };
      this.gswbPreferences.updateFormFromPreferences(this.gswbPreferences.gswbPreferences);
    } else {
      console.error("ERROR: `gswbPreferences` ViewChild not initialized!");
    }

    if (this.vampirePreferences) {
      this.vampirePreferences.vampirePreferences = {
        logic_type: 0,
        model_building: true,
        max_duration: 10,
        layered: false
      };
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

    if (this.saveOperationInProgress && !lockAlreadyHeld) {
      this.pendingAutosave = true;
      return;
    }

    this.syncSessionStateFromUi();
    const snapshot = this.buildSessionSnapshot();
    const fingerprint = this.buildSessionFingerprint(snapshot);
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

    this.dataService.saveRegressionSession(this.redisSessionKey, snapshot).pipe(
      finalize(() => {
        this.saveOperationInProgress = false;
        this.activeSaveAction = null;
        const shouldRetry = saveSucceeded && this.pendingAutosave;
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
      error: error => console.warn("Unable to save regression session.", error)
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
    this.displayMessage(`Saving current session ${this.redisSessionKey}...`, 'blue');
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

  private buildSessionFingerprint(snapshot: RegressionSessionDocument): string {
    const { metadata, ...rest } = snapshot;
    const { updatedAt, ...metadataRest } = metadata;
    return JSON.stringify({ ...rest, metadata: metadataRest });
  }

  private resetRuntimeStatus(): void {
    this.clearStatusMessage();
    this.clearVampireProgressIndicator();
    this.pendingVampireFinalSnapshot = null;
    this.vampireSummaryRequestInFlight = false;
    this.vampirePendingItemCount = null;
    this.activeVampireRunStartedAt = null;
    this.vampireCurrentRunItemCount = 0;
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
        this.displayMessage('Previous session could not be restored. Started a new session.', 'blue');
      }
    });
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

        const parsedCount = Object.keys(outputs).length;
        const totalCount = Object.keys(this.sentenceMap ?? {}).length;
        const quickReport = `Parsed ${parsedCount} of ${totalCount} sentences!`;

        this.displayMessage(quickReport, finalSnapshot ? "green" : "blue");

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
        noOfAppliedRules: annotations[key]?.appliedRules?.length ?? 0,
        noOfMCsets: annotations[key]?.numberOfMCsets ?? 0,
        noOfSolutions: sols.length,
        ligerGraph: annotations[key]?.graph,
        ligerMCsets: annotations[key]?.meaningConstructors,
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
    if (!this.isHydratingSession) {
      this.scheduleSessionSave();
    }

    this.parsingSummary =
      `Parsing summary:\n` +
      `Parsed ${currentRegressionTestResults.length} of ${Object.keys(this.sentenceMap).length} sentences!`;
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
    if (!this.loading || this.saveOperationInProgress) return;

    this.displayMessage('Aborting current run and saving the session...', 'blue');
    this.dataService.requestVampireCancel(this.redisSessionKey).subscribe({
      error: error => console.warn('Unable to request Vampire cancel.', error)
    });
    this.gswbRunToken++;
    this.vampireRunToken++;
    this.stopGswbSummaryPolling();
    this.stopVampireSummaryPolling();
    this.pendingVampireFinalSnapshot = null;
    this.vampireSummaryRequestInFlight = false;
    this.pendingAutosave = false;
    this.activeGswbRunStartedAt = null;
    this.activeVampireRunStartedAt = null;
    this.vampirePendingItemCount = null;
    this.vampireCurrentRunItemCount = 0;
    this.loading = false;
    this.clearVampireProgressIndicator();
    this.session.disambiguationMode = false;

    this.saveSessionSnapshot(
      () => this.displayMessage('Run aborted and session saved.', 'green'),
      undefined,
      undefined,
      'autosave'
    );
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
    return (this.loading || this.activeGswbRunStartedAt !== null || this.activeVampireRunStartedAt !== null) && !this.saveOperationInProgress;
  }

  get isVampireProgressVisible(): boolean {
    return this.activeVampireRunStartedAt !== null || this.vampireProgressTotalCount !== null;
  }

  get isVampireProgressAnimating(): boolean {
    return this.isVampireProgressVisible && this.vampireProgressInProgress;
  }

  get vampireProgressPercent(): number {
    const total = this.vampireProgressTotalCount ?? 0;
    if (total <= 0) return 0;
    const count = Math.min(this.vampireProgressItemCount ?? 0, total);
    return Math.max(0, Math.min(100, Math.round((count / total) * 100)));
  }

  get vampireProgressLabel(): string {
    const current = this.vampireProgressItemCount ?? 0;
    const total = this.vampireProgressTotalCount ?? this.vampirePendingItemCount ?? this.vampireCurrentRunItemCount;
    const proofs = this.vampireProgressProofCount ?? 0;
    return `Vampire backend working: ${current} of ${total} items processed · ${proofs} proofs in session`;
  }

  get hasTimingInfo(): boolean {
    return this.session.timing.parseMs !== null || this.session.timing.totalMs !== null;
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

  get processingTimingSummary(): string {
    const timing = this.session.timing;

    if (timing.totalMs !== null) {
      return `Overall ${this.formatDuration(timing.totalMs)}`;
    }

    if (timing.parseMs !== null) {
      return `Parse ${this.formatDuration(timing.parseMs)} · Vampire pending`;
    }

    return '';
  }

  get processingTimingDetails(): string {
    const timing = this.session.timing;
    const lines: string[] = [];

    if (timing.startedAt) lines.push(`Started: ${timing.startedAt}`);
    if (timing.parseMs !== null) lines.push(`Parse phase: ${this.formatDuration(timing.parseMs, true)}`);
    if (timing.vampireMs !== null) lines.push(`Vampire phase: ${this.formatDuration(timing.vampireMs, true)}`);
    if (timing.totalMs !== null) lines.push(`Overall: ${this.formatDuration(timing.totalMs, true)}`);

    return lines.join('\n');
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

          let mcMap = {};
          for (let [key, value] of Object.entries(data.annotations) as [string, LigerRuleAnnotation][]) {
            mcMap[key] = value.meaningConstructors;
          }

          let sortedMcMap = {};
          Object.keys(mcMap).sort((a, b) => {
            let aNum = parseInt(a.match(/\d+/)[0]);
            let bNum = parseInt(b.match(/\d+/)[0]);
            return aNum - bNum;
          }).forEach(key => {
            sortedMcMap[key] = mcMap[key];
          });

          this.sortedMCmap = sortedMcMap;

          this.gswbMultipleRequest = {
            premises: sortedMcMap,
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
    this.vampireCurrentRunItemCount = 0;
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
          const sols = this.getSolutionsText(premise, gswbOutputs, useDisambiguated);
          if (sols.length > 0) premise_strings.push(sols.join('\n'));

          const liger_data = annotations[premise];
          if (liger_data?.axioms?.length) {
            for (let axiom of liger_data.axioms) {
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
          const sols = this.getSolutionsText(conclusion, gswbOutputs, useDisambiguated);
          if (sols.length > 0) conclusion_strings.push(sols.join('\n'));

          const liger_data = annotations[conclusion];
          if (liger_data?.axioms?.length) {
            for (let axiom of liger_data.axioms) {
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
        inference_items[item.id] = { premises: premise_strings, hypothesis: conclusion_strings, axioms: axioms };
      }
    }

    const pruning = this.contextPruning.nativeElement.checked;

    const vampireRequest: vampireMultipleRequest = {
      nli_items: inference_items,
      vampire_preferences: this.vampirePreferences.vampirePreferences,
      pruning: pruning,
      session_key: this.redisSessionKey
    };

    this.logBackendPayload('Vampire batch request', this.testsuiteUpdateMode, vampireRequest);

    this.vampireCurrentRunItemCount = Object.keys(inference_items).length;
    console.log("Vampire request: ", vampireRequest);
    if (Object.keys(inference_items).length === 0) {
      this.displayMessage("No missing Vampire items to process.", "blue");
      return;
    }

    this.session.lastVampireScopeIdsBySentence = this.cloneSelectionRecord(this.session.selectedScopeIdsBySentence);
    this.session.lastVampireMcIdsBySentence = this.cloneSelectionRecord(this.session.selectedMcIdsBySentence);
    this.session.lastVampireSolutionIdsBySentence = this.cloneSelectionRecord(this.session.selectedSolutionIdsBySentence);
    this.session.hasRunVampire = true;
    this.saveSessionSnapshot();

    this.loading = true;
    this.vampirePendingItemCount = Object.keys(inference_items).length;
    this.activeVampireRunStartedAt = vampireStartedAt;
    this.startVampireProgressIndicator(this.regressionTestItems.length || this.vampirePendingItemCount || 0);
    this.startVampireSummaryPolling(vampireStartedAt, vampireRunToken);
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

  private getSolutionsText(
    sentenceId: string,
    gswbOutputs: Record<string, GswbOutput>,
    useDisambiguated: boolean
  ): string[] {
    const sols = gswbOutputs[sentenceId]?.solutions ?? [];

    if (!useDisambiguated) return sols.map(x => x.solution);

    const selectedIds = this.session.selectedSolutionIdsBySentence[sentenceId];

    // In disambiguated mode, only the chosen solutions should be sent onward.
    if (!selectedIds || selectedIds.length === 0) return [];

    const sel = new Set(selectedIds);
    return sols.filter(x => sel.has(x.id)).map(x => x.solution);
  }

  private startVampireSummaryPolling(vampireStartedAt: number, runToken: number): void {
    this.stopVampireSummaryPolling();

    this.vampireSummaryPollTimer = setInterval(() => {
      this.loadAndRenderVampireState(false, vampireStartedAt, runToken);
    }, 15000);
  }

  private stopVampireSummaryPolling(): void {
    if (this.vampireSummaryPollTimer !== null) {
      clearInterval(this.vampireSummaryPollTimer);
      this.vampireSummaryPollTimer = null;
    }
  }

  private startVampireProgressIndicator(totalCount: number): void {
    this.vampireProgressTotalCount = totalCount;
    this.vampireProgressItemCount = 0;
    this.vampireProgressProofCount = 0;
    this.vampireProgressInProgress = true;
  }

  private updateVampireProgressIndicator(summary: VampireSessionSummary): void {
    this.vampireProgressItemCount = summary?.item_count ?? 0;
    this.vampireProgressProofCount = summary?.proof_count ?? 0;
    this.vampireProgressTotalCount = this.regressionTestItems.length || this.vampireProgressTotalCount;
  }

  private clearVampireProgressIndicator(): void {
    this.vampireProgressItemCount = null;
    this.vampireProgressProofCount = null;
    this.vampireProgressTotalCount = null;
    this.vampireProgressInProgress = false;
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

        this.updateVampireProgressIndicator(summary);
        this.renderVampireResults(session?.results ?? {}, summary, finalSnapshot, this.vampirePreserveExistingResults);

        const proofCount = summary?.proof_count ?? 0;
        const runItems = this.vampireCurrentRunItemCount || this.vampirePendingItemCount || this.regressionTestItems.length;
        const message = this.currentVampireRunKind === 'append'
          ? `${finalSnapshot ? 'Append inference summary' : 'Append inference progress'}: ${runItems} item(s) refreshed, ${proofCount} proofs in session.`
          : this.vampirePreserveExistingResults
            ? `${finalSnapshot ? 'Vampire rerun summary' : 'Vampire rerun'}: ${runItems} item(s) refreshed, ${proofCount} proofs in session.`
            : `${finalSnapshot ? 'Inference results summary' : 'Vampire progress'}:\nProcessed items: ${summary?.item_count ?? 0} of ${runItems}\nProcessed proofs: ${proofCount}`;

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
          this.activeVampireRunStartedAt = null;
          this.stopVampireSummaryPolling();
          this.clearVampireProgressIndicator();
          this.saveSessionSnapshot();
        }
      },
      error: error => {
        if (runToken !== this.vampireRunToken) return;

        console.warn("Unable to load Vampire progress summary.", error);
        if (finalSnapshot) {
          this.loading = false;
          this.vampirePendingItemCount = null;
          this.activeVampireRunStartedAt = null;
          this.stopVampireSummaryPolling();
          this.clearVampireProgressIndicator();
          this.saveSessionSnapshot();
          this.displayMessage("Batch processing completed, but Redis state could not be reloaded.", "red");
        }
      }
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

    const currentInferenceResults: RegressionInferenceResult[] = [];

    for (const testItem of this.regressionTestItems) {
      const value = mergedResults?.[testItem.id];
      if (!value || value.length === 0) continue;

      const infoCount = value.filter(check => check.informative).length;
      const consistentCount = value.filter(check => check.consistent).length;
      const glyphs: string[] = value.map(check => check.glyph);

      const infoSuccess = infoCount > value.length / 2;
      const consistentSuccess = consistentCount > value.length / 2;

      let entailment_label = '0';
      if (infoSuccess && consistentSuccess) entailment_label = '0';
      else if (!infoSuccess && consistentSuccess) entailment_label = '1';
      else if (!consistentSuccess) entailment_label = '-1';

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
          let mcMap = {};
          for (let [key, value] of Object.entries(data.annotations) as [string, LigerRuleAnnotation][]) {
            mcMap[key] = value.meaningConstructors;
          }

          this.gswbMultipleRequest = {
            premises: mcMap,
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

  get isSessionActionLocked(): boolean {
    return this.loading || this.sessionLoadState === 'loading' || this.saveOperationInProgress;
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
      selectedScopeIds: this.session.selectedScopeIdsBySentence[sid] ?? [],
      selectedMcIds: this.session.selectedMcIdsBySentence[sid] ?? [],
    });
  }



}
