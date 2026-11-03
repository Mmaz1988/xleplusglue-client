import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FileLoaderComponent } from './file-loader.component';

describe('FileLoaderComponent', () => {
  let component: FileLoaderComponent;
  let fixture: ComponentFixture<FileLoaderComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [FileLoaderComponent]
    });
    fixture = TestBed.createComponent(FileLoaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
