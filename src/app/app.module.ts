import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppComponent } from './app.component';
import { GswbVisComponent } from './gswb-vis/gswb-vis.component';
import { SemComponent } from './gswb-vis/sem/sem.component';
import { EditorComponent } from './editor/editor.component';
import { LogComponent } from './gswb-vis/log/log.component';
import { ReactiveFormsModule } from '@angular/forms';
import { EditorContainerComponent } from './editor-container/editor-container.component';
import { HttpClientModule } from '@angular/common/http';
import { LigerVisComponent } from './liger-vis/liger-vis.component';
import { GlueInterfaceComponent } from './glue-interface/glue-interface.component';
import { RuleListComponent } from './liger-vis/rule-list/rule-list.component';
import { RuleListElementComponent } from './liger-vis/rule-list-element/rule-list-element.component';
import { FormsModule } from '@angular/forms';
import { GraphVisComponent } from './liger-vis/graph-vis/graph-vis.component';

@NgModule({
  declarations: [
    AppComponent,
    GswbVisComponent,
    SemComponent,
    EditorComponent,
    LogComponent,
    EditorContainerComponent,
    LigerVisComponent,
    GlueInterfaceComponent,
    RuleListComponent,
    RuleListElementComponent,
    GraphVisComponent
  ],
  imports: [
    BrowserModule,
    ReactiveFormsModule,
    BrowserModule,
    HttpClientModule,
    FormsModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
