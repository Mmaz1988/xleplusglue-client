import { NgZone } from '@angular/core';
import cytoscape, { Core } from 'cytoscape';

/**
 * A cytoscape instance outside Angular's zone. Cytoscape redraws on every animation frame for
 * as long as it lives; created in the zone, each frame runs change detection over the whole
 * app, and with a large document loaded the page does little else. Its event handlers run
 * outside the zone too: a handler that changes what a template shows enters it (`zone.run`).
 * The previous instance is destroyed, since its loop runs on until it is.
 */
export function cytoscapeOutsideAngular(
  zone: NgZone, options: cytoscape.CytoscapeOptions, previous?: Core | null,
): Core {
  previous?.destroy();
  return zone.runOutsideAngular(() => cytoscape(options));
}
