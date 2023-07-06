import { Component, Input, Output, EventEmitter } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-rule-list-element',
  templateUrl: './rule-list-element.component.html',
  styleUrls: ['./rule-list-element.component.css']
})
export class RuleListElementComponent {
  @Input() data: any;
  @Output() delete: EventEmitter<any> = new EventEmitter();
  @Output() calculateFromRule: EventEmitter<any> = new EventEmitter();

  onDelete() {
    this.delete.emit(this.data);
  }

  calculate() {
    this.calculateFromRule.emit(this.data);
  }

}

