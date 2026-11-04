import { proofFileStatus } from './proof-files.component';
import { proofReadingsOf } from '../../analysis-model';

const summary = (command: string, status: string) =>
  `fof(a, axiom, p).\n\n% ---- Vampire run ----\n% command: bin/vampire ${command} -t 3 sem.p\n`
  + `% time limit: 3s (returned after 0.12s)\n% SZS status: ${status}\n`;

describe('proofFileStatus', () => {
  it('reads the status and mode from the run summary block', () => {
    expect(proofFileStatus(summary('-sa fmb', 'CounterSatisfiable')))
      .toEqual({ status: 'CounterSatisfiable', mode: 'fmb', tone: 'model' });
    expect(proofFileStatus(summary('--mode casc', 'Theorem')))
      .toEqual({ status: 'Theorem', mode: 'casc', tone: 'refutation' });
  });

  it('marks undecided and unrun files as open', () => {
    expect(proofFileStatus(summary('-sa fmb', 'Timeout')).tone).toBe('open');
    expect(proofFileStatus('fof(a, axiom, p).')).toEqual({ status: 'not run', mode: '', tone: 'open' });
    expect(proofFileStatus(undefined).status).toBe('not run');
  });
});

describe('proofReadingsOf', () => {
  it('lists the assignments with a verdict, in their order, with their own files', () => {
    const verdict = (files: string[], informative: boolean) =>
      ({ consistent: true, informative, relevant: false, proofFiles: files });
    const update: any = {
      id: 'ru-1', assignments: [
        { id: 'a1', discourseId: 'r-1', verdict: verdict(['1a', '1b', '1c', '1d'], true) },
        { id: 'a2' },
        { id: 'a3', verdict: verdict(['3a', '3b', '3c', '3d'], false) },
      ],
    };
    expect(proofReadingsOf(update)).toEqual([
      { label: 'r-1 — consistent, informative, irrelevant', files: ['1a', '1b', '1c', '1d'] },
      { label: 'a3 — consistent, uninformative, irrelevant', files: ['3a', '3b', '3c', '3d'] },
    ]);
  });
});
