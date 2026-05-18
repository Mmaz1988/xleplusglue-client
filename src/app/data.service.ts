import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  GswbRequest,
  GswbMultipleRequest,
  LigerBatchParsingAnalysis,
  LigerRuleAnnotation
  ,
  GrammarList,
  GrammarString,
  FileTree,
  PathString,
  vampireRequest,
  vampireResponse,
  GswbBatchOutput,
  vampireMultipleRequest, vampireMultipleResponse,
  VampireSessionSummary,
  RegressionSessionSummary,
  RegressionSessionDocument
} from './models/models';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private readonly defaultRedisSessionKey = 'last_session';
  private vampirepage = 'http://localhost:8082'
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

  getLastGswbSession(sessionKey: string = this.defaultRedisSessionKey): Observable<GswbBatchOutput> {
    return this.http.get<GswbBatchOutput>(`${this.gswbpage}/gswb_batch_session/${sessionKey}`);
  }

  getLastGswbSessionSummary(sessionKey: string = this.defaultRedisSessionKey): Observable<any> {
    return this.http.get<any>(`${this.gswbpage}/gswb_batch_session/${sessionKey}/summary`);
  }

  resetLastGswbSession(sessionKey: string = this.defaultRedisSessionKey): Observable<any> {
    return this.http.delete(`${this.gswbpage}/gswb_batch_session/${sessionKey}`);
  }

  //Liger models

  //Currently used for parse and rewrite
  ligerAnnotate(ligerRequest): Observable<any> {
    return this.http.post<LigerRuleAnnotation>(`${this.ligerpage}/apply_rules_xle`, ligerRequest);
  }

  //currently used for multistage
  ligerMulti(ligerRequest): Observable<any> {
    return this.http.post<LigerRuleAnnotation>(`${this.ligerpage}/parse_xle`, ligerRequest);
  }

  ligerBatchAnnotate(ligerMultipleRequest): Observable<any> {
    return this.http.post<LigerBatchParsingAnalysis>(`${this.ligerpage}/apply_rules_to_batch`, ligerMultipleRequest);
  }

  ligerBatchMultistage(ligerMultipleRequest): Observable<any> {
    return this.http.post<LigerBatchParsingAnalysis>(`${this.ligerpage}/multistage_to_batch`, ligerMultipleRequest);
  }

  //display and change grammars

  /*
  getGrammars(): Observable<GrammarList> {
    return this.http.get<GrammarList>(`${this.ligerpage}/list_grammars`);
  }
   */

  getFileTree(pathString): Observable<any> {
    return this.http.post<PathString>(`${this.ligerpage}/list_grammars1`, pathString);
  }


  changeGrammar(grammarString): Observable<any> {
    return this.http.post<GrammarString>(`${this.ligerpage}/change_grammar`, grammarString);
  }

  loadRules(ruleString): Observable<any> {
    return this.http.post<GrammarString>(`${this.ligerpage}/load_rules`, ruleString);
  }

  //calls to vampire
callVampire(vampireRequest: vampireRequest){
    return this.http.post<vampireResponse>(`${this.vampirepage}/vampire_request`,vampireRequest);
}

  callBatchVampire(vampireRequest: vampireMultipleRequest): Observable<any> {
    return this.http.post<{ status: string }>(`${this.vampirepage}/vampire_multiple_request`,vampireRequest);
  }

  getLastSession(sessionKey: string = this.defaultRedisSessionKey): Observable<vampireMultipleResponse> {
    return this.http.get<vampireMultipleResponse>(`${this.vampirepage}/last_session/${sessionKey}`);
  }

  getLastSessionSummary(sessionKey: string = this.defaultRedisSessionKey): Observable<VampireSessionSummary> {
    return this.http.get<VampireSessionSummary>(`${this.vampirepage}/last_session/${sessionKey}/summary`);
  }

  resetLastSession(sessionKey: string = this.defaultRedisSessionKey): Observable<any> {
    return this.http.delete(`${this.vampirepage}/last_session/${sessionKey}`);
  }

  requestVampireCancel(sessionKey: string = this.defaultRedisSessionKey): Observable<any> {
    return this.http.post(`${this.vampirepage}/vampire_progress/${sessionKey}/cancel`, {});
  }

  listRegressionSessions(): Observable<RegressionSessionSummary[]> {
    return this.http.get<RegressionSessionSummary[]>(`${this.vampirepage}/regression_sessions`);
  }

  loadRegressionSession(sessionKey: string): Observable<RegressionSessionDocument> {
    return this.http.get<RegressionSessionDocument>(`${this.vampirepage}/regression_session/${sessionKey}`);
  }

  saveRegressionSession(sessionKey: string, payload: RegressionSessionDocument): Observable<any> {
    return this.http.put(`${this.vampirepage}/regression_session/${sessionKey}`, payload);
  }

  deleteRegressionSession(sessionKey: string): Observable<any> {
    return this.http.delete(`${this.vampirepage}/regression_session/${sessionKey}`);
  }




}
