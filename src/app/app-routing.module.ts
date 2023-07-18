import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import {GlueInterfaceComponent} from "./glue-interface/glue-interface.component";
import {
  RegressionTestingInterfaceComponent
} from "./regression-testing-interface/regression-testing-interface.component";


const routes: Routes = [
  { path: 'demo', component: GlueInterfaceComponent },
  { path: 'regression', component: RegressionTestingInterfaceComponent },
  // Add more routes as needed
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
