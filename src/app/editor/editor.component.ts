import { Component, ViewChild, ElementRef, AfterViewInit, Input, ViewEncapsulation } from '@angular/core';
import * as CodeMirror from 'codemirror';


CodeMirror.defineMode("liger", function() {
  return {
    token: function(stream,state) {
      if (stream.match(/(->|;)/) ) {
        return "rule_separator";
      }

      else if (stream.match(/(\^|!|\*)/))
      {
        return "liger_node_var";
      }

      else if (stream.match(/=/))
      {
        return "angular_brackets";
      }

      else if (stream.match(/~/))
      {
        return "tilde";
      }
      else if (stream.match(/(\(|\)|\[|\])/))
      {
        return "parens";
      }

      else if (stream.match(/@(.*?)(?=\()/)) {
        return "liger_val_var";
      }
      else if (stream.match(/({|})/)) {
        return "liger_val_var";
      }
      else if (stream.match(/(\&|\.)/)) {

        return "liger_conjunction";
      } else if (stream.match("//")) {
        stream.skipToEnd();
        return "comment"; // Use the "comment" CSS class for the comment token
      }
      else {
        stream.next();
        return null;
      }
    }

  };
});

CodeMirror.defineMode("glue", function() {
  return {
    token: function(stream,state) {
      if (stream.match(":") ) {
        return "rule_separator";
      }

      else if (stream.match(/-o/))
      {
        return "liger_node_var";
      }

      else if (stream.match(/(\[|\])/)) {
        return "liger_conjunction";

      }
      else if (stream.match(/(\(|\))/)) {
        return "liger_val_var";

      }
      else if (stream.match(/(<|>)/)) {
        return "angular_brackets";

      }
      else if (stream.match("//")) {
        stream.skipToEnd();
        return "comment"; // Use the "comment" CSS class for the comment token
      }
      else {
        stream.next();
        return null;
      }
    }

  };
});

const DEFAULT_TEST_SUITE = "John loves Mary.\n\n" +
                            "Every man loved a woman.\n\n" +
                            "Mary said that Susan was sick.\n\n" +
                            "If Mary was sick, she would be sleeping.\n\n" +
                            "Mary married a man who smiled.\n\n" +
                            "Mary was dancing.\n\n" +
                            "Mary seems to smile.\n\n" +
                            "If Mary trained, she is sleeping.\n\n" +
                            "A man saw the monkey with the telescope.\n\n" +
                            "A woman will visit the cinema.\n\n" +
                            "Peter had visited the cinema.\n\n" +
                            "Peter wanted to visit Mary.\n\n" +
                            "Mary gave Peter a letter.\n\n";





const LIGER_DEFAULT_RULES = "relation = parataxis -> STOP\n" +
  "relation = expl -> STOP\n" +
  "relation = dislocated -> STOP\n" +
  "relation = discourse -> STOP\n" +
  "relation = vocative -> STOP\n" +
  "\n" +
  "relation = flat ->\n" +
  "\n" +
  "relation = nsubj; PronType=Rel -> @gap-type-verbal-dep(nsubj^)\n" +
  "relation = nsubj:pass; PronType=Rel -> @gap-type-verbal-dep(nsubj_pass^)\n" +
  "relation = obj; PronType=Rel -> @gap-type-verbal-dep(obj^)\n" +
  "relation = iobj; PronType=Rel -> @gap-type-verbal-dep(iobj^)\n" +
  "relation = gf; PronType=Rel -> @gap-type-verbal-dep(gf^)\n" +
  "relation = nmod:poss; PronType=Rel -> \\X.\\P.\\Y.(([], [poss*(X,Y)]) + P(Y)) : (e(!) -o (@et(^) -o @et(^)))\n" +
  "PronType=Rel ->\n" +
  "\n" +
  "## IF negative_concord = \"yes\"\n" +
  "relation = (root|@CLAUSAL-REL() ); advmod { @NEGATIVE() } -> \\P.(-P) : p(!) -o p(!)\n" +
  "\n" +
  "## ELSE\n" +
  "relation = advmod; @NEGATIVE() -> \\P.(-P) : p(^) -o p(^)\n" +
  "## ENDIF\n" +
  "\n" +
  "relation = conj; coarsePos = VERB; ~ ^ {relation = amod}; ~ ^ {relation = xcomp}; ~ ^ {relation = advcl} -> \\V.\\U.\\F.(U(F) + V(\\G.([],[]))) : x(!) -o x(^) -o x(^)\n" +
  "\n" +
  "relation = conj; coarsePos = ADJ; ~ ^ {relation = amod} -> \\V.\\U.\\F.(U(F) + V(\\G.([],[]))) : x(!) -o x(^) -o x(^)\n" +
  "\n" +
  "relation = conj; coarsePos = NOUN; ^ {relation = root}; ^ nsubj {  } -> \\V.\\U.\\F.(U(F) + V(\\G.([],[]))) : x(!) -o x(^) -o x(^)\n" +
  "\n" +
  "relation = conj; coarsePos = VERB; ~ nsubj {}; ^ {relation = xcomp} -> \\V.\\X.\\E.(V(\\E1.(([],[xcomp(E,E1), nsubj(E1,X)])))) : x(!) -o (e(!) -o v(!) -o t(!))\n" +
  "\n" +
  "relation = conj; coarsePos = VERB; ~ nsubj {}; ^ {relation = xcomp} -> \\P.\\Q.\\X.\\E.(P(X)(E)+Q(X)(E)) : (e(!) -o v(!) -o t(!)) -o (e(^) -o v(^) -o t(^)) -o e(^) -o v(^) -o t(^)\n" +
  "\n" +
  "relation = mark; ^ {relation = conj}; ^ ^ {relation = advcl} -> \\U.\\V.\\F.V(\\E.(([], [:LEMMA:(E, U(\\G.([],[])))]) + F(E))) : x(^) -o x(^ ^ ^) -o x(^ ^ ^)\n" +
  "\n" +
  "relation = conj; ~ mark { }; ^ {relation = advcl} -> \\U.\\V.\\F.V(\\E.(([], [advcl(E, U(\\G.([],[])))]) + F(E))) : x(!) -o x(^ ^) -o x(^ ^)\n" +
  "\n" +
  "relation = conj; ^ {relation = amod} -> \\V.\\P.\\X.(V(\\E.([],[Attribute*(X,E)])) + P(X)) : (x(!) -o (@et(^ ^) -o @et(^ ^)))\n" +
  "\n" +
  "relation = conj; ^ {relation = nmod}; ~ case { } -> \\Q.\\P.\\X.((Q(\\Y.([], [nmod*(X,Y)] ))) + P(X)) : (@quant(\"!\" \"^\") -o (@et(^ ^) -o @et(^ ^)))\n" +
  "\n" +
  "relation = case; ^ {relation = conj};  ^ ^ {relation = nmod} -> \\Q.\\P.\\X.((Q(\\Y.([], [:LEMMA:*(X,Y)] ))) + P(X)) : (@quant(\"^\" \"^ ^\") -o (@et(^ ^ ^) -o @et(^ ^ ^)))\n" +
  "\n" +
  "relation = case; ^ {relation = conj}; ^ ^ {relation = nmod:poss} ->\n" +
  "\n" +
  "relation = conj; ^ {relation = nmod:poss} -> \\Q.\\P.\\X.((Q(\\Y.([], [poss*(X,Y)] ))) + P(X)) : (@quant(\"!\" \"^\") -o (@et(^ ^) -o @et(^ ^)))\n" +
  "\n" +
  "relation = conj; ^ {relation = advmod}; ! {PronType=Int}; ~ ^ ^ {relation = (amod|advmod)} -> \\P.\\F.P(\\E(([X], [:INTR:*(X), EQ*(X, `?`), :LEMMA:*(E,X)]) + F(E))) : (x(^ ^) -o x(^ ^))\n" +
  "\n" +
  "relation = conj; ^ {relation = advmod}; !{PronType=Int}; ^ ^ {relation = (amod|advmod)} -> \\P.\\X.(([Y],[:INTR:*(Y), EQ*(Y, `?`), :LEMMA:*(X,Y)]) + P(X)) : (v(^ ^) -o t(^ ^)) -o v(^ ^) -o t(^ ^)\n" +
  "\n" +
  "relation = conj; ^ {relation = advmod}; ~ ! {PronType=Int} -> \\X.(([],[:INTR:*(X), :LEMMA:*(X)])) : v(!) -o t(!)\n" +
  "\n" +
  "relation = conj; ^ {relation = advmod}; ~ ! {PronType=Int}; ~ ^ ^ {relation = (amod|advmod)} ->  \\Q.\\P.\\F.P(\\E(([X], [advmod*(E,X)]) + F(E) + Q(X))) : (v(!) -o t(!)) -o (x(^ ^) -o x(^ ^))\n" +
  "\n" +
  "relation = conj; ^ {relation = advmod}; ~ ! {PronType=Int}; ^ ^ {relation = (amod|advmod)} -> \\Q.\\P.\\X.(([Y],[:INTR:*(Y), :LEMMA:*(Y), advmod*(X,Y)]) + P(X) + Q(X)) : (v(!) -o t(!)) -o (v(^ ^) -o t(^ ^)) -o v(^ ^) -o t(^ ^)\n" +
  "\n" +
  "relation = conj; ^ {relation = obl.*}; ~ case { } -> @e-type-verbal-dep-mng(obl) : @e-type-verbal-dep-type(\"!\" \"%h\" \"^ ^\") : %h = ^\n" +
  "\n" +
  "relation = case; ^ {relation = conj}; ^ ^ {relation = obl.*} -> @e-type-verbal-dep-mng(:LEMMA:) : @e-type-verbal-dep-type(\"^\" \"%h\" \"^ ^ ^\") : %h = ^ ^\n" +
  "\n" +
  "coarsePos = (PROPN|NOUN|PRON); ! conj cc{lemma = $conjunction }; ~ ! conj case { }; relation = @CORE-NOMINAL-REL() -> \\R.\\S.(([X],[:INTR:{conj cc}(X), entity(X)]) + R(X) + S(X)) : @et(%C) -o @quant(\"!\" \"^\")\n" +
  "\n" +
  "coarsePos = (PROPN|NOUN|PRON); ! conj cc{lemma = $conjunction }; ~ ! conj case { }; relation = root; ~ ! nsubj {  }; ~ ! cop { } -> \\R.\\S.(([X],[:INTR:{conj cc}(X), entity(X)]) + R(X) + S(X)) : @et(%C) -o @quant(\"!\" \"^\")\n" +
  "\n" +
  "coarsePos = (PROPN|NOUN|PRON); ! conj cc {lemma = $conjunction }; ~ ! conj case { }; relation = @CORE-NOMINAL-REL() -> \\Q.\\X.(Q(\\Z.(([],[Sub{conj cc}(X,Z)])))) : @quant(\"!\" \"^\") -o @et(%C)\n" +
  "\n" +
  "coarsePos = (PROPN|NOUN|PRON); ! conj cc {lemma = $conjunction }; ~ ! conj case { }; relation = root; ~ ! nsubj {  }; ~ ! cop { } -> \\Q.\\X.(Q(\\Z.(([],[Sub{conj cc}(X,Z)])))) : @quant(\"!\" \"^\") -o @et(%C)\n" +
  "\n" +
  "coarsePos = (PROPN|NOUN|PRON); relation = conj; ^ conj cc {lemma = $conjunction }; ~ ! case {}; ^ { relation = @CORE-NOMINAL-REL() } -> \\Q.\\P.\\X.(Q(\\Z.(([],[Sub{^ conj cc}(X,Z)]))) + P(X)) : @quant(\"!\" \"^\") -o (@et(%C) -o @et(%C))\n" +
  "\n" +
  "coarsePos = (PROPN|NOUN|PRON); relation = conj; ^ conj cc {lemma = $conjunction }; ~ ! case {}; ^ { relation = root }; ~ ^ nsubj { }; ~ ^ cop { } -> \\Q.\\P.\\X.(Q(\\Z.(([],[Sub{^ conj cc}(X,Z)]))) + P(X)) : @quant(\"!\" \"^\") -o (@et(%C) -o @et(%C))\n" +
  "\n" +
  "coarsePos = (PROPN|NOUN|PRON); relation = conj; ^ conj cc {lemma = $disjunction }; ~ ! case {}; ^ { relation = @CORE-NOMINAL-REL() } -> \\Q1.\\Q2.\\P.(([Y], [Q1(\\X.(([],[X=Y]))) | Q2(\\Z.(([],[Z=Y])))]) + P(Y)) : @quant(\"^\" \"^ ^\") -o @quant(\"!\" \"^\") -o @quant(\"^\" \"^ ^\")\n" +
  "\n" +
  "@POTENTIAL-PRO-DROP() ; @1ST-PERSON() ; @SINGULAR() ->  \\V.\\F.(V(\\E.(([X], [@1SG-PRONOUN-DRS-CONDS(\"X\"), nsubj(E,X)]) + F(E)))) : (x(!) -o x(!))\n" +
  "\n" +
  "@POTENTIAL-PRO-DROP() ; @2ND-PERSON() ; @SINGULAR() ->  \\V.\\F.(V(\\E.(([X], [@2SG-PRONOUN-DRS-CONDS(\"X\"), nsubj(E,X)]) + F(E)))) : (x(!) -o x(!))\n" +
  "\n" +
  "@POTENTIAL-PRO-DROP() ; @3RD-PERSON() ; @SINGULAR() ->  \\V.\\F.(V(\\E.(([X], [@3SG-PRONOUN-DRS-CONDS(\"entity\" \"X\"), nsubj(E,X)]) + F(E)))) : (x(!) -o x(!))\n" +
  "\n" +
  "@POTENTIAL-PRO-DROP() ; @1ST-PERSON() ; @PLURAL() ->  \\V.\\F.(V(\\E.(([X], [@1PL-PRONOUN-DRS-CONDS(\"X\"), nsubj(E,X)]) + F(E)))) : (x(!) -o x(!))\n" +
  "\n" +
  "@POTENTIAL-PRO-DROP() ; @2ND-PERSON() ; @PLURAL() ->  \\V.\\F.(V(\\E.(([X], [@2PL-PRONOUN-DRS-CONDS(\"X\"), nsubj(E,X)]) + F(E)))) : (x(!) -o x(!))\n" +
  "\n" +
  "@POTENTIAL-PRO-DROP() ; @3RD-PERSON() ; @PLURAL() ->  \\V.\\F.(V(\\E.(([X], [@3SG-PRONOUN-DRS-CONDS(\"entity\" \"X\"), nsubj(E,X)]) + F(E)))) : (x(!) -o x(!))\n" +
  "\n" +
  "coarsePos = VERB -> \\F.(([E],[:INTR:*(E), :LEMMA:(E)]) + F(E) ) : x(!)\n" +
  "\n" +
  "coarsePos = VERB; @NO-AUX() ; Tense=Past -> \\V.\\F.(V(\\E.(@PAST-DRS(\"T\" \"E\") + F(E)))) : x(!) -o x(!)\n" +
  "\n" +
  "# coarsePos = VERB; @NO-AUX ; Tense=Pres -> \\V.\\F.(V(\\E.(-@PRES-DRS(\"T\" \"E\") + F(E)))) : x(!) -o x(!)\n" +
  "# coarsePos = VERB; ~ dep {relation = aux.*}; Tense=Pres -> \\V.\\F.(V(\\E.(@PRES-DRS(\"T\" \"E\") + F(E)))) : x(!) -o x(!)\n" +
  "coarsePos = VERB; ~ aux.* {}; Tense=Pres -> \\V.\\F.(V(\\E.(@PRES-DRS(\"T\" \"E\") + F(E)))) : x(!) -o x(!)\n" +
  "\n" +
  "coarsePos = VERB; @NO-AUX() ; Tense=Fut -> \\V.\\F.(V(\\E.(@FUT-DRS(\"T\" \"E\") + F(E)))) : x(!) -o x(!)\n" +
  "\n" +
  "coarsePos = VERB; @NO-AUX() ; Tense=Imp -> \\V.\\F.(V(\\E.(@IMP-DRS(\"T\" \"E\") + F(E)))) : x(!) -o x(!)\n" +
  "\n" +
  "coarsePos = VERB; @NO-AUX() ; Tense=Pqp -> \\V.\\F.(V(\\E.(@PQP-DRS(\"T\" \"E\") + F(E)))) : x(!) -o x(!)\n" +
  "\n" +
  "coarsePos = NOUN -> \\X.([],[:LEMMA:(X) ] ) : @et(!)\n" +
  "coarsePos = PROPN -> \\X.([], [Name(X, `:LEMMA:`)]) : @et(!)\n" +
  "\n" +
  "coarsePos = (PROPN|NOUN); relation = (root|@CLAUSAL-REL() ); ! (nsubj|cop) { } -> \\V.(V(\\F.( [],[] ))) : (x(!) -o p(!))\n" +
  "\n" +
  "coarsePos = (PROPN|NOUN); relation = root ; ~ ! gf {coarsePos = ADP}; ! (nsubj|cop) { } -> \\Q.\\F.(Q(\\X.(([E], [be{cop}(E), Co_Theme(E,X)]) + F(E)))) : (@quant(\"!\" \"^\") -o x(!))\n" +
  "\n" +
  "coarsePos = (PROPN|NOUN); relation = conj ; ^ {relation = root}; ~ ! gf {coarsePos = ADP}; ^ (nsubj|cop) { } -> \\Q.\\F.(Q(\\X.(([E], [be{cop}(E), Co_Theme(E,X)]) + F(E)))) : (@quant(\"!\" \"^\") -o x(!))\n" +
  "\n" +
  "coarsePos = (PROPN|NOUN); relation = conj; ^ {relation = @CLAUSAL-REL() }; ~ ! gf {coarsePos = ADP} -> \\Q.\\F.(Q(\\X.(([E], [be{^ cop}(E), Co_Theme{^ cop}(E,X)]) + F(E)))) : (@quant(\"!\" \"^\") -o x(!))\n" +
  "\n" +
  "coarsePos = (PROPN|NOUN); relation = @CLAUSAL-REL() ; ~ ! gf {coarsePos = ADP} -> \\Q.\\F.(Q(\\X.(([E], [be{cop}(E), Co_Theme(E,X)]) + F(E)))) : (@quant(\"!\" \"^\") -o x(!))\n" +
  "\n" +
  "coarsePos = ADP; ^ {relation = root}; ^ {coarsePos = (PROPN|NOUN)}; ^ (nsubj|cop) { } -> \\Q.\\F.(Q(\\X.(([E], [:INTR:{^ cop}(E), be(E), :LEMMA:*(E,X)]) + F(E)))) : (@quant(\"^\" \"^ ^\") -o x(^))\n" +
  "\n" +
  "coarsePos = ADP; ^ {relation = conj}; ^ {coarsePos = (PROPN|NOUN)}; ^ ^ {relation = root}; ^ ^ (nsubj|cop) { } -> \\Q.\\F.(Q(\\X.(([E], [:INTR:{^ ^ cop}(E), be(E), :LEMMA:*(E,X)]) + F(E)))) : (@quant(\"^\" \"^ ^\") -o x(^))\n" +
  "\n" +
  "coarsePos = ADP; ^ {relation = conj}; ^ {coarsePos = (PROPN|NOUN)}; ^ ^ {relation = @CLAUSAL-REL() } -> \\Q.\\F.(Q(\\X.(([E], [:INTR:{^ ^ cop}(E), be(E), :LEMMA:*(E,X)]) + F(E)))) : (@quant(\"^\" \"^ ^\") -o x(^))\n" +
  "\n" +
  "coarsePos = ADP; ^ {relation = @CLAUSAL-REL() }; ^ {coarsePos = (PROPN|NOUN)} -> \\Q.\\F.(Q(\\X.(([E], [:INTR:{^ cop}(E), be(E), :LEMMA:*(E,X)]) + F(E)))) : (@quant(\"^\" \"^ ^\") -o x(^))\n" +
  "\n" +
  "coarsePos = ADJ; relation=(nsubj|obj|iobj|obl.*) -> \\X.([], [:LEMMA:(X)]) : @et(!)\n" +
  "\n" +
  "coarsePos = ADJ; relation=(nsubj|obj|iobj|obl.*); ~ det { } -> \\P.\\Q.(([X],[:INTR:*(X) ]) + P(X) + Q(X) ) : (@et(!) -o @quant(\"!\" \"^\"))\n" +
  "\n" +
  "coarsePos = ADJ; ~ relation = amod; ~ ^ {relation = amod} -> \\F.(([S], [:INTR:*(S), :LEMMA:*(S)]) + F(S)) : x(!)\n" +
  "\n" +
  "coarsePos = ADJ; relation = root -> \\V.(V(\\F.( [],[] ))) : (x(!) -o p(!))\n" +
  "\n" +
  "@PRONOUN() ; @1SG() -> @1SG-PRONOUN-MEANING-CONSTRUCTOR()\n" +
  "\n" +
  "@PRONOUN() ; @1PL() -> @1-PL-PRONOUN-MEANING-CONSTRUCTOR()\n" +
  "\n" +
  "@PRONOUN() ; @PERSON(\"1\"); ~ @NUMBER(\"Sing\"); ~ @NUMBER(\"Plur\") -> @1SG-PRONOUN-MEANING-CONSTRUCTOR()\n" +
  "\n" +
  "@PRONOUN() ; @2SG() -> @2-SG-PRONOUN-MEANING-CONSTRUCTOR()\n" +
  "\n" +
  "@PRONOUN() ; @2PL() -> @2-PL-PRONOUN-MEANING-CONSTRUCTOR()\n" +
  "\n" +
  "@PRONOUN() ; @PERSON(\"2\"); ~ @NUMBER(\"Sing\"); ~ @NUMBER(\"Plur\") -> @2-SG-PRONOUN-MEANING-CONSTRUCTOR()\n" +
  "\n" +
  "## IF grammatical_gender = \"no\"\n" +
  "\n" +
  "@3RD-PERSON-PRONOUN() ; Gender=Masc -> @3-SG-PRONOUN-MEANING-CONSTRUCTOR-MASC()\n" +
  "\n" +
  "@3RD-PERSON-PRONOUN() ; Gender=Fem -> @3-SG-PRONOUN-MEANING-CONSTRUCTOR-FEM()\n" +
  "\n" +
  "@3RD-PERSON-PRONOUN() ; Gender=Neut -> @3-SG-PRONOUN-MEANING-CONSTRUCTOR-NEUT()\n" +
  "\n" +
  "@3RD-PERSON-PRONOUN() ; @NO-GENDER() -> @3-SG-PRONOUN-MEANING-CONSTRUCTOR-NEUT()\n" +
  "\n" +
  "## ELSE\n" +
  "@3RD-PERSON-PRONOUN() -> @3-SG-PRONOUN-MEANING-CONSTRUCTOR-NEUT()\n" +
  "## ENDIF\n" +
  "\n" +
  "relation = root, coarsePos = VERB -> \\V.(V(\\E.( [],[] ))) : (x(!) -o p(!))\n" +
  "\n" +
  "relation = root; coarsePos = (PROPN|NOUN); ~ nsubj { }; ~ cop { } -> \\X.([E],[event(E), Participant(E,X)]) : (e(!) -o p(^))\n" +
  "\n" +
  "relation = nsubj; ^ {coarsePos=VERB} -> @e-type-verbal-dep(nsubj^) : %h = @arg-scope()\n" +
  "relation = nsubj:pass -> @e-type-verbal-dep(nsubj_pass^) : %h = @arg-scope()\n" +
  "\n" +
  "relation = nsubj; ^ {coarsePos=(PROPN|NOUN)} -> @e-type-verbal-dep(Theme{^ cop}) : %h = @arg-scope()\n" +
  "\n" +
  "relation = nsubj; ^ {coarsePos=ADJ} -> @e-type-verbal-dep-inverse(Attribute^) : %h = @arg-scope()\n" +
  "\n" +
  "relation = obj -> @e-type-verbal-dep(obj^) : %h = @arg-scope()\n" +
  "\n" +
  "relation = iobj -> @e-type-verbal-dep(iobj^) : %h = @arg-scope()\n" +
  "\n" +
  "relation = obl.*; ~ case { }; ~ relation = obl:tmod -> @e-type-verbal-dep(obl^) : %h = @arg-scope()\n" +
  "relation = case; ^ {relation = obl.*}; ~ ^{relation = obl:tmod} -> @e-type-verbal-dep-mng(:LEMMA:) : @e-type-verbal-dep-type(\"^\" \"%h\" \"^ ^\") : %h = ^ ^\n" +
  "\n" +
  "relation = obl:tmod; ~ case { } -> @e-type-verbal-dep(Time^) : %h = @arg-scope()\n" +
  "\n" +
  "relation = gf -> @e-type-verbal-dep(gf^) : %h = @arg-scope()\n" +
  "\n" +
  "relation = csubj ->  \\U.\\V.\\F.V(\\E.(([], [csubj^(E, U(\\G.([],[])))]) + F(E))) : x(!) -o x(^) -o x(^)\n" +
  "\n" +
  "relation = ccomp; ~ mark { }; advmod { @NEGATIVE() } ->  \\U.\\V.\\F.V(\\E.(([], [ccomp^(E, -U(\\G.([],[])))]) + F(E))) : x(!) -o x(^) -o x(^)\n" +
  "relation = ccomp; ~ mark { }; ~ advmod { @NEGATIVE() } ->  \\U.\\V.\\F.V(\\E.(([], [ccomp^(E, U(\\G.([],[])))]) + F(E))) : x(!) -o x(^) -o x(^)\n" +
  "\n" +
  "relation = xcomp; coarsePos = VERB; ~ nsubj {} -> \\V.\\X.\\E.(V(\\E1.(([],[xcomp(E,E1), nsubj(E1,X)])))) : x(!) -o (e(!) -o v(!) -o t(!))\n" +
  "\n" +
  "relation = xcomp; coarsePos = VERB; ~ nsubj {} -> \\W.\\V.\\F.(V(\\E.(([X],[control_rel(E,X)]) + W(X)(E) + F(E)))) : (e(!) -o v(!) -o t(!)) -o (x(^) -o x(^))\n" +
  "\n" +
  "relation = advcl; ~ mark { } -> \\U.\\V.\\F.V(\\E.(([], [advcl^(E, U(\\G.([],[])))]) + F(E))) : x(!) -o x(^) -o x(^)\n" +
  "\n" +
  "relation = acl; coarsePos = VERB -> \\V.\\P.\\X.(V(\\E.(P(X) + ([], [Participant*(E,X)])))) : x(!) -o (@et(^) -o @et(^))\n" +
  "\n" +
  "relation = acl:relcl -> \\P.\\V.\\X.(P(X) + ((V(X))(\\X.([],[])))) : (@et(^) -o ((e(! gf§ gf{PronType=Rel}) -o x(!)) -o @et(^)))\n" +
  "\n" +
  "relation = nmod; ~ case { } -> \\Q.\\P.\\X.((Q(\\Y.([], [nmod*(X,Y)] ))) + P(X)) : (@quant(\"!\" \"^\") -o (@et(^) -o @et(^)))\n" +
  "relation = case; ^ {relation = nmod} -> \\Q.\\P.\\X.((Q(\\Y.([], [:LEMMA:(X,Y)] ))) + P(X)) : (@quant(\"^\" \"^ ^\") -o (@et(^ ^) -o @et(^ ^)))\n" +
  "relation = case; ^ {relation = nmod:poss} ->\n" +
  "relation = nmod:poss ->  \\Q.\\P.\\X.((Q(\\Y.([], [poss*(X,Y)] ))) + P(X)) : (@quant(\"!\" \"^\") -o (@et(^) -o @et(^)))\n" +
  "\n" +
  "coarsePos = VERB; relation = amod -> \\V.\\P.\\X.(V(\\E.([],[Attribute^(X,E)])) + P(X)) : (x(!) -o (@et(^) -o @et(^)))\n" +
  "\n" +
  "coarsePos = ADJ; relation = amod -> \\F.(([E],[:INTR:*(E), :LEMMA:(E)]) + F(E) ) : x(!)\n" +
  "\n" +
  "coarsePos = ADJ; ^ {relation = amod} -> \\F.(([E],[:INTR:*(E), :LEMMA:(E)]) + F(E) ) : x(!)\n" +
  "\n" +
  "coarsePos = ADJ; relation = amod -> \\A.\\P.\\X.(A(\\E.([],[Attribute^(X,E)])) + P(X)) : (x(!) -o (@et(^) -o @et(^)))\n" +
  "\n" +
  "relation = advmod; ~ ! {PronType=Int}; @AFFIRMATIVE() -> \\X.(([],[:INTR:*(X), :LEMMA:*(X)])) : v(!) -o t(!)\n" +
  "\n" +
  "relation = advmod; ~ ! {PronType=Int}; ~ ^ {relation = (amod|advmod)}; @AFFIRMATIVE() ->  \\Q.\\P.\\F.P(\\E(([X], [advmod*(E,X)]) + F(E) + Q(X))) : (v(!) -o t(!)) -o (x(^) -o x(^))\n" +
  "\n" +
  "relation = advmod; ~ ! {PronType=Int}; ^ {relation = (amod|advmod)}; @AFFIRMATIVE() -> \\Q.\\P.\\X.(([Y],[:INTR:*(Y), :LEMMA:*(Y), advmod*(X,Y)]) + P(X) + Q(X)) : (v(!) -o t(!)) -o (v(^) -o t(^)) -o v(^) -o t(^)\n" +
  "\n" +
  "relation = advmod; !{PronType=Int}; ~ ^ {relation = (amod|advmod)} -> \\P.\\F.P(\\E(([X], [:INTR:*(X), EQ*(X, `?`), :LEMMA:*(E,X)]) + F(E))) : (x(^) -o x(^))\n" +
  "\n" +
  "relation = advmod; !{PronType=Int}; ^ {relation = (amod|advmod)} -> \\P.\\X.(([Y],[:INTR:*(Y), EQ*(Y, `?`), :LEMMA:*(X,Y)]) + P(X)) : (v(^) -o t(^)) -o v(^) -o t(^)\n" +
  "\n" +
  "relation = appos -> \\P.\\Q.\\X.(P(X) + Q(X)) : (@et(!) -o (@et(^) -o @et(^)))\n" +
  "\n" +
  "##IF language = \"eng\"\n" +
  "\n" +
  "relation = aux; lemma = $future_aux -> \\V.\\F.(V(\\E.(@FUT-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "\n" +
  "relation = aux; ! {Tense=Pres}; @NO-TENSE(^); ~ ^ {aux.* {lemma= $future_aux }} -> \\V.\\F.(V(\\E.(@PRES-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "relation = aux; ! {Tense=Past}; @NO-TENSE(^); ~ ^ {aux.* {lemma= $future_aux }} -> \\V.\\F.(V(\\E.(@PAST-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "relation = aux; ! {Tense=Fut}; @NO-TENSE(^); ~ ^ {aux.* {lemma= $future_aux }}  -> \\V.\\F.(V(\\E.(@FUT-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "relation = aux; ! {Tense=Imp}; @NO-TENSE(^); ~ ^ {aux.* {lemma= $future_aux }}  -> \\V.\\F.(V(\\E.(@IMP-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "relation = aux; ! {Tense=Pqp}; @NO-TENSE(^); ~ ^ {aux.* {lemma= $future_aux }}  -> \\V.\\F.(V(\\E.(@PQP-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "\n" +
  "relation = aux; @NO-TENSE(!); @NO-TENSE(^); ~ lemma = $future_aux -> \\V.\\F.(V(\\E.(@PRES-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "\n" +
  "relation = aux; Tense=Pres; ~ ^ aux{lemma = $future_aux }; ~ ^ aux:pass {}; ^ {Tense=Past,VerbForm=Part} -> \\V.\\F.(V(\\E.(@PAST-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "relation = aux; Tense=Pres; ~ ^ aux{lemma = $future_aux }; ~ ^ aux:pass {}; ^ aux{Tense=Past,VerbForm=Part} -> \\V.\\F.(V(\\E.(@PAST-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "\n" +
  "relation = aux; Tense=Pres; VerbForm=Fin; ~ ^ aux{lemma = $future_aux }; ~ ^ aux:pass {}; ^ {Tense=Pres,VerbForm=Part}; ~ ^ aux{Tense=Past} -> \\V.\\F.(V(\\E.(@PRES-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "relation = aux; Tense=Past; VerbForm=Fin; ~ ^ aux{lemma = $future_aux }; ~ ^ aux:pass {}; ^ {Tense=Pres,VerbForm=Part} -> \\V.\\F.(V(\\E.(@PAST-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "\n" +
  "relation = aux:pass; ! {Tense=Pres}; ~ ^ aux{lemma = $future_aux } -> \\V.\\F.(V(\\E.(@PRES-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "relation = aux:pass; ! {Tense=Past}; ~ ^ aux{lemma = $future_aux } -> \\V.\\F.(V(\\E.(@PAST-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "relation = aux:pass; ! {Tense=Fut}; ~ ^ aux{lemma = $future_aux } -> \\V.\\F.(V(\\E.(@FUT-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "relation = aux:pass; ! {Tense=Imp}; ~ ^ aux{lemma = $future_aux } -> \\V.\\F.(V(\\E.(@IMP-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "relation = aux:pass; ! {Tense=Pqp}; ~ ^ aux{lemma = $future_aux } -> \\V.\\F.(V(\\E.(@PQP-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "\n" +
  "relation = aux:pass; @NO-TENSE(!); @NO-TENSE(^ aux); ~ ^ aux {lemma=$future_aux } -> \\V.\\F.(V(\\E.(@PRES-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "\n" +
  "relation = aux:pass; @NO-TENSE(!); ^ aux {Tense=Pres}; ~ ^ aux {Tense=Past} -> \\V.\\F.(V(\\E.(@PRES-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "\n" +
  "relation = aux:pass; @NO-TENSE(!); ^ aux {Tense=Past} -> \\V.\\F.(V(\\E.(@PAST-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "\n" +
  "## ENDIF\n" +
  "\n" +
  "relation = cop; ! {Tense=Pres} -> \\V.\\F.(V(\\E.(@PRES-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "relation = cop; ! {Tense=Past} -> \\V.\\F.(V(\\E.(@PAST-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "relation = cop; ! {Tense=Fut} -> \\V.\\F.(V(\\E.(@FUT-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "\n" +
  "relation = cop; ! {Tense=Imp} -> \\V.\\F.(V(\\E.(@IMP-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "relation = cop; ! {Tense=Pqp} -> \\V.\\F.(V(\\E.(@PQP-DRS(\"T\" \"E\") + F(E)))) : x(^) -o x(^)\n" +
  "\n" +
  "relation = mark; lemma = $infinitive_marker ; ^ mark {lemma != $infinitive_marker } ->\n" +
  "\n" +
  "relation = mark; ^ {relation = advcl} -> \\U.\\V.\\F.V(\\E.(([], [:LEMMA:(E, U(\\G.([],[])))]) + F(E))) : x(^) -o x(^ ^) -o x(^ ^)\n" +
  "\n" +
  "relation = mark; ^ {relation = ccomp} -> \\U.\\V.\\F.V(\\E.(([], [:LEMMA:_ccomp(E, U(\\G.([],[])))]) + F(E))) : x(^) -o x(^ ^) -o x(^ ^)\n" +
  "\n" +
  "coarsePos = DET; ^ {relation = appos} ->\n" +
  "\n" +
  "relation = det; ! {PronType=Int} -> \\P.\\Q.(([X],[:INTR:*(X), EQ*(X,`?`)]) + P(X) + Q(X) ) : (@et(^) -o ((e(^) -o p(%h)) -o p(%h))) : %h = ^ ^\n" +
  "\n" +
  "## IF NOT definite_det=\"\"\n" +
  "relation = det; lemma = $definite_det -> \\P.\\Q.(([],[PRESUPPOSITION((([X],[:INTR:*(X)]) + P(X)))]) + Q(X)) : (@et(^) -o @quant(\"^\" \"%h\")) : %h = @det-scope()\n" +
  "## ENDIF\n" +
  "relation = det; lemma = $indefinite_det ->   \\P.\\Q.(([X],[:INTR:*(X)]) + P(X) + Q(X) )  : (@et(^) -o @quant(\"^\" \"%h\")) : %h = @det-scope()\n" +
  "relation = det; lemma = $universal_quantifier -> \\P.\\Q.([ ],[ ((([X],[:INTR:*(X)]) + P(X)) => (Q(X))) ]) : (@et(^) -o @quant(\"^\" \"%h\")) : %h = @det-scope()\n" +
  "\n" +
  "# relation = det; Definite=Def -> \\P.\\Q.(([],[PRESUPPOSITION((([X],[:INTR:*(X)]) + P(X)))]) + Q(X)) : (@et(^) -o @quant(\"^\" \"%h\")) : %h = @det-scope()\n" +
  "\n" +
  "coarsePos = NOUN; ~ det { }; ~ ! {relation=compound} -> \\P.\\Q.(([X],[:INTR:*(X)]) + P(X) + Q(X) ) : (@et(!) -o @quant(\"!\" \"^\"))\n" +
  "\n" +
  "coarsePos = PROPN; ~ relation = appos; ~ relation = compound; ~ det { } -> \\P.\\Q.(([],[PRESUPPOSITION((([X],[:INTR:*(X)]) + P(X)))]) + Q(X)) : (@et(!) -o @quant(\"!\" \"^\"))\n" +
  "\n" +
  "relation = compound; coarsePos = NOUN|PROPN -> \\Q.\\P.\\X.(([Y], [compound(X,Y)]) + Q(Y) + P(X))  : @et(!) -o @et(^) -o @et(^)\n"


const DEFAULT_TEMPLATES = "@CLAUSAL-REL 0 = (xcomp|ccomp|acl|advcl|csubj)\n" +
  "\n" +
  "@CORE-NOMINAL-REL 0 = (nsubj|obj|iobj)\n" +
  "\n" +
  "@CORE-CLAUSAL-REL 0 = (csubj|ccomp|xcomp)\n" +
  "\n" +
  "@CORE-REL 0 = ( @CORE-NOMINAL-REL() | @CORE-CLAUSAL-REL() )\n" +
  "\n" +
  "@SUBJ 0 = (nsubj|csubj)\n" +
  "\n" +
  "@PERSON 1 = Person = #1\n" +
  "@1ST-PERSON 0 = @PERSON(1)\n" +
  "@2ND-PERSON 0 = @PERSON(2)\n" +
  "@3RD-PERSON 0 = @PERSON(3)\n" +
  "\n" +
  "@NUMBER 1 = Number = #1\n" +
  "@SINGULAR 0 = @NUMBER(Sing)\n" +
  "@PLURAL 0 = @NUMBER(Plur)\n" +
  "\n" +
  "@1SG 0 = @1ST-PERSON() ; @SINGULAR()\n" +
  "@2SG 0 = @2ND-PERSON() ; @SINGULAR()\n" +
  "@3SG 0 = @3RD-PERSON() ; @SINGULAR()\n" +
  "@1PL 0 = @1ST-PERSON() ; @PLURAL()\n" +
  "@2PL 0 = @2ND-PERSON() ; @PLURAL()\n" +
  "@3PL 0 = @3RD-PERSON() ; @PLURAL()\n" +
  "\n" +
  "@NO-TENSE 1 = ~ #1 {Tense=Past}; ~ #1 {Tense=Pres}; ~ #1 {Tense=Fut}; ~ #1 {Tense=Imp}; ~ #1 {Tense=Pqp}\n" +
  "\n" +
  "@et 1 = (e(#1) -o t(#1))\n" +
  "\n" +
  "@quant 2 = ((e(#1) -o p(#2)) -o p(#2))\n" +
  "\n" +
  "@INTRODUCE-DREF 1 = :INTR:*(#1)\n" +
  "@INTRODUCE-DREF-WITH-PREDICATE 2 = @INTRODUCE-DREF(#1), #2*(#1)\n" +
  "# @INTRODUCE-DREF-WITH-PREDICATE 2 = @INTRODUCE-DREF(#2), #1*(#2)\n" +
  "\n" +
  "@INTRODUCE-PERSON 1 = @INTRODUCE-DREF-WITH-PREDICATE(\"#1\" \"person\")\n" +
  "# @INTRODUCE-PERSON 1 = @INTRODUCE-DREF-WITH-PREDICATE(\"person\" \"#1\")\n" +
  "@INTRODUCE-ENTITY 1 = @INTRODUCE-DREF-WITH-PREDICATE(\"#1\" \"entity\")\n" +
  "\n" +
  "@gap-type-verbal-dep-mng 1 = \\V.\\X.\\F.V(\\E.(([], [#1(E,X)]) + F(E)))\n" +
  "\n" +
  "@gap-type-verbal-dep-type 2 = (x(#2) -o (e(#1) -o x(#2)))\n" +
  "\n" +
  "@gap-type-verbal-dep 1 = @gap-type-verbal-dep-mng(#1) : @gap-type-verbal-dep-type(\"!\" \"^\")\n" +
  "\n" +
  "@NEGATIVE 0 = Polarity=Neg\n" +
  "\n" +
  "# @AFFIRMATIVE 0 = (~Polarity=Neg | Polarity=Pos)\n" +
  "\n" +
  "@AFFIRMATIVE 0 = Polarity!=Neg; PronType!=Neg\n" +
  "\n" +
  "@POTENTIAL-PRO-DROP 0 = coarsePos = VERB; VerbForm = Fin; ~ ! gf {relation = @SUBJ() }\n" +
  "\n" +
  "@PRES-DRS 2 = (([],[PRESUPPOSITION(([#1],[:INTR:*(#1), time*(#1), EQ*(#1, `now`)])), Time*(#2,#1)]))\n" +
  "\n" +
  "@PAST-DRS 2 = (([],[PRESUPPOSITION(([#1],[:INTR:*(#1), time*(#1), TPR*(#1, `now`)])), Time*(#2,#1)]))\n" +
  "\n" +
  "@FUT-DRS 2 = (([],[PRESUPPOSITION(([#1],[:INTR:*(#1), time*(#1), TPR*(`now`,#1)])), Time*(#2,#1)]))\n" +
  "\n" +
  "@IMP-DRS 2 = (([],[PRESUPPOSITION(([#1],[:INTR:*(#1), time*(#1), TPR*(#1, `now`)])), Time*(#2,#1)]))\n" +
  "\n" +
  "@PQP-DRS 2 = (([],[PRESUPPOSITION(([#1],[:INTR:*(#1), time*(#1), TPR*(#1, `now`)])), Time*(#2,#1)]))\n" +
  "\n" +
  "# @TENSE-DRS 3 = ([#1],[time(#1), Time(#2,#1), #3])\n" +
  "# @PRES-DRS 2 = @TENSE-DRS(\"#1\" \"#2\" \"EQU(#1,`now`)\")\n" +
  "# @PAST-DRS 2 = @TENSE-DRS(\"#1\" \"#2\" \"TPR(#1,`now`)\")\n" +
  "# @FUT-DRS 2 = @TENSE-DRS(\"#1\" \"#2\" \"TPR(`now`,#1)\")\n" +
  "\n" +
  "# @NO-AUX 0 = ~ ! dep {relation = aux.*}\n" +
  "@NO-AUX 0 = ~ aux.* {}\n" +
  "\n" +
  "@PRONOUN 0 = coarsePos = PRON\n" +
  "\n" +
  "@1SG-PRONOUN-DRS-CONDS 1 = @INTRODUCE-PERSON(#1), EQ*(#1, `speaker`)\n" +
  "@1PL-PRONOUN-DRS-CONDS 1 = @INTRODUCE-PERSON(#1), Sub*(#1, `speaker`)\n" +
  "\n" +
  "@2SG-PRONOUN-DRS-CONDS 1 = @INTRODUCE-PERSON(#1), EQ*(#1, `speaker`)\n" +
  "@2PL-PRONOUN-DRS-CONDS 1 = @INTRODUCE-PERSON(#1), Sub*(#1, `speaker`)\n" +
  "\n" +
  "@3SG-PRONOUN-DRS-CONDS 2 = PRESUPPOSITION(([#2], [@INTRODUCE-DREF(\"#2\") #1*(#2)]))\n" +
  "# @3SG-PRONOUN-DRS-CONDS-NEUT 1 = @3SG-PRONOUN-DRS-CONDS(\"entity\" \"#1\")\n" +
  "\n" +
  "@1SG-PRONOUN-MEANING-CONSTRUCTOR 0 = \\P.(([X], [@1SG-PRONOUN-DRS-CONDS(\"X\")]) + P(X)) : @quant(\"!\" \"^\")\n" +
  "@1-PL-PRONOUN-MEANING-CONSTRUCTOR 0 = \\P.(([X], [@1PL-PRONOUN-DRS-CONDS(\"X\")]) + P(X)) : @quant(\"!\" \"^\")\n" +
  "@2-SG-PRONOUN-MEANING-CONSTRUCTOR 0 = \\P.(([X], [@2SG-PRONOUN-DRS-CONDS(\"X\")]) + P(X)) : @quant(\"!\" \"^\")\n" +
  "@2-PL-PRONOUN-MEANING-CONSTRUCTOR 0 = \\P.(([X], [@2PL-PRONOUN-DRS-CONDS(\"X\")]) + P(X)) : @quant(\"!\" \"^\")\n" +
  "@3-SG-PRONOUN-MEANING-CONSTRUCTOR 1 = \\P.(([],[@3SG-PRONOUN-DRS-CONDS(\"#1\" \"X\")]) + P(X)) : @quant(\"!\" \"^\")\n" +
  "@3-SG-PRONOUN-MEANING-CONSTRUCTOR-NEUT 0 = @3-SG-PRONOUN-MEANING-CONSTRUCTOR(\"entity\")\n" +
  "@3-SG-PRONOUN-MEANING-CONSTRUCTOR-MASC 0 = @3-SG-PRONOUN-MEANING-CONSTRUCTOR(\"male\")\n" +
  "@3-SG-PRONOUN-MEANING-CONSTRUCTOR-FEM 0 = @3-SG-PRONOUN-MEANING-CONSTRUCTOR(\"female\")\n" +
  "\n" +
  "@3RD-PERSON-PRONOUN 0 = @PRONOUN() ; ~ @PERSON(1); ~ @PERSON(2)\n" +
  "\n" +
  "@NO-GENDER 0 = ~ Gender = Masc; ~ Gender = Fem; ~ Gender = Neut\n" +
  "\n" +
  "@e-type-verbal-dep-mng 1 = \\Q.\\V.\\F.(Q(\\X.(V(\\E.(([], [#1(E,X)]) + F(E))))))\n" +
  "@e-type-verbal-dep-mng-inverse 1 = \\Q.\\V.\\F.(Q(\\X.(V(\\E.(([], [#1(X,E)]) + F(E))))))\n" +
  "\n" +
  "@e-type-verbal-dep-type 3 = (@quant(\"#1\" \"#2\") -o (x(#3) -o x(#3)))\n" +
  "\n" +
  "@e-type-verbal-dep 1 = @e-type-verbal-dep-mng(#1) : @e-type-verbal-dep-type(\"!\" \"%h\" \"^\")\n" +
  "@e-type-verbal-dep-inverse 1 = @e-type-verbal-dep-mng-inverse(#1) : @e-type-verbal-dep-type(\"!\" \"%h\" \"^\")\n" +
  "\n" +
  "@arg-scope 0 = ^\n" +
  "\n" +
  "@det-scope 0 = ^ ^\n";

const DEFAULT_CHOP_RULES = "! {PronType=Rel} -> \n" +
  "# Standalone NPs, e.g. headings, have a different structure from normal main clauses\n" +
  "relation = root; coarsePos = (NOUN|PROPN); ~ nsubj { } -> ([],[DUMMY]) : p(^)\n" +
  "# Standard goal for the main clause\n" +
  "relation = root  -> ([],[DUMMY]) : p(!)\n" +
  "# Appositions\n" +
  "relation = appos -> \\P.\\X.(([],[DUMMY_APPOSITION(X) ] ) + P(X)) : ((e(^) -o t(^)) -o (e(^) -o t(^)))\n" +
  "# Arguments are islands\n" +
  "relation = nsubj -> \\V.\\F.(V(\\E.(([X], [nsubj(E,X), DUMMY(X)]) + F(E)))) : (x(^) -o x(^))\n" +
  "relation = nsubj:pass -> \\V.\\F.(V(\\E.(([X], [nsubj_pass(E,X), DUMMY(X)]) + F(E)))) : (x(^) -o x(^))\n" +
  "relation = obj -> \\V.\\F.(V(\\E.(([X], [obj(E,X), DUMMY(X)]) + F(E)))) : (x(^) -o x(^))\n" +
  "relation = iobj -> \\V.\\F.(V(\\E.(([X], [iobj(E,X), DUMMY(X)]) + F(E)))) : (x(^) -o x(^))\n" +
  "relation = dep -> \\V.\\F.(V(\\E.(([X], [dep(E,X), DUMMY(X)]) + F(E)))) : (x(^) -o x(^))\n" +
  "relation = obl -> \\V.\\F.(V(\\E.(([X], [obl(E,X), DUMMY(X)]) + F(E)))) : (x(^) -o x(^))\n" +
  "relation = ccomp -> \\V.\\F.V(\\E.(([], [ccomp(E,DUMMY_PROPOSITION)]) + F(E))) : (x(^) -o x(^))\n" +
  "relation = xcomp -> \\V.\\F.V(\\E1.(([E,X],[DUMMY_VERB(E), xcomp(E1,E), nsubj(E,X)]) + F(E1))) : (x(^) -o x(^))\n" +
  "\n" +
  "# Other basic rels\n" +
  "relation = acl; coarsePos = VERB -> \\P.\\X.(P(X) + ([E],[DUMMY(E), Participant(E,X)])) : (@et(^) -o @et(^))\n" +
  "\n" +
  "## Coordinate structures\n" +
  "# roots and ccomps\n" +
  "relation = conj; coarsePos = VERB; ~ ^ {relation = amod}; ~ ^ {relation = xcomp}; ~ ^ {relation = advcl} -> \\U.\\F.(U(F) + ([G],[DUMMY_VERB(G)])) : (x(^) -o x(^))\n" +
  "# relation = conj; coarsePos = NOUN; ^ {relation = root}; ^ nsubj { } -> \\U.\\F.(U(F) + ([G],[DUMMY_PRED_NOUN(G)])) : (x(^) -o x(^))\n" +
  "relation = conj; coarsePos = ADJ; ~ ^ {relation = amod} -> \\U.\\F.(U(F) + ([G],[DUMMY_PRED_ADJ(G)])) : (x(^) -o x(^))\n" +
  "# xcomps\n" +
  "relation = conj; coarsePos = VERB; ^ {relation = xcomp} -> \\Q.\\X.\\E.((([E1],[DUMMY_VERB(E1), nsubj*(E1,X)]) + Q(X)(E))) : ((e(^) -o v(^) -o t(^)) -o e(^) -o v(^) -o t(^))\n" +
  "# amods\n" +
  "relation = conj; ^ {relation = amod} -> \\P.\\X.(([G],[DUMMY_ADJ(G), Attribute(X,G)]) + P(X)) : (@et(^ ^) -o @et(^ ^))\n" +
  "# advmods\n" +
  "relation = conj; ^ {relation = advmod} -> \\P.\\F.P(\\E(([X], [DUMMY_ADV(X), advmod(E,X)]) + F(E))) : (x(^ ^) -o x(^ ^))\n" +
  "# nmods\n" +
  "relation = conj; ^ {relation = nmod} -> \\P.\\X.(([Y],[DUMMY_NOUN(Y), nmod(X,Y)]) + P(X)) : (@et(^ ^) -o @et(^ ^))\n" +
  "# nmod:poss\n" +
  "relation = conj; ^ {relation = nmod:poss} -> \\P.\\X.(([Y],[DUMMY_NOUN(Y), poss(X,Y)]) + P(X)) : (@et(^ ^) -o @et(^ ^))\n" +
  "# advcls\n" +
  "relation = conj; ^ {relation = advcl} -> \\V.\\F.(V(\\E.(([X], [DUMMY_ADVCL(E,X)]) + F(E)))) : (x(^ ^) -o x(^ ^))\n" +
  "# obls\n" +
  "relation = conj; ! {relation = case}; ^ {relation = obl} -> \\V.\\F.(V(\\E.(([X], [obl(E,X), DUMMY(X)]) + F(E)))) : (x(^ ^) -o x(^ ^))\n" +
  "# NPs\n" +
  "# coarsePos = (PROPN|NOUN|PRON); relation = conj; ~ ! case {}; ^ { relation = @CORE-NOMINAL-REL } -> \\P.\\X.(([Z],[DUMMY(Z), Sub(X,Z)]) + P(X)) : (@et(%C) -o @et(%C))\n";

@Component({
  selector: 'app-editor',
  templateUrl: './editor.component.html',
  styleUrls: [
    '../../../node_modules/codemirror/lib/codemirror.css',
    './editor.component.css'
    ],
  encapsulation: ViewEncapsulation.None
})
export class EditorComponent implements AfterViewInit {
  @ViewChild('host') host: ElementRef;

  @Input() id: string;
  @Input() mode: string;
  @Input() rules: number;

  defaultWidth = '800px';
  defaultHeight = '300px';

  private codeMirror: CodeMirror.EditorFromTextArea;

  filename: string; // to hold the input filename


  ngAfterViewInit() {
    console.log("mode is " + this.mode);
    console.log("ngAfterViewInit called");
    console.log("Textarea element: ", this.host.nativeElement);

    this.codeMirror = CodeMirror.fromTextArea(this.host.nativeElement, {
      mode: this.mode,
      viewPortMargin: Infinity
    });

    if (this.rules == 1 ) {
      this.codeMirror.setValue(LIGER_DEFAULT_RULES);

    }

    else if (this.rules == 2 ) {
      this.codeMirror.setValue(DEFAULT_TEMPLATES);

    }

    else if (this.rules == 3 ) {
      this.codeMirror.setValue(DEFAULT_CHOP_RULES);
    }

    if (this.mode == "text")  {
      this.codeMirror.setValue(DEFAULT_TEST_SUITE);
    }


      this.codeMirror.setOption("lineNumbers", true);

    this.codeMirror.refresh();

  }


  updateContent(value: string): void {
    if (this.codeMirror) {
      this.codeMirror.setValue("");
      this.codeMirror.clearHistory();
      this.codeMirror.setValue(value);
    }
  }

  public getContent(): string {
    return this.codeMirror.getValue();
  }

  resizeToDefault(): void {
    this.codeMirror.setSize(this.defaultWidth, this.defaultHeight);
  }

  downloadFile(filename: string) {
    let content = this.codeMirror.getValue();
    let blob = new Blob([content], { type: 'text/plain' });
    let url = window.URL.createObjectURL(blob);

    // Create a link and programmatically click it:
    let link = document.createElement('a');
    link.href = url;
    link.download = filename || 'default.txt'; // If filename is not provided, use 'default.txt'
    link.click();

    // Remember to revoke the blob URL after a while to save memory:
    setTimeout(() => window.URL.revokeObjectURL(url), 10000);
  }


  }

