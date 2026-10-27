import { ChangeDetectorRef, Component, EventEmitter, Input, Output } from '@angular/core';
import { DataService } from '../../data.service';
import {
  AnaphoraRankerSelection,
  ChatMessage,
  context,
  DiscourseAnalysis,
  DiscourseUpdate,
  GswbDiscriminant,
  GswbRequest,
  GswbSolution,
  ReasoningCheckSet,
  ReasoningUpdate,
  LigerStructure,
  SemanticAnalysis,
  SentenceAnalysis,
  SequenceAnalysis,
  SyntacticAnalysis,
  vampireRequest,
  XlePlusGlueDocument,
  POST_PROCESSING_SKIPPED_NOTICE,
  hasPostProcessingRules,
  GrammarAxioms,
  grammarAxiomCount,
  mergeGrammarAxioms,
  VampirePreferences,
} from '../../models/models';
import { GswbSettingsComponent } from '../../gswb-vis/gswb-settings/gswb-settings.component';
import { DomSanitizer } from '@angular/platform-browser';
import { InferenceSettingsComponent } from '../../inference-interface/inference-settings/inference-settings.component';
import { Observable, ReplaySubject, catchError, concatMap, defer, from, map, of, switchMap, toArray } from 'rxjs';
import { isLfgxdrtPreferences } from '../../app-defaults';
import {
  compositeAnalysisId,
  majorityVerdict,
  anaphoraRankerSelection,
  anaphoraRankingTable,
  agreesWithPrior,
  carryAnaphoraRanking,
  discourseDiscriminantsOf,
  emptyMovePart,
  needsAnaphoraRanking,
  readingDisplay,
  readingOf,
  readingSelectionOf,
  reasoningUpdateId,
  readingsSelectedAcross,
  sentenceReadingsAllowedBy,
  turnSurvivors,
  validateAnalysisDocument,
  validateReasoningUpdate
} from '../../analysis-model';
import { MappingWithStructure, ReadingAssignment, ReasoningPipelineService } from '../../reasoning/reasoning-pipeline.service';
import { PcdrsReading, discourseUpdateOf } from '../../document-builder/pcdrs-readings';
import {
  ReadingOrderContext,
  ReadingSelection,
  describeReadingSelection,
  normalizedReadingSelection,
  sameReadingSelection,
  selectionNeedsRanking,
} from '../../reading-order';
import { AnaphoraRankingService } from '../../reasoning/anaphora-ranking.service';
import {
  DerivedSentence,
  DocumentBuilderService,
  SequenceMergePair,
  SequenceMergePreviousContext,
} from '../../document-builder/document-builder.service';

/** One turn's discourse as its message shows it (N4 6d). */
interface ChatTurn {
  /** The turn's DiscourseUpdates (one: every branch takes one step per turn). */
  updateIds: string[];
  /** The sentence the turn added: only its discriminants narrow the message. */
  sentenceId: string;
  /** The default selection the turn started with. */
  defaultSelection: ReadingSelection;
  /** The readings sent to Vampire, the only ones the message shows; null on a first turn,
   *  which sends nothing and shows every reading. */
  sent: string[] | null;
  /** The sent readings Vampire found consistent, the only ones the selection may keep (one
   *  per empty move); null on a first turn. */
  selectable: string[] | null;
  /** The context entry each selectable reading stands for: a neutral reading its merged
   *  discourse, an entailed one the prior it was checked against. Null on a first turn,
   *  where a reading stands for its semantic reading's entry. */
  optionOf: Map<string, context> | null;
}

/** What a message's DRS pill shows its readings with (see app-sem-vis). */
export interface ChatMessageView {
  readingOrder: ReadingOrderContext;
  /** The latest message's selection; null on older messages, which are order only. */
  readingSelection: { selection: ReadingSelection; own: boolean } | null;
  selectableIds: string[] | null;
  discriminants: GswbDiscriminant[] | null;
  selectedDiscriminants: { scopeIds: string[]; mcIds: string[] } | null;
  orderOnly: boolean;
}

/** One (prior reading, new sentence reading) pair of a turn. */
interface TurnPair {
  pair: SequenceMergePair;
  /** Scopes every id GSWB mints for the pair's readings and checks. */
  pairId: string;
  /** The prior reading appended to (its semantic reading is the pair's premise). */
  premiseContext: context;
  /** The prior's options over that semantic reading: its PCDRS readings the next turn may
   *  build on. A reading of the pair is kept only when it agrees with one of them. */
  priorOptions: context[];
  /** The merged reading's semId: its discourse readings' semanticOrigin. */
  semanticOrigin: string;
  sequenceId: string;
}

/** One selected reading's checks, ready for Vampire. */
interface TurnAssignment {
  turnPair: TurnPair;
  assignment: ReadingAssignment;
}


/** The side panel's account of one turn. */
export interface ChatTurnSummary {
  sentence: string;
  startedAt: number;
  /** Null while the turn runs. */
  durationMs: number | null;
  /** Whether pragmatics rules were loaded, i.e. pronouns could be resolved. */
  pragmatics: boolean;
  /** Reasoning branches sent to Vampire; null for a first turn or one that did not get there. */
  branches: number | null;
  /** Readings carried forward to the next turn. */
  survivingReadings: number | null;
  degraded: number;
  dropped: number;
  mergeFailures: number;
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent {

  constructor(
    private dataService: DataService,
    private changeDetector: ChangeDetectorRef,
    private sanitizer: DomSanitizer,
    private reasoningPipeline: ReasoningPipelineService,
    private documentBuilder: DocumentBuilderService,
    private anaphoraRanking: AnaphoraRankingService,
  ) {}

  /** Each message's DRS branches as first shown, before any ranking reordered them. Kept
   *  off the message itself so the chat history does not store every branch twice. */
  private readonly branchesInGenerationOrder = new WeakMap<ChatMessage, { solutions: GswbSolution[]; labels: string[] }>();

  @Input() ruleString: string = '';
  /** The loaded rule set's post-processing rules (pronouns, presuppositions), applied to
   *  each sentence's and sequence's merged syntax + DRS. Null until rules are loaded. */
  @Input() pragmaticsRuleString: string | null = null;
  @Input() gswbPreferences: GswbSettingsComponent;
  @Input() vampirePreferences: InferenceSettingsComponent;

  @Input() history: context[][] = [];  // Received from parent
  @Output() historyChange = new EventEmitter<context[][]>(); // Event to notify updates

  /** The rule set's axioms (the LiGER workspace's, edits included). */
  @Input() axioms: string = '';
  /** Axioms the rules added to this conversation's parses, untranslated (LiGER AXIOM /
   *  TPTP_AXIOM / TFF_TYPE). Kept apart from the rule set's: they belong to the conversation, not to a
   *  config file. Both are sent; Vampire encodes these for the request's logic type. */
  derivedGrammarAxioms: GrammarAxioms = { prolog: [], tptp: [], tffTypes: [] };
  private turnVampirePreferences: VampirePreferences | null = null;
  /** The default reading selection this turn started with (see sendMessage). */
  private turnSelection: ReadingSelection = normalizedReadingSelection(null);
  /** derivedGrammarAxioms as shown in the chat's axiom tab. */
  derivedAxioms = '';
  @Output() derivedAxiomsChange = new EventEmitter<string>();

  @Input() activeIndices: number[] = [];
  @Output() clearSelection: EventEmitter<void> = new EventEmitter<void>();  // Event to clear selection

  @Input() chatDocument: XlePlusGlueDocument = ChatComponent.emptyChatDocument();
  @Output() chatDocumentChange = new EventEmitter<XlePlusGlueDocument>();

  // The parent-owned chat session id, threaded into every Vampire request so the adapter can
  // group this conversation's tmp/debug files under one session directory.
  @Input() sessionKey: string;

  chatHistory: ChatMessage[] = []; // Stores chat messages
  userInput: string = ''; // Stores user input
  meaningConstructors: string = '';

  // needs to be updated as chat goes on
  context: context[] = [];

  private loadingValue = false;
  /** Whether the bot is responding. Turning it off closes the turn the side panel reports. */
  get loading(): boolean {
    return this.loadingValue;
  }
  set loading(value: boolean) {
    this.loadingValue = value;
    if (!value && this.lastTurn && this.lastTurn.durationMs === null) {
      this.lastTurn.durationMs = Date.now() - this.lastTurn.startedAt;
    }
    // The latest message can be narrowed only between turns.
    if (this.latestTurnMessage) this.refreshBranchRanking(this.latestTurnMessage);
  }

  /** What the side panel says about the most recent turn. Null before the first one. */
  lastTurn: ChatTurnSummary | null = null;
  /** Whether the side panel is open. */
  sidePanelOpen = true;

  /** The no-pragmatics notice, shown in the side panel rather than repeated every turn. */
  readonly postProcessingSkippedNotice = POST_PROCESSING_SKIPPED_NOTICE;

  get hasPragmaticsRules(): boolean {
    return hasPostProcessingRules(this.pragmaticsRuleString);
  }

  /** Non-blank, non-comment lines of the rule set's axioms. */
  get axiomLineCount(): number {
    return (this.axioms ?? '').split('\n')
      .filter(line => line.trim() && !line.trim().startsWith('%') && !line.trim().startsWith('//')).length;
  }

  get derivedAxiomCount(): number {
    return grammarAxiomCount(this.derivedGrammarAxioms);
  }

  /** The reasoning settings the next turn will read, as label/value pairs. */
  get nextTurnSettings(): Array<[string, string]> {
    const prefs = this.vampirePreferences?.vampirePreferences;
    if (!prefs) return [];
    const rows: Array<[string, string]> = [
      ['Logic', prefs.logic_type === 0 ? 'fof' : 'tff'],
      ['Max duration', `${prefs.max_duration ?? ''}s`],
      ['Model building', prefs.model_building ? 'on' : 'off'],
      ['Readings', describeReadingSelection(readingSelectionOf(prefs))],
    ];
    if (prefs.anaphora_rankers?.length) {
      rows.push(['Rankers', prefs.anaphora_rankers.join(', ')]);
    }
    return rows;
  }

  static emptyChatDocument(): XlePlusGlueDocument {
    return { id: '', semanticType: 'lfgxdrt', sentences: [], sequences: [], elements: [] };
  }

  /** Resets in-flight conversation state for a fresh session. The chatDocument itself is
   *  reset/replaced by the parent (it owns the session key/persistence lifecycle). */
  resetConversationState(): void {
    this.context = [];
    this.chatHistory = [];
    this.messageViews.clear();
    this.turns.clear();
    this.latestTurnMessage = null;
    this.pendingRankings.clear();
    this.userInput = '';
    this.derivedGrammarAxioms = { prolog: [], tptp: [], tffTypes: [] };
    this.derivedAxioms = '';
    this.derivedAxiomsChange.emit(this.derivedAxioms);
  }

  /** One-indexed turn number for the current exchange, derived from how many surviving
   *  context readings have accumulated so far. Sent to Vampire as `turn_index` so the
   *  adapter can fold this turn's proof calls into the right session subfolder. */
  private currentTurnIndex(): number {
    return this.context.length === 0 ? 1 : this.context.length + 1;
  }

  /** Stamps and appends a chat message. Centralizing this (instead of pushing onto
   *  chatHistory directly at every call site) keeps the timestamp assignment in one place. */
  /** Returns the stored message so a caller can fill in fields that only become available
   *  after an async step -- turn 1's DRS branches are the case that needs it. */
  private pushChatMessage(message: Omit<ChatMessage, 'timestamp'>): ChatMessage {
    const stored: ChatMessage = { ...message, timestamp: new Date().toISOString() };
    this.chatHistory.push(stored);
    this.refreshBranchRanking(stored);
    return stored;
  }

  /** The post-processing rules for every discourse/reasoning step below. Empty when the rule
   *  set has none: the steps then skip post-processing and leave every pronoun unbound. */
  private pragmaticsRules(): string {
    return this.pragmaticsRuleString ?? '';
  }

  sendMessage() {
    if (!this.userInput.trim()) return;

    this.loading = true; // Show loading indicator
    const userMessage = this.userInput;

    // Add user message to history
    this.pushChatMessage({ text: userMessage, sender: 'User' });

    // Without pragmatics rules no pronoun is bound. The side panel says so for as long as
    // it holds; the turn records it, so a verdict can be read against it afterwards.
    this.lastTurn = {
      sentence: userMessage,
      startedAt: Date.now(),
      durationMs: null,
      pragmatics: hasPostProcessingRules(this.pragmaticsRuleString),
      branches: null,
      survivingReadings: null,
      degraded: 0,
      dropped: 0,
      mergeFailures: 0,
    };

    // This turn's Vampire settings, read once: the check formulas are typed for the logic
    // the request names even if the settings change while the turn prepares.
    this.turnVampirePreferences = { ...this.vampirePreferences.vampirePreferences };
    this.turnSelection = readingSelectionOf(this.turnVampirePreferences);

    const ligerRequest = { sentence: userMessage, ruleString: this.ruleString };

    this.dataService.ligerAnnotate(ligerRequest).subscribe({
      next: data => {
        const selectedSolution = data.solutions?.find((solution: any) =>
          Array.isArray(solution?.graph?.graphElements) && solution.graph.graphElements.length > 0)
          ?? data.solutions?.[0];

        if (!selectedSolution || !selectedSolution.graph?.graphElements?.length) {
          console.info('[Chat] LiGER parse failed', { sentence: userMessage });
          this.pushChatMessage({ text: 'Syntactic analysis failed for this input!', sender: 'Bot' });
          this.loading = false;
          return;
        }
        console.info('[Chat] LiGER parse succeeded', {
          sentence: userMessage,
          solutionCount: data.solutions?.length ?? 0,
          selectedSolutionKey: selectedSolution.solutionKey,
        });

        const proofInputs = (data.solutions ?? [])
          .filter((solution: any) => typeof solution?.meaningConstructors === 'string'
            && solution.meaningConstructors.trim().length > 0)
          .map((solution: any, index: number) => ({
            proofId: solution.solutionKey || `sentence-${index + 1}`,
            solutionKey: solution.solutionKey,
            meaningConstructors: solution.meaningConstructors,
            structure: solution.structureJson
          }));
        this.meaningConstructors = proofInputs.map(input => input.meaningConstructors).join('\n');

        this.addDerivedAxioms(selectedSolution.axioms);

        // LFGxDRT derives the sentence on its own and appends it to the discourse; see
        // prepareLfgxdrtSolutions.
        if (isLfgxdrtPreferences(this.gswbPreferences.gswbPreferences)) {
          this.prepareLfgxdrtSolutions(userMessage, selectedSolution, data.solutions);
          return;
        }

        const gswbRequest: GswbRequest = {
          premises: this.meaningConstructors,
          gswbPreferences: this.gswbPreferences.gswbPreferences,
          structure: selectedSolution.structureJson,
          proofs: proofInputs.length ? proofInputs : undefined
        };

        this.dataService.gswbDeduce(gswbRequest).subscribe({
          next: gswbData => {
            if (!Array.isArray(gswbData.solutions) || gswbData.solutions.length === 0 || gswbData.solutions[0] === '') {
              console.info('[Chat] GSWB deduce found no semantic analyses', { sentence: userMessage });
              this.pushChatMessage({ text: 'No semantic analyses found for this input!', sender: 'Bot' });
              this.loading = false;
              return;
            }

            console.info('[Chat] GSWB deduce succeeded', {
              sentence: userMessage,
              solutionCount: gswbData.solutions.length,
              turn: this.currentTurnIndex(),
            });
            const userSem = gswbData.solutions.map(x => readingDisplay(readingOf(x))).join('\n');

            const vampRequest: vampireRequest = {
              text: userMessage,
              context: this.context,
              axioms: this.axioms,
              grammar_axioms: this.derivedGrammarAxioms,
              hypothesis: userSem,
              active_indices: this.activeIndices,
              vampire_preferences: this.turnPreferences(),
              session_key: this.sessionKey,
              turn_index: this.currentTurnIndex()
            };

            this.dataService.callVampire(vampRequest).subscribe({
              next: vampData => {
                this.clearSelected();

                if (vampData.hasOwnProperty('context')) {
                  const newContext = vampData.context;
                  this.history.push(newContext);
                  this.context = newContext;
                  this.historyChange.emit(this.history);
                  this.changeDetector.detectChanges();

                  let consistent: boolean | null = null;
                  let info: boolean | null = null;
                  let relevant: boolean | null = null;
                  let glyphs: string[] = [];
                  let tptp = '';

                  const mappings = Array.isArray(vampData.context_checks_mapping)
                    ? vampData.context_checks_mapping
                    : Object.values(vampData.context_checks_mapping ?? {});

                  if (mappings.length > 0) {
                    glyphs = mappings
                      .map(m => m?.glyph)
                      .filter((g): g is string => typeof g === 'string' && g.trim().length > 0);

                    info = this.majorityVote(mappings.map(m => !!m?.informative));
                    consistent = this.majorityVote(mappings.map(m => !!m?.consistent));
                    relevant = this.majorityVote(mappings.map(m => !!m?.relevant));
                  }

                  if (Array.isArray(vampData.context) && vampData.context.length > 0) {
                    for (const item of vampData.context) {
                      if (item.hasOwnProperty('tptp')) {
                        tptp += item.tptp + '\n';
                      }
                    }
                  }

                  const message = this.verdictMessage(consistent, info, relevant);
                  console.info('[Chat] Vampire verdict (prolog-drt)', {
                    consistent, informative: info, relevant, mappingCount: mappings.length,
                  });
                  const glyphGridSize = Math.max(1, Math.ceil(Math.sqrt(glyphs.length)));
                  const safeGlyphs = glyphs.map(g => this.sanitizer.bypassSecurityTrustHtml(g));

                  this.pushChatMessage({
                    text: message,
                    sender: 'Bot',
                    detailText: tptp,
                    glyphs,
                    safeGlyphs,
                    glyphGridSize
                  });
                }

                this.loading = false;
              },
              error: () => {
                this.pushChatMessage({ text: 'An error occurred during the inference process', sender: 'Bot' });
                this.loading = false;
              }
            });
          },
          error: () => {
            this.pushChatMessage({ text: 'An error occurred during the semantic analysis', sender: 'Bot' });
            this.loading = false;
          }
        });
      },
      error: () => {
        this.pushChatMessage({ text: 'An unknown error occurred.', sender: 'Bot' });
        this.loading = false;
      }
    });

    this.userInput = ''; // Clear input
  }

  private verdictMessage(consistent: boolean | null, info: boolean | null, relevant: boolean | null): string {
    if (consistent === null) return 'Okay ...';
    if (!consistent) return 'Your input does not make sense.';
    if (!info) return 'Your input is not informative.';
    if (relevant) return 'I may not fully understand your input. I assume it is informative and consistent';
    return 'Your input is informative and consistent.';
  }

  /** Strict-majority vote, ties resolve false. With a single value (one reading reasoned
   *  over) this reduces to just that value. */
  private majorityVote(values: boolean[]): boolean {
    const trueCount = values.reduce((acc, v) => acc + (v ? 1 : 0), 0);
    return trueCount > values.length - trueCount;
  }

  /** Every turn's sentence is derived on its own, once per parse (one `/deduce`), and
   *  registered with those readings; appending it to the discourse derives nothing
   *  (`DocumentBuilderService.appendSentence`). The first sentence has no PxQ yet, so no NLI
   *  rules, PCDRS generation or anaphora collapse. */
  private prepareLfgxdrtSolutions(
    userMessage: string,
    ligerSolution: any,
    ligerSolutions: any[],
  ): void {
    const sentenceId = `sentence-${this.chatDocument.sentences.length + 1}`;
    this.documentBuilder.deriveSentence(
      { id: sentenceId, text: userMessage }, ligerSolutions, this.gswbPreferences.gswbPreferences,
    ).subscribe({
      next: derived => {
        console.info('[Chat] sentence derived on its own', {
          sentenceId,
          readings: derived.analysis.semantics.length,
          parses: derived.analysis.syntax.length,
        });
        // With its discriminants: the surface order reads them, and the latest message
        // narrows by them.
        derived.analysis.discriminants = derived.discriminants;
        this.documentBuilder.upsertSentenceAnalyses(this.chatDocument, [derived.analysis]);
        this.emitChatDocument();
        if (this.context.length === 0) {
          this.acceptInitialLfgxdrtContext(userMessage, derived);
        } else {
          this.finishLfgxdrtPreparation(userMessage, derived.analysis);
        }
      },
      error: error => {
        console.warn('[Chat] deriving the sentence failed', { sentence: userMessage, error });
        this.pushChatMessage({ text: 'An error occurred during semantic reasoning preparation', sender: 'Bot' });
        this.loading = false;
      }
    });
  }

  /** A later turn (N4 6d), one procedure with regression's: the prior is what survives the
   *  latest message's selection; step 1 appends the new sentence to it, stores the turn's
   *  sequence and its DiscourseUpdate with every reading and ranks it; step 2 reasons over
   *  the readings the default selection the turn started with keeps, then Vampire. */
  private finishLfgxdrtPreparation(userMessage: string, sentence: SentenceAnalysis): void {
    const typed = this.turnPreferences().logic_type !== 0;
    const newSentenceId = sentence.id;
    const previous = this.latestTurnUpdates();
    const previousNeedsRanking = !!previous && selectionNeedsRanking(
      this.turnReadingSelection(previous.turn, previous.updates).selection);
    // A context that produced no pairs reports why instead of thinning the result silently;
    // surfaced alongside the per-branch failures below.
    let mergeFailures: string[] = [];
    let discourseFailures: string[] = [];

    // A selection by the LM ranking waits for it.
    (previousNeedsRanking ? this.rankingsOf(previous!.turn.updateIds) : of(undefined)).pipe(
      switchMap(() => {
        const contextIndices = this.priorContextIndices();
        console.info('[Chat] Preparing NLI reasoning', {
          sentence: userMessage, newSentenceId, contextIndices, contexts: this.context.length,
        });
        if (!contextIndices.length) {
          throw new Error('No reading of the conversation so far survives its selection.');
        }

        // The prior options are PCDRS readings; options over one semantic reading share its
        // append and its readings, which are then sorted to the option they agree with.
        const optionsByReading = new Map<string, context[]>();
        contextIndices.map(index => this.context[index]).forEach(option => {
          const key = `${option.elementId}|${option.semanticAnalysis?.semId}`;
          optionsByReading.set(key, [...(optionsByReading.get(key) ?? []), option]);
        });

        // One element per prior semantic reading: a clone of the registered Sentence (turn 2)
        // or Sequence (turn 3+) it extends, so appendSentence resolves its sentences and
        // parses against the registry. Keyed by the element OBJECT, not by elementId: an
        // ambiguous premise contributes several readings that share one elementId, so a
        // string-keyed map would collapse them. appendSentence threads the same reference
        // back as `pair.previousElement`.
        const premiseByElement = new Map<SentenceAnalysis | SequenceAnalysis, context[]>();
        const previousContexts: SequenceMergePreviousContext[] = [...optionsByReading.values()].map(options => {
          const premiseContext = options[0];
          const semanticAnalysis = premiseContext?.semanticAnalysis;
          if (!premiseContext?.elementId || !semanticAnalysis) {
            throw new Error('Accepted context reading and document element id are required for appending a sentence.');
          }
          const registered: SentenceAnalysis | SequenceAnalysis | undefined =
            this.chatDocument.sequences.find(sequence => sequence.id === premiseContext.elementId)
            ?? this.chatDocument.sentences.find(registeredSentence => registeredSentence.id === premiseContext.elementId);
          if (!registered) {
            throw new Error(`Accepted context element ${premiseContext.elementId} is not registered in the chat document.`);
          }
          const element = { ...registered };
          premiseByElement.set(element, options);
          return { semantic: semanticAnalysis, element };
        });

        return this.documentBuilder.appendSentence({
          previousContexts,
          sentence,
          readings: sentence.semantics,
          knownSentences: this.chatDocument.sentences,
          resolveDrs: this.gswbPreferences.gswbPreferences.resolveDrs,
          ruleString: this.ruleString,
        }).pipe(map(result => {
          mergeFailures = result.failures;
          return result.pairs.map(pair => {
            const priorOptions = premiseByElement.get(pair.previousElement);
            const premiseContext = priorOptions?.[0];
            if (!premiseContext) {
              throw new Error(`Merged pair references unknown prior element ${pair.previousElement.id}.`);
            }
            if (!pair.sequenceStructure) {
              throw new Error(`Merged pair for ${pair.previousElement.id} has no sequence structure to reason over.`);
            }
            // The PRIOR'S READING, not just its element id: GSWB derives every PCDRS id from
            // this scope, and two pairs differing only in the prior's reading produced
            // identical pragmatic ids when it was not part of it
            // (misc/current/chat-document-pronoun-bug3.json).
            const pairId = `pxq-${pair.previousElement.id}-${premiseContext.semanticAnalysis!.semId}`
              + `-${pair.currentSemantic?.semId ?? newSentenceId}`;
            return {
              pair,
              pairId,
              premiseContext,
              priorOptions,
              semanticOrigin: readingOf(pair.merged).semId,
              sequenceId: compositeAnalysisId([pair.previousElement.id, newSentenceId]),
            } as TurnPair;
          });
        }));
      }),
      switchMap(turnPairs => this.storeTurnDiscourse(userMessage, turnPairs).pipe(
        map(step1 => {
          discourseFailures = step1.failures;
          return { turnPairs, ...step1 };
        }))),
      switchMap(step1 => {
        const ids = step1.updates.map(update => update.id);
        if (!ids.length) return of({ ...step1, selected: [] as string[], assignments: [] as TurnAssignment[], failures: [] as string[], degradations: [] as string[], selection: this.turnSelection, applied: true });
        const wait = selectionNeedsRanking(this.turnSelection) ? this.rankingsOf(ids) : of(undefined);
        return wait.pipe(
          switchMap(() => this.reasonOverTurn(step1.turnPairs,
            ids.map(id => this.storedDiscourseUpdate(id)).filter((update): update is DiscourseUpdate => !!update), typed)),
          map(step2 => ({ ...step1, ...step2 })),
        );
      }),
    ).subscribe({
      next: turn => {
        console.info('[Chat] NLI reasoning bundles prepared', {
          sentence: userMessage,
          pairCount: turn.turnPairs.length,
          readings: turn.updates.reduce((sum, update) => sum + update.discourse.length, 0),
          selected: turn.selected.length,
          assignmentCount: turn.assignments.length,
        });
        // A branch that lost its anaphora binding still produces a usable bundle, and a
        // branch that could not be prepared at all just disappears from the assignments.
        // Neither is visible in the answer that follows, so both are reported here: a
        // partially resolved discourse must never be presented as a cleanly resolved one.
        this.reportUnresolvedBranches(userMessage,
          [{ failures: [...discourseFailures, ...turn.failures], degradations: turn.degradations }], mergeFailures);
        if (!turn.assignments.length) {
          const reasons = [...mergeFailures, ...discourseFailures, ...turn.failures];
          const detail = reasons.length ? ` ${reasons.join(' ')}` : '';
          this.pushChatMessage({
            text: turn.updates.length && !turn.selected.length
              ? `No reading was selected to reason over (${describeReadingSelection(turn.selection)}).${detail}`
              : `No consistent continuation could be reasoned over.${detail}`,
            sender: 'Bot',
          });
          this.loading = false;
          return;
        }
        const request: vampireRequest = {
          text: userMessage,
          axioms: this.axioms,
          grammar_axioms: this.derivedGrammarAxioms,
          vampire_preferences: this.turnPreferences(),
          tptp_checks: turn.assignments.map(item => item.assignment as any),
          session_key: this.sessionKey,
          turn_index: this.currentTurnIndex()
        };
        this.dataService.callVampire(request).subscribe({
          next: data => this.handleVampireResponse(data, userMessage, newSentenceId, turn),
          error: error => {
            console.warn('[Chat] Vampire request failed', { sentence: userMessage, error });
            this.pushChatMessage({ text: 'An error occurred during the inference process', sender: 'Bot' });
            this.loading = false;
          }
        });
      },
      error: error => {
        console.warn('[Chat] NLI reasoning preparation failed', { sentence: userMessage, error });
        const reason = error?.message ? ` ${error.message}` : '';
        this.pushChatMessage({ text: `An error occurred during semantic reasoning preparation.${reason}`, sender: 'Bot' });
        this.loading = false;
      }
    });
  }

  /** Step 1 of a later turn: every pair's PCDRS readings (the post-processing rules over its
   *  merged syntax and semantics, then /generate_pcdrs), kept when they agree with a prior
   *  option, and stored before Vampire: the turn's sequence with every merged reading and its
   *  DiscourseUpdate with every kept reading, which is then ranked. Empty moves keep every
   *  branch on the same sentences, so there is one sequence per turn; the grouping below
   *  does not rely on it. A pair that fails is reported, not dropped silently. `mappings`:
   *  GSWB's solution per reading id, for the message's DRS pill; `originOf`: the prior
   *  option each kept reading agrees with. */
  private storeTurnDiscourse(userMessage: string, turnPairs: TurnPair[]): Observable<{
    updates: DiscourseUpdate[]; mappings: Map<string, GswbSolution>; failures: string[];
    originOf: Map<string, context>;
  }> {
    return from(turnPairs).pipe(
      concatMap(turnPair => defer(() => this.reasoningPipeline.generateDiscourseMappings({
        scopeId: turnPair.pairId,
        merged: readingOf(turnPair.pair.merged),
        sequenceStructure: turnPair.pair.sequenceStructure!,
        ruleString: this.pragmaticsRules(),
        // Chat shows each reading's DRS in its message.
        includeSvg: true,
      })).pipe(
        map(mappings => ({ turnPair, mappings, failure: undefined as string | undefined })),
        catchError(error => {
          console.warn('[Chat] readings could not be generated for one pair', { pairId: turnPair.pairId, error });
          return of({ turnPair, mappings: [] as MappingWithStructure[], failure: `${turnPair.pairId}: ${error?.message ?? String(error)}` });
        }),
      )),
      toArray(),
      map(results => {
        const failures = results.map(result => result.failure).filter((failure): failure is string => !!failure);
        const bySequence = new Map<string, context[]>();
        turnPairs.forEach(turnPair => bySequence.set(turnPair.sequenceId,
          [...(bySequence.get(turnPair.sequenceId) ?? []), this.contextEntryOf(turnPair, userMessage)]));
        bySequence.forEach((entries, sequenceId) => this.upsertSequenceFromContexts(sequenceId, entries));

        const mappings = new Map<string, GswbSolution>();
        const readingsBySequence = new Map<string, PcdrsReading[]>();
        const failuresBySequence = new Map<string, string[]>();
        // The earlier sentences' choices are the prior's: a reading that binds an earlier
        // pronoun or places an earlier p-box otherwise belongs to no option and is dropped.
        const originOf = new Map<string, context>();
        let disagreeing = 0;
        results.forEach(({ turnPair, mappings: generated, failure }) => {
          if (failure) failuresBySequence.set(turnPair.sequenceId, [...(failuresBySequence.get(turnPair.sequenceId) ?? []), failure]);
          const pairMappings = generated.filter(mapping => {
            const origin = this.originOption(turnPair.priorOptions, mapping.mapping?.semantic ?? '');
            if (origin && mapping.mapping?.id) originOf.set(mapping.mapping.id, origin);
            if (!origin) disagreeing++;
            return !!origin;
          });
          readingsBySequence.set(turnPair.sequenceId, [
            ...(readingsBySequence.get(turnPair.sequenceId) ?? []),
            ...pairMappings.map(mapping => {
              if (mapping.mapping?.id) mappings.set(mapping.mapping.id, mapping.mapping as GswbSolution);
              return { ...mapping, semanticOrigin: turnPair.semanticOrigin, semString: readingOf(turnPair.pair.merged).semString };
            }),
          ]);
        });
        const updates: DiscourseUpdate[] = [];
        readingsBySequence.forEach((readings, sequenceId) => {
          if (!readings.length) return;
          const sequenceFailures = failuresBySequence.get(sequenceId) ?? [];
          const update: DiscourseUpdate = {
            ...discourseUpdateOf({ id: sequenceId, kind: 'sequence' }, readings, this.pragmaticsRules()),
            ...(sequenceFailures.length ? { failures: sequenceFailures } : {}),
          };
          this.upsertDiscourseUpdate(update);
          updates.push(this.storedDiscourseUpdate(update.id) ?? update);
        });
        console.info('[Chat] readings kept by the prior\'s choices', {
          kept: originOf.size, dropped: disagreeing,
        });
        return { updates, mappings, failures, originOf };
      }),
    );
  }

  /** Step 2 of a later turn: the four checks over the readings the turn's default selection
   *  keeps, in one order over all the turn's discourses, per pair, read from the stored
   *  discourse. Nothing is merged again. */
  private reasonOverTurn(turnPairs: TurnPair[], updates: DiscourseUpdate[], typed: boolean): Observable<{
    selected: string[]; assignments: TurnAssignment[]; failures: string[]; degradations: string[];
    selection: ReadingSelection; applied: boolean;
  }> {
    const { readings, selection, applied } = readingsSelectedAcross(
      this.chatDocument, updates, this.turnSelection, this.anaphoraRankers().averager);
    const selected = new Set(readings.map(reading => reading.id));
    // In generation order, per pair. The selection is the only cut.
    const byOrigin = new Map<string, DiscourseAnalysis[]>();
    updates.flatMap(update => update.discourse).filter(reading => selected.has(reading.id)).forEach(reading =>
      byOrigin.set(reading.semanticOrigin, [...(byOrigin.get(reading.semanticOrigin) ?? []), reading]));
    const work = turnPairs.filter(turnPair => byOrigin.has(turnPair.semanticOrigin));
    return from(work).pipe(
      concatMap(turnPair => defer(() => this.reasoningPipeline.prepareStoredReadingChecks({
        scopeId: turnPair.pairId,
        // Chat is the degenerate 1+1 case of the premise/conclusion shape: one prior
        // element, one new sentence; the readings of each that made this pair.
        scope: {
          updateId: reasoningUpdateId([turnPair.pair.previousElement.id], [turnPair.pair.currentElement.id]),
          premiseSemanticIds: [turnPair.premiseContext.semanticAnalysis!.semId],
          hypothesisSemanticIds: [turnPair.pair.currentSemantic?.semId ?? ''],
        },
        readings: byOrigin.get(turnPair.semanticOrigin)!,
        // The prior: this turn's accepted context entry, which for turn n>1 is already the
        // merged semantics of every earlier turn -- "A for A+B, A+B for A+B+C".
        premiseSemantic: turnPair.premiseContext.semantic,
        premiseAsts: [turnPair.premiseContext.semanticGraph as LigerStructure],
        hypothesisAsts: [turnPair.pair.currentSemantic?.graph as LigerStructure],
        typed,
      })).pipe(
        map(pair => ({
          assignments: pair.assignments.map(assignment => ({ turnPair, assignment })),
          failures: pair.failures,
          degradations: pair.degradations,
        })),
        catchError(error => {
          console.warn('[Chat] reading checks could not be prepared for one pair', { pairId: turnPair.pairId, error });
          return of({ assignments: [] as TurnAssignment[], failures: [`${turnPair.pairId}: ${error?.message ?? String(error)}`], degradations: [] as string[] });
        }),
      )),
      toArray(),
      map(pairs => ({
        selected: [...selected],
        assignments: pairs.flatMap(pair => pair.assignments),
        failures: pairs.flatMap(pair => pair.failures),
        degradations: pairs.flatMap(pair => pair.degradations),
        selection,
        applied,
      })),
    );
  }

  /** A pair's merged reading as a context entry: what the turn's sequence registers, and --
   *  when Vampire accepts one of its readings -- the next turn's prior. */
  private contextEntryOf(
    turnPair: TurnPair, userMessage: string, tptp = '', discourse?: GswbSolution,
  ): context {
    const reading = readingOf(turnPair.pair.merged);
    return {
      original: `${turnPair.premiseContext.original ?? ''} ${userMessage}`.trim(),
      prolog_drs: reading.semString,
      prolog_fol: '',
      // The whole merged sequence, display only: the next turn's context axiom is built
      // from `semantic`.
      tptp,
      // The PCDRS reading the entry stands for, when it is one: its DRS with A: and P:.
      box: discourse?.solution ?? reading.svg ?? '',
      ...(discourse ? { discourseReading: { id: discourse.id, drsString: discourse.semantic ?? '' } } : {}),
      semantic: reading.semString,
      semanticGraph: reading.graph,
      syntax: turnPair.pair.sequenceStructure,
      semanticAnalysis: reading,
      synSemMapping: turnPair.pair.merged.synSemMapping,
      elementId: turnPair.sequenceId,
    } as context;
  }

  /** Records this turn's reasoning in the document: one ReasoningUpdate for the (prior
   *  element, new sentence) pair, one assignment per reading sent, each pointing at its
   *  stored discourse reading, and the selection the turn sent them by. */
  private upsertReasoningUpdates(
    assignments: TurnAssignment[],
    verdictFor: (item: TurnAssignment, index: number) => any,
    readingSelection: ReadingSelection & { applied: boolean },
  ): void {
    const updates = new Map<string, ReasoningUpdate>();

    assignments.forEach((item, index) => {
      const { turnPair, assignment } = item;
      const assignmentId = assignment.assignmentId;
      const priorElementId = turnPair.pair.previousElement.id;
      const newSentenceId = turnPair.pair.currentElement.id;
      if (!assignmentId) return;
      const updateId = reasoningUpdateId([priorElementId], [newSentenceId]);

      if (!updates.has(updateId)) {
        updates.set(updateId, {
          id: updateId,
          premiseElementIds: [priorElementId],
          hypothesisElementIds: [newSentenceId],
          sourceElementId: turnPair.sequenceId,
          sourceElementKind: 'sequence',
          // Same source the TPTP itself was built from, not GSWB's output style.
          logicType: this.turnPreferences().logic_type === 0 ? 'fof' : 'tff',
          ruleString: this.pragmaticsRules(),
          readingSelection,
          assignments: [],
          createdAt: new Date().toISOString(),
        });
      }
      const update = updates.get(updateId)!;
      if (update.assignments.some(existing => existing.id === assignmentId)) return;

      const check = verdictFor(item, index);
      update.assignments.push({
        id: assignmentId,
        premiseSemanticIds: [turnPair.premiseContext.semanticAnalysis?.semId ?? ''],
        hypothesisSemanticIds: [turnPair.pair.currentSemantic?.semId ?? ''],
        ruleBranchIndex: assignment.ruleBranchIndex ?? 1,
        // Step 1 stored every reading before Vampire, so the link always resolves.
        discourseUpdateId: `du-${turnPair.sequenceId}`,
        discourseId: assignment.mappingId,
        contextTptp: assignment.contextTptp ?? '',
        contextSemanticId: turnPair.semanticOrigin,
        checks: assignment.checks as ReasoningCheckSet,
        // A degraded bundle is still usable and still gets a verdict, so the only thing
        // that keeps it distinguishable from a cleanly resolved one is saying so here.
        ...(assignment.degradations?.length ? { degradations: assignment.degradations } : {}),
        verdict: check ? {
          consistent: !!check.consistent,
          informative: !!check.informative,
          relevant: !!check.relevant,
          glyph: check.glyph,
          proofFiles: check.proof_files,
          computedAt: new Date().toISOString(),
        } : undefined,
      });
    });

    updates.forEach(update => {
      update.verdict = majorityVerdict(update.assignments);
      update.updatedAt = new Date().toISOString();
      const next = [
        ...(this.chatDocument.reasoningUpdates ?? []).filter(existing => existing.id !== update.id),
        update,
      ];
      try {
        // Validated against a candidate document rather than after assignment, so a
        // rejected update leaves the document exactly as it was.
        validateReasoningUpdate({ ...this.chatDocument, reasoningUpdates: next }, update);
        this.chatDocument.reasoningUpdates = next;
      } catch (error) {
        console.warn('[Chat] reasoning update rejected by document invariants',
          { updateId: update.id, error });
      }
    });
    this.emitChatDocument();

    console.info('[Chat] reasoning updates written', {
      updates: [...updates.values()].map(update => ({
        id: update.id,
        logicType: update.logicType,
        verdict: update.verdict?.label,
        readingSelection: describeReadingSelection(readingSelection),
        assignments: update.assignments.length,
      })),
    });
  }

  /** Names the contexts that could not be merged and the branches that were dropped, in the
   *  chat itself; the reasons come from ReasoningPipelineService and name the mapping and the
   *  item that failed. Unresolved pronouns are counted for the side panel only: the reply
   *  names them in a pill, with each reading's outcome. */
  private reportUnresolvedBranches(
    userMessage: string, prepared: any[], mergeFailures: string[] = []
  ): void {
    const dropped: string[] = prepared.flatMap(item => item?.failures ?? []);
    const degraded: string[] = prepared.flatMap(item => item?.degradations ?? []);
    if (this.lastTurn) {
      this.lastTurn.dropped = dropped.length;
      this.lastTurn.degraded = degraded.length;
      this.lastTurn.mergeFailures = mergeFailures.length;
    }
    if (degraded.length) {
      console.warn('[Chat] some reasoning branches have unresolved pronouns', { sentence: userMessage, degraded });
    }
    if (!dropped.length && !mergeFailures.length) {
      return;
    }

    console.warn('[Chat] some reasoning branches were not fully resolved',
      { sentence: userMessage, dropped, mergeFailures });

    const parts: string[] = [];
    if (mergeFailures.length) {
      parts.push(`${mergeFailures.length} discourse context(s) could not be merged at all`);
    }
    if (dropped.length) {
      parts.push(`${dropped.length} branch(es) could not be prepared at all`);
    }
    const reasons = [...mergeFailures, ...dropped];
    const shown = reasons.slice(0, 3).join('; ');
    const remainder = reasons.length > 3 ? ` (and ${reasons.length - 3} more)` : '';
    this.pushChatMessage({
      text: `Note: ${parts.join(' and ')}. ${shown}${remainder}`,
      sender: 'Bot'
    });
  }

  private acceptInitialLfgxdrtContext(userMessage: string, derived: DerivedSentence): void {
    const sentence = derived.analysis;
    const structureOf = (semantic: SemanticAnalysis) =>
      sentence.syntax.find(syntax => syntax.synId === semantic.syntacticOrigin)?.structure;
    const solutions = derived.solutions;
    const contexts = sentence.semantics
      .map(reading => ({
        original: userMessage,
        prolog_drs: reading.semString,
        prolog_fol: '',
        tptp: '',
        box: reading.svg ?? '',
        semantic: reading.semString,
        semanticGraph: reading.graph,
        // The reading's own parse: turn 1's post-processing joins its SRC ids against it.
        syntax: structureOf(reading),
        semanticAnalysis: reading,
        synSemMapping: { [reading.syntacticOrigin]: [reading.semId] },
        elementId: sentence.id,
      } as context))
      .filter(item => item.semantic?.trim());

    if (!contexts.length) {
      this.pushChatMessage({ text: 'No post-processed semantic analyses found.', sender: 'Bot' });
      this.loading = false;
      return;
    }
    const sentenceId = sentence.id;

    this.context = contexts;
    this.history.push(contexts);
    this.historyChange.emit(this.history);
    this.clearSelected();
    // Turn 1's reply goes out before post-processing has run, so it can only carry the
    // raw semantic text at this point. The message object is kept so the PCDRS branches
    // can replace that text pill with the rendered DRS pill once they arrive -- see
    // postProcessInitialContext. Without this, turn 1 was the only turn that never showed
    // a rendered DRS, because the template falls back to the text pill whenever
    // `branchSolutions` is empty and nothing ever filled it in.
    const turnOneMessage = this.pushChatMessage({
      text: 'Okay ...',
      sender: 'Bot',
      semanticText: contexts.map(item => item.semantic).join('\n')
    });
    this.changeDetector.detectChanges();
    this.postProcessInitialContext(sentenceId, contexts, solutions, turnOneMessage);
  }

  /** Turn 1's post-processing: apply the rules over each reading's syntax+semantics union
   *  and generate its PCDRS, recorded as a DiscourseUpdate on the sentence.
   *
   *  Turn 1 has no premise/hypothesis pair, so there is nothing to REASON about yet -- but
   *  it can still contain a reflexive or a pronoun, and whether that bound correctly in
   *  this turn is exactly what the user needs to see (user, 2026-08-21). It is also what
   *  the analysis view does: post-processing there is a button available from the first
   *  sentence on, not something gated on a sequence existing. Previously chat skipped this
   *  entirely, so its first sentence was the only element in the document with no
   *  pragmatic layer at all.
   *
   *  Runs after the reply is already on screen and never blocks it: a failure here costs
   *  the anaphora view for this turn, not the turn. */
  private postProcessInitialContext(
    sentenceId: string, contexts: context[], solutions: any[], message?: ChatMessage
  ): void {
    const readings = contexts
      .map((entry, index) => ({ entry, solution: solutions[index] }))
      .filter(({ entry }) => !!entry.semanticGraph && !!entry.syntax);

    if (!readings.length) {
      this.loading = false;
      return;
    }

    // The rendered DRS for each branch, for turn 1's message pill. Same shape branchDetail
    // builds for every later turn: index-aligned solutions and captions.
    const branchSolutions: GswbSolution[] = [];
    const branchLabels: string[] = [];

    // Serialized, same rationale as everywhere else on this path.
    from(readings).pipe(
      concatMap(({ entry, solution }) => {
        const semId = entry.semanticAnalysis?.semId ?? `${sentenceId}-sem`;
        const scopeId = `turn1-${sentenceId}-${semId}`;
        return this.reasoningPipeline.generateDiscourseMappings({
          scopeId,
          merged: readingOf(solution),
          sequenceStructure: entry.syntax as LigerStructure,
          // The post-processing rules, NOT `this.ruleString`. That input is the LiGER
          // *parse* rule set (it feeds /parse and the sequence syntax merge). Applying it
          // here once meant LiGER returned no annotations, applyNliRules fell back to the
          // unruled tier-A union, and with no SYNSEM there were no POSSIBLE-ANT facts for
          // GSWB to branch on -- one empty mapping, no pronoun bound. Every turn uses this
          // same source, so all turns' pragmatic layers come from one rule set.
          ruleString: this.pragmaticsRules(),
          includeSvg: true,
        }).pipe(
          map(mappings => ({ semId, scopeId, mappings })),
          catchError(error => {
            console.warn('[Chat] turn 1 post-processing failed for one reading',
              { sentenceId, semId, error });
            return of({ semId, scopeId, mappings: [] as MappingWithStructure[] });
          })
        );
      }),
      toArray()
    ).subscribe({
      next: results => {
        const readings = results.flatMap(({ semId, mappings }) =>
          mappings.map(mapping => ({ ...mapping, semanticOrigin: semId })));
        // Now that the joins are not stored, the rule string is what makes them recomputable.
        const update = discourseUpdateOf(
          { id: sentenceId, kind: 'sentence' }, readings, this.pragmaticsRules());
        readings.forEach(({ mapping }) => {
          if (!mapping?.solution) return;
          branchSolutions.push(mapping as GswbSolution);
          // No verdict to report on turn 1 -- nothing has been reasoned about yet -- so the
          // caption states what the branch bound, which is the whole point of showing turn
          // 1's branches at all.
          const bound = mapping.anaphoraRelations?.length
            ? `${mapping.anaphoraRelations.length} binding(s)`
            : 'no binding';
          branchLabels.push(bound);
        });

        // Swap the placeholder text pill for the rendered branches, exactly as every later
        // turn does. `semanticText` is cleared for the same reason handleVampireResponse
        // clears it: the template shows the text pill only when there are no branches, and
        // showing both would put the same DRS on screen twice.
        if (message && branchSolutions.length) {
          message.branchSolutions = branchSolutions;
          message.branchLabels = branchLabels;
          message.semanticText = '';
        }

        // The options turn 2 can build on are the PCDRS readings, with their A: and P:; a
        // reading without any keeps its semantic entry.
        const optionOf = new Map<string, context>();
        const options = contexts.flatMap(entry => {
          const own = readings.filter(reading => reading.semanticOrigin === entry.semanticAnalysis?.semId && reading.mapping?.id);
          if (!own.length) return [entry];
          return own.map(({ mapping }) => {
            const option: context = {
              ...entry,
              box: mapping.solution ?? entry.box,
              discourseReading: { id: mapping.id, drsString: mapping.semantic ?? '' },
            };
            optionOf.set(mapping.id, option);
            return option;
          });
        });
        if (optionOf.size) {
          this.context = options;
          this.history[this.history.length - 1] = options;
          this.historyChange.emit(this.history);
        }

        if (update.discourse.length) {
          console.info('[Chat] turn 1 post-processing complete', {
            sentenceId,
            readings: results.length,
            discourseBranches: update.discourse.length,
            anaphoraResolvedCount: update.discourse.filter(item => item.collapsed).length,
            renderedBranches: branchSolutions.length,
          });
          this.upsertDiscourseUpdate(update);
          // Nothing is sent on turn 1: every reading shows and can be selected.
          if (message) {
            this.setLatestTurn(message, {
              updateIds: [update.id], sentenceId, defaultSelection: this.turnSelection, sent: null, selectable: null,
              optionOf: optionOf.size ? optionOf : null,
            });
          }
        }
        this.changeDetector.detectChanges();
        this.loading = false;
      },
      error: error => {
        console.warn('[Chat] turn 1 post-processing failed', { sentenceId, error });
        this.loading = false;
      }
    });
  }

  private handleVampireResponse(
    vampData: any,
    userMessage: string,
    newSentenceId: string,
    turn: {
      updates: DiscourseUpdate[]; mappings: Map<string, GswbSolution>; originOf: Map<string, context>; selected: string[];
      assignments: TurnAssignment[]; selection: ReadingSelection; applied: boolean;
    },
  ): void {
    this.clearSelected();
    const mappings = Object.values(vampData.context_checks_mapping ?? {}) as any[];
    const glyphs = mappings
      .map(item => item?.glyph)
      .filter((glyph): glyph is string => typeof glyph === 'string' && glyph.trim().length > 0);
    const relevant = mappings.length ? this.majorityVote(mappings.map(item => !!item.relevant)) : null;
    // Vampire echoes each bundle's assignment id back on its verdict, so a verdict is
    // paired with the reading it was computed for rather than with whatever sits at the
    // same array index.
    const verdictByAssignment = new Map<string, any>();
    mappings.forEach(check => {
      const id = check?.assignment_id;
      if (id) verdictByAssignment.set(id, check);
    });
    const verdictFor = (item: TurnAssignment, index: number) => {
      const id = item.assignment.assignmentId;
      return (id && verdictByAssignment.get(id)) ?? mappings[index];
    };
    this.upsertReasoningUpdates(turn.assignments, verdictFor, { ...turn.selection, applied: turn.applied });

    // Each reading sent is neutral (consistent and informative: its merged discourse is an
    // option for the next turn), entailed (consistent, not informative: the prior it was
    // checked against is the option, unchanged -- entailed information need not be
    // restated) or inconsistent (rejected). One option per merged reading or prior, not one
    // per reading; which options the next turn builds on is decided by this turn's message
    // (priorContextIndices).
    const options: context[] = [];
    const optionOf = new Map<string, context>();
    const emptyMoves = new Map<context, context>();
    // The readings the message shows and its selection picks from: every neutral reading, and
    // one entailed reading per empty move (the new sentence's choices are not restated, so
    // the others would show the same prior again).
    const shown = new Set<string>();
    let neutral = 0;
    let entailed = 0;
    turn.assignments.forEach((item, index) => {
      const check = verdictFor(item, index);
      if (!check?.consistent) return;
      const readingId = item.assignment.mappingId;
      let option: context;
      if (check.informative) {
        neutral++;
        option = this.contextEntryOf(item.turnPair, userMessage, item.assignment.sequenceTptp ?? '', turn.mappings.get(readingId));
      } else {
        // An empty move: the turn's step over the prior it agrees with is that prior
        // unchanged, once per prior however many readings were entailed over it.
        entailed++;
        const origin = turn.originOf.get(readingId) ?? item.turnPair.premiseContext;
        const known = emptyMoves.get(origin);
        option = known ?? this.emptyMove(origin, item.turnPair.sequenceId, newSentenceId);
        emptyMoves.set(origin, option);
        if (known) {
          optionOf.set(readingId, option);
          return;
        }
      }
      shown.add(readingId);
      optionOf.set(readingId, option);
      if (!options.includes(option)) options.push(option);
    });
    const inconsistent = turn.assignments.length - neutral - entailed;
    // The empty moves extended the turn's sequence and discourse.
    if (emptyMoves.size) this.emitChatDocument();
    // Every reading inconsistent: the input is rejected, the discourse stays as it was. The
    // history repeats its readings for this turn, and the previous message stays the one
    // that decides what the next turn builds on.
    const rejected = options.length === 0;
    console.info('[Chat] Vampire verdict (lfgxdrt)', {
      sentence: userMessage, neutral, entailed, inconsistent, relevant,
      options: rejected ? `${this.context.length} (unchanged)` : options.length,
    });
    if (!rejected) this.context = options;
    this.history.push([...this.context]);
    this.historyChange.emit(this.history);
    this.changeDetector.detectChanges();

    // The pill shows the readings this turn sent, by the selection's order; the readings not
    // sent stay in the document but would only clutter it.
    // An entailed reading shows what it stands for: its prior, unchanged.
    const branches = this.branchDetail(turn.assignments, turn.mappings, verdictFor, (item, index) => {
      const check = verdictFor(item, index);
      return check?.consistent && !check.informative ? optionOf.get(item.assignment.mappingId)?.box : undefined;
    }, item => {
      const check = verdictByAssignment.get(item.assignment.assignmentId ?? '');
      return !(check?.consistent && !check.informative) || shown.has(item.assignment.mappingId);
    });
    if (this.lastTurn) {
      this.lastTurn.branches = turn.assignments.length;
      this.lastTurn.survivingReadings = this.context.length;
    }
    // A pronoun a reading says nothing about is read as a new referent: named on the reply,
    // with what the reading came to.
    const unresolvedPronouns = turn.assignments.flatMap((item, index) => {
      const check = verdictFor(item, index);
      const outcome = !check ? 'no verdict'
        : !check.consistent ? 'inconsistent' : check.informative ? 'neutral' : 'entailed';
      return (item.assignment.unresolvedPronouns ?? []).map(pronoun =>
        ({ reading: item.assignment.mappingId, pronoun, outcome }));
    });
    const message = this.pushChatMessage({
      text: this.turnVerdictMessage(neutral, entailed, inconsistent, !!relevant),
      sender: 'Bot',
      glyphs,
      safeGlyphs: glyphs.map(glyph => this.sanitizer.bypassSecurityTrustHtml(glyph)),
      glyphGridSize: Math.max(1, Math.ceil(Math.sqrt(glyphs.length))),
      semanticText: branches.solutions.length ? '' : this.context.map(item => item.semantic || item.prolog_drs).filter(Boolean).join('\n'),
      detailText: branches.tptp,
      branchSolutions: branches.solutions,
      branchLabels: branches.labels,
      ...(unresolvedPronouns.length ? { unresolvedPronouns } : {}),
    });
    if (turn.updates.length) {
      const record: ChatTurn = {
        updateIds: turn.updates.map(update => update.id),
        sentenceId: newSentenceId,
        defaultSelection: turn.selection,
        sent: turn.assignments.map(item => item.assignment.mappingId),
        selectable: [...shown],
        optionOf,
      };
      if (!rejected) {
        this.setLatestTurn(message, record);
      } else {
        // Shown for inspection only: what was checked, with its verdicts.
        this.turns.set(message, record);
        this.refreshBranchRanking(message);
      }
    }
    this.loading = false;
  }

  /** The reply to a later turn: the verdict when every reading sent got the same one, else
   *  how many got which. */
  private turnVerdictMessage(neutral: number, entailed: number, inconsistent: number, relevant: boolean): string {
    const total = neutral + entailed + inconsistent;
    if (neutral === total) return this.verdictMessage(true, true, relevant);
    if (entailed === total) return this.verdictMessage(true, false, relevant);
    if (inconsistent === total) return this.verdictMessage(false, false, relevant);
    const parts = [
      neutral ? `${neutral} informative and consistent` : '',
      entailed ? `${entailed} entailed (keep${entailed === 1 ? 's' : ''} the previous discourse)` : '',
      inconsistent ? `${inconsistent} inconsistent (rejected)` : '',
    ].filter(Boolean);
    return `Of ${total} readings: ${parts.join(', ')}.`;
  }

  /** The option an entailed reading leaves (N4 6d): its prior unchanged, as a step of this
   *  turn's sequence -- the prior's semantics with an empty part for the new sentence, its
   *  PCDRS with A: and P: as an identity reading (`identityOf`) of this turn's discourse --
   *  so every branch takes one step per turn. */
  private emptyMove(origin: context, sequenceId: string, newSentenceId: string): context {
    const prior = origin.semanticAnalysis!;
    const empty = emptyMovePart(newSentenceId);
    const semantic: SemanticAnalysis = {
      ...prior,
      semId: compositeAnalysisId([prior.semId, empty]),
      syntacticOrigin: compositeAnalysisId([prior.syntacticOrigin, empty]),
    };
    const sequence = this.chatDocument.sequences.find(candidate => candidate.id === sequenceId);
    if (sequence && !sequence.semantics.some(candidate => candidate.semId === semantic.semId)) {
      if (!sequence.syntax.some(candidate => candidate.synId === semantic.syntacticOrigin)) {
        sequence.syntax = [...sequence.syntax, {
          synId: semantic.syntacticOrigin, structure: origin.syntax, graph: origin.syntax,
        } as unknown as SyntacticAnalysis];
      }
      sequence.semantics = [...sequence.semantics, semantic];
      sequence.synSemMapping = { ...sequence.synSemMapping, [semantic.syntacticOrigin]: [semantic.semId] };
    }
    let discourseReading = origin.discourseReading;
    const update = this.storedDiscourseUpdate(`du-${sequenceId}`);
    if (origin.discourseReading && update) {
      const id = compositeAnalysisId([origin.discourseReading.id, empty]);
      const priorReading = (this.chatDocument.discourseUpdates ?? []).flatMap(candidate => candidate.discourse)
        .find(candidate => candidate.id === origin.discourseReading!.id);
      if (!update.discourse.some(candidate => candidate.id === id)) {
        const identity: DiscourseAnalysis = {
          ...(priorReading ?? {
            drsString: origin.discourseReading.drsString, ruleBranch: 1,
            anaphoraMapping: { relations: [] }, collapsed: false,
          } as DiscourseAnalysis),
          id,
          semanticOrigin: semantic.semId,
          identityOf: origin.discourseReading.id,
        };
        this.storeDiscourseUpdate({
          ...update,
          discourse: [...update.discourse, identity],
          semDiscourseMapping: { ...update.semDiscourseMapping, [semantic.semId]: [id] },
        });
      }
      discourseReading = { id, drsString: origin.discourseReading.drsString };
    }
    return {
      ...origin,
      elementId: sequenceId,
      semanticAnalysis: semantic,
      synSemMapping: { [semantic.syntacticOrigin]: [semantic.semId] },
      ...(discourseReading ? { discourseReading } : {}),
    };
  }

  /** The option of the prior a reading agrees with on the earlier sentences' choices (A: and
   *  P:); an option that is not a PCDRS reading admits any. */
  private originOption(options: context[], readingDrs: string): context | undefined {
    return options.find(option => !option.discourseReading
      || agreesWithPrior(readingDrs, option.discourseReading.drsString));
  }

  /** The turn's readings sent to Vampire, for the TPTP and DRS pills.
   *
   *  Every sent reading appears, rejected ones included: they are the ones most worth
   *  inspecting. A reading that produced no TPTP says so rather than being filtered out --
   *  an empty translation is exactly the case that must stay visible. */
  private branchDetail(
    assignments: TurnAssignment[],
    mappings: Map<string, GswbSolution>,
    verdictFor: (item: TurnAssignment, index: number) => any,
    shownAs: (item: TurnAssignment, index: number) => string | undefined = () => undefined,
    inPill: (item: TurnAssignment) => boolean = () => true,
  ): { tptp: string; solutions: GswbSolution[]; labels: string[] } {
    const solutions: GswbSolution[] = [];
    const labels: string[] = [];
    const blocks: string[] = [];

    assignments.forEach((item, index) => {
      const verdict = verdictFor(item, index);
      const marks = [
        verdict?.consistent ? 'consistent' : 'inconsistent',
        verdict?.informative ? 'informative' : 'uninformative',
        verdict?.relevant ? 'relevant' : 'irrelevant',
      ].join(', ');
      const id = item.assignment.mappingId ?? item.assignment.assignmentId ?? `branch-${index + 1}`;
      // The pill's caption is the verdict alone: the reading's id is long and says nothing
      // there. The TPTP block names it.
      const label = marks;

      blocks.push(`% ${id} — ${marks}\n${item.assignment.sequenceTptp || '% (no TPTP produced for this branch)'}`);

      const mapping = mappings.get(item.assignment.mappingId);
      if (mapping?.solution && inPill(item)) {
        const shown = shownAs(item, index);
        solutions.push(shown ? { ...mapping, solution: shown } : mapping);
        labels.push(label);
      }
    });

    return { tptp: blocks.join('\n\n'), solutions, labels };
  }

  /** Makes `message` the latest: the one whose discourse can be narrowed, and whose
   *  survivors are the next turn's prior. The previous latest becomes order only, its
   *  selection fixed. */
  private setLatestTurn(message: ChatMessage, turn: ChatTurn): void {
    const previous = this.latestTurnMessage;
    if (previous && previous !== message) this.fixLatestTurnSelection();
    this.turns.set(message, turn);
    this.latestTurnMessage = message;
    if (previous && previous !== message) this.refreshBranchRanking(previous);
    this.refreshBranchRanking(message);
  }

  /** The latest turn's discourse updates, as stored. */
  private latestTurnUpdates(): { turn: ChatTurn; updates: DiscourseUpdate[] } | null {
    const turn = this.latestTurnMessage ? this.turns.get(this.latestTurnMessage) : undefined;
    return turn ? { turn, updates: this.turnUpdates(turn) } : null;
  }

  private turnUpdates(turn: ChatTurn): DiscourseUpdate[] {
    return turn.updateIds.map(id => this.storedDiscourseUpdate(id)).filter((update): update is DiscourseUpdate => !!update);
  }

  /** A turn's selection: stored with each of its discourses alike, else the default the turn
   *  started with. */
  private turnReadingSelection(turn: ChatTurn, updates: DiscourseUpdate[]): { selection: ReadingSelection; own: boolean } {
    const stored = updates.find(update => update.readingSelection)?.readingSelection;
    return stored
      ? { selection: normalizedReadingSelection(stored), own: true }
      : { selection: turn.defaultSelection, own: false };
  }

  /** The context entries the next turn builds on: those a reading surviving the latest
   *  message stands for (of its consistent readings, the latest sentence's discriminant
   *  selection, then its selection or the default the turn started with), intersected with
   *  the history's selection when there is one. Without a stored discourse: every entry. */
  priorContextIndices(): number[] {
    let indices = this.context.map((_, index) => index);
    const latest = this.latestTurnUpdates();
    if (latest?.updates.length) {
      const { turn, updates } = latest;
      const sentence = this.chatDocument.sentences.find(candidate => candidate.id === turn.sentenceId);
      const { readings } = turnSurvivors(this.chatDocument, updates, this.turnReadingSelection(turn, updates).selection,
        this.anaphoraRankers().averager, turn.selectable ? new Set(turn.selectable) : null,
        sentenceReadingsAllowedBy(sentence));
      if (turn.optionOf) {
        // An entry no reading stands for (a reading without PCDRS) stays.
        const options = new Set(readings.map(reading => turn.optionOf!.get(reading.id)));
        const standing = new Set(turn.optionOf.values());
        indices = indices.filter(index => options.has(this.context[index]) || !standing.has(this.context[index]));
      } else {
        const origins = new Set(readings.map(reading => reading.semanticOrigin));
        indices = indices.filter(index => origins.has(this.context[index].semanticAnalysis?.semId ?? ''));
      }
    }
    const chosen = this.activeIndices ?? [];
    return chosen.length ? indices.filter(index => chosen.includes(index)) : indices;
  }

  /** The side panel's account of the next turn's prior. */
  get priorSummary(): string {
    if (!this.context.length) return '';
    const kept = this.priorContextIndices().length;
    return `${kept} of ${this.context.length} reading${this.context.length === 1 ? '' : 's'}`;
  }

  /** A turn that extends the discourse fixes the latest message's selection: recorded with
   *  its discourses, so the document says what the next turn was built on. A turn whose
   *  readings were all rejected leaves it open. */
  private fixLatestTurnSelection(): void {
    const latest = this.latestTurnUpdates();
    if (!latest) return;
    const { selection, own } = this.turnReadingSelection(latest.turn, latest.updates);
    if (own) return;
    latest.updates.forEach(update => this.storeDiscourseUpdate({ ...update, readingSelection: normalizedReadingSelection(selection) }));
  }

  /** A change in the latest message's sem view, stored with its discourses (null: back to
   *  the default the turn started with). Ignored on older messages and during a turn. */
  onReadingSelectionChange(message: ChatMessage, selection: ReadingSelection | null): void {
    const turn = this.turns.get(message);
    const updates = turn ? this.turnUpdates(turn) : [];
    if (!turn || !updates.length || message !== this.latestTurnMessage || this.loading) return;
    updates.forEach(update => {
      const next: DiscourseUpdate = { ...update };
      if (selection) {
        next.readingSelection = normalizedReadingSelection(selection);
      } else {
        delete next.readingSelection;
      }
      this.storeDiscourseUpdate(next);
    });
    this.refreshBranchRanking(message);
  }

  /** The latest message's discriminant selection, stored with its sentence: it narrows the
   *  latest sentence only, as a sentence's own view does. */
  onDiscriminantSelectionChange(message: ChatMessage, change: { scopeIds: string[]; mcIds: string[] }): void {
    const turn = this.turns.get(message);
    if (!turn || message !== this.latestTurnMessage || this.loading) return;
    const sentence = this.chatDocument.sentences.find(candidate => candidate.id === turn.sentenceId);
    if (!sentence) return;
    const same = (a: string[] | undefined, b: string[]) => (a ?? []).length === b.length && b.every(id => (a ?? []).includes(id));
    if (same(sentence.selectedScopeIds, change.scopeIds) && same(sentence.selectedMcIds, change.mcIds)) return;
    sentence.selectedScopeIds = [...change.scopeIds];
    sentence.selectedMcIds = [...change.mcIds];
    this.emitChatDocument();
  }

  /** Builds the Sequence from *every* surviving context, not just the first.
   *
   *  This used to keep entries[0] as a representative, which discarded every other
   *  reading: a three-turn discourse produced 48 contexts spanning two distinct merged
   *  semantic ids, of which one was stored. The discourse layer still referenced the
   *  others, so the document failed its own invariant ("has unknown semantic origin")
   *  and no reasoning result could reference a discarded reading either. The model is
   *  explicit that no semantic alternative may be dropped. */
  private upsertSequenceFromContexts(sequenceId: string, entries: context[]): void {
    const representative = entries[0];
    const sentenceIds = sequenceId.split('+');
    const syntaxById = new Map<string, SyntacticAnalysis>();
    const semanticsById = new Map<string, SemanticAnalysis>();
    const synSemMapping: Record<string, string[]> = {};

    entries.forEach(entry => {
      const semantic = entry.semanticAnalysis;
      const synId = semantic?.syntacticOrigin ?? `${sequenceId}-syn`;
      if (entry.syntax && !syntaxById.has(synId)) {
        syntaxById.set(synId, {
          synId,
          structure: entry.syntax,
          graph: entry.syntax,
        } as unknown as SyntacticAnalysis);
      }
      if (!semantic) {
        return;
      }
      if (!semanticsById.has(semantic.semId)) {
        semanticsById.set(semantic.semId, semantic);
      }
      // Cross-product: one syntax variant maps to every semantic derived from it.
      const mapped = synSemMapping[synId] ?? [];
      if (!mapped.includes(semantic.semId)) {
        mapped.push(semantic.semId);
      }
      synSemMapping[synId] = mapped;
    });

    const syntax = [...syntaxById.values()];
    const semantics = [...semanticsById.values()];

    const sequence: SequenceAnalysis = {
      id: sequenceId,
      text: representative.original,
      sentenceIds,
      syntax,
      semantics,
      synSemMapping,
    };

    this.documentBuilder.upsertSequenceAnalyses(this.chatDocument, [sequence]);
    this.emitChatDocument();
  }

  private upsertDiscourseUpdate(update: DiscourseUpdate): void {
    const previous = this.storedDiscourseUpdate(update.id);
    const rankers = this.anaphoraRankers();
    const stored = carryAnaphoraRanking(previous, update, rankers);
    this.storeDiscourseUpdate(stored);
    if (needsAnaphoraRanking(stored, rankers)) {
      this.rankDiscourseUpdate(stored);
    }
  }

  private storedDiscourseUpdate(id: string): DiscourseUpdate | undefined {
    return this.chatDocument.discourseUpdates?.find(existing => existing.id === id);
  }

  private storeDiscourseUpdate(update: DiscourseUpdate): void {
    this.chatDocument.discourseUpdates = [
      ...(this.chatDocument.discourseUpdates ?? []).filter(existing => existing.id !== update.id),
      update,
    ];
    this.emitChatDocument();
  }

  /** The anaphora rankers the chat's settings ask for. */
  private anaphoraRankers(): AnaphoraRankerSelection {
    return anaphoraRankerSelection(this.vampirePreferences?.vampirePreferences);
  }

  /** Stored first, ranked afterwards; waited on only by a selection that needs it
   *  (`rankingOf`). */
  private rankDiscourseUpdate(update: DiscourseUpdate): void {
    const done = new ReplaySubject<void>(1);
    this.pendingRankings.set(update.id, done);
    this.anaphoraRanking.rankAndAttach(() => this.chatDocument, update, this.anaphoraRankers()).subscribe({
      next: ({ update: ranked }) => {
        if (!ranked) return;
        // Stored as lm answered, never re-requested on its account: a ranking that does not
        // match what was asked (an older lm) would otherwise be requested again forever.
        this.storeDiscourseUpdate(ranked);
        this.chatHistory.forEach(message => this.refreshBranchRanking(message));
        this.changeDetector.detectChanges();
      },
      complete: () => {
        if (this.pendingRankings.get(update.id) === done) this.pendingRankings.delete(update.id);
        done.next();
        done.complete();
      },
    });
  }

  /** Completes once the update's ranking has been attached or found unavailable (the ranking
   *  service times out, so this always completes); at once when none is pending. */
  private rankingOf(updateId: string): Observable<void> {
    return this.pendingRankings.get(updateId)?.asObservable() ?? of(undefined);
  }

  /** Completes once every one of the updates' rankings has (see `rankingOf`). */
  private rankingsOf(updateIds: string[]): Observable<void> {
    return from(updateIds).pipe(concatMap(id => this.rankingOf(id)), toArray(), map(() => undefined));
  }

  /** Ranking requests still running, per discourse update. */
  private readonly pendingRankings = new Map<string, ReplaySubject<void>>();

  /** Each message's turn (N4 6d), and the latest one: the only message whose discourse can
   *  be narrowed, and whose survivors are the next turn's prior. */
  private readonly turns = new Map<ChatMessage, ChatTurn>();
  private latestTurnMessage: ChatMessage | null = null;

  /** What each message's DRS pill shows its readings with (N4): the discourse updates they
   *  belong to and, on the latest message, its selection and discriminants. Kept here, not on
   *  the message, and replaced only when they change, so the pill gets a new one only then. */
  readonly messageViews = new Map<ChatMessage, ChatMessageView>();

  /** Gives a message's DRS branches the ranking of the discourse update each belongs to, and
   *  its pill its view. The branches keep their generation order: the pill's
   *  sem view orders them by its options. */
  private refreshBranchRanking(message: ChatMessage): void {
    if (!message.branchSolutions?.length) return;
    let original = this.branchesInGenerationOrder.get(message);
    if (!original) {
      original = { solutions: message.branchSolutions, labels: message.branchLabels ?? [] };
      this.branchesInGenerationOrder.set(message, original);
    }
    const ids = new Set(original.solutions.map(solution => solution.id));
    const updates = (this.chatDocument.discourseUpdates ?? [])
      .filter(update => update.discourse.some(reading => ids.has(reading.id)));
    if (!updates.length) return;
    this.messageViews.set(message, this.messageView(message, updates));

    // The caption stays the verdict (or the bindings on turn 1); the ranking is in its pill.
    const updateOf = (id: string) => updates.find(update => update.discourse.some(reading => reading.id === id));
    message.branchLabels = [...original.labels];
    message.branchRankings = original.solutions.map(solution => {
      const update = updateOf(solution.id);
      return update ? anaphoraRankingTable(update, solution.id) : null;
    });
  }

  /** The latest message between turns: its selection (k, filters) over the readings Vampire
   *  accepted, and the latest sentence's discriminants. Any other: order only. */
  private messageView(message: ChatMessage, updates: DiscourseUpdate[]): ChatMessageView {
    const readingOrder: ReadingOrderContext = {
      updates,
      discriminants: this.chatDocument.sentences.flatMap(sentence => sentence.discriminants ?? []),
      averager: this.anaphoraRankers().averager,
    };
    const turn = this.turns.get(message);
    const turnUpdates = turn ? updates.filter(candidate => turn.updateIds.includes(candidate.id)) : [];
    const sentence = turn ? this.chatDocument.sentences.find(candidate => candidate.id === turn.sentenceId) : undefined;
    if (!turn || !turnUpdates.length || message !== this.latestTurnMessage || this.loading) {
      return { readingOrder, readingSelection: null, selectableIds: null, discriminants: null, selectedDiscriminants: null, orderOnly: true };
    }
    const previous = this.messageViews.get(message);
    const selection = this.turnReadingSelection(turn, turnUpdates);
    return {
      readingOrder,
      // The same object while unchanged, so the view keeps what is shown.
      readingSelection: previous?.readingSelection && previous.readingSelection.own === selection.own
        && sameReadingSelection(previous.readingSelection.selection, selection.selection) ? previous.readingSelection : selection,
      selectableIds: turn.selectable,
      discriminants: discourseDiscriminantsOf(sentence?.discriminants ?? [], turnUpdates.flatMap(update => update.discourse)),
      selectedDiscriminants: { scopeIds: [...(sentence?.selectedScopeIds ?? [])], mcIds: [...(sentence?.selectedMcIds ?? [])] },
      orderOnly: false,
    };
  }

  private emitChatDocument(): void {
    try {
      validateAnalysisDocument(this.chatDocument);
    } catch (error) {
      console.warn('[Chat] document invariant failed before persistence', error);
    }
    this.chatDocumentChange.emit(this.chatDocument);
  }

  clearSelected(): void {
    this.clearSelection.emit();
  }

  /** The Vampire settings this turn started with (see sendMessage). */
  private turnPreferences(): VampirePreferences {
    return this.turnVampirePreferences ?? this.vampirePreferences.vampirePreferences;
  }

  private addDerivedAxioms(axioms: GrammarAxioms | null | undefined): void {
    const merged = mergeGrammarAxioms([this.derivedGrammarAxioms, axioms]);
    if (grammarAxiomCount(merged) === grammarAxiomCount(this.derivedGrammarAxioms)) return;
    this.derivedGrammarAxioms = merged;
    this.derivedAxioms = [
      ...(merged.tffTypes ?? []).map(type => `${type}   (tff type; dropped in fof)`),
      ...merged.tptp,
      ...merged.prolog.map(term => `${term}   (Prolog; translated by Vampire)`),
    ].join('\n');
    this.derivedAxiomsChange.emit(this.derivedAxioms);
  }

}
