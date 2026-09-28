import { GswbPreferences } from './models/models';

/** GSWB's outputstyle flag value that selects LFGxDRT semantic rendering (vs. prolog-drt). */
export const LFGXDRT_OUTPUT_STYLE = 5;

export function isLfgxdrtPreferences(prefs: GswbPreferences): boolean {
  return Number(prefs?.outputstyle) === LFGXDRT_OUTPUT_STYLE;
}

export const APP_DEFAULTS = {
  grammar: {
    ligerPath: './grammars/dev/lfgxdrt_inference_grammar/main_lfgxdrt_inference_grammar.lfg.glue',
    // A LiGER config: semantics rules, post-processing (pragmatics) rules and lexica.
    ligerRulesPath: './grammars/dev/lfgxdrt_inference_grammar/liger/lfgxdrt.liger.yaml',
  },
  liger: {
    sentence: 'The PC-6082 is faster than the ITEL-XZ.',
  },
  graphInspector: {
    queryText: "// hierarchies here\n" +
      "GF ::= SUBJ > OBJ > OBL .\n" +
      "\n" +
      "GF := SUBJ | OBJ | OBL .\n" +
      "\n" +
      "// templates here\n" +
      "\n" +
      "DR-GF-LINK(#a, #d) := #a SRC %a & #b SYN-ID %b & %a == %b & #b ^(in_set>GLUE>g::>cproj) #c phi #d .\n" +
      "\n" +
      "MCN-PATH(#a,#b) := #a ^(@GF*:~(->SUBJ)) #b.\n" +
      "\n" +
      "REFL-BIND(#f,#h) := @MCN-PATH(#f,#i) & #i ^(@GF) #j !(@GF) #h & superior(GF,#h,#i) .\n" +
      "\n" +
      "#a ant #a & @DR-GF-LINK(#a,#b) & @REFL-BIND(#b,#c)",
  },
  gswb: {
    preferences: {
      prover: 1,
      debugging: false,
      outputstyle: 5,
      parseSem: false,
      betaReduce: true,
      resolveDrs: true,
      glueOnly: false,
      meaningOnly: false,
      explainFail: false,
      naturalDeductionStyle: 0,
    } as GswbPreferences,
  },
  inference: {
    axioms: '',
  },
  vampire: {
    chat: {
      logic_type: 1,
      model_building: false,
      max_duration: 10,
      layered: false,
      anaphora_selection: 'all' as const,
      anaphora_top_k: 1,
    },
    regression: {
      logic_type: 0,
      model_building: true,
      max_duration: 10,
      layered: false,
      anaphora_selection: 'all' as const,
      anaphora_top_k: 1,
    },
  },
};
