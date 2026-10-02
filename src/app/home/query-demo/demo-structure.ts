/** The small f-structure the home page's query demo runs on: "Kim thinks that a dog barked."
 *  Hand-written in LiGER's upload format so the demo needs no grammar or parse. */

function fact(sourceNode: string, relationLabel: string, targetNode: string) {
  return {
    choiceVars: [{ choiceID: '1', propValue: 'true' }],
    sourceNode,
    relationLabel,
    targetNode,
    proj: 'f',
    projection: 'false',
  };
}

export const DEMO_SENTENCE = 'Kim thinks that a dog barked.';

export const DEMO_STRUCTURE = {
  id: 'home-query-demo',
  text: `'${DEMO_SENTENCE}'`,
  constraints: [
    fact('f0', 'PRED', "semform('think',1,[var(1),var(2)],[])"),
    fact('f0', 'SUBJ', 'f1'),
    fact('f0', 'COMP', 'f2'),
    fact('f0', 'TNS-ASP', 'f5'),
    fact('f5', 'TENSE', 'pres'),
    fact('f1', 'PRED', "semform('Kim',0,[],[])"),
    fact('f1', 'NTYPE', 'f6'),
    fact('f6', 'NSEM', 'f7'),
    fact('f7', 'PROPER', 'name'),
    fact('f2', 'PRED', "semform('bark',4,[var(3)],[])"),
    fact('f2', 'SUBJ', 'f3'),
    fact('f2', 'TNS-ASP', 'f8'),
    fact('f8', 'TENSE', 'past'),
    fact('f3', 'PRED', "semform('dog',3,[],[])"),
    fact('f3', 'NUM', 'sg'),
    fact('f3', 'SPEC', 'f4'),
    fact('f4', 'DET', 'f9'),
    fact('f9', 'PRED', "semform('a',2,[],[])"),
  ],
  annotations: [],
  choiceSpace: {},
};

export interface DemoQuery {
  label: string;
  query: string;
}

export const DEMO_QUERIES: DemoQuery[] = [
  { label: 'Subjects and their predicates', query: '#a SUBJ #b & #b PRED %p' },
  { label: 'Subject of an embedded clause', query: '#a COMP #b SUBJ #c' },
  { label: 'Past-tense clauses', query: '#a TNS-ASP #b TENSE past' },
  { label: 'Proper names', query: '#a NTYPE #b NSEM #c PROPER %x' },
  { label: 'Any grammatical function (hierarchy)', query: 'GF := SUBJ | OBJ | COMP .\n\n#a @GF #b' },
];
