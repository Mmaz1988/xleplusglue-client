import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, concatMap, finalize, from, of, toArray } from 'rxjs';
import { map } from 'rxjs/operators';
import { DataService } from '../data.service';
import {
  createRegressionTestingSession,
  isDefaultSessionKey,
  RegressionSessionSummary,
  RegressionTestingSession,
  RegressionSessionDocument,
  regressionDocumentToSession,
  regressionSessionToDocument,
} from '../models/models';
import { RegressionDashboardCacheService, RegressionDashboardSessionCard } from './regression-dashboard-cache.service';

@Component({
  selector: 'app-regression-dashboard',
  templateUrl: './regression-dashboard.component.html',
  styleUrls: ['./regression-dashboard.component.css']
})
export class RegressionDashboardComponent implements OnInit {
  private readonly activeSessionStorageKey = 'regression-testing-active-session-key';

  sessions: RegressionDashboardSessionCard[] = [];
  loading = false;
  /** True from the delete request until the list has been re-read from the store. Kept
   *  apart from `loading` so nothing -- refresh, import, opening, selecting -- can act on a
   *  list that is about to change. */
  deleting = false;
  selectionMode = false;
  selectedSessionKeys = new Set<string>();
  statusMessage = '';
  importing = false;
  exportingSessionKey: string | null = null;

  constructor(
    private dataService: DataService,
    private router: Router,
    private sessionCardCache: RegressionDashboardCacheService
  ) {}

  ngOnInit(): void {
    const cachedSessions = this.sessionCardCache.getAll().filter(card => !isDefaultSessionKey(card.sessionKey));
    if (cachedSessions.length > 0) {
      this.sessions = cachedSessions;
      this.statusMessage = `Loaded ${cachedSessions.length} cached inference bank${cachedSessions.length === 1 ? '' : 's'}.`;
    }
    this.cleanUpStore();
  }

  /** Opening the dashboard sweeps the store (unnamed sessions untouched for a day, results
   *  and progress left without a session) and then lists what is left. The session open in
   *  the testing interface is never swept; a failed sweep only means the list is read as is. */
  private cleanUpStore(): void {
    const keep = [this.getPersistedActiveSessionKey()].filter(key => !!key);
    this.statusMessage = 'Cleaning up unsaved sessions...';
    this.dataService.cleanupRegressionSessions(keep).subscribe({
      next: report => {
        const removed = (report?.sessions?.length ?? 0) + (report?.results?.length ?? 0)
          + (report?.progress?.length ?? 0);
        if (removed) {
          console.info('[Dashboard] store cleanup', report);
        }
        this.refreshSessions(() => {
          if (removed) {
            this.statusMessage += ` Cleaned up ${report.sessions.length} unsaved session`
              + `${report.sessions.length === 1 ? '' : 's'} and ${removed - report.sessions.length} `
              + `leftover record${removed - report.sessions.length === 1 ? '' : 's'} `
              + `(${(report.bytes / 1e6).toFixed(1)} MB).`;
          }
        });
      },
      error: error => {
        console.warn('Unable to clean up the session store.', error);
        this.refreshSessions();
      }
    });
  }

  /** `done` runs once the list has been read, successfully or not. */
  refreshSessions(done?: () => void): void {
    this.loading = true;
    this.statusMessage = 'Loading inference banks...';
    let hydrating = false;

    // Load the list first, then hydrate each card with the saved session snapshot.
    this.dataService.listRegressionSessions().pipe(
      finalize(() => {
        if (!hydrating) done?.();
      })
    ).subscribe({
      next: summaries => {
        // Banks are the sessions saved under a name; unnamed working sessions are not shown.
        const sessions = (summaries ?? []).filter(summary => !isDefaultSessionKey(summary.sessionKey));
        if (sessions.length === 0) {
          this.sessions = [];
          this.sessionCardCache.clear();
          this.loading = false;
          this.statusMessage = 'No inference banks found.';
          return;
        }

        // One bank at a time: forkJoin over many concurrent HttpClient calls can drop one
        // completion and never emit, which left the dashboard loading -- and, after a
        // delete, locked -- for good.
        hydrating = true;
        from(sessions).pipe(
          concatMap(summary => {
            const cached = this.getCachedSessionCard(summary);
            if (cached) {
              return of(cached);
            }

            return this.dataService.loadRegressionSession(summary.sessionKey).pipe(
              map(session => this.enrichSummary(summary, regressionDocumentToSession(session))),
              catchError(() => of(this.enrichSummary(summary)))
            );
          }),
          toArray(),
          finalize(() => done?.())
        ).subscribe({
          next: cards => {
            this.sessions = cards.sort((a, b) => this.toTimestamp(b.updatedAt) - this.toTimestamp(a.updatedAt));
            this.sessionCardCache.replaceAll(this.sessions);
            this.loading = false;
            this.statusMessage = `Loaded ${this.sessions.length} inference bank${this.sessions.length === 1 ? '' : 's'}.`;
          },
          error: error => {
            console.warn('Unable to load regression session details.', error);
            this.loading = false;
            this.statusMessage = 'Loaded bank list, but some bank details could not be retrieved.';
          }
        });
      },
      error: error => {
        console.warn('Unable to load regression sessions.', error);
        this.sessions = [];
        this.loading = false;
        this.statusMessage = 'Unable to load inference banks.';
      }
    });
  }

  toggleSelectionMode(): void {
    if (this.deleting) return;
    this.selectionMode = !this.selectionMode;
    if (!this.selectionMode) {
      this.selectedSessionKeys.clear();
    }
  }

  isSelected(sessionKey: string): boolean {
    return this.selectedSessionKeys.has(sessionKey);
  }

  toggleSessionSelection(sessionKey: string, checked?: boolean): void {
    if (!this.selectionMode || this.deleting) return;

    if (checked === undefined) {
      if (this.selectedSessionKeys.has(sessionKey)) {
        this.selectedSessionKeys.delete(sessionKey);
      } else {
        this.selectedSessionKeys.add(sessionKey);
      }
      return;
    }

    if (checked) {
      this.selectedSessionKeys.add(sessionKey);
    } else {
      this.selectedSessionKeys.delete(sessionKey);
    }
  }

  openSession(session: RegressionSessionSummary): void {
    if (this.selectionMode || this.deleting) return;

    this.persistActiveSessionKey(session.sessionKey);
    this.router.navigate(['/regression'], { queryParams: { session: session.sessionKey } });
  }

  deleteSelectedSessions(): void {
    if (this.selectedSessionKeys.size === 0 || this.deleting) return;

    const keys = [...this.selectedSessionKeys];
    const plural = keys.length === 1 ? '' : 's';
    const message = `Delete ${keys.length} selected inference bank${plural}?`;
    if (typeof window !== 'undefined' && !window.confirm(message)) {
      return;
    }

    this.deleting = true;
    this.statusMessage = `Deleting ${keys.length} inference bank${plural}...`;

    // One request for the whole selection: the store rewrites its index once. Parallel
    // single deletes each rewrote it from the same old copy and put each other's banks back.
    this.dataService.deleteRegressionSessions(keys).subscribe({
      next: result => {
        const deletedKeys = result?.deleted ?? keys;
        if (deletedKeys.includes(this.getPersistedActiveSessionKey())) {
          this.clearPersistedActiveSessionKey();
        }
        this.removeSessionCards(deletedKeys);
        this.selectedSessionKeys.clear();
        this.selectionMode = false;
        this.finishDeletion(`Deleted ${deletedKeys.length} inference bank${deletedKeys.length === 1 ? '' : 's'}.`);
      },
      error: error => {
        console.warn('Unable to delete the selected regression sessions.', error);
        this.finishDeletion('The selected banks could not be deleted.');
      }
    });
  }

  /** Re-reads the list from the store, so the dashboard shows what is stored rather than
   *  what this tab assumes the delete did, and only then lifts the lock. */
  private finishDeletion(message: string): void {
    this.refreshSessions(() => {
      this.deleting = false;
      this.statusMessage = message;
    });
  }

  trackBySessionKey(_: number, session: RegressionSessionSummary): string {
    return session.sessionKey;
  }

  downloadSessionAsJson(sessionKey: string): void {
    if (this.exportingSessionKey) return;

    this.exportingSessionKey = sessionKey;
    this.dataService.loadRegressionSession(sessionKey).subscribe({
      next: session => {
        const payload = this.buildExportPayload(regressionDocumentToSession(session));
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${payload.metadata.redisSessionKey || payload.metadata.id || sessionKey}.json`;
        link.click();
        setTimeout(() => window.URL.revokeObjectURL(url), 10000);
        this.exportingSessionKey = null;
      },
      error: error => {
        console.warn('Unable to export inference bank.', error);
        this.exportingSessionKey = null;
        this.statusMessage = 'Unable to export inference bank.';
      }
    });
  }

  triggerImportClick(fileInput: HTMLInputElement): void {
    if (this.importing) return;
    fileInput.value = '';
    fileInput.click();
  }

  onImportSessionFile(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    this.importing = true;
    this.statusMessage = `Importing ${file.name}...`;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result ?? '');
        const parsed = JSON.parse(raw);
        const imported = this.normalizeImportedSession(parsed, file.name);
        const sessionKey = imported.redisSessionKey || imported.id;

        this.dataService.saveRegressionSession(sessionKey, regressionSessionToDocument(imported)).subscribe({
          next: () => {
            const card = this.cardFromSession(imported);
            this.upsertSessionCard(card);
            this.importing = false;
            this.statusMessage = `Imported ${sessionKey}.`;
          },
          error: error => {
            console.warn('Unable to import inference bank.', error);
            this.importing = false;
            this.statusMessage = 'Unable to import inference bank.';
          }
        });
      } catch (error) {
        console.warn('Unable to parse imported inference bank.', error);
        this.importing = false;
        this.statusMessage = 'The selected file is not valid JSON.';
      }
    };

    reader.onerror = () => {
      this.importing = false;
      this.statusMessage = 'Unable to read the selected file.';
    };

    reader.readAsText(file);
  }

  private enrichSummary(summary: RegressionSessionSummary, session?: RegressionTestingSession): RegressionDashboardSessionCard {
    // Summaries are enriched with details from the persisted session snapshot.
    const sentenceCount = session?.sentenceMap ? Object.keys(session.sentenceMap).length : (summary.sentenceCount ?? 0);
    const parseResultCount = session?.regressionTestResults?.length ?? summary.parseCount ?? 0;
    const inferenceCount = session?.inferenceResults?.length ?? summary.inferenceCount ?? 0;
    const mismatchCount = session?.inferenceResults?.filter(result => result.mismatch).length ?? summary.mismatchCount ?? 0;

    return {
      ...summary,
      grammarPath: session?.grammarPath ?? '',
      testsuiteFilename: session?.testsuiteFilename ?? '',
      rulesFilename: session?.rulesFilename ?? '',
      axiomsFilename: session?.axiomsFilename ?? '',
      testsuiteText: session?.testsuiteText ?? '',
      rulesText: session?.rulesText ?? '',
      axiomsText: session?.axiomsText ?? '',
      testsuiteLoadedText: session?.testsuiteLoadedText ?? '',
      rulesLoadedText: session?.rulesLoadedText ?? '',
      axiomsLoadedText: session?.axiomsLoadedText ?? '',
      parseCount: parseResultCount,
      inferenceCount,
      sentenceCount,
      failedParseCount: Math.max(sentenceCount - parseResultCount, 0),
      mismatchCount,
      hasParseResults: summary.hasParseResults || parseResultCount > 0,
      hasInferenceResults: summary.hasInferenceResults || inferenceCount > 0,
    };
  }

  private cardFromSession(session: RegressionTestingSession): RegressionDashboardSessionCard {
    const sessionKey = session.redisSessionKey || session.id;
    return this.enrichSummary({
      sessionKey,
      displayLabel: sessionKey,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      parseCount: session.regressionTestResults?.length ?? 0,
      inferenceCount: session.inferenceResults?.length ?? 0,
      hasParseResults: (session.regressionTestResults?.length ?? 0) > 0,
      hasInferenceResults: (session.inferenceResults?.length ?? 0) > 0,
      sentenceCount: Object.keys(session.sentenceMap ?? {}).length,
      failedParseCount: Math.max(Object.keys(session.sentenceMap ?? {}).length - (session.regressionTestResults?.length ?? 0), 0),
      mismatchCount: session.inferenceResults?.filter(result => result.mismatch).length ?? 0,
    }, session);
  }

  private getCachedSessionCard(summary: RegressionSessionSummary): RegressionDashboardSessionCard | null {
    const cached = this.sessionCardCache.get(summary.sessionKey);
    if (!cached || cached.updatedAt !== summary.updatedAt) return null;
    return cached;
  }

  private upsertSessionCard(card: RegressionDashboardSessionCard): void {
    this.sessionCardCache.upsert(card);
    const remaining = this.sessions.filter(session => session.sessionKey !== card.sessionKey);
    remaining.push(card);
    this.sessions = remaining.sort((a, b) => this.toTimestamp(b.updatedAt) - this.toTimestamp(a.updatedAt));
  }

  private removeSessionCards(sessionKeys: string[]): void {
    this.sessionCardCache.remove(sessionKeys);
    this.sessions = this.sessions.filter(session => !sessionKeys.includes(session.sessionKey));
  }

  private buildExportPayload(session: RegressionTestingSession): RegressionSessionDocument {
    const exportedId = String(session?.id ?? session?.redisSessionKey ?? `exported-${Date.now()}`);

    return regressionSessionToDocument({
      ...createRegressionTestingSession(),
      ...session,
      id: exportedId,
      redisSessionKey: exportedId,
    });
  }

  private normalizeImportedSession(raw: any, fileName: string): RegressionTestingSession {
    const fallbackKey = fileName.replace(/\.json$/i, '') || `imported-${Date.now()}`;
    const base = createRegressionTestingSession();
    const session = regressionDocumentToSession(raw);

    session.id = String(session.id ?? raw?.metadata?.id ?? raw?.id ?? raw?.redisSessionKey ?? fallbackKey);
    session.redisSessionKey = session.id;
    session.createdAt = String(raw?.metadata?.createdAt ?? raw?.createdAt ?? base.createdAt);
    session.updatedAt = new Date().toISOString();
    session.testsuiteUpdateMode = raw?.metadata?.testsuiteUpdateMode === 'append' ? 'append' : (raw?.testsuiteUpdateMode === 'append' ? 'append' : 'write');

    return session;
  }

  private toTimestamp(value: string): number {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private persistActiveSessionKey(sessionKey: string): void {
    try {
      localStorage.setItem(this.activeSessionStorageKey, sessionKey);
    } catch {
      // Ignore storage failures.
    }
  }

  private getPersistedActiveSessionKey(): string {
    try {
      return localStorage.getItem(this.activeSessionStorageKey) ?? '';
    } catch {
      return '';
    }
  }

  private clearPersistedActiveSessionKey(): void {
    try {
      localStorage.removeItem(this.activeSessionStorageKey);
    } catch {
      // Ignore storage failures.
    }
  }

  getFileLabel(filename: string, loadedText: string, currentText?: string): string {
    const modified = this.isModified(currentText ?? loadedText, loadedText);
    const base = filename || 'Not loaded';
    return modified ? `${base} (modified)` : base;
  }

  shortenText(value: string, maxLength = 42): string {
    // Keep long paths readable inside the card grid.
    const text = value || 'Not loaded';
    return text.length > maxLength ? `…${text.slice(text.length - (maxLength - 1))}` : text;
  }

  private isModified(currentText: string, loadedText: string): boolean {
    return (currentText ?? '') !== (loadedText ?? '');
  }
}
