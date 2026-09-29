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

/** How the open rule set came to be open: the startup default, the loaded grammar's own
 *  config, or picked by hand (LiGER config selection, Open…). A hand-picked one stays when a
 *  grammar is loaded; the others give way to the grammar's config. */
export type RuleSetOrigin = 'default' | 'grammar' | 'selected';

export interface WorkspaceState {
  ruleSet: LigerRuleSet | null;
  tree: LigerConfigTree | null;
  documents: Record<string, WorkspaceDocument>;
  /** The path being opened, while it is. */
  loading: string | null;
  /** Why the last open or read failed, as LiGER put it. */
  error: string | null;
  /** The path the last open failed for, while what is shown is still the rule set before
   *  it; null once an open succeeds. */
  openFailed: string | null;
  /** How the open rule set came to be open; null while none is. */
  origin: RuleSetOrigin | null;
  /** The origin of the rule set being opened, while one is. */
  loadingOrigin: RuleSetOrigin | null;
  /** Whether the open in progress restores saved text (a session): nothing may replace it. */
  restoring: boolean;
  /** Rule and axiom files left out of runs, by path: a run sends its section without them.
   *  For trying a rule set without some of its files; nothing on disk changes. */
  excluded: string[];
}

/** The fields whose files a run can leave out: lexica are LiGER's own, read from disk. */
export type SelectableField = Exclude<LigerConfigField, 'lexica'>;

const EMPTY: WorkspaceState = {
  ruleSet: null, tree: null, documents: {}, loading: null, error: null, openFailed: null,
  origin: null, loadingOrigin: null, restoring: false, excluded: [],
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

  isIncluded(path: string): boolean {
    return !this.state.excluded.includes(path);
  }

  /** Leaves `path` out of runs, or takes it back in. */
  setIncluded(path: string, included: boolean): void {
    this.setAllIncluded([path], included);
  }

  setAllIncluded(paths: string[], included: boolean): void {
    const excluded = included
      ? this.state.excluded.filter(path => !paths.includes(path))
      : [...new Set([...this.state.excluded, ...paths.filter(path => this.state.documents[path])])];
    if (excluded.length !== this.state.excluded.length) {
      this.patch({ excluded });
    }
  }

  /** Opens `path` unless something is open or opening already, so the first view to show
   *  the workspace loads the default and later views share what is open. */
  ensureOpen(path: string): void {
    if (!this.state.ruleSet && !this.state.loading) {
      this.open(path, undefined, 'default');
    }
  }

  /** Loads a config or single rule file: /load_rules for the assembled text, /config_tree
   *  for the files, then reads every rule and axiom file, one request at a time. They are
   *  read up front because editing one file of a section means assembling the section
   *  from all its files. A failure keeps what was open before.
   *
   *  `saved` restores a stored session: each listed file whose text differs from disk
   *  opens as an in-memory edit of it, in the same state change that opens the rule set, so
   *  nothing ever observes the disk text in between. A saved file the rule set no longer
   *  lists cannot be applied, and is reported as the error.
   *
   *  `excluded` leaves those files out of runs again (a session's, or reload's); a newly
   *  opened rule set otherwise runs with all its files. */
  open(path: string, saved?: Record<string, string>, origin: RuleSetOrigin = 'selected',
       excluded: string[] = []): void {
    this.opening?.unsubscribe();
    this.patch({ loading: path, loadingOrigin: origin, restoring: !!saved, error: null });

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
            const unapplied: string[] = [];
            for (const [filePath, text] of Object.entries(saved ?? {})) {
              const doc = documents[filePath];
              if (!doc || doc.readOnly || doc.loadedText === null) {
                unapplied.push(filePath);
              } else {
                documents[filePath] = { ...doc, currentText: text };
              }
            }
            const kept = excluded.filter(filePath => documents[filePath] && !documents[filePath].readOnly);
            return { ruleSet, tree, documents, unapplied, kept };
          }));
      }),
    ).subscribe({
      next: ({ ruleSet, tree, documents, unapplied, kept }) => {
        const error = unapplied.length
          ? `Saved text not applied, the rule set no longer lists: ${unapplied.join(', ')}`
          : null;
        this.stateSubject.next({ ruleSet, tree, documents, loading: null, error, openFailed: null,
          origin, loadingOrigin: null, restoring: false, excluded: kept });
      },
      error: err => this.patch({ loading: null, loadingOrigin: null, restoring: false,
        error: `Failed to open ${path}: ${reason(err)}`, openFailed: path }),
    });
  }

  /** Whether loading a grammar may open its config now: not over a hand-picked rule set,
   *  and not while a session's rule set is being restored. */
  get yieldsToGrammar(): boolean {
    const { loading, loadingOrigin, origin, restoring } = this.state;
    if (restoring) return false;
    return (loading ? loadingOrigin : origin) !== 'selected';
  }

  /** Records a new origin for the open rule set without reopening it (and so without
   *  dropping its edits): the grammar's config was already the one open. */
  markOrigin(origin: RuleSetOrigin): void {
    if (this.state.ruleSet && !this.state.loading && this.state.origin !== origin) {
      this.patch({ origin });
    }
  }

  /** Drops the message of a failed open or read, e.g. when the session that asked for it is
   *  gone. What is open stays open. */
  clearError(): void {
    if (this.state.error || this.state.openFailed) {
      this.patch({ error: null, openFailed: null });
    }
  }

  /** The current text of every rule and axiom file, keyed by path: what a session stores so
   *  that `open(path, saved)` can bring the rule set back exactly. Lexica are left out, since
   *  they cannot be edited here. */
  fileTexts(): Record<string, string> {
    const texts: Record<string, string> = {};
    for (const doc of Object.values(this.state.documents)) {
      if (!doc.readOnly && doc.currentText !== null) {
        texts[doc.path] = doc.currentText;
      }
    }
    return texts;
  }

  /** Reads the open rule set from disk again without losing work: the config's file list
   *  and every unedited file come from disk, the in-memory edits of files it still lists and
   *  the files left out of runs stay. What loading a grammar does when its config is open
   *  already, so a changed config shows. */
  refresh(origin: RuleSetOrigin = this.state.origin ?? 'selected'): void {
    const { ruleSet, documents, excluded } = this.state;
    if (!ruleSet) {
      return;
    }
    const edits: Record<string, string> = {};
    for (const doc of Object.values(documents)) {
      if (isEdited(doc)) {
        edits[doc.path] = doc.currentText!;
      }
    }
    this.open(ruleSet.source, Object.keys(edits).length ? edits : undefined, origin, excluded);
  }

  /** Opens the rule set afresh from disk, as a new session starts: no edits, every file in
   *  runs, and no longer counted as picked by hand, so the next grammar opens its own. A
   *  rule set still being opened (a previous session's) is opened afresh instead. Returns
   *  whether anything is being opened. */
  reset(): boolean {
    const path = this.state.loading ?? this.state.ruleSet?.source;
    if (!path) {
      return false;
    }
    this.open(path, undefined, 'default');
    return true;
  }

  /** Opens the current rule set again, picking up files changed on disk. Drops edits; keeps
   *  the files left out of runs. */
  reload(): void {
    if (this.state.ruleSet) {
      this.open(this.state.ruleSet.source, undefined, this.state.origin ?? 'selected', this.state.excluded);
    }
  }

  /** Reads a document not read yet (a lexicon, when a view first shows it). Which file a view
   *  shows is the view's own: two workspaces on one page can show different files of the same
   *  rule set, and share its edits. */
  load(path: string): void {
    const doc = this.state.documents[path];
    if (!doc) {
      return;
    }
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
   *  is edited or left out, so an unedited rule set is exactly what LiGER assembled;
   *  otherwise the section assembled here from its included files, edits included. A
   *  section with every file left out is sent empty: '' where LiGER listed files, so it
   *  stays apart from a field the config does not list (null). */
  assembled(field: SelectableField): string | null {
    const { ruleSet, tree, documents } = this.state;
    if (!ruleSet || !tree) {
      return null;
    }
    const section = tree.sections.find(s => s.field === field);
    if (!section || !section.files.some(file => isEdited(documents[file.path]) || !this.isIncluded(file.path))) {
      return ruleSet[field];
    }
    const included = section.files.filter(file => this.isIncluded(file.path));
    if (!included.length) {
      return '';
    }
    const texts = included.map(file => {
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

  private field$(field: SelectableField): Observable<string | null> {
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
