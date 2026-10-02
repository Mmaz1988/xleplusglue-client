import { Component, OnInit, ViewChild } from '@angular/core';
import { DataService } from '../../data.service';
import { EditorComponent } from '../../editor/editor.component';
import { GraphVisComponent } from '../../liger-vis/liger-graph-vis/graph-vis.component';
import { LigerQuerySolution } from '../../models/models';
import { applyQueryHighlights, solutionNodeIds } from '../../graph-inspector/query-highlights';
import { DEMO_QUERIES, DEMO_SENTENCE, DEMO_STRUCTURE, DemoQuery } from './demo-structure';

/** The home page's taste of the post-processing view: a fixed f-structure, a query box, and
 *  the matches highlighted on the graph. Queries run on the live LiGER service, the same
 *  endpoint the graph inspector uses. */
@Component({
  selector: 'app-query-demo',
  templateUrl: './query-demo.component.html',
  styleUrls: ['./query-demo.component.css']
})
export class QueryDemoComponent implements OnInit {
  readonly sentence = DEMO_SENTENCE;
  readonly examples = DEMO_QUERIES;
  private readonly content = JSON.stringify(DEMO_STRUCTURE);

  queryText = DEMO_QUERIES[0].query;
  solutions: LigerQuerySolution[] = [];
  activeSolutionIndex: number | null = null;
  status = 'Loading the example graph from LiGER ...';
  statusKind: 'info' | 'ok' | 'error' = 'info';
  loading = true;
  /** The graph as LiGER rendered it; highlights are applied to copies of it. */
  private baseElements: any[] = [];

  // Static: the graph is always in the template, so it is there for ngOnInit's request.
  @ViewChild('graph', { static: true }) graph: GraphVisComponent;
  @ViewChild('queryEditor') queryEditor: EditorComponent;

  constructor(private dataService: DataService) {}

  /** Requested before the first check, so the status it sets never changes a checked binding. */
  ngOnInit(): void {
    this.dataService.ligerRenderStructure({ content: this.content, format: 'json', id: DEMO_STRUCTURE.id }).subscribe(
      data => {
        this.loading = false;
        this.baseElements = data?.graph?.graphElements ?? [];
        if (!this.baseElements.length) {
          this.setStatus('LiGER returned no graph for the example.', 'error');
          return;
        }
        this.graph.renderGraph(this.baseElements);
        this.setStatus('Pick an example or write a query, then run it.', 'info');
      },
      error => {
        this.loading = false;
        console.error('[QueryDemo] render failed:', error);
        this.setStatus('LiGER is not reachable (port 8080). Start the backend services to try the demo.', 'error');
      }
    );
  }

  useExample(example: DemoQuery): void {
    this.queryText = example.query;
    this.queryEditor?.updateContent(example.query);
    this.runQuery();
  }

  runQuery(): void {
    if (!this.queryText.trim()) {
      this.setStatus('Enter a query first.', 'error');
      return;
    }

    this.loading = true;
    this.setStatus('Running query ...', 'info');
    this.dataService.ligerQueryStructure({ content: this.content, format: 'json', id: DEMO_STRUCTURE.id, query: this.queryText }).subscribe(
      data => {
        this.loading = false;
        this.solutions = data.solutions ?? [];
        this.activeSolutionIndex = null;
        // Drop LiGER's own match marks: showHighlights decides which solutions are shown.
        this.baseElements = applyQueryHighlights(data.graph?.graphElements ?? [], new Set<string>());
        this.showHighlights();
        this.setStatus(
          data.success === 'true'
            ? `${data.matchCount} solution${data.matchCount === 1 ? '' : 's'}. Select one to highlight only its nodes.`
            : 'No match.',
          data.success === 'true' ? 'ok' : 'error');
      },
      error => {
        this.loading = false;
        this.solutions = [];
        console.error('[QueryDemo] query failed:', error);
        const message = error?.error?.message || error?.message || 'Query failed.';
        this.setStatus(message, 'error');
      }
    );
  }

  selectSolution(index: number): void {
    this.activeSolutionIndex = this.activeSolutionIndex === index ? null : index;
    this.showHighlights();
  }

  bindingText(solution: LigerQuerySolution): string[] {
    return Object.entries(solution.bindings)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([variable, nodes]) => `#${variable} = ${Object.keys(nodes).join(', ')}`);
  }

  /** All solutions' nodes, or only the selected solution's. */
  private showHighlights(): void {
    const ids = new Set<string>();
    const shown = this.activeSolutionIndex === null
      ? this.solutions
      : [this.solutions[this.activeSolutionIndex]].filter(Boolean);
    shown.forEach(solution => solutionNodeIds(solution).forEach(id => ids.add(id)));
    this.graph.updateGraph(applyQueryHighlights(this.baseElements, ids));
  }

  private setStatus(message: string, kind: 'info' | 'ok' | 'error'): void {
    this.status = message;
    this.statusKind = kind;
  }
}
