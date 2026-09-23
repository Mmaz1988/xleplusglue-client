import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subscription, from } from 'rxjs';
import { concatMap, distinctUntilChanged, map, toArray } from 'rxjs/operators';
import { LigerConfigField, LigerConfigTree, LigerRuleSet } from '../models/models';
import { LigerFileSource } from './liger-file-source.service';
import { assembleFiles, absolutizeLexiconDirectives } from './liger-assembly';

/** One file of the active config. Keyed by its path: a file listed under two fields is one
 *  document, since it is one file. */
export interface WorkspaceDocument {
  path: string;
  name: string;
  /** The first field listing the file; decides its editor mode. */
  field: LigerConfigField;
  /** The text as read from LiGER; null until read (lexica are read when first selected). */
  loadedText: string | null;
  /** The text as edited in memory; equals loadedText while unedited. */
  currentText: string | null;
  /** Lexica: LiGER reads them from disk, so an in-memory edit could not take effect. */
  readOnly: boolean;
}

export interface WorkspaceState {
  ruleSet: LigerRuleSet | null;
  tree: LigerConfigTree | null;
  documents: Record<string, WorkspaceDocument>;
  activePath: string | null;
  /** The path being opened, while it is. */
  loading: string | null;
  /** Why the last open or read failed, as LiGER put it. */
  error: string | null;
}

const EMPTY: WorkspaceState = {
  ruleSet: null, tree: null, documents: {}, activePath: null, loading: null, error: null,
};

export function isEdited(doc: WorkspaceDocument | undefined): boolean {
  return !!doc && doc.loadedText !== null && doc.currentText !== doc.loadedText;
}

/** The active LiGER rule set as files, and the rule text each view sends: the one source of
 *  truth that replaces the per-view rules/axioms text fields (EDITOR_WORKSPACE_PLAN.md).
 *
 *  Edits are in memory only (saving to disk is deferred). An edited rule or axiom file
 *  still applies to the next run, because rule and axiom text travels to LiGER and Vampire
 *  as request text: see {@link assembled}. */
@Injectable({ providedIn: 'root' })
export class LigerWorkspaceService {

  private readonly stateSubject = new BehaviorSubject<WorkspaceState>(EMPTY);
  readonly state$ = this.stateSubject.asObservable();

  readonly semantics$ = this.field$('semantics');
  readonly pragmatics$ = this.field$('pragmatics');
  readonly axioms$ = this.field$('axioms');

  private opening?: Subscription;

  constructor(private files: LigerFileSource) {}

  get state(): WorkspaceState {
    return this.stateSubject.value;
  }

  get semantics(): string | null { return this.assembled('semantics'); }
  get pragmatics(): string | null { return this.assembled('pragmatics'); }
  get axioms(): string | null { return this.assembled('axioms'); }

  get hasEdits(): boolean {
    return Object.values(this.state.documents).some(isEdited);
  }

  /** Opens `path` unless something is open or opening already, so the first view to show
   *  the workspace loads the default and later views share what is open. */
  ensureOpen(path: string): void {
    if (!this.state.ruleSet && !this.state.loading) {
      this.open(path);
    }
  }

  /** Loads a config or single rule file: /load_rules for the assembled text, /config_tree
   *  for the files, then reads every rule and axiom file, one request at a time. They are
   *  read up front because editing one file of a section means assembling the section
   *  from all its files. A failure keeps what was open before. */
  open(path: string): void {
    this.opening?.unsubscribe();
    this.patch({ loading: path, error: null });

    this.opening = this.files.loadRuleSet(path).pipe(
      concatMap(ruleSet => this.files.listConfig(path).pipe(map(tree => ({ ruleSet, tree })))),
      concatMap(({ ruleSet, tree }) => {
        const documents = documentsOf(tree);
        // Every file a rule or axiom section needs, even one that is also listed as a lexicon.
        const toRead = [...new Set(tree.sections
          .filter(section => section.field !== 'lexica')
          .flatMap(section => section.files.map(file => file.path)))];
        // Sequential on purpose: concurrent HttpClient calls joined with forkJoin have
        // silently dropped a response in this app before.
        return from(toRead).pipe(
          concatMap(filePath => this.files.read(filePath).pipe(map(text => ({ path: filePath, text })))),
          toArray(),
          map(texts => {
            for (const { path: filePath, text } of texts) {
              documents[filePath] = { ...documents[filePath], loadedText: text, currentText: text };
            }
            return { ruleSet, tree, documents };
          }));
      }),
    ).subscribe({
      next: ({ ruleSet, tree, documents }) => {
        const first = tree.sections.flatMap(section => section.files)[0]?.path ?? null;
        this.stateSubject.next({ ruleSet, tree, documents, activePath: first, loading: null, error: null });
      },
      error: err => this.patch({ loading: null, error: `Failed to open ${path}: ${reason(err)}` }),
    });
  }

  /** Opens the current rule set again, picking up files changed on disk. Drops edits. */
  reload(): void {
    if (this.state.ruleSet) {
      this.open(this.state.ruleSet.source);
    }
  }

  select(path: string): void {
    const doc = this.state.documents[path];
    if (!doc) {
      return;
    }
    this.patch({ activePath: path });
    if (doc.loadedText === null) {
      this.files.read(path).subscribe({
        next: text => this.patchDocument(path, { loadedText: text, currentText: text }),
        error: err => this.patch({ error: `Failed to read ${path}: ${reason(err)}` }),
      });
    }
  }

  edit(path: string, text: string): void {
    const doc = this.state.documents[path];
    if (doc && !doc.readOnly && doc.loadedText !== null && doc.currentText !== text) {
      this.patchDocument(path, { currentText: text });
    }
  }

  revert(path: string): void {
    const doc = this.state.documents[path];
    if (doc && doc.loadedText !== null) {
      this.patchDocument(path, { currentText: doc.loadedText });
    }
  }

  /** The rule text a view sends for `field`. /load_rules' text while no file of the section
   *  is edited, so an unedited rule set is exactly what LiGER assembled; otherwise the
   *  section assembled here from its files, edits included. */
  assembled(field: Exclude<LigerConfigField, 'lexica'>): string | null {
    const { ruleSet, tree, documents } = this.state;
    if (!ruleSet || !tree) {
      return null;
    }
    const section = tree.sections.find(s => s.field === field);
    if (!section || !section.files.some(file => isEdited(documents[file.path]))) {
      return ruleSet[field];
    }
    const texts = section.files.map(file => {
      const text = documents[file.path]?.currentText;
      if (text === null || text === undefined) {
        // Never assemble around a missing file: a rule set short of a file looks exactly
        // like rules that do not match.
        throw new Error(`LiGER workspace: ${file.path} was not read, cannot assemble ${field}`);
      }
      return { path: file.path, text };
    });
    if (tree.kind === 'rules' && field === 'semantics') {
      // A single rule file is sent as its text alone, without a marker line.
      return absolutizeLexiconDirectives(texts[0].text, texts[0].path);
    }
    return assembleFiles(texts, field === 'axioms' ? 'axioms' : 'rules');
  }

  private field$(field: Exclude<LigerConfigField, 'lexica'>): Observable<string | null> {
    return this.state$.pipe(map(() => this.assembled(field)), distinctUntilChanged());
  }

  private patch(changes: Partial<WorkspaceState>): void {
    this.stateSubject.next({ ...this.state, ...changes });
  }

  private patchDocument(path: string, changes: Partial<WorkspaceDocument>): void {
    const documents = { ...this.state.documents, [path]: { ...this.state.documents[path], ...changes } };
    this.patch({ documents });
  }
}

function documentsOf(tree: LigerConfigTree): Record<string, WorkspaceDocument> {
  const documents: Record<string, WorkspaceDocument> = {};
  for (const section of tree.sections) {
    for (const file of section.files) {
      const existing = documents[file.path];
      documents[file.path] = existing
        ? { ...existing, readOnly: existing.readOnly || section.field === 'lexica' }
        : {
          path: file.path, name: file.name, field: section.field,
          loadedText: null, currentText: null, readOnly: section.field === 'lexica',
        };
    }
  }
  return documents;
}

/** LiGER names the file and field at fault for a broken config in `error`. */
function reason(err: any): string {
  return err?.error?.error ?? err?.error?.message ?? err?.message ?? String(err);
}
