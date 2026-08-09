import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  GswbRequest,
  GswbMultipleRequest,
  LigerBatchParsingAnalysis,
  LigerRuleAnnotation
    ,
  LigerMergeResponse,
  LigerStructure,
  LigerStructureMergeRequest,
  LigerStructureUploadRequest,
  LigerStructureRuleRequest,
  LigerStructureQueryRequest,
  LigerStructureQueryResponse,
  LigerRuleAnnotationResponse,
  GrammarList,
  GrammarString,
  FileTree,
  PathString,
  vampireRequest,
  vampireResponse,
  GswbBatchOutput,
  GswbPcdrsOutput,
  GswbPcdrsRequest,
  GswbCollapseAnaphoraRequest,
  GswbCollapseAndTptpBatchRequest,
  GswbCollapseAndTptpBatchOutput,
  GswbSequenceMergeRequest,
  GswbSolution,
  GswbReasoningChecksRequest,
  GswbReasoningChecksOutput,
  GswbReasoningCheckAstsOutput,
  GswbReasoningCheckAstsRequest,
  LigerSolutionAnnotationResponse,
  LigerSequenceRequest,
  vampireMultipleRequest, vampireMultipleResponse,
  VampireSessionSummary,
  RegressionSessionSummary,
  RegressionSessionDocument,
  XlePlusGlueDocument
} from './models/models';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private readonly defaultRedisSessionKey = 'last_session';
  private vampirepage = 'http://localhost:8082'
  private redispage = 'http://localhost:8083';
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

  gswbGeneratePcdrs(request: GswbPcdrsRequest): Observable<GswbPcdrsOutput> {
    return this.http.post<GswbPcdrsOutput>(`${this.gswbpage}/generate_pcdrs`, request);
  }

  gswbCollapseAnaphora(request: GswbCollapseAnaphoraRequest): Observable<GswbSolution> {
    return this.http.post<GswbSolution>(`${this.gswbpage}/collapse_anaphora`, request);
  }

  gswbMergeSequenceSemantics(request: GswbSequenceMergeRequest): Observable<GswbSolution> {
    return this.http.post<GswbSolution>(`${this.gswbpage}/merge_sequence_semantics`, request);
  }

  gswbCollapseAndTptpBatch(request: GswbCollapseAndTptpBatchRequest): Observable<GswbCollapseAndTptpBatchOutput> {
    return this.http.post<GswbCollapseAndTptpBatchOutput>(`${this.gswbpage}/collapse_and_tptp_batch`, request);
  }

  gswbReasoningChecks(request: GswbReasoningChecksRequest): Observable<GswbReasoningChecksOutput> {
    return this.http.post<GswbReasoningChecksOutput>(`${this.gswbpage}/reasoning_checks`, request);
  }

  gswbReasoningCheckAsts(request: GswbReasoningCheckAstsRequest): Observable<GswbReasoningCheckAstsOutput> {
    return this.http.post<GswbReasoningCheckAstsOutput>(`${this.gswbpage}/reasoning_check_asts`, request);
  }

  gswbSemanticToTptp(request: { semantic: string; typed: boolean }): Observable<{ tptp: string }> {
    return this.http.post<{ tptp: string }>(`${this.gswbpage}/semantic_to_tptp`, request);
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
  ligerAnnotate(ligerRequest): Observable<LigerSolutionAnnotationResponse> {
    return this.http.post<LigerSolutionAnnotationResponse>(`${this.ligerpage}/apply_rules_xle`, ligerRequest);
  }

  //currently used for multistage
  ligerMulti(ligerRequest): Observable<LigerSolutionAnnotationResponse> {
    return this.http.post<LigerSolutionAnnotationResponse>(`${this.ligerpage}/parse_xle`, ligerRequest);
  }

  ligerSequence(request: LigerSequenceRequest): Observable<LigerSolutionAnnotationResponse> {
    return this.http.post<LigerSolutionAnnotationResponse>(`${this.ligerpage}/apply_rules_xle_sequence`, request);
  }

  ligerUploadStructure(uploadRequest: LigerStructureUploadRequest): Observable<LigerRuleAnnotation> {
    return this.http.post<LigerRuleAnnotation>(`${this.ligerpage}/parse_uploaded_structure`, uploadRequest);
  }

  ligerRenderStructure(uploadRequest: LigerStructureUploadRequest): Observable<LigerRuleAnnotation> {
    return this.http.post<LigerRuleAnnotation>(`${this.ligerpage}/render_graph`, uploadRequest);
  }

  ligerApplyRulesToStructure(ruleRequest: LigerStructureRuleRequest): Observable<LigerRuleAnnotationResponse> {
    return this.http.post<LigerRuleAnnotationResponse>(`${this.ligerpage}/apply_rules_uploaded_structure`, ruleRequest);
  }

  ligerQueryStructure(queryRequest: LigerStructureQueryRequest): Observable<LigerStructureQueryResponse> {
    return this.http.post<LigerStructureQueryResponse>(`${this.ligerpage}/query_uploaded_structure`, queryRequest);
  }

  ligerMergeStructure(mergeRequest: LigerStructureMergeRequest): Observable<LigerMergeResponse> {
    return this.http.post<LigerMergeResponse>(`${this.ligerpage}/merge_uploaded_structures`, mergeRequest);
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

  saveAnalysisDocument(sessionKey: string, document: XlePlusGlueDocument): Observable<{ status: string; document: XlePlusGlueDocument }> {
    return this.http.put<{ status: string; document: XlePlusGlueDocument }>(
      `${this.redispage}/analysis_document/${sessionKey}`, document);
  }

  clearAnalysisDocument(sessionKey: string): Observable<any> {
    return this.http.delete(`${this.redispage}/analysis_document/${sessionKey}`);
  }

  saveChatDocument(sessionKey: string, document: XlePlusGlueDocument): Observable<{ status: string; document: XlePlusGlueDocument }> {
    return this.http.put<{ status: string; document: XlePlusGlueDocument }>(
      `${this.redispage}/chat_document/${sessionKey}`, document);
  }

  clearChatDocument(sessionKey: string): Observable<any> {
    return this.http.delete(`${this.redispage}/chat_document/${sessionKey}`);
  }




}
