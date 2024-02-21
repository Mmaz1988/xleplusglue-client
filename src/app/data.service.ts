import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment as env } from 'src/environments/environment';
import {GswbRequest, GswbMultipleRequest, LigerBatchParsingAnalysis, LigerRuleAnnotation, StanzaAnnotation, Ud2semAnnotation} from './models/models';

@Injectable({
  providedIn: 'root'
})
export class DataService {

  constructor(private http: HttpClient) { }

  //Stanza models

  stanzaParse(stanzaRequest): Observable<any> {
    return this.http.post<StanzaAnnotation>(`${env.stanzapage}/parse`, stanzaRequest);
  }

  ud2Glue(ud2DrsRequest): Observable<any> {
    return this.http.post<Ud2semAnnotation>(`${env.ud2sempage}/ud2drs`, ud2DrsRequest);
  }

  glue2Sem(multiRequest): Observable<any> {
    return this.http.post<Ud2semAnnotation>(`${env.multisempage}/gsw_multistage`, multiRequest);
  }

}
