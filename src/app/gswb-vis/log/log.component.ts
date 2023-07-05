import {Component, ElementRef, ViewChild} from '@angular/core';

@Component({
  selector: 'app-log',
  templateUrl: './log.component.html',
  styleUrls: ['./log.component.css']
})
export class LogComponent {

  @ViewChild('log') div: ElementRef;
  ngAfterViewInit() {
    // Now you can access the native textarea element like this:
    // this.myTextArea.nativeElement
  }

  setContent(content: string): void {
    this.div.nativeElement.textContent = content;
  }

}
