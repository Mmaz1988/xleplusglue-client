import { AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { EditorComponent } from '../editor/editor.component';
import { APP_DEFAULTS } from '../app-defaults';
import { FileTree, LigerConfigField, LigerConfigTreeSection } from '../models/models';
import { LigerFileSource } from './liger-file-source.service';
import { LigerWorkspaceService, WorkspaceDocument, WorkspaceState, isEdited } from './liger-workspace.service';

const EDITOR_MODES: Record<LigerConfigField, string> = {
  semantics: 'liger',
  pragmatics: 'liger',
  lexica: 'text',
  axioms: 'vampire',
};

/** The active LiGER config as a tree of its files beside one editor pane
 *  (EDITOR_WORKSPACE_PLAN.md). State lives in LigerWorkspaceService, so every view showing
 *  a workspace shows the same rule set and the same in-memory edits.
 *
 *  The sidebar is a column of this component that collapses on click, not an
 *  app-hover-sidebar: that one is fixed to the viewport's right edge, where the views that
 *  host a workspace already keep their own. */
@Component({
  selector: 'app-liger-workspace',
  templateUrl: './liger-workspace.component.html',
  styleUrls: ['./liger-workspace.component.css'],
})
export class LigerWorkspaceComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('editor') editor?: EditorComponent;

  /** Opened when no rule set is open yet. */
  @Input() defaultPath = APP_DEFAULTS.grammar.ligerRulesPath;
  /** Where "Open…" browses for configs and rule files. */
  @Input() browseDirectory = './liger_resources/rules';

  state!: WorkspaceState;
  sections: LigerConfigTreeSection[] = [];
  active: WorkspaceDocument | null = null;

  collapsed = false;
  browsing = false;
  browseTree: FileTree[] = [];
  browsePath = '';

  /** Set while the editor is being filled from state. app-editor emits contentChange for
   *  its own updateContent, twice (cleared, then filled): without this, switching files
   *  would briefly record the new file as emptied, and the rule text as changed. */
  private hydrating = false;
  private subscription?: Subscription;
  private visibility?: IntersectionObserver;

  constructor(readonly workspace: LigerWorkspaceService, private files: LigerFileSource,
              private host: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    this.subscription = this.workspace.state$.subscribe(state => {
      this.state = state;
      this.sections = state.tree?.sections ?? [];
      this.active = state.activePath ? state.documents[state.activePath] ?? null : null;
      this.syncEditor();
    });
    this.workspace.ensureOpen(this.defaultPath);
  }

  ngAfterViewInit(): void {
    this.syncEditor();
    // Views keep the workspace in an app-toggle-display, which hides it with display: none;
    // CodeMirror laid out while hidden shows blank until re-measured.
    if (typeof IntersectionObserver !== 'undefined') {
      this.visibility = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          this.editor?.refresh();
        }
      });
      this.visibility.observe(this.host.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.visibility?.disconnect();
  }

  get mode(): string {
    return this.active ? EDITOR_MODES[this.active.field] : 'liger';
  }

  get sourceName(): string {
    const source = this.state?.ruleSet?.source ?? '';
    return source.substring(source.lastIndexOf('/') + 1);
  }

  isEdited(path: string): boolean {
    return isEdited(this.state.documents[path]);
  }

  isReadOnly(path: string): boolean {
    return !!this.state.documents[path]?.readOnly;
  }

  inheritedLabel(section: LigerConfigTreeSection): string {
    if (section.inheritedFrom === 'builtin') {
      return "LiGER's default lexicon";
    }
    const from = section.inheritedFrom ?? '';
    return `from ${from.substring(from.lastIndexOf('/') + 1)}`;
  }

  select(path: string): void {
    this.workspace.select(path);
  }

  onEditorChange(text: string): void {
    if (!this.hydrating && this.active) {
      this.workspace.edit(this.active.path, text);
    }
  }

  revert(): void {
    if (this.active) {
      this.workspace.revert(this.active.path);
    }
  }

  download(): void {
    if (this.active) {
      this.editor?.downloadFile(this.active.name);
    }
  }

  reload(): void {
    if (this.confirmDroppingEdits('Reload the rule set from disk?')) {
      this.workspace.reload();
    }
  }

  toggleBrowse(): void {
    this.browsing = !this.browsing;
    if (this.browsing) {
      this.files.browse(this.browseDirectory).subscribe({
        next: tree => this.browseTree = tree,
        error: err => console.error('Failed to list', this.browseDirectory, err),
      });
    }
  }

  openBrowsed(path = this.browsePath): void {
    if (path && this.confirmDroppingEdits(`Open ${path}?`)) {
      this.browsing = false;
      this.workspace.open(path);
    }
  }

  /** Puts the active document's text into the editor when it differs from what the editor
   *  shows: on switching files, on revert, on an edit made in another view's workspace.
   *  Not on the user's own typing, which already matches. */
  private syncEditor(): void {
    if (!this.editor) {
      return;
    }
    const text = this.active?.currentText ?? '';
    if (this.editor.getContent() !== text) {
      this.hydrating = true;
      try {
        this.editor.updateContent(text);
      } finally {
        this.hydrating = false;
      }
    }
  }

  private confirmDroppingEdits(question: string): boolean {
    if (!this.workspace.hasEdits || typeof window === 'undefined') {
      return true;
    }
    return window.confirm(`${question} Your in-memory edits will be lost.`);
  }
}
