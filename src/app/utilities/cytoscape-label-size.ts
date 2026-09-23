/** Node sizes that follow the node's label.
 *
 *  Cytoscape used to take `width: 'label'` / `height: 'label'` for this. 3.25 deprecates that
 *  value and warns, and replacing it with a fixed 80 x 30px (client 86c61f3) made nodes stop
 *  matching their contents: a longer label spilled out of its box in the explanation graph and
 *  the subgraph dialog. Cytoscape's intended replacement is a function value: these measure the
 *  label with the font cytoscape draws it in, so a node is as large as its text, and the style's
 *  `padding` adds the margin around it, as it did with `'label'`. */

/** Cytoscape's default label font; the styles using these helpers do not change it. */
const FONT_SIZE_PX = 16;
const FONT = `${FONT_SIZE_PX}px Helvetica Neue, Helvetica, sans-serif`;
/** An empty label still gets a small node rather than none. */
const MIN_SIZE_PX = 10;

let context: CanvasRenderingContext2D | null | undefined;

function measure(text: string): number {
  if (context === undefined) {
    context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (context) {
      context.font = FONT;
    }
  }
  // Without a canvas (not in a browser), an average glyph width is close enough.
  return context ? context.measureText(text).width : text.length * FONT_SIZE_PX * 0.6;
}

/** A node's label as drawn: the data field its style's `content` shows. */
function labelOf(ele: any, field: string): string {
  const value = ele?.data?.(field);
  return value === undefined || value === null ? '' : String(value);
}

/** `width` for a node whose style shows `data(<field>)`: its label's width. */
export function labelWidth(field = 'id'): (ele: any) => number {
  return ele => Math.max(MIN_SIZE_PX, Math.ceil(measure(labelOf(ele, field))));
}

/** `height` for such a node: one line of its label. */
export function labelHeight(): (ele: any) => number {
  return () => FONT_SIZE_PX;
}
