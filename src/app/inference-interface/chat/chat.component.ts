import {ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, Output, ViewChild} from '@angular/core';
import {DataService} from "../../data.service";
import {context, GswbPreferences, GswbRequest, vampireRequest, ChatMessage} from "../../models/models";
import {GswbSettingsComponent} from "../../gswb-vis/gswb-settings/gswb-settings.component";
import {error} from "@angular/compiler-cli/src/transformers/util";
import {DomSanitizer, SafeHtml} from "@angular/platform-browser";


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

  @Input() history: context[][] = [];  // Received from parent
  @Output() historyChange = new EventEmitter<context[][]>(); // Event to notify updates

  @Input() activeIndices: number[] = [];
  @Output() clearSelection: EventEmitter<void> = new EventEmitter<void>();  // Event to clear selection


  chatHistory: ChatMessage[] = []; // Stores chat messages
  userInput: string = ''; // Stores user input
  meaningConstructors: string = '';

  // needs to be updated as chat goes on
  context: context[] = [];
  axioms: string = '';


  sendMessage() {
    if (!this.userInput.trim()) return;


    const userMessage = this.userInput; // Store user input before clearing it
    var glyph = ''; // Initialize glyph

    // Add user message to history
    this.chatHistory.push({ text: userMessage, sender: 'User' });

    const ligerRequest = { sentence: userMessage, ruleString: this.ruleString };

    this.dataService.ligerAnnotate(ligerRequest).subscribe(
      data => {
        // Check Syntactic analysis
        console.log("XLE output:", data.graph.graphElements);
        if (data.hasOwnProperty("graph")) {
          if (data.graph.hasOwnProperty("graphElements") && data.graph.graphElements.length > 0) {
          } else
          {
            this.chatHistory.push({text: "Syntactic analysis failed for this input!", sender: 'Bot'});
            return
          }
        } else {
          console.log('ERROR: No graph data found in response.');
          return
        }

        // Check Semantic analysis
        if (data.hasOwnProperty("meaningConstructors")) {
          console.log(data.meaningConstructors);
          this.meaningConstructors = data.meaningConstructors;

          // Check whether user is using default settings for reasoning, if not adopt new settings
          if (this.gswbPreferences.gswbPreferences.prover !== 1 && this.gswbPreferences.gswbPreferences.outputstyle !== 4) {
            console.log("GSWB preferences not set to default values.")
            this.gswbPreferences.onSubmit();
          }

          //Prepare semantic derivation
          const gswbRequest: GswbRequest = {
            premises: this.meaningConstructors,
            gswbPreferences: this.gswbPreferences.gswbPreferences
          };

          console.log("GSWB request: ", gswbRequest);

          this.dataService.gswbDeduce(gswbRequest).subscribe(
            data => {
              console.log("GSWB result:", data);
              let userSem = '';

              //Prepare reasoning if semantic analysis is successful
              if (data.hasOwnProperty('solutions') && data.solutions.length > 0 && data.solutions[0] != '') {
                userSem = data.solutions.join('\n');

                const pruneContext: boolean = this.contextPruning.nativeElement.checked; // Read checkbox state
                const vampRequest: vampireRequest = { text: userMessage, context : this.context,
                                                      axioms: this.axioms, hypothesis : userSem , pruning : pruneContext,
                                                      active_indices: this.activeIndices};

                console.log("Vampire request: ", vampRequest)

                this.dataService.callVampire(vampRequest).subscribe(
                  data => {
                    //ToDo History is not updated, likely because it is not initialized when in chat window
                    this.clearSelected();

                    //A context describes the outcome of the reasoning process
                    console.log("Vampire output: ", data)
                    if (data.hasOwnProperty("context")){
                      const newContext = data.context;
                      console.log("Current context: ", newContext)

                      //Update context and history
                      this.history.push(newContext);
                      this.context = newContext

                      //Setting up consistency and informativity checks
                      var consistent: boolean = null;
                      var info: boolean = null;

                      // Emit to parent to notify change
                      this.historyChange.emit(this.history);
                      // Manually trigger change detection
                      this.changeDetector.detectChanges();

                      //check if checks dictionary is empty (which it shouldn't be if an informative utterance has been added)
                      if (Object.keys(data.context_checks_mapping).length > 0) {
                        //Use the first output by Vampire by default. Can be changed in history.
                        glyph = data.context_checks_mapping[0].glyph;
                        info = data.context_checks_mapping[0].informative
                        consistent = data.context_checks_mapping[0].consistent;
                      }

                      //Analyze vampire output
                      //if consistent is false, say your input doesn't make sense. If informative is false, say your input is not informative
                      var message = "Okay ...";
                      if (consistent === null) {
                        "Okay ..."
                      }
                      else if (!consistent) {
                        message = "Your input does not make sense."
                      } else if (!info) {
                        message = "Your input is not informative."
                      } else {
                        message = "Your input is consistent and informative."
                      }

                      // Ensure bot response is only pushed when `userSem` has data
                      console.log(message, glyph);
                      this.chatHistory.push({ text: message, sender: 'Bot',
                        glyph: glyph, showGlyph: false });

                    }
                  },
                  error => {
                    console.log("An error occured during the call to vampire")
                  }                  );

              } else {
                this.chatHistory.push({text: "No semantic analyses found for this input!", sender: 'Bot'});
                return
              }

            },
            error => {
              console.log('ERROR: ', error);
              console.log("Sent following request: ", gswbRequest);
              this.chatHistory.push({text: "An error occurred during the semantic analysis", sender: 'Bot'});
              return

              const userSem = `[${new Date().toLocaleTimeString()}] No solutions found.`;

              // Ensure bot response is pushed even in case of an error
              this.chatHistory.push({ text: `You said:\n "${userSem}"`, sender: 'Bot' });
            }
          );
        } else {
          this.chatHistory.push({text: "Could not find meaning constructors for this input!", sender: 'Bot'});
          return
        }
      },
      error => {
        console.log('ERROR: ', error);
      }
    );

    // Clear user input before bot response
    this.userInput = '';
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
