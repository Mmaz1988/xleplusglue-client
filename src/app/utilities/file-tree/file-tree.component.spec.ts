import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MatTreeModule } from '@angular/material/tree';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FileTreeComponent } from './file-tree.component';

describe('FileTreeComponent', () => {
  let component: FileTreeComponent;
  let fixture: ComponentFixture<FileTreeComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MatTreeModule],
      declarations: [FileTreeComponent],
      // Shallow: the child components are not under test here.
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(FileTreeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
