import { AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { EditorComponent } from '../editor/editor.component';
import { APP_DEFAULTS } from '../app-defaults';
import { FileTree, LigerConfigField, LigerConfigTreeSection } from '../models/models';
import { LigerFileSource } from './liger-file-source.service';
import { LigerWorkspaceService, WorkspaceDocument, WorkspaceState, isEdited } from './liger-workspace.service';

const FIELD_ICONS: Record<LigerConfigField, string> = {
  semantics: 'account_tree',
  pragmatics: 'forum',
  lexica: 'menu_book',
  axioms: 'functions',
};

const EDITOR_MODES: Record<LigerConfigField, string> = {
  semantics: 'liger',
  pragmatics: 'liger',
  lexica: 'text',
  axioms: 'vampire',
};

/** The active LiGER config as a working tree beside one editor pane, laid out after
 *  ../xle-grammar-explorer: the tree fills a resizable left pane, and the whole workspace is
 *  a box of fixed height, so it takes the place a rules editor used to and displaces
 *  nothing (EDITOR_WORKSPACE_PLAN.md). State lives in LigerWorkspaceService, so every view
 *  showing a workspace shows the same rule set and the same in-memory edits. */
@Component({
  selector: 'app-liger-workspace',
  templateUrl: './liger-workspace.component.html',
  styleUrls: ['./liger-workspace.component.css'],
})
export class LigerWorkspaceComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('editor') editor?: EditorComponent;
  @ViewChild('rightPane') rightPane?: ElementRef<HTMLElement>;

  /** Opened when no rule set is open yet. */
  @Input() defaultPath = APP_DEFAULTS.grammar.ligerRulesPath;
  /** Where "Open…" browses while no rule set is open; afterwards, the open config's scope. */
  @Input() browseDirectory = './grammars';
  /** The workspace's height; its bottom edge can be dragged to change it. */
  @Input() height = '420px';

  state!: WorkspaceState;
  sections: LigerConfigTreeSection[] = [];
  active: WorkspaceDocument | null = null;

  /** The tree pane's share of the width, as in the explorer. */
  splitFraction = 0.3;
  /** The tree starts hidden: the editor keeps the room a rules editor always had. */
  treeOpen = false;
  browsing = false;
  browseTree: FileTree[] = [];
  /** The folder "Open…" is showing; ".." goes up from it. */
  browseDir = '';
  browseLoading = false;

  private collapsedFields = new Set<LigerConfigField>();
  private openBrowseDirs = new Set<string>();
  private dragging = false;

  /** Set while the editor is being filled from state. app-editor emits contentChange for
   *  its own updateContent, twice (cleared, then filled): without this, switching files
   *  would briefly record the new file as emptied, and the rule text as changed. */
  private hydrating = false;
  private subscription?: Subscription;
  private resizes?: ResizeObserver;

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
    // CodeMirror measures itself once. Re-measure whenever the editor's pane changes size:
    // when the box's bottom edge or the divider is dragged, when the tree is shown or
    // hidden, and when an app-toggle-display showing it switches from display: none, which
    // CodeMirror would otherwise render blank.
    if (typeof ResizeObserver !== 'undefined') {
      this.resizes = new ResizeObserver(() => this.editor?.refresh());
      this.resizes.observe(this.rightPane?.nativeElement ?? this.host.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.resizes?.disconnect();
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

  /** Where "Open…" starts: the open config's scope, so a grammar's other configs are one
   *  click away; ".." leads anywhere else. */
  get browseRoot(): string {
    return this.state?.tree?.scope ?? this.browseDirectory;
  }

  get browseDirName(): string {
    return this.browseDir.replace(/\/+$/, '');
  }

  toggleTree(): void {
    this.treeOpen = !this.treeOpen;
  }

  fieldTooltip(section: LigerConfigTreeSection): string {
    if (section.present) {
      return `${section.field}: ${section.files.length} file(s) listed in the config`;
    }
    return section.field === 'pragmatics'
      ? 'pragmatics: none listed, so post-processing is blocked'
      : `${section.field}: none listed`;
  }

  fieldIcon(field: LigerConfigField): string {
    return FIELD_ICONS[field];
  }

  isCollapsed(field: LigerConfigField): boolean {
    return this.collapsedFields.has(field);
  }

  toggleSection(field: LigerConfigField): void {
    if (!this.collapsedFields.delete(field)) {
      this.collapsedFields.add(field);
    }
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
      this.browseInto(this.browseRoot);
    }
  }

  /** Shows `dir`'s folders and files. */
  browseInto(dir: string): void {
    this.browseDir = dir;
    this.browseTree = [];
    this.openBrowseDirs.clear();
    this.browseLoading = true;
    this.files.browse(dir).subscribe({
      next: tree => { this.browseTree = tree; this.browseLoading = false; },
      error: err => { this.browseLoading = false; console.error('Failed to list', dir, err); },
    });
  }

  /** Goes up one folder. Lexically: ".." of a symlinked folder is its link's parent, which is
   *  where the user came from. */
  browseUp(): void {
    const dir = this.browseDir.replace(/\/+$/, '');
    const cut = dir.lastIndexOf('/');
    if (cut > 0) {
      this.browseInto(dir.substring(0, cut));
    } else if (cut === 0) {
      this.browseInto('/');
    } else {
      this.browseInto(`${dir}/..`);
    }
  }

  isBrowseOpen(path: string): boolean {
    return this.openBrowseDirs.has(path);
  }

  toggleBrowseDir(path: string): void {
    if (!this.openBrowseDirs.delete(path)) {
      this.openBrowseDirs.add(path);
    }
  }

  isConfigFile(name: string): boolean {
    return /\.liger\.ya?ml$/i.test(name);
  }

  openBrowsed(path: string): void {
    if (path && this.confirmDroppingEdits(`Open ${path}?`)) {
      this.browsing = false;
      this.workspace.open(path);
    }
  }

  startDrag(event: MouseEvent): void {
    event.preventDefault();
    this.dragging = true;
  }

  onDrag(event: MouseEvent): void {
    if (!this.dragging) {
      return;
    }
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.splitFraction = Math.min(0.6, Math.max(0.15, (event.clientX - box.left) / box.width));
  }

  endDrag(): void {
    this.dragging = false;
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
