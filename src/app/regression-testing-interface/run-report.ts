/**
 * The report on a regression run: what the parse and the inference step did, when each (and
 * each of its phases) started, how long it took, and what came of it. Persisted with the
 * session (`analysis.report`), so a loaded session shows the report of the run it holds.
 *
 * A step's duration is its own, start to finish: the time between the two steps (waiting,
 * disambiguating) is in neither, and the total is their sum. A full parse or run replaces its
 * step in the main report and clears the rerun report; a rerun (reparse selected, inference
 * over selected items) writes the rerun report, which the next rerun replaces. There is no
 * history.
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

/** One phase of a step: when it first started and how long it ran, adding up every call it
 *  made (null while it runs). */
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
  /** Per item: building its discourse, and the same split into the sequence merge (LiGER
   *  /sequence and GSWB /merge_sequence_semantics), the post-processing rules and
   *  /generate_pcdrs. Absent in reports from before N4 6g. */
  discourses?: TimingStats | null;
  discourseSteps?: Record<DiscourseStep, TimingStats | null>;
  /** A sentence parses successfully when GSWB composes at least one semantic reading. */
  sentences: { total: number; successful: number; failedIds: string[] };
  /** `discourse`: items of more than one sentence. `stopped`: only in reports of parses that
   *  derived discourse items in sequence (before docs/plans/DERIVE_ONCE_REBASE_PLAN.md): the
   *  items that stopped at a sentence without semantics, as "item: sentence -- reason". */
  items: { total: number; discourse: number; stopped?: string[] };
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
  /** Reasoning branches Vampire checked (one bundle of four checks each), over all items. */
  proofs: number;
}

/** The steps of building one item's discourse, timed per item. */
export type DiscourseStep = 'merge' | 'rules' | 'pcdrs';

export interface RunReports {
  parse: ParseReport | null;
  inference: InferenceReport | null;
}

export interface RegressionRunReport extends RunReports {
  /** The latest rerun's steps; null or absent when there was none since the last full one. */
  rerun?: RunReports | null;
}

export function emptyRunReport(): RegressionRunReport {
  return { parse: null, inference: null, rerun: null };
}

/** Per-item times of each discourse step, summed over the calls an item makes. */
export class DiscourseStepTimings {
  private readonly ms: Record<DiscourseStep, Record<string, number>> = { merge: {}, rules: {}, pcdrs: {} };

  add(step: DiscourseStep, itemId: string, ms: number): void {
    this.ms[step][itemId] = (this.ms[step][itemId] ?? 0) + ms;
  }

  stats(): Record<DiscourseStep, TimingStats | null> {
    return { merge: timingStats(this.ms.merge), rules: timingStats(this.ms.rules), pcdrs: timingStats(this.ms.pcdrs) };
  }
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
export function totalDurationMs(report: RunReports | null | undefined): number | null {
  const parts = [report?.parse?.durationMs, report?.inference?.durationMs]
    .filter((ms): ms is number => typeof ms === 'number');
  return parts.length ? parts.reduce((sum, ms) => sum + ms, 0) : null;
}

/** Adds one call's time to a phase: creates the phase at its first call, sums the rest. */
export function addToPhase(phases: RunPhase[], name: string, startedAtMs: number, ms: number): void {
  const phase = phases.find(candidate => candidate.name === name);
  if (!phase) {
    phases.push({ name, startedAt: new Date(startedAtMs).toISOString(), durationMs: ms });
    return;
  }
  phase.durationMs = (phase.durationMs ?? 0) + ms;
  if (startedAtMs < new Date(phase.startedAt).getTime()) phase.startedAt = new Date(startedAtMs).toISOString();
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

/** The pill's one line: each step's duration (or that it runs), the total, the score; then
 *  the same for the last rerun. */
export function reportSummary(report: RegressionRunReport | null | undefined): string {
  const main = stepsSummary(report);
  const rerun = report?.rerun ? stepsSummary(report.rerun) : '';
  return [main, rerun && `last rerun: ${rerun}`].filter(Boolean).join(' · ');
}

function stepsSummary(report: RunReports | null | undefined): string {
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
    const { correct, total, wrong, notParsed, noVerdict } = inference.results;
    parts.push(`${correct}/${total} correct`);
    // An item without a verdict is not a wrong one; say which it is.
    if (wrong) parts.push(`${wrong} wrong`);
    if (noVerdict) parts.push(`${noVerdict} no verdict`);
    if (notParsed) parts.push(`${notParsed} not parsed`);
  }
  return parts.join(' · ');
}

/** One row of the timing table: a step, one of its phases, or a part of a phase, with the
 *  per-sentence or per-item statistics where there are any. */
export interface ReportTimingRow {
  label: string;
  phase: boolean;
  /** A part of the phase above it (the discourse phase's steps). */
  part?: boolean;
  started: string;
  duration: string;
  per: string;
  count: string;
  average: string;
  /** Time and the sentence or item it belongs to, shown as "609ms (S8)". */
  fastest: TimedCell | null;
  slowest: TimedCell | null;
}

export interface TimedCell {
  duration: string;
  id: string;
}

/** The report as tables: timings (steps, their phases, the total) and outcomes. */
export function reportTables(
  report: RunReports | null | undefined,
  now = new Date(),
): { timings: ReportTimingRow[]; outcomes: Array<[string, string]> } {
  const timings: ReportTimingRow[] = [];
  const outcomes: Array<[string, string]> = [];
  const row = (label: string, phase: boolean, started: string | null, durationMs: number | null,
               per = '', stats: TimingStats | null = null): ReportTimingRow => ({
    label, phase,
    started: started ? formatTimestamp(started, now) : '',
    duration: durationMs === null ? 'running' : formatDuration(durationMs),
    per: stats ? per : '',
    count: stats ? String(stats.count) : '',
    average: stats ? formatDuration(stats.averageMs) : '',
    fastest: stats ? { duration: formatDuration(stats.fastest.ms), id: stats.fastest.id } : null,
    slowest: stats ? { duration: formatDuration(stats.slowest.ms), id: stats.slowest.id } : null,
  });
  const phaseStats: Record<string, [string, TimingStats | null]> = {};

  const parse = report?.parse;
  if (parse) {
    phaseStats[PARSE_PHASES.parsing] = ['sentence', parse.parsing];
    phaseStats[PARSE_PHASES.composition] = ['sentence', parse.composition];
    phaseStats[PARSE_PHASES.discourses] = ['item', parse.discourses ?? null];
    timings.push(row('Parse', false, parse.startedAt, parse.durationMs));
    parse.phases.forEach(phase => {
      timings.push(row(phase.name, true, phase.startedAt, phase.durationMs, ...(phaseStats[phase.name] ?? ['', null])));
      if (phase.name !== PARSE_PHASES.discourses || !parse.discourseSteps) return;
      (Object.keys(DISCOURSE_STEPS) as DiscourseStep[]).forEach(step => {
        const stats = parse.discourseSteps![step];
        // Items are built one after another: a step's time is the sum over them.
        if (stats) timings.push({ ...row(DISCOURSE_STEPS[step], true, null, stats.totalMs, 'item', stats), part: true });
      });
    });
    outcomes.push(['Sentences with a semantics', `${parse.sentences.successful} / ${parse.sentences.total}`]);
    if (parse.sentences.failedIds.length) outcomes.push(['Without a semantics', parse.sentences.failedIds.join(', ')]);
    outcomes.push(['Items', String(parse.items.total)]);
    if (parse.items.discourse) outcomes.push(['Discourse items', String(parse.items.discourse)]);
    (parse.items.stopped ?? []).forEach(stopped => outcomes.push(['Stopped', stopped]));
    if (parse.failure) outcomes.push(['Parse failed', parse.failure]);
  }

  const inference = report?.inference;
  if (inference) {
    phaseStats[INFERENCE_PHASES.preparation] = ['item', inference.preparation];
    phaseStats[INFERENCE_PHASES.vampire] = ['item', inference.vampire];
    timings.push(row('Inference', false, inference.startedAt, inference.durationMs));
    inference.phases.forEach(phase => timings.push(row(phase.name, true, phase.startedAt, phase.durationMs,
      ...(phaseStats[phase.name] ?? ['', null]))));
    outcomes.push(['Inference run', `${inference.runKind}, ${inference.itemsInRun} `
      + `${inference.selected ? 'selected ' : ''}item(s)`]);
    if (inference.finishedAt) {
      const { total, correct, wrong, notParsed, noVerdict } = inference.results;
      outcomes.push(['Correct', `${correct} / ${total}`]);
      outcomes.push(['Wrong', String(wrong)]);
      outcomes.push(['Not parsed', String(notParsed)]);
      outcomes.push(['Without verdict', String(noVerdict)]);
      outcomes.push(['Reasoning branches checked', String(inference.proofs)]);
    }
    if (inference.failure) outcomes.push(['Inference failed', inference.failure]);
  }

  const total = totalDurationMs(report);
  if (parse?.durationMs != null && inference?.durationMs != null && total !== null) {
    timings.push(row('Total (parse + inference)', false, null, total));
  }
  return { timings, outcomes };
}

export const PARSE_PHASES = {
  parsing: 'Parsing (LiGER)',
  composition: 'Composition (GSWB)',
  discourses: 'Discourses (rules, PCDRS)',
} as const;

export const DISCOURSE_STEPS: Record<DiscourseStep, string> = {
  merge: 'Sequence merge (LiGER, GSWB)',
  rules: 'Post-processing rules (LiGER)',
  pcdrs: 'PCDRS (/generate_pcdrs)',
};

export const INFERENCE_PHASES = {
  preparation: 'Preparation (checks, TPTP)',
  vampire: 'Vampire',
} as const;

/** One NLI item as the Markdown report lists it. */
export interface MarkdownReportItem {
  id: string;
  gold: string;
  predicted: string;
  status: string;
  /** Why it has no verdict, if it has none. */
  reason: string;
  premises: string[];
  hypothesis: string;
}

/** Everything the downloadable report shows besides the run report itself. */
export interface MarkdownReportInput {
  sessionKey: string;
  /** Run settings as label/value pairs (grammar, rule files, logic type, ...). */
  settings: Array<[string, string]>;
  items: MarkdownReportItem[];
  /** Gold label rows by predicted label columns, in `labels` order. */
  confusion: { labels: string[]; names: Record<string, string>; counts: number[][] } | null;
}

/** The run report, the items and the confusion matrix as one Markdown document. */
export function reportMarkdown(report: RegressionRunReport | null | undefined, input: MarkdownReportInput,
                               now = new Date()): string {
  const cell = (value: unknown) => String(value ?? '')
    .replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const table = (header: string[], rows: unknown[][]) => [
    `| ${header.map(cell).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');

  const lines: string[] = [`# Regression report: ${input.sessionKey}`, '', `Generated ${now.toISOString()}`, ''];
  const summary = reportSummary(report);
  if (summary) lines.push(`**${summary}**`, '');

  if (input.settings.length) {
    lines.push('## Settings', '', table(['Setting', 'Value'], input.settings), '');
  }

  const reportSection = (steps: RunReports | null | undefined, heading: (name: string) => string) => {
    const { timings, outcomes } = reportTables(steps, now);
    if (timings.length) {
      lines.push(heading('Timings'), '', table(
        ['Step', 'Started', 'Duration', 'Per', 'Count', 'Average', 'Fastest', 'Slowest'],
        timings.map(row => [
          row.part ? `↳ ↳ ${row.label}` : row.phase ? `↳ ${row.label}` : row.label,
          row.started, row.duration, row.per, row.count, row.average,
          row.fastest ? `${row.fastest.duration} (${row.fastest.id})` : '',
          row.slowest ? `${row.slowest.duration} (${row.slowest.id})` : '',
        ])), '');
    }
    if (outcomes.length) {
      lines.push(heading('Outcomes'), '', table(['', ''], outcomes), '');
    }
  };
  reportSection(report, name => `## ${name}`);
  if (report?.rerun) reportSection(report.rerun, name => `## Last rerun: ${name.toLowerCase()}`);

  if (input.confusion) {
    const { labels, names, counts } = input.confusion;
    lines.push('## Confusion matrix', '', 'Rows: gold label. Columns: predicted label.', '', table(
      ['Gold / predicted', ...labels.map(label => names[label] ?? label)],
      labels.map((gold, g) => [names[gold] ?? gold, ...labels.map((_, p) => counts[g]?.[p] ?? 0)])), '');
  }

  if (input.items.length) {
    lines.push('## Items', '', table(
      ['Id', 'Gold', 'Predicted', 'Status', 'Premises', 'Hypothesis', 'Note'],
      input.items.map(item => [item.id, item.gold, item.predicted, item.status,
        item.premises.join('\n'), item.hypothesis, item.reason])), '');
  }
  return lines.join('\n');
}
