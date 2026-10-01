/**
 * The report on a regression run: what the parse and the inference step did, when each (and
 * each of its phases) started, how long it took, and what came of it. Persisted with the
 * session (`analysis.report`), so a loaded session shows the report of the run it holds.
 *
 * A step's duration is its own, start to finish: the time between the two steps (waiting,
 * disambiguating) is in neither, and the total is their sum. A rerun replaces the step it
 * reruns; there is no history.
 */

/** One sentence or item and how long it took. */
export interface TimedEntry {
  id: string;
  ms: number;
}

/** Per-sentence or per-item times of one phase: their sum, average, fastest and slowest. */
export interface TimingStats {
  count: number;
  totalMs: number;
  averageMs: number;
  fastest: TimedEntry;
  slowest: TimedEntry;
}

/** One phase of a step: when it started and how long it ran (null while it runs). */
export interface RunPhase {
  name: string;
  startedAt: string;
  durationMs: number | null;
}

export interface ParseReport {
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** Set when the step ended on an error. */
  failure?: string;
  phases: RunPhase[];
  /** Per sentence: XLE parse and rule application (LiGER's own measure). */
  parsing: TimingStats | null;
  /** Per sentence: semantic composition (GSWB's own measure). */
  composition: TimingStats | null;
  /** A sentence parses successfully when GSWB composes at least one semantic reading. */
  sentences: { total: number; successful: number; failedIds: string[] };
  /** `discourse`: items derived in sequence; `stopped`: those that stopped at a sentence
   *  without semantics, as "item: sentence -- reason". */
  items: { total: number; discourse: number; stopped: string[] };
}

export interface InferenceReport {
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  failure?: string;
  phases: RunPhase[];
  runKind: 'initial' | 'rerun' | 'append';
  /** Items this run reasoned over; `selected`: only the ones ticked. */
  itemsInRun: number;
  selected: boolean;
  /** Per item: building the reasoning checks (merge, post-processing, TPTP). */
  preparation: TimingStats | null;
  /** Per item: Vampire, from its first to its last check (the service's own measure). */
  vampire: TimingStats | null;
  /** Over every item of the testsuite once the run is done. */
  results: { total: number; correct: number; wrong: number; notParsed: number; noVerdict: number };
  proofs: number;
}

export interface RegressionRunReport {
  parse: ParseReport | null;
  inference: InferenceReport | null;
}

export function emptyRunReport(): RegressionRunReport {
  return { parse: null, inference: null };
}

/** Statistics over per-entry times; null when there are none. Non-numbers are skipped. */
export function timingStats(timings: Record<string, number | null | undefined>): TimingStats | null {
  const entries = Object.entries(timings ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .map(([id, ms]) => ({ id, ms }));
  if (!entries.length) return null;
  const totalMs = entries.reduce((sum, entry) => sum + entry.ms, 0);
  return {
    count: entries.length,
    totalMs,
    averageMs: totalMs / entries.length,
    fastest: entries.reduce((best, entry) => entry.ms < best.ms ? entry : best),
    slowest: entries.reduce((worst, entry) => entry.ms > worst.ms ? entry : worst),
  };
}

/** Parse plus inference, each counted once it has finished; null before either has. */
export function totalDurationMs(report: RegressionRunReport | null | undefined): number | null {
  const parts = [report?.parse?.durationMs, report?.inference?.durationMs]
    .filter((ms): ms is number => typeof ms === 'number');
  return parts.length ? parts.reduce((sum, ms) => sum + ms, 0) : null;
}

/** Starts a phase now; the returned function ends it. */
export function startPhase(phases: RunPhase[], name: string): () => void {
  const phase: RunPhase = { name, startedAt: new Date().toISOString(), durationMs: null };
  phases.push(phase);
  const started = Date.now();
  return () => {
    if (phase.durationMs === null) phase.durationMs = Date.now() - started;
  };
}

export function formatDuration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '–';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  if (minutes < 60) return `${minutes}m${String(rest).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

/** A timestamp in local time: the date only when it is not today. */
export function formatTimestamp(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = date.toLocaleTimeString();
  return date.toDateString() === now.toDateString() ? time : `${date.toLocaleDateString()} ${time}`;
}

/** The pill's one line: each step's duration (or that it runs), the total, the score. */
export function reportSummary(report: RegressionRunReport | null | undefined): string {
  const parts: string[] = [];
  const parse = report?.parse;
  const inference = report?.inference;
  if (parse) {
    parts.push(parse.durationMs === null ? 'Parsing…' : `Parse ${formatDuration(parse.durationMs)}`);
  }
  if (inference) {
    parts.push(inference.durationMs === null ? 'Inference…' : `Inference ${formatDuration(inference.durationMs)}`);
  }
  const total = totalDurationMs(report);
  if (parse?.durationMs != null && inference?.durationMs != null && total !== null) {
    parts.push(`Total ${formatDuration(total)}`);
  }
  if (inference?.finishedAt && inference.results.total) {
    parts.push(`${inference.results.correct}/${inference.results.total} correct`);
  }
  return parts.join(' · ');
}

/** The full report, one section per step. `label` names a sentence or item for the fastest
 *  and slowest entries. */
export function reportDetails(
  report: RegressionRunReport | null | undefined,
  label: (id: string) => string = id => id,
  now = new Date(),
): string {
  const lines: string[] = [];
  const stats = (what: string, value: TimingStats | null) => value
    ? `    per ${what}: average ${formatDuration(value.averageMs)}`
      + ` · fastest ${label(value.fastest.id)} ${formatDuration(value.fastest.ms)}`
      + ` · slowest ${label(value.slowest.id)} ${formatDuration(value.slowest.ms)}`
    : null;
  const phaseLines = (phases: RunPhase[], perEntry: Record<string, string | null>) => phases.flatMap(phase => [
    `  ${phase.name}: ${phase.durationMs === null ? 'running' : formatDuration(phase.durationMs)}`
      + ` (started ${formatTimestamp(phase.startedAt, now)})`,
    ...(perEntry[phase.name] ? [perEntry[phase.name] as string] : []),
  ]);

  const parse = report?.parse;
  if (parse) {
    lines.push(`Parse: ${parse.durationMs === null ? 'running' : formatDuration(parse.durationMs)}`
      + ` (started ${formatTimestamp(parse.startedAt, now)})`);
    lines.push(...phaseLines(parse.phases, {
      [PARSE_PHASES.parsing]: stats('sentence', parse.parsing),
      [PARSE_PHASES.composition]: stats('sentence', parse.composition),
    }));
    // Composition per sentence covers the discourse items too, whose sentences are
    // composed in their own phase.
    if (!parse.phases.some(phase => phase.name === PARSE_PHASES.composition) && parse.composition) {
      lines.push(stats('sentence', parse.composition)!);
    }
    const { total, successful, failedIds } = parse.sentences;
    lines.push(`  Sentences: ${successful}/${total} with a semantics`
      + (failedIds.length ? ` · without: ${failedIds.join(', ')}` : ''));
    lines.push(`  Items: ${parse.items.total}`
      + (parse.items.discourse ? ` · ${parse.items.discourse} discourse item(s) derived in sequence` : ''));
    parse.items.stopped.forEach(stopped => lines.push(`    stopped: ${stopped}`));
    if (parse.failure) lines.push(`  Failed: ${parse.failure}`);
  }

  const inference = report?.inference;
  if (inference) {
    const scope = inference.selected ? `${inference.itemsInRun} selected item(s)` : `${inference.itemsInRun} item(s)`;
    lines.push(`Inference: ${inference.durationMs === null ? 'running' : formatDuration(inference.durationMs)}`
      + ` (started ${formatTimestamp(inference.startedAt, now)}; ${inference.runKind}, ${scope})`);
    lines.push(...phaseLines(inference.phases, {
      [INFERENCE_PHASES.preparation]: stats('item', inference.preparation),
      [INFERENCE_PHASES.vampire]: stats('item', inference.vampire),
    }));
    if (inference.finishedAt) {
      const { total, correct, wrong, notParsed, noVerdict } = inference.results;
      lines.push(`  Results (all ${total} items): ${correct} correct · ${wrong} wrong · `
        + `${notParsed} not parsed · ${noVerdict} without verdict`);
      lines.push(`  Proofs: ${inference.proofs}`);
    }
    if (inference.failure) lines.push(`  Failed: ${inference.failure}`);
  }

  const total = totalDurationMs(report);
  if (parse?.durationMs != null && inference?.durationMs != null && total !== null) {
    lines.push(`Total: ${formatDuration(total)} (parse + inference)`);
  }
  return lines.join('\n');
}

export const PARSE_PHASES = {
  parsing: 'Parsing (LiGER)',
  composition: 'Composition (GSWB)',
  discourse: 'Discourse items in sequence (LiGER + GSWB)',
} as const;

export const INFERENCE_PHASES = {
  preparation: 'Preparation (checks, TPTP)',
  vampire: 'Vampire',
} as const;
