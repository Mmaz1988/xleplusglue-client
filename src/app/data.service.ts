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

  //gswb models

  gswbDeduce(gswbRequest): Observable<any> {
    return this.http.post<GswbRequest>(`${env.gswbpage}/deduce`, gswbRequest);
  }

  gswbBatchDeduce(gswbBatchRequest): Observable<any> {
    return this.http.post<GswbMultipleRequest>(`${env.gswbpage}/gswb_batch_proof`,gswbBatchRequest);
  }

  //Liger models

  ligerAnnotate(ligerRequest): Observable<any> {
    return this.http.post<LigerRuleAnnotation>(`${env}/apply_rules_xle`, ligerRequest);
  }

  ligerParse(ligerRequest): Observable<any> {
    return this.http.post<LigerRuleAnnotation>(`${env.ligerpage}/parse_xle`, ligerRequest);
  }

  ligerBatchAnnotate(ligerMultipleRequest): Observable<any> {
    return this.http.post<LigerBatchParsingAnalysis>(`${env.ligerpage}/apply_rules_to_batch`, ligerMultipleRequest);
  }

  ligerBatchMultistage(ligerMultipleRequest): Observable<any> {
    return this.http.post<LigerBatchParsingAnalysis>(`${env.ligerpage}/multistage_to_batch`, ligerMultipleRequest);
  }

  //Stanza models

  stanzaParse(stanzaRequest): Observable<any> {
    return this.http.post<StanzaAnnotation>(`${env.stanzapage}/parse`, stanzaRequest);
  }

  ud2Glue(ud2DrsRequest): Observable<any> {
    return this.http.post<Ud2semAnnotation>(`${env.ud2sempage}/ud2drs`, ud2DrsRequest);
  }

  glue2Sem(multiRequest): Observable<any> {
    return this.http.post<Ud2semAnnotation>(`${env}/gsw_multistage`, multiRequest);
  }

}
