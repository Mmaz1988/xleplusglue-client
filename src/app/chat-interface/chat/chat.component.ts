import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { DataService } from '../../data.service';
import { ChatMessage, context, GswbRequest, vampireRequest } from '../../models/models';
import { GswbSettingsComponent } from '../../gswb-vis/gswb-settings/gswb-settings.component';
import { DomSanitizer } from '@angular/platform-browser';
import { InferenceSettingsComponent } from '../../inference-interface/inference-settings/inference-settings.component';


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

  // needs to be updated as chat goes on
  context: context[] = [];

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
        const selectedSolution = data.solutions?.[0];

        if (!selectedSolution || !selectedSolution.graph?.graphElements?.length) {
          this.chatHistory.push({ text: 'Syntactic analysis failed for this input!', sender: 'Bot' });
          this.loading = false;
          return;
        }

        this.meaningConstructors = selectedSolution.meaningConstructors;

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
          gswbPreferences: this.gswbPreferences.gswbPreferences
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
            const userSem = gswbData.solutions.map(x => x.solution).join('\n');
            const pruneContext = this.contextPruning.nativeElement.checked;
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
                  this.context = newContext;
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
