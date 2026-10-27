import { discourseAnalysesOf, discourseUpdateOf, distinctPcdrsMappings } from './pcdrs-readings';

describe('PCDRS readings', () => {
  const bound = { pronounReferentId: 'x2', antecedent: 'x1', stateLabel: 's1' };

  it('drops a mapping with the same bindings over the same DRS, whatever its rule branch', () => {
    const readings = distinctPcdrsMappings([
      { mapping: { id: 'a', semantic: 'drs', anaphoraRelations: [bound] }, ruleBranchIndex: 1 },
      { mapping: { id: 'b', semantic: 'drs', anaphoraRelations: [bound] }, ruleBranchIndex: 2 },
      { mapping: { id: 'c', semantic: 'drs', anaphoraRelations: [] }, ruleBranchIndex: 2 },
      { mapping: { id: 'd', semantic: 'other', anaphoraRelations: [bound] }, ruleBranchIndex: 2 },
    ]);
    expect(readings.map(({ mapping }) => mapping.id)).toEqual(['a', 'c', 'd']);
  });

  it('records each reading once, under its own semantic origin', () => {
    const { discourse, semDiscourseMapping } = discourseAnalysesOf([
      { mapping: { id: 'p1', semantic: 'drs-1', anaphoraRelations: [bound] }, ruleBranchIndex: 1, semanticOrigin: 'sem-1' },
      { mapping: { id: 'p2', semantic: 'drs-2' }, ruleBranchIndex: 2, semanticOrigin: 'sem-1' },
      { mapping: { id: 'p1', semantic: 'drs-1', anaphoraRelations: [bound] }, ruleBranchIndex: 1, semanticOrigin: 'sem-1' },
      { mapping: { id: 'p3', semantic: 'drs-3' }, ruleBranchIndex: 1, semanticOrigin: 'sem-2' },
    ]);
    expect(discourse.map(entry => entry.id)).toEqual(['p1', 'p2', 'p3']);
    expect(semDiscourseMapping).toEqual({ 'sem-1': ['p1', 'p2'], 'sem-2': ['p3'] });
    expect(discourse.map(entry => entry.ruleBranch)).toEqual([1, 2, 1]);
    expect(discourse.map(entry => entry.collapsed)).toEqual([true, false, false]);
  });

  it('stores an SVG only where GSWB rendered one, and falls back to the reading\'s text', () => {
    const { discourse } = discourseAnalysesOf([
      { mapping: { id: 'p1', semantic: 'drs-1', solution: '<svg/>' }, ruleBranchIndex: 1, semanticOrigin: 'sem-1' },
      { mapping: { id: 'p2', semantic: 'drs-2', solution: null }, ruleBranchIndex: 1, semanticOrigin: 'sem-1' },
      { mapping: { id: 'p3' }, ruleBranchIndex: 1, semanticOrigin: 'sem-1', semString: 'reading' },
    ]);
    expect(discourse[0].svg).toBe('<svg/>');
    expect('svg' in discourse[1]).toBeFalse();
    expect(discourse[2].drsString).toBe('reading');
  });

  it('stores GSWB\'s pragmatic profile with the reading, where it has one', () => {
    const pragmaticProfile = { pronouns: [1, 0, 0], binding: [0, 0, 0], accommodation: [0, 0, 1] };
    const { discourse } = discourseAnalysesOf([
      { mapping: { id: 'p1', semantic: 'drs-1', pragmaticProfile }, ruleBranchIndex: 1, semanticOrigin: 'sem-1' },
      { mapping: { id: 'p2', semantic: 'drs-2' }, ruleBranchIndex: 1, semanticOrigin: 'sem-1' },
    ]);
    expect(discourse[0].pragmaticProfile).toEqual(pragmaticProfile);
    expect('pragmaticProfile' in discourse[1]).toBeFalse();
  });

  it('builds the element\'s update, with a rule string only when one is given', () => {
    const readings = [{ mapping: { id: 'p1', semantic: 'drs' }, ruleBranchIndex: 1, semanticOrigin: 'sem-1' }];
    const update = discourseUpdateOf({ id: 'sentence-1+sentence-2', kind: 'sequence' }, readings, 'rules');
    expect(update.id).toBe('du-sentence-1+sentence-2');
    expect(update.sourceElementId).toBe('sentence-1+sentence-2');
    expect(update.sourceElementKind).toBe('sequence');
    expect(update.ruleString).toBe('rules');
    expect('ruleString' in discourseUpdateOf({ id: 'sentence-1', kind: 'sentence' }, readings)).toBeFalse();
  });
});
