import { Component, Input } from '@angular/core';

/** A fixed-position panel that slides out from the right edge on hover.
 *
 *  The pattern was written twice already, verbatim in both places --
 *  glue-interface's `.data-model-sidebar` and chat-interface's `.chat-toolbar-sidebar`,
 *  each with its own copy of the same 40 lines of CSS. This is that pattern once, so a
 *  third view does not mean a third copy. The other two still have theirs; they can be
 *  migrated onto this component separately.
 *
 *  `position: fixed` is load-bearing, not decoration: it takes the sidebar out of the
 *  host's layout entirely, so hovering it can never reflow or squeeze the view behind it.
 *  `:focus-within` opens it too, so the panel is reachable by keyboard and not just mouse. */
@Component({
  selector: 'app-hover-sidebar',
  templateUrl: './hover-sidebar.component.html',
  styleUrls: ['./hover-sidebar.component.css'],
})
export class HoverSidebarComponent {
  /** Text on the vertical handle -- the only part visible while collapsed. */
  @Input() label = 'Options';
  /** Vertical placement, so two sidebars on one view need not overlap. */
  @Input() top = '45%';
}
