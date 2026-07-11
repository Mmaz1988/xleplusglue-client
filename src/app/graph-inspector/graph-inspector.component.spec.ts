import { Component, Input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';

import { DataService } from '../data.service';
import { GraphInspectorComponent } from './graph-inspector.component';

@Component({
  selector: 'app-graph-vis',
  template: ''
})
class GraphVisStubComponent {
  @Input() graphID!: string;
  @Input() graphStyle!: string;
}

describe('GraphInspectorComponent', () => {
  let component: GraphInspectorComponent;
  let fixture: ComponentFixture<GraphInspectorComponent>;
  let dataServiceMock: {
    ligerUploadStructure: () => any;
    ligerQueryStructure: jasmine.Spy;
  };

  beforeEach(() => {
    dataServiceMock = {
      ligerUploadStructure: () => of({}),
      ligerQueryStructure: jasmine.createSpy('ligerQueryStructure').and.returnValue(of({ success: 'false' }))
    };

    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [GraphInspectorComponent, GraphVisStubComponent],
      providers: [
        {
          provide: DataService,
          useValue: dataServiceMock
        }
      ]
    });
    fixture = TestBed.createComponent(GraphInspectorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should pass liger graph style to the shared renderer', () => {
    const graphVis = fixture.debugElement.query(By.directive(GraphVisStubComponent)).componentInstance as GraphVisStubComponent;

    expect(component).toBeTruthy();
    expect(graphVis.graphStyle).toBe('liger');
  });

  it('should include embedded query definitions in the query payload', () => {
    component.uploadedContent = '{"constraints":[],"annotation":[]}';
    component.queryText = "GF ::= SUBJ > OBJ > OBL .\nfeature-label() := TENSE | PERF .\n#a SUBJ #b";

    component.runQuery();

    expect(dataServiceMock.ligerQueryStructure).toHaveBeenCalled();
    const request = dataServiceMock.ligerQueryStructure.calls.mostRecent().args[0];
    expect(request.query).toContain('GF ::= SUBJ > OBJ > OBL .');
    expect(request.query).toContain('feature-label() := TENSE | PERF .');
  });
});
