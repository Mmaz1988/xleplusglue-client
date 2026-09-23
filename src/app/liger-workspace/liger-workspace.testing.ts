import { of } from 'rxjs';
import { LigerConfigTree, LigerRuleSet } from '../models/models';
import { LigerFileSource } from './liger-file-source.service';

/** A config with two semantics files, pragmatics, a lexicon, and an axiom file outside the
 *  config's scope, for the workspace's specs. */
export const RULE_SET: LigerRuleSet = {
  kind: 'config',
  source: './liger_resources/rules/c.liger.yaml',
  // Deliberately not what the client would assemble: an unedited section must be sent
  // exactly as LiGER assembled it.
  semantics: 'SERVER SEMANTICS',
  pragmatics: 'SERVER PRAGMATICS',
  lexica: ['/res/dicts/d.txt'],
  axioms: 'SERVER AXIOMS',
};

export const TREE: LigerConfigTree = {
  kind: 'config',
  source: './liger_resources/rules/c.liger.yaml',
  scope: '/res/rules',
  projectRoot: '/res',
  sections: [
    { field: 'semantics', present: true, files: [
      { path: '/res/rules/a.liger', name: 'a.liger', inScope: true, count: 3 },
      { path: '/res/rules/b.liger', name: 'b.liger', inScope: true, count: 2 },
    ] },
    { field: 'pragmatics', present: true, files: [
      { path: '/res/rules/p.liger', name: 'p.liger', inScope: true, count: 13 },
    ] },
    { field: 'lexica', present: true, files: [
      { path: '/res/dicts/d.txt', name: 'd.txt', inScope: true, count: 40 },
    ] },
    { field: 'axioms', present: true, files: [
      { path: '/res/axioms/x.p', name: 'x.p', inScope: false, count: 5 },
    ] },
  ],
};

export const FILES: Record<string, string> = {
  '/res/rules/a.liger': 'A RULES\n',
  '/res/rules/b.liger': '--lexicon(../dicts/e.txt)\nB RULES\n',
  '/res/rules/p.liger': 'P RULES\n',
  '/res/dicts/d.txt': '>tense\n***\n#FUTURE\nwill\n',
  '/res/axioms/x.p': 'fof(x, axiom, p).\n',
};

export function fileSourceSpy(): jasmine.SpyObj<LigerFileSource> {
  const spy = jasmine.createSpyObj<LigerFileSource>('LigerFileSource',
    ['loadRuleSet', 'listConfig', 'read', 'listConfigsForGrammar', 'browse']);
  spy.loadRuleSet.and.returnValue(of(RULE_SET));
  spy.listConfig.and.returnValue(of(TREE));
  spy.read.and.callFake((path: string) => of(FILES[path]));
  spy.browse.and.returnValue(of([]));
  return spy;
}
