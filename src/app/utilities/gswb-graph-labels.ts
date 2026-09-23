/** Labels for GSWB's explanation graph (the Lev prover's category graph) and its subgraphs.
 *
 *  A node's id is its category in GSWB's plain notation (`g_e -o f_t`), and a strongly
 *  connected component's id is the whole component written out. What is drawn instead is
 *  GSWB's own pretty print, which it sends as `text`: typed atoms subscripted (gₑ), `-o` as ⊸.
 *  The client does not pretty-print: GSWB's Category.toUTF8 is the one place that does. */

/** A strongly connected component: GSWB marks it green and gives it its own graph. */
export function isScc(data: any): boolean {
  return data?.color === 'green' && !!data.subgraph;
}

/** How many nodes a component holds: its subgraph's green and yellow (goal) nodes, as GSWB
 *  builds them; the blue ones are premises feeding into it, not members. */
function sccMembers(data: any): number | null {
  const elements = data?.subgraph?.graphElements;
  if (!Array.isArray(elements)) {
    return null;
  }
  return elements.filter(e => e?.data && e.data.source === undefined
    && (e.data.color === 'green' || e.data.color === 'yellow')).length;
}

/** Each node's `label`, the text drawn in it:
 *  - a strongly connected component: what it produces, GSWB's `outputs` (its members with an
 *    edge leaving it, or its goal when the derivation ends in it); "SCC n (members)", numbered
 *    in graph order, when GSWB sends none;
 *  - any other node: GSWB's pretty-printed `text`, or its id when there is none.
 *  Edges refer to ids, which stay as they are. */
export function withLabels(elements: any[]): any[] {
  let scc = 0;
  return (elements ?? []).map(element => {
    const data = element?.data;
    if (!data || data.source !== undefined) {
      return element;
    }
    let label = typeof data.text === 'string' && data.text ? data.text : String(data.id);
    if (isScc(data)) {
      scc++;
      const members = sccMembers(data);
      label = Array.isArray(data.outputs) && data.outputs.length
        ? data.outputs.join(', ')
        : `SCC ${scc}${members ? ` (${members})` : ''}`;
    }
    return { ...element, data: { ...data, label } };
  });
}
