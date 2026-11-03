import { RESOURCE_TOKEN } from './mc-table.component';

const BINDER = /^A([A-Za-z]\w*)\./;

export function stripOuterParens(s: string): string {
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0;
    let closesEarly = false;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        depth--;
        if (depth === 0 && i !== s.length - 1) {
          closesEarly = true;
          break;
        }
      }
    }
    if (closesEarly) break;
    s = s.slice(1, -1).trim();
  }
  return s;
}

export function formulaToLatex(formula: string): string {
  let body = formula.trim();
  let prefix = '';

  let m = BINDER.exec(body);
  while (m) {
    prefix += `\\forall ${m[1]}.`;
    body = body.slice(m[0].length);
    m = BINDER.exec(body);
  }

  body = stripOuterParens(body);

  const withResources = body.replace(RESOURCE_TOKEN, (_match, num, type) => `g_{${type}}{${num}}`);
  const withMultimap = withResources.replace(/\s-o\s/g, ' \\multimap ');

  return prefix + withMultimap;
}
