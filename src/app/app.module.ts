import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppComponent } from './app.component';
import { GswbVisComponent } from './gswb-vis/gswb-vis.component';
import { SemComponent } from './gswb-vis/sem/sem.component';
import { EditorComponent } from './editor/editor.component';
import { LogComponent } from './gswb-vis/log/log.component';
import { ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { LigerVisComponent } from './liger-vis/liger-vis.component';
import { GlueInterfaceComponent } from './glue-interface/glue-interface.component';
import { RuleListComponent } from './liger-vis/rule-list/rule-list.component';
import { RuleListElementComponent } from './liger-vis/rule-list-element/rule-list-element.component';
import { FormsModule } from '@angular/forms';
import { GraphVisComponent } from './liger-vis/liger-graph-vis/graph-vis.component';
import {CommonModule} from "@angular/common";
import { GswbGraphVisComponent } from './gswb-vis/gswb-graph-vis/gswb-graph-vis.component';
import { DerivationContainerComponent } from './gswb-vis/derivation-container/derivation-container.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { DialogComponent } from './dialog/dialog.component';
import { SubGraphDialogComponent } from './sub-graph-dialog/sub-graph-dialog.component';
import { SubGraphComponent } from './sub-graph/sub-graph.component';
import { NavigationComponent } from './navigation/navigation.component';
import { RegressionTestingInterfaceComponent } from './regression-testing-interface/regression-testing-interface.component';
import {AppRoutingModule} from "./app-routing.module";
import { AppliedRulesGraphComponent } from './regression-testing-interface/applied-rules-graph/applied-rules-graph.component';
import { HomeComponent } from './home/home.component';
import { ToggleDisplayComponent } from './toggle-display/toggle-display.component';
import { GswbSettingsComponent } from './gswb-vis/gswb-settings/gswb-settings.component';
import { GrammarLoaderComponent } from './liger-vis/grammar-loader/grammar-loader.component';
import { FileTreeComponent } from './file-tree/file-tree.component';

import { MatTreeModule } from '@angular/material/tree';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { ChatInterfaceComponent } from './chat-interface/chat-interface.component';
import { ChatTabsComponent } from './chat-interface/chat-tabs/chat-tabs.component';
import {MatTabsModule} from "@angular/material/tabs";
import { ChatComponent } from './chat-interface/chat/chat.component';
import { RuleLoaderComponent } from './chat-interface/rule-loader/rule-loader.component';
import { HistoryComponent } from './chat-interface/history/history.component';
import { TestResultComponent } from './regression-testing-interface/test-result/test-result.component';
import { InferenceInterfaceComponent } from './inference-interface/inference-interface.component';
import { InferenceSettingsComponent } from './inference-interface/inference-settings/inference-settings.component';

@NgModule({
  declarations: [
    AppComponent,
    GswbVisComponent,
    SemComponent,
    EditorComponent,
    LogComponent,
    LigerVisComponent,
    GlueInterfaceComponent,
    RuleListComponent,
    RuleListElementComponent,
    GraphVisComponent,
    GswbGraphVisComponent,
    DerivationContainerComponent,
    DialogComponent,
    SubGraphDialogComponent,
    SubGraphComponent,
    NavigationComponent,
    RegressionTestingInterfaceComponent,
    AppliedRulesGraphComponent,
    HomeComponent,
    ToggleDisplayComponent,
    GswbSettingsComponent,
    GrammarLoaderComponent,
    FileTreeComponent,
    ChatInterfaceComponent,
    ChatTabsComponent,
    ChatComponent,
    RuleLoaderComponent,
    HistoryComponent,
    TestResultComponent,
    InferenceInterfaceComponent,
    InferenceSettingsComponent
  ],
  imports: [
    BrowserModule,
    ReactiveFormsModule,
    HttpClientModule,
    FormsModule,
    CommonModule,
    AppRoutingModule,
    MatTreeModule,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    BrowserAnimationsModule],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
