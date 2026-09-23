import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { DataService } from '../data.service';
import { FileTree, LigerConfigTree, LigerRuleSet } from '../models/models';

/** Where the workspace's files come from: the seam between the workspace and LiGER's REST
 *  endpoints. It mirrors the grammar explorer's GrammarSource {listFiles, readFile}, so an
 *  explorer-backed (CodeMirror 6) implementation can replace this one later. Read-only for
 *  now; write/create join it when saving to disk lands (EDITOR_WORKSPACE_PLAN.md). */
@Injectable({ providedIn: 'root' })
export class LigerFileSource {

  constructor(private dataService: DataService) {}

  /** /load_rules: the assembled text of each field. Also makes the rule set's lexica
   *  LiGER's active ones. */
  loadRuleSet(path: string): Observable<LigerRuleSet> {
    return this.dataService.loadRules({ grammar: path });
  }

  listConfig(path: string): Observable<LigerConfigTree> {
    return this.dataService.configTree({ grammar: path });
  }

  read(path: string): Observable<string> {
    return this.dataService.loadFile({ grammar: path }).pipe(map(response => response.grammar));
  }

  listConfigsForGrammar(grammarPath: string): Observable<string[]> {
    return this.dataService.listConfigs({ grammar: grammarPath });
  }

  /** A directory's files and folders, for picking a config or rule file to open. */
  browse(directory: string): Observable<FileTree[]> {
    return this.dataService.getFileTree({ grammar: directory }).pipe(
      map(root => toFileTree(root?.children ?? [])));
  }
}

function toFileTree(nodes: any[]): FileTree[] {
  return nodes.map(node => ({
    name: node.name,
    path: node.path,
    isDirectory: node.isDirectory || node.directory,
    children: toFileTree(node.children ?? []),
  }));
}
