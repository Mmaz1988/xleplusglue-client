import {Component, ViewChild, OnInit, AfterViewInit, OnDestroy} from '@angular/core';
import { GswbSettingsComponent } from "../gswb-vis/gswb-settings/gswb-settings.component";
import {context, GswbPreferences, XlePlusGlueDocument} from "../models/models";
import {ChatComponent} from "./chat/chat.component";
import {HistoryComponent} from "./history/history.component";
import {EditorComponent} from "../editor/editor.component";
import {ChangeDetectorRef} from "@angular/core";
import {InferenceSettingsComponent} from "../inference-interface/inference-settings/inference-settings.component";
import { APP_DEFAULTS } from '../app-defaults';
import { DataService } from '../data.service';
import { validateAnalysisDocument } from '../analysis-model';

@Component({
  selector: 'app-inference-vis',
  templateUrl: './chat-interface.component.html',
  styleUrls: ['./chat-interface.component.css']
})
export class ChatInterfaceComponent implements AfterViewInit, OnDestroy {

  ruleFile: string = '';
  history: context[][] = [];

  @ViewChild('gswbPrefs') gswbPreferences!: GswbSettingsComponent; // Ensures it is initialized later
  @ViewChild('vampirePrefs') vampirePreferences!: InferenceSettingsComponent; // Ensures it is initialized later
  @ViewChild('chat') chatComponent: ChatComponent;
  @ViewChild('history') historyComponent: HistoryComponent;
  @ViewChild('axiomEdit') editor: EditorComponent;

  axioms: string = APP_DEFAULTS.chat.axioms;

  selectedElements: number[] = []; // Stores selected box indices from history

  tabsInitialized = false;

  private chatDocumentSessionKey = this.newChatSessionKey();
  chatDocument: XlePlusGlueDocument = this.newChatDocument();
  private pendingChatDocumentSave: XlePlusGlueDocument | null = null;
  private chatDocumentSaveInProgress = false;

  constructor(private cdRef: ChangeDetectorRef, private dataService: DataService) {}

  ngAfterViewInit() {

    this.cdRef.detectChanges();

    if (this.gswbPreferences) {
      this.gswbPreferences.gswbPreferences = { ...APP_DEFAULTS.gswb.preferences, resolveDrs: false };
      this.gswbPreferences.updateFormFromPreferences(this.gswbPreferences.gswbPreferences)
    } else {
      console.error("ERROR: `gswbPreferences` ViewChild not initialized!");
    }

    if (this.vampirePreferences) {
        this.vampirePreferences.vampirePreferences = { ...APP_DEFAULTS.vampire.chat };
        this.vampirePreferences.updateFormFromPreferences(this.vampirePreferences.vampirePreferences);
    } else {
      console.error("ERROR: `vampirePreferences` ViewChild not initialized!");
    }

    this.tabsInitialized = true;

  }


  updateData(ruleFile: string) {
    this.ruleFile = ruleFile;
  }

  // This method is called automatically when historyChange emits
  updateHistory(newHistory: context[][]) {
    console.log("History updated:", newHistory);
    this.history = newHistory;  // Assign the updated history
  }

  onSelectionChanged(selectedIndices: number[]): void {
    this.selectedElements = selectedIndices;
    console.log("Selected elements updated in parent:", this.selectedElements);
  }

  onClearSelection(): void {
    this.selectedElements = [];  // Reset selection in parent
    if (this.historyComponent) {
      this.historyComponent.clearSelection();  // Call method in HistoryComponent
    }
    console.log("Called onClearSelection in parent component");
  }

  onTabChange(index: number) {
    setTimeout(() => {
      if (this.editor?.getContent) {
        console.log("Updating axioms to: ",this.editor.getContent())
        this.axioms = this.editor.getContent();
        this.editor.codeMirrorInstance.refresh();
      }
    });
  }

  updateAxioms(value: string): void {
    this.axioms = value;
    if (this.editor) {
      this.editor.updateContent(value);
      this.editor.codeMirrorInstance.refresh();
    }
  }

  private newChatSessionKey(): string {
    const random = Math.random().toString(36).slice(2, 10);
    return `chat-${Date.now()}-${random}`;
  }

  private newChatDocument(): XlePlusGlueDocument {
    return { id: this.chatDocumentSessionKey, semanticType: 'lfgxdrt', sentences: [], sequences: [], elements: [] };
  }

  updateChatDocument(document: XlePlusGlueDocument): void {
    this.chatDocument = document;
    this.persistChatDocument();
  }

  /** Resets the whole chat session: clears the old volatile Redis document, mints a fresh
   *  session key/document, and resets the chat component's in-memory conversation state. */
  startNewConversation(): void {
    this.dataService.clearChatDocument(this.chatDocumentSessionKey).subscribe({
      error: error => console.warn('[Chat] could not clear volatile chat document', error),
    });
    this.chatDocumentSessionKey = this.newChatSessionKey();
    this.chatDocument = this.newChatDocument();
    this.history = [];
    this.chatComponent?.resetConversationState();
  }

  /**
   * Dumps the current chat XlePlusGlueDocument (sentences, sequences, elements,
   * discourseUpdates) as a downloaded JSON file, alongside its current
   * validateAnalysisDocument() status -- mirrors GlueInterfaceComponent's
   * downloadDataModelSnapshot() so the chat document can be inspected the same way,
   * independent of the Redis persistence path.
   */
  downloadChatDocumentSnapshot(): void {
    let validationError: string | null = null;
    try {
      validateAnalysisDocument(this.chatDocument);
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error);
    }
    const snapshot = {
      capturedAt: new Date().toISOString(),
      sessionKey: this.chatDocumentSessionKey,
      valid: validationError === null,
      validationError,
      document: this.chatDocument,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chat-document-${Date.now()}.json`;
    link.click();
    setTimeout(() => window.URL.revokeObjectURL(url), 10000);
  }

  private persistChatDocument(): void {
    this.pendingChatDocumentSave = JSON.parse(JSON.stringify(this.chatDocument));
    if (this.chatDocumentSaveInProgress) return;
    this.saveNextChatDocument();
  }

  private saveNextChatDocument(): void {
    if (!this.pendingChatDocumentSave) return;
    const document = this.pendingChatDocumentSave;
    this.pendingChatDocumentSave = null;
    this.chatDocumentSaveInProgress = true;
    this.dataService.saveChatDocument(this.chatDocumentSessionKey, document).subscribe({
      next: response => {
        this.chatDocument.revision = response.document.revision;
        this.chatDocument.createdAt = response.document.createdAt;
        this.chatDocument.updatedAt = response.document.updatedAt;
      },
      error: error => {
        console.warn('[Chat] could not persist volatile chat document', error);
        this.chatDocumentSaveInProgress = false;
        if (this.pendingChatDocumentSave) this.saveNextChatDocument();
      },
      complete: () => {
        this.chatDocumentSaveInProgress = false;
        if (this.pendingChatDocumentSave) this.saveNextChatDocument();
      },
    });
  }

  ngOnDestroy(): void {
    this.dataService.clearChatDocument(this.chatDocumentSessionKey).subscribe({
      error: error => console.warn('[Chat] could not clear volatile chat document on destroy', error),
    });
  }

}
