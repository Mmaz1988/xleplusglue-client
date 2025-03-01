import {ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, Output, ViewChild} from '@angular/core';
import {DataService} from "../../data.service";
import {context, GswbPreferences, GswbRequest, vampireRequest} from "../../models/models";
import {GswbSettingsComponent} from "../../gswb-vis/gswb-settings/gswb-settings.component";
import {error} from "@angular/compiler-cli/src/transformers/util";

interface ChatMessage {
  text: string;
  sender: 'User' | 'Bot';
}

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent {

  constructor(private dataService: DataService,  private changeDetector: ChangeDetectorRef) {
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

    // 0 = parsing success
    // 10 = parsing failure
    // 11 derivation failure
    // 12 no mcs
    let responseStatus: number = 0

    // Add user message to history
    this.chatHistory.push({ text: userMessage, sender: 'User' });

    const ligerRequest = { sentence: userMessage, ruleString: this.ruleString };

    this.dataService.ligerAnnotate(ligerRequest).subscribe(
      data => {
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

        if (data.hasOwnProperty("meaningConstructors")) {
          console.log(data.meaningConstructors);
          this.meaningConstructors = data.meaningConstructors;

          // Prepare GSWB request

          if (this.gswbPreferences.gswbPreferences.prover !== 1 && this.gswbPreferences.gswbPreferences.outputstyle !== 4) {
            console.log("GSWB preferences not set to default values.")
            this.gswbPreferences.onSubmit();
          }

          const gswbRequest: GswbRequest = {
            premises: this.meaningConstructors,
            gswbPreferences: this.gswbPreferences.gswbPreferences
          };

          console.log("GSWB request: ", gswbRequest);

          this.dataService.gswbDeduce(gswbRequest).subscribe(
            data => {
              console.log("GSWB result:", data);
              let userSem = '';

              if (data.hasOwnProperty('solutions') && data.solutions.length > 0 && data.solutions[0] != '') {
                userSem = data.solutions.join('\n');

                //dummy boolean for pruning context

                const pruneContext: boolean = this.contextPruning.nativeElement.checked; // Read checkbox state

                const vampRequest: vampireRequest = { text: userMessage, context : this.context,
                                                      axioms: this.axioms, hypothesis : userSem , pruning : pruneContext,
                                                      active_indices: this.activeIndices};

                console.log("Vampire request: ", vampRequest)

                this.dataService.callVampire(vampRequest).subscribe(
                  data => {
                    this.clearSelected();
                    console.log("Vampire output: ", data)
                    if (data.hasOwnProperty("context")){
                      const newContext = data.context;
                      console.log("Current context: ", newContext)
                      // Add to existing array without creating a new array reference
                      this.history.push(newContext);
                      this.context = newContext


                      // Emit to parent to notify change
                      this.historyChange.emit(this.history);
                      // Manually trigger change detection
                      this.changeDetector.detectChanges();
                    }
                  },
                  error => {
                    console.log("An error occured during the call to vampire")
                  }                  );

                /**
                 * Insert reasoning here
                 */

              } else {
                this.chatHistory.push({text: "No semantic analyses found for this input!", sender: 'Bot'});
                return
              }

              // Ensure bot response is only pushed when `userSem` has data
              this.chatHistory.push({ text: `Found the following analysis:\n "${userSem}"`, sender: 'Bot' });
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

  callVampire(sem: string)
  {

  }
}
