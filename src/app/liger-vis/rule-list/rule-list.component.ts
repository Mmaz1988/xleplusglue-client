import { Component } from '@angular/core';
import { RuleListElementComponent } from '../rule-list-element/rule-list-element.component';


@Component({
  selector: 'app-rule-list',
  templateUrl: './rule-list.component.html',
  styleUrls: ['./rule-list.component.css']
})
export class RuleListComponent {
  elements: any[] = [];

  addElement(rule: string) {
    this.elements.push({ rule: rule });
  }

  removeElement(index: number) {
    if (index >= 0 && index < this.elements.length) {
      this.elements.splice(index, 1);
    }
  }
}
