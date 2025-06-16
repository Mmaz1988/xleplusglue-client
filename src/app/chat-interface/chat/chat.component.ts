import {ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, Output, ViewChild} from '@angular/core';
import {DataService} from "../../data.service";
import {context, GswbPreferences, GswbRequest, vampireRequest, ChatMessage} from "../../models/models";
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
    var glyph = '';

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
            this.axioms += extractedAxioms + '\n';
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
                userSem = data.solutions.join('\n');

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

                      if (Object.keys(data.context_checks_mapping).length > 0) {
                        glyph = data.context_checks_mapping[0].glyph;
                        info = data.context_checks_mapping[0].informative;
                        consistent = data.context_checks_mapping[0].consistent;
                      }

                      if (consistent === null) {
                        message = "Okay ...";
                      } else if (!consistent) {
                        message = "Your input does not make sense.";
                      } else if (!info) {
                        message = "Your input is not informative.";
                      } else {
                        message = "Your input is consistent and informative.";
                      }

                      this.chatHistory.push({ text: message, sender: 'Bot', glyph: glyph, showGlyph: false });
                    }

                    this.loading = false; // Hide loading indicator
                  },
                  error => {
                    console.log("An error occurred during the call to Vampire");
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

  sanitizeSvg(svg: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }

  toggleGlyphVisibility(message: any) {
    message.showGlyph = !message.showGlyph;
  }
}
