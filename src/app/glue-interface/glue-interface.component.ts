import { Component, ViewChild, AfterViewInit } from '@angular/core';
import { Router } from '@angular/router';
import {LigerVisComponent} from "../liger-vis/liger-vis.component";
import {GswbVisComponent} from "../gswb-vis/gswb-vis.component";
import { DataService } from '../data.service';
import { GswbSolution, LigerStructure } from '../models/models';

@Component({
  selector: 'app-glue-interface',
  templateUrl: './glue-interface.component.html',
  styleUrls: ['./glue-interface.component.css']
})
export class GlueInterfaceComponent {

  @ViewChild('l1') liger: LigerVisComponent;
  @ViewChild('g1') glue: GswbVisComponent;

  isFirstDivMinimized = false;
  isSecondDivMinimized = false;

  constructor(private router: Router, private dataService: DataService) {}

  ngAfterViewInit() {
    if (!this.liger?.changeDetector || !this.glue?.editor1) {
      return;
    }

    this.liger.changeDetector.subscribe(newValue => {
      // Update glue's variable here
      this.glue.editor1.updateContent(newValue);
    });
  }

  openMergedGraphInspector(): void {
    const syntaxGraph = this.cloneGraphElements(this.liger?.graphElements ?? []);
    const semanticStructure = this.currentSemanticStructure();

    if (!syntaxGraph.length || !semanticStructure) {
      return;
    }

    this.dataService.ligerMergeStructure({
      syntaxGraph: {
        graphElements: syntaxGraph,
        semantics: '',
      },
      drs: semanticStructure,
    }).subscribe(response => {
      const structureJson = typeof response?.structureJson === 'string'
        ? response.structureJson
        : JSON.stringify(response?.structureJson ?? {}, null, 2);

      this.router.navigate(['/graph-inspector'], {
        state: {
          uploadedContent: structureJson,
          uploadedFormat: 'json',
          uploadedFileName: 'merged-graph.json',
          graphElements: response.graph?.graphElements ?? [],
        }
      });
    });
  }

  canOpenMergedGraphInspector(): boolean {
    return (this.liger?.graphElements?.length ?? 0) > 0 && !!this.currentSemanticStructure();
  }

  private currentSemanticStructure(): LigerStructure | null {
    const selectedIndex = this.glue?.semvis?.index ?? 0;
    const selected = this.glue?.semvis?.items?.[selectedIndex] as GswbSolution | undefined;

    return selected?.graph ?? null;
  }

  private cloneGraphElements(elements: any[]): any[] {
    return elements.map(element => ({
      ...element,
      data: element?.data ? {...element.data} : element?.data,
    }));
  }


}
