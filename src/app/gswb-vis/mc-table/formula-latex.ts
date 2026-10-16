import { RESOURCE_TOKEN } from './mc-table.component';

const BINDER = /^A([A-Za-z]\w*)\./;

export function formulaToLatex(formula: string): string {
  let body = formula.trim();
  let prefix = '';

  let m = BINDER.exec(body);
  while (m) {
    prefix += `\\forall ${m[1]}.`;
    body = body.slice(m[0].length);
    m = BINDER.exec(body);
  }

  const withResources = body.replace(RESOURCE_TOKEN, (_match, num, type) => `g_{${num}}^{${type}}`);
  const withMultimap = withResources.replace(/\s-o\s/g, ' \\multimap ');

  return prefix + withMultimap;
}
