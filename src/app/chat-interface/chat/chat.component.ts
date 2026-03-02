import {ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, Output, ViewChild} from '@angular/core';
import {DataService} from "../../data.service";
import {context, GswbRequest, vampireRequest, ChatMessage} from "../../models/models";
import {GswbSettingsComponent} from "../../gswb-vis/gswb-settings/gswb-settings.component";
import {error} from "@angular/compiler-cli/src/transformers/util";
import {DomSanitizer, SafeHtml} from "@angular/platform-browser";
import {coerceStringArray} from "@angular/cdk/coercion";
import {InferenceSettingsComponent} from "../../inference-interface/inference-settings/inference-settings.component";


@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent {

  constructor(private dataService: DataService,  private changeDetector: ChangeDetectorRef, private sanitizer: DomSanitizer) {
  }

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
    var glyphs: string[]  = [];
    var glyph = '';
    var tptp = '';

    // Add user message to history
    this.chatHistory.push({ text: userMessage, sender: 'User' });

    // If logicType is 0 create string 'fof' if 1 create string 'tff'
    const logicType = this.vampirePreferences.vampirePreferences.logic_type === 0 ? 'fof' : 'tff';

    const ligerRequest = { sentence: userMessage, ruleString: this.ruleString, logicType: logicType };

    console.log("Liger request: ", ligerRequest);

    this.dataService.ligerAnnotate(ligerRequest).subscribe(
      data => {
        console.log("Liger response: ", data);
        if (!data.hasOwnProperty("graph") || !data.graph.hasOwnProperty("graphElements") || data.graph.graphElements.length === 0) {
          this.chatHistory.push({ text: "Syntactic analysis failed for this input!", sender: 'Bot' });
          this.loading = false; // Hide loading indicator
          return;
        }

        if (data.hasOwnProperty("meaningConstructors")) {
          this.meaningConstructors = data.meaningConstructors;



        if (data.hasOwnProperty("axioms") && data.axioms != null) {
          console.log("Axioms: ", data.axioms);

          let extractedAxioms = '';
          // enumerate and create axioms from ligerAxioms

          for (let axiom of data.axioms) {
            if (axiom.trim() !== '' && !this.axioms.includes(axiom.trim())) {
              extractedAxioms += logicType + "(" +
                "axiom" + this.axiomCounter + ",axiom," + axiom + ').\n';
              this.axiomCounter++;
            }
          }

          if (extractedAxioms.trim() !== '') {
            if (this.axioms != '') {
              this.axioms += '\n';
            }

            this.axioms += extractedAxioms + '\n';
            this.updateAxioms(this.axioms);
          }

        }

          const gswbRequest: GswbRequest = {
            premises: this.meaningConstructors,
            gswbPreferences: this.gswbPreferences.gswbPreferences
          };

          console.log("Gswb request: ", gswbRequest);

          this.dataService.gswbDeduce(gswbRequest).subscribe(
            data => {
              let userSem = '';

              if (data.hasOwnProperty('solutions') && data.solutions.length > 0 && data.solutions[0] != '') {
                console.log("Gswb output:", data.solutions)
                userSem = data.solutions.map(x => x.solution).join('\n');

                const pruneContext: boolean = this.contextPruning.nativeElement.checked;
                const vampRequest: vampireRequest = { text: userMessage, context: this.context, axioms: this.axioms,
                  hypothesis: userSem, pruning: pruneContext, active_indices: this.activeIndices,
                   vampire_preferences: this.vampirePreferences.vampirePreferences };
                console.log("Vampire request: ", vampRequest);

                this.dataService.callVampire(vampRequest).subscribe(
                  data => {
                    console.log("Vampire response: ", data);
                    this.clearSelected();
                    if (data.hasOwnProperty("context")) {
                      const newContext = data.context;
                      this.history.push(newContext);
                      this.context = newContext;
                      this.historyChange.emit(this.history);
                      this.changeDetector.detectChanges();

                      var message = "Okay ...";
                      var consistent: boolean = null;
                      var info: boolean = null;
                      var relevant: boolean = null;

                      const mappings = Array.isArray(data.context_checks_mapping)
                        ? data.context_checks_mapping
                        : Object.values(data.context_checks_mapping ?? {});

                      if (mappings.length > 0) {
                        // collect glyph SVGs
                        glyphs = mappings
                          .map(m => m?.glyph)
                          .filter((g): g is string => typeof g === 'string' && g.trim().length > 0);

                        // majority vote helper (ties => false)
                        const majorityFalseOnTie = (vals: boolean[]) => {
                          const trueCount = vals.reduce((acc, v) => acc + (v ? 1 : 0), 0);
                          const falseCount = vals.length - trueCount;
                          return trueCount > falseCount; // tie -> false
                        };

                        const informativeVals = mappings
                          .map(m => !!m?.informative);

                        const consistentVals = mappings
                          .map(m => !!m?.consistent);

                        const relevantVals = mappings
                          .map(m => !!m?.relevant);

                        info = majorityFalseOnTie(informativeVals);
                        consistent = majorityFalseOnTie(consistentVals);
                        relevant = majorityFalseOnTie(relevantVals);

                        // If you still need a single glyph string somewhere, keep it separate,
                        // but ideally store glyphs array on the message.
                       // message.glyphs = glyphs;

                        // grid dimension: smallest square that fits N glyphs
                      //  message.glyphGridSize = Math.ceil(Math.sqrt(glyphs.length));
                      }
                      //Check if elements in data.context have property 'tptp' and display line by line in tptp
                      if (data.context.length > 0) {
                        for (let i = 0; i < data.context.length; i++) {
                          if (data.context[i].hasOwnProperty('tptp')) {
                            tptp += data.context[i].tptp + '\n';
                          }
                        }
                      }

                      if (consistent === null) {
                        message = "Okay ...";
                      } else if (!consistent) {
                        message = "Your input does not make sense.";
                      } else if (!info) {
                        message = "Your input is not informative.";
                      } else if (relevant) {
                        message = "I may not fully understand your input. I assume it is informative and consistent";
                      } else {
                        message = "Your input is informative and consistent.";
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
                    this.loading = false; // Hide loading indicator
                  },
                  error => {
                    console.log("An error occurred during the call to Vampire");
                    this.chatHistory.push({ text: "An error occurred during the inference process", sender: 'Bot' });
                    this.loading = false;
                  }
                );

              } else {
                this.chatHistory.push({ text: "No semantic analyses found for this input!", sender: 'Bot' });
                this.loading = false;
                return;
              }
            },
            error => {
              console.log('ERROR: ', error);
              this.chatHistory.push({ text: "An error occurred during the semantic analysis", sender: 'Bot' });
              this.loading = false;
              return;
            }
          );
        } else {
          this.chatHistory.push({ text: "Could not find meaning constructors for this input!", sender: 'Bot' });
          this.loading = false;
          return;
        }
      },
      error => {
        this.chatHistory.push({ text: "An unknown error occurred.", sender: 'Bot' });
        console.log('ERROR: ', error);
        this.loading = false;
      }
    );

    this.userInput = ''; // Clear input
  }


  clearSelected(): void {
    this.clearSelection.emit();  // Emit event to clear selection
    console.log("Selection cleared in chat component");
  }



  updateAxioms(value: string): void {
    this.axioms = value;
    this.axiomsChanged.emit(this.axioms); // Emit the updated axioms
    console.log("Axioms updated in chat component:", this.axioms);
  }

}
