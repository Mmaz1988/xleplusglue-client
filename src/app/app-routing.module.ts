import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import {GlueInterfaceComponent} from "./glue-interface/glue-interface.component";
import { ChatInterfaceComponent } from './chat-interface/chat-interface.component';
import {
  RegressionTestingInterfaceComponent
} from "./regression-testing-interface/regression-testing-interface.component";
import {NavigationComponent} from "./navigation/navigation.component";
import {HomeComponent} from "./home/home.component";
import {InferenceInterfaceComponent} from "./inference-interface/inference-interface.component";


const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: 'demo', component: GlueInterfaceComponent },
  { path: 'regression', component: RegressionTestingInterfaceComponent },
  {path: 'inference', component: InferenceInterfaceComponent },
  {path: 'chat', component: ChatInterfaceComponent },
  {path: 'home', component: HomeComponent }
  // Add more routes as needed
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
