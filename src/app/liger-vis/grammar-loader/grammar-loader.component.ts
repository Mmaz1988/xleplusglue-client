import {Component, ElementRef, ViewChild, OnInit} from '@angular/core';
import {DataService} from "../../data.service";
import {GrammarString} from "../../models/models";
import { tap } from 'rxjs/operators';  // Import tap operator

@Component({
  selector: 'app-grammar-loader',
  templateUrl: './grammar-loader.component.html',
  styleUrls: ['./grammar-loader.component.css']
})
export class GrammarLoaderComponent {

  //This should have to variables, a list of strings which refer to grammars and a string which refers to the current grammar
  //The list of strings should be populated by a call to the backend
  //The string should be be empty by default and should be populated by the user selecting a grammar from the list

  constructor(private dataService: DataService) {
  }
  @ViewChild('grammarListSelector') grammarListSelector: ElementRef;

  grammarList: string[] = [];
  defaultGrammar: string = "/grammars/hybrid-drt-tense.lfg.glue";


  ngOnInit() {
    this.getGrammars().subscribe(
      () => {
        if (this.grammarList.includes(this.defaultGrammar)) {
          this.updateGrammar(this.defaultGrammar);
        }
      },
      error => {
        console.log('ERROR: ', error);
      }
    );
  }

  // checkFirstLoad(): void {
  //   // Check if the session storage already has the 'firstLoad' item
  //   const firstLoad = sessionStorage.getItem('firstLoad');
  //
  //   if (!firstLoad) {
  //     // This means it's the first load in this session
  //     this.updateGrammar(this.defaultGrammar);
  //
  //     // Set the 'firstLoad' item to indicate the function has been called
  //     sessionStorage.setItem('firstLoad', 'true');
  //   }
  //}

  /*
  getGrammars(){console.log("Getting grammars")
    this.dataService.getGrammars().subscribe(

      data => {
        if (data.hasOwnProperty("grammarList")) {
          //add each element of the grammar list to the grammarList array
          for (let grammar of data.grammarList) {
            this.grammarList.push(grammar);
          }
        }
      }
      ,
      error => {
        console.log('ERROR: ', error);
      }
    );}

   */

  getGrammars() {
    console.log("Getting grammars");
    return this.dataService.getGrammars().pipe(
      tap(data => {
        if (data.hasOwnProperty("grammarList")) {
          this.grammarList = data.grammarList;
        }
      })
    );
  }

  updateGrammar(selectedValue: String) {
    console.log("Changing grammar to: " + this.grammarListSelector.nativeElement.value)
    //update the current grammar string
    this.dataService.changeGrammar({grammar: selectedValue}).subscribe(
      data => {
        console.log(data);
        if (data.hasOwnProperty("grammar")) {
          //update the current grammar string
          if (data.grammar.hasOwnProperty("grammar")) {
            console.log("Successfully changed grammar to: " + data.grammar.grammar);
            //Change selected value of grammarListSelector to the new grammar
            this.grammarListSelector.nativeElement.value = selectedValue
          }
        }
      }
      ,
        error => {
          console.log('ERROR: ', error);
        }
    );
  }

}
