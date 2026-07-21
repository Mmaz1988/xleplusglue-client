import { Component, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import {LigerVisComponent} from "../liger-vis/liger-vis.component";
import {GswbVisComponent} from "../gswb-vis/gswb-vis.component";
import { DataService } from '../data.service';
import { GswbSolution, LigerStructure } from '../models/models';
import { AnalysisWorkspaceStateService } from '../analysis-workspace-state.service';

@Component({
  selector: 'app-glue-interface',
  templateUrl: './glue-interface.component.html',
  styleUrls: ['./glue-interface.component.css']
})
export class GlueInterfaceComponent implements AfterViewInit, OnDestroy {

  @ViewChild('l1') liger: LigerVisComponent;
  @ViewChild('g1') glue: GswbVisComponent;

  isFirstDivMinimized = false;
  isSecondDivMinimized = false;

  constructor(private router: Router, private dataService: DataService, private workspaceState: AnalysisWorkspaceStateService) {}

  ngAfterViewInit() {
    if (this.liger?.changeDetector && this.glue?.editor1) {
      this.liger.changeDetector.subscribe(newValue => {
        // Update glue's variable here
        this.glue.editor1.updateContent(newValue);
      });
    }

    setTimeout(() => this.restoreWorkspaceState(), 0);
  }

  ngOnDestroy(): void {
    this.saveWorkspaceState();
  }

  openMergedGraphInspector(): void {
    const syntax = this.liger?.structureJson ?? null;
    const semanticStructure = this.currentSemanticStructure();

    if (!syntax || !semanticStructure) {
      return;
    }

    this.dataService.ligerMergeStructure({
      syntax,
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
    const betaReduce = this.glue?.gswbPreferences?.gswbPreferences?.betaReduce;
    return betaReduce === true && !!this.liger?.structureJson && !!this.currentSemanticStructure();
  }

  private currentSemanticStructure(): LigerStructure | null {
    const selectedIndex = this.glue?.semvis?.index ?? 0;
    const selected = this.glue?.semvis?.items?.[selectedIndex] as GswbSolution | undefined;

    return selected?.graph ?? null;
  }

  private saveWorkspaceState(): void {
    const ligerState = typeof this.liger?.captureState === 'function'
      ? this.liger.captureState()
      : null;
    const gswbState = typeof this.glue?.captureState === 'function'
      ? this.glue.captureState()
      : null;

    if (ligerState) {
      this.workspaceState.saveLiger(ligerState);
    }

    if (gswbState) {
      this.workspaceState.saveGswb(gswbState);
    }
  }

  private restoreWorkspaceState(): void {
    const state = this.workspaceState.getState();

    if (state.liger) {
      this.liger?.restoreState(state.liger);
    }

    if (state.gswb) {
      this.glue?.restoreState(state.gswb);
    }
  }

}
