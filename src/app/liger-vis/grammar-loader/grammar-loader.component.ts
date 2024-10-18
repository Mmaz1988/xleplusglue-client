import { Component, ElementRef, ViewChild, OnInit, ChangeDetectorRef } from '@angular/core';
import { DataService } from "../../data.service";
import { FileTree } from "../../models/models";
import { tap } from 'rxjs/operators';
import {ToggleDisplayComponent} from "../../toggle-display/toggle-display.component";  // Import tap operator

@Component({
  selector: 'app-grammar-loader',
  templateUrl: './grammar-loader.component.html',
  styleUrls: ['./grammar-loader.component.css']
})
export class GrammarLoaderComponent implements OnInit {

  @ViewChild('grammarListSelector') grammarListSelector: ElementRef;
  @ViewChild('statusMessage') statusMessageDiv: ElementRef;
  @ViewChild('toggleDisplayComponent') toggleDisplayComponent: ToggleDisplayComponent;

  grammarList: string[] = [];
  defaultGrammar: string = "./grammars/hybrid-drt-tense.lfg.glue";
  currentStatusMessage: string = ""
  grammarFileTree: FileTree[] = [];  // Initialize as an empty array
  selectedPath: string = "";  // This will store the selected file or folder path

  constructor(private dataService: DataService, private cd: ChangeDetectorRef) {}

  ngOnInit() {
    this.getGrammars().subscribe(
      () => {
        console.log("Grammar file tree: ", this.grammarFileTree);
        this.toggleDisplayComponent.isHidden = true;
        this.selectedPath = this.defaultGrammar;
        this.updateGrammar()
      },
      error => {
        console.log('ERROR: ', error);
      }
    );
  }

  // Method to handle the file/folder selection from the file tree
  onFileSelected(path: string) {
    console.log("Selected path from file tree:", path);
    this.selectedPath = path;  // Store the selected path
  }

  // Method to change the grammar using the selected path
  updateGrammar() {
    if (!this.selectedPath) {
      console.error("No file or folder selected!");
      return;
    }

    console.log("Changing grammar to: " + this.selectedPath);

    // Update the current grammar string
    this.dataService.changeGrammar({ grammar: this.selectedPath }).subscribe(
      data => {
        console.log(data);
        if (data.hasOwnProperty("grammar") && data.grammar === "success") {
          console.log("Successfully changed grammar to: " + this.selectedPath);
          // this.grammarListSelector.nativeElement.value = this.selectedPath;
          this.currentStatusMessage = "Currently loaded grammar: " + this.selectedPath;
          this.cd.detectChanges();
          this.toggleDisplayComponent.isHidden = true;
        } else {
          this.currentStatusMessage = "Failed to load grammar: " + this.selectedPath;
        }
      },
      error => {
        console.log('ERROR: ', error);
        this.currentStatusMessage = "Failed to load grammar: " + this.selectedPath;
      }
    );
  }

  getGrammars() {
    console.log("Getting grammars");
    return this.dataService.getGrammars().pipe(
      tap(data => {
        if (data.hasOwnProperty("children")) {
          console.log("Grammar file tree: ", this.grammarFileTree);
          this.grammarFileTree = this.buildFileTree(data.children);  // Pass only children
        }
      })
    );
  }

  buildFileTree(nodes: any[]): any[] {
    return nodes.map(node => ({
      name: node.name,
      path: node.path,
      directory: node.directory,
      children: node.children ? this.buildFileTree(node.children) : []
    }));
  }
}
