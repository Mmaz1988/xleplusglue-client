import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { DataService } from '../../data.service';
import { ChatMessage, context, GswbRequest, vampireRequest } from '../../models/models';
import { GswbSettingsComponent } from '../../gswb-vis/gswb-settings/gswb-settings.component';
import { DomSanitizer } from '@angular/platform-browser';
import { InferenceSettingsComponent } from '../../inference-interface/inference-settings/inference-settings.component';
import { catchError, forkJoin, from, map, mergeMap, of, switchMap } from 'rxjs';
import { APP_DEFAULTS } from '../../app-defaults';


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

  chatHistory: ChatMessage[] = []; // Stores chat messages
  userInput: string = ''; // Stores user input
  meaningConstructors: string = '';

  axiomCounter = 0;

  private readonly nliPostProcessingRules = APP_DEFAULTS.graphInspector.rulesText;

  // needs to be updated as chat goes on
  context: context[] = [];
  semanticContext: string[] = [];
  semanticContextGraphs: any[] = [];

  loading: boolean = false; // Tracks whether the bot is responding

  sendMessage() {
    if (!this.userInput.trim()) return;

    console.log("Gswb preferences: ", this.gswbPreferences.gswbPreferences);
    console.log("Vampire preferences: ", this.vampirePreferences.vampirePreferences);

    this.loading = true; // Show loading indicator
    const userMessage = this.userInput;
    let glyphs: string[] = [];
    let tptp = '';

    // Add user message to history
    this.chatHistory.push({ text: userMessage, sender: 'User' });

    // If logicType is 0 create string 'fof' if 1 create string 'tff'
    const logicType = this.vampirePreferences.vampirePreferences.logic_type === 0 ? 'fof' : 'tff';

    const ligerRequest = { sentence: userMessage, ruleString: this.ruleString, logicType: logicType };

    console.log("Liger request: ", ligerRequest);

    this.dataService.ligerAnnotate(ligerRequest).subscribe({
      next: data => {
        console.log('Liger response: ', data);
         const selectedSolution = data.solutions?.find((solution: any) =>
           Array.isArray(solution?.graph?.graphElements) && solution.graph.graphElements.length > 0)
           ?? data.solutions?.[0];

        if (!selectedSolution || !selectedSolution.graph?.graphElements?.length) {
          this.chatHistory.push({ text: 'Syntactic analysis failed for this input!', sender: 'Bot' });
          this.loading = false;
          return;
        }

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
          console.log('Axioms: ', selectedSolution.axioms);

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

        console.log('Gswb request: ', gswbRequest);

        this.dataService.gswbDeduce(gswbRequest).subscribe({
          next: gswbData => {
            if (!Array.isArray(gswbData.solutions) || gswbData.solutions.length === 0 || gswbData.solutions[0] === '') {
              this.chatHistory.push({ text: 'No semantic analyses found for this input!', sender: 'Bot' });
              this.loading = false;
              return;
            }

            console.log('Gswb output:', gswbData.solutions);
            const useLfgxDrt = Number(this.gswbPreferences.gswbPreferences.outputstyle) === 5;
            const userSem = gswbData.solutions
              .map(x => useLfgxDrt ? (x.semantic || x.solution) : x.solution)
              .join('\n');
             const pruneContext = this.contextPruning.nativeElement.checked;
             const parsedCurrentSentence = data.solutions
               .map((solution: any) => solution.structureJson)
               .filter(Boolean);
             if (useLfgxDrt && this.context.length === 0) {
               this.prepareLfgxdrtSolutions(userMessage, selectedSolution, data.solutions,
                 gswbData.solutions, pruneContext, parsedCurrentSentence);
               return;
             }
             if (useLfgxDrt
               && this.context.length > 0 && this.semanticContext.length === this.context.length) {
               this.prepareLfgxdrtSolutions(userMessage, selectedSolution, data.solutions,
                 gswbData.solutions, pruneContext, parsedCurrentSentence);
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

            console.log('Vampire request: ', vampRequest);

            this.dataService.callVampire(vampRequest).subscribe({
              next: vampData => {
                console.log('Vampire response: ', vampData);
                this.clearSelected();

                if (vampData.hasOwnProperty('context')) {
                  const newContext = vampData.context;
                  this.history.push(newContext);
                  const wasEmpty = this.context.length === 0;
                  this.context = newContext;
                  this.semanticContext = newContext.map(item =>
                    wasEmpty && Number(this.gswbPreferences.gswbPreferences.outputstyle) === 5
                      ? userSem
                      : (item.semantic || item.prolog_drs || ''));
                  this.historyChange.emit(this.history);
                  this.changeDetector.detectChanges();

                  let message = 'Okay ...';
                  let consistent: boolean | null = null;
                  let info: boolean | null = null;
                  let relevant: boolean | null = null;

                  const mappings = Array.isArray(vampData.context_checks_mapping)
                    ? vampData.context_checks_mapping
                    : Object.values(vampData.context_checks_mapping ?? {});

                  if (mappings.length > 0) {
                    glyphs = mappings
                      .map(m => m?.glyph)
                      .filter((g): g is string => typeof g === 'string' && g.trim().length > 0);

                    const majorityFalseOnTie = (vals: boolean[]) => {
                      const trueCount = vals.reduce((acc, v) => acc + (v ? 1 : 0), 0);
                      return trueCount > vals.length - trueCount;
                    };

                    info = majorityFalseOnTie(mappings.map(m => !!m?.informative));
                    consistent = majorityFalseOnTie(mappings.map(m => !!m?.consistent));
                    relevant = majorityFalseOnTie(mappings.map(m => !!m?.relevant));
                  }

                  if (Array.isArray(vampData.context) && vampData.context.length > 0) {
                    for (const item of vampData.context) {
                      if (item.hasOwnProperty('tptp')) {
                        tptp += item.tptp + '\n';
                      }
                    }
                  }

                  if (consistent === null) {
                    message = 'Okay ...';
                  } else if (!consistent) {
                    message = 'Your input does not make sense.';
                  } else if (!info) {
                    message = 'Your input is not informative.';
                  } else if (relevant) {
                    message = 'I may not fully understand your input. I assume it is informative and consistent';
                  } else {
                    message = 'Your input is informative and consistent.';
                  }

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
                console.log('An error occurred during the call to Vampire');
                this.chatHistory.push({ text: 'An error occurred during the inference process', sender: 'Bot' });
                this.loading = false;
              }
            });
          },
          error: error => {
            console.log('ERROR: ', error);
            this.chatHistory.push({ text: 'An error occurred during the semantic analysis', sender: 'Bot' });
            this.loading = false;
          }
        });
      },
      error: error => {
        this.chatHistory.push({ text: 'An unknown error occurred.', sender: 'Bot' });
        console.log('ERROR: ', error);
        this.loading = false;
      }
    });

    this.userInput = ''; // Clear input
  }

  private prepareLfgxdrtSolutions(
    userMessage: string,
    ligerSolution: any,
    ligerSolutions: any[],
    solutions: any[],
    pruneContext: boolean,
    parsedCurrentSentence: any[] = []
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
      this.acceptInitialLfgxdrtContext(
        userMessage,
        candidates.map(candidate => ({ ...candidate.solution, syntax: candidate.syntax })));
      return;
    }

    // For an update, keep the raw GSWB readings until they are paired with
    // the stored context. Pronoun rules and PCDRS belong to the merged PxQ.
    this.finishLfgxdrtPreparation(
      userMessage,
      candidates.map(candidate => ({ ...candidate.solution, syntax: candidate.syntax })),
      pruneContext,
      ligerSolution.structureJson,
      parsedCurrentSentence
    );
    return;

  }

  private finishLfgxdrtPreparation(
    userMessage: string,
    solutions: any[],
    pruneContext: boolean,
    syntax: any,
    parsedCurrentSentence: any[] = []
  ): void {
    const semanticSolutions = solutions.filter(solution =>
      typeof solution?.semantic === 'string' && solution.semantic.trim().length > 0);
    if (!semanticSolutions.length) {
      this.chatHistory.push({ text: 'No post-processed semantic analyses found.', sender: 'Bot' });
      this.loading = false;
      return;
    }
    if (this.context.length === 0) {
      this.acceptInitialLfgxdrtContext(userMessage, semanticSolutions, syntax);
      return;
    }

    const typed = this.vampirePreferences.vampirePreferences.logic_type !== 0;
    const bundles: any[] = [];

    const contextIndices = this.activeIndices.length
      ? this.activeIndices.filter(index => index >= 0 && index < this.context.length)
      : this.context.map((_, index) => index);
    contextIndices.forEach(contextIndex => {
       const contextSyntax = this.context[contextIndex]?.syntax;
       if (!contextSyntax) {
         throw new Error('Accepted context syntax is required for sequence merging.');
       }
       semanticSolutions.forEach((solution, hypothesisIndex) => {
         const premise = this.semanticContext[contextIndex];
         const pairId = `pxq-${contextIndex + 1}-${solution.id || hypothesisIndex + 1}`;
         const currentSyntax = solution.syntax ?? parsedCurrentSentence[0] ?? syntax;
         if (!currentSyntax) {
           throw new Error('Current sentence syntax is required for sequence merging.');
         }
          const sequence$ = this.dataService.ligerSequence({
            sentences: [this.context[contextIndex].original, userMessage],
            ruleString: this.ruleString,
            logicType: typed ? 'tff' : 'fof',
            parsedSentences: [[contextSyntax], [currentSyntax]]
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
                graphs: [this.semanticContextGraphs[contextIndex], currentSolution.graph],
                semantics: [premise, currentSolution.semantic],
                parentSolutionId: pairId,
                solutionKey: currentSolution.solutionKey,
                mcSetId: currentSolution.mcSetId
              }).pipe(map(merged => ({ merged, currentSolution })))),
              switchMap(({ merged, currentSolution }) => this.postProcessReasoningCheckAsts(
                merged,
                mergedSyntax,
                this.semanticContextGraphs[contextIndex],
                currentSolution.graph,
                typed,
                pairId
              ).pipe(map(checks => ({
                contextIndex,
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
          error: () => {
            this.chatHistory.push({ text: 'An error occurred during the inference process', sender: 'Bot' });
            this.loading = false;
          }
        });
      },
      error: () => {
        this.chatHistory.push({ text: 'An error occurred during semantic reasoning preparation', sender: 'Bot' });
        this.loading = false;
      }
    });
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

  private acceptInitialLfgxdrtContext(userMessage: string, solutions: any[], syntax: any = undefined): void {
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
           syntax: solution.syntax ?? syntax,
           semanticAnalysis: solution.semanticAnalysis,
           synSemMapping: solution.synSemMapping
        } as context;
      })
      .filter(item => item.semantic?.trim());
    this.context = contexts;
    this.semanticContext = contexts.map(item => item.semantic || '');
     this.semanticContextGraphs = contexts.map(item => item.semanticGraph);
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
    const glyphs = (Object.values(vampData.context_checks_mapping ?? {}) as any[])
      .map(item => item?.glyph)
      .filter((glyph): glyph is string => typeof glyph === 'string' && glyph.trim().length > 0);
    const mappings = Object.values(vampData.context_checks_mapping ?? {}) as any[];
    const majority = (values: boolean[]) => values.filter(Boolean).length > values.length / 2;
    const consistent = mappings.length ? majority(mappings.map(item => !!item.consistent)) : null;
    const informative = mappings.length ? majority(mappings.map(item => !!item.informative)) : null;
    const relevant = mappings.length ? majority(mappings.map(item => !!item.relevant)) : null;
    const newContext = prepared.length
      ? this.contextFromLfgxdrtChecks(prepared, mappings, userMessage, pruneContext)
      : (vampData.context ?? []);
    this.context = newContext;
    this.semanticContext = newContext.map((item: context) => item.semantic || item.prolog_drs || '');
    this.semanticContextGraphs = newContext.map((item: any) => item.semanticGraph);
    this.history.push(newContext);
    this.historyChange.emit(this.history);
    this.changeDetector.detectChanges();
    let message = 'Okay ...';
    if (consistent === false) message = 'Your input does not make sense.';
    else if (informative === false) message = 'Your input is not informative.';
    else if (relevant) message = 'I may not fully understand your input. I assume it is informative and consistent';
    else if (consistent !== null) message = 'Your input is informative and consistent.';
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

    prepared.forEach((item, index) => {
      const check = checks[index];
      if (!check?.consistent || !check?.informative || !item.merged?.semantic) return;
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
         synSemMapping: item.merged.synSemMapping
      } as context);
    });

    return pruneContext ? next.slice(0, 1) : next;
  }

  private postProcessReasoningCheckAsts(
    merged: any,
    syntax: any,
    premiseAst: any,
    hypothesisAst: any,
    typed: boolean,
    pairId: string
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
        })
      ))),
      switchMap(pcdrs => {
        const mappings = pcdrs.flatMap(result => result?.solutions ?? []);
        if (!mappings.length) {
          throw new Error('No post-processed sequence interpretations were generated.');
        }
        return forkJoin(mappings.map(mapping => {
          const mappingSuffix = mapping.anaphoraMapping ? `,${mapping.anaphoraMapping}` : '';
          const reasoningChecks = this.dataService.gswbReasoningCheckAsts({
            premiseAsts: [premiseAst],
            hypothesisAsts: [hypothesisAst],
            typed
          });
          const contextTptp = this.dataService.gswbCollapseAnaphora({
            semantic: mapping.semantic || '',
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
                    semantic: `${check.semantic}${mappingSuffix}`,
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


  clearSelected(): void {
    this.clearSelection.emit();
    console.log('Selection cleared in chat component');
  }



  updateAxioms(value: string): void {
    this.axioms = value;
    this.axiomsChanged.emit(this.axioms);
    console.log('Axioms updated in chat component:', this.axioms);
  }

}
