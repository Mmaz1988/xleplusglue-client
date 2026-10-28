import { Component, OnInit } from '@angular/core';
import { DataService } from '../data.service';
import { XLE_SOURCE } from '../models/models';
import { SyntaxSourceService } from '../syntax-source/syntax-source.service';

@Component({
  selector: 'app-navigation',
  templateUrl: './navigation.component.html',
  styleUrls: ['./navigation.component.css']
})

export class NavigationComponent implements OnInit {
  isNavigationVisible: boolean = false;
  /** Why the last switch was refused; cleared by the next one. */
  notice = '';

  constructor(private dataService: DataService, readonly syntaxSource: SyntaxSourceService) {}

  ngOnInit(): void {
    this.refreshUdModels();
  }

  /** Off in a UD session is always possible; on only while Stanza offers a model. */
  get toggleDisabled(): boolean {
    return !this.syntaxSource.isUd && !this.syntaxSource.udAvailable;
  }

  get toggleTitle(): string {
    if (this.syntaxSource.isUd) {
      const source = this.syntaxSource.source;
      return `Parsing with UD (Stanza model ${source.kind === 'ud' ? source.model : ''}); switch off for XLE.`;
    }
    if (this.syntaxSource.udAvailable) {
      return 'Parse with UD (Stanza) instead of XLE. Switching starts a new session.';
    }
    return this.syntaxSource.udError
      ?? 'No Stanza model is installed (run Stanza/setup_stanza.sh and start the stanza service).';
  }

  /** Asks LiGER which Stanza models answer: at start and whenever the navigation opens. */
  refreshUdModels(): void {
    this.dataService.listUdModels().subscribe({
      next: list => this.syntaxSource.setUdModels(list?.models, list?.error ?? null),
      error: error => this.syntaxSource.setUdModels([], `LiGER did not list the UD models: ${error?.message ?? error}`),
    });
  }

  onToggle(input: HTMLInputElement): void {
    const models = this.syntaxSource.udModels;
    const reason = input.checked
      ? (models.length ? this.syntaxSource.select({ kind: 'ud', model: models[0].id }) : 'No Stanza model is installed.')
      : this.syntaxSource.select(XLE_SOURCE);
    this.notice = reason ?? '';
    // Refused: the box shows the parser the session still has.
    input.checked = this.syntaxSource.isUd;
  }

  showNavigation() {
    this.isNavigationVisible = true;
    this.refreshUdModels();
  }

  hideNavigation() {
    this.isNavigationVisible = false;
  }

}
