import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {GswbRequest, GswbMultipleRequest, LigerBatchParsingAnalysis, LigerRuleAnnotation, StanzaAnnotation, Ud2semAnnotation} from './models/models';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private gswbpage = 'http://localhost:8081';
  private ligerpage = 'http://localhost:8080';
  private stanzapage = 'http://localhost:8002'
  private ud2sempage = 'http://localhost:8004';
  private multisempage = 'http://localhost:8006';


  constructor(private http: HttpClient) { }

  //gswb models

  gswbDeduce(gswbRequest): Observable<any> {
    return this.http.post<GswbRequest>(`${this.gswbpage}/deduce`, gswbRequest);
  }

  gswbBatchDeduce(gswbBatchRequest): Observable<any> {
    return this.http.post<GswbMultipleRequest>(`${this.gswbpage}/gswb_batch_proof`,gswbBatchRequest);
  }

  //Liger models

  ligerAnnotate(ligerRequest): Observable<any> {
    return this.http.post<LigerRuleAnnotation>(`${this.ligerpage}/apply_rules_xle`, ligerRequest);
  }

  ligerParse(ligerRequest): Observable<any> {
    return this.http.post<LigerRuleAnnotation>(`${this.ligerpage}/parse_xle`, ligerRequest);
  }

  ligerBatchAnnotate(ligerMultipleRequest): Observable<any> {
    return this.http.post<LigerBatchParsingAnalysis>(`${this.ligerpage}/apply_rules_to_batch`, ligerMultipleRequest);
  }

  ligerBatchMultistage(ligerMultipleRequest): Observable<any> {
    return this.http.post<LigerBatchParsingAnalysis>(`${this.ligerpage}/multistage_to_batch`, ligerMultipleRequest);
  }

  //Stanza models

  stanzaParse(stanzaRequest): Observable<any> {
    return this.http.post<StanzaAnnotation>(`${this.stanzapage}/parse`, stanzaRequest);
  }

  ud2Glue(ud2DrsRequest): Observable<any> {
    return this.http.post<Ud2semAnnotation>(`${this.ud2sempage}/ud2drs`, ud2DrsRequest);
  }

  glue2Sem(multiRequest): Observable<any> {
    return this.http.post<Ud2semAnnotation>(`${this.multisempage}/gsw_multistage`, multiRequest);
  }

}
