import { Injectable } from '@angular/core';
import { AsyncSubject, Observable, Subject, catchError, concatMap, defer, map, of, tap, timeout } from 'rxjs';
import { DataService } from '../data.service';
import { anaphoraRankingRequest, attachAnaphoraRanking } from '../analysis-model';
import { AnaphoraRanking, DiscourseUpdate, XlePlusGlueDocument } from '../models/models';

export type AnaphoraRankingResult =
  | { status: 'ranked'; ranking: AnaphoraRanking }
  /** lm was asked and could not answer (down, timed out, error response). */
  | { status: 'unavailable'; reason: string }
  /** lm was not asked: nothing to rank, or the document lacks the inputs. */
  | { status: 'not-applicable'; reason: string };

export interface AnaphoraRankingOutcome {
  result: AnaphoraRankingResult;
  /** The document's current update with the ranking attached; null unless ranked and still
   *  current (see attachAnaphoraRanking). */
  update: DiscourseUpdate | null;
}

/** Long enough for lm to load its model on the first request. */
const RANKING_TIMEOUT_MS = 120_000;

/** The one pronoun ranker every view uses. Reads its inputs from the document, never from a
 *  view, so the analysis, chat and regression documents get the same annotation for the same
 *  data. Never throws into a view: an lm failure is an `unavailable` result, and every flow
 *  works without a ranking. */
@Injectable({ providedIn: 'root' })
export class AnaphoraRankingService {
  // One request at a time: concurrent HttpClient calls joined elsewhere have silently hung,
  // and the lm service encodes serially anyway.
  private readonly queue = new Subject<Observable<unknown>>();

  constructor(private dataService: DataService) {
    this.queue.pipe(concatMap(job => job)).subscribe();
  }

  rank(document: XlePlusGlueDocument, update: DiscourseUpdate): Observable<AnaphoraRankingResult> {
    // Built now, from the document as it is when the update is stored.
    const prepared = anaphoraRankingRequest(document, update);
    if ('reason' in prepared) {
      return of({ status: 'not-applicable', reason: prepared.reason });
    }

    const result = new AsyncSubject<AnaphoraRankingResult>();
    this.queue.next(defer(() => this.dataService.lmRankAnaphora(prepared.request)).pipe(
      timeout(RANKING_TIMEOUT_MS),
      map((ranking): AnaphoraRankingResult => ({ status: 'ranked', ranking })),
      catchError(error => of<AnaphoraRankingResult>({
        status: 'unavailable',
        reason: error?.status === 0 ? 'lm service unreachable' : (error?.message ?? String(error)),
      })),
      tap((outcome: AnaphoraRankingResult) => {
        result.next(outcome);
        result.complete();
      }),
    ));
    return result.asObservable();
  }

  /** Ranks `update` and attaches the ranking to the update as it stands in the document when
   *  the answer arrives. `currentDocument` is read at that point, not now, so a replaced
   *  document or update (new conversation, regenerated PCDRS) drops a late ranking instead of
   *  writing it into the wrong place. The caller upserts `update` when it is non-null. */
  rankAndAttach(
    currentDocument: () => XlePlusGlueDocument | undefined,
    update: DiscourseUpdate,
  ): Observable<AnaphoraRankingOutcome> {
    const document = currentDocument();
    if (!document) {
      return of({ result: { status: 'not-applicable', reason: 'no document' }, update: null });
    }
    return this.rank(document, update).pipe(map(result => {
      if (result.status !== 'ranked') {
        if (result.status === 'unavailable') {
          console.warn('[AnaphoraRanking] lm ranking unavailable', { updateId: update.id, reason: result.reason });
        }
        return { result, update: null };
      }
      const latest = currentDocument();
      const attached = latest ? attachAnaphoraRanking(latest, update, result.ranking) : null;
      console.info('[AnaphoraRanking] ranked', {
        updateId: update.id,
        branches: result.ranking.branches.length,
        attached: !!attached,
        warnings: result.ranking.warnings.length,
      });
      return { result, update: attached };
    }));
  }
}
