export interface LigerBatchParsingAnalysis {
  annotations: { [key: number]: LigerRuleAnnotation };
  ruleApplicationGraph: LigerGraphComponent[];
  report: string;
}


export interface StanzaRuleAnnotation {
  graph: StanzaWebGraph;
}

export interface StanzaWebGraph {
  graphElements: LigerGraphComponent[];
}

export interface StanzaGraphComponent {
  data: { [key: string]: any };
}

//Unify Liger and Stanza models

export interface LigerRule {
  rule: string;
  index: number;
  lineNumber: number;
}

export interface LigerRuleAnnotation {
  graph: LigerWebGraph;
  appliedRules: LigerRule[];
  meaningConstructors?: string;
}

export interface LigerWebGraph {
  graphElements: LigerGraphComponent[];
  semantics: string;
}

export interface LigerGraphComponent {
  data: { [key: string]: any };
}

export interface GswbBatchOutput {

}

export interface GswbRequest {
  premises: string;
  gswbPreferences: GswbPreferences;
}

export interface GswbMultipleRequest {
  premises: { [key: string]: string };
  gswbPreferences: GswbPreferences;
}

export interface GswbPreferences {
  prover: number;
  debugging: boolean;
  outputstyle: number;
  parseSem: boolean;
  noreduce: boolean;
  glueOnly: boolean;
  meaningOnly: boolean;
  explainFail: boolean;
  naturalDeductionStyle: number;
}

