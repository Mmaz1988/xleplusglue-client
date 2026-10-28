import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, distinctUntilChanged, map } from 'rxjs';
import { LigerParserSelection, LigerUdModel, SyntaxSource, XLE_SOURCE } from '../models/models';

/**
 * Which parser the session parses with: XLE with the loaded grammar, or a Stanza (UD) model
 * (xleplusglue docs/plans/UD_PARSING_PLAN.md, step 4). A session is XLE-only or UD-only, so
 * the views never mix the two in one document.
 *
 * - `select` is the user's choice (the navigation toggle, the grammar loader's model list).
 *   Changing the *kind* emits `switched$`, on which each view starts a fresh session through
 *   its own reset path. A view that cannot be reset right now (a regression run in progress)
 *   vetoes the switch through `addSwitchGuard`.
 * - `restore` puts back the parser of a session being loaded. It is the restore itself, not
 *   a second reset, so it emits no `switched$`.
 *
 * UD is offered only while the Stanza service answers with at least one model (`udModels`,
 * refreshed by the navigation). A UD session whose Stanza goes away stays UD: its parses fail
 * loudly in LiGER, never silently fall back to XLE.
 */
@Injectable({
  providedIn: 'root'
})
export class SyntaxSourceService {
  private readonly sourceSubject = new BehaviorSubject<SyntaxSource>(XLE_SOURCE);
  private readonly switchedSubject = new Subject<SyntaxSource>();
  private readonly guards = new Set<() => string | null>();

  readonly source$: Observable<SyntaxSource> = this.sourceSubject.asObservable();
  /** The parser kind of the session changed by the user's choice. */
  readonly switched$: Observable<SyntaxSource> = this.switchedSubject.asObservable();
  /** The parser kind, once per change, by choice or by restore. */
  readonly kind$: Observable<SyntaxSource['kind']> = this.source$.pipe(map(source => source.kind), distinctUntilChanged());

  /** The installed UD models, as Stanza last reported them through LiGER. */
  udModels: LigerUdModel[] = [];
  /** Why no UD model is offered, when the last check failed. */
  udError: string | null = null;

  get source(): SyntaxSource {
    return this.sourceSubject.value;
  }

  get isUd(): boolean {
    return this.source.kind === 'ud';
  }

  get udAvailable(): boolean {
    return this.udModels.length > 0;
  }

  setUdModels(models: LigerUdModel[] | null | undefined, error: string | null = null): void {
    this.udModels = Array.isArray(models) ? models : [];
    this.udError = error;
  }

  /** The user's choice. Returns why it was refused, or null. */
  select(source: SyntaxSource): string | null {
    const current = this.source;
    if (sameSource(current, source)) {
      return null;
    }
    const kindChanges = current.kind !== source.kind;
    if (kindChanges) {
      for (const guard of this.guards) {
        const reason = guard();
        if (reason) {
          return reason;
        }
      }
    }
    this.sourceSubject.next(source);
    if (kindChanges) {
      this.switchedSubject.next(source);
    }
    return null;
  }

  /** The parser of a session being restored; absent means XLE. */
  restore(source: SyntaxSource | null | undefined): void {
    const restored = source?.kind === 'ud' && source.model ? source : XLE_SOURCE;
    if (!sameSource(this.source, restored)) {
      this.sourceSubject.next(restored);
    }
  }

  /** A check run before the kind changes; it returns why the switch must wait, or null. */
  addSwitchGuard(guard: () => string | null): () => void {
    this.guards.add(guard);
    return () => this.guards.delete(guard);
  }

  /** What a LiGER parse request names as its parser: nothing for XLE, as before. */
  parserSelection(): LigerParserSelection | undefined {
    const source = this.source;
    return source.kind === 'ud' ? { kind: 'ud', model: source.model } : undefined;
  }

  /** The source a session or document records: nothing for XLE. */
  recorded(): SyntaxSource | undefined {
    return this.isUd ? { ...this.source } : undefined;
  }
}

export function sameSource(a: SyntaxSource | null | undefined, b: SyntaxSource | null | undefined): boolean {
  const left = a ?? XLE_SOURCE;
  const right = b ?? XLE_SOURCE;
  return left.kind === right.kind && (left.kind !== 'ud' || (right.kind === 'ud' && left.model === right.model));
}

/** The folder of a UD model's LiGER configs (grammars/ud/<model>/liger). */
export function udGrammarPath(model: string): string {
  return `./grammars/ud/${model}`;
}
