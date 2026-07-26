import { GswbPreferences } from './models/models';

export const APP_DEFAULTS = {
  grammar: {
    ligerPath: './grammars/dev/glue-basic-drt.lfg.glue',
    ligerRulesPath: './liger_resources/rules/basic_axiom_rules.txt',
  },
  liger: {
    sentence: 'Kim told a man about himself',
  },
  graphInspector: {
    rulesText: "// HIERARCHIES\n" +
      "\n" +
      "//Functional hierarchy\n" +
      "GF ::= SUBJ > OBJ > OBJ2 > OBL .\n" +
      "\n" +
      "//Templates\n" +
      "GF := SUBJ | OBJ | OBL .\n" +
      "\n" +
      "DRS := IMP | NOT | IN | MERGE | SUB . \n" +
      "\n" +
      "BIND-PATH(#a,#b) := #a ^(PRSP>@DRS*) #b & #a NAME %a & #b NAME %b & id(%b) < id(%a).\n" +
      "\n" +
      "//Link DRs to their originating GFs\n" +
      "DR-GF-LINK(#a, #d) := #a SRC %a & #b SYN-ID %b & %a == %b & #b ^(in_set>GLUE>g::>cproj) #c phi #d .\n" +
      "\n" +
      "// ***** PRONOUNS *****\n" +
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
      "DR-PRECEDENCE(#a,#b) := #a NAME %a & #a NODE_TYPE referent &\n" +
      "                        #b NAME %b & #b NODE_TYPE referent &\n" +
      "\t\t\t            id(%a) < id(%b).  \n" +
      "//Checks if two antecedent paths remain disjoint\n" +
      "DISJOINT(#a,#b) := -(#a !(POSSIBLE-ANT+) #g & #b !(POSSIBLE-ANT+) #h & id(#g) == id(#h)) .\n" +
      "\n" +
      "CLOSEST-POTENTIAL-ANT(#a,#c) := #a POTENTIAL-ANT #c .\n" +
      "// & -(#a POTENTIAL-ANT #b POTENTIAL-ANT #c) .\n" +
      "\n" +
      "//Personal pronoun binding constraint (negative constraint)\n" +
      "// For preventing:\n" +
      "//EX.: He_i thinks that John_i likes Sue.\n" +
      "//EX.: He_i likes John_i\n" +
      "//EX.: John_i likes him_i\n" +
      "//Ex.: John thinks that he likes him. \n" +
      "//PERS-BIND-FILTER(#a,#b) := \n" +
      "\n" +
      "// ***** PRESUPPOSITIONS *****\n" +
      "\n" +
      "// RULES\n" +
      "\n" +
      "//Connects referents via SRC with syntactic indices via SYN-ID\n" +
      "@DR-GF-LINK(#a,#d) ==> #a SYNSEM #d.\n" +
      "\n" +
      "@COARG(#a,#b) ==> #a COARG #b.\n" +
      "\n" +
      "//Presupposition rules\n" +
      "\n" +
      "//search for potential binders\n" +
      "@BIND-PATH(#a,#b) ==> #a POTENTIAL-BINDER #b .\n" +
      "\n" +
      "//Check if DRs in PRSP have binders\n" +
      "#a ^(POTENTIAL-BINDER) #b & #b IN #c &  #c bind #c & #a IN #d &\n" +
      "@DR-PRECEDENCE(#d,#c) ==> #c PRSP-ANT #d.\n" +
      "\n" +
      "//search for bound referents \n" +
      "#a POTENTIAL-BINDER #b IN #c & #a IN #d & #d bind #d ==> #d POSSIBLE-BINDER #c .\n" +
      "\n" +
      "#a POTENTIAL-BINDER #b IN #c & #a IN #d & -(#d POSSIBLE-BINDER #c) ?=> #d acc #d.\n" +
      "\n" +
      "#d bind #d & #d acc #d =-> #d acc #d.\n" +
      "\n" +
      "//Pronoun rules\n" +
      "\n" +
      "//Reflexives\n" +
      "#a ant #a & #a SYNSEM #b & @REFL-BIND(#b,#c) & #c ^(SYNSEM) #d ==> #a POSSIBLE-ANT #d.\n" +
      "\n" +
      "//Personal pronouns\n" +
      "#a ant #a & #a SYNSEM #b PRON-TYPE 'pers' & #c SYNSEM #d & \n" +
      "@DR-PRECEDENCE(#c,#a) & -(@COARG(#b,#d)) ==> #a POTENTIAL-ANT #c.\n" +
      "\n" +
      "//For cases like EX.: Kim thought he saw him\"\n" +
      "//More precise -(#a !(POTENTIAL-ANT+) #e & #c !(POTENTIAL-ANT+) #f & id(#f) == id(#e))\n" +
      "//There is no antecedent path such that two coargs refer to the same DR \n" +
      "#a ant #a & #a SYNSEM #b & #c ant #c & #c SYNSEM #d &\n" +
      "@DR-PRECEDENCE(#c,#a) & @COARG(#b,#d) & \n" +
      "@CLOSEST-POTENTIAL-ANT(#a,#e) & \n" +
      "@CLOSEST-POTENTIAL-ANT(#c,#f) & \n" +
      "id(#f) != id(#e) ?=> #a POSSIBLE-ANT #e & #c POSSIBLE-ANT #f.\n" +
      "\n" +
      "//Preparing for elimination of redundant edges (reflexive closure)\n" +
      "#a POTENTIAL-ANT #c & \n" +
      "-(#a POTENTIAL-ANT #b POTENTIAL-ANT #c) &\n" +
      "-(#a POSSIBLE-ANT) ==> #a POSSIBLE-ANT #c.\n" +
      "\n" +
      "#a ant #a & #a SYNSEM #b & #c ant #c & #c SYNSEM #d &\n" +
      "@COARG(#b,#d) & @DISJOINT(#a,#c) ?=> #z KEEP +.\n" +
      "\n" +
      "//Clean up\n" +
      "edge=POTENTIAL-ANT =-> 0.",
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
