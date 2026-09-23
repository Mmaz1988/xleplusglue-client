/** The client's copy of LiGER's rule-text assembly (LigerConfigLoader.assemble and
 *  LexiconDirectives.absolutize). The workspace uses /load_rules' text as-is while a section
 *  is unedited, and this only once a file in it has been edited, so the two must agree:
 *  xleplusglue's tests/test_config_tree.py checks the same rules against a live LiGER, and
 *  liger-assembly.spec.ts pins them here. */

/** LexiconDirectives.DIRECTIVE. The blanks around a directive are part of the match. */
const LEXICON_DIRECTIVE = /^[ \t]*--lexicon\(([^)\n]*)\)[ \t]*/gm;

const isAbsolute = (path: string) => /^([A-Za-z]:)?[\\/]/.test(path);

/** Rewrites relative --lexicon(...) paths to absolute ones against the rule file's
 *  directory, without normalizing (LiGER resolves "../dicts" through the file system). */
export function absolutizeLexiconDirectives(ruleText: string, ruleFile: string): string {
  const baseDir = ruleFile.substring(0, ruleFile.lastIndexOf('/'));
  return ruleText.replace(LEXICON_DIRECTIVE, (_match, raw: string) => {
    const path = raw.trim();
    return `--lexicon(${isAbsolute(path) ? path : `${baseDir}/${path}`})`;
  });
}

export interface AssemblyFile {
  path: string;
  text: string;
}

/** Concatenates files in order, each headed by a comment naming it: "// " for rule files,
 *  "% " (TPTP) for axiom files. Rule files get their directives made absolute. */
export function assembleFiles(files: AssemblyFile[], kind: 'rules' | 'axioms'): string {
  const comment = kind === 'rules' ? '// ' : '% ';
  return files.map(file => {
    const text = kind === 'rules' ? absolutizeLexiconDirectives(file.text, file.path) : file.text;
    return `${comment}===== ${file.path} =====\n${text}${text.endsWith('\n') ? '' : '\n'}\n`;
  }).join('');
}
