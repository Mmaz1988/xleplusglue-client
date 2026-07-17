import { Component, ElementRef, ViewChild, OnInit, AfterViewInit, ChangeDetectorRef, OnChanges, SimpleChanges, Input } from '@angular/core';
import { DataService } from "../../data.service";
import { FileTree } from "../../models/models";
import { tap } from 'rxjs/operators';
import {ToggleDisplayComponent} from "../toggle-display/toggle-display.component";  // Import tap operator
import { EventEmitter, Output } from '@angular/core';
import { APP_DEFAULTS } from '../../app-defaults';

@Component({
  selector: 'app-grammar-loader',
  templateUrl: './grammar-loader.component.html',
  styleUrls: ['./grammar-loader.component.css']
})
export class GrammarLoaderComponent implements OnInit,AfterViewInit, OnChanges {

  @ViewChild('grammarListSelector') grammarListSelector: ElementRef;
  @ViewChild('statusMessage') statusMessageDiv: ElementRef;
  @ViewChild('toggleDisplayComponent') toggleDisplayComponent: ToggleDisplayComponent;

  grammarList: string[] = [];
  @Output() grammarLoaded = new EventEmitter<string>();
  @Input() loadedPath = '';
  defaultGrammar: string = APP_DEFAULTS.grammar.ligerPath;
  grammarsDirectory: string = "./grammars";
  currentStatusMessage: string = ""
  grammarFileTree: FileTree[] = [];  // Initialize as an empty array
  selectedPath: string = "";  // This will store the selected file or folder path
 // selectedIsDirectory: boolean = false;  // This will store if the selected path is a directory

  constructor(private dataService: DataService, private cd: ChangeDetectorRef) {}

  ngOnInit() {
    this.getGrammars(this.grammarsDirectory);
    console.log("Initial file tree:", this.grammarFileTree);
    this.selectedPath = this.loadedPath || this.defaultGrammar;

    if (this.loadedPath) {
      this.refreshStatusMessage();
    } else {
      this.updateGrammar();
    }
  }

  ngAfterViewInit() {
    // Ensure toggleDisplayComponent is available
    if (this.toggleDisplayComponent) {
      this.toggleDisplayComponent.isHidden = true;
    } else {
      console.error("toggleDisplayComponent is still undefined in ngAfterViewInit.");
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      (changes['loadedPath'] && !changes['loadedPath'].firstChange) ||
      (changes['selectedPath'] && !changes['selectedPath'].firstChange)
    ) {
      this.refreshStatusMessage();
    }
  }

  // Method to handle the file/folder selection from the file tree
  onFileSelected(path: string) {
    console.log("Selected path from file tree:", path);
    this.selectedPath = path;  // Store the selected path
   // this.selectedIsDirectory = this.grammarFileTree.find(node => node.path === path).isDirectory;  // Store if the selected path is a directory
    this.refreshStatusMessage();
  }

  // Method to change the grammar using the selected path
  updateGrammar() {
    if (!this.selectedPath) {
      console.error("No file or folder selected!");
      return;
    }

    console.log("Changing grammar to: " + this.selectedPath);

    // Update the current grammar string
    this.dataService.changeGrammar({ grammar: this.selectedPath}).subscribe(
      data => {
        console.log(data);
        if (data.hasOwnProperty("grammar") && data.grammar === "success") {
          console.log("Successfully changed grammar to: " + this.selectedPath);
          // this.grammarListSelector.nativeElement.value = this.selectedPath;
          this.currentStatusMessage = "Currently loaded grammar: " + this.selectedPath;
          this.cd.detectChanges();
          this.toggleDisplayComponent.isHidden = true;
          this.loadedPath = this.selectedPath;
          this.grammarLoaded.emit(this.selectedPath);
          this.refreshStatusMessage();
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

  private refreshStatusMessage(): void {
    if (!this.loadedPath) {
      this.currentStatusMessage = this.selectedPath
        ? `Selected grammar: ${this.selectedPath}`
        : '';
      return;
    }

    const modified = this.selectedPath !== this.loadedPath;
    this.currentStatusMessage = `Currently loaded grammar: ${this.loadedPath}${modified ? ' (modified)' : ''}`;
  }

  captureState(): { loadedPath: string; selectedPath: string; currentStatusMessage: string } {
    return {
      loadedPath: this.loadedPath,
      selectedPath: this.selectedPath,
      currentStatusMessage: this.currentStatusMessage,
    };
  }

  restoreState(state: { loadedPath?: string; selectedPath?: string; currentStatusMessage?: string } | null): void {
    if (!state) {
      return;
    }

    this.loadedPath = state.loadedPath ?? this.loadedPath;
    this.selectedPath = state.selectedPath ?? this.selectedPath ?? this.defaultGrammar;
    this.currentStatusMessage = state.currentStatusMessage ?? this.currentStatusMessage;
    this.refreshStatusMessage();
  }

  getGrammars(directory: string) {
    console.log("Fetching grammars via POST request");

    this.dataService.getFileTree({ grammar : directory }).subscribe(
      data => {
        console.log(data)
        if (data.hasOwnProperty("children")) {
          console.log("Grammar file tree:", data.children);
          this.grammarFileTree = this.buildFileTree(data.children); // Pass only children
        }
      },
      error => {
        console.error("Failed to fetch grammars:", error);
      }
    );
  }


  buildFileTree(nodes: any[]): FileTree[] {
    return nodes.map(node => ({
      name: node.name,
      path: node.path,
      isDirectory: node.isDirectory || node.directory,  // Map correctly to isDirectory
      children: node.children && node.children.length > 0 ? this.buildFileTree(node.children) : []
    }));
  }
}
