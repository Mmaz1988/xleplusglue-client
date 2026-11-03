import {ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild} from '@angular/core';
import {ToggleDisplayComponent} from "../toggle-display/toggle-display.component";
import {FileTree} from "../../models/models";
import {DataService} from "../../data.service";

//type LoaderMode = 'grammar' | 'rules' | 'axioms' | 'testsuite';

@Component({
  selector: 'app-file-loader',
  templateUrl: './file-loader.component.html',
  styleUrls: ['./file-loader.component.css']
})

export class FileLoaderComponent implements OnChanges {

  @ViewChild('grammarListSelector') grammarListSelector: ElementRef;
  @ViewChild('statusMessage') statusMessageDiv: ElementRef;
  @ViewChild('toggleDisplayComponent') toggleDisplayComponent: ToggleDisplayComponent;

  // Parameterization from HTML
  //@Input() mode: LoaderMode = 'grammar';
  @Input() defaultFilePath!: string;
  @Input() filesDirectory!: string;
  @Input() displayName = 'file';
  @Input() currentContent = '';
  @Input() loadedPath = '';
  @Input() loadedContent = '';

  @Output() dataEmitter = new EventEmitter<string>();
  @Output() fileLoaded = new EventEmitter<{ path: string; content: string }>();
  @Output() stateChange = new EventEmitter<{ path: string; loadedContent: string }>();

  // state
  noFileSelected = true;

  grammarList: string[] = [];
  //defaultGrammar: string = "./grammars/fracas_inference_grammar/main_fracas_grammar.lfg.glue";
  //grammarsDirectory: string = "./grammars";
  currentStatusMessage: string = ""
  fileTree: FileTree[] = [];  // Initialize as an empty array
  selectedPath: string = "";  // This will store the selected file or folder path
  fileContent: string = "";
  // selectedIsDirectory: boolean = false;  // This will store if the selected path is a directory

  constructor(private dataService: DataService, private cd: ChangeDetectorRef) {}

  ngOnInit() {
    this.getFileTree(this.filesDirectory);

    if (this.defaultFilePath && this.defaultFilePath.trim().length > 0) {
      this.setFileSelected(this.defaultFilePath);
      this.updateFile();
    } else {
      this.setNoFileSelected();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      (changes['currentContent'] && !changes['currentContent'].firstChange) ||
      (changes['loadedPath'] && !changes['loadedPath'].firstChange) ||
      (changes['loadedContent'] && !changes['loadedContent'].firstChange)
    ) {
      this.refreshStatusMessage();
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

  // Method to handle the file/folder selection from the file tree
  onFileSelected(path: string) {
    console.log("Selected path from file tree:", path);

    if (!path) {
      this.setNoFileSelected();
      return;
    }

    this.setFileSelected(path);
  }

  // Method to change the grammar using the selected path
  updateFile() {
    if (!this.selectedPath) {
      this.setNoFileSelected();   // <- instead of only console.error
      return;
    }

    console.log("Changing rules to: " + this.selectedPath);

    this.dataService.loadRules({ grammar: this.selectedPath }).subscribe(
      data => {
        if (data && data.hasOwnProperty("grammar")) {
          console.log("Successfully loaded file: " + this.selectedPath);

          this.noFileSelected = false;
          this.loadedPath = this.selectedPath;
          this.loadedContent = data.grammar;
          this.toggleDisplayComponent.isHidden = true;

          this.fileContent = data.grammar;
          this.sendFiles();
          this.fileLoaded.emit({ path: this.selectedPath, content: this.fileContent });
          this.stateChange.emit({ path: this.loadedPath, loadedContent: this.loadedContent });
          this.refreshStatusMessage();
          this.cd.detectChanges();
        } else {
          // response didn't contain expected payload => reset
          this.setNoFileSelected("Failed to load file. No file selected.");
        }
      },
      error => {
        console.log('ERROR: ', error);
        this.setNoFileSelected("Failed to load file. No file selected.");
      }
    );
  }

  getFileTree(directory: string) {
    console.log("Fetching grammars via POST request");

    this.dataService.getFileTree({ grammar : directory }).subscribe(
      data => {
        console.log(data)
        if (data.hasOwnProperty("children")) {
          console.log("Grammar file tree:", data.children);
          this.fileTree = this.buildFileTree(data.children); // Pass only children
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

  sendFiles() {
    this.dataEmitter.emit(this.fileContent);
  }

  // helpers
  private setNoFileSelected(message = 'No file selected.'): void {
    this.noFileSelected = true;
    this.selectedPath = '';
    this.loadedPath = '';
    this.loadedContent = '';
    this.fileContent = '';
    this.currentStatusMessage = message;
    this.sendFiles();            // emit empty content so parent can react
    this.fileLoaded.emit({ path: '', content: '' });
    this.stateChange.emit({ path: '', loadedContent: '' });
    this.cd.detectChanges();
  }

  private setFileSelected(path: string): void {
    this.noFileSelected = false;
    this.selectedPath = path;
  }

  private refreshStatusMessage(): void {
    if (this.noFileSelected || !this.loadedPath) {
      return;
    }

    const modified = (this.currentContent ?? '') !== (this.loadedContent ?? this.fileContent ?? '');
    this.currentStatusMessage = `Currently loaded ${this.displayName}: ${this.loadedPath}${modified ? ' (modified)' : ''}`;
  }

}
