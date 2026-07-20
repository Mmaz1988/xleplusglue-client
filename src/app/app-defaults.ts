import { GswbPreferences } from './models/models';

export const APP_DEFAULTS = {
  grammar: {
    ligerPath: './grammars/dev/glue-basic-drt.lfg.glue',
    ligerRulesPath: './liger_resources/rules/basic_axiom_rules.txt',
  },
  liger: {
    sentence: 'Kim thought that he said that he saw a dog.',
  },
  graphInspector: {
    rulesText: "// HIERARCHIES\n" +
      "GF ::= SUBJ > OBJ > OBJ2 > OBL .\n" +
      "\n" +
      "// TEMPLATES\n" +
      "GF := SUBJ | OBJ | OBL .\n" +
      "\n" +
      "//Link DRs to their originating GFs\n" +
      "DR-GF-LINK(#a, #d) := #a SRC %a & #b SYN-ID %b & %a == %b & #b ^(in_set>GLUE>g::>cproj) #c phi #d .\n" +
      "\n" +
      "//Minimal complete nucleus path\n" +
      "MCN-PATH(#a,#b,#c) := #a ^(@GF*:~(->SUBJ)) #b & #b ^(@GF) #c.\n" +
      "\n" +
      "//Reflexive binding constraints (positive constraint)\n" +
      "REFL-BIND(#f,#h) := #f PRON-TYPE 'refl' & @MCN-PATH(#f,#i,#j) & #j !(@GF) #h & superior(GF,#h,#i) .\n" +
      "\n" +
      "//Coargument path\n" +
      "COARG-PATH(#a,#b,#c) := #a ^(@GF*:~(->PRED)) #b ^(@GF) #c.\n" +
      "\n" +
      "COARG(#a,#b) := @COARG-PATH(#a,#r,#s) & #s !(@GF) #b & id(#a) != id(#b).\n" +
      "\n" +
      "\n" +
      "DR-PRECEDENCE(#a,#b) := #a NAME %a & #a NODE_TYPE referent &\n" +
      "                        #b NAME %b & #b NODE_TYPE referent &\n" +
      "\t\t\tid(%a) < id(%b).  \n" +
      "\n" +
      "\n" +
      "//Personal pronoun binding constraint (negative constraint)\n" +
      "// For preventing:\n" +
      "//EX.: He_i thinks that John_i likes Sue.\n" +
      "//EX.: He_i likes John_i\n" +
      "//EX.: John_i likes him_i\n" +
      "//Ex.: John thinks that he likes him. \n" +
      "//PERS-BIND-FILTER(#a,#b) := \n" +
      "\n" +
      "// RULES\n" +
      "\n" +
      "//Connects referents via SRC with syntactic indices via SYN-ID\n" +
      "@DR-GF-LINK(#a,#d) ==> #a SYNSEM #d.\n" +
      "\n" +
      "@COARG(#a,#b) ==> #a COARG #b.\n" +
      "\n" +
      "//Reflexives\n" +
      "#a ant #a & #a SYNSEM #b & @REFL-BIND(#b,#c) & #c ^(SYNSEM) #d ==> #a POSSIBLE-ANT #d.\n" +
      "\n" +
      "\n" +
      "//Personal pronouns\n" +
      "#a ant #a & #a SYNSEM #b & #c SYNSEM #d &\n" +
      "@DR-PRECEDENCE(#c,#a) & -(@COARG(#b,#d)) ==> #a POTENTIAL-ANT #c.\n" +
      "\n" +
      "//For cases like EX.: Kim thought he saw him\" \n" +
      "#a ant #a & #a SYNSEM #b & #c ant #c & #c SYNSEM #d &\n" +
      "@DR-PRECEDENCE(#c,#a) & @COARG(#b,#d) & #a POTENTIAL-ANT #e & \n" +
      "#c POTENTIAL-ANT #f & id(#f) != id(#e) ?=> #a POSSIBLE-ANT #e & #c POSSIBLE-ANT #f.\n" +
      "\n" +
      "edge=POTENTIAL-ANT =-> 0.",
    queryText: `// hierarchies here
GF ::= SUBJ > OBJ > OBL .

GF := SUBJ | OBJ | OBL .

// templates here

MCN-PATH(#a,#b) := #a ^(@GF*:~(->SUBJ)) #b.

REFL-BIND(#f,#h) := @MCN-PATH(#f,#i) & #i ^(@GF) #j !(@GF) #h & superior(GF,#h,#i) .

#a ant #a & #a SYNSEM #b & @REFL-BIND(#b,#c)`,
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
  chat: {
    axioms: `tff(fast_type, type, fast: ($i * $int) > $o).
tff(kind_type, type, kind: ($i * $i) > $o).
tff(arg1_type, type, arg1: ($i * $i) > $o).
tff(arg2_type, type, arg2: ($i * $i) > $o).
tff(computer_type, type, computer: $i > $o).
tff(be_type, type, be: $i > $o).

tff(pn_type1, type, 'pc-6082': $i).
tff(pn_type2, type, 'itel-zx': $i).`,
  },
  inference: {
    axioms: '',
  },
  vampire: {
    chat: {
      logic_type: 1,
      model_building: true,
      max_duration: 10,
      layered: false,
    },
    regression: {
      logic_type: 0,
      model_building: true,
      max_duration: 10,
      layered: false,
    },
  },
};
