import {
  INFERENCE_PHASES, PARSE_PHASES, RegressionRunReport, addToPhase, formatDuration, reportSummary,
  reportTables, startPhase, timingStats, totalDurationMs,
} from './run-report';
import { createRegressionTestingSession, regressionDocumentToSession, regressionSessionToDocument } from '../models/models';

describe('run report', () => {
  const report = (): RegressionRunReport => ({
    parse: {
      startedAt: '2026-10-01T10:00:00.000Z', finishedAt: '2026-10-01T10:01:00.000Z', durationMs: 60000,
      phases: [
        { name: PARSE_PHASES.parsing, startedAt: '2026-10-01T10:00:00.000Z', durationMs: 40000 },
        { name: PARSE_PHASES.composition, startedAt: '2026-10-01T10:00:40.000Z', durationMs: 20000 },
      ],
      parsing: timingStats({ S0: 1000, S1: 3000 }),
      composition: timingStats({ S0: 200, S1: 400 }),
      sentences: { total: 3, successful: 2, failedIds: ['S2'] },
      items: { total: 2, discourse: 1, stopped: ['n1: S2 "x" -- no semantics derived'] },
    },
    inference: {
      startedAt: '2026-10-01T10:30:00.000Z', finishedAt: '2026-10-01T10:32:00.000Z', durationMs: 120000,
      phases: [
        { name: INFERENCE_PHASES.preparation, startedAt: '2026-10-01T10:30:00.000Z', durationMs: 30000 },
        { name: INFERENCE_PHASES.vampire, startedAt: '2026-10-01T10:30:30.000Z', durationMs: 90000 },
      ],
      runKind: 'initial', itemsInRun: 2, selected: false,
      preparation: timingStats({ n0: 30000 }),
      vampire: timingStats({ n0: 90000 }),
      results: { total: 2, correct: 1, wrong: 0, notParsed: 1, noVerdict: 0 },
      proofs: 8,
    },
  });

  it('computes average, fastest and slowest, skipping missing times', () => {
    const stats = timingStats({ a: 100, b: 300, c: undefined, d: 200 })!;
    expect(stats.count).toBe(3);
    expect(stats.averageMs).toBe(200);
    expect(stats.fastest).toEqual({ id: 'a', ms: 100 });
    expect(stats.slowest).toEqual({ id: 'b', ms: 300 });
    expect(timingStats({})).toBeNull();
  });

  it('totals parse and inference only, not the time between them', () => {
    // 10:01 to 10:30 is waiting/disambiguating: in neither step.
    expect(totalDurationMs(report())).toBe(180000);
    expect(reportSummary(report())).toBe('Parse 1m00s · Inference 2m00s · Total 3m00s · 1/2 correct');
  });

  it('says a step runs while it runs', () => {
    const running = report();
    running.inference!.durationMs = null;
    running.inference!.finishedAt = null;
    expect(reportSummary(running)).toBe('Parse 1m00s · Inference…');
  });

  it('tabulates steps, phases with their per-sentence and per-item extremes, and the outcomes', () => {
    const { timings, outcomes } = reportTables(report());
    expect(timings.map(row => [row.label, row.phase, row.duration])).toEqual([
      ['Parse', false, '1m00s'],
      [PARSE_PHASES.parsing, true, '40.0s'],
      [PARSE_PHASES.composition, true, '20.0s'],
      ['Inference', false, '2m00s'],
      [INFERENCE_PHASES.preparation, true, '30.0s'],
      [INFERENCE_PHASES.vampire, true, '1m30s'],
      ['Total (parse + inference)', false, '3m00s'],
    ]);
    const parsing = timings[1];
    expect([parsing.per, parsing.count, parsing.average, parsing.fastest, parsing.slowest])
      .toEqual(['sentence', '2', '2.00s', { duration: '1.00s', id: 'S0' }, { duration: '3.00s', id: 'S1' }]);
    expect(timings[0].fastest).toBeNull();
    expect(outcomes).toContain(['Sentences with a semantics', '2 / 3']);
    expect(outcomes).toContain(['Without a semantics', 'S2']);
    expect(outcomes).toContain(['Correct', '1 / 2']);
    expect(outcomes).toContain(['Not parsed', '1']);
    expect(outcomes).toContain(['Proofs', '8']);
  });

  it('sums a phase over its calls and keeps its first start', () => {
    const phases: any[] = [];
    addToPhase(phases, 'GSWB', Date.parse('2026-10-01T10:00:05.000Z'), 300);
    addToPhase(phases, 'GSWB', Date.parse('2026-10-01T10:00:01.000Z'), 200);
    expect(phases.length).toBe(1);
    expect(phases[0].durationMs).toBe(500);
    expect(phases[0].startedAt).toBe('2026-10-01T10:00:01.000Z');
  });

  it('ends a phase once', () => {
    const phases: any[] = [];
    const end = startPhase(phases, 'x');
    expect(phases[0].durationMs).toBeNull();
    end();
    const first = phases[0].durationMs;
    end();
    expect(phases[0].durationMs).toBe(first);
  });

  it('formats durations', () => {
    expect(formatDuration(450)).toBe('450ms');
    expect(formatDuration(1234)).toBe('1.23s');
    expect(formatDuration(75000)).toBe('1m15s');
    expect(formatDuration(null)).toBe('–');
  });

  it('is saved with the session and restored on load', () => {
    const session = { ...createRegressionTestingSession(), report: report() };
    const restored = regressionDocumentToSession(JSON.parse(JSON.stringify(regressionSessionToDocument(session))));
    expect(restored.report).toEqual(report());
  });

  it('loads a session saved before reports existed with an empty one', () => {
    const document: any = regressionSessionToDocument(createRegressionTestingSession());
    delete document.analysis.report;
    expect(regressionDocumentToSession(document).report).toEqual({ parse: null, inference: null });
  });
});
