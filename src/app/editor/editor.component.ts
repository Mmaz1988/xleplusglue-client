import { Component, ViewChild, ElementRef, AfterViewInit, Input, ViewEncapsulation } from '@angular/core';
import * as CodeMirror from 'codemirror';


CodeMirror.defineMode("liger", function() {
  return {
    token: function(stream,state) {
      if (stream.match("==>") ) {
        return "rule_separator";
      }

      else if (stream.match(/#[A-Za-z0-9]+/))
      {
        return "liger_node_var";
      }

      else if (stream.match(/%[A-Za-z0-9]+/)) {
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

const LIGER_DEFAULT_RULES = "--replace(true);\n" +
  "\n" +
  "#a TNS-ASP #b ==> #a SEM #c & #c TEMP-REF #d & #d T-REF 'undefined' & #c SIT #s.\n" +
  "#a PTYPE 'sem' ==> #a SEM #b & #b SIT #s.\n" +
  "\n" +
  "//Tier 1 rules\n" +
  "#a TNS-ASP #b TENSE 'past' & #a SEM #c TEMP-REF #d & #d T-REF 'undefined' ==>  #d T-REF 'past' & #d CHECK '-'.\n" +
  "#a TNS-ASP #b TENSE 'pres' & #a SEM #c TEMP-REF #d & #d T-REF 'undefined' ==>  #d T-REF 'pres' & #d CHECK '-'.\n" +
  "#a TNS-ASP #b TENSE 'fut' & #a SEM #c TEMP-REF #d & #d T-REF 'undefined' ==>  #d T-REF 'fut' & #d CHECK '-'.\n" +
  "\n" +
  "//#a TNS-ASP #b TENSE 'pres' & #a SEM #c ==> #c TEMP-REF #d & #d T-REF 'pres' & #d EVAL #e & #e TIME 'now'.\n" +
  "//#a TNS-ASP #b TENSE 'fut' & #a SEM #c ==> #c TEMP-REF #d & #d T-REF 'fut' & #d EVAL #e & #e TIME 'now'.\n" +
  "\n" +
  "//Tier 2 rules\n" +
  "//SOT rule\n" +
  "#a T-REF 'past' &\n" +
  "#a CHECK '-' &\n" +
  "#a ^(TEMP-REF>SEM>COMP) #b & #b !(SEM>TEMP-REF) #c T-REF 'past' ==> #a T-REF 'non-future' & #a CHECK '+' & #a EVAL #c.\n" +
  "\n" +
  "//Present counterfactual\n" +
  "#a T-REF 'past' &\n" +
  "#a CHECK '-' &\n" +
  "#a ^(TEMP-REF>SEM>OBJ>in_set>ADJUNCT) #b & #b VTYPE 'modal' &\n" +
  "#b !(SEM>TEMP-REF) #c T-REF 'pres' &\n" +
  "#c CHECK '-'\n" +
  "==> #a T-REF 'non-past' & #c CHECK '+' & #c EVAL #a.\n" +
  "\n" +
  "\n" +
  "//Relative tense rules\n" +
  "#a T-REF 'undefined' &\n" +
  "#a ^(TEMP-REF>SEM>XCOMP) #b & #b !(SEM>TEMP-REF) #c ==> #a EVAL #c.\n" +
  "\n" +
  "#a T-REF %a & %a != 'undefined' & #a CHECK '-' ==> #a EVAL #b.\n" +
  "\n" +
  "//Aspect rules\n" +
  "#a TNS-ASP #b PROG '+_' & #a SEM #c ==> #c VIEWPOINT #d & #d ASPECT 'impv' & #d A-RESTR 'ongoing'.\n" +
  "#a TNS-ASP #b PROG '-_' & #a SEM #c ==> #c VIEWPOINT #d & #d ASPECT 'undefined'.\n" +
  "#a TNS-ASP #b TENSE %x & #b PROG '-_' & #a SEM #c VIEWPOINT #d ASPECT 'undefined' ==> #d ASPECT 'prv' & #d A-RESTR 'bounded'.\n" +
  "#a TNS-ASP #b PERF '+_' & #a SEM #c ==> #c ASP-TENSE #d & #d A-REF 'past'.\n" +
  "\n" +
  "//Tier 2 aspect example\n" +
  "#a T-REF 'undefined' &\n" +
  "#a ^(TEMP-REF) #b ^(SEM>XCOMP) #c & #c !(SEM>TEMP-REF) #d EVAL #e &\n" +
  "#b VIEWPOINT #f ASPECT 'prv'\n" +
  "==>  #a T-REF 'future' & #a EVAL #d.\n" +
  "\n" +
  "//undefined FPS for transitive verbs\n" +
  "#a TNS-ASP #b & #a PRED %a & #a SEM #z  ==>\n" +
  "#z FPS #y & #y CHECK '+'.\n" +
  "\n" +
  "#a TNS-ASP #b & #a PRED %a & #a SEM #z & #a SUBJ #c & #a OBJ #d & strip(%a) == 'push' &\n" +
  "#z FPS #e & #e CHECK '+' ==>\n" +
  "#e CHECK '-' &\n" +
  "#e initP #f &\n" +
  "#f INIT #a &\n" +
  "#f I-SUBJ #c &\n" +
  "#e procP #g &\n" +
  "#g PROC #a &\n" +
  "#g P-SUBJ #d &\n" +
  "#e XP #h &\n" +
  "#h REF 'unspec' &\n" +
  "#h TYPE 'rheme'.\n" +
  "\n" +
  "#a TNS-ASP #b & #a PRED %a & #a SEM #z & #a SUBJ #c & #a OBJ #d & strip(%a) == 'bake' &\n" +
  "#z FPS #e & #e CHECK '+' ==>\n" +
  "#e CHECK '-' &\n" +
  "#e initP #f &\n" +
  "#f INIT #a &\n" +
  "#f I-SUBJ #c &\n" +
  "#e procP #g &\n" +
  "#g PROC #a &\n" +
  "#g P-SUBJ #c &\n" +
  "#e XP #h &\n" +
  "#h REF 'unspec' &\n" +
  "#h TYPE 'rheme'.\n" +
  "\n" +
  "#a TNS-ASP #b & #a PRED %a & #a SEM #z & #a SUBJ #c & #a OBJ #d & #a OBJ-TH #e & strip(%a) == 'give' &\n" +
  "#f FPS #g & #g CHECK '+' ==>\n" +
  "#g CHECK '-' &\n" +
  "#g initP #i &\n" +
  "#i INIT #a &\n" +
  "#i I-SUBJ #c &\n" +
  "#g procP #j &\n" +
  "#j PROC #a &\n" +
  "#j P-SUBJ 'undefined' &\n" +
  "#g resP #k &\n" +
  "#k RES #a &\n" +
  "#k R-SUBJ #d &\n" +
  "#g XP #l &\n" +
  "#l REF #e &\n" +
  "#l TYPE 'possession'.\n" +
  "\n" +
  "//Semantic interpretation\n" +
  "\n" +
  "//Semantic interpretation\n" +
  "//attributes without values can be used for existential constraints\n" +
  "#g NTYPE & #g PRED %g\n" +
  "==> #g SEM #i & #i GLUE strip(%g) : #i.\n" +
  "\n" +
  "//NP Quantifier -- Sem structure\n" +
  "#g ^(SPEC) #h & #g QUANT #i & #h SEM #l ==> #l VAR #j & #l RESTR #k & #l SIT #s.\n" +
  "#g ^(SPEC) #h & #g DET #i & #h SEM #l ==> #l VAR #j & #l RESTR #k & #l SIT #s.\n" +
  "\n" +
  "//relative clause (with who)\n" +
  "#a PRED %a & #a PRON-REL #b & #a SUBJ #b &\n" +
  "#a SEM #z & #b SEM #y &\n" +
  "#a ^(in_set>ADJUNCT) #c SEM #d VAR #e & #d RESTR #f & #d SIT #s\n" +
  "==> #y GLUE [/P_<e,t>.[/Q_<e,t>.[/x_e.(P(x) \\& Q(x))]]] : ((#e -o #f) -o ((#y -o #z) -o (#e -o #f))).\n" +
  "\n" +
  "//NP Quantifier instantiation\n" +
  "\n" +
  "//Universal quantifier\n" +
  "#g ^(SPEC) #h SEM #i VAR #j & #i RESTR #k & #i SIT #s &\n" +
  "#g QUANT #l PRED %l & %l == 'every' &\n" +
  "#h ^(%) #m SEM #n FPS #b & #n SIT #o\n" +
  "==> #i GLUE [/P_<e,<s,t>>.[/Q_<e,<s,t>>.[/s_s.Ax_e[P(x)(s) -> Q(x)(s)]]]] : ((#j -o (#s -o #k)) -o ((#i -o (#o -o #n)) -o (#o -o #n))).\n" +
  "\n" +
  "//Existential quantifier\n" +
  "#g ^(SPEC) #h SEM #i VAR #j & #i RESTR #k & #i SIT #s &\n" +
  "#g DET #l PRED %l & %l == 'a' &\n" +
  "#h ^(%) #m SEM #n FPS #b & #n SIT #o\n" +
  "==> #i GLUE [/P_<e,<s,t>>.[/Q_<e,<s,t>>.[/s_s.Ex_e[P(x)(s) \\& Q(x)(s)]]]] : ((#j -o (#s -o #k)) -o ((#i -o (#o -o #n)) -o (#o -o #n))).\n" +
  "\n" +
  "\n" +
  "#g ^(SPEC) #h SEM #i VAR #j & #i RESTR #k & #i SIT #s &\n" +
  "#g DET #l DET-TYPE 'def'\n" +
  "==> #i GLUE [/P_<e,<s,t>>.Ix_e[P(x)]] : ((#j -o (#s -o #k)) -o #i).\n" +
  "\n" +
  "//==> #i SIT #s & #i GLUE [/P_<e,<s,t>>.[/Q_<e,<s,t>>.[/s_s.the(P(x)(s),Q(x)(s))]]] : ((#j -o (#s -o #k)) -o ((#i -o (#o -o #n)) -o (#o -o #n))).\n" +
  "\n" +
  "\n" +
  "//predicates for Quantifiers\n" +
  "#g SEM #j VAR #i & #j RESTR #k & #j SIT #a & #g PRED %g ==> #a GLUE [/x_e.[/s_s.strip(%g)(x,s)]] : (#i -o (#a -o #k)).\n" +
  "\n" +
  "\n" +
  "//modification\n" +
  "#g SEM #j VAR #i & #j RESTR #k & #j SIT #l &\n" +
  "#g ADJUNCT #e in_set #h OBJ #m SEM #a  & #h SEM #b SIT #c\n" +
  "==> #h GLUE [/P_<e,<s,t>>.[/Q_<e,<s,t>>.[/x_e.[/s_s.(P(x)(s) \\& Q(x)(s))]]]] : ((#j -o (#c -o #b)) -o ((#i -o (#l -o #k)) -o (#i -o (#l -o #k)))) &\n" +
  " #e GLUE [/y_e.[/x_e.[/s_s.with(x,y,s)]]] : (#a -o (#j -o (#c -o #b))).\n" +
  "\n" +
  "//FPS rules\n" +
  "\n" +
  "#a SEM #z FPS #y CHECK '+' & #a PRED %a ==> #y EVENT #x & #x GLUE [/e_v.strip(%a)(e)] : (#x -o #y).\n" +
  "\n" +
  "#a XP #b REF 'unspec' & #b TYPE 'rheme' ==> #b GLUE y : #b.\n" +
  "\n" +
  "\n" +
  "//RES\n" +
  "#a XP #b &\n" +
  "#b REF #c &\n" +
  "#b TYPE 'possession' &\n" +
  "#a resP #d &\n" +
  "#d RES #e &\n" +
  "#d R-SUBJ #f ==>\n" +
  "#b GLUE [/x_e.[/y_e.[/e_v.(have(e) \\& (ag(e,x) \\& th(e,y)))]]] : (#f -o (#c -o (#e -o #b))) &\n" +
  "#d GLUE [/P_<e,<v,t>>.[/x_e.[/e_v.(res(e,x) \\& P(x)(e))]]] : ((#f -o (#e -o #b)) -o (#f -o (#e -o #d))).\n" +
  "\n" +
  "//PROC\n" +
  "#d SEM #z FPS #b procP #c PROC #d & #c P-SUBJ 'undefined' &\n" +
  "#b resP #g RES #d &\n" +
  "#b XP #f TYPE 'possession' & #f REF #j ==>\n" +
  "#c GLUE [/P_<v,t>.[/e_v.Ee1_v[Ee2_v[equals(e,to(e1,e2)) \\& (proc(e1) \\& P(e2))]]]] : ((#d -o #g) -o (#d -o #c)).\n" +
  "\n" +
  "#a SEM #z FPS #b procP #c PROC #d & #c P-SUBJ #e & #b XP #f TYPE 'rheme' ==>\n" +
  "#c GLUE [/y_s.[/x_e.[/e_v.proc(e,x,y)]]] : (#f -o (#e -o (#d -o #c))).\n" +
  "\n" +
  "\n" +
  "\n" +
  "//INIT\n" +
  "#a SEM #z FPS #b initP #c I-SUBJ #d & #c INIT #h & #b procP #e PROC #f ==>\n" +
  "#c GLUE [/P_<v,t>.[/x_e.[/e_v.Ee1_v[Ee2_v[equals(e,to(e1,e2)) \\& (init(e1,x) \\& P(e2))]]]]] : ((#f -o #e) -o (#d -o (#h -o #c))).\n" +
  "\n" +
  "#a SEM #z FPS #b initP #c I-SUBJ #d & #c INIT #h & #b procP #e PROC #f & #e P-SUBJ #d ==>\n" +
  "#c GLUE [/P_<e,<v,t>>.[/x_e.[/e_v.Ee1_v[Ee2_v[equals(e,to(e1,e2)) \\& (init(e1,x) \\& P(x)(e2))]]]]] : ((#d -o (#f -o #e)) -o (#d -o (#h -o #c))).\n" +
  "\n" +
  "\n" +
  "//Subcategorization for verbs\n" +
  "\n" +
  "//Transitive verbs -- Type A\n" +
  "#a SUBJ #b & #a OBJ #c & #a TNS-ASP #d & #a PRED %a &\n" +
  "#a SEM #z FPS #e procP #f P-SUBJ #c SEM #j &\n" +
  "#z SIT #y &\n" +
  "#e initP #h INIT #i & #h I-SUBJ #b SEM #k ==>\n" +
  "#e GLUE [/R_<e,<e,<v,t>>>.[/x_e.[/y_e.[/s_s.[/e_v.(partOf(e,s) \\& (strip(%a)(e) \\& (R(x)(y)(e) \\& (ag(e,x) \\& pt(e,y)))))]]]]] : ((#b -o (#c -o (#i -o #h))) -o (#k -o (#j -o (#y -o (#h -o #e))))).\n" +
  "\n" +
  "//Transitive verbs -- Type B\n" +
  "#a SUBJ #b & #a OBJ #c & #a TNS-ASP #d & #a PRED %a &\n" +
  "#a SEM #z FPS #e procP #f P-SUBJ #b SEM #j &\n" +
  "#z SIT #y &\n" +
  "#e initP #h INIT #i & #h I-SUBJ #b SEM #j &\n" +
  "#c SEM #k\n" +
  "==>\n" +
  "#e GLUE [/R_<e,<v,t>>.[/x_e.[/y_e.[/s_s.[/e_v.(partOf(e,s) \\& (strip(%a)(e) \\& (R(x)(e) \\& (ag(e,x) \\& pt(e,y)))))]]]]] : ((#b -o (#i -o #h)) -o (#j -o (#k -o (#y -o (#h -o #e))))).\n" +
  "\n" +
  "//Ditransitive verb\n" +
  "#a SUBJ #b & #a OBJ #c & #a OBJ-TH #d & #a PRED %a &\n" +
  "#d SEM #h &\n" +
  "#a SEM #z FPS #e resP #f R-SUBJ #c SEM #g &\n" +
  "#z SIT #y &\n" +
  "#e initP #k INIT #l & #k I-SUBJ #b SEM #m ==>\n" +
  "#e GLUE [/R_<e,<e,<e,<v,t>>>>.[/x_e.[/y_e.[/z_e.[/s_s.[/e_v.(partOf(e,s) \\& (strip(%a)(e) \\& (R(x)(y)(z)(e) \\& (ag(e,x) \\& (theme(e,z) \\& goal(e,y))))))]]]]]] : ((#b -o (#c -o (#d -o (#l -o #k)))) -o (#m -o (#g -o (#h -o (#y -o (#k -o #e)))))).\n" +
  "\n" +
  "\n" +
  "//intransitive ohne PFS\n" +
  "#a SUBJ #b SEM #c &\n" +
  "#a SEM #z FPS #f EVENT #y & #f CHECK '+' & #z SIT #x ==>\n" +
  "#f GLUE [/R_<v,t>.[/x_e.[/s_s.[/e_v.(R(e) \\& (partOf(e,s) \\& ag(e,x)))]]]] : ((#y -o #f) -o (#c -o (#x -o (#y -o #f)))).\n" +
  "\n" +
  "//transitive ohne FPS\n" +
  "#a SUBJ #b SEM #c & #a OBJ #d SEM #e &\n" +
  "#a SEM #z FPS #f EVENT #y & #f CHECK '+' & #z SIT #x ==>\n" +
  "#f GLUE [/R_<v,t>.[/x_e.[/y_e.[/s_s.[/e_v.(R(e) \\& (partOf(e,s) \\& (ag(e,x) \\& pt(e,y))))]]]]] : ((#y -o #f) -o (#c -o (#e -o (#x -o (#y -o #f))))).\n" +
  "\n" +
  "\n" +
  "\n" +
  "\n" +
  "//Verb template for comp verbs\n" +
  "#a SUBJ #b SEM #c &\n" +
  "#a SEM #j &\n" +
  "#a COMP #d SEM #e TEMP-REF #f EVAL #g T-REF %i &\n" +
  "#j FPS #h EVENT #i &\n" +
  "#j SIT #k\n" +
  " ==> #h GLUE [/R_<v,t>.[/P_<s,t>.[/x_e.[/s_s.[/e_v.(R(e) \\& (partOf(e,s) \\& (ag(e,x) \\& th(e,P(s)))))]]]]] : ((#i -o #h) -o ((#g -o #e) -o (#c -o (#k -o (#i -o #h))))).\n" +
  "\n" +
  "//XCOMP\n" +
  "//Verb template for comp verbs\n" +
  "#a SUBJ #b SEM #c &\n" +
  "#a SEM #j &\n" +
  "#a XCOMP #d SEM #e TEMP-REF #f EVAL #g T-REF %i &\n" +
  "#j FPS #h EVENT #i &\n" +
  "#j SIT #k\n" +
  " ==> #h GLUE [/R_<v,t>.[/P_<e,<s,t>>.[/x_e.[/s_s.[/e_v.(R(e) \\& (partOf(e,s) \\& (ag(e,x) \\& th(e,P(x)(s)))))]]]]] : ((#i -o #h) -o ((#c -o (#g -o #e)) -o (#c -o (#k -o (#i -o #h))))).\n" +
  "\n" +
  "//Bound-variable (cf) Conditional\n" +
  "\n" +
  "#a SEM #b TEMP-REF #c EVAL #d & #a VTYPE 'modal' &\n" +
  "#a !(ADJUNCT>in_set) #f PRED %a & strip(%a) == 'if' &\n" +
  "#f OBJ #g SEM #h TEMP-REF #i EVAL #j\n" +
  "==> #b COND #k & #k GLUE [/P_<s,t>.[/Q_<s,t>.[/s_s.(P(s) -> Q(s))]]]  : ((#j -o #h) -o ((#d -o #b) -o (#j -o #b))).\n" +
  "\n" +
  "#a SEM #b TEMP-REF #c EVAL #d & #a VTYPE 'main' &\n" +
  "#a !(ADJUNCT>in_set) #f PRED %a & strip(%a) == 'if' &\n" +
  "#f OBJ #g SEM #h TEMP-REF #i EVAL #j\n" +
  "==> #b COND #k & #k GLUE [/P_t.[/Q_t.(P -> Q)]]  : (#h -o (#b -o #k)).\n" +
  "\n" +
  "//modification\n" +
  "#g SEM #j SIT #l & #j FPS #o CHECK '+' & #o EVENT #p &\n" +
  "#g ADJUNCT #e in_set #h OBJ #m SEM #a  & #h SEM #b SIT #c\n" +
  "==> #h GLUE [/P_<v,t>.[/Q_<s,<v,t>>.[/s_s.[/e_v.(P(e) \\& Q(s)(e))]]]] : ((#p -o #b) -o ((#l -o (#p -o #o)) -o (#l -o (#p -o #o)))) &\n" +
  " #e GLUE [/y_e.[/e_v.with(e,y)]] : (#a -o (#p -o #b)).\n" +
  "\n" +
  "//Closure\n" +
  "#b FPS #c ==> #c CLOSURE #d.\n" +
  "#b FPS #c initP #d & #c CLOSURE #e & #b SIT #f ==> #e GLUE [/P_<s,<v,t>>.[/s_s.Ee_v[P(s)(e)]]] : ((#f -o (#d -o #c)) -o (#f -o #b)).\n" +
  "#b FPS #c CLOSURE #e & #c EVENT #z & #c CHECK '+' & #b SIT #f ==> #e GLUE [/P_<s,<v,t>>.[/s_s.Ee_v[P(s)(e)]]] : ((#f -o (#z -o #c)) -o (#f -o #b)).\n" +
  "\n" +
  "\n" +
  "\n" +
  "//Rules for interpreting grammatical aspect\n" +
  "#a SEM #b VIEWPOINT #c ==>\n" +
  "#c VAR #d & #c RESTR #e &\n" +
  "#c ASP-RESTR' #f.\n" +
  "\n" +
  "\n" +
  "#a SEM #b VIEWPOINT #c A-RESTR 'ongoing' &\n" +
  "#c VAR #d & #c RESTR #e &\n" +
  "#c ASP-RESTR' #f ==>\n" +
  "#f GLUE [/s_s.[/t_s.ongoing(t,s)]] : (#d -o (#e -o #c)).\n" +
  "\n" +
  "#a SEM #b VIEWPOINT #c A-RESTR 'bounded' &\n" +
  "#c VAR #d & #c RESTR #e &\n" +
  "#c ASP-RESTR' #f ==>\n" +
  "#f GLUE [/s_s.[/t_s.bounded(t,s)]] : (#d -o (#e -o #c)).\n" +
  "\n" +
  "\n" +
  "#a SEM #b VIEWPOINT #c ASPECT 'impv' &\n" +
  "#c VAR #d & #c RESTR #e &\n" +
  "#b TEMP-REF #f &\n" +
  "#b SIT #g\n" +
  " ==>  #c GLUE [/M_<s,<s,t>>.[/P_<s,t>.[/s_s.Az_s[M(s)(z) -> P(z)]]]] : ((#d -o (#e -o #c)) -o ((#g -o #b) -o (#f -o #b))).\n" +
  "\n" +
  "#a SEM #b VIEWPOINT #c ASPECT 'prv' &\n" +
  "#c VAR #d & #c RESTR #e &\n" +
  "#b TEMP-REF #f &\n" +
  "#b SIT #g\n" +
  " ==>  #c GLUE [/M_<s,<s,t>>.[/P_<s,t>.[/s_s.Ez_s[M(s)(z) \\& P(z)]]]] : ((#d -o (#e -o #c)) -o ((#g -o #b) -o (#f -o #b))).\n" +
  "\n" +
  "#a SEM #b VIEWPOINT #c ASPECT 'undefined' &\n" +
  "#b TEMP-REF #f &\n" +
  "#b SIT #g\n" +
  " ==>  #c GLUE [/P_<s,t>.[/s_s.P(s)]] : ((#g -o #b) -o (#f -o #b)).\n" +
  "\n" +
  "//Tense values\n" +
  "\n" +
  "//TODO make so that one tense restrictor works for both relative and absolute tenses\n" +
  "\n" +
  "//Past reference\n" +
  "#a SEM #b TEMP-REF #c T-REF 'past' & #c EVAL #d & #c CHECK '-' ==>\n" +
  "#c T-REF' #e & #e GLUE [/t_s.[/t2_s.before(t,t2)]] : (#c -o (#d -o #c)).\n" +
  "\n" +
  "#a SEM #b TEMP-REF #c T-REF 'past' & #c EVAL #d & #c CHECK '+' ==>\n" +
  "#c T-REF' #e & #e GLUE [/t_s.[/t2_s.before(t,t2)]] : (#c -o (#d -o #c)).\n" +
  "\n" +
  "//Aspectual tense\n" +
  "\n" +
  "#a SEM #b TEMP-REF #c EVAL #d &\n" +
  "#b ASP-TENSE #e A-REF 'past' &\n" +
  " ==>\n" +
  "#e A-REF' #f & #f GLUE [/t_s.[/t2_s.before(t,t2)]] :(#e -o (#c -o #e)) .\n" +
  "\n" +
  "//Present reference\n" +
  "#a SEM #b TEMP-REF #c T-REF 'pres' & #c EVAL #d & #c CHECK '-' ==>\n" +
  "#c T-REF' #e & #e GLUE [/t_s.[/t2_s.overlap(t,t2)]] : (#c -o (#d -o #c)).\n" +
  "\n" +
  "#a SEM #b TEMP-REF #c T-REF 'pres' & #c EVAL #d & #c CHECK '+' ==>\n" +
  "#c T-REF' #e & #e GLUE [/t_s.[/t2_s.overlap(t,t2)]] : (#c -o (#d -o #c)).\n" +
  "\n" +
  "//Non-future\n" +
  "#a SEM #b TEMP-REF #c T-REF 'non-future' & #c EVAL #d & #c CHECK '-' ==>\n" +
  "#c T-REF' #e & #e GLUE {[/t_s.[/t2_s.before(t,t2)]],[/t_s.[/t2_s.overlap(t,t2)]]} : (#c -o (#d -o #c)).\n" +
  "\n" +
  "#a SEM #b TEMP-REF #c T-REF 'non-future' & #c EVAL #d T-REF %a ==>\n" +
  "#c T-REF' #e & #e GLUE {[/t_s.[/t2_s.before(t,t2)]],[/t_s.[/t2_s.overlap(t,t2)]]} : (#c -o (#d -o #c)).\n" +
  "\n" +
  "//Non-past\n" +
  "#a SEM #b TEMP-REF #c T-REF 'non-past' & #c EVAL #d & #c CHECK '-' ==>\n" +
  "#c T-REF' #e & #e GLUE {[/t_s.[/t2_s.after(t,t2)]],[/t_s.[/t2_s.overlap(t,t2)]]} : (#c -o (#d -o #c)).\n" +
  "\n" +
  "#a SEM #b TEMP-REF #c T-REF 'non-past' & #c EVAL #d T-REF %a ==>\n" +
  "#c T-REF' #e & #e GLUE {[/t_s.[/t2_s.after(t,t2)]],[/t_s.[/t2_s.overlap(t,t2)]]} : (#c -o (#d -o #c)).\n" +
  "\n" +
  "//Future reference\n" +
  "#a SEM #b TEMP-REF #c T-REF 'future' & #c EVAL #d & #c CHECK '-' ==>\n" +
  "#c T-REF' #e & #e GLUE [/t_s.[/t2_s.after(t,t2)]] : (#c -o (#d -o #c)).\n" +
  "\n" +
  "#a SEM #b TEMP-REF #c T-REF 'future' & #c EVAL #d T-REF %a ==>\n" +
  "#c T-REF' #e & #e GLUE [/t_s.[/t2_s.after(t,t2)]] : (#c -o (#d -o #c)).\n" +
  "\n" +
  "\n" +
  "//absolute tense closure\n" +
  "#a SEM #b TEMP-REF #c T-REF %a & %a != 'undefined' & #c EVAL #d & #c CHECK '-'\n" +
  "==> #c GLUE [/T_<s,<s,t>>.[/P_<s,t>.[/s_s.Er_s[T(r)(s) \\& P(r)]]]] : ((#c -o (#d -o #c)) -o ((#c -o #b) -o (#d -o #b))).\n" +
  "\n" +
  "//relative tense closure\n" +
  "#a SEM #b TEMP-REF #c T-REF %a & %a != 'undefined' & #c EVAL #d T-REF %b\n" +
  "==> #c GLUE [/T_<s,<s,t>>.[/P_<s,t>.[/s_s.Er_s[T(r)(s) \\& P(r)]]]] : ((#c -o (#d -o #c)) -o ((#c -o #b) -o (#d -o #b))).\n" +
  "\n" +
  "//aspectual tense closure\n" +
  "#a SEM #b ASP-TENSE #c A-REF %a &\n" +
  "#b TEMP-REF #e &\n" +
  " %a != 'undefined'\n" +
  "==> #c GLUE [/T_<s,<s,t>>.[/P_<s,t>.[/s_s.Er_s[T(r)(s) \\& P(r)]]]] : ((#c -o (#e -o #c)) -o ((#e -o #b) -o (#e -o #b))).\n" +
  "\n" +
  "//unspec absolute closure\n" +
  "#a SEM #b TEMP-REF #c T-REF %a & %a == 'undefined' & #c EVAL #d & #c CHECK '-'\n" +
  "==> #c GLUE [/P_<s,t>.[/s_s.P(s)]] : ((#c -o #b) -o (#d -o #b)).\n" +
  "\n" +
  "//unspec relative closure\n" +
  "#a SEM #b TEMP-REF #c T-REF %a & %a == 'undefined' & #c EVAL #d T-REF %b\n" +
  "==> #c GLUE [/P_<s,t>.[/s_s.P(s)]] : ((#c -o #b) -o (#d -o #b)).\n" +
  "\n" +
  "\n" +
  "\n" +
  "//#a SEM #b TEMP-REF #c T-REF 'pres' & #c EVAL #d ==> #c GLUE [/P_<s,t>.[/s_s.Er_s[equals(r,s) \\& P(r)]]] : ((#c -o #b) -o (#d -o #b)).\n" +
  "\n" +
  "// #a SEM #b ASP-TENSE #c A-REF 'past' & #b TEMP-REF #d ==>  #c GLUE [/P_<s,t>.[/s_s.Er_s[before(r,s) \\& P(r)]]] : ((#d -o #b) -o (#d -o #b)).\n" +
  "\n" +
  "#a SEM #b ASP-TENSE #c A-REF 'undefined' & #b TEMP-REF #d ==>  #c GLUE [/P_<s,t>.[/s_s.P(s)]] : ((#d -o #b) -o (#d -o #b)).\n" +
  "\n" +
  "#a EVAL #b & #a CHECK '-' ==> #b GLUE now : #b.\n" +
  "\n" +
  "\n";

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

  defaultWidth = '800px';
  defaultHeight = '300px';

  private codeMirror: CodeMirror.EditorFromTextArea;

  filename: string; // to hold the input filename


  ngAfterViewInit() {
    console.log("mode is " + this.mode);

    this.codeMirror = CodeMirror.fromTextArea(this.host.nativeElement, {
      mode: this.mode,
      viewPortMargin: Infinity
    });

    if (this.mode == "liger") {
      this.codeMirror.setValue(LIGER_DEFAULT_RULES);
      this.codeMirror.setOption("lineNumbers", true);
    }

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

