import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-rule-list',
  templateUrl: './rule-list.component.html',
  styleUrls: ['./rule-list.component.css']
})
export class RuleListComponent {
  elements: any[] = [];

  @Output() delete: EventEmitter<any> = new EventEmitter();
  @Output() calculateFromRule: EventEmitter<any> = new EventEmitter();

  addElement(rule: any) {
    this.elements.push(rule);
    console.log(rule);
  }

  removeElement(index: number) {
    if (index >= 0 && index < this.elements.length) {
      this.elements.splice(index, 1);
    }
  }

  calculateFromRuleList(event: any)
    {
      this.calculateFromRule.emit(event);
    }
  clearList() {
    this.elements = [];
  }
}
