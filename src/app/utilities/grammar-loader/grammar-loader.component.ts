import { Component, ElementRef, ViewChild, OnInit, AfterViewInit, ChangeDetectorRef, OnChanges, SimpleChanges, Input } from '@angular/core';
import { DataService } from "../../data.service";
import { FileTree } from "../../models/models";
import { tap } from 'rxjs/operators';
import {ToggleDisplayComponent} from "../toggle-display/toggle-display.component";  // Import tap operator
import { EventEmitter, Output } from '@angular/core';
import { APP_DEFAULTS } from '../../app-defaults';
import { LigerFileSource } from '../../liger-workspace/liger-file-source.service';
import { LigerWorkspaceService } from '../../liger-workspace/liger-workspace.service';

/** LiGER answers with its working directory prefixed (`/…/liger/./grammars/…`). Sessions
 *  store the relative form, which resolves the same in every deployment. */
export function serverRelative(path: string): string {
  const cut = path.indexOf('/./');
  return cut >= 0 ? path.slice(cut + 1) : path;
}

/** Whether two spellings of a path (relative, prefixed, with or without `./`) name the same
 *  file. */
export function sameFile(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (p: string) => serverRelative(p).replace(/^\.\//, '');
  return norm(a) === norm(b);
}

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

  /** The LiGER configs found beside the loaded grammar, offered for loading. Loading the
   *  grammar never opens one by itself: the pairing is offered, the choice is the user's. */
  grammarConfigs: string[] = [];
  /** The grammar `grammarConfigs` belong to, so a late answer for another one is dropped. */
  private configsFor = '';

  constructor(private dataService: DataService, private cd: ChangeDetectorRef,
              private ligerFiles: LigerFileSource, readonly workspace: LigerWorkspaceService) {}

  ngOnInit() {
    this.getGrammars(this.grammarsDirectory);
    console.log("Initial file tree:", this.grammarFileTree);
    this.selectedPath = this.loadedPath || this.defaultGrammar;

    if (this.loadedPath) {
      this.refreshStatusMessage();
      this.listGrammarConfigs(this.loadedPath);
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
    if (changes['loadedPath'] && !changes['loadedPath'].firstChange) {
      this.listGrammarConfigs(this.loadedPath);
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
          this.listGrammarConfigs(this.selectedPath);
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

  /** Asks LiGER for the configs in the grammar's folder and its liger/ folder. */
  listGrammarConfigs(grammarPath: string): void {
    this.configsFor = grammarPath;
    this.grammarConfigs = [];
    if (!grammarPath) {
      return;
    }
    this.ligerFiles.listConfigsForGrammar(grammarPath).subscribe({
      next: paths => {
        if (this.configsFor === grammarPath) {
          this.grammarConfigs = (paths ?? []).map(serverRelative);
        }
      },
      error: error => console.warn('[Grammar] could not list LiGER configs for', grammarPath, error),
    });
  }

  configName(path: string): string {
    return path.substring(path.lastIndexOf('/') + 1);
  }

  isOpenConfig(path: string): boolean {
    const state = this.workspace.state;
    return sameFile(state.ruleSet?.source, path) && !sameFile(state.openFailed, path);
  }

  /** Opens the config in the LiGER workspace every view shares. */
  loadConfig(path: string): void {
    if (this.workspace.hasEdits && typeof window !== 'undefined'
        && !window.confirm(`Load ${this.configName(path)}? Your in-memory rule set edits will be lost.`)) {
      return;
    }
    this.workspace.open(path);
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
