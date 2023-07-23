import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {LigerBatchParsingAnalysis, LigerRuleAnnotation} from './models/models';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private gswbpage = 'http://localhost:8081';
  private ligerpage = 'http://localhost:8080';

  constructor(private http: HttpClient) { }

  gswbDeduce(gswbRequest): Observable<any> {
    return this.http.post<any>(`${this.gswbpage}/deduce`, gswbRequest);
  }

  ligerAnnotate(ligerRequest): Observable<any> {
    return this.http.post<LigerRuleAnnotation>(`${this.ligerpage}/apply_rules_xle`, ligerRequest);
  }

  ligerParse(ligerRequest): Observable<any> {
    return this.http.post<LigerRuleAnnotation>(`${this.ligerpage}/parse_xle`, ligerRequest);
  }

  ligerBatchAnnotate(ligerMultipleRequest): Observable<any> {
    return this.http.post<LigerBatchParsingAnalysis>(`${this.ligerpage}/apply_rules_to_batch`, ligerMultipleRequest);
  }
}
