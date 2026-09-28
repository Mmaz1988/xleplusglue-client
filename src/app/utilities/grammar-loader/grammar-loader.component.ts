import { Component, ElementRef, ViewChild, OnInit, AfterViewInit, ChangeDetectorRef, OnChanges, SimpleChanges, Input } from '@angular/core';
import { DataService } from "../../data.service";
import { FileTree } from "../../models/models";
import { tap } from 'rxjs/operators';
import {ToggleDisplayComponent} from "../toggle-display/toggle-display.component";  // Import tap operator
import { EventEmitter, Output } from '@angular/core';
import { APP_DEFAULTS } from '../../app-defaults';
import { LigerFileSource } from '../../liger-workspace/liger-file-source.service';
import { LigerWorkspaceService } from '../../liger-workspace/liger-workspace.service';
import { sameFile, serverRelative } from '../../liger-workspace/liger-paths';

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

  /** What happened to the grammar's LiGER config on the last grammar load, for the status
   *  line: its config opens with it unless one was picked by hand (LiGER config selection). */
  configNote = '';
  /** The grammar the config lookup is for, so a late answer for another one is dropped. */
  private configsFor = '';

  constructor(private dataService: DataService, private cd: ChangeDetectorRef,
              private ligerFiles: LigerFileSource, readonly workspace: LigerWorkspaceService) {}

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
          this.openGrammarConfig(this.selectedPath);
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

  /** Opens the grammar's LiGER config (the one in its folder or its liger/ folder), unless
   *  the rule set was picked by hand or a session's is being restored. With none or several
   *  beside the grammar, the rule set stays and the status says why. */
  openGrammarConfig(grammarPath: string): void {
    this.configsFor = grammarPath;
    this.configNote = '';
    this.ligerFiles.listConfigsForGrammar(grammarPath).subscribe({
      next: paths => {
        if (this.configsFor !== grammarPath) {
          return;
        }
        const configs = (paths ?? []).map(serverRelative);
        if (configs.length === 0) {
          this.configNote = 'no LiGER config beside it';
        } else if (configs.length > 1) {
          this.configNote = `${configs.length} LiGER configs beside it: select one under LiGER config selection`;
        } else if (!this.workspace.yieldsToGrammar) {
          this.configNote = 'LiGER config kept (selected by hand)';
        } else {
          this.openConfig(configs[0]);
        }
        this.refreshStatusMessage();
      },
      error: error => console.warn('[Grammar] could not list LiGER configs for', grammarPath, error),
    });
  }

  private openConfig(path: string): void {
    const state = this.workspace.state;
    if (!state.loading && sameFile(state.ruleSet?.source, path) && !sameFile(state.openFailed, path)) {
      this.workspace.markOrigin('grammar');  // already open: keep it, edits included
      return;
    }
    if (this.workspace.hasEdits && typeof window !== 'undefined'
        && !window.confirm(`Open ${path}, the grammar's LiGER config? Your in-memory rule set edits will be lost.`)) {
      this.configNote = 'LiGER config kept (unsaved edits)';
      return;
    }
    this.workspace.open(path, undefined, 'grammar');
  }

  private refreshStatusMessage(): void {
    if (!this.loadedPath) {
      this.currentStatusMessage = this.selectedPath
        ? `Selected grammar: ${this.selectedPath}`
        : '';
      return;
    }

    const modified = this.selectedPath !== this.loadedPath;
    const note = this.configNote ? ` · ${this.configNote}` : '';
    this.currentStatusMessage = `Currently loaded grammar: ${this.loadedPath}${modified ? ' (modified)' : ''}${note}`;
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
