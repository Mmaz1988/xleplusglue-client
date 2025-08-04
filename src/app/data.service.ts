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
  StanzaAnnotation,
  StanzaMultipleAnnotation
} from './models/models';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private vampirepage = 'http://localhost:8082'
  private gswbpage = 'http://localhost:8081';
  private ligerpage = 'http://localhost:8080';
  private stanzapage = 'http://localhost:8083';

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


// Call to Stanza parser

  stanzaParse(stanzaRequest): Observable<any> {
    return this.http.post<StanzaAnnotation>(`${this.stanzapage}/parse_to_liger`, stanzaRequest);
  }

  ligerAnnotateStanza(ligerRequest): Observable<any> {
    return this.http.post<LigerRuleAnnotation>(`${this.ligerpage}/apply_rules_base`, ligerRequest);
  }


  ///apply_rules_to_dependency_batch

  ligerBatchAnnotateDependencies(ligerMultipleRequest): Observable<any> {
    return this.http.post<LigerBatchParsingAnalysis>(`${this.ligerpage}/apply_rules_to_dependency_batch`, ligerMultipleRequest);
  }

  stanzaBatchParse(stanzaMultipleRequest): Observable<any> {
    return this.http.post<StanzaMultipleAnnotation>(`${this.stanzapage}/batch_parse_to_liger`, stanzaMultipleRequest);
  }

}
