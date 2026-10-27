import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { DataService } from '../../data.service';
import {
  AnaphoraRankerSelection,
  ChatMessage,
  context,
  DiscourseUpdate,
  GswbRequest,
  GswbSolution,
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
import { catchError, concatMap, from, map, of, switchMap, toArray } from 'rxjs';
import { isLfgxdrtPreferences } from '../../app-defaults';
import {
  compositeAnalysisId,
  majorityVerdict,
  anaphoraRankerSelection,
  anaphoraRankingCaption,
  anaphoraRankingTable,
  carryAnaphoraRanking,
  needsAnaphoraRanking,
  readingDisplay,
  readingOf,
  readingSelectionOf,
  reasoningUpdateId,
  validateAnalysisDocument,
  validateReasoningUpdate
} from '../../analysis-model';
import { MappingWithStructure, ReasoningPipelineService } from '../../reasoning/reasoning-pipeline.service';
import { PcdrsReading, discourseUpdateOf } from '../../document-builder/pcdrs-readings';
import { ReadingOrderContext, describeReadingSelection } from '../../reading-order';
import { AnaphoraRankingService } from '../../reasoning/anaphora-ranking.service';
import {
  DerivedSentence,
  DocumentBuilderService,
  SequenceMergePreviousContext,
} from '../../document-builder/document-builder.service';


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

  @ViewChild('contextPruning') contextPruning!: ElementRef;

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
    this.readingOrders.clear();
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
          this.prepareLfgxdrtSolutions(userMessage, selectedSolution, data.solutions,
            this.contextPruning.nativeElement.checked);
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
            const pruneContext = this.contextPruning.nativeElement.checked;

            const vampRequest: vampireRequest = {
              text: userMessage,
              context: this.context,
              axioms: this.axioms,
              grammar_axioms: this.derivedGrammarAxioms,
              hypothesis: userSem,
              pruning: pruneContext,
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

  /** Strict-majority vote, ties resolve false. With a single value (the pruned,
   *  reason-over-one-candidate case) this reduces to just that value. */
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
    pruneContext: boolean
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
        this.documentBuilder.upsertSentenceAnalyses(this.chatDocument, [derived.analysis]);
        this.emitChatDocument();
        if (this.context.length === 0) {
          this.acceptInitialLfgxdrtContext(userMessage, derived);
        } else {
          this.finishLfgxdrtPreparation(userMessage, pruneContext, derived.analysis);
        }
      },
      error: error => {
        console.warn('[Chat] deriving the sentence failed', { sentence: userMessage, error });
        this.pushChatMessage({ text: 'An error occurred during semantic reasoning preparation', sender: 'Bot' });
        this.loading = false;
      }
    });
  }

  private finishLfgxdrtPreparation(
    userMessage: string,
    pruneContext: boolean,
    sentence: SentenceAnalysis,
  ): void {
    const typed = this.turnPreferences().logic_type !== 0;

    const contextIndices = this.activeIndices.length
      ? this.activeIndices.filter(index => index >= 0 && index < this.context.length)
      : this.context.map((_, index) => index);

    // No pruning here (2026-08-20): every reading is appended. Discarding down to one
    // candidate happens exactly once, downstream, inside
    // ReasoningPipelineService.prepareReasoningChecks (`prune: pruneContext` below).
    const newSentenceId = sentence.id;
    console.info('[Chat] Preparing NLI reasoning', {
      sentence: userMessage,
      newSentenceId,
      contextIndices,
      pruneContext,
    });

    // One element per accepted prior reading: a clone of the registered Sentence (turn 2) or
    // Sequence (turn 3+) it extends, so appendSentence resolves its sentences and parses
    // against the registry. Keyed by the element OBJECT, not by elementId: an ambiguous
    // premise contributes several context entries that share one elementId (several READINGS
    // of the same prior element), so a string-keyed map would collapse them and pair the
    // wrong premise semantics with a pair built from a different reading. appendSentence
    // threads the same reference back as `pair.previousElement`.
    const previousContextByElement = new Map<SentenceAnalysis | SequenceAnalysis, { premiseContext: context; semanticAnalysis: SemanticAnalysis }>();
    const previousContexts: SequenceMergePreviousContext[] = contextIndices.map(contextIndex => {
      const premiseContext = this.context[contextIndex];
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
      previousContextByElement.set(element, { premiseContext, semanticAnalysis });
      return { semantic: semanticAnalysis, element };
    });

    // A context that produced no pairs reports why instead of thinning the result silently;
    // surfaced alongside the per-branch failures below.
    let mergeFailures: string[] = [];

    this.documentBuilder.appendSentence({
      previousContexts,
      sentence,
      readings: sentence.semantics,
      knownSentences: this.chatDocument.sentences,
      resolveDrs: this.gswbPreferences.gswbPreferences.resolveDrs,
      ruleString: this.ruleString,
    }).pipe(
      switchMap(result => {
        mergeFailures = result.failures;
        return from(result.pairs).pipe(
        concatMap(pair => {
          const priorElementId = pair.previousElement.id;
          const previousEntry = previousContextByElement.get(pair.previousElement);
          if (!previousEntry) {
            throw new Error(`Merged pair references unknown prior element ${priorElementId}.`);
          }
          const { premiseContext, semanticAnalysis: premiseSemanticAnalysis } = previousEntry;
          // The PRIOR'S READING, not just its element id. GSWB derives every PCDRS id
          // from this scope, so two pairs differing only in which reading of the prior
          // they used produced identical pragmatic ids -- measured in
          // misc/current/chat-document-pronoun-bug3.json: 24 discourse branches sharing
          // only 12 ids, with `pxq-sentence-1-S1-s0-rule-1-pcdrs-1` appearing under both
          // `S0-s0+S1-s0` and `S0-s1+S1-s0`. That breaks the (syn, sem, prag) joint id:
          // a reasoning assignment pointing at a discourseId could not say which
          // semantics produced it. Keying on an elementId where several readings share
          // it is the same hazard as the Map<elementId,...> bug this method already
          // documents above.
          const pairId = `pxq-${priorElementId}-${premiseSemanticAnalysis.semId}`
            + `-${pair.currentSemantic?.semId ?? newSentenceId}`;
          // Chat is the degenerate 1+1 case of the premise/conclusion shape: one prior
          // element, one new sentence. The semantic ids are the readings actually used
          // for this pair, and must be readings the document already registered --
          // validateReasoningUpdate checks that positionally.
          const premiseSemanticIds = [premiseSemanticAnalysis.semId];
          const hypothesisSemanticIds = [pair.currentSemantic?.semId ?? ''];
          const updateId = reasoningUpdateId([priorElementId], [newSentenceId]);
          if (!pair.sequenceStructure) {
            throw new Error(`Merged pair for ${priorElementId} has no sequence structure to reason over.`);
          }
          return this.reasoningPipeline.prepareReasoningChecks({
            scopeId: pairId,
            scope: { updateId, premiseSemanticIds, hypothesisSemanticIds },
            merged: readingOf(pair.merged),
            // The prior: this turn's accepted context entry, which for turn n>1 is
            // already the merged semantics of every earlier turn. That is exactly the
            // "A for A+B, A+B for A+B+C" reading of the context axiom.
            premiseSemantic: premiseContext.semantic,
            sequenceStructure: pair.sequenceStructure,
            premiseAsts: [premiseContext.semanticGraph],
            hypothesisAsts: [pair.currentSemantic?.graph],
            typed,
            prune: pruneContext,
            // Chat shows each reading's DRS in its discourse branches.
            includeSvg: true,
            ruleString: this.pragmaticsRules(),
          }).pipe(map(preparedPair => ({
            priorElementId,
            newSentenceId,
            pairId,
            updateId,
            premiseSemanticIds,
            hypothesisSemanticIds,
            checks: preparedPair.assignments,
            failures: preparedPair.failures,
            degradations: preparedPair.degradations,
            merged: pair.merged,
            syntax: pair.sequenceStructure,
            previousOriginal: premiseContext.original,
          })));
        }),
        toArray()
        );
      })
    ).subscribe({
      next: prepared => {
        const expanded = prepared.flatMap((item: any) =>
          (item.checks ?? []).map((checks: any) => ({ ...item, checks }))
        );
        console.info('[Chat] NLI reasoning bundles prepared', {
          sentence: userMessage,
          bundleCount: prepared.length,
          acceptedCheckCount: expanded.length,
        });
        // A branch that lost its anaphora binding still produces a usable bundle, and a
        // branch that could not be prepared at all just disappears from `expanded`. Neither
        // is visible in the answer that follows, so both are reported here: a partially
        // resolved discourse must never be presented as a cleanly resolved one.
        this.reportUnresolvedBranches(userMessage, prepared, mergeFailures);
        if (!expanded.length) {
          const detail = mergeFailures.length ? ` ${mergeFailures.join(' ')}` : '';
          this.pushChatMessage({
            text: `No consistent continuation could be reasoned over.${detail}`,
            sender: 'Bot',
          });
          this.loading = false;
          return;
        }
        const request: vampireRequest = {
          text: userMessage,
          axioms: this.axioms,
          grammar_axioms: this.derivedGrammarAxioms,
          pruning: pruneContext,
          vampire_preferences: this.turnPreferences(),
          tptp_checks: expanded.map((item: any) => item.checks),
          session_key: this.sessionKey,
          turn_index: this.currentTurnIndex()
        };
        this.dataService.callVampire(request).subscribe({
          next: data => this.handleVampireResponse(
            data,
            userMessage,
            expanded,
            pruneContext
          ),
          error: error => {
            console.warn('[Chat] Vampire request failed', { sentence: userMessage, error });
            this.pushChatMessage({ text: 'An error occurred during the inference process', sender: 'Bot' });
            this.loading = false;
          }
        });
      },
      error: error => {
        console.warn('[Chat] NLI reasoning preparation failed', { sentence: userMessage, error });
        this.pushChatMessage({ text: 'An error occurred during semantic reasoning preparation', sender: 'Bot' });
        this.loading = false;
      }
    });
  }

  /** Records this turn's reasoning in the document, one ReasoningUpdate per
   *  (premise element, hypothesis element) pair.
   *
   *  Chat used to discard everything but the accept/reject decision: the four checks, their
   *  TPTP and the Vampire verdicts lived as method-local rxjs values and were thrown away
   *  once used as a filter. They are a first-class part of the analysis, so they belong in
   *  the document next to the discourse layer -- and the reasoning layer *references* the
   *  DiscourseUpdate whose mapping was used rather than copying the mapping, which is what
   *  keeps a mapping from being re-derived against a duplicated premise context.
   *
   *  Several pairs can share one update: two premise readings x one new sentence are two
   *  assignments of the same premise/hypothesis pair, not two pairs. */
  private upsertReasoningUpdates(
    prepared: any[],
    verdictFor: (item: any, index: number) => any,
    pruneContext: boolean
  ): void {
    const updates = new Map<string, ReasoningUpdate>();

    prepared.forEach((item, index) => {
      const assignmentId = item?.checks?.assignmentId;
      const updateId = item?.updateId;
      if (!assignmentId || !updateId || !item.priorElementId || !item.newSentenceId) {
        return;
      }

      if (!updates.has(updateId)) {
        updates.set(updateId, {
          id: updateId,
          premiseElementIds: [item.priorElementId],
          hypothesisElementIds: [item.newSentenceId],
          sourceElementId: compositeAnalysisId([item.priorElementId, item.newSentenceId]),
          sourceElementKind: 'sequence',
          // Same source the TPTP itself was built from, not GSWB's output style.
          logicType: this.turnPreferences().logic_type === 0 ? 'fof' : 'tff',
          ruleString: this.pragmaticsRules(),
          pruned: pruneContext,
          assignments: [],
          createdAt: new Date().toISOString(),
        });
      }
      const update = updates.get(updateId)!;
      if (update.assignments.some(existing => existing.id === assignmentId)) {
        return;
      }

      // Only link the discourse branch when it was actually stored. A branch whose context
      // Vampire rejected never became a DiscourseAnalysis, and pointing at one that does
      // not exist fails validation -- correctly, since the pointer would be a lie.
      const discourseUpdateId = `du-${compositeAnalysisId([item.priorElementId, item.newSentenceId])}`;
      const discourseId = item.checks?.mappingId;
      const linked = (this.chatDocument.discourseUpdates ?? []).some(du =>
        du.id === discourseUpdateId && du.discourse.some(branch => branch.id === discourseId));

      const check = verdictFor(item, index);
      update.assignments.push({
        id: assignmentId,
        premiseSemanticIds: item.premiseSemanticIds ?? [],
        hypothesisSemanticIds: item.hypothesisSemanticIds ?? [],
        ruleBranchIndex: item.checks?.ruleBranchIndex ?? 1,
        discourseUpdateId: linked ? discourseUpdateId : undefined,
        discourseId: linked ? discourseId : undefined,
        contextTptp: item.checks?.contextTptp ?? '',
        contextSemanticId: item.merged?.id,
        checks: item.checks?.checks,
        // A degraded bundle is still usable and still gets a verdict, so the only thing
        // that keeps it distinguishable from a cleanly resolved one is saying so here.
        ...(item.checks?.degradations?.length ? { degradations: item.checks.degradations } : {}),
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

    console.info('[Chat] reasoning updates written', {
      updateCount: updates.size,
      assignmentCount: [...updates.values()].reduce((sum, update) => sum + update.assignments.length, 0),
      storedUpdateCount: (this.chatDocument.reasoningUpdates ?? []).length,
      updates: [...updates.values()].map(update => ({
        id: update.id,
        logicType: update.logicType,
        verdict: update.verdict?.label,
        assignments: update.assignments.map(assignment => ({
          id: assignment.id,
          checks: Object.keys(assignment.checks ?? {}).length,
          contextTptpLength: (assignment.contextTptp ?? '').length,
          discourseId: assignment.discourseId,
          verdict: assignment.verdict
            && [assignment.verdict.consistent, assignment.verdict.informative, assignment.verdict.relevant],
        })),
      })),
    });
  }

  /** Names the branches that were dropped or only partially resolved, in the chat itself.
   *  The reasons come from ReasoningPipelineService and name the mapping and the item that
   *  failed, so a degraded answer can be traced back to the referent that did not bind. */
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
    if (!dropped.length && !degraded.length && !mergeFailures.length) {
      return;
    }

    console.warn('[Chat] some reasoning branches were not fully resolved',
      { sentence: userMessage, dropped, degraded, mergeFailures });

    const parts: string[] = [];
    if (mergeFailures.length) {
      parts.push(`${mergeFailures.length} discourse context(s) could not be merged at all`);
    }
    if (degraded.length) {
      parts.push(`${degraded.length} branch(es) were reasoned over with unresolved pronouns`);
    }
    if (dropped.length) {
      parts.push(`${dropped.length} branch(es) could not be prepared at all`);
    }
    const reasons = [...mergeFailures, ...degraded, ...dropped];
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
          branchLabels.push(`${mapping.id} — ${bound}`);
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

        if (update.discourse.length) {
          console.info('[Chat] turn 1 post-processing complete', {
            sentenceId,
            readings: results.length,
            discourseBranches: update.discourse.length,
            anaphoraResolvedCount: update.discourse.filter(item => item.collapsed).length,
            renderedBranches: branchSolutions.length,
          });
          this.upsertDiscourseUpdate(update);
          if (message) this.refreshBranchRanking(message);
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
    prepared: any[] = [],
    pruneContext = false
  ): void {
    this.clearSelected();
    const mappings = Object.values(vampData.context_checks_mapping ?? {}) as any[];
    const glyphs = mappings
      .map(item => item?.glyph)
      .filter((glyph): glyph is string => typeof glyph === 'string' && glyph.trim().length > 0);
    const consistent = mappings.length ? this.majorityVote(mappings.map(item => !!item.consistent)) : null;
    const informative = mappings.length ? this.majorityVote(mappings.map(item => !!item.informative)) : null;
    const relevant = mappings.length ? this.majorityVote(mappings.map(item => !!item.relevant)) : null;
    // Vampire echoes each bundle's assignment id back on its verdict, so a verdict is
    // paired with the branch it was computed for rather than with whatever sits at the
    // same array index. Position still works when every bundle survives, but stops being
    // identity the moment one is filtered out.
    const verdictByAssignment = new Map<string, any>();
    mappings.forEach(check => {
      const id = check?.assignment_id;
      if (id) verdictByAssignment.set(id, check);
    });
    const verdictFor = (item: any, index: number) => {
      const id = item?.checks?.assignmentId;
      return (id && verdictByAssignment.get(id)) ?? mappings[index];
    };
    const newContext = prepared.length
      ? this.contextFromLfgxdrtChecks(prepared, mappings, userMessage, pruneContext, verdictFor)
      : (vampData.context ?? []);
    if (prepared.length) {
      // After contextFromLfgxdrtChecks, so the DiscourseUpdates an assignment points at
      // already exist -- validateReasoningUpdate requires both hops to resolve.
      this.upsertReasoningUpdates(prepared, verdictFor, pruneContext);
    }
    console.info('[Chat] Vampire verdict (lfgxdrt)', {
      sentence: userMessage,
      consistent, informative, relevant,
      mappingCount: mappings.length,
      survivingContextCount: newContext.length,
    });
    this.context = newContext;
    this.history.push(newContext);
    this.historyChange.emit(this.history);
    this.changeDetector.detectChanges();
    const message = this.verdictMessage(consistent, informative, relevant);
    const safeGlyphs = glyphs.map(glyph => this.sanitizer.bypassSecurityTrustHtml(glyph));
    // The pills describe what THIS turn reasoned over -- every branch sent to Vampire,
    // accepted or not -- so they are built from `prepared`, not from the carried-forward
    // context. Those are different things: the context is one entry per surviving reading
    // (2 here), which can never account for the 72 bundles that were actually checked.
    const branches = prepared.length ? this.branchDetail(prepared, verdictFor) : null;
    if (this.lastTurn) {
      this.lastTurn.branches = prepared.length;
      this.lastTurn.survivingReadings = newContext.length;
    }
    const semantic = branches
      ? ''
      : newContext.map((item: context) => item.semantic || item.prolog_drs).filter(Boolean).join('\n');
    this.pushChatMessage({
      text: message,
      sender: 'Bot',
      glyphs,
      safeGlyphs,
      glyphGridSize: Math.max(1, Math.ceil(Math.sqrt(glyphs.length))),
      semanticText: semantic,
      detailText: branches ? branches.tptp : newContext.map((item: context) => item.tptp).filter(Boolean).join('\n'),
      branchSolutions: branches?.solutions,
      branchLabels: branches?.labels,
    });
    this.loading = false;
  }

  /** The turn's branches, formatted for the TPTP and DRS pills.
   *
   *  Every branch appears, rejected ones included: they are the ones most worth inspecting,
   *  and a pill whose entry count no longer matches the number of checks run is how a
   *  fan-out bug hides. A branch that produced no TPTP says so rather than being filtered
   *  out -- an empty translation is exactly the case that must stay visible. */
  private branchDetail(
    prepared: any[],
    verdictFor: (item: any, index: number) => any
  ): { tptp: string; solutions: GswbSolution[]; labels: string[] } {
    const solutions: GswbSolution[] = [];
    const labels: string[] = [];
    const blocks: string[] = [];

    prepared.forEach((item, index) => {
      const verdict = verdictFor(item, index);
      const marks = [
        verdict?.consistent ? 'consistent' : 'inconsistent',
        verdict?.informative ? 'informative' : 'uninformative',
        verdict?.relevant ? 'relevant' : 'irrelevant',
      ].join(', ');
      const id = item.checks?.mappingId ?? item.checks?.assignmentId ?? `branch-${index + 1}`;
      const label = `${id} — ${marks}`;

      blocks.push(`% ${label}\n${item.checks?.sequenceTptp || '% (no TPTP produced for this branch)'}`);

      const mapping = item.checks?.mapping;
      if (mapping?.solution) {
        solutions.push(mapping as GswbSolution);
        labels.push(label);
      }
    });

    return { tptp: blocks.join('\n\n'), solutions, labels };
  }

  private contextFromLfgxdrtChecks(
    prepared: any[],
    checks: any[],
    userMessage: string,
    pruneContext: boolean,
    verdictFor: (item: any, index: number) => any = (_item, index) => checks[index]
  ): context[] {
    // One entry per distinct reading, not per surviving assignment. A turn's rule
    // branches and PCDRS mappings are a DiscourseUpdate *of that turn*: they annotate one
    // merged reading, they are not new readings. What carries forward is syntax +
    // semantics, and the next turn re-derives the anaphora binding over the whole merged
    // discourse (turn 3's mappings rebind turn 2's pronouns as well as its own), so
    // carrying each branch forward as its own prior re-runs that enumeration once per
    // branch: turn 3 sent 24 x 36 = 864 bundles where 2 x 36 = 72 was the branch count,
    // and turn 4 would have multiplied by 72 again.
    const next: context[] = [];
    // Every distinct reading that actually produced a merged result, regardless of
    // Vampire's verdict -- this is what gets registered as a Sequence/DiscourseUpdate
    // (see the loop below). Kept separate from `next` (which is filtered to
    // consistent&&informative readings, for carrying the discourse forward) because a
    // ReasoningUpdate's `sourceElementId` must resolve to a registered Sequence even when
    // the turn concluded "consistent but not informative" -- a proven entailment, exactly
    // what the modus-ponens benchmark's own 3rd turn tests -- or inconsistent. Before this
    // split, such a turn's sequence was never registered (only informative readings fed
    // `upsertSequenceFromContexts`), so `validateReasoningUpdate` rejected the update
    // outright with "reasoning update rejected by document invariants" (confirmed live:
    // Vampire correctly returned consistent:true/informative:false for "A Scandinavian won
    // a Nobel prize" after its two entailing premises, but the update pointing at that
    // reasoning was silently dropped because nothing had registered what it pointed at).
    const registeredEntries: context[] = [];
    const readingKeys = new Map<string, context>();
    const acceptedReadingKeys = new Set<string>();
    let acceptedAssignments = 0;
    // The PCDRS readings of each sequence. One sequence's contexts routinely span several
    // merged semantic ids; each reading keeps its own as `semanticOrigin`.
    const groups = new Map<string, PcdrsReading[]>();

    prepared.forEach((item, index) => {
      const check = verdictFor(item, index);
      if (!item.merged || !readingOf(item.merged).semString) return;
      const reading = readingOf(item.merged);

      const priorElementId = item.priorElementId;
      if (!priorElementId || !item.newSentenceId) return;

      const sequenceId = compositeAnalysisId([priorElementId, item.newSentenceId]);
      const semId = item.merged.id || sequenceId;

      // The same identity upsertSequenceFromContexts() dedupes on with its semanticsById
      // and syntaxById maps, so this list and the document's SequenceAnalysis agree by
      // construction instead of by coincidence. Every assignment of one pair carries the
      // identical `merged` (expanded is built as {...item, checks}), so the first one to
      // pass supplies the entry and the rest only add their branch to the groups below.
      // Syntax is part of the key: two readings that agree semantically but come from
      // different parses are two distinct discourse states, and the history shows both.
      const readingKey = [
        sequenceId,
        reading.syntacticOrigin ?? '',
        reading.semId ?? semId,
      ].join('::');
      const isAccepted = !!(check?.consistent && check?.informative);
      const existingEntry = readingKeys.get(readingKey);
      // The first ACCEPTED branch supplies the entry when one exists for this reading;
      // a not-yet-accepted branch registers a fallback entry only so a reading with no
      // accepted branch at all (e.g. a proven entailment, informative:false throughout)
      // still has something for upsertSequenceFromContexts to register below -- see
      // `registeredEntries`. Once an accepted branch has supplied the entry, later
      // branches (accepted or not) never overwrite it.
      if (!existingEntry || (isAccepted && !acceptedReadingKeys.has(readingKey))) {
        const entry = {
          original: `${item.previousOriginal ?? ''} ${userMessage}`.trim(),
          prolog_drs: reading.semString,
          prolog_fol: '',
          // The whole merged sequence, not the branch's context axiom: this entry becomes
          // the NEXT turn's prior, and `contextTptp` is now the prior of *this* turn.
          // Display-only on this path -- the next turn's context axiom is built from
          // `semantic` below, via prepareReasoningChecks' premiseSemantic.
          tptp: item.checks?.sequenceTptp ?? '',
          box: reading.svg ?? '',
          semantic: reading.semString,
          semanticGraph: reading.graph,
          syntax: item.syntax,
          semanticAnalysis: reading,
          synSemMapping: item.merged.synSemMapping,
          elementId: sequenceId,
        } as context;
        readingKeys.set(readingKey, entry);
        if (existingEntry) {
          const existingIndex = registeredEntries.indexOf(existingEntry);
          if (existingIndex !== -1) {
            registeredEntries[existingIndex] = entry;
          } else {
            registeredEntries.push(entry);
          }
        } else {
          registeredEntries.push(entry);
        }
        if (isAccepted) {
          acceptedReadingKeys.add(readingKey);
        }
      }

      // Carrying a reading forward as the next turn's context is still gated on the
      // verdict -- a proven entailment or an inconsistent branch legitimately shouldn't
      // extend the discourse -- but that decision no longer controls whether the
      // reasoning that already ran gets registered (see `registeredEntries` above).
      if (isAccepted) {
        acceptedAssignments++;
        const entry = readingKeys.get(readingKey)!;
        if (!next.includes(entry)) {
          next.push(entry);
        }
      }

      // GSWB's PCDRS solution, whose id identifies the anaphora branch -- exactly what a
      // reasoning assignment needs to point at. Two pairs that share a semantic id but come
      // from different premise contexts stay distinct entries even when both are rule
      // branch 1.
      const readings = groups.get(sequenceId) ?? [];
      readings.push({
        mapping: item.checks?.mapping,
        ruleBranchIndex: item.checks?.ruleBranchIndex ?? 1,
        semanticOrigin: semId,
        semString: reading.semString,
      });
      groups.set(sequenceId, readings);
    });

    // Said out loud: the fold is what keeps the next turn's work proportional to its own
    // branch count, so a run where it collapses much more (or much less) than expected is
    // the signal that the branching upstream changed shape.
    console.info('[Chat] Discourse readings carried forward', {
      acceptedAssignments,
      readingsKept: next.length,
      discourseBranches: [...groups.values()].reduce((sum, readings) => sum + readings.length, 0),
    });

    const bySequence = new Map<string, context[]>();
    registeredEntries.forEach(entry => {
      const list = bySequence.get(entry.elementId!) ?? [];
      list.push(entry);
      bySequence.set(entry.elementId!, list);
    });
    bySequence.forEach((entries, sequenceId) => this.upsertSequenceFromContexts(sequenceId, entries));
    groups.forEach((readings, sequenceId) => {
      if (!readings.length) return;
      this.upsertDiscourseUpdate(discourseUpdateOf(
        { id: sequenceId, kind: 'sequence' }, readings, this.pragmaticsRules()));
    });

    return pruneContext ? next.slice(0, 1) : next;
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
    const previous = this.chatDocument.discourseUpdates?.find(existing => existing.id === update.id);
    const rankers = this.anaphoraRankers();
    const stored = carryAnaphoraRanking(previous, update, rankers);
    this.storeDiscourseUpdate(stored);
    if (needsAnaphoraRanking(stored, rankers)) {
      this.rankDiscourseUpdate(stored);
    }
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

  /** Stored first, ranked afterwards, never waited on: the turn is complete without it. */
  private rankDiscourseUpdate(update: DiscourseUpdate): void {
    this.anaphoraRanking.rankAndAttach(() => this.chatDocument, update, this.anaphoraRankers()).subscribe(({ update: ranked }) => {
      if (!ranked) return;
      // Stored as lm answered, never re-requested on its account: a ranking that does not match
      // what was asked (an older lm) would otherwise be requested again forever.
      this.storeDiscourseUpdate(ranked);
      this.chatHistory.forEach(message => this.refreshBranchRanking(message));
      this.changeDetector.detectChanges();
    });
  }

  /** What each message's DRS pill orders and filters its branches with (N4): the discourse
   *  updates its branches belong to. Kept here, not on the message, and replaced only when the
   *  updates change, so the pill gets a new one only then. */
  readonly readingOrders = new Map<ChatMessage, ReadingOrderContext>();

  /** Captions a message's DRS branches with the ranking of the discourse update each belongs
   *  to, and gives its pill the reading order. The branches keep their generation order: the
   *  pill's sem view orders them by its options. */
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
    this.readingOrders.set(message, {
      updates,
      discriminants: this.chatDocument.sentences.flatMap(sentence => sentence.discriminants ?? []),
      averager: this.anaphoraRankers().averager,
    });

    const updateOf = (id: string) => updates.find(update => update.discourse.some(reading => reading.id === id));
    message.branchLabels = original.solutions.map((solution, index) => {
      const update = updateOf(solution.id);
      const caption = update ? anaphoraRankingCaption(update, solution.id) : '';
      return [original!.labels[index], caption].filter(Boolean).join(' · ');
    });
    message.branchRankings = original.solutions.map(solution => {
      const update = updateOf(solution.id);
      return update ? anaphoraRankingTable(update, solution.id) : null;
    });
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
