import {
  INFERENCE_PHASES, PARSE_PHASES, RegressionRunReport, formatDuration, reportDetails, reportSummary,
  startPhase, timingStats, totalDurationMs,
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

  it('reports phases with their start, per-sentence and per-item extremes, and the counts', () => {
    const details = reportDetails(report(), id => `<${id}>`);
    expect(details).toContain('Parsing (LiGER): 40.0s');
    expect(details).toContain('per sentence: average 2.00s · fastest <S0> 1.00s · slowest <S1> 3.00s');
    expect(details).toContain('Composition (GSWB): 20.0s');
    expect(details).toContain('Sentences: 2/3 with a semantics · without: S2');
    expect(details).toContain('stopped: n1: S2');
    expect(details).toContain('Results (all 2 items): 1 correct · 0 wrong · 1 not parsed · 0 without verdict');
    expect(details).toContain('Total: 3m00s (parse + inference)');
    expect(details).toMatch(/Vampire: 1m30s \(started .+\)/);
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
