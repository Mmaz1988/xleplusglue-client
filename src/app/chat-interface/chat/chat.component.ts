import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { DataService } from '../../data.service';
import {
  AnaphoraMappingModel,
  ChatMessage,
  context,
  DiscourseAnalysis,
  DiscourseUpdate,
  GswbRequest,
  GswbSemanticMergePart,
  LigerStructure,
  SemanticAnalysis,
  SequenceAnalysis,
  SyntacticAnalysis,
  vampireRequest,
  XlePlusGlueDocument
} from '../../models/models';
import { GswbSettingsComponent } from '../../gswb-vis/gswb-settings/gswb-settings.component';
import { DomSanitizer } from '@angular/platform-browser';
import { InferenceSettingsComponent } from '../../inference-interface/inference-settings/inference-settings.component';
import { catchError, forkJoin, from, map, mergeMap, of, switchMap } from 'rxjs';
import { APP_DEFAULTS, isLfgxdrtPreferences } from '../../app-defaults';
import { compositeAnalysisId, validateAnalysisDocument } from '../../analysis-model';


@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent {

  constructor(
    private dataService: DataService,
    private changeDetector: ChangeDetectorRef,
    private sanitizer: DomSanitizer
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

  private readonly nliPostProcessingRules = APP_DEFAULTS.graphInspector.rulesText;

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
    const bundles: any[] = [];

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

    contextIndices.forEach(contextIndex => {
      const premiseContext = this.context[contextIndex];
      const contextSyntax = premiseContext?.syntax;
      const priorElementId = premiseContext?.elementId;
      if (!contextSyntax || !priorElementId) {
        throw new Error('Accepted context syntax and document element id are required for sequence merging.');
      }
      candidateSolutions.forEach((solution, hypothesisIndex) => {
        const pairId = `pxq-${contextIndex + 1}-${solution.id || hypothesisIndex + 1}`;
        // Only the premise gets a pre-parsed structure -- the new sentence must be freshly
        // parsed by LiGER as part of this sequence call, not reused from its own independent
        // /apply_rules_xle parse (sendMessage()'s shared initial call). Reusing it here was the
        // actual root cause of chat's silent anaphora-resolution failures: LiGER assigns a
        // fresh solution key (S0, S1, ...) to a sentence it parses itself as part of a growing
        // sequence, but preserves whatever key an already-parsed structure came in with -- so a
        // reused independent parse keeps its standalone "S0", colliding with the premise's own
        // "S0" instead of becoming "S1". Confirmed by diffing a chat vs. analysis-workflow
        // document snapshot for the identical two-sentence input: every syntax constraint and
        // semantic DRS was byte-for-byte identical between the two, except this one
        // SOLUTION-KEY/SYNTAX-VARIANT-ID annotation pair, which is what the pronoun-binding
        // rules use to tell the premise's and the new sentence's nodes apart. Mirrors
        // LigerVisComponent.addSentence(), which only reuses parsedSentences for
        // already-accepted sentences and always lets LiGER parse the newly-added one itself.
        const sequence$ = this.dataService.ligerSequence({
          sentences: [premiseContext.original, userMessage],
          sentenceIds: ['sentence-1', 'sentence-2'],
          ruleString: this.ruleString,
          logicType: typed ? 'tff' : 'fof',
          parsedSentences: [[contextSyntax]]
        });
        bundles.push(sequence$.pipe(
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
            switchMap(({ merged, currentSolution }) => this.postProcessReasoningCheckAsts(
              merged,
              mergedSyntax,
              premiseContext.semanticGraph,
              currentSolution.graph,
              typed,
              pairId,
              pruneContext
            ).pipe(map(checks => ({
              contextIndex,
              priorElementId,
              newSentenceId,
              pairId,
              checks,
              merged,
              syntax: mergedSyntax
            }))))
          ))
        ));
      });
    });

    forkJoin(bundles).subscribe({
      next: prepared => {
        const expanded = prepared.flatMap((item: any) =>
          (item.checks ?? []).map((checks: any) => ({ ...item, checks }))
        );
        console.info('[Chat] NLI reasoning bundles prepared', {
          sentence: userMessage,
          bundleCount: prepared.length,
          acceptedCheckCount: expanded.length,
        });
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
    const newContext = prepared.length
      ? this.contextFromLfgxdrtChecks(prepared, mappings, userMessage, pruneContext)
      : (vampData.context ?? []);
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
    const tptp = newContext.map((item: context) => item.tptp).filter(Boolean).join('\n');
    const semantic = newContext.map((item: context) => item.semantic || item.prolog_drs).filter(Boolean).join('\n');
    this.chatHistory.push({
      text: message,
      sender: 'Bot',
      glyphs,
      safeGlyphs,
      glyphGridSize: Math.max(1, Math.ceil(Math.sqrt(glyphs.length))),
      semanticText: semantic,
      detailText: tptp
    });
    this.loading = false;
  }

  private contextFromLfgxdrtChecks(
    prepared: any[],
    checks: any[],
    userMessage: string,
    pruneContext: boolean
  ): context[] {
    const previous = this.context;
    const next: context[] = [];
    interface DiscourseGroup {
      semId: string;
      structures: Record<string, LigerStructure>;
      discourse: DiscourseAnalysis[];
    }
    const groups = new Map<string, DiscourseGroup>();

    prepared.forEach((item, index) => {
      const check = checks[index];
      if (!check?.consistent || !check?.informative || !item.merged?.semantic) return;

      const priorElementId = item.priorElementId ?? previous[item.contextIndex]?.elementId;
      if (!priorElementId || !item.newSentenceId) return;

      const sequenceId = compositeAnalysisId([priorElementId, item.newSentenceId]);
      const semId = item.merged.id || sequenceId;

      next.push({
        original: `${previous[item.contextIndex]?.original ?? ''} ${userMessage}`.trim(),
        prolog_drs: item.merged.semantic,
        prolog_fol: '',
        tptp: item.checks?.contextTptp ?? '',
        box: item.merged.solution ?? '',
        semantic: item.merged.semantic,
        semanticGraph: item.merged.graph,
        syntax: item.syntax,
        semanticAnalysis: item.merged.semanticAnalysis,
        synSemMapping: item.merged.synSemMapping,
        elementId: sequenceId,
      } as context);

      if (!groups.has(sequenceId)) {
        groups.set(sequenceId, { semId, structures: {}, discourse: [] });
      }
      const group = groups.get(sequenceId)!;

      const structureId = item.checks?.mappingId ?? `${sequenceId}-pcdrs-${index}`;
      if (item.checks?.mergedStructure) {
        group.structures[structureId] = item.checks.mergedStructure;
      }
      const mapping = item.checks?.mapping;
      group.discourse.push({
        id: `${semId}-pcdrs-${structureId}`,
        semanticOrigin: semId,
        drsString: mapping?.semantic ?? item.merged.semantic,
        drsGraph: mapping?.graph,
        structureId,
        anaphoraMapping: { relations: mapping?.anaphoraRelations ?? [] } as AnaphoraMappingModel,
        collapsed: (mapping?.anaphoraRelations?.length ?? 0) > 0,
      });
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
        discourse: group.discourse,
        semDiscourseMapping: { [group.semId]: group.discourse.map(entry => entry.id) },
      });
    });

    return pruneContext ? next.slice(0, 1) : next;
  }

  private postProcessReasoningCheckAsts(
    merged: any,
    syntax: any,
    premiseAst: any,
    hypothesisAst: any,
    typed: boolean,
    pairId: string,
    pruneContext: boolean
  ): import('rxjs').Observable<any[]> {
    if (!syntax) {
      throw new Error('NLI checks require the sequence provenance structure.');
    }

    if (!premiseAst || !hypothesisAst || !merged?.graph) {
      throw new Error('NLI sequence semantic graphs are missing.');
    }

    return this.dataService.ligerMergeStructure({ syntax, drs: merged.graph }).pipe(
      switchMap(mergedStructure => this.applyNliRules(mergedStructure.structureJson)),
      switchMap(mergedStructures => forkJoin(mergedStructures.map((mergedStructure, index) =>
        this.dataService.gswbGeneratePcdrs({
          semantic: merged.semantic,
          parentSolutionId: `${pairId}-rule-${index + 1}`,
          mergedStructure: mergedStructure as any
        }).pipe(map(result => ({ result, mergedStructure })))
      ))),
      switchMap(pcdrsResults => {
        let mappingsWithStructure = pcdrsResults.flatMap(({ result, mergedStructure }) =>
          (result?.solutions ?? []).map(mapping => ({ mapping, mergedStructure }))
        );
        if (!mappingsWithStructure.length) {
          throw new Error('No post-processed sequence interpretations were generated.');
        }
        console.info('[Chat] PCDRS candidates generated', {
          pairId,
          ruleBranchCount: pcdrsResults.length,
          mappingCount: mappingsWithStructure.length,
          anaphoraResolvedCount: mappingsWithStructure.filter(({ mapping }) =>
            (mapping.anaphoraRelations ?? []).length > 0).length,
        });
        // Pruning picks the first candidate and reasons over it alone -- the reduction
        // happens here, before the expensive collapse/TPTP/Vampire steps below.
        if (pruneContext) {
          mappingsWithStructure = mappingsWithStructure.slice(0, 1);
        }
        return forkJoin(mappingsWithStructure.map(({ mapping, mergedStructure }) => {
          // The mapping is computed once here (by generate_pcdrs above) and reused as-is
          // across the context collapse and all four checks below -- gswbCollapseAnaphora
          // re-parses `semantic` from scratch server-side and carries no mapping of its own,
          // so the structured anaphoraRelations must be passed explicitly on every call
          // rather than re-derived, or spliced into the semantic text as a string.
          const anaphoraRelations = mapping.anaphoraRelations ?? [];
          const reasoningChecks = this.dataService.gswbReasoningCheckAsts({
            premiseAsts: [premiseAst],
            hypothesisAsts: [hypothesisAst],
            typed
          });
          const contextTptp = this.dataService.gswbCollapseAnaphora({
            semantic: mapping.semantic || '',
            anaphoraRelations,
            parentSolutionId: `${mapping.id}-context`
          }).pipe(
            switchMap(collapsed => collapsed?.semantic
              ? this.dataService.gswbSemanticToTptp({ semantic: collapsed.semantic, typed })
                  .pipe(map(tptp => tptp.tptp))
              : of('')),
            catchError(() => of(''))
          );
          return forkJoin({
            contextTptp,
            checks: reasoningChecks.pipe(
              switchMap(checkResponse => {
                const entries = Object.entries(checkResponse?.checks ?? {});
                if (!entries.length) return of([]);
                return forkJoin(entries.map(([name, check]: [string, any]) =>
                  this.dataService.gswbCollapseAnaphora({
                    semantic: check.semantic,
                    anaphoraRelations,
                    parentSolutionId: `${mapping.id}-${name}`
                  }).pipe(
                    switchMap(collapsed => {
                      if (!collapsed?.semantic) return of(null);
                      return this.dataService.gswbSemanticToTptp({
                        semantic: collapsed.semantic,
                        typed
                      }).pipe(map(tptp => ({ name, tptp: tptp.tptp })));
                    }),
                    catchError(() => of(null))
                  )
                ));
              })
            )
          }).pipe(
            map(result => {
              const valid = result.checks.filter((item): item is { name: string; tptp: string } => !!item?.tptp);
              if (valid.length !== 4) return null;
              return {
                pairId,
                mappingId: mapping.id,
                mapping,
                mergedStructure,
                checks: Object.fromEntries(valid.map(item => [item.name, { tptp: item.tptp }])),
                contextTptp: result.contextTptp
              };
            })
          );
        }));
      }),
      map(bundles => bundles.filter(Boolean))
    );
  }

  private applyNliRules(structure: any): import('rxjs').Observable<any[]> {
    return this.dataService.ligerApplyRulesToStructure({
      content: JSON.stringify(structure),
      format: 'json',
      ruleString: this.nliPostProcessingRules,
      id: 'nli-post-processing'
    }).pipe(
      map(response => {
        const structures = (response.annotations ?? [])
          .map(annotation => annotation.structureJson)
          .filter(Boolean);
        return structures.length ? structures : [structure];
      })
    );
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

  private upsertSequenceFromContexts(sequenceId: string, entries: context[]): void {
    const representative = entries[0];
    const sentenceIds = sequenceId.split('+');
    const syntax: SyntacticAnalysis[] = representative.syntax
      ? [{
          synId: representative.semanticAnalysis?.syntacticOrigin ?? `${sequenceId}-syn`,
          structure: representative.syntax,
          graph: representative.syntax,
        } as unknown as SyntacticAnalysis]
      : [];
    const semantics: SemanticAnalysis[] = representative.semanticAnalysis ? [representative.semanticAnalysis] : [];
    const synSemMapping: Record<string, string[]> = {};
    if (syntax[0] && semantics[0]) {
      synSemMapping[syntax[0].synId] = [semantics[0].semId];
    }

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
