import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { DataService } from '../../data.service';
import {
  AnaphoraMappingModel,
  ChatMessage,
  context,
  DiscourseAnalysis,
  DiscourseUpdate,
  GswbRequest,
  GswbSolution,
  ReasoningUpdate,
  GswbSemanticMergePart,
  LigerStructure,
  LigerWebGraph,
  SemanticAnalysis,
  SequenceAnalysis,
  SyntacticAnalysis,
  vampireRequest,
  XlePlusGlueDocument
} from '../../models/models';
import { GswbSettingsComponent } from '../../gswb-vis/gswb-settings/gswb-settings.component';
import { DomSanitizer } from '@angular/platform-browser';
import { InferenceSettingsComponent } from '../../inference-interface/inference-settings/inference-settings.component';
import { catchError, concatMap, forkJoin, from, map, mergeMap, of, switchMap, toArray } from 'rxjs';
import { APP_DEFAULTS, isLfgxdrtPreferences } from '../../app-defaults';
import {
  compositeAnalysisId,
  discourseStructureId,
  majorityVerdict,
  reasoningUpdateId,
  validateAnalysisDocument,
  validateReasoningUpdate
} from '../../analysis-model';
import { ReasoningPipelineService } from '../../reasoning/reasoning-pipeline.service';


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
    private reasoningPipeline: ReasoningPipelineService
  ) {}

  @ViewChild('contextPruning') contextPruning!: ElementRef;

  @Input() ruleString: string = '';
  @Input() gswbPreferences: GswbSettingsComponent;
  @Input() vampirePreferences: InferenceSettingsComponent;

  @Input() history: context[][] = [];  // Received from parent
  @Output() historyChange = new EventEmitter<context[][]>(); // Event to notify updates

  @Input() axioms: string = '';
  @Output() axiomsChanged = new EventEmitter<string>(); // Event to notify updates to axioms

  @Input() activeIndices: number[] = [];
  @Output() clearSelection: EventEmitter<void> = new EventEmitter<void>();  // Event to clear selection

  @Input() chatDocument: XlePlusGlueDocument = ChatComponent.emptyChatDocument();
  @Output() chatDocumentChange = new EventEmitter<XlePlusGlueDocument>();

  chatHistory: ChatMessage[] = []; // Stores chat messages
  userInput: string = ''; // Stores user input
  meaningConstructors: string = '';

  axiomCounter = 0;

  // needs to be updated as chat goes on
  context: context[] = [];

  loading: boolean = false; // Tracks whether the bot is responding

  static emptyChatDocument(): XlePlusGlueDocument {
    return { id: '', semanticType: 'lfgxdrt', sentences: [], sequences: [], elements: [] };
  }

  /** Resets in-flight conversation state for a fresh session. The chatDocument itself is
   *  reset/replaced by the parent (it owns the session key/persistence lifecycle). */
  resetConversationState(): void {
    this.context = [];
    this.chatHistory = [];
    this.userInput = '';
  }

  sendMessage() {
    if (!this.userInput.trim()) return;

    this.loading = true; // Show loading indicator
    const userMessage = this.userInput;

    // Add user message to history
    this.chatHistory.push({ text: userMessage, sender: 'User' });

    // If logicType is 0 create string 'fof' if 1 create string 'tff'
    const logicType = this.vampirePreferences.vampirePreferences.logic_type === 0 ? 'fof' : 'tff';

    const ligerRequest = { sentence: userMessage, ruleString: this.ruleString, logicType: logicType };

    this.dataService.ligerAnnotate(ligerRequest).subscribe({
      next: data => {
        const selectedSolution = data.solutions?.find((solution: any) =>
          Array.isArray(solution?.graph?.graphElements) && solution.graph.graphElements.length > 0)
          ?? data.solutions?.[0];

        if (!selectedSolution || !selectedSolution.graph?.graphElements?.length) {
          console.info('[Chat] LiGER parse failed', { sentence: userMessage });
          this.chatHistory.push({ text: 'Syntactic analysis failed for this input!', sender: 'Bot' });
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

        if (Array.isArray(selectedSolution.axioms) && selectedSolution.axioms.length > 0) {
          let extractedAxioms = '';
          for (const axiom of selectedSolution.axioms) {
            if (axiom.trim() !== '' && !this.axioms.includes(axiom.trim())) {
              extractedAxioms += `${logicType}(axiom${this.axiomCounter},axiom,${axiom}).\n`;
              this.axiomCounter++;
            }
          }

          if (extractedAxioms.trim() !== '') {
            if (this.axioms !== '') {
              this.axioms += '\n';
            }
            this.updateAxioms(this.axioms + extractedAxioms + '\n');
          }
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
              this.chatHistory.push({ text: 'No semantic analyses found for this input!', sender: 'Bot' });
              this.loading = false;
              return;
            }

            const useLfgxDrt = isLfgxdrtPreferences(this.gswbPreferences.gswbPreferences);
            console.info('[Chat] GSWB deduce succeeded', {
              sentence: userMessage,
              solutionCount: gswbData.solutions.length,
              useLfgxDrt,
              turn: this.context.length === 0 ? 1 : this.context.length + 1,
            });
            const userSem = gswbData.solutions
              .map(x => useLfgxDrt ? (x.semantic || x.solution) : x.solution)
              .join('\n');
            const pruneContext = this.contextPruning.nativeElement.checked;

            // The document's semantic type is fixed once, at document creation -- a
            // conversation cannot silently switch semantic type mid-thread, since
            // sequencing (and this whole reasoning path) is lfgxdrt-only.
            if (useLfgxDrt) {
              this.prepareLfgxdrtSolutions(userMessage, selectedSolution, data.solutions,
                gswbData.solutions, pruneContext);
              return;
            }

            const vampRequest: vampireRequest = {
              text: userMessage,
              context: this.context,
              axioms: this.axioms,
              hypothesis: userSem,
              pruning: pruneContext,
              active_indices: this.activeIndices,
              vampire_preferences: this.vampirePreferences.vampirePreferences
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

                  this.chatHistory.push({
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
                this.chatHistory.push({ text: 'An error occurred during the inference process', sender: 'Bot' });
                this.loading = false;
              }
            });
          },
          error: () => {
            this.chatHistory.push({ text: 'An error occurred during the semantic analysis', sender: 'Bot' });
            this.loading = false;
          }
        });
      },
      error: () => {
        this.chatHistory.push({ text: 'An unknown error occurred.', sender: 'Bot' });
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

  private prepareLfgxdrtSolutions(
    userMessage: string,
    ligerSolution: any,
    ligerSolutions: any[],
    solutions: any[],
    pruneContext: boolean
  ): void {
    const candidates = solutions.filter(solution =>
      typeof (solution.semantic || solution.solution) === 'string'
      && solution.graph).map(solution => ({
        solution,
        syntax: ligerSolutions.find(item => item.solutionKey === solution.solutionKey)?.structureJson
          ?? ligerSolution.structureJson
      }));

    // The first sentence follows the analysis workflow. There is no PxQ yet,
    // so do not run NLI rules, PCDRS generation, or anaphora collapse.
    if (this.context.length === 0) {
      // Turn 1's syntax/semantics are sourced via ligerSequence (a one-sentence sequence),
      // matching the analysis workflow's LigerVisComponent.analyzeSentence() -- which always
      // parses through /apply_rules_xle_sequence, never /apply_rules_xle, even for the very
      // first sentence -- rather than the independent /apply_rules_xle parse
      // (candidates/syntax above are built from). This keeps LiGER's own solution-key
      // numbering ("S0", "S1", ...) consistent across the whole conversation -- see the longer
      // explanation in finishLfgxdrtPreparation() below, where reusing an independently-parsed
      // structure for a later turn's new sentence was the actual root cause of chat's silent
      // anaphora-resolution failures.
      const typed = this.vampirePreferences.vampirePreferences.logic_type !== 0;
      this.dataService.ligerSequence({
        sentences: [userMessage],
        sentenceIds: ['sentence-1'],
        ruleString: this.ruleString,
        logicType: typed ? 'tff' : 'fof'
      }).pipe(
        switchMap(sequence => this.calculateSequencePartSemantics(sequence).pipe(
          map(currentSolutions => ({
            currentSolutions,
            syntax: sequence?.solutions?.[0]?.structureJson
          }))
        ))
      ).subscribe({
        next: ({ currentSolutions, syntax }) => {
          console.info('[Chat] Turn 1 sequence-sourced semantics ready', {
            sentence: userMessage,
            solutionCount: currentSolutions.length,
            solutionKeys: currentSolutions.map((solution: any) => solution.solutionKey),
          });
          this.acceptInitialLfgxdrtContext(
            userMessage,
            currentSolutions.map(solution => ({ ...solution, syntax })),
            ligerSolutions);
        },
        error: error => {
          console.warn('[Chat] Turn 1 sequence-sourced semantics failed', { sentence: userMessage, error });
          this.chatHistory.push({ text: 'An error occurred during semantic reasoning preparation', sender: 'Bot' });
          this.loading = false;
        }
      });
      return;
    }

    this.finishLfgxdrtPreparation(
      userMessage,
      candidates.map(candidate => ({ ...candidate.solution, syntax: candidate.syntax })),
      pruneContext,
      ligerSolution.structureJson,
      ligerSolutions
    );
  }

  private finishLfgxdrtPreparation(
    userMessage: string,
    solutions: any[],
    pruneContext: boolean,
    syntax: any,
    ligerSolutions: any[] = []
  ): void {
    const semanticSolutions = solutions.filter(solution =>
      typeof solution?.semantic === 'string' && solution.semantic.trim().length > 0);
    if (!semanticSolutions.length) {
      this.chatHistory.push({ text: 'No post-processed semantic analyses found.', sender: 'Bot' });
      this.loading = false;
      return;
    }

    const typed = this.vampirePreferences.vampirePreferences.logic_type !== 0;

    let contextIndices = this.activeIndices.length
      ? this.activeIndices.filter(index => index >= 0 && index < this.context.length)
      : this.context.map((_, index) => index);
    let candidateSolutions = semanticSolutions;

    // Pruning = pick one solution and only reason over it. The reduction happens here,
    // before any LiGER/GSWB/Vampire work is done, not after computing everything and
    // discarding the rest -- picking "first" is provisional, refine later.
    if (pruneContext) {
      contextIndices = contextIndices.slice(0, 1);
      candidateSolutions = candidateSolutions.slice(0, 1);
    }

    const newSentenceId = this.registerSentence(userMessage, candidateSolutions, ligerSolutions);
    console.info('[Chat] Preparing NLI reasoning', {
      sentence: userMessage,
      newSentenceId,
      contextIndices,
      candidateCount: candidateSolutions.length,
      pruneContext,
    });

    // Every (contextIndex, candidateSolution) pair used to be processed as an independently
    // subscribed, fully concurrent "bundle" (pushed into an array and joined with
    // forkJoin(bundles)). With more than one accepted context reading (e.g. an ambiguous
    // premise like "a man saw a man"), that ran two /apply_rules_xle_sequence calls (and
    // everything downstream) at the same time. In testing, one of the two concurrent
    // sequence$ HTTP calls would reliably get a real 200 response at the network level
    // (confirmed via the Performance API) but its Angular HttpClient Observable would never
    // emit next/error/complete to its subscriber -- forkJoin(bundles) then waits forever on
    // that pair, the loading spinner never clears, and Vampire is never called. This
    // reproduced with a live-verified, isolated case and is not specific to request volume.
    // Processing pairs sequentially via concatMap avoids ever having two of these chains
    // in flight at once, sidestepping the issue entirely.
    interface PairSpec {
      contextIndex: number;
      premiseContext: context;
      priorElementId: string;
      contextSyntax: any;
      hypothesisSyntax: any;
      solution: any;
      hypothesisIndex: number;
      pairId: string;
    }
    const pairSpecs: PairSpec[] = [];
    contextIndices.forEach(contextIndex => {
      const premiseContext = this.context[contextIndex];
      const contextSyntax = premiseContext?.syntax;
      const priorElementId = premiseContext?.elementId;
      if (!contextSyntax || !priorElementId) {
        throw new Error('Accepted context syntax and document element id are required for sequence merging.');
      }
      candidateSolutions.forEach((solution, hypothesisIndex) => {
        const pairId = `pxq-${contextIndex + 1}-${solution.id || hypothesisIndex + 1}`;
        // The new sentence's own parsed structure, paired to this semantic reading by
        // solutionKey -- supplied to the sequence call as the second operand.
        const hypothesisSyntax = ligerSolutions
          .find(item => item.solutionKey === solution.solutionKey)?.structureJson ?? syntax;
        pairSpecs.push({
          contextIndex, premiseContext, priorElementId, contextSyntax,
          hypothesisSyntax, solution, hypothesisIndex, pairId,
        });
      });
    });

    const processPair = ({ contextIndex, premiseContext, priorElementId, contextSyntax,
                           hypothesisSyntax, solution, pairId }: PairSpec) => {
      // Sequence + sentence: both operands are supplied as already-parsed structures, so
      // LiGER skips XLE entirely and SequenceGraphAssembler merges them directly, rebasing
      // the new sentence's SYN-ID/SRC ids onto the sequence's numbering.
      //
      // This must supply a structure for BOTH slots. The endpoint only takes the
      // supplied-structures path when parsedSentences.size() == sentences.size(); passing
      // just the premise's structure silently fell through to re-parsing, and since the
      // premise text is the whole accumulated discourse ("a man saw a man he saw him"),
      // XLE could not parse it as one sentence and contributed nothing -- turn 3's syntax
      // was only the new sentence, leaving earlier pronouns with no anchor to be
      // re-resolved against.
      //
      // Reusing the new sentence's own parse here is safe now that the assembler numbers
      // part provenance positionally. It previously kept whatever SOLUTION-KEY a supplied
      // structure arrived with -- always S0 for an independent parse -- so it collided
      // with the premise's own S0 and the pronoun-binding rules could not tell the parts
      // apart. Verified equivalent to merging all sentences at once: same constraint
      // count, same SYN-ID count, same [S0, S1, S2] keys.
      const sequence$ = this.dataService.ligerSequence({
        sentences: [premiseContext.original, userMessage],
        sentenceIds: [`${pairId}-sentence-1`, `${pairId}-sentence-2`],
        ruleString: this.ruleString,
        logicType: typed ? 'tff' : 'fof',
        parsedSentences: [[contextSyntax], [hypothesisSyntax]]
      });
      return sequence$.pipe(
        switchMap(sequence => this.calculateSequencePartSemantics(sequence).pipe(
          map(currentSolutions => ({
            currentSolutions,
            syntax: sequence?.solutions?.[0]?.structureJson ?? syntax
          }))
        )),
        mergeMap(({ currentSolutions, syntax: mergedSyntax }) => from(currentSolutions).pipe(
          switchMap(currentSolution => this.dataService.gswbMergeSequenceSemantics({
            parts: [
              this.semanticPart(premiseContext.semanticAnalysis, premiseContext.semantic, priorElementId),
              this.semanticPart(currentSolution.semanticAnalysis ?? solution.semanticAnalysis,
                currentSolution.semantic, newSentenceId)
            ],
            parentSolutionId: pairId,
            solutionKey: currentSolution.solutionKey,
            mcSetId: currentSolution.mcSetId,
            resolveDrs: this.gswbPreferences.gswbPreferences.resolveDrs
          }).pipe(map(merged => ({ merged, currentSolution })))),
          switchMap(({ merged, currentSolution }) => {
            // Chat is the degenerate 1+1 case of the premise/conclusion shape: one prior
            // element, one new sentence. The semantic ids are the readings actually used
            // for this pair, and must be readings the document already registered --
            // validateReasoningUpdate checks that positionally.
            const premiseSemanticIds = [premiseContext.semanticAnalysis?.semId ?? ''];
            const hypothesisSemanticIds = [
              (currentSolution.semanticAnalysis ?? solution.semanticAnalysis)?.semId ?? ''];
            const updateId = reasoningUpdateId([priorElementId], [newSentenceId]);
            return this.reasoningPipeline.prepareReasoningChecks({
              scopeId: pairId,
              scope: { updateId, premiseSemanticIds, hypothesisSemanticIds },
              merged,
              // The prior: this turn's accepted context entry, which for turn n>1 is
              // already the merged semantics of every earlier turn. That is exactly the
              // "A for A+B, A+B for A+B+C" reading of the context axiom.
              premiseSemantic: premiseContext.semantic,
              sequenceStructure: mergedSyntax,
              premiseAsts: [premiseContext.semanticGraph],
              hypothesisAsts: [currentSolution.graph],
              typed,
              prune: pruneContext
            }).pipe(map(pair => ({
              contextIndex,
              priorElementId,
              newSentenceId,
              pairId,
              updateId,
              premiseSemanticIds,
              hypothesisSemanticIds,
              checks: pair.assignments,
              failures: pair.failures,
              degradations: pair.degradations,
              merged,
              syntax: mergedSyntax
            })));
          })
        ))
      );
    };

    from(pairSpecs).pipe(
      concatMap(spec => processPair(spec)),
      toArray()
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
        this.reportUnresolvedBranches(userMessage, prepared);
        if (!expanded.length) {
          this.chatHistory.push({ text: 'No consistent continuation could be reasoned over.', sender: 'Bot' });
          this.loading = false;
          return;
        }
        const request: vampireRequest = {
          text: userMessage,
          axioms: this.axioms,
          pruning: pruneContext,
          vampire_preferences: this.vampirePreferences.vampirePreferences,
          tptp_checks: expanded.map((item: any) => item.checks)
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
            this.chatHistory.push({ text: 'An error occurred during the inference process', sender: 'Bot' });
            this.loading = false;
          }
        });
      },
      error: error => {
        console.warn('[Chat] NLI reasoning preparation failed', { sentence: userMessage, error });
        this.chatHistory.push({ text: 'An error occurred during semantic reasoning preparation', sender: 'Bot' });
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
          logicType: this.vampirePreferences.vampirePreferences.logic_type === 0 ? 'fof' : 'tff',
          ruleString: APP_DEFAULTS.graphInspector.rulesText,
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
  private reportUnresolvedBranches(userMessage: string, prepared: any[]): void {
    const dropped: string[] = prepared.flatMap(item => item?.failures ?? []);
    const degraded: string[] = prepared.flatMap(item => item?.degradations ?? []);
    if (!dropped.length && !degraded.length) {
      return;
    }

    console.warn('[Chat] some reasoning branches were not fully resolved',
      { sentence: userMessage, dropped, degraded });

    const parts: string[] = [];
    if (degraded.length) {
      parts.push(`${degraded.length} branch(es) were reasoned over without their anaphora binding`);
    }
    if (dropped.length) {
      parts.push(`${dropped.length} branch(es) could not be prepared at all`);
    }
    const reasons = [...degraded, ...dropped];
    const shown = reasons.slice(0, 3).join('; ');
    const remainder = reasons.length > 3 ? ` (and ${reasons.length - 3} more)` : '';
    this.chatHistory.push({
      text: `Note: ${parts.join(' and ')}. ${shown}${remainder}`,
      sender: 'Bot'
    });
  }

  private semanticPart(semanticAnalysis: SemanticAnalysis | undefined, fallbackSemantic: string,
                        sentenceId: string): GswbSemanticMergePart {
    return {
      id: semanticAnalysis?.semId,
      sentenceId,
      solutionId: semanticAnalysis?.semId,
      syntacticOrigin: semanticAnalysis?.syntacticOrigin,
      semantic: semanticAnalysis?.semString || fallbackSemantic || '',
      graph: semanticAnalysis?.graph,
    };
  }

  private calculateSequencePartSemantics(sequence: any): import('rxjs').Observable<any[]> {
    const sequenceSolution = sequence?.solutions?.[0];
    const parts = Array.isArray(sequenceSolution?.sequenceParts)
      ? sequenceSolution.sequenceParts
      : [];
    const currentPart = parts[parts.length - 1];
    if (!currentPart?.meaningConstructors?.trim()) {
      throw new Error('The merged sequence has no source-indexed current sentence part.');
    }

    return this.dataService.gswbDeduce({
      premises: currentPart.meaningConstructors,
      gswbPreferences: this.gswbPreferences.gswbPreferences,
      structure: sequenceSolution.structureJson,
      proofs: [{
        proofId: currentPart.solutionKey || 'sequence-current-sentence',
        solutionKey: currentPart.solutionKey,
        meaningConstructors: currentPart.meaningConstructors,
        structure: sequenceSolution.structureJson
      }]
    }).pipe(
      map(result => {
        const solutions = (result?.solutions ?? [])
          .filter((candidate: any) => typeof candidate?.semantic === 'string'
            && candidate.semantic.trim().length > 0
            && candidate.graph)
          .map((candidate: any) => ({
            ...candidate,
            sequenceSyntax: sequenceSolution.structureJson
          }));
        if (!solutions.length) {
          throw new Error('No source-indexed semantic analyses found for the current sentence.');
        }
        return solutions;
      })
    );
  }

  private acceptInitialLfgxdrtContext(userMessage: string, solutions: any[], ligerSolutions: any[] = []): void {
    const contexts = solutions
      .map(solution => {
        const semantic = solution.semantic || solution.solution;
        return {
          original: userMessage,
          prolog_drs: semantic,
          prolog_fol: '',
          tptp: '',
          box: solution.solution || '',
          semantic,
          semanticGraph: solution.graph,
          syntax: solution.syntax,
          // Same fallback registerSentence() and gswb-vis.component.ts's
          // semanticAnalysisFor() use: don't trust the backend to always populate
          // .semanticAnalysis, since semanticPart() silently drops the DRS graph when it's
          // absent, and this is the one context every later turn's merge builds on.
          semanticAnalysis: solution.semanticAnalysis ?? {
            syntacticOrigin: solution.solutionKey || solution.proofId || 'syntax',
            semId: solution.id,
            semString: semantic,
            graph: solution.graph,
            semType: 'lfgxdrt',
          },
          synSemMapping: solution.synSemMapping,
        } as context;
      })
      .filter(item => item.semantic?.trim());

    if (!contexts.length) {
      this.chatHistory.push({ text: 'No post-processed semantic analyses found.', sender: 'Bot' });
      this.loading = false;
      return;
    }

    const sentenceId = this.registerSentence(userMessage, solutions, ligerSolutions);
    contexts.forEach(entry => entry.elementId = sentenceId);

    this.context = contexts;
    this.history.push(contexts);
    this.historyChange.emit(this.history);
    this.clearSelected();
    this.chatHistory.push({
      text: 'Okay ...',
      sender: 'Bot',
      semanticText: contexts.map(item => item.semantic).join('\n')
    });
    this.changeDetector.detectChanges();
    this.loading = false;
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
    const semantic = branches
      ? ''
      : newContext.map((item: context) => item.semantic || item.prolog_drs).filter(Boolean).join('\n');
    this.chatHistory.push({
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
    const previous = this.context;
    // One entry per distinct reading, not per surviving assignment. A turn's rule
    // branches and PCDRS mappings are a DiscourseUpdate *of that turn*: they annotate one
    // merged reading, they are not new readings. What carries forward is syntax +
    // semantics, and the next turn re-derives the anaphora binding over the whole merged
    // discourse (turn 3's mappings rebind turn 2's pronouns as well as its own), so
    // carrying each branch forward as its own prior re-runs that enumeration once per
    // branch: turn 3 sent 24 x 36 = 864 bundles where 2 x 36 = 72 was the branch count,
    // and turn 4 would have multiplied by 72 again.
    const next: context[] = [];
    const readingKeys = new Map<string, context>();
    let acceptedAssignments = 0;
    interface DiscourseGroup {
      /** semanticOrigin -> discourseId. Accumulated per branch rather than assumed to
       *  be a single semantic: one sequence's contexts routinely span several merged
       *  semantic ids, and keying the whole map off the first one silently hid the
       *  branches belonging to the others. */
      semDiscourseMapping: Record<string, string[]>;
      structures: Record<string, LigerStructure>;
      mergedGraphs: Record<string, LigerWebGraph>;
      discourse: DiscourseAnalysis[];
    }
    const groups = new Map<string, DiscourseGroup>();

    prepared.forEach((item, index) => {
      const check = verdictFor(item, index);
      if (!check?.consistent || !check?.informative || !item.merged?.semantic) return;

      const priorElementId = item.priorElementId ?? previous[item.contextIndex]?.elementId;
      if (!priorElementId || !item.newSentenceId) return;

      const sequenceId = compositeAnalysisId([priorElementId, item.newSentenceId]);
      const semId = item.merged.id || sequenceId;

      acceptedAssignments++;
      // The same identity upsertSequenceFromContexts() dedupes on with its semanticsById
      // and syntaxById maps, so this list and the document's SequenceAnalysis agree by
      // construction instead of by coincidence. Every assignment of one pair carries the
      // identical `merged` (expanded is built as {...item, checks}), so the first one to
      // pass supplies the entry and the rest only add their branch to the groups below.
      // Syntax is part of the key: two readings that agree semantically but come from
      // different parses are two distinct discourse states, and the history shows both.
      const readingKey = [
        sequenceId,
        item.merged.semanticAnalysis?.syntacticOrigin ?? '',
        item.merged.semanticAnalysis?.semId ?? semId,
      ].join('::');
      if (!readingKeys.has(readingKey)) {
        const entry = {
          original: `${previous[item.contextIndex]?.original ?? ''} ${userMessage}`.trim(),
          prolog_drs: item.merged.semantic,
          prolog_fol: '',
          // The whole merged sequence, not the branch's context axiom: this entry becomes
          // the NEXT turn's prior, and `contextTptp` is now the prior of *this* turn.
          // Display-only on this path -- the next turn's context axiom is built from
          // `semantic` below, via prepareReasoningChecks' premiseSemantic.
          tptp: item.checks?.sequenceTptp ?? '',
          box: item.merged.solution ?? '',
          semantic: item.merged.semantic,
          semanticGraph: item.merged.graph,
          syntax: item.syntax,
          semanticAnalysis: item.merged.semanticAnalysis,
          synSemMapping: item.merged.synSemMapping,
          elementId: sequenceId,
        } as context;
        readingKeys.set(readingKey, entry);
        next.push(entry);
      }

      if (!groups.has(sequenceId)) {
        groups.set(sequenceId, { semDiscourseMapping: {}, structures: {}, mergedGraphs: {}, discourse: [] });
      }
      const group = groups.get(sequenceId)!;

      // Keyed on the pair scope + rule branch, as minted by the pipeline. Not by the
      // PCDRS mapping id -- every mapping off one rule branch shares that branch's
      // structure, so that would store one copy per mapping and defeat the dedup these
      // maps exist for. And not by the merged semantic id either: several pairs can
      // share one semantic id while having different structures (different premise
      // contexts), so that key makes them silently overwrite each other.
      const baseStructureId = item.checks?.baseStructureId ?? discourseStructureId(semId);
      const structureId = item.checks?.structureId ?? baseStructureId;

      if (item.checks?.baseStructure) {
        group.structures[baseStructureId] = item.checks.baseStructure;
        if (item.checks.baseGraph) {
          group.mergedGraphs[baseStructureId] = item.checks.baseGraph;
        }
      }
      if (item.checks?.mergedStructure) {
        group.structures[structureId] = item.checks.mergedStructure;
        if (item.checks.mergedGraph) {
          group.mergedGraphs[structureId] = item.checks.mergedGraph;
        }
      }

      const mapping = item.checks?.mapping;
      const discourseId = mapping?.id ?? `${semId}-pcdrs-${index}`;
      const mappedDiscourseIds = group.semDiscourseMapping[semId] ?? [];
      if (!mappedDiscourseIds.includes(discourseId)) {
        mappedDiscourseIds.push(discourseId);
      }
      group.semDiscourseMapping[semId] = mappedDiscourseIds;
      group.discourse.push({
        // GSWB's PCDRS solution id, matching the analysis view. It identifies the anaphora
        // branch, which is exactly what a reasoning assignment needs to point at -- and
        // unlike the structure id it is unique per mapping.
        id: discourseId,
        semanticOrigin: semId,
        drsString: mapping?.semantic ?? item.merged.semantic,
        drsGraph: mapping?.graph,
        structureId,
        anaphoraMapping: { relations: mapping?.anaphoraRelations ?? [] } as AnaphoraMappingModel,
        collapsed: (mapping?.anaphoraRelations?.length ?? 0) > 0,
      });
    });

    // Said out loud: the fold is what keeps the next turn's work proportional to its own
    // branch count, so a run where it collapses much more (or much less) than expected is
    // the signal that the branching upstream changed shape.
    console.info('[Chat] Discourse readings carried forward', {
      acceptedAssignments,
      readingsKept: next.length,
      discourseBranches: [...groups.values()].reduce((sum, group) => sum + group.discourse.length, 0),
    });

    const bySequence = new Map<string, context[]>();
    next.forEach(entry => {
      const list = bySequence.get(entry.elementId!) ?? [];
      list.push(entry);
      bySequence.set(entry.elementId!, list);
    });
    bySequence.forEach((entries, sequenceId) => this.upsertSequenceFromContexts(sequenceId, entries));
    groups.forEach((group, sequenceId) => {
      if (!group.discourse.length) return;
      this.upsertDiscourseUpdate({
        id: `du-${sequenceId}`,
        sourceElementId: sequenceId,
        sourceElementKind: 'sequence',
        structures: group.structures,
        mergedGraphs: group.mergedGraphs,
        discourse: group.discourse,
        semDiscourseMapping: group.semDiscourseMapping,
      });
    });

    return pruneContext ? next.slice(0, 1) : next;
  }

  /** Registers the just-parsed message as a new Sentence in the chat's document (box Q's
   *  source), independent of whether any downstream NLI check accepts it -- a Sentence
   *  exists as soon as it's parsed, regardless of the eventual reasoning verdict. */
  private registerSentence(userMessage: string, solutions: any[], ligerSolutions: any[]): string {
    const id = `sentence-${this.chatDocument.sentences.length + 1}`;
    const syntaxByKey = new Map<string, SyntacticAnalysis>();
    const semantics: SemanticAnalysis[] = [];
    const synSemMapping: Record<string, string[]> = {};

    solutions.forEach(solution => {
      const synId = solution.solutionKey || solution.proofId || `${id}-syn`;
      if (!syntaxByKey.has(synId)) {
        const ligerMatch = ligerSolutions.find(item => item.solutionKey === synId);
        syntaxByKey.set(synId, {
          synId,
          structure: solution.syntax ?? ligerMatch?.structureJson,
          graph: ligerMatch?.graph ?? solution.syntax,
          meaningConstructors: ligerMatch?.meaningConstructors,
        });
      }
      const semanticAnalysis: SemanticAnalysis = solution.semanticAnalysis ?? {
        syntacticOrigin: synId,
        semId: solution.id || `${id}-sem`,
        semString: solution.semantic || solution.solution || '',
        graph: solution.graph,
        semType: 'lfgxdrt',
      };
      semantics.push(semanticAnalysis);
      synSemMapping[synId] = Array.from(new Set([...(synSemMapping[synId] ?? []), semanticAnalysis.semId]));
    });

    this.chatDocument.sentences = [...this.chatDocument.sentences, {
      id,
      text: userMessage,
      syntax: Array.from(syntaxByKey.values()),
      semantics,
      synSemMapping,
    }];
    this.chatDocument.elements = [...this.chatDocument.elements, { kind: 'sentence', id }];
    this.emitChatDocument();
    return id;
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

    const index = this.chatDocument.sequences.findIndex(seq => seq.id === sequenceId);
    this.chatDocument.sequences = index === -1
      ? [...this.chatDocument.sequences, sequence]
      : this.chatDocument.sequences.map((seq, i) => i === index ? sequence : seq);
    if (!this.chatDocument.elements.some(ref => ref.id === sequenceId)) {
      this.chatDocument.elements = [...this.chatDocument.elements, { kind: 'sequence', id: sequenceId }];
    }
    this.emitChatDocument();
  }

  private upsertDiscourseUpdate(update: DiscourseUpdate): void {
    this.chatDocument.discourseUpdates = [
      ...(this.chatDocument.discourseUpdates ?? []).filter(existing => existing.id !== update.id),
      update,
    ];
    this.emitChatDocument();
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

  updateAxioms(value: string): void {
    this.axioms = value;
    this.axiomsChanged.emit(this.axioms);
  }

}
