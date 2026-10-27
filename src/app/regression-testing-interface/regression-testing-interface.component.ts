import { Component, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { DataService } from "../data.service";
import { proofInputsFrom } from '../document-builder/proof-inputs';
import { discourseUpdateOf } from '../document-builder/pcdrs-readings';
import { GraphVisComponent } from "../liger-vis/liger-graph-vis/graph-vis.component";
import { ActivatedRoute } from '@angular/router';
import {
  AnaphoraRankerSelection,
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
  DiscourseUpdate,
  GswbProofInput,
  GswbRequest,
  LigerSolutionAnnotationResponse,
  SentenceAnalysis,
  SequenceAnalysis,
  XlePlusGlueDocument,
  SynSemMapping,
  SyntacticAnalysis,
  InferenceReportRow,
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
  VampireSessionSummary,
  sameReasoningUpdate,
  POST_PROCESSING_SKIPPED_NOTICE,
  hasPostProcessingRules,
  mergeGrammarAxioms,
  GrammarAxioms,
  VampirePreferences,
  isDefaultSessionKey,
} from '../models/models';
import { GswbSettingsComponent } from "../gswb-vis/gswb-settings/gswb-settings.component";
import { EditorComponent } from "../editor/editor.component";
import { catchError, defer, EMPTY, Observable, ReplaySubject, Subscription, concatMap, filter, forkJoin, finalize, from, repeat, take, timeout, map, of, switchMap, throwError, toArray } from "rxjs";
import { tap } from "rxjs/operators";
import { InferenceSettingsComponent } from "../inference-interface/inference-settings/inference-settings.component";
import {SemvisDialogComponent} from "../utilities/semvis-dialog/semvis-dialog.component";
import { APP_DEFAULTS } from '../app-defaults';
import {
  ALL_ANAPHORA_BRANCHES,
  AnaphoraSelectionPolicy,
  anaphoraRankerSelection,
  anaphoraSelectionPolicy,
  carryAnaphoraRanking,
  compositeAnalysisId,
  selectForVampire,
  discourseBranchesForDisplay,
  inferenceResultsFromDocument,
  majorityVerdict,
  needsAnaphoraRanking,
  parseReasoningAssignmentId,
  readingOf,
  reasoningUpdateId,
  validateReasoningUpdate,
} from '../analysis-model';
import { PreparedReasoningPair, ReasoningPipelineService } from '../reasoning/reasoning-pipeline.service';
import { AnaphoraRankingService } from '../reasoning/anaphora-ranking.service';
import {
  DocumentBuilderService,
  SequenceMergePair,
  SequenceMergePreviousContext,
} from '../document-builder/document-builder.service';
import { LigerWorkspaceService, RuleSetOrigin } from '../liger-workspace/liger-workspace.service';
import {
  INFERENCE_PHASES, PARSE_PHASES, ParseReport, RunPhase, addToPhase, reportMarkdown, reportSummary, reportTables, startPhase,
  timingStats,
} from './run-report';

/** What a run sends and a session stores: the testsuite, and the rule set's three texts. */
type SessionInputTexts = { testsuite: string; semantics: string; pragmatics: string; axioms: string };

const NO_RULE_SET_NOTICE = 'No rule set is open: load the grammar\'s LiGER config under '
  + 'Grammar selection, or use Open… in the rule set.';

const INPUT_LABELS: Record<keyof SessionInputTexts, string> = {
  testsuite: 'testsuite', semantics: 'semantics rules', pragmatics: 'pragmatics rules', axioms: 'axioms',
};

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
 *  running prior fed to the NEXT `appendSentence` call; `sequenceStructure`/
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

/** A fresh id for one Vampire submission. */
function newRunId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

@Component({
  selector: 'app-regression-testing-interface',
  templateUrl: './regression-testing-interface.component.html',
  styleUrls: ['./regression-testing-interface.component.css'],
  // One column whose boxes (the testsuite editor, the rule set, the applied-rules graph)
  // fill it, as on the analysis page.
  host: { class: 'fluid-boxes' },
})
export class RegressionTestingInterfaceComponent implements AfterViewInit, OnDestroy {

  private readonly activeSessionStorageKey = 'regression-testing-active-session-key';

  constructor(
    private dataService: DataService,
    private route: ActivatedRoute,
    private reasoningPipeline: ReasoningPipelineService,
    private documentBuilder: DocumentBuilderService,
    private anaphoraRanking: AnaphoraRankingService,
    /** The rule set a run uses; its texts are mirrored into the session (see
     *  `onWorkspaceChange`). Read by the template. */
    public ligerWorkspace: LigerWorkspaceService,
  ) {
    this.lastSavedSessionFingerprint = this.buildSessionFingerprint(regressionSessionToDocument(this.session));
    // Deliberately no per-path baseline here: nothing is stored yet, so the first save
    // must be a full PUT rather than a patch against a session that does not exist.
    this.lastSavedSectionFingerprints = {};
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

  @ViewChild('testfile') testfile: EditorComponent;
  @ViewChild('errorhandle') errorhandle: ElementRef;

  @ViewChild('semvisDialog') semvisDialog: SemvisDialogComponent;
  @ViewChild('discourseDialog') discourseDialog: SemvisDialogComponent;

  gswbMultipleRequest: GswbMultipleRequest;

  inferenceSummary = "";
  parsingSummary = "";
  loading: boolean = false;
  /** An inference run is building its TPTP checks: it holds the run lock (`loading`) but has
   *  sent nothing to Vampire yet. */
  preparingInference = false;
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
  /** Whether automatic saves are allowed to write. Off lets a session be poked at --
   *  reparsed, rerun, disambiguated differently -- without any of it reaching Redis, so
   *  the stored session stays as it was. Explicit "Save current session"/"Save as" ignore
   *  this: turning autosave off means "do not save behind my back", not "refuse to save".
   *
   *  Deliberately NOT persisted to localStorage or into the session document. A save
   *  switch that silently stays off across reloads is how a run's work goes missing, which
   *  this codebase has already done once the hard way (2026-09-04, every save a 404). It
   *  resets to on with every page load, and while it is off the view says so. */
  autosaveEnabled = true;
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
  /** True from the moment a Vampire submission begins until every terminal path for it has
   *  run. It exists because `submitVampireRequest` ARMS the progress poll in the callback of
   *  one request (the progress-record clear) and DISARMS it in the callback of another (the
   *  batch POST), with no ordering between them: a POST that settles first -- a refused
   *  connection returns in microseconds while the DELETE is still in flight -- stopped a
   *  poller that had not started yet, and the clear's callback then armed an interval
   *  nothing would ever clear. `vampireRunToken` cannot stand in for this: no terminal path
   *  bumps it, so its guard passes for exactly the run being torn down. 2026-09-08. */
  private vampireRunInFlight = false;
  /** The id this tab gave its current Vampire submission. The service refuses a second run
   *  of a session while one is active, and a cancel names the run it is meant for, so an
   *  abort can wait for exactly that run to stop. Null before the first submission. */
  private vampireRunId: string | null = null;
  /** How long an abort waits for the service to confirm the run stopped. */
  private readonly vampireStopTimeoutMs = 30000;
  /** Whether the progress poll has seen THIS run reported as running yet. Guards the
   *  terminal states in `pollVampireProgress` against a previous run's leftover record. */
  private vampireProgressSawRunning = false;
  /** The item the progress record currently names, so the report can show the run walking
   *  down the list. Null whenever no run is in flight. */
  private vampireActiveItemId: string | null = null;
  /** Which NLI items "Run inference" should run. Empty means all of them -- the selection
   *  narrows a run, it does not gate one. Deliberately NOT persisted: it describes the next
   *  run, not the session, and a stored selection would silently narrow a reloaded one. */
  private readonly selectedNliItemIds = new Set<string>();
  /** Which sentences "Parse" should reparse. Empty means a parse of the whole testsuite.
   *  Not persisted, for the same reason as the NLI item selection. */
  private readonly selectedParseSentenceIds = new Set<string>();
  /** The in-flight NLI preparation chain, so abort and teardown can stop it. */
  private nliPreparationSubscription: Subscription | null = null;
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
  /** Per-path fingerprints of what is actually stored, so an autosave can send only the
   *  paths that changed. Empty means "no baseline" -- the next save is a full PUT. */
  private lastSavedSectionFingerprints: Record<string, string> = {};
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

  /** Whether "Parse" continues into Vampire on its own. Off means parsing stops when
   *  parsing is done, and inference is a separate act -- the "Run inference" button.
   *  Persisted with the session, and true by default so an existing session
   *  behaves as it always did. */
  get enableInference(): boolean {
    return this.session.enableInference;
  }

  set enableInference(value: boolean) {
    this.session.enableInference = value;
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
    this.startSessionLease();
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
    this.isHydratingSession = false;
    this.workspaceSubscription = this.ligerWorkspace.state$.subscribe(() => this.onWorkspaceChange());
    this.lastSavedInputs = this.currentInputTexts();

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
  }

  // --- The rule set: the LiGER workspace, mirrored into the session ---------------------
  //
  // The session's rulesText/pragmaticsRulesText/axiomsText are what a run sends and what is
  // stored, so a stored session says exactly what its runs used. They follow the workspace:
  // every change there is copied in and autosaved. Restoring a session goes the other way:
  // its stored per-file text reopens the rule set over whatever is on disk now, because the
  // stored session is the ground truth.

  private workspaceSubscription?: Subscription;
  /** The rule set being reopened for a restored session; workspace changes are not copied
   *  into the session until it has settled, or a file's disk text could be autosaved over
   *  the stored one. */
  private ruleSetRestorePath: string | null = null;
  /** Set while a new session's rule set is being opened afresh from disk: runs wait, and its
   *  arrival is the blank session's starting point, not an unsaved change. */
  private blankRuleSetPending = false;
  /** The workspace output last seen, so only a real change is copied into the session:
   *  reading a lexicon, say, changes the workspace's state but not what a run sends. */
  private lastWorkspaceOutputKey: string | null = null;
  /** Why the session's rule texts are not the workspace's, when they are not. */
  ruleSetNotice = '';
  /** The inputs as last stored, for the "changed since the last save" warning. */
  private lastSavedInputs: SessionInputTexts | null = null;

  get isRestoringRuleSet(): boolean {
    return this.ruleSetRestorePath !== null || this.blankRuleSetPending;
  }

  /** Which inputs differ from the last save, in words; empty when none do. */
  get unsavedInputChanges(): string[] {
    const saved = this.lastSavedInputs;
    if (!saved) return [];
    const current = this.currentInputTexts();
    return (Object.keys(INPUT_LABELS) as (keyof SessionInputTexts)[])
      .filter(key => current[key] !== saved[key])
      .map(key => INPUT_LABELS[key]);
  }

  private currentInputTexts(): SessionInputTexts {
    return {
      testsuite: this.session.testsuiteText ?? '',
      semantics: this.session.rulesText ?? '',
      pragmatics: this.session.pragmaticsRulesText ?? '',
      axioms: this.session.axiomsText ?? '',
    };
  }

  private markInputsSaved(snapshot: RegressionSessionDocument): void {
    const inputs = snapshot.inputs;
    this.lastSavedInputs = {
      testsuite: inputs.testsuite?.text ?? '',
      semantics: inputs.rules?.text ?? '',
      pragmatics: inputs.pragmaticsRules ?? '',
      axioms: inputs.axioms?.text ?? '',
    };
  }

  /** What the workspace would have a run send, or null while it has nothing settled. */
  private workspaceOutput(): { key: string; source: string; origin: RuleSetOrigin | null;
      semantics: string; pragmatics: string;
      axioms: string; files: Record<string, string>; excluded: string[];
      loadedSemantics: string; loadedAxioms: string } | null {
    const state = this.ligerWorkspace.state;
    if (state.loading || !state.ruleSet) return null;
    let semantics: string, pragmatics: string, axioms: string;
    try {
      semantics = this.ligerWorkspace.semantics ?? '';
      pragmatics = this.ligerWorkspace.pragmatics ?? '';
      axioms = this.ligerWorkspace.axioms ?? '';
    } catch (error) {
      // A section short of a file cannot be assembled; nothing is copied rather than a
      // rule set missing rules.
      console.warn('[Regression] the rule set cannot be assembled', error);
      return null;
    }
    const source = state.ruleSet.source;
    const origin = state.origin;
    return {
      // The origin too: it decides whether a grammar load may replace this rule set.
      key: JSON.stringify([source, origin, semantics, pragmatics, axioms]),
      source, origin, semantics, pragmatics, axioms,
      files: this.ligerWorkspace.fileTexts(),
      excluded: [...state.excluded],
      loadedSemantics: state.ruleSet.semantics ?? '',
      loadedAxioms: state.ruleSet.axioms ?? '',
    };
  }

  private onWorkspaceChange(): void {
    if (this.isHydratingSession) return;
    if (this.blankRuleSetPending) {
      if (this.ligerWorkspace.state.loading) return;
      this.blankRuleSetPending = false;
      this.adoptBlankRuleSet();
      // The reopened rule set is where the blank session starts, not a change to save.
      this.lastSavedSessionFingerprint = this.buildSessionFingerprint(this.buildSessionSnapshot());
      this.lastSavedInputs = this.currentInputTexts();
      return;
    }
    if (this.ruleSetRestorePath !== null) {
      this.finishRuleSetRestore();
      return;
    }
    const output = this.workspaceOutput();
    if (!output || output.key === this.lastWorkspaceOutputKey) return;
    this.lastWorkspaceOutputKey = output.key;
    this.adoptWorkspaceOutput(output);
    this.scheduleSessionSave();
  }

  private adoptWorkspaceOutput(output: NonNullable<ReturnType<RegressionTestingInterfaceComponent['workspaceOutput']>>): void {
    this.ruleSetNotice = '';
    this.session.rulesFilename = output.source;
    this.session.rulesText = output.semantics;
    this.session.rulesLoadedText = output.loadedSemantics;
    this.session.pragmaticsRulesText = output.pragmatics;
    this.session.axiomsFilename = output.source;
    this.session.axiomsText = output.axioms;
    this.session.axiomsLoadedText = output.loadedAxioms;
    this.session.ruleSetFiles = output.files;
    this.session.ruleSetOrigin = output.origin;
    this.session.ruleSetExcluded = output.excluded;
  }

  /** Takes the freshly opened rule set into a blank session. */
  private adoptBlankRuleSet(): void {
    const output = this.workspaceOutput();
    this.lastWorkspaceOutputKey = output?.key ?? null;
    if (output) {
      this.adoptWorkspaceOutput(output);
    } else {
      this.ruleSetNotice = NO_RULE_SET_NOTICE;
    }
  }

  /** Reopens the restored session's rule set with its stored per-file text. */
  private restoreRuleSet(): void {
    this.blankRuleSetPending = false;  // a restored session's rule set replaces a blank one's
    const path = this.session.rulesFilename;
    this.ruleSetNotice = '';
    if (!path) {
      this.ruleSetRestorePath = null;
      this.lastWorkspaceOutputKey = this.workspaceOutput()?.key ?? null;
      if ((this.session.rulesText ?? '').trim()) {
        this.ruleSetNotice = 'This session stores rules but no rule set they came from. Runs use '
          + 'the stored rules until a rule set is opened or edited, which replaces them.';
      }
      return;
    }
    this.ruleSetRestorePath = path;
    // A session from before origins were stored chose its rules file by hand.
    this.ligerWorkspace.open(path, this.session.ruleSetFiles ?? undefined,
      this.session.ruleSetOrigin ?? 'selected', this.session.ruleSetExcluded ?? []);
  }

  /** Called on each workspace change while a restore is pending; acts once it settled. */
  private finishRuleSetRestore(): void {
    const path = this.ruleSetRestorePath!;
    const state = this.ligerWorkspace.state;
    if (state.loading) return;
    this.ruleSetRestorePath = null;
    const output = this.workspaceOutput();
    // From here on, only a change the user makes is copied into the session.
    this.lastWorkspaceOutputKey = output?.key ?? null;

    if (!output || output.source !== path || state.openFailed === path) {
      this.ruleSetNotice = `Could not reopen ${path}${state.error ? ` (${state.error})` : ''}. `
        + 'Runs use the rules stored with the session.'
        + (state.ruleSet ? '' : ` ${NO_RULE_SET_NOTICE}`);
      return;
    }
    const stored = this.currentInputTexts();
    const differing = (['semantics', 'pragmatics', 'axioms'] as const)
      .filter(key => output[key] !== stored[key])
      .map(key => INPUT_LABELS[key]);
    if (differing.length) {
      // The stored text is the ground truth; it could not be rebuilt file by file (a session
      // from before the workspace, or a config whose file list changed), so it stays as
      // stored rather than being autosaved over.
      this.ruleSetNotice = `The stored ${differing.join(', ')} differ from ${path} as reopened`
        + `${state.error ? ` (${state.error})` : ''}. Runs use the stored text until the rule set `
        + 'is edited or another is opened, which replaces it.';
      return;
    }
    // Reopened exactly: take the per-file text too (a session from before the workspace
    // gains it), which changes nothing a run sends.
    this.adoptWorkspaceOutput(output);
    this.scheduleSessionSave();
  }

  getGrammarDisplay(): string {
    return this.session.grammarPath || 'Not loaded';
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
    // A parse can replace the items outright (write mode). Anything selected that no longer
    // exists has to go, or the next run is narrowed to items nobody can see.
    this.pruneNliItemSelection();
    this.pruneParseSentenceSelection();
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

  /** This tab's claim on the session it has open: the store sweeps unnamed sessions no
   *  browser holds open every 30 minutes, so the lease is renewed well inside its 10-minute
   *  life, moved when the session changes, and released when the view or the page goes. */
  private readonly sessionLeaseHolderId = newRunId();
  private leasedSessionKey: string | null = null;
  private sessionLeaseTimer: ReturnType<typeof setInterval> | null = null;
  private readonly sessionLeaseRenewMs = 2 * 60 * 1000;
  private readonly releaseLeaseOnPageHide = () => this.releaseSessionLeaseOnUnload();

  private startSessionLease(): void {
    this.renewSessionLease();
    this.sessionLeaseTimer = setInterval(() => this.renewSessionLease(), this.sessionLeaseRenewMs);
    window.addEventListener('pagehide', this.releaseLeaseOnPageHide);
  }

  private stopSessionLease(): void {
    if (this.sessionLeaseTimer !== null) {
      clearInterval(this.sessionLeaseTimer);
      this.sessionLeaseTimer = null;
    }
    window.removeEventListener('pagehide', this.releaseLeaseOnPageHide);
    this.releaseSessionLease();
  }

  /** Holds the lease on the open session, moving it off a session this tab has left. */
  private renewSessionLease(): void {
    const sessionKey = this.redisSessionKey;
    if (this.leasedSessionKey && this.leasedSessionKey !== sessionKey) {
      this.releaseSessionLease();
    }
    if (!sessionKey || sessionKey === 'last_session') return;
    this.leasedSessionKey = sessionKey;
    this.dataService.holdSessionLease(sessionKey, this.sessionLeaseHolderId).subscribe({
      error: error => console.warn('Unable to renew the session lease.', { sessionKey, error }),
    });
  }

  private releaseSessionLease(): void {
    const sessionKey = this.leasedSessionKey;
    if (!sessionKey) return;
    this.leasedSessionKey = null;
    this.dataService.releaseSessionLease(sessionKey, this.sessionLeaseHolderId).subscribe({
      error: () => undefined,
    });
  }

  /** A closing page cancels HttpClient requests; a keepalive fetch outlives it. Failing is
   *  harmless -- the lease lapses on its own. */
  private releaseSessionLeaseOnUnload(): void {
    const sessionKey = this.leasedSessionKey;
    if (!sessionKey) return;
    try {
      fetch(this.dataService.sessionLeaseReleaseUrl(sessionKey, this.sessionLeaseHolderId),
        { method: 'POST', keepalive: true }).catch(() => undefined);
    } catch {
      // The lease lapses on its own.
    }
  }

  private setPersistedActiveSessionKey(sessionKey: string): void {
    // The open session may just have changed (save as, load, new session).
    if (this.sessionLeaseTimer !== null) this.renewSessionLease();
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
    if (!this.autosaveEnabled) return;

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
    lockAlreadyHeld = false,
    userInitiated = false
  ): void {
    if (this.isHydratingSession || !this.sessionPersistenceEnabled) return;

    // `action` cannot answer this. The post-run and post-abort snapshots pass 'current'
    // only to get past the `abortRequestInFlight` guard above -- they are still automatic
    // saves, and suppressing autosave has to suppress them too, or aborting a run would
    // write the very results the user turned saving off to avoid. Only saveCurrentSession
    // sets userInitiated.
    if (!this.autosaveEnabled && !userInitiated) return;

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
    if (serialized === this.lastSavedSessionFingerprint) {
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

    // A full PUT only when there is no baseline to diff against (a first save, a
    // save-as, or a fresh load). Otherwise send just the paths that changed -- during a
    // run that is the reasoning results, not the ~7 MB of immutable parse phase sitting
    // next to them. This is what stopped autosave producing ~25 MB of Redis AOF a minute.
    this.issueSessionWrite(snapshot, serialized, this.changedSessionPaths(snapshot),
      successMessage, onSuccess, onComplete);
  }

  /** One session write, plus the recovery for when the store says there is no such session.
   *
   *  `changed === null` writes the whole session with a PUT; otherwise only the named
   *  paths go as a PATCH. A PATCH is refused with a 404 whenever the per-path baseline
   *  describes a session Redis does not have -- deleted from another tab, the store
   *  cleared under a running session, or a baseline that was wrong to begin with. That is
   *  recovered from by dropping the baseline and retrying once as a full PUT, not
   *  surfaced: an unrecoverable 404 here means every save for the rest of the run fails
   *  the same way and the run's results are never stored at all, which is exactly what
   *  happened before (observed 2026-09-04: a 322s run, every save a 404, nothing kept).
   *
   *  Bounded at one retry -- the retry passes `changed === null`, so its own failure
   *  cannot re-enter this branch. */
  private issueSessionWrite(
    snapshot: RegressionSessionDocument,
    serialized: string,
    changed: { paths: Record<string, unknown> } | null,
    successMessage?: string,
    onSuccess?: () => void,
    onComplete?: () => void
  ): void {
    let saveSucceeded = false;
    let retryingAsFullSave = false;

    const request$ = changed === null
      ? this.dataService.saveRegressionSession(this.redisSessionKey, serialized)
      : this.dataService.patchRegressionSession(this.redisSessionKey,
          JSON.stringify({ paths: changed.paths }));

    request$.pipe(
      finalize(() => {
        // The retry owns the save lock and the callbacks from here on; releasing them now
        // would report the save finished while it is still in flight.
        if (retryingAsFullSave) return;
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
        this.lastSavedSessionFingerprint = serialized;
        this.lastSavedSectionFingerprints = this.sessionSectionFingerprints(snapshot);
        this.markInputsSaved(snapshot);
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
        if (changed !== null && error?.status === 404) {
          console.warn('Patched a session the store does not have; saving it in full instead.', error);
          // Drop the baseline so this write -- and every later one -- is a full PUT.
          this.lastSavedSectionFingerprints = {};
          retryingAsFullSave = true;
          this.issueSessionWrite(snapshot, serialized, null, successMessage, onSuccess, onComplete);
          return;
        }

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
      true,
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

  /** Fingerprint each path separately, so a save can tell which ones moved. */
  private sessionSectionFingerprints(snapshot: RegressionSessionDocument): Record<string, string> {
    const paths = this.sessionSectionPaths(snapshot);
    const fingerprints: Record<string, string> = {};
    for (const [path, value] of Object.entries(paths)) {
      fingerprints[path] = JSON.stringify(value ?? null);
    }
    return fingerprints;
  }

  /** The paths whose contents differ from what is stored, or `null` when there is no
   *  baseline and the whole session has to be written. */
  private changedSessionPaths(
    snapshot: RegressionSessionDocument
  ): { paths: Record<string, unknown> } | null {
    if (!Object.keys(this.lastSavedSectionFingerprints).length) {
      return null;
    }
    const current = this.sessionSectionPaths(snapshot);
    const paths: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(current)) {
      const fingerprint = JSON.stringify(value ?? null);
      if (fingerprint !== this.lastSavedSectionFingerprints[path]) {
        paths[path] = value ?? null;
      }
    }
    // A path that vanished from the snapshot entirely is not patched away -- replacing a
    // stored value requires a value, and dropping keys is not something autosave should
    // be doing silently.
    return { paths };
  }

  /** The session split by how often each part actually changes.
   *
   *  A session is 8-12 MB and rewriting all of it on every autosave produced ~25 MB of
   *  Redis AOF per minute during a run -- enough to force AOF rewrites, which fork Redis
   *  and transiently double its memory. But almost none of it changes during a run: the
   *  parse phase (`lastAnnotations` alone is ~5 MB, plus `regressionTestResults` and
   *  `lastGswbOutputs`) is written once and immutable thereafter, and the human's
   *  disambiguation choices cannot change while a run is in flight.
   *
   *  Paths are leaf-level where the size is, so the immutable bulk can be skipped
   *  independently of the small things next to it in the same section. */
  private sessionSectionPaths(snapshot: RegressionSessionDocument): Record<string, unknown> {
    const analysis: any = snapshot.analysis ?? {};
    const saveState: any = analysis.save_state ?? {};
    const system: any = analysis.system ?? {};
    const { updatedAt, ...metadataRest } = snapshot.metadata ?? ({} as any);
    const { lastGswbOutputs, lastAnnotations, sortedMCmap, ...saveStateRest } = saveState;

    return {
      'metadata': metadataRest,
      'inputs': snapshot.inputs,
      // Parse phase -- immutable once parsing is done, and the bulk of the payload.
      'analysis.system.sentenceMap': system.sentenceMap,
      'analysis.system.regressionTestItems': system.regressionTestItems,
      'analysis.system.regressionTestResults': system.regressionTestResults,
      'analysis.save_state.lastGswbOutputs': lastGswbOutputs,
      'analysis.save_state.lastAnnotations': lastAnnotations,
      'analysis.save_state.sortedMCmap': sortedMCmap,
      // The human's choices -- cannot change while a run is in flight.
      'analysis.human': analysis.human,
      // Reasoning -- what a run actually rewrites.
      'analysis.system.inferenceResults': system.inferenceResults,
      'analysis.save_state.lastVampireResults': saveState.lastVampireResults,
      'analysis.documents': analysis.documents,
      'analysis.report': analysis.report,
      // Everything else in save_state, all small.
      ...Object.fromEntries(Object.entries(saveStateRest)
        .filter(([key]) => key !== 'lastVampireResults')
        .map(([key, value]) => [`analysis.save_state.${key}`, value])),
    };
  }

  private buildSessionFingerprint(snapshot: RegressionSessionDocument): string {
    return this.serializeSessionSnapshot(snapshot);
  }

  private resetRuntimeStatus(): void {
    this.clearStatusMessage();
    // The item selection belongs to the session on screen, and item ids are per-session
    // names (n0, n1, ...) that recur across sessions -- so pruning against the new items
    // does NOT catch a stale one, it keeps it. Observed live: a selection made in one
    // session silently narrowed the next session's run to the two items that happened to
    // share their ids, and the other fourteen came back "Never attempted". 2026-09-08.
    this.selectedNliItemIds.clear();
    this.selectedParseSentenceIds.clear();
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
    // A new session runs on the open rule set as it is on disk: a previous session's stored
    // file text and left-out files, and its failed reopen, are not this session's business.
    this.ruleSetRestorePath = null;
    this.ruleSetNotice = '';
    this.ligerWorkspace.clearError();
    this.ligerWorkspace.reset();
    this.blankRuleSetPending = !!this.ligerWorkspace.state.loading;
    if (!this.blankRuleSetPending) {
      this.adoptBlankRuleSet();
    }
    this.writeSnapshot = this.captureParsedRegressionSnapshot();
    this.appendSnapshot = null;
    // The two fingerprints mean different things and a blank session is exactly where
    // they come apart, so they are set together here rather than in two places.
    // `lastSavedSessionFingerprint` describes what is in the BROWSER -- the blank session
    // is not dirty yet, so autosave has nothing to write. The per-path baseline describes
    // what is in REDIS, and nothing is: the new key has never been PUT. Giving it the
    // blank session's fingerprints made the first save a PATCH against a session that does
    // not exist, which the store refuses with a 404 -- so nothing was ever stored, for the
    // whole run.
    this.lastSavedSessionFingerprint = this.buildSessionFingerprint(this.buildSessionSnapshot());
    this.lastSavedSectionFingerprints = {};
    this.lastSavedInputs = this.currentInputTexts();
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
      pragmaticsRulesText: runtimeSnapshot.pragmaticsRulesText ?? '',
      testsuiteUpdateMode: runtimeSnapshot.testsuiteUpdateMode ?? 'write',
      lastVampireResults: runtimeSnapshot.lastVampireResults ?? null,
    };

    this.selectedSessionKey = this.redisSessionKey;
    this.gswbPreferences.gswbPreferences = { ...this.session.gswbPreferences };
    this.gswbPreferences.updateFormFromPreferences(this.session.gswbPreferences);
    this.vampirePreferences.vampirePreferences = { ...this.session.vampirePreferences };
    this.vampirePreferences.updateFormFromPreferences(this.session.vampirePreferences);

    this.testfile.updateContent(this.session.testsuiteText || '');
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
    const restored = this.buildSessionSnapshot();
    this.lastSavedSessionFingerprint = this.buildSessionFingerprint(restored);
    this.lastSavedSectionFingerprints = this.sessionSectionFingerprints(restored);
    this.markInputsSaved(restored);

    this.isHydratingSession = false;
    this.sessionPersistenceEnabled = true;
    // After hydration, so the reopened rule set's first change is seen as the restore's.
    this.restoreRuleSet();
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
        // A key that is not in the store comes back as 200 `{}`, not a 404
        // (Redis/redis_store.py `load_regression_session` returns {} on a miss). Taken as a
        // session, that empty document hydrated a patch baseline for something that does
        // not exist, and every later save 404'd against it. Treated as the miss it is.
        if (!snapshot || !Object.keys(snapshot).length) {
          this.failSessionLoad(sessionKey, { status: 404 });
          return;
        }
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
            `Testsuite: ${runtimeSnapshot?.testsuiteFilename || 'Not loaded'}`,
            `Rule set: ${runtimeSnapshot?.rulesFilename || 'Not loaded'}`,
          ].join('\n')
        );
      },
      error: error => this.failSessionLoad(sessionKey, error)
    });
  }

  /** Reset to a blank session and say why, for a load that did not produce one. */
  private failSessionLoad(sessionKey: string, error: any): void {
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
    // Only say the session survives when it actually does: a 404 means it is gone, and
    // telling the user it "is still stored" would send them back to reload nothing.
    const stillStored = error?.status !== 404;
    this.setSessionLoadStatus('error',
      `Could not load session ${sessionKey}`,
      `${this.describeLoadFailure(error)}\nStarted a new session instead`
      + (stillStored ? `; ${sessionKey} is still stored and can be loaded again.` : '.'));
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
    // Names of that shape mark unnamed working sessions: hidden from the inference banks and
    // swept by the store cleanup after a day.
    if (isDefaultSessionKey(sessionKey)) {
      this.displayMessage('That name has the form of an unsaved session ("session-<time>"); please choose another.', 'red');
      return;
    }
    const previousSessionKey = this.redisSessionKey;

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
        // The full snapshot was just written under the new key, so it is a valid patch
        // baseline for it. Without this the next autosave would patch the new key against
        // fingerprints describing the old one.
        this.lastSavedSectionFingerprints = this.sessionSectionFingerprints(snapshot);
        this.setPersistedActiveSessionKey(this.selectedSessionKey);
        this.discardUnnamedSession(previousSessionKey, sessionKey);
        this.loadRecentSessions();
        this.setSessionLoadStatus('success', `Saved session as ${sessionKey}`, `Session key: ${sessionKey}`);
      },
      error: error => {
        console.warn('Unable to save session as.', error);
        this.setSessionLoadStatus('error', `Failed to save session as ${sessionKey}`, 'The session could not be stored.');
      }
    });
  }

  /** After Save As the view works under the new name, and an unnamed session it was saved
   *  from is a copy nothing will open again -- so it goes, with its results and progress,
   *  instead of waiting for the store cleanup. A named session saved under a second name is
   *  a bank of its own and stays. */
  private discardUnnamedSession(previousSessionKey: string, newSessionKey: string): void {
    if (!isDefaultSessionKey(previousSessionKey) || previousSessionKey === newSessionKey) return;
    this.dataService.deleteRegressionSessions([previousSessionKey]).subscribe({
      error: error => console.warn('Unable to remove the unnamed session after Save As.', { previousSessionKey, error }),
    });
  }

  /** Saved sessions for the session list: banks only, the open session is listed as Current. */
  get namedRecentSessions(): RegressionSessionSummary[] {
    return this.recentSessions.filter(session =>
      session.sessionKey !== this.redisSessionKey && !isDefaultSessionKey(session.sessionKey));
  }

  /** Turn automatic saving on or off.
   *
   *  Switching it back on flushes whatever changed while it was off, rather than waiting
   *  for the next edit to trigger a save -- otherwise re-enabling would look like it took
   *  effect while the work done in the meantime sat unsaved until something happened to
   *  touch the session again. */
  setAutosaveEnabled(enabled: boolean): void {
    if (this.autosaveEnabled === enabled) return;
    this.autosaveEnabled = enabled;
    if (enabled) {
      this.scheduleSessionSave(true);
    }
  }

  /** Download the session as JSON, in the same shape the inference-bank dashboard exports
   *  and imports (a RegressionSessionDocument), so a file saved here can be loaded back
   *  there.
   *
   *  Deliberately the LIVE session, not a re-read of what is stored: with autosave off --
   *  or after a failed save -- the browser holds work Redis does not, and downloading the
   *  stored copy would hand back the stale one at exactly the moment the fresh one matters.
   *  That is also why this needs no request and works while the services are down. */
  downloadSessionJson(): void {
    const snapshot = this.buildSessionSnapshot();
    const name = snapshot.metadata?.redisSessionKey || snapshot.metadata?.id || this.redisSessionKey;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.json`;
    link.click();
    setTimeout(() => window.URL.revokeObjectURL(url), 10000);
    this.displayMessage(`Downloaded ${name}.json`, 'green');
  }

  /** The run report, every item's outcome and the confusion matrix as a Markdown file. Like
   *  the JSON download, it is built from the live session and needs no request. */
  downloadReportMarkdown(): void {
    const prefs = this.session.vampirePreferences;
    const settings: Array<[string, string]> = [
      ['Grammar', this.session.grammarPath || 'Not loaded'],
      ['Rule set', this.session.rulesFilename || 'Not loaded'],
      ['Axioms', this.session.axiomsFilename || 'None'],
      ['Testsuite', this.session.testsuiteFilename || 'Not loaded'],
      ['Logic type', this.session.lastLogicType || (prefs?.logic_type === 0 ? 'fof' : 'tff')],
      ['Max duration (s)', String(prefs?.max_duration ?? '')],
      ['Model building', String(prefs?.model_building ?? '')],
      ['Anaphora selection', `${prefs?.anaphora_selection ?? 'all'}`
        + (prefs?.anaphora_selection === 'top_k' ? ` (k = ${prefs?.anaphora_top_k ?? ''})` : '')],
      ['Anaphora rankers', (prefs?.anaphora_rankers ?? []).join(', ')],
    ];
    const items = this.inferenceReportRows.map(row => ({
      id: row.id,
      gold: this.labelText(row.data.goldLabel),
      predicted: this.labelText(row.data.predictedLabel),
      status: row.status === 'done' ? (row.data.mismatch ? 'wrong' : 'correct') : row.status,
      reason: row.status === 'unparsed' ? `No reading: ${row.unparsedSentences.join(' / ')}` : row.reason,
      premises: row.data.premises ?? [],
      hypothesis: row.data.conclusion ?? '',
    }));
    const confusion = this.inferenceResults.length ? {
      labels: [...this.labels],
      names: { ...this.labelName },
      counts: this.cmView.map(goldRow => goldRow.rows.map(cell => cell.v)),
    } : null;

    const name = `${this.redisSessionKey}-report-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const markdown = reportMarkdown(this.session.report, {
      sessionKey: this.redisSessionKey, settings, items, confusion,
    });
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.md`;
    link.click();
    setTimeout(() => window.URL.revokeObjectURL(url), 10000);
    this.displayMessage(`Downloaded ${name}.md`, 'green');
  }

  private labelText(label: string): string {
    return (this.labelName as Record<string, string>)[label] ?? (label || '');
  }

  createNewSession(): void {
    if (this.isSessionActionLocked) return;
    this.initializeBlankSession();
    // AFTER the reset, for the same reason the failed-load path stamps after it:
    // initializeBlankSession() clears the status to idle/'', so a message posted first is
    // wiped. Starting a session is an action and says so -- leaving the box blank made it
    // the one action that reported nothing, which reads the same as a click that missed.
    this.setSessionLoadStatus('success', `Started new session ${this.redisSessionKey}`,
      `Session key: ${this.redisSessionKey}`);
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
          this.session.lastGswbOutputs = outputs;
          this.loading = false;
          this.activeGswbRunStartedAt = null;
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

      // A selection naming a solution the sentence no longer has (it was reparsed) is stale.
      const solutionIds = sols.map(s => s.id);
      const selected = this.session.selectedSolutionIdsBySentence[key];
      if (!selected?.length || !selected.every(id => solutionIds.includes(id))) {
        this.session.selectedSolutionIdsBySentence[key] = solutionIds;
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
    this.stopSessionLease();
    this.workspaceSubscription?.unsubscribe();
    this.stopGswbSummaryPolling();
    this.stopNliPreparation();
    this.endVampireRun();
    if (this.sessionSaveTimer !== null) {
      clearTimeout(this.sessionSaveTimer);
      this.sessionSaveTimer = null;
    }
  }

  /** What a finished parse does next.
   *
   *  Parsing used to continue into Vampire unless the disambiguation pause was on, so there
   *  was no way to parse a testsuite, look at the readings and stop. Stopping here leaves a
   *  complete, saved parse behind and hands the next step to "Run inference" -- there is no
   *  pending chain to resume, which is why Continue/Skip no longer exist.
   *
   *  A separate "disambiguate before Vampire" flag used to make this same decision. Once
   *  its Continue/Skip buttons were gone it said nothing more than "do not run inference
   *  yet", which is this switch: selecting discriminants is something you do to a parsed
   *  session, not a mode the session has to be put into first. */
  private continueAfterParse(): void {
    if (!this.enableInference) {
      this.displayMessage(
        "Parsing complete. Inference was not run \u2014 select discriminants if you want to, "
        + "then click Run inference.",
        "blue"
      );
      return;
    }

    this.runVampireFromCurrentState(/*useDisambiguated*/ true);
  }

  /** Run inference over the parsed state that is already stored -- the NLI items that are
   *  selected, or all of them when nothing is selected. Nothing is re-parsed: the
   *  preparation and Vampire legs read `lastGswbOutputs`/`lastAnnotations`, which is what
   *  makes inference an operation in its own right rather than the tail of a parse.
   *
   *  Replaces Continue/Skip, whose only difference was the argument below. */
  runInference(): void {
    if (!this.canRunInference) return;
    this.runVampireFromCurrentState(/*useDisambiguated*/ true);
  }

  abortCurrentRun(): void {
    if (!this.loading || (this.saveOperationInProgress && this.activeSaveAction !== null) || this.abortRequestInFlight) return;
    if (this.preparingInference) {
      this.abortInferencePreparation();
      return;
    }

    this.abortRequestInFlight = true;
    // Bumped BEFORE the cancel request goes out: the preparation chain checks this token,
    // and the cancel is a round trip it could otherwise finish inside.
    this.vampireRunToken++;
    this.stopNliPreparation();
    const parse = this.session.report?.parse;
    if (parse && !parse.finishedAt) {
      parse.phases.forEach(phase => phase.durationMs ??= Date.now() - new Date(phase.startedAt).getTime());
      this.finishParseReport(parse, new Date(parse.startedAt).getTime(), 'aborted');
    }
    if (this.sessionSaveTimer !== null) {
      clearTimeout(this.sessionSaveTimer);
      this.sessionSaveTimer = null;
    }
    this.pendingAutosave = false;
    this.displayMessage('Requesting run abort...', 'blue');
    const cancelledRunId = this.vampireRunId;
    this.dataService.requestVampireCancel(this.redisSessionKey, cancelledRunId).pipe(
      // The cancel only asks. Until the service says the run is gone it may still be
      // writing progress and results, and a run started meanwhile would run beside it --
      // so the session stays locked ("abort in flight") until then.
      switchMap(() => {
        this.displayMessage('Stopping the inference run...', 'blue');
        return this.waitForVampireRunToStop(cancelledRunId);
      })
    ).subscribe({
      next: stopped => {
        if (!stopped) {
          console.warn('[Regression] the inference service did not confirm the stop', { cancelledRunId });
          this.setSessionLoadStatus('error', 'Abort not confirmed',
            `The inference service did not confirm within ${this.vampireStopTimeoutMs / 1000}s that `
            + 'the run stopped. A new run is refused until it has.');
        }
        this.gswbRunToken++;
        this.vampireRunToken++;
        this.stopGswbSummaryPolling();
        this.endVampireRun();
        this.pendingVampireFinalSnapshot = null;
        this.vampireSummaryRequestInFlight = false;
        this.pendingAutosave = false;

        this.loadAndRenderVampireState(true, this.activeVampireRunStartedAt ?? Date.now(), this.vampireRunToken);
      },
      error: error => {
        // The local half of the abort has already happened -- the preparation chain is
        // unsubscribed and the run token bumped, so nothing here will submit or render any
        // more. Leaving `loading` true (which is what this branch used to do) left the UI
        // waiting on a run that could no longer finish. Say what was actually stopped.
        console.warn('Unable to request Vampire cancel.', error);
        this.stopGswbSummaryPolling();
        this.endVampireRun();
        this.finishInferenceReport('aborted');
        this.vampirePendingItemCount = null;
        this.activeGswbRunStartedAt = null;
        this.activeVampireRunStartedAt = null;
        this.loading = false;
        this.clearVampireProgressIndicator();
        this.abortRequestInFlight = false;
        this.displayMessage(
          'Run stopped here, but the inference service could not be told to cancel — '
          + 'anything already submitted may still be running.', 'red');
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

  get canRunInference(): boolean {
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
    return !!(this.session.report?.parse || this.session.report?.inference)
      || this.session.lastGswbOutputs !== null;
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
      const reason = update?.failure
        || (update && this.resultsBelongToAnotherPreparation(itemId, this.session.lastVampireResults?.[itemId])
          ? 'The stored results belong to an earlier preparation of this item (their assignment ids '
            + 'do not match); run it again.'
          : update ? 'No reading assignment produced a verdict.' : 'Never attempted.');
      failed.push({ id: itemId, sentences, reason });
    }

    return failed;
  }

  /** The inference report, as one row per NLI item rather than one per verdict.
   *
   *  The report used to render `inferenceResults` directly, and
   *  `inferenceResultsFromDocument` drops every item without a majority verdict -- so an
   *  item that had not run, or had run and produced nothing, was simply absent, and the
   *  list grew out of an empty panel as results landed. There was no way to see what was
   *  still owed. This is the container: every item is listed from the moment parsing
   *  finishes, and a row fills in when its verdict arrives.
   *
   *  A VIEW only. `session.inferenceResults` still holds nothing but real verdicts, so the
   *  "N of M" count, the confusion matrix and the saved session are unaffected. */
  get inferenceReportRows(): InferenceReportRow[] {
    if (!this.hasParsedExamples) return [];

    const resultsById = new Map(
      (this.inferenceResults ?? []).map(result => [String(result?.id ?? ''), result]));
    const failuresById = new Map(this.failedInferenceItems.map(failure => [failure.id, failure]));

    return this.regressionTestItems.map(item => {
      const id = String(item?.id ?? '');
      const result = resultsById.get(id);
      const unparsed = this.unparsedSentencesFor(item);

      let status: InferenceReportRow['status'];
      if (unparsed.length > 0) {
        // First, even ahead of a verdict: a sentence with no reading cannot be reasoned
        // over now, so any verdict still sitting next to it describes an earlier parse.
        status = 'unparsed';
      } else if (result) {
        status = 'done';
      } else if (this.vampireActiveItemId === id) {
        status = 'running';
      } else if (failuresById.has(id)) {
        status = 'failed';
      } else {
        status = 'pending';
      }

      return {
        id,
        status,
        selectable: status !== 'unparsed',
        data: result ?? this.placeholderInferenceResult(item),
        reason: status === 'failed' ? (failuresById.get(id)?.reason ?? '') : '',
        unparsedSentences: unparsed,
      };
    });
  }

  /** The item's sentences that came back from parsing with no reading to reason over --
   *  exactly the condition `runVampireFromCurrentState` applies when it builds premises,
   *  so a greyed row means "this item cannot contribute", not merely "this looks odd". */
  private unparsedSentencesFor(item: any): string[] {
    const outputs = this.session.lastGswbOutputs;
    if (!outputs) return [];

    return [...(item?.premises ?? []), ...(item?.conclusion ?? [])]
      .map((sentenceId: any) => String(sentenceId ?? ''))
      .filter(sentenceId => !(outputs[sentenceId]?.solutions?.length))
      .map(sentenceId => this.sentenceMap[sentenceId] || sentenceId);
  }

  /** A row for an item with no verdict: the same shape `app-inference-result` renders, with
   *  the predicted label left empty. The component reads `status` to keep an empty label
   *  from counting as a mismatch. */
  private placeholderInferenceResult(item: any): RegressionInferenceResult {
    const textsFor = (ids: any[]) => (ids ?? [])
      .map((sentenceId: any) => this.sentenceMap[String(sentenceId ?? '')])
      .filter((text: any) => typeof text === 'string' && text.trim().length > 0);

    return {
      id: String(item?.id ?? ''),
      premises: textsFor(item?.premises),
      conclusion: textsFor(item?.conclusion).join(' '),
      predictedLabel: '',
      goldLabel: String(item?.gold_label ?? 'unknown'),
      premiseIds: (item?.premises ?? []).map((sentenceId: any) => String(sentenceId ?? '')),
      conclusionIds: (item?.conclusion ?? []).map((sentenceId: any) => String(sentenceId ?? '')),
      mismatch: false,
      glyphs: [],
    };
  }

  get selectedNliItemCount(): number {
    return this.selectedNliItemIds.size;
  }

  get allSelectableNliItemsSelected(): boolean {
    const selectable = this.inferenceReportRows.filter(row => row.selectable);
    return selectable.length > 0 && selectable.every(row => this.selectedNliItemIds.has(row.id));
  }

  isNliItemSelected(id: string): boolean {
    return this.selectedNliItemIds.has(id);
  }

  setNliItemSelected(id: string, selected: boolean): void {
    if (selected) {
      this.selectedNliItemIds.add(id);
    } else {
      this.selectedNliItemIds.delete(id);
    }
  }

  /** Select every item that could run, or clear the selection. Unparsed items are skipped:
   *  selecting one would narrow a run down to items that cannot produce anything. */
  toggleAllNliItems(): void {
    if (this.allSelectableNliItemsSelected) {
      this.selectedNliItemIds.clear();
      return;
    }

    for (const row of this.inferenceReportRows) {
      if (row.selectable) this.selectedNliItemIds.add(row.id);
    }
  }

  get selectedParseSentenceCount(): number {
    return this.selectedParseSentenceIds.size;
  }

  get allParseSentencesSelected(): boolean {
    return this.regressionTestResults.length > 0
      && this.regressionTestResults.every(result => this.selectedParseSentenceIds.has(result.sentence_id));
  }

  isParseSentenceSelected(id: string): boolean {
    return this.selectedParseSentenceIds.has(id);
  }

  setParseSentenceSelected(id: string, selected: boolean): void {
    if (selected) {
      this.selectedParseSentenceIds.add(id);
    } else {
      this.selectedParseSentenceIds.delete(id);
    }
  }

  toggleAllParseSentences(): void {
    if (this.allParseSentencesSelected) {
      this.selectedParseSentenceIds.clear();
      return;
    }
    this.regressionTestResults.forEach(result => this.selectedParseSentenceIds.add(result.sentence_id));
  }

  private pruneParseSentenceSelection(): void {
    for (const id of [...this.selectedParseSentenceIds]) {
      if (!(id in (this.sentenceMap ?? {}))) this.selectedParseSentenceIds.delete(id);
    }
  }

  /** "Parse": the ticked sentences of the parsing report, or the whole testsuite when none
   *  is ticked (always the case before a first parse, when the report is empty). */
  parse(testfile: string): void {
    this.pruneParseSentenceSelection();
    if (this.selectedParseSentenceIds.size) {
      this.batchParse(testfile, new Set(this.selectedParseSentenceIds));
    } else {
      this.batchParse(testfile);
    }
  }

  /** The sentences a reparse of `selected` parses, in testsuite order: just those. Each
   *  sentence is derived on its own, so a discourse item's other sentences keep their
   *  readings; the items over the reparsed sentences are what inference runs next. */
  private sentencesToReparse(selected: Set<string>): string[] {
    return Object.keys(this.sentenceMap ?? {}).filter(id => selected.has(id));
  }

  /** Drop ids that no longer name an item. A selection that outlives the items it named
   *  would silently narrow the next run to nothing. */
  private pruneNliItemSelection(): void {
    if (this.selectedNliItemIds.size === 0) return;

    const known = new Set(this.regressionTestItems.map(item => String(item?.id ?? '')));
    for (const id of [...this.selectedNliItemIds]) {
      if (!known.has(id)) this.selectedNliItemIds.delete(id);
    }
  }

  /** Closes the inference report once its run is over: duration, results over the whole
   *  testsuite, proofs, and -- read once more from the progress record, which the run may
   *  have finished before the last poll -- Vampire's time per item. */
  private finishInferenceReport(failure?: string): void {
    const report = this.session.report?.inference;
    if (!report || report.finishedAt) return;
    this.endVampirePhase?.();
    this.endVampirePhase = null;
    report.phases.forEach(phase => phase.durationMs ??= 0);
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - new Date(report.startedAt).getTime();
    failure ??= this.abortRequestInFlight ? 'aborted' : undefined;
    if (failure) report.failure = failure;
    const results = { total: 0, correct: 0, wrong: 0, notParsed: 0, noVerdict: 0 };
    for (const row of this.inferenceReportRows) {
      results.total++;
      if (row.status === 'unparsed') results.notParsed++;
      else if (row.status !== 'done') results.noVerdict++;
      else if (row.data.mismatch) results.wrong++;
      else results.correct++;
    }
    report.results = results;
    // From the stored results, not vampireProofCount: while the progress indicator is up
    // that is the last poll's figure -- short of the final count -- and otherwise it counts
    // proof files, not branches.
    report.proofs = Object.values(this.session.lastVampireResults ?? {})
      .reduce((sum, checks) => sum + (checks?.length ?? 0), 0);
    this.dataService.getVampireProgress(this.redisSessionKey).subscribe({
      next: progress => {
        if (this.session.report?.inference !== report) return;
        report.vampire = timingStats(progress?.itemTimingsMs ?? {});
        this.scheduleSessionSave();
      },
      error: error => console.warn('Unable to read Vampire item timings.', error),
    });
  }

  /** The items without a verdict once inference has run: counted on the summary line,
   *  listed in the info pill. */
  get inferenceFailures(): { id: string; sentences: string; reason: string }[] {
    return this.session.hasRunVampire ? this.failedInferenceItems : [];
  }

  /** The pill's line: see run-report.ts. */
  get processingTimingSummary(): string {
    return reportSummary(this.session.report);
  }

  /** The run report as tables (see run-report.ts), plus the disambiguation state the
   *  next run would use. Sentences and items are named by id. */
  get runReport(): ReturnType<typeof reportTables> {
    const tables = reportTables(this.session.report);
    if (this.session.lastGswbOutputs !== null) {
      tables.outcomes.push(['Disambiguated sentences', String(this.disambiguatedSentenceCount)]);
    }
    return tables;
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

  /** Parses the testsuite with the session's rule set: the rules a session stores are the
   *  rules its runs used.
   *
   *  With `reparse`, only those sentences are parsed again (with the rest of their discourse
   *  items), as they stand in the session, and merged over the stored parse the way an
   *  append parse is: the testsuite text is not reread, nothing else is reset, and the NLI
   *  items that use them are selected for the next inference run. */
  batchParse(sentences: string, reparse?: Set<string>) {
    if (this.runLocked) return;
    const rules = this.session.rulesText;
    const partial = !!reparse?.size;
    if (!partial && this.testsuiteUpdateMode === 'write' && this.hasExistingRegressionSessionData()) {
      const confirmed = this.confirmWriteModeOverwrite();
      if (!confirmed) {
        this.displayMessage('Parse cancelled.', 'blue');
        return;
      }
    }

    this.errorhandle.nativeElement.textContent = "";
    this.sessionPersistenceEnabled = true;
    this.loading = true;
    this.preparingInference = false;
    const runStartedAt = Date.now();
    const baseSnapshot = this.captureParsedRegressionSnapshot();

    this.writeSnapshot = baseSnapshot;
    this.appendSnapshot = this.testsuiteUpdateMode === 'append' || partial
      ? this.cloneParsedRegressionSnapshot(this.writeSnapshot)
      : null;
    this.currentVampireRunKind = 'initial';

    const baseSentenceKeys = new Set(Object.keys(baseSnapshot.sentenceMap ?? {}));
    if (!partial) this.session.testsuiteText = sentences;
    this.syncSessionStateFromUi();

    // A new parse starts a new report; in write mode its inference is gone with its results.
    const parseReport: ParseReport = {
      startedAt: new Date(runStartedAt).toISOString(), finishedAt: null, durationMs: null, phases: [],
      parsing: null, composition: null,
      sentences: { total: 0, successful: 0, failedIds: [] },
      items: { total: 0, discourse: 0 },
    };
    this.session.report = {
      parse: parseReport,
      inference: this.testsuiteUpdateMode === 'write' && !partial ? null : this.session.report?.inference ?? null,
    };

    const gswbRunToken = ++this.gswbRunToken;

    if (this.testsuiteUpdateMode === 'write' && !partial) {
      this.regressionTestResults = [];
      this.regressionTestItems = [];
      this.inferenceResults = [];
      this.vampirePreserveExistingResults = false;
      this.inferenceSummary = "";
      this.parsingSummary = "";
      this.updateConfusionMatrixView(Array.from({ length: 3 }, () => Array(3).fill(0)));
    }

    if (this.testsuiteUpdateMode === 'write' && !partial) {
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

    const reparseIds = partial ? this.sentencesToReparse(reparse!) : [];
    if (partial) {
      // Their readings are new: a disambiguation of the old ones names solutions that are gone.
      for (const id of reparseIds) {
        delete this.session.selectedSolutionIdsBySentence[id];
        delete this.session.selectedScopeIdsBySentence[id];
        delete this.session.selectedMcIdsBySentence[id];
      }
    } else {
      this.parse_testfile(sentences);
    }

    this.displayMessage(partial
      ? `Sending ${reparseIds.length} sentence(s) to LiGER for reparsing ...`
      : "Sending testsuite to LiGER for parsing ...", "blue");

    const appendSentences = Object.fromEntries(
      Object.entries(this.sentenceMap ?? {}).filter(([key]) => !baseSentenceKeys.has(key))
    );
    const ligerMultipleRequest = {
      sentences: partial
        ? Object.fromEntries(reparseIds.map(id => [id, this.sentenceMap[id]]))
        : this.testsuiteUpdateMode === 'append' ? appendSentences : this.sentenceMap,
      ruleString: rules,
    };
    this.logBackendPayload('LiGER batch annotate request', this.testsuiteUpdateMode, ligerMultipleRequest);

    const parsingStartedAt = Date.now();
    this.dataService.ligerBatchAnnotate(ligerMultipleRequest).subscribe(
      data => {
        if (gswbRunToken !== this.gswbRunToken) return;
        addToPhase(parseReport.phases, PARSE_PHASES.parsing, parsingStartedAt, Date.now() - parsingStartedAt);
        parseReport.parsing = timingStats(data?.timingsMs ?? {});

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

          // Every sentence is derived here on its own, once per parse -- discourse items
          // too: inference appends each later sentence to its item's discourse without
          // deriving it again (DocumentBuilderService.appendSentence).
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

          // A partial parse (append, reparse) keeps the other sentences' constructors.
          this.sortedMCmap = this.appendSnapshot ? { ...this.sortedMCmap, ...sortedMcMap } : sortedMcMap;

          this.gswbMultipleRequest = {
            items,
            gswbPreferences: this.gswbPreferences.gswbPreferences,
            sessionKey: this.redisSessionKey
          };
          this.logBackendPayload('GSWB batch deduce request', this.testsuiteUpdateMode, this.gswbMultipleRequest);

          if (this.appendSnapshot) {
            // A partial parse (append, reparse) is merged over the stored one: saved
            // half-way, it must not leave the session with only its own sentences.
            this.session.lastAnnotations = { ...(this.appendSnapshot.annotations ?? {}), ...data.annotations };
          } else {
            this.session.lastGswbOutputs = null;
            this.session.lastAnnotations = data.annotations;
          }
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

        // Only when there is a batch: an empty one would read as a 0 ms GSWB phase.
        const batched = Object.keys(this.gswbMultipleRequest?.items ?? {}).length > 0;
        const compositionStartedAt = Date.now();
        const batch$: Observable<GswbBatchOutput> = batched
          ? this.batchDeduce(this.gswbMultipleRequest)
          : of({ outputs: {}, report: '' });
        batch$.pipe(
          switchMap(result => {
            if (gswbRunToken !== this.gswbRunToken) return EMPTY;
            if (batched) {
              addToPhase(parseReport.phases, PARSE_PHASES.composition,
                compositionStartedAt, Date.now() - compositionStartedAt);
            }
            this.stopGswbSummaryPolling();
            return of(result.outputs ?? {});
          }),
        ).subscribe((outputs: Record<string, GswbOutput>) => {
          if (gswbRunToken !== this.gswbRunToken) return;
          // GSWB's own time per sentence.
          parseReport.composition = timingStats(Object.fromEntries(
            Object.entries(outputs).map(([sentenceId, output]) => [sentenceId, output?.elapsedMs])));

          this.applyAppendSnapshotToParsedState(outputs);
          this.renderGswbResults(outputs);
          this.commitParsedRegressionSnapshot();
          this.finishParseReport(parseReport, runStartedAt);
          this.loading = false;
          this.activeGswbRunStartedAt = null;
          this.saveSessionSnapshot();
          this.displayMessage(
            partial
              ? `Reparsed ${reparseIds.length} sentence(s).`
              : this.testsuiteUpdateMode === 'append'
              ? "Append parsing completed successfully."
              : "Batch processing completed successfully.",
            "green"
          );

          if (partial) {
            // The items over these sentences are what has to be reasoned over again.
            const reparsed = new Set(reparseIds);
            this.selectedNliItemIds.clear();
            for (const item of this.regressionTestItems ?? []) {
              const sentenceIds: string[] = [...(item?.premises ?? []), ...(item?.conclusion ?? [])];
              if (sentenceIds.some(id => reparsed.has(id))) this.selectedNliItemIds.add(String(item.id));
            }
            this.selectedParseSentenceIds.clear();
          }
          this.continueAfterParse();
        });
      },
      error => {
        this.stopGswbSummaryPolling();
        console.error('An error occurred:', error);
        parseReport.phases.forEach(phase => phase.durationMs ??= 0);
        this.finishParseReport(parseReport, runStartedAt,
          error?.message ?? 'batch parsing failed');
        this.saveSessionSnapshot();
        this.displayMessage("An error occurred during batch parsing.", "red");
        this.loading = false;
        this.activeGswbRunStartedAt = null;
      }
    );
  }

  /** Closes the parse report: its duration, and what the parse produced -- counted over the
   *  whole testsuite as it now stands (an append parse adds to it). */
  private finishParseReport(report: ParseReport, startedAtMs: number, failure?: string): void {
    const outputs = this.session.lastGswbOutputs ?? {};
    const sentenceIds = Object.keys(this.sentenceMap ?? {});
    const failedIds = sentenceIds.filter(id => !(outputs[id]?.solutions?.length));
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAtMs;
    report.sentences = { total: sentenceIds.length, successful: sentenceIds.length - failedIds.length, failedIds };
    report.items = {
      total: this.regressionTestItems.length,
      discourse: this.regressionTestItems
        .filter(item => (item?.premises?.length ?? 0) + (item?.conclusion?.length ?? 0) > 1).length,
    };
    if (failure) report.failure = failure;
  }

  /** One-time migration of sessions parsed before docs/plans/DERIVE_ONCE_REBASE_PLAN.md
   *  (xleplusglue): those derived a discourse item's sentences inside the item's sequence at
   *  parse time (`GswbOutput.derivedInSequence`), so their readings are numbered into that
   *  sequence, and appending them would move them a second time. Derives those sentences
   *  again on their own from the stored batch parse -- what a parse does now -- and drops
   *  their disambiguation, which names the old readings. Returns the sentences migrated. */
  private rederiveInSequenceOutputs(): Observable<string[]> {
    const outputs = { ...(this.session.lastGswbOutputs ?? {}) };
    const sentenceIds = Object.keys(outputs).filter(id => outputs[id]?.derivedInSequence);
    const items: Record<string, GswbRequest> = {};
    for (const id of sentenceIds) {
      const proofs = this.batchProofInputs(id, this.session.lastAnnotations?.[id]);
      if (!proofs.length) continue;
      this.sortedMCmap[id] = proofs.map(proof => proof.meaningConstructors).join('\n');
      items[id] = {
        premises: this.sortedMCmap[id],
        gswbPreferences: this.session.gswbPreferences,
        structure: proofs[0].structure,
        proofs,
      };
    }
    return this.dataService.gswbBatchDeduce({ items, gswbPreferences: this.session.gswbPreferences }).pipe(
      map((result: GswbBatchOutput) => {
        for (const id of sentenceIds) {
          outputs[id] = result?.outputs?.[id] ?? {
            solutions: [], log: '', derivation: null, discriminants: [],
            failure: 'the stored parse has no meaning constructors to derive it from',
          };
          delete this.session.selectedSolutionIdsBySentence[id];
          delete this.session.selectedScopeIdsBySentence[id];
          delete this.session.selectedMcIdsBySentence[id];
        }
        console.info('[Regression] discourse sentences derived again on their own', { sentenceIds });
        this.renderGswbResults(outputs);
        this.saveSessionSnapshot();
        return sentenceIds;
      }),
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
    if (Object.values(this.session.lastGswbOutputs).some(output => output?.derivedInSequence)) {
      this.loading = true;
      this.displayMessage("Deriving this session's discourse sentences again, on their own ...", "blue");
      this.rederiveInSequenceOutputs().subscribe({
        next: sentenceIds => {
          this.loading = false;
          this.displayMessage(`Derived ${sentenceIds.length} discourse sentence(s) again on their own `
            + `(${sentenceIds.join(', ')}); their disambiguation was reset.`, "blue");
          this.runVampireFromCurrentState(useDisambiguated);
        },
        error: error => {
          this.loading = false;
          console.error('[Regression] could not derive the discourse sentences again', error);
          this.displayMessage(`Could not derive this session's discourse sentences again: `
            + `${error?.message ?? error}. Reparse the testsuite.`, "red");
        },
      });
      return;
    }

    const gswbOutputs = this.session.lastGswbOutputs;
    const annotations = this.session.lastAnnotations;
    // The Vampire settings this run uses, read once: the check formulas are typed (and the
    // grammar axioms encoded by the Vampire service) for the same logic the request names,
    // even if the settings change while the run prepares. The logic type used to be the one
    // saved at parse time, so a run after switching fof -> tff sent untyped formulas to a
    // tff problem and every check failed to parse.
    this.runVampirePreferences = { ...this.vampirePreferences.vampirePreferences };
    const logicType: 'fof' | 'tff' = this.runVampirePreferences.logic_type === 0 ? 'fof' : 'tff';
    this.session.lastLogicType = logicType;
    const vampireStartedAt = Date.now();
    const vampireRunToken = ++this.vampireRunToken;
    // The run holds the lock from here, not only once it reaches Vampire: building the TPTP
    // checks takes minutes, and a parse or session switch meanwhile left it to submit the
    // old parse's checks into the new state.
    this.loading = true;
    this.preparingInference = true;
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


    // Parsed before grammar axioms left LiGER untranslated: those are TPTP already encoded
    // for the parse-time logic, and reading them as GrammarAxioms would drop them silently.
    const legacyAxiomSentences = Object.entries(annotations)
      .filter(([, annotation]) => (annotation?.solutions ?? [])
        .some(solution => Array.isArray(solution?.axioms)))
      .map(([sentenceId]) => sentenceId);
    if (legacyAxiomSentences.length) {
      this.displayMessage("This session was parsed before grammar axioms were passed on "
        + "untranslated. Parse the testsuite again before running inference.", "red");
      console.warn('[Regression] legacy (pre-encoded) grammar axioms', legacyAxiomSentences);
      this.endInferencePreparation(vampireRunToken);
      return;
    }

    this.displayMessage("Sending NLI items to Vampire ...", "blue");
    console.log("Preparing call to Vampire ...");

    const inference_items: Record<string, nliItem> = {};
    const stoppedItems: string[] = [];

    // An explicit selection narrows the run to the items that were ticked; no selection
    // runs everything, which is what "Run inference" does straight after a parse.
    this.pruneNliItemSelection();
    const explicitSelection = this.selectedNliItemIds.size > 0;
    const itemsToConsider = explicitSelection
      ? this.regressionTestItems.filter(item => this.selectedNliItemIds.has(String(item?.id ?? '')))
      : this.regressionTestItems;

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

      // Ticking an item IS the request to redo it. These two skips exist to avoid redoing
      // work nobody asked for -- an item that already has a verdict and whose readings have
      // not changed -- which is exactly the item someone selects when they want it rerun.
      if (!explicitSelection) {
        if (!isNewlyAppended && isAlreadyProcessed && !selectionChanged && !parseChanged) continue;
        if (appendMode && !isNewlyAppended && !selectionChanged && !parseChanged) continue;
      }

      // An item over a sentence whose output records why it has no semantics is not
      // reasoned over -- and says so, rather than silently dropping out below for lack of a
      // hypothesis reading.
      const stoppedAt = [...(item.premises ?? []), ...(item.conclusion ?? [])]
        .find((sentenceId: string) => gswbOutputs[sentenceId]?.failure);
      if (stoppedAt) {
        stoppedItems.push(`${itemId}: ${stoppedAt} -- ${gswbOutputs[stoppedAt].failure}`);
        continue;
      }

      const grammarAxioms: Array<GrammarAxioms | undefined> = [];

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

          // Axioms are per syntactic analysis; collected across all of them, untranslated.
          // The Vampire service encodes them for this run's logic type.
          grammarAxioms.push(...(annotations[premise]?.solutions ?? [])
            .map(solution => solution.axioms));
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

          grammarAxioms.push(...(annotations[conclusion]?.solutions ?? [])
            .map(solution => solution.axioms));
        }
      }

      if (premise_strings.length > 0 && conclusion_strings.length > 0) {
        inference_items[item.id] = {
          premises: premise_strings,
          hypothesis: conclusion_strings,
          axioms: this.session.axiomsText ?? '',
          grammar_axioms: mergeGrammarAxioms(grammarAxioms),
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
    if (stoppedItems.length) {
      console.warn('[Regression] items not reasoned over: a sentence has no semantics', stoppedItems);
    }
    this.nliPreparationFailures = [...stoppedItems];
    if (Object.keys(inference_items).length === 0) {
      this.displayMessage(stoppedItems.length
        ? `No items to reason over; ${stoppedItems.length} stopped at a sentence without semantics.`
        : "No missing Vampire items to process.", "blue");
      this.endInferencePreparation(vampireRunToken);
      return;
    }

    // This run's report replaces the previous run's.
    this.session.report = {
      parse: this.session.report?.parse ?? null,
      inference: {
        startedAt: new Date(vampireStartedAt).toISOString(), finishedAt: null, durationMs: null, phases: [],
        runKind: this.currentVampireRunKind,
        itemsInRun: this.vampireCurrentRunItemCount,
        selected: explicitSelection,
        preparation: null, vampire: null,
        results: { total: 0, correct: 0, wrong: 0, notParsed: 0, noVerdict: 0 },
        proofs: 0,
      },
    };

    // Fixed for this run: which anaphora branches go to Vampire. The setting can change while
    // the run prepares or afterwards without touching it.
    this.runAnaphoraSelection = { ...this.anaphoraSelection() };
    this.runAnaphoraSelectionApplied = {};

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
      this.endInferencePreparation(vampireRunToken);
      return;
    }

    // Strictly one item at a time. Two of these chains in flight at once has been observed
    // to leave an HttpClient observable that never emits -- the reason
    // ReasoningPipelineService exposes a sequential driver at all -- and this used to be a
    // forkJoin over every pair of every item at once. concatMap over the whole per-item
    // chain also serializes the sequence/merge calls that precede the pipeline, which the
    // service's own sequential driver cannot do because they happen before its input exists.
    // Held so an abort can actually stop it. Without this the chain ran to completion in
    // the browser after the abort and then submitted to Vampire anyway -- "abort" cancelled
    // a batch that had not been sent yet, so it cancelled nothing, and the run the user
    // stopped started a few seconds later. 2026-09-08.
    this.nliPreparationSubscription?.unsubscribe();
    const inferenceReport = this.session.report.inference!;
    const endPreparation = startPhase(inferenceReport.phases, INFERENCE_PHASES.preparation);
    const preparationMs: Record<string, number> = {};
    this.nliPreparationSubscription = from(itemBuilds).pipe(
      concatMap(build => defer(() => {
        const started = Date.now();
        return this.prepareNliItem(build, gswbOutputs, useDisambiguated, typed, pruning).pipe(
          tap(() => preparationMs[build.itemId] = Date.now() - started));
      })),
      toArray()
    ).subscribe({
      next: prepared => {
        // Preparation is long and entirely client-side, so a run can be superseded or
        // aborted while it is still going. Nothing below may reach Vampire in that case.
        if (vampireRunToken !== this.vampireRunToken) return;
        endPreparation();
        inferenceReport.preparation = timingStats(preparationMs);
        for (const item of Object.values(inference_items)) item.tptp_checks = [];
        const failures: string[] = [...stoppedItems];
        const degradations: string[] = [];
        const policy = this.runAnaphoraSelection ?? ALL_ANAPHORA_BRANCHES;
        prepared = prepared.map(pair => {
          const itemBuild = itemBuilds.find(candidate => candidate.itemId === pair.itemId);
          const sequenceId = itemBuild
            ? compositeAnalysisId([...itemBuild.premiseSentenceIds, ...itemBuild.hypothesisSentenceIds]) : '';
          const discourseUpdate = this.session.analysisDocuments[pair.itemId]?.discourseUpdates
            ?.find(update => update.id === `du-${sequenceId}`);
          const selection = selectForVampire(discourseUpdate, pair.assignments, policy);
          this.runAnaphoraSelectionApplied[pair.itemId] = selection.applied;
          return { ...pair, assignments: selection.items };
        });
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
          this.endInferencePreparation(vampireRunToken);
          this.finishInferenceReport('no reasoning checks could be built');
          return;
        }
        const skipped = hasPostProcessingRules(this.session.pragmaticsRulesText)
          ? '' : ` ${POST_PROCESSING_SKIPPED_NOTICE}`;
        if (failures.length || degradations.length || skipped) {
          this.displayMessage(
            `Built ${bundleCount} reasoning bundle(s); ${failures.length} branch(es) failed, `
            + `${degradations.length} not fully resolved.${skipped}`, "blue");
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
        if (vampireRunToken !== this.vampireRunToken) return;
        this.displayMessage("Could not build TPTP reasoning checks.", "red");
        this.endInferencePreparation(vampireRunToken);
        this.finishInferenceReport('reasoning checks could not be built');
      }
    });
  }

  /** One NLI item, all the way to prepared bundles -- built document-first, the way chat
   *  builds a discourse: register the first premise sentence's own (disambiguated)
   *  batch-parse reading(s) as the seed, then append every remaining sentence in order
   *  (later premises, then the hypothesis): its own batch readings, registered, then merged
   *  onto every branch of its own sequence variant (DocumentBuilderService.appendSentence).
   *  No sentence is derived again. No pruning until
   *  ReasoningPipelineService.prepareReasoningChecks's own `prune` at the very end --
   *  every branch (one full reading-path through every sentence) is reasoned over. */
  private prepareNliItem(
    build: NliItemBuild,
    gswbOutputs: Record<string, GswbOutput>,
    useDisambiguated: boolean,
    typed: boolean,
    pruning: boolean
  ): Observable<PreparedNliPair> {
    const resolveDrs = !!this.session.gswbPreferences?.resolveDrs;
    // This item's own discourse. Every registration below writes here and nowhere else,
    // so one item's build cannot see or corrupt another's -- see registerAnalysisSentences.
    const document = this.documentFor(build.itemId);

    const remaining: Array<{ sentenceId: string; side: 'premise' | 'hypothesis' }> = [
      ...build.premiseSentenceIds.slice(1).map(sentenceId => ({ sentenceId, side: 'premise' as const })),
      ...build.hypothesisSentenceIds.map(sentenceId => ({ sentenceId, side: 'hypothesis' as const })),
    ];

    return defer(() => {
      const seed = this.seedNliChainBranches(document, build.premiseSentenceIds[0], gswbOutputs, useDisambiguated);
      if (!seed.length) {
        throw new Error(`No selected reading for ${build.premiseSentenceIds[0]}.`);
      }
      return remaining.reduce(
        (branches$, next) => branches$.pipe(
          switchMap(branches => this.appendSentenceToBranches(
            document, branches, next, gswbOutputs, useDisambiguated, resolveDrs))),
        of(seed),
      );
    }).pipe(
      switchMap(branches => {
        this.registerFinalSequence(document, build, branches);
        return from(branches).pipe(
          concatMap((branch, index) => this.prepareBranchChecks(build, branch, index, typed, pruning)),
          toArray(),
          // The pragmatic layer. Written BEFORE the reasoning updates, because a
          // ReasoningAssignment's id names the anaphora branch it was built from and
          // validateReasoningUpdate resolves that hop.
          tap(prepared => this.registerDiscourseUpdate(document, build, branches, prepared)),
          // Top-k selects branches before Vampire, so it needs the ranking first. With every
          // branch sent, nothing waits on lm.
          concatMap(prepared => this.runAnaphoraSelection?.mode === 'top_k'
            ? this.rankingOf(build.itemId).pipe(map(() => prepared))
            : of(prepared)),
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
   *  premise sentence, registered from its batch-parse reading. */
  private seedNliChainBranches(
    document: XlePlusGlueDocument,
    sentenceId: string,
    gswbOutputs: Record<string, GswbOutput>,
    useDisambiguated: boolean,
  ): NliChainBranch[] {
    return this.registerBatchParsedSentence(document, sentenceId, gswbOutputs, useDisambiguated)
      .map(({ syntax, semantic }) => ({
        element: {
          id: sentenceId,
          text: this.sentenceMap[sentenceId] ?? '',
          syntax: [syntax],
          semantics: [semantic],
          synSemMapping: { [syntax.synId]: [semantic.semId] },
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
  }

  /** Each reading's syntax from the batch parse: the analysis the reading was derived from
   *  (GSWB stamps its proof's `solutionKey` onto it), with the structure its meaning
   *  constructors came from -- the one `appendSentence` supplies for it. Throws when the
   *  batch parse has no such analysis or no structure for it. */
  private batchSyntaxFor(sentenceId: string, solutions: GswbSolution[]): Map<GswbSolution, SyntacticAnalysis> {
    const analyses = this.session.lastAnnotations?.[sentenceId]?.solutions ?? [];
    const syntaxByReading = new Map<GswbSolution, SyntacticAnalysis>();
    for (const solution of solutions) {
      const key = solution.solutionKey || solution.proofId;
      const analysis = analyses.find(candidate => candidate.solutionKey === key);
      if (!key || !analysis?.structureJson) {
        throw new Error(`Reading ${solution.id} of ${sentenceId} names analysis "${key ?? '<none>'}", `
          + `which the batch parse has ${analysis ? 'no structure for' : 'not'}.`);
      }
      syntaxByReading.set(solution, {
        synId: key, structure: analysis.structureJson, graph: analysis.graph,
        meaningConstructors: analysis.meaningConstructors,
      });
    }
    return syntaxByReading;
  }

  /** Registers one sentence's batch-parse reading(s) into the item's document, filtered to
   *  this run's disambiguation selection (matching every other reader of
   *  `selectedSolutions`), each with the syntax of the analysis it was derived from
   *  (`batchSyntaxFor`). Nothing is parsed or derived again. */
  private registerBatchParsedSentence(
    document: XlePlusGlueDocument,
    sentenceId: string,
    gswbOutputs: Record<string, GswbOutput>,
    useDisambiguated: boolean,
  ): { syntax: SyntacticAnalysis; semantic: SemanticAnalysis }[] {
    const solutions = this.selectedSolutions(sentenceId, gswbOutputs, useDisambiguated);
    if (!solutions.length) return [];
    const syntaxOf = this.batchSyntaxFor(sentenceId, solutions);
    const entries = solutions.map(solution => {
      const syntax = syntaxOf.get(solution)!;
      const semantic: SemanticAnalysis = { ...readingOf(solution), syntacticOrigin: syntax.synId };
      return { syntax, semantic };
    });

    const syntaxById = new Map(entries.map(entry => [entry.syntax.synId, entry.syntax]));
    const synSemMapping: SynSemMapping = {};
    entries.forEach(({ syntax, semantic }) => {
      (synSemMapping[syntax.synId] ??= []).push(semantic.semId);
    });
    this.documentBuilder.upsertSentenceAnalyses(document, [{
      id: sentenceId,
      text: this.sentenceMap[sentenceId] ?? '',
      syntax: [...syntaxById.values()],
      semantics: entries.map(entry => entry.semantic),
      synSemMapping,
    }]);
    return entries;
  }

  /** Appends one more sentence (a later premise, or the hypothesis) to every surviving
   *  branch at once: its batch readings, registered, merged onto the branches of their own
   *  sequence variant -- one `appendSentence` call for however many branches there are.
   *  Matched back to its originating branch by object identity, same as chat's own
   *  `previousContextByElement` Map, because several branches can legitimately share one
   *  elementId (several readings of the same prior). */
  private appendSentenceToBranches(
    document: XlePlusGlueDocument,
    branches: NliChainBranch[],
    next: { sentenceId: string; side: 'premise' | 'hypothesis' },
    gswbOutputs: Record<string, GswbOutput>,
    useDisambiguated: boolean,
    resolveDrs: boolean,
  ): Observable<NliChainBranch[]> {
    return defer(() => {
      const readings = this.registerBatchParsedSentence(document, next.sentenceId, gswbOutputs, useDisambiguated)
        .map(entry => entry.semantic);
      if (!readings.length) {
        throw new Error(`No selected reading for ${next.sentenceId}.`);
      }
      const previousContexts: SequenceMergePreviousContext[] = branches.map(branch =>
        ({ semantic: branch.semantic, element: branch.element }));
      return this.documentBuilder.appendSentence({
        previousContexts,
        sentence: document.sentences.find(sentence => sentence.id === next.sentenceId)!,
        readings,
        knownSentences: document.sentences,
        resolveDrs,
        ruleString: this.session.rulesText,
      });
    }).pipe(
      map(result => {
        if (!result.pairs.length) {
          const detail = result.failures.length ? ` ${result.failures.join(' ')}` : '';
          throw new Error(`Could not append ${next.sentenceId} to any branch.${detail}`);
        }
        if (result.failures.length) {
          console.warn('[Regression] some branches could not be extended', { sentenceId: next.sentenceId, failures: result.failures });
        }
        return this.branchesFromPairs(branches, next, result.pairs);
      })
    );
  }

  /** The branches one append leaves: one per merge pair, each the pair's previous branch
   *  extended by the new sentence's reading. The new sentence is already registered with
   *  its own readings (`appendSentenceToBranches`). */
  private branchesFromPairs(
    branches: NliChainBranch[],
    next: { sentenceId: string; side: 'premise' | 'hypothesis' },
    pairs: SequenceMergePair[],
  ): NliChainBranch[] {
    const branchByElement = new Map(branches.map(branch => [branch.element, branch]));
    const isPremise = next.side === 'premise';
    const folded: NliChainBranch[] = [];
    pairs.forEach(pair => {
      const branch = branchByElement.get(pair.previousElement);
      const mergedSemantic = pair.merged.semanticAnalysis;
      if (!branch || !pair.sequenceStructure || !mergedSemantic) {
        console.error('[Regression] merged pair is missing a required field; dropping this branch', {
          sentenceId: next.sentenceId, previousElementId: pair.previousElement.id,
        });
        return;
      }
      const sentenceIdsSoFar = [...branch.sentenceIdsSoFar, next.sentenceId];
      const currentGraph = pair.currentSemantic.graph as LigerStructure;
      const syntaxId = mergedSemantic.syntacticOrigin;
      folded.push({
        element: {
          id: compositeAnalysisId(sentenceIdsSoFar),
          text: sentenceIdsSoFar.map(id => this.sentenceMap[id] ?? '').join(' '),
          sentenceIds: sentenceIdsSoFar,
          syntax: [{ synId: syntaxId, structure: pair.sequenceStructure, graph: { graphElements: [] } }],
          semantics: [mergedSemantic],
          synSemMapping: { [syntaxId]: [mergedSemantic.semId] },
        },
        semantic: mergedSemantic,
        sentenceIdsSoFar,
        sequenceStructure: pair.sequenceStructure,
        merged: pair.merged,
        // Kept exactly as it was once the hypothesis starts folding in -- the prior
        // (`Q`) is the merged premises alone, never premises + conclusion.
        premiseSemantic: isPremise ? mergedSemantic.semString : branch.premiseSemantic,
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
      throw new Error(`Every branch lost a required field while appending ${next.sentenceId}.`);
    }
    return folded;
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
        // unused by appendSentence, so the merged structure stands in for
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
   *  returns each assignment's `mapping` and rule branch, and regression consumed them to
   *  build the Vampire bundles and then dropped them. Chat and glue-vis take the same
   *  values and register them, which is why only
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

    // `prepared` is built by concatMap over `branches`, so index i belongs to branch i.
    const readings = prepared.flatMap((pair, index) => {
      const semId = branches[index]?.merged?.semanticAnalysis?.semId;
      return semId
        ? (pair.assignments ?? []).map(({ mapping, ruleBranchIndex }) =>
          ({ mapping, ruleBranchIndex, semanticOrigin: semId }))
        : [];
    });
    if (!readings.length) return;

    const rankers = this.anaphoraRankers();
    const update = carryAnaphoraRanking(
      document.discourseUpdates?.find(existing => existing.id === `du-${sequenceId}`),
      discourseUpdateOf({ id: sequenceId, kind: 'sequence' }, readings),
      rankers);
    document.discourseUpdates = [
      ...(document.discourseUpdates ?? []).filter(existing => existing.id !== update.id),
      update,
    ];
    if (needsAnaphoraRanking(update, rankers)) {
      this.rankDiscourseUpdate(build.itemId, update);
    }
    console.info('[Regression] discourse update registered', {
      itemId: build.itemId, sequenceId, branches: update.discourse.length,
      anaphoraResolved: update.discourse.filter(entry => entry.collapsed).length,
    });
  }

  /** Ranks an item's anaphora branches once they are stored. Never waited on by the run: the
   *  ranking lands in the item's document whenever lm answers, and autosave picks it up. The
   *  document is looked up again on arrival, so a session replaced in the meantime is left
   *  alone. */
  private rankDiscourseUpdate(itemId: string, update: DiscourseUpdate): void {
    const done = new ReplaySubject<void>(1);
    this.pendingRankings.set(itemId, done);
    this.anaphoraRanking.rankAndAttach(() => this.session.analysisDocuments[itemId], update, this.anaphoraRankers())
      .subscribe({
        next: ({ update: ranked }) => {
          const document = this.session.analysisDocuments[itemId];
          if (!ranked || !document) return;
          document.discourseUpdates = (document.discourseUpdates ?? [])
            .map(existing => existing.id === ranked.id ? ranked : existing);
          // Verdicts do not change -- the branches were selected before Vampire -- but the
          // summary's comparison does.
          this.refreshInferenceFromDocuments();
          this.scheduleSessionSave();
        },
        complete: () => {
          if (this.pendingRankings.get(itemId) === done) this.pendingRankings.delete(itemId);
          done.next();
          done.complete();
        },
      });
  }

  /** Completes once the item's ranking has been attached or found unavailable (the ranking
   *  service times out, so this always completes); at once when none is pending. */
  private rankingOf(itemId: string): Observable<void> {
    return this.pendingRankings.get(itemId)?.asObservable() ?? of(undefined);
  }

  /** Ranking requests still running, per item. */
  private readonly pendingRankings = new Map<string, ReplaySubject<void>>();

  /** Ends the running inference's Vampire phase; set at submission. */
  private endVampirePhase: (() => void) | null = null;

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
      merged: readingOf(branch.merged),
      premiseSemantic: branch.premiseSemantic,
      sequenceStructure: branch.sequenceStructure,
      premiseAsts: branch.premiseAsts,
      hypothesisAsts: branch.hypothesisAsts,
      typed,
      prune: pruning,
      // Regression stores no SVG: an item's readings are rendered when it is opened
      // (/render_pcdrs).
      includeSvg: false,
      ruleString: this.session.pragmaticsRulesText ?? '',
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
        grammar_axioms: item.grammar_axioms,
        ...(tptpMode ? { tptp_checks: item.tptp_checks ?? [] } : {})
      }])
    );
    const vampireRequest: vampireMultipleRequest = {
      nli_items: tptpItems,
      vampire_preferences: this.runVampirePreferences ?? this.vampirePreferences.vampirePreferences,
      pruning,
      session_key: this.redisSessionKey,
      run_id: newRunId(),
    };

    // The last line of defence: every caller reaches here through an async chain that may
    // have been aborted or superseded meanwhile, and a submission cannot be taken back.
    if (vampireRunToken !== this.vampireRunToken) return;

    this.logBackendPayload('Vampire batch request', this.testsuiteUpdateMode, vampireRequest);
    console.log("Vampire request: ", vampireRequest);

    this.session.lastVampireScopeIdsBySentence = this.cloneSelectionRecord(this.session.selectedScopeIdsBySentence);
    this.session.lastVampireMcIdsBySentence = this.cloneSelectionRecord(this.session.selectedMcIdsBySentence);
    this.session.lastVampireSolutionIdsBySentence = this.cloneSelectionRecord(this.session.selectedSolutionIdsBySentence);
    this.session.hasRunVampire = true;
    this.vampireRunId = vampireRequest.run_id ?? null;
    this.saveSessionSnapshot();

    this.loading = true;
    this.preparingInference = false;
    this.vampirePendingItemCount = Object.keys(inference_items).length;
    this.activeVampireRunStartedAt = vampireStartedAt;
    // Only results this run is NOT redoing are a head start. Counting every prior result
    // double-counted the redone ones -- they are already in vampireCurrentRunItemCount --
    // so re-running a whole 26-item suite showed "26 / 52" from the first poll and
    // finished at "52 / 52". Keyed off inference_items, which IS the set being redone.
    const carriedOverResults = this.currentVampireRunKind === 'initial'
      ? []
      : Object.entries(this.session.lastVampireResults ?? {})
        .filter(([itemId]) => !(itemId in inference_items));
    this.vampireProgressBaselineCount = carriedOverResults.length;
    // Bundles already on record for items this run is not redoing -- the same
    // already-done offset vampireProgressBaselineCount applies at item granularity.
    this.vampireProofBaselineCount = carriedOverResults
      .reduce((sum, [, checks]) => sum + (checks?.length ?? 0), 0);
    this.startVampireProgressIndicator(
      this.vampireCurrentRunItemCount + this.vampireProgressBaselineCount,
      this.submittedProofBundleCount(vampireRequest));

    this.vampireRunInFlight = true;
    const inferenceReport = this.session.report?.inference;
    this.endVampirePhase = inferenceReport ? startPhase(inferenceReport.phases, INFERENCE_PHASES.vampire) : null;

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
      // The run may already be over: this callback and the POST's are unordered, and the
      // POST's error path is instant when the service is unreachable. Arming here anyway
      // left a 2s poll running for the life of the tab, against a run nobody was waiting on.
      if (!this.vampireRunInFlight) return;
      this.startVampireSummaryPolling(vampireStartedAt, vampireRunToken);
    });
    this.loadAndRenderVampireState(false, vampireStartedAt, vampireRunToken);

    // `complete` is not belt-and-braces here, it is the failure path. `batchVampire`
    // catches its own errors and returns EMPTY, so a run that fails -- a 500, a service
    // that is not up -- emits NOTHING and simply completes: `error` never fires, and
    // neither did any teardown. That is how a poll loop came to outlive its run entirely.
    let responded = false;
    this.batchVampire(vampireRequest).subscribe({
      next: () => {
        responded = true;
        this.endVampireRun();
        this.loadAndRenderVampireState(true, vampireStartedAt, vampireRunToken);
      },
      error: () => this.failVampireRun(),
      complete: () => {
        if (!responded) this.failVampireRun();
      }
    });
  }

  /** The one way a Vampire run ends: stop the polling and record that it is over, so a
   *  callback still in flight cannot restart it. Every terminal path goes through here. */
  private endVampireRun(): void {
    this.vampireRunInFlight = false;
    this.vampireActiveItemId = null;
    this.stopVampireSummaryPolling();
  }

  /** Emits once: true when the service no longer runs `runId` for this session (or runs
   *  nothing, when `runId` is null), false after `vampireStopTimeoutMs`. Asks at once, then
   *  every half second. An unreachable service counts as stopped: it is running nothing. */
  private waitForVampireRunToStop(runId: string | null): Observable<boolean> {
    return defer(() => this.dataService.getVampireProgress(this.redisSessionKey)).pipe(
      catchError(() => of(null)),
      repeat({ delay: 500 }),
      map(progress => progress?.activeRunId ?? null),
      filter(active => active === null || (runId !== null && active !== runId)),
      take(1),
      map(() => true),
      timeout({ first: this.vampireStopTimeoutMs, with: () => of(false) }),
    );
  }

  /** Stop the client-side NLI preparation chain. Safe to call when none is running. */
  /** An inference run ends before anything reached Vampire: it gives up the lock it took when
   *  it started. Only the current run may -- a superseded run's lock is its successor's. */
  private endInferencePreparation(runToken: number): void {
    if (runToken !== this.vampireRunToken) return;
    this.preparingInference = false;
    this.loading = false;
  }

  /** Abort while the TPTP checks are still being built. Nothing was sent to Vampire, so
   *  there is nothing to cancel there -- `vampireRunId` is still the previous run's, and
   *  cancelling it would wait on a run that is long gone. */
  private abortInferencePreparation(): void {
    this.vampireRunToken++;
    this.stopNliPreparation();
    this.finishInferenceReport('aborted');
    this.preparingInference = false;
    this.loading = false;
    this.saveSessionSnapshot();
    this.displayMessage('Inference aborted while building the TPTP checks; nothing was sent to Vampire.', 'blue');
  }

  private stopNliPreparation(): void {
    this.nliPreparationSubscription?.unsubscribe();
    this.nliPreparationSubscription = null;
  }

  /** A submission that never came back with results: tear the run down and stop claiming
   *  to be busy. */
  private failVampireRun(): void {
    this.endVampireRun();
    this.finishInferenceReport('no results came back');
    this.vampirePendingItemCount = null;
    this.activeVampireRunStartedAt = null;
    this.loading = false;
    this.clearVampireProgressIndicator();
    this.saveSessionSnapshot();
  }

  private itemTouchesUpdatedSentences(item: any, updatedSentenceIds: Set<string>): boolean {
    if (!updatedSentenceIds.size) return false;

    const sentenceIds = [...(item?.premises ?? []), ...(item?.conclusion ?? [])].map((sid: any) => String(sid ?? ''));
    return sentenceIds.some(sentenceId => updatedSentenceIds.has(sentenceId));
  }

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

  /** The solutions of one sentence that this run should reason over.
   *
   *  The single selection point: text, semantic graph and solution id are all read off
   *  what this returns, so they cannot drift apart. It also owns the one filter that used
   *  to live only on the graph side -- an LFGxDRT reading with no graph cannot be a
   *  premise AST, and dropping it here (loudly) is what keeps the remaining lists aligned
   *  instead of shifting one against the other. */
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

    const withGraph = selected.filter(solution => !!readingOf(solution).graph);
    if (withGraph.length !== selected.length) {
      console.warn('[Regression] some readings have no semantic graph and cannot be '
        + 'reasoned over in lfgxdrt mode', {
        sentenceId,
        dropped: selected.filter(solution => !readingOf(solution).graph).map(solution => solution.id),
      });
    }
    return withGraph;
  }

  private usesLfgxDrt(): boolean {
    return Number(this.session.gswbPreferences?.outputstyle) === 5;
  }

  private solutionText(solution: GswbSolution): string {
    const reading = readingOf(solution);
    return (this.usesLfgxDrt() ? reading.semString : reading.prologRender) ?? '';
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
    this.vampireProgressSawRunning = false;

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
        // A record written by another run -- one still stopping, or a finished one whose
        // record the pre-submission clear did not remove -- says nothing about this run.
        // Reading it made the bar alternate between two runs' counts.
        if (progress?.runId && this.vampireRunId && progress.runId !== this.vampireRunId) return;
        this.vampireProgressItemCount = (progress?.itemCount ?? 0) + this.vampireProgressBaselineCount;
        this.vampireProgressProofCount = progress?.proofCount ?? this.vampireProgressProofCount;
        this.vampireActiveItemId = progress?.activeItemId ? String(progress.activeItemId) : null;

        // A run that died server-side is terminal. Polling it forever is how a crash came
        // to look like a run that had merely stopped progressing -- the request had 500'd
        // half an hour earlier and only this service's log said so.
        if (progress?.state === 'failed') {
          this.endVampireRun();
          this.vampirePendingItemCount = null;
          this.activeVampireRunStartedAt = null;
          this.loading = false;
          this.finishInferenceReport(progress.failure ?? 'the inference service failed');
          this.clearVampireProgressIndicator();
          const reason = progress.failure ?? 'the inference service reported no reason';
          this.displayMessage(
            `Vampire run failed after ${progress.itemCount ?? 0} of ${progress.totalItemCount ?? 0} items: ${reason}`,
            'red');
          this.setSessionLoadStatus('error', 'Vampire run failed',
            `${reason}\nCompleted items are saved; re-running continues from them.`);
          this.saveSessionSnapshot();
          return;
        }

        // So is a run that finished. `failed` used to be the only terminal state here, which
        // left the batch POST's response as the sole thing that could stop this loop -- and
        // when that response never arrived, the 2s poll outlived the run by hours. Stopping
        // on the record's own word costs nothing: the results are rendered from the POST's
        // final snapshot, not from these ticks.
        //
        // Only once this run has been SEEN running, though. The record is cleared before
        // polling starts precisely because a finished run leaves its `completed` snapshot
        // behind, and that clear is allowed to fail (it must never block a run). Without
        // this guard, one failed clear would let the previous run's record stop the new
        // run's polling on its first tick.
        if (progress?.state === 'running') {
          this.vampireProgressSawRunning = true;
        } else if (this.vampireProgressSawRunning
                   && (progress?.state === 'completed' || progress?.state === 'cancelled')) {
          this.stopVampireSummaryPolling();
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

    // One after the other: forkJoin over concurrent HttpClient calls can drop one's
    // notification and never emit, and this is the call that ends a run.
    this.dataService.getLastSession(this.redisSessionKey).pipe(
      concatMap(session => this.dataService.getLastSessionSummary(this.redisSessionKey).pipe(
        map(summary => ({ session, summary })))),
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
          this.endVampireRun();
          this.finishInferenceReport('no items were processed');
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
          this.loading = false;
          this.vampirePendingItemCount = null;
          this.activeGswbRunStartedAt = null;
          this.activeVampireRunStartedAt = null;
          this.endVampireRun();
          this.finishInferenceReport();
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
          this.endVampireRun();
          this.finishInferenceReport('results could not be reloaded');
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
          ruleString: this.session.pragmaticsRulesText,
          pruned: this.contextPruning?.nativeElement?.checked ?? false,
          anaphoraSelection: this.runAnaphoraSelection
            ? { ...this.runAnaphoraSelection, applied: this.runAnaphoraSelectionApplied[pair.itemId] ?? true }
            : this.session.analysisDocuments[pair.itemId]?.reasoningUpdates?.find(existing => existing.id === updateId)?.anaphoraSelection
              ?? { ...ALL_ANAPHORA_BRANCHES },
          assignments: [],
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
        // The anaphora branch this assignment was reasoned over, as chat records it. Linked
        // only when registerDiscourseUpdate actually stored that branch: validation rejects a
        // pointer to a branch that does not exist.
        const discourseUpdateId = update.sourceElementId ? `du-${update.sourceElementId}` : undefined;
        const linked = !!discourseUpdateId && (this.session.analysisDocuments[pair.itemId]?.discourseUpdates ?? [])
          .some(du => du.id === discourseUpdateId && du.discourse.some(branch => branch.id === assignment.mappingId));
        update.assignments.push({
          id: assignment.assignmentId,
          premiseSemanticIds: parseReasoningAssignmentId(assignment.assignmentId).premiseSemanticIds,
          hypothesisSemanticIds: parseReasoningAssignmentId(assignment.assignmentId).hypothesisSemanticIds,
          ruleBranchIndex: assignment.ruleBranchIndex,
          ...(linked ? { discourseUpdateId, discourseId: assignment.mappingId } : {}),
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
    let unchanged = 0;
    updates.forEach(update => {
      update.verdict = majorityVerdict(update.assignments);
      const documentId = String(update.itemId ?? '');
      const document = this.session.analysisDocuments[documentId];
      if (!document) {
        console.warn('[Regression] no document for this item; reasoning update not written',
          { updateId: update.id, itemId: documentId });
        return;
      }

      // This runs on every 15s results poll and rebuilds each update from scratch, so most
      // rebuilds are byte-identical to what is already stored. Leaving them alone matters:
      // the autosave diffs by section path and `analysis.documents` is one path, so a
      // rewrite re-uploads every item's document -- 4.9 MB on a 6-item ambiguous session,
      // once per poll, for nothing. Re-stamped timestamps alone were enough to force that,
      // which is why they are decided HERE rather than at construction.
      const existing = (document.reasoningUpdates ?? []).find(entry => entry.id === update.id);
      if (existing && sameReasoningUpdate(existing, update)) {
        unchanged++;
        return;
      }
      // `createdAt` means created: it survives every later rebuild. `updatedAt` moves only
      // when the content actually did, which is what makes it worth storing at all.
      update.createdAt = existing?.createdAt ?? computedAt;
      update.updatedAt = computedAt;

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
      unchanged,
      assignmentCount: [...updates.values()].reduce((sum, update) => sum + update.assignments.length, 0),
      documentCount: Object.keys(this.session.analysisDocuments).length,
      storedUpdateCount: Object.values(this.session.analysisDocuments)
        .reduce((sum, document) => sum + (document.reasoningUpdates ?? []).length, 0),
    });
  }

  /** Whether `checks` carry assignment ids and none of them is an assignment of the item's
   *  reasoning update. Checks without ids (the legacy Prolog path) never qualify. */
  private resultsBelongToAnotherPreparation(itemId: string, checks: check[] | undefined): boolean {
    const ids = (checks ?? []).map(check => check?.assignment_id).filter((id): id is string => !!id);
    if (!ids.length) return false;
    const update = (this.session.analysisDocuments[itemId]?.reasoningUpdates ?? [])
      .find(candidate => candidate.id === `ru-${itemId}`);
    if (!update) return false;
    const known = new Set((update.assignments ?? []).map(assignment => assignment.id));
    return !ids.some(id => known.has(id));
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
    const documentResults = this.documentInferenceResults();

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
      // Results that carry assignment ids none of which the item's assignments have were
      // computed for a different preparation of the item (a run from before a re-parse).
      // Counting them by position gave the item a verdict in the report while its document
      // had none, so the same item showed both a verdict and a failure.
      if (!fromDocument && this.resultsBelongToAnotherPreparation(testItem.id, value)) {
        console.warn('[Regression] results do not match the item\'s assignments; not counted',
          { itemId: testItem.id });
        continue;
      }

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
        glyphs: glyphs,
        ...(fromDocument?.anaphoraSelection ? { anaphoraSelection: fromDocument.anaphoraSelection } : {}),
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
      `Overall accuracy: ${totalSessionItems === 0 ? 'n/a' : String(totalCorrectItems / totalSessionItems)}\n` +
      this.anaphoraSelectionSummary();

    if (finalSnapshot) {
      this.commitParsedRegressionSnapshot();
    }
  }

  /** The selection the current (or last) Vampire run of this page started with, and per item
   *  whether a ranking was there to apply it. */
  private runAnaphoraSelection: AnaphoraSelectionPolicy | null = null;
  /** The Vampire settings of the current inference run, fixed when it starts. */
  private runVampirePreferences: VampirePreferences | null = null;
  private runAnaphoraSelectionApplied: Record<string, boolean> = {};

  /** The selection the settings ask for -- applied to the next run, not to existing verdicts. */
  private anaphoraSelection(): AnaphoraSelectionPolicy {
    return anaphoraSelectionPolicy(this.vampirePreferences?.vampirePreferences ?? this.session.vampirePreferences);
  }

  /** The anaphora rankers the settings ask for -- applied to rankings computed from now on. */
  private anaphoraRankers(): AnaphoraRankerSelection {
    return anaphoraRankerSelection(this.vampirePreferences?.vampirePreferences ?? this.session.vampirePreferences);
  }

  /** Every item's verdict as its document records it (its run's selection, or `override`). */
  private documentInferenceResults(override?: AnaphoraSelectionPolicy): Record<string, RegressionInferenceResult> {
    const results: Record<string, RegressionInferenceResult> = {};
    for (const item of this.regressionTestItems) {
      const document = this.session.analysisDocuments[String(item?.id ?? '')];
      if (document) Object.assign(results, inferenceResultsFromDocument(document, [item], this.sentenceMap, override));
    }
    return results;
  }

  /** Which branches runs sent to Vampire, and accuracy of the stored results restricted to each
   *  selection -- a comparison only; the report keeps each run's own verdicts. After a top-k run
   *  only the selected branches have results, so the restrictions coincide. */
  private anaphoraSelectionSummary(): string {
    const counted = Object.values(this.documentInferenceResults());
    const topK = counted.find(result => result.anaphoraSelection?.mode === 'top_k')?.anaphoraSelection?.k;
    const describe = (mode?: string, k?: number) => mode === 'top_k' ? `top ${k}` : 'all';
    const countedModes = [...new Set(counted.map(result => describe(result.anaphoraSelection?.mode, result.anaphoraSelection?.k)))];

    const policies: [string, AnaphoraSelectionPolicy][] = [['all', ALL_ANAPHORA_BRANCHES], ['top 1', { mode: 'top_k', k: 1 }]];
    if (topK && topK > 1) policies.push([`top ${topK}`, { mode: 'top_k', k: topK }]);
    const parts = policies.map(([name, policy]) => {
      const results = Object.values(this.documentInferenceResults(policy));
      return `${name} ${results.filter(result => !result.mismatch).length}/${results.length}`;
    });
    const ranked = Object.values(this.documentInferenceResults({ mode: 'top_k', k: 1 }))
      .filter(result => result.anaphoraSelection?.applied).length;
    return `Anaphora branches sent to Vampire: ${countedModes.join(', ') || 'n/a'}. `
      + `Same results restricted to each selection: ${parts.join(' · ')} (ranking available for ${ranked} item(s))`;
  }

  /** Re-derives the report from the stored documents after a ranking arrives, without asking
   *  Vampire for anything. Each item keeps the selection its run recorded. */
  private refreshInferenceFromDocuments(): void {
    const results = this.session.lastVampireResults;
    if (!results || !Object.keys(results).length) return;
    this.renderVampireResults(results, { item_count: Object.keys(results).length, proof_count: 0 } as VampireSessionSummary, false, false);
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

  onEditorContentChange(field: 'testsuiteText', value: string): void {
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
        this.displayMessage(err?.status === 409
          ? 'An earlier inference run of this session is still stopping. Try again in a moment.'
          : "An error occurred during Vampire processing.", "red");
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

  /** Deliberately no disambiguation clause. Parsing used to be held shut for the whole of
   *  the disambiguation pause, on the assumption that the pause always ends by pressing
   *  Continue or Skip. There is no pause any more -- a session that stopped after parsing is
   *  simply a parsed one -- and keeping the clause would have disabled parsing for good the
   *  first time a run stopped. */
  get runLocked(): boolean {
    return this.loading || this.saveOperationInProgress || this.isRestoringRuleSet;
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

  hasDiscourses(itemId: string): boolean {
    return !!this.session.analysisDocuments[itemId]?.discourseUpdates?.some(update => update.discourse.length);
  }

  /** Item whose discourses are being rendered, for the button's loading state. */
  discourseDialogLoadingItemId: string | null = null;

  /** The item's full discourses -- every anaphora branch of its merged sequence, by rank, with
   *  the verdicts reasoned over each. Rendered to SVG by GSWB on opening, like the PCDRS the
   *  other views show; regression does not store the SVGs. If GSWB cannot render, the text DRSs
   *  are shown instead. */
  openDiscourseDialog(itemId: string): void {
    const document = this.session.analysisDocuments[itemId];
    if (!document || this.discourseDialogLoadingItemId) return;
    const { solutions, labels, rankings, render, counted } = discourseBranchesForDisplay(document);
    const open = (items: GswbSolution[], svgSolutions: boolean, itemLabels: string[]) => this.discourseDialog.open({
      sentenceId: itemId,
      title: `Discourses — ${itemId}`,
      subtitle: this.itemTextForHeader(itemId),
      items,
      itemLabels,
      itemRankings: rankings,
      svgSolutions,
      collapsible: true,
      readingOrder: {
        updates: document.discourseUpdates ?? [],
        discriminants: document.sentences.flatMap(sentence => sentence.discriminants ?? []),
        averager: this.anaphoraRankers().averager,
      },
      // Opens on what the run sent to Vampire; the checkbox shows every branch.
      ...(counted ? { filter: { ids: counted, label: 'Only branches sent to Vampire' } } : {}),
    });

    this.discourseDialogLoadingItemId = itemId;
    this.dataService.gswbRenderPcdrs({ items: render }).pipe(
      timeout(60_000),
      finalize(() => this.discourseDialogLoadingItemId = null),
    ).subscribe({
      next: output => {
        const svgById = new Map((output?.solutions ?? []).map(solution => [solution.id, solution.solution]));
        if (solutions.length && solutions.every(solution => !!svgById.get(solution.id))) {
          open(solutions.map(solution => ({ ...solution, solution: svgById.get(solution.id)! })), true, labels);
        } else {
          console.warn('[Regression] some discourses could not be rendered; showing text', { itemId });
          open(solutions, false, labels);
        }
      },
      error: error => {
        console.warn('[Regression] could not render discourses; showing text', { itemId, error });
        open(solutions, false, labels);
      },
    });
  }

  /** An item's premises and hypothesis, one per line, for a dialog header. */
  private itemTextForHeader(itemId: string): string {
    const item = this.regressionTestItems.find(candidate => String(candidate?.id ?? '') === itemId);
    if (!item) return '';
    const texts = (ids: any[]) => (ids ?? []).map((sid: any) => this.sentenceMap[String(sid ?? '')] ?? String(sid ?? ''));
    return [
      ...texts(item.premises).map((text: string) => `P: ${text}`),
      ...texts(item.conclusion).map((text: string) => `H: ${text}`),
    ].join('\n');
  }

  openSemVisDialog(payload: any): void {
    const sid = payload.sentenceId;

    this.semvisDialog.open({
      title: `Solutions — ${sid}`,
      subtitle: this.sentenceMap[sid] ?? '',
      ...payload,
      svgSolutions: this.session.gswbPreferences.outputstyle === 5,
      collapsible: true,
      selectedScopeIds: this.session.selectedScopeIdsBySentence[sid] ?? [],
      selectedMcIds: this.session.selectedMcIdsBySentence[sid] ?? [],
    });
  }



}
