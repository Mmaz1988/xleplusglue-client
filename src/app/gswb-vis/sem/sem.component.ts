import {Component, ViewChild, ElementRef} from '@angular/core';

@Component({
  selector: 'app-sem',
  templateUrl: './sem.component.html',
  styleUrls: ['./sem.component.css']
})
export class SemComponent {

  @ViewChild('sem') div: ElementRef;
  ngAfterViewInit() {
    // Now you can access the native textarea element like this:
    // this.myTextArea.nativeElement
  }

  setContent(content: string): void {
    this.div.nativeElement.textContent = content;
  }
}
