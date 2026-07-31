/**
 * Answer-checker regression suite.
 *   npx tsx src/scripts/test-answer-check.ts
 * Each case is [playerAnswer, correctAnswer, shouldBeAccepted].
 */
import { checkAnswerDetailed as c, phoneticKey } from '../lib/answer-check'
const cases: [string,string,boolean][] = [
  ['Abraham Lincoln','Abraham Lincoln',true],
  ['lincoln','Abraham Lincoln',true],
  ['what is Paris','Paris',true],
  ['Shakespear','Shakespeare',true],
  ['Neechee','Nietzsche',true],
  ['Eifel Tower','Eiffel Tower',true],
  ['the great gatsby','The Great Gatsby',true],
  ['Missisippi','Mississippi',true],
  ['Ghandi','Gandhi',true],
  ['Pythagorus','Pythagoras',true],
  ['5','five',true],
  ['NYC','New York City',true],
  ['eat','The Great Gatsby',false],
  ['gat','The Great Gatsby',false],
  ['Paris','London',false],
  ['dog','cat',false],
  ['France','Germany',false],
  ['graduation','commencement',false],
  ['car','automobile',false],
  ['RFK','Robert F. Kennedy',true],
  ['RFK','Robert Francis Kennedy',true],
  ['RFK','(Robert F.) Kennedy',true],
  ['JFK','John Fitzgerald Kennedy',true],
  ['FDR','Franklin Delano Roosevelt',true],
  ['MLK','Martin Luther King',true],
  ['Kennedy','(Robert F.) Kennedy',true],
  ['Robert F. Kennedy','(Robert F.) Kennedy',true],
  ['canines','dogs/canines',true],
  // initialism must not fire on unrelated short answers
  ['cat','Martin Luther King',false],
  ['abc','Alabama',false],
  ['USA','Robert F. Kennedy',false],
  ['MLK','Robert F. Kennedy',false],
  ['Ohio','Iowa',false],
]
let pass=0,fail=0
for (const [p,a,want] of cases) {
  const r = c(p,a); const ok = r.correct===want; ok?pass++:fail++
  console.log(`${ok?'PASS':'FAIL'}  "${p}" vs "${a}" -> ${r.correct} (${r.method})`)
}
console.log(`\n${pass} pass, ${fail} fail`)

console.log('\n--- phonetic keys ---')
for (const w of ['Neechee','Nietzsche','Shakespeare','Shakespear','Gandhi','Ghandi','knight','night','Philip','Fillip'])
  console.log(w.padEnd(14), '->', phoneticKey(w))

if (fail > 0) process.exitCode = 1
