import { Component } from '@angular/core';

@Component({
  selector: 'editor-container',
  template: '<div><ng-content></ng-content></div>',
  styles: [`
    div {
      width: 800px;
      display: block;
      border-style: solid;
      border-color: #00a9e0;
      margin: 5px;
      overflow: auto;
      max-width: 100%; /* Ensure the div doesn't exceed parent's width */
      max-height: 100%; /* Ensure the div doesn't exceed parent's height */
    }
  `]
})

export class EditorContainerComponent {

}
