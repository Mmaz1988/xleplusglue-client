import { Injectable } from '@angular/core';
import { Observable, catchError, map, of, tap, timeout } from 'rxjs';
import { DataService } from '../data.service';
import { GswbSolution } from '../models/models';

/** Rendered SVGs kept at most; the oldest go first. A PCDRS SVG is tens of kB. */
const MAX_SVGS = 2000;
/** Collapsed DRSs kept at most (each carries its SVG). */
const MAX_COLLAPSED = 2000;
/** One /render_pcdrs call renders a handful of readings; this bounds a stuck one. */
const RENDER_TIMEOUT_MS = 60_000;

/** A reading to render or collapse: its id within the request, and its DRS text, which is
 *  what both caches are keyed on (an id names a branch only within one item set). */
export interface DrsItem {
  id: string;
  semantic: string;
}

/** GSWB's renderings of DRS text, kept for the session: the SVG of a stored PCDRS
 *  (/render_pcdrs) and the collapsed DRS of a reading (/collapse_anaphora). Views ask for the
 *  readings they show, so a discourse with tens of thousands of readings costs only what is
 *  looked at, and reopening it, or changing its selection, renders nothing twice. */
@Injectable({ providedIn: 'root' })
export class DrsRenderCacheService {
  /** SVG per DRS text; null: GSWB rendered none (the view shows the text). */
  private readonly svgs = new Map<string, string | null>();
  private readonly rendering = new Set<string>();
  /** Collapsed DRS per DRS text, or why it is not collapsed (a rejected reading). Transport
   *  errors are not kept: asking again may succeed. */
  private readonly collapsed = new Map<string, GswbSolution | { rejection: string }>();

  constructor(private dataService: DataService) {}

  /** The reading's SVG; null if GSWB rendered none, undefined if not rendered yet. */
  svgFor(semantic: string): string | null | undefined {
    return this.svgs.get(semantic);
  }

  isRendering(semantic: string): boolean {
    return this.rendering.has(semantic);
  }

  /** Renders those of `items` neither rendered nor being rendered, in one request. Emits once
   *  they are in the cache (a failed rendering is kept as null, so it is not asked for again). */
  render(items: DrsItem[]): Observable<void> {
    const pending = new Map<string, DrsItem>();
    for (const item of items) {
      if (!this.svgs.has(item.semantic) && !this.rendering.has(item.semantic) && !pending.has(item.semantic)) {
        pending.set(item.semantic, item);
      }
    }
    if (!pending.size) return of(undefined);
    const batch = [...pending.values()];
    batch.forEach(item => this.rendering.add(item.semantic));
    const semanticById = new Map(batch.map(item => [item.id, item.semantic]));
    return this.dataService.gswbRenderPcdrs({ items: batch.map(item => ({ id: item.id, semantic: item.semantic })) }).pipe(
      timeout(RENDER_TIMEOUT_MS),
      map(output => new Map((output?.solutions ?? [])
        .filter(solution => semanticById.has(solution.id) && !!solution.solution)
        .map(solution => [semanticById.get(solution.id)!, solution.solution!]))),
      catchError(error => {
        console.warn('[DrsRenderCache] /render_pcdrs failed; showing text', { count: batch.length, error });
        return of(new Map<string, string>());
      }),
      tap(svgBySemantic => batch.forEach(item => {
        this.rendering.delete(item.semantic);
        remember(this.svgs, item.semantic, svgBySemantic.get(item.semantic) ?? null, MAX_SVGS);
      })),
      map(() => undefined),
    );
  }

  /** The reading's collapsed DRS, or the rejection that kept it from collapsing; undefined if
   *  not collapsed yet. */
  collapsedFor(semantic: string): GswbSolution | { rejection: string } | undefined {
    return this.collapsed.get(semantic);
  }

  /** Collapses one reading (the cached result if there is one). A transport error is passed
   *  on and not kept. */
  collapse(item: DrsItem): Observable<GswbSolution | { rejection: string }> {
    const known = this.collapsed.get(item.semantic);
    if (known) return of(known);
    return this.dataService.gswbCollapseAnaphora({ semantic: item.semantic, parentSolutionId: item.id }).pipe(
      map(response => response?.rejection ? { rejection: response.rejection } : response),
      tap(result => remember(this.collapsed, item.semantic, result, MAX_COLLAPSED)),
    );
  }
}

function remember<V>(cache: Map<string, V>, key: string, value: V, limit: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
}
