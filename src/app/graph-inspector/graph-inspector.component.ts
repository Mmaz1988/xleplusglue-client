import { Component, ElementRef, ViewChild } from '@angular/core';
import { DataService } from '../data.service';
import { GraphVisComponent } from '../liger-vis/liger-graph-vis/graph-vis.component';
import { LigerStructureQueryRequest, LigerStructureUploadRequest } from '../models/models';

@Component({
  selector: 'app-graph-inspector',
  templateUrl: './graph-inspector.component.html',
  styleUrls: ['./graph-inspector.component.css']
})
export class GraphInspectorComponent {
  constructor(private dataService: DataService) {}

  uploadedContent = '';
  uploadedFormat: 'json' | 'prolog' = 'json';
  uploadedFileName = 'uploaded-graph';
  queryText = '';
  queryResult = '';
  loading = false;
  queryLoading = false;
  graphElements: any[] = [];

  @ViewChild('cy1') cy1: GraphVisComponent;
  @ViewChild('errorhandle') errorhandle: ElementRef;

  onUploadFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length > 0 ? input.files[0] : null;

    if (!file) {
      return;
    }

    this.uploadedFileName = file.name;
    this.uploadedFormat = file.name.endsWith('.pl') || file.name.endsWith('.prolog') ? 'prolog' : 'json';

    const reader = new FileReader();
    reader.onload = () => {
      this.uploadedContent = String(reader.result ?? '');
      this.displayMessage(`Loaded ${file.name}`, 'green');
      this.renderUploadedGraph();
    };
    reader.onerror = () => {
      this.displayMessage(`Could not read ${file.name}`, 'red');
    };
    reader.readAsText(file);
  }

  renderUploadedGraph() {
    if (!this.uploadedContent.trim()) {
      return;
    }

    this.loading = true;
    const uploadRequest: LigerStructureUploadRequest = {
      content: this.uploadedContent,
      format: this.uploadedFormat,
      id: this.uploadedFileName,
    };

    this.dataService.ligerUploadStructure(uploadRequest).subscribe(
      data => {
        this.loading = false;
        if (data?.graph?.graphElements?.length) {
          this.graphElements = data.graph.graphElements;
          this.cy1.renderGraph(this.graphElements);
          this.displayMessage('Graph loaded.', 'green');
        } else {
          this.displayMessage('No graph elements returned.', 'red');
        }
      },
      error => {
        this.loading = false;
        console.error('Upload failed:', error);
        this.displayMessage('Failed to load graph.', 'red');
      }
    );
  }

  runQuery() {
    if (!this.uploadedContent.trim()) {
      this.displayMessage('Upload a graph first.', 'red');
      return;
    }

    if (!this.queryText.trim()) {
      this.displayMessage('Enter a query first.', 'red');
      return;
    }

    this.queryLoading = true;
    this.displayMessage('Running query...', 'blue');
    const queryRequest: LigerStructureQueryRequest = {
      content: this.uploadedContent,
      format: this.uploadedFormat,
      id: this.uploadedFileName,
      query: this.queryText,
    };

    this.dataService.ligerQueryStructure(queryRequest).subscribe(
      data => {
        this.queryLoading = false;
        this.graphElements = data.graph?.graphElements ?? [];
        if (this.graphElements.length) {
          this.cy1.renderGraph(this.graphElements);
        }

        this.queryResult = data.success === 'true'
          ? `Query matched ${data.matchCount} solution${data.matchCount === 1 ? '' : 's'}.`
          : 'Query did not match.';
        this.displayMessage(this.queryResult, data.success === 'true' ? 'green' : 'red');
      },
      error => {
        this.queryLoading = false;
        console.error('Query failed:', error);
        this.displayMessage('Query failed.', 'red');
      }
    );
  }

  displayMessage(message: string, color: string) {
    this.errorhandle.nativeElement.style.color = color;
    this.errorhandle.nativeElement.innerHTML = '[' + new Date().toLocaleTimeString() + '] ' + message;
  }
}
