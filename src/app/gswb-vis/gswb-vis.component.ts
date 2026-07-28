import {Component, ElementRef, ViewChild, AfterViewInit, Input, Output, EventEmitter} from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { SemComponent } from './sem/sem.component';
import { LogComponent } from './log/log.component';
import { EditorComponent } from '../editor/editor.component';
import { DataService } from '../data.service';
import {DerivationContainerComponent} from "./derivation-container/derivation-container.component";
import {DialogComponent} from "../utilities/dialog/dialog.component";
import {GswbRequest,GswbPreferences, GswbSolution} from "../models/models";
import {GswbSettingsComponent} from "./gswb-settings/gswb-settings.component";
import {SemVisComponent} from "../sem-vis/sem-vis.component";
import { GswbWorkspaceState } from "../analysis-workspace-state.service";
import { APP_DEFAULTS } from "../app-defaults";
import { forkJoin } from 'rxjs';


@Component({
  selector: 'app-gswb-vis',
  templateUrl: './gswb-vis.component.html',
  styleUrls: ['./gswb-vis.component.css']
})


export class GswbVisComponent implements AfterViewInit {
  @Input() canPostProcess = false;
  @Input() postProcessingLoading = false;
  @Input() previousSemanticSolutions: string[] = [];
  @Output() postProcessing = new EventEmitter<'inline' | 'standalone'>();

  @ViewChild('edit1') editor1: EditorComponent;
  @ViewChild('derivation') derivationContainer: DerivationContainerComponent;
  @ViewChild('sem1') sem: EditorComponent;
  @ViewChild('semvis') semvis: SemVisComponent;
  @ViewChild('log1') log: EditorComponent;
  @ViewChild('dialog') dialog: DialogComponent;
  @ViewChild('gswbPrefs') gswbPreferences : GswbSettingsComponent;
  @ViewChild('errorhandle') errorhandle: ElementRef;
  meaningConstructors = '';
  private hasSemanticSolutions = false;
  semanticSolutionReady = false;
  postProcessingMode: 'inline' | 'standalone' = 'inline';

  private pendingState: GswbWorkspaceState | null = null;

  ngAfterViewInit() {
    if (this.gswbPreferences) {
      this.gswbPreferences.gswbPreferences = { ...APP_DEFAULTS.gswb.preferences };
      this.gswbPreferences.updateFormFromPreferences(this.gswbPreferences.gswbPreferences)
    } else {
      console.error("ERROR: `gswbPreferences` ViewChild not initialized!");
    }

    this.applyPendingState();
  }



  constructor(private dataService: DataService) {

  }
  loading: boolean = false;

  calculateSemantics(){
    this.loading = true;
    this.hasSemanticSolutions = false;
    this.semanticSolutionReady = false;

    this.updateMeaningConstructors();

    this.gswbPreferences.onSubmit();

    const gswbRequest: GswbRequest = {
      premises: this.editor1.getContent(),
      gswbPreferences: this.gswbPreferences.gswbPreferences
    }

    this.displayMessage("[" +  new Date().toLocaleTimeString() + "] Sending request to GSWB ...", "blue");
    this.dataService.gswbDeduce(gswbRequest).subscribe(
      data => {
        this.loading = false;
        // Handle the data here...
        // Depending on the structure of the data you might need to modify the below code.
        if (data.hasOwnProperty('solutions')) {
          // log each element in data.solutions individually


          //Check if data.solutions is not null and not empty
           if (data.solutions.some(solution =>
             typeof solution?.solution === 'string' && solution.solution.trim().length > 0)) {
             this.hasSemanticSolutions = true;
             this.semanticSolutionReady = true;
            console.log("Solutions:", data.solutions)
            // data.solutions.forEach(element => {
            //   console.log(element);
            //   //print solutions line by line to sem
            //   this.sem.updateContent(element);
            // });
            //translate data.solutions to string with each solution in a new line
            //let solutions = data.solutions.join('\n');

            this.semvis.clearMc();
            this.semvis.clearScope();
            this.semvis.applyFiltersAndResetIndex();

             this.semvis.setItems(data.solutions);
             this.semvis.setDiscriminants(data.discriminants);
             this.mergeCurrentSolutions(data.solutions);
           // this.sem.updateContent(solutions);
          } else {
            //create error message with request time stamp
            //create gswb solution with no solutions found and create list to treat as semvis
            this.semvis.setItems([{solution: "[" +  new Date().toLocaleTimeString() + "] No solutions found.", id: "S0"}]);
          }
        } else {
          this.semvis.setItems([{solution: "[" +  new Date().toLocaleTimeString() + "] No solutions found.", id: "S0"}]);
        }

        if (data.hasOwnProperty('log'))
        {
          this.log.updateContent(data.log)
        }

        if (data.hasOwnProperty('derivation') && this.gswbPreferences.gswbPreferences.explainFail) {
          console.log(data.derivation)

          //check if derivation is a string or an object


     if (data.derivation.hasOwnProperty('graphElements'))
          {
            console.log(data.derivation.graphElements);
            this.derivationContainer.showEditor = false;
            this.derivationContainer.showGraph = true;
            const graphElements = data.derivation.graphElements;
            // Using setTimeout to enqueue the function call after the current execution context
            setTimeout(() => {
              this.derivationContainer.graphVisUpdateContent(graphElements);
            }, 0);

            //this.dialog.setContent(graphElements)
            this.dialog.setContent({ kind: 'graph', graph: graphElements });

          } else
          {
            this.derivationContainer.showGraph = false;
            this.derivationContainer.showEditor = true;
            // Using setTimeout to enqueue the function call after the current execution context
            setTimeout(() => {
              this.derivationContainer.editorVisUpdateContent(data.derivation.toString());
            }, 0);
            this.dialog.setContent(data.derivation.toString());
          }
                  // Update your component's property bound to your logContainerElement here...

        }
        this.displayMessage("GSWB deduction completed.", "green");
      },
      error => {
        console.log('ERROR: ', error);
        this.loading = false;
        // this.sem.updateContent("[" +  new Date().toLocaleTimeString() + "] An error occurred.");
        this.displayMessage( "An error occurred during GSWB deduction.", "red");
        console.log("Sent following request: ", gswbRequest);
      }
    );

    // Now, you can send 'editorContent' to your backend.
    // Use your preferred method to send data to backend (for instance, HttpClient).
  }

  requestPostProcessing(mode: 'inline' | 'standalone'): void {
    this.postProcessing.emit(mode);
  }

  displayMessage(message: string, color: string) {
    this.errorhandle.nativeElement.style.color = color;
    this.errorhandle.nativeElement.innerHTML = "[" + new Date().toLocaleTimeString() + "] " + message;
  }


  updateMeaningConstructors() {
    this.meaningConstructors = this.editor1?.getContent() ?? '';
  }

  onSemanticSelectionChange(selection: { items: any[] }): void {
    this.semanticSolutionReady = this.hasSemanticSolutions
      && Array.isArray(selection?.items)
      && selection.items.some(solution =>
        typeof solution?.solution === 'string' && solution.solution.trim().length > 0);
  }

  private mergeCurrentSolutions(solutions: GswbSolution[]): void {
    const previous = this.previousSemanticSolutions.filter(
      semantic => typeof semantic === 'string' && semantic.trim().length > 0);
    if (!previous.length) {
      return;
    }

    const current = solutions.filter(solution =>
      typeof solution?.semantic === 'string' && solution.semantic.trim().length > 0);
    if (!current.length) {
      this.hasSemanticSolutions = false;
      this.semanticSolutionReady = false;
      return;
    }

    forkJoin(current.map(solution => this.dataService.gswbMergeSequenceSemantics({
      semantics: [...previous, solution.semantic as string],
      parentSolutionId: solution.id,
    }))).subscribe(mergedSolutions => {
      this.semvis.setItems(mergedSolutions);
      this.semvis.setDiscriminants([]);
      this.hasSemanticSolutions = mergedSolutions.length > 0;
      this.semanticSolutionReady = this.hasSemanticSolutions;
    }, () => {
      this.hasSemanticSolutions = false;
      this.semanticSolutionReady = false;
    });
  }

  captureState(): GswbWorkspaceState | null {
    if (!this.editor1 || !this.semvis || !this.gswbPreferences || !this.log) {
      return this.pendingState;
    }

    return {
      meaningConstructors: this.meaningConstructors ?? '',
      editorText: this.editor1.getContent(),
      logText: this.log.getContent(),
      gswbPreferences: { ...this.gswbPreferences.gswbPreferences },
      semvis: this.semvis.captureState(),
    };
  }

  restoreState(state: GswbWorkspaceState | null): void {
    this.pendingState = state;
    this.applyPendingState();
  }

  private applyPendingState(): void {
    const state = this.pendingState;
    if (!state || !this.editor1 || !this.semvis || !this.gswbPreferences || !this.log) {
      return;
    }

    this.meaningConstructors = state.meaningConstructors ?? '';
    this.editor1.updateContent(state.editorText ?? '');
    this.log.updateContent(state.logText ?? '');

    const prefs = state.gswbPreferences ?? APP_DEFAULTS.gswb.preferences;
    this.gswbPreferences.gswbPreferences = { ...prefs };
    this.gswbPreferences.updateFormFromPreferences(this.gswbPreferences.gswbPreferences);

    this.semvis.restoreState(state.semvis);
    this.hasSemanticSolutions = Array.isArray(state.semvis?.items)
      && state.semvis.items.some((solution: any) =>
        typeof solution?.solution === 'string' && solution.solution.trim().length > 0);
    this.semanticSolutionReady = this.hasSemanticSolutions;
    this.pendingState = null;
  }

}


// Inside ParentComponent
