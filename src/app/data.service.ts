import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {GswbRequest, GswbMultipleRequest, LigerBatchParsingAnalysis, LigerRuleAnnotation
, GrammarList, GrammarString} from './models/models';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private gswbpage = 'http://localhost:8081';
  private ligerpage = 'http://localhost:8080';
  constructor(private http: HttpClient) { }

  //gswb models

  gswbDeduce(gswbRequest): Observable<any> {
    return this.http.post<GswbRequest>(`${this.gswbpage}/deduce`, gswbRequest);
  }

  gswbBatchDeduce(gswbBatchRequest): Observable<any> {
    return this.http.post<GswbMultipleRequest>(`${this.gswbpage}/gswb_batch_proof`,gswbBatchRequest);
  }

  //Liger models

  //Currently used for parse and rewrite
  ligerAnnotate(ligerRequest): Observable<any> {
    return this.http.post<LigerRuleAnnotation>(`${this.ligerpage}/apply_rules_xle`, ligerRequest);
  }

  //currently used for multistage
  ligerParse(ligerRequest): Observable<any> {
    return this.http.post<LigerRuleAnnotation>(`${this.ligerpage}/parse_xle`, ligerRequest);
  }

  ligerBatchAnnotate(ligerMultipleRequest): Observable<any> {
    return this.http.post<LigerBatchParsingAnalysis>(`${this.ligerpage}/apply_rules_to_batch`, ligerMultipleRequest);
  }

  ligerBatchMultistage(ligerMultipleRequest): Observable<any> {
    return this.http.post<LigerBatchParsingAnalysis>(`${this.ligerpage}/multistage_to_batch`, ligerMultipleRequest);
  }

  //display and change grammars

  getGrammars(): Observable<GrammarList> {
    return this.http.get<GrammarList>(`${this.ligerpage}/list_grammars`);
  }

  changeGrammar(grammarString): Observable<any> {
    return this.http.post<GrammarString>(`${this.ligerpage}/change_grammar`, grammarString);
  }




}
