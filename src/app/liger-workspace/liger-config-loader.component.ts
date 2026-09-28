import { Component, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription, from } from 'rxjs';
import { concatMap, map, toArray } from 'rxjs/operators';
import { FileTree } from '../models/models';
import { LigerFileSource } from './liger-file-source.service';
import { LigerWorkspaceService, RuleSetOrigin } from './liger-workspace.service';
import { serverRelative } from './liger-paths';
import { ToggleDisplayComponent } from '../utilities/toggle-display/toggle-display.component';

/** A folder the picker lists, and which of its files can be opened. */
export interface ConfigRoot {
  dir: string;
  label: string;
  keep: (name: string) => boolean;
}

const isConfig = (name: string) => /\.liger\.ya?ml$/i.test(name);

const ORIGIN_LABELS: Record<RuleSetOrigin, string> = {
  default: 'default at startup',
  grammar: 'from the grammar',
  selected: 'selected',
};

/** LiGER configs live in their grammar's folder; single rule files are left in
 *  liger_resources/rules. */
export const DEFAULT_CONFIG_ROOTS: ConfigRoot[] = [
  { dir: './grammars', label: 'grammars', keep: isConfig },
  { dir: './liger_resources/rules', label: 'liger_resources/rules', keep: () => true },
];

/** Picks the LiGER config (or single rule file) independently of the grammar, like the
 *  grammar and testsuite selections beside it. It opens the choice in the shared LiGER
 *  workspace, so the rule set every view shows is the one picked here. */
@Component({
  selector: 'app-liger-config-loader',
  templateUrl: './liger-config-loader.component.html',
  styleUrls: ['./liger-config-loader.component.css'],
})
export class LigerConfigLoaderComponent implements OnInit, OnDestroy {

  @Input() roots: ConfigRoot[] = DEFAULT_CONFIG_ROOTS;

  fileTree: FileTree[] = [];
  selectedPath = '';
  @ViewChild('picker') picker?: ToggleDisplayComponent;
  private directories = new Set<string>();
  private listing?: Subscription;

  constructor(private files: LigerFileSource, readonly workspace: LigerWorkspaceService) {}

  ngOnInit(): void {
    // One folder at a time: concurrent HttpClient calls joined together have dropped a
    // response in this app before.
    this.listing = from(this.roots).pipe(
      concatMap(root => this.files.browse(root.dir).pipe(map(children => ({ root, children })))),
      toArray(),
    ).subscribe({
      next: listed => {
        this.fileTree = listed
          .map(({ root, children }) => ({
            name: root.label, path: root.dir, isDirectory: true,
            children: prune(children, root.keep),
          }))
          .filter(node => node.children.length > 0);
        this.directories = new Set(directoriesOf(this.fileTree));
      },
      error: error => console.error('[LiGER config] could not list configs', error),
    });
  }

  ngOnDestroy(): void {
    this.listing?.unsubscribe();
  }

  get statusMessage(): string {
    const state = this.workspace.state;
    if (state.loading) {
      return `Loading LiGER config: ${state.loading}…`;
    }
    if (state.openFailed) {
      return `Failed to load LiGER config: ${state.openFailed}`;
    }
    if (state.ruleSet) {
      const kind = state.ruleSet.kind === 'rules' ? 'rule file' : 'config';
      const origin = state.origin ? ` (${ORIGIN_LABELS[state.origin]})` : '';
      return `Currently loaded LiGER ${kind}: ${state.ruleSet.source}${origin}`;
    }
    return 'No LiGER config loaded.';
  }

  get canLoad(): boolean {
    return !!this.selectedPath && !this.directories.has(this.selectedPath);
  }

  onFileSelected(path: string): void {
    this.selectedPath = path;
  }

  load(): void {
    if (!this.canLoad) {
      return;
    }
    if (this.workspace.hasEdits && typeof window !== 'undefined'
        && !window.confirm(`Load ${this.selectedPath}? Your in-memory rule set edits will be lost.`)) {
      return;
    }
    this.workspace.open(serverRelative(this.selectedPath));
    if (this.picker) {
      this.picker.isHidden = true;
    }
  }
}

/** Keeps the files `keep` accepts and the folders that still hold one. */
function prune(nodes: FileTree[], keep: (name: string) => boolean): FileTree[] {
  return nodes.flatMap(node => {
    if (node.isDirectory) {
      const children = prune(node.children ?? [], keep);
      return children.length ? [{ ...node, children }] : [];
    }
    return keep(node.name) ? [node] : [];
  });
}

function directoriesOf(nodes: FileTree[]): string[] {
  return nodes.flatMap(node => node.isDirectory
    ? [node.path, ...directoriesOf(node.children ?? [])] : []);
}
