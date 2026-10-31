import { DiscourseAnalysis, PragmaticChoice } from './models/models';
import {
  listedChoicePoints,
  narrowedByPragmatics,
  pragmaticAlternatives,
  pragmaticSurvivors,
} from './pragmatic-discriminants';

function choice(kind: PragmaticChoice['kind'], point: string, resolution: PragmaticChoice['resolution'], target: string,
                extra: Partial<PragmaticChoice> = {}): PragmaticChoice {
  return {
    kind, point, pointLabel: point, resolution, target,
    targetLabel: ({ GLOBAL: 'global', LOCAL: 'in situ', INTERMEDIATE: 'intermediate' } as Record<string, string>)[target] ?? target,
    id: `${kind}@${point}=${target}`, direct: true, ...extra,
  };
}

function reading(id: string, semanticOrigin: string, choices: PragmaticChoice[] | undefined): DiscourseAnalysis {
  return {
    id, semanticOrigin, drsString: id, ruleBranch: 1, anaphoraMapping: { relations: [] }, collapsed: false,
    ...(choices ? { choices } : {}),
  };
}

/** "Every cat did not see the hat.": two scope readings (every > not, not > every), the hat
 *  global, in situ, or intermediate at s1 or s2 -- which are other boxes in each (D2a). */
const theHat = (target: string, site?: string, siteLabel?: string) =>
  choice('PRESUPPOSITION', '27-34', 'ACCOMMODATED', target, site ? { site, siteLabel } : {});
const EVERY_NOT: DiscourseAnalysis[] = [
  reading('a1', 'sem-a', [theHat('LOCAL')]),
  reading('a2', 'sem-a', [theHat('GLOBAL')]),
  reading('a3', 'sem-a', [theHat('INTERMEDIATE', 's1', 'antecedent')]),
  reading('a4', 'sem-a', [theHat('INTERMEDIATE', 's2', 'consequent')]),
  reading('b1', 'sem-b', [theHat('LOCAL')]),
  reading('b2', 'sem-b', [theHat('GLOBAL')]),
  reading('b3', 'sem-b', [theHat('INTERMEDIATE', 's1', 'negation')]),
  reading('b4', 'sem-b', [theHat('INTERMEDIATE', 's2', 'antecedent')]),
];

describe('Pragmatic discriminants', () => {
  it('list no alternative while a reading has no choices (D1)', () => {
    expect(pragmaticAlternatives([reading('r1', 'sem', [theHat('LOCAL')]), reading('r2', 'sem', undefined)])).toBeNull();
    expect(listedChoicePoints([], null, [])).toEqual([]);
  });

  it('list an alternative only where it splits the readings (D6)', () => {
    const readings = [
      reading('r1', 'sem', [choice('ANAPHORA', '33-35', 'ANTECEDENT', '2-5'), theHat('GLOBAL')]),
      reading('r2', 'sem', [choice('ANAPHORA', '33-35', 'UNBOUND', '/'), theHat('GLOBAL')]),
    ];
    const points = listedChoicePoints(readings, pragmaticAlternatives(readings), readings);
    expect(points.map(point => point.kind)).toEqual(['ANAPHORA']);
    expect(points[0].alternatives.map(alternative => alternative.id)).toEqual(['ANAPHORA@33-35=2-5', 'ANAPHORA@33-35=/']);
  });

  it('compare intermediate sites across readings by depth only, their boxes within one semantic reading (D2a)', () => {
    const alternatives = pragmaticAlternatives(EVERY_NOT)!;
    const intermediate = alternatives.find(alternative => alternative.id === 'PRESUPPOSITION@27-34=INTERMEDIATE')!;
    expect(intermediate.associatedSolutions).toEqual(['a3', 'a4', 'b3', 'b4']);
    // s1 of one scope reading is not s1 of the other.
    const refinements = alternatives.filter(alternative => alternative.refines);
    expect(refinements.map(alternative => alternative.associatedSolutions)).toEqual([['a3'], ['a4'], ['b3'], ['b4']]);
    // Across both scope readings: no box is listed.
    const across = listedChoicePoints(EVERY_NOT, alternatives, EVERY_NOT);
    expect(across[0].alternatives.map(alternative => alternative.id)).toEqual([
      'PRESUPPOSITION@27-34=GLOBAL', 'PRESUPPOSITION@27-34=INTERMEDIATE', 'PRESUPPOSITION@27-34=LOCAL']);
    // Once one semantic reading is left: its boxes, after intermediate.
    const one = listedChoicePoints(EVERY_NOT, alternatives, EVERY_NOT.filter(r => r.semanticOrigin === 'sem-b'));
    expect(one[0].alternatives.map(alternative => alternative.label)).toEqual([
      'global', 'intermediate', 'negation (s1)', 'antecedent (s2)', 'in situ']);
  });

  it('keep a selected refinement listed when the readings no longer share a semantic reading', () => {
    const alternatives = pragmaticAlternatives(EVERY_NOT)!;
    const selected = 'PRESUPPOSITION@27-34=INTERMEDIATE:s1@sem-b';
    const points = listedChoicePoints(EVERY_NOT, alternatives, EVERY_NOT, [selected]);
    expect(points[0].alternatives.map(alternative => alternative.id)).toContain(selected);
  });

  it('narrow by intersection, a refinement to its own semantic reading (D7)', () => {
    const alternatives = pragmaticAlternatives(EVERY_NOT);
    expect(narrowedByPragmatics(EVERY_NOT, alternatives, ['PRESUPPOSITION@27-34=INTERMEDIATE']).map(r => r.id))
      .toEqual(['a3', 'a4', 'b3', 'b4']);
    expect(narrowedByPragmatics(EVERY_NOT, alternatives, ['PRESUPPOSITION@27-34=INTERMEDIATE:s1@sem-a']).map(r => r.id))
      .toEqual(['a3']);
    expect(narrowedByPragmatics(EVERY_NOT, alternatives, ['PRESUPPOSITION@27-34=GLOBAL', 'PRESUPPOSITION@27-34=LOCAL']))
      .toEqual([]);
    // A stale id keeps nothing rather than everything.
    expect(narrowedByPragmatics(EVERY_NOT, alternatives, ['PRESUPPOSITION@1-2=GLOBAL'])).toEqual([]);
  });

  it('keep hidden readings out of what reaches the inference, under the discriminants', () => {
    const update = {
      discourse: EVERY_NOT,
      pragmaticSelection: { choiceIds: ['PRESUPPOSITION@27-34=INTERMEDIATE'], hiddenReadingIds: ['a4', 'a1'] },
    };
    expect(pragmaticSurvivors(update).map(r => r.id)).toEqual(['a3', 'b3', 'b4']);
    // Narrowed first by something else (scope): the alternatives still mean all readings.
    expect(pragmaticSurvivors(update, EVERY_NOT.filter(r => r.semanticOrigin === 'sem-b')).map(r => r.id))
      .toEqual(['b3', 'b4']);
    expect(pragmaticSurvivors({ discourse: EVERY_NOT })).toBe(EVERY_NOT);
  });
});
