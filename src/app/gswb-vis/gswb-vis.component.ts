import {Component, ElementRef, ViewChild} from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { SemComponent } from './sem/sem.component';
import { LogComponent } from './log/log.component';
import { EditorComponent } from '../editor/editor.component';
import { DataService } from '../data.service';
import {DerivationContainerComponent} from "./derivation-container/derivation-container.component";
import {DialogComponent} from "../dialog/dialog.component";
import {GswbRequest,GswbPreferences} from "../models/models";
import {GswbSettingsComponent} from "./gswb-settings/gswb-settings.component";
import {SemVisComponent} from "../sem-vis/sem-vis.component";


@Component({
  selector: 'app-gswb-vis',
  templateUrl: './gswb-vis.component.html',
  styleUrls: ['./gswb-vis.component.css']
})


export class GswbVisComponent {
  @ViewChild('edit1') editor1: EditorComponent;
  @ViewChild('derivation') derivationContainer: DerivationContainerComponent;
  @ViewChild('sem1') sem: EditorComponent;
  @ViewChild('semvis') semvis: SemVisComponent;
  @ViewChild('log1') log: EditorComponent;
  @ViewChild('dialog') dialog: DialogComponent;
  @ViewChild('gswbPrefs') gswbPreferences : GswbSettingsComponent;
  @ViewChild('errorhandle') errorhandle: ElementRef;

  ngAfterViewInit() {
    if (this.gswbPreferences) {
      this.gswbPreferences.gswbPreferences = {
        prover: 1,
        debugging: false,
        outputstyle: 4,
        parseSem: false,
        resolveDrs: true,
        betaReduce: true,
        glueOnly: false,
        meaningOnly: false,
        explainFail: false,
        naturalDeductionStyle: 0,
      };
      this.gswbPreferences.updateFormFromPreferences(this.gswbPreferences.gswbPreferences)
    } else {
      console.error("ERROR: `gswbPreferences` ViewChild not initialized!");
    }
  }



  constructor(private dataService: DataService) {

  }
  loading: boolean = false;

  calculateSemantics(){
    this.loading = true;

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
          if (data.solutions.length > 0) {
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

  displayMessage(message: string, color: string) {
    this.errorhandle.nativeElement.style.color = color;
    this.errorhandle.nativeElement.innerHTML = "[" + new Date().toLocaleTimeString() + "] " + message;
  }


}
// Inside ParentComponent


