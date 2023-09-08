import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface TogglePayload {
  action: ToggleAction;
  type?: string; // The type of component to hide/show
}

export enum ToggleAction {
  Hide,
  Show
}

@Injectable({
  providedIn: 'root'
})

export class HideComponentsService {


  private toggleSubject = new Subject<TogglePayload>();
  toggleObservable = this.toggleSubject.asObservable();

  hideAllComponents(type?: string) {
    this.toggleSubject.next({ action: ToggleAction.Hide, type: type });
  }

  showAllComponents(type?: string) {
    this.toggleSubject.next({ action: ToggleAction.Show, type: type });
  }
}
