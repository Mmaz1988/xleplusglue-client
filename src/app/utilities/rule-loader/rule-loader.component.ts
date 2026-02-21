import {
  Component,
  ElementRef,
  ViewChild,
  OnInit,
  AfterViewInit,
  ChangeDetectorRef,
  Output,
  EventEmitter
} from '@angular/core';
import { DataService } from "../../data.service";
import { FileTree } from "../../models/models";
import { tap } from 'rxjs/operators';
import {ToggleDisplayComponent} from "../toggle-display/toggle-display.component";  // Import tap operator

@Component({
  selector: 'app-rule-loader',
  templateUrl: './rule-loader.component.html',
  styleUrls: ['./rule-loader.component.css']
})
export class RuleLoaderComponent implements OnInit,AfterViewInit {

  @ViewChild('ruleListSelector') ruleListSelector: ElementRef;
  @ViewChild('statusMessage') statusMessageDiv: ElementRef;
  @ViewChild('toggleDisplayComponent') toggleDisplayComponent: ToggleDisplayComponent;

  @Output() dataEmitter = new EventEmitter<string>();

  defaultRules: string = "./liger_resources/rules/be_axiom_rule.txt";
  rulesDirectory: string = "./liger_resources/rules";
  currentStatusMessage: string = ""
  rulesFileTree: FileTree[] = [];  // Initialize as an empty array
  selectedPath: string = "";  // This will store the selected file or folder path
  rules: string = "";
  // selectedIsDirectory: boolean = false;  // This will store if the selected path is a directory

  constructor(private dataService: DataService, private cd: ChangeDetectorRef) {}

  ngOnInit() {
    this.getRules(this.rulesDirectory);
    console.log("Initial file tree:", this.rulesFileTree);
    this.selectedPath = this.defaultRules
    this.updateRules();
    this.sendRules()
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
    this.selectedPath = path;  // Store the selected path
    // this.selectedIsDirectory = this.grammarFileTree.find(node => node.path === path).isDirectory;  // Store if the selected path is a directory
  }

  // Method to change the grammar using the selected path
  updateRules() {
    if (!this.selectedPath) {
      console.error("No file or folder selected!");
      return;
    }

    console.log("Changing rules to: " + this.selectedPath);

    // Update the current grammar string
    this.dataService.loadRules({ grammar: this.selectedPath}).subscribe(
      data => {
        console.log(data);
        if (data.hasOwnProperty("grammar")) {
          console.log("Successfully loaded rules: " + this.selectedPath);
          // this.grammarListSelector.nativeElement.value = this.selectedPath;
          this.currentStatusMessage = "Currently loaded rules: " + this.selectedPath;
          this.cd.detectChanges();
          this.toggleDisplayComponent.isHidden = true;
          this.rules = data.grammar;
          this.sendRules()
        } else {
          this.currentStatusMessage = "Failed to load rules: " + this.selectedPath;
        }
      },
      error => {
        console.log('ERROR: ', error);
        this.currentStatusMessage = "Failed to load rules: " + this.selectedPath;
      }
    );
  }

  getRules(directory: string) {
    console.log("Fetching grammars via POST request");

    this.dataService.getFileTree({ grammar : directory }).subscribe(
      data => {
        console.log(data)
        if (data.hasOwnProperty("children")) {
          console.log("Rule file tree:", data.children);
          this.rulesFileTree = this.buildFileTree(data.children); // Pass only children
        }
      },
      error => {
        console.error("Failed to fetch rules:", error);
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
  sendRules() {
    this.dataEmitter.emit(this.rules);
  }

}

