import { Injectable } from '@angular/core';
import { RegressionSessionSummary } from '../models/models';

export type RegressionDashboardSessionCard = RegressionSessionSummary & {
  sentenceCount: number;
  failedParseCount: number;
  mismatchCount: number;
  grammarPath: string;
  testsuiteFilename: string;
  rulesFilename: string;
  axiomsFilename: string;
  testsuiteText: string;
  rulesText: string;
  axiomsText: string;
  testsuiteLoadedText: string;
  rulesLoadedText: string;
  axiomsLoadedText: string;
};

@Injectable({
  providedIn: 'root'
})
export class RegressionDashboardCacheService {
  private readonly storageKey = 'regression-dashboard-session-card-cache-v1';
  private sessionCardCache = new Map<string, RegressionDashboardSessionCard>();

  constructor() {
    this.loadFromStorage();
  }

  getAll(): RegressionDashboardSessionCard[] {
    return [...this.sessionCardCache.values()].sort((a, b) => this.toTimestamp(b.updatedAt) - this.toTimestamp(a.updatedAt));
  }

  get(sessionKey: string): RegressionDashboardSessionCard | undefined {
    return this.sessionCardCache.get(sessionKey);
  }

  replaceAll(cards: RegressionDashboardSessionCard[]): void {
    this.sessionCardCache = new Map(cards.map(card => [card.sessionKey, card]));
    this.persist();
  }

  upsert(card: RegressionDashboardSessionCard): void {
    this.sessionCardCache.set(card.sessionKey, card);
    this.persist();
  }

  remove(sessionKeys: string[]): void {
    for (const sessionKey of sessionKeys) {
      this.sessionCardCache.delete(sessionKey);
    }

    this.persist();
  }

  clear(): void {
    this.sessionCardCache.clear();
    this.persist();
  }

  private loadFromStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;

      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      this.sessionCardCache = new Map(
        parsed
          .filter(card => card && typeof card.sessionKey === 'string')
          .map((card: RegressionDashboardSessionCard) => [card.sessionKey, card])
      );
    } catch {
      this.sessionCardCache.clear();
    }
  }

  private persist(): void {
    try {
      if (typeof localStorage === 'undefined') return;

      localStorage.setItem(this.storageKey, JSON.stringify([...this.sessionCardCache.values()]));
    } catch {
      // Ignore storage failures.
    }
  }

  private toTimestamp(value: string): number {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
