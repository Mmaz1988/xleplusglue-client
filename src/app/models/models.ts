import { SafeHtml } from '@angular/platform-browser';

export interface LigerBatchParsingAnalysis {
  annotations: { [key: number]: LigerRuleAnnotation };
  ruleApplicationGraph: LigerGraphComponent[];
  report: string;
}


//Unify Liger and Stanza models

export interface LigerRule {
  rule: string;
  index: number;
  lineNumber: number;
}

export interface LigerRuleAnnotation {
  sentence?: string;
  graph: LigerWebGraph;
  appliedRules: LigerRule[];
  meaningConstructors?: string;
  numberOfMCsets?: number;
  axioms?: string[];
}

export interface LigerWebGraph {
  graphElements: LigerGraphComponent[];
  semantics: string;
}

export interface LigerGraphComponent {
  data: { [key: string]: any };
}

export interface GswbBatchOutput {
outputs: { [key: string]: GswbOutput };
report: string;
}

export interface GswbRequest {
  premises: string;
  gswbPreferences: GswbPreferences;
}

export interface GswbMultipleRequest {
  premises: { [key: string]: string };
  gswbPreferences: GswbPreferences;
}

export interface GswbDiscriminant {
  id: string;
  type: string;
  identifier: string;
  associatedSolutions: string[];
  instantiations?: string[];
}

export interface GswbSolution {
solution: string;
id: string;
}

export interface GswbOutput {
  solutions: GswbSolution[];
  log: string;
  derivation: any;
  discriminants: GswbDiscriminant[];
}

export interface RegressionParseResult {
  sentence_id: string;
  sentence: string;
  noOfAppliedRules: number;
  noOfMCsets: number;
  noOfSolutions: number;
  ligerGraph: LigerWebGraph;
  ligerMCsets: string;
  allMCs: any;
  gswbSolutions: GswbSolution[];
  gswbDerivation: any;
  result_type: 'parseResult';
  discriminants?: GswbDiscriminant[];
}

export interface RegressionInferenceResult {
  id: string;
  premises: string[];
  conclusion: string;
  predictedLabel: string;
  goldLabel: string;
  premiseIds: string[];
  conclusionIds: string[];
  mismatch: boolean;
  glyphs: string[];
}

export interface RegressionRunTiming {
  startedAt: string | null;
  parseMs: number | null;
  vampireMs: number | null;
  totalMs: number | null;
}

export interface RegressionTestingSession {
  id: string;
  createdAt: string;
  sentenceMap: Record<string, string>;
  regressionTestItems: any[];
  regressionTestResults: RegressionParseResult[];
  inferenceResults: RegressionInferenceResult[];
  selectedSolutionIdsBySentence: Record<string, string[]>;
  selectedScopeIdsBySentence: Record<string, string[]>;
  selectedMcIdsBySentence: Record<string, string[]>;
  lastGswbOutputs: Record<string, GswbOutput> | null;
  lastAnnotations: Record<string, LigerRuleAnnotation> | null;
  lastLogicType: 'fof' | 'tff';
  lastVampireScopeIdsBySentence: Record<string, string[]>;
  lastVampireMcIdsBySentence: Record<string, string[]>;
  sortedMCmap: Record<string, any>;
  hasRunVampire: boolean;
  disambiguationMode: boolean;
  timing: RegressionRunTiming;
}

export function createRegressionTestingSession(): RegressionTestingSession {
  return {
    id: `session-${Date.now()}`,
    createdAt: new Date().toISOString(),
    sentenceMap: {},
    regressionTestItems: [],
    regressionTestResults: [],
    inferenceResults: [],
    selectedSolutionIdsBySentence: {},
    selectedScopeIdsBySentence: {},
    selectedMcIdsBySentence: {},
    lastGswbOutputs: null,
    lastAnnotations: null,
    lastLogicType: 'fof',
    lastVampireScopeIdsBySentence: {},
    lastVampireMcIdsBySentence: {},
    sortedMCmap: {},
    hasRunVampire: false,
    disambiguationMode: false,
    timing: {
      startedAt: null,
      parseMs: null,
      vampireMs: null,
      totalMs: null,
    },
  };
}


export interface GswbPreferences {
  prover: number;
  debugging: boolean;
  outputstyle: number;
  parseSem: boolean;
  betaReduce: boolean;
  resolveDrs: boolean;
  glueOnly: boolean;
  meaningOnly: boolean;
  explainFail: boolean;
  naturalDeductionStyle: number;
}

export interface VampirePreferences {
  logic_type: number;
  model_building: boolean;
  max_duration: number;
  layered: boolean; //Processes with and without additional axioms
}


export interface GrammarList {
  grammarList: string[];
}

export interface FileTree {
  name: string;        // The name of the file or directory
  path: string;        // The full path of the file or directory
  isDirectory: boolean; // Whether the node is a directory (true) or a file (false)
  children: FileTree[]; // A list of children nodes (only populated if it's a directory)
}

export interface GrammarString {
  grammar: string;
  isDir: boolean;
}

export interface PathString {
  grammar: string;
  isDir: boolean;
}

export interface vampireRequest {
  text : string;
  context: context[];
  axioms: string;
  hypothesis: string;
  pruning: boolean;
  active_indices: number[];
  vampire_preferences?: VampirePreferences;
}

/*

class VampireMultipleRequest(BaseModel):
nli_items: dict  # A dictionary mapping ids to VampireNLI objects
axioms: str
pruning: bool
vampire_preferences: dict
*/
export interface vampireMultipleRequest {
  nli_items: { [key: string]: nliItem };
  pruning: boolean;
  vampire_preferences?: VampirePreferences;
}

/*class VampireNLI(BaseModel):
premises: List[str]
hypothesis: str*/

export interface nliItem {
  premises: string[];
  hypothesis: string[];
  axioms: string;
}

export interface vampireResponse {
  context: context[];
  active_indices: number[];
  context_checks_mapping: {[key: number]: check };
}

export interface vampireMultipleResponse {
  results: { [key: string]: check[] };
}

export interface check {
  glyph: string;
  informative: boolean;
  consistent: boolean;
  relevant: boolean;
}

export interface context {
  original: string;
  prolog_drs: string;
  prolog_fol: string;
  tptp: string;
  box: string;
}


 export interface ChatMessage {
  text: string;
  sender: 'User' | 'Bot';
  //optional glyph
  glyph?: string;
   showGlyph?: false
   detailText?: string;        // for chat analysis
   showDetail?: boolean;

   glyphs?: string[];        // raw svg strings (optional to keep)
   safeGlyphs?: SafeHtml[];
   glyphGridSize?: number;

 }
