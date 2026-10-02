import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { HomeComponent } from './home.component';

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      declarations: [HomeComponent],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('links every interface in the navigation, grouped by use, and not the deactivated inference view', () => {
    const rows = Array.from(fixture.nativeElement.querySelectorAll('.cards') as NodeListOf<HTMLElement>)
      .map(row => Array.from(row.querySelectorAll('a.card')).map(link => link.getAttribute('href')));
    expect(rows).toEqual([
      ['/demo', '/liger', '/glue', '/graph-inspector'],
      ['/regression', '/regression-dashboard'],
      ['/chat'],
    ]);
  });
});
