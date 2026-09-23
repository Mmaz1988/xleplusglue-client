import { absolutizeLexiconDirectives, assembleFiles } from './liger-assembly';

/** The format is LiGER's (LigerConfigLoader.assemble, LexiconDirectives.absolutize);
 *  xleplusglue's tests/test_config_tree.py checks the same rules against a live LiGER. */
describe('liger-assembly', () => {

  it('heads each rule file with a // marker and separates files with an empty line', () => {
    const assembled = assembleFiles([
      { path: '/r/a.liger', text: '#a X #b ==> #a Y #b.\n' },
      { path: '/r/b.liger', text: '#a Y #b ==> #a Z #b.' },
    ], 'rules');

    expect(assembled).toBe(
      '// ===== /r/a.liger =====\n#a X #b ==> #a Y #b.\n\n' +
      '// ===== /r/b.liger =====\n#a Y #b ==> #a Z #b.\n\n');
  });

  it('uses TPTP comments for axioms and leaves their text alone', () => {
    const assembled = assembleFiles([{ path: '/ax/a.p', text: '--lexicon(x)\nfof(a, axiom, p).\n' }], 'axioms');

    expect(assembled).toBe('% ===== /ax/a.p =====\n--lexicon(x)\nfof(a, axiom, p).\n\n');
  });

  it('assembles nothing to the empty string', () => {
    expect(assembleFiles([], 'rules')).toBe('');
  });

  it('makes relative lexicon directives absolute against the rule file, without normalizing', () => {
    const text = '  --lexicon(../dicts/d.txt)  \n#a SUBJ #b ==> #a FLAG \'ok\'.\n';

    expect(absolutizeLexiconDirectives(text, '/res/rules/r.liger'))
      .toBe('--lexicon(/res/rules/../dicts/d.txt)\n#a SUBJ #b ==> #a FLAG \'ok\'.\n');
  });

  it('keeps absolute directives and ignores ones that do not start a line', () => {
    const text = '--lexicon(/abs/d.txt)\n// see --lexicon(rel.txt)\n';

    expect(absolutizeLexiconDirectives(text, '/res/r.liger')).toBe(text);
  });

  it('does not treat $ in a path as a replacement pattern', () => {
    expect(absolutizeLexiconDirectives('--lexicon($&.txt)', '/r/x.liger')).toBe('--lexicon(/r/$&.txt)');
  });
});
