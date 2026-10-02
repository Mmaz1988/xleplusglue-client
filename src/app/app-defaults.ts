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
    /** What the standalone GSWB view opens with: two quantifiers, so two scope readings. */
    demoPremises: "{\n" +
      "//Every man saw a woman.\n" +
      "[1] (\\P.(\\Q.([],[([x],[])+P@x->Q@x]))) : ((f2_e -o f2_t) -o ((f2_e -o f1_t) -o f1_t))\n" +
      "[2] (\\x.([],[man(x)])) : (f2_e -o f2_t)\n" +
      "[3] (\\P.(\\Q.([x],[])+P@x+Q@x)) : ((f3_e -o f3_t) -o ((f3_e -o f1_t) -o f1_t))\n" +
      "[4] (\\x.([],[woman(x)])) : (f3_e -o f3_t)\n" +
      "[5] (\\V.(\\x.(\\e.(V@e+([],[arg1(e,x)]))))) : ((g4_v -o g4_t) -o (f2_e -o (g4_v -o g4_t))) || noscope\n" +
      "[6] (\\V.(\\x.(\\e.(V@e+([],[arg2(e,x)]))))) : ((g4_v -o g4_t) -o (f3_e -o (g4_v -o g4_t))) || noscope\n" +
      "[7] (\\V.([e],[])+V@e) : ((g4_v -o g4_t) -o f1_t)\n" +
      "[8] (\\v.([],[see(v)])) : (g4_v -o g4_t)\n" +
      "}\n",
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
  /** Anaphora ranking (lm /rank_anaphora): rankers in priority order and the averager fusing
   *  them. One ranker behaves as before fusion existed. */
  anaphoraRanking: {
    rankers: ['mlm-substitution'] as string[],
    averager: 'borda',
  },
  vampire: {
    chat: {
      logic_type: 1,
      model_building: false,
      max_duration: 10,
      layered: false,
      anaphora_selection: 'all' as const,
      anaphora_top_k: 1,
      anaphora_rankers: ['mlm-substitution'],
      anaphora_averager: 'borda',
    },
    regression: {
      logic_type: 0,
      model_building: true,
      max_duration: 10,
      layered: false,
      anaphora_selection: 'all' as const,
      anaphora_top_k: 1,
      anaphora_rankers: ['mlm-substitution'],
      anaphora_averager: 'borda',
    },
  },
};
