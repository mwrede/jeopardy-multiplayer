/**
 * CSV import regression suite.
 *   npx tsx src/scripts/test-csv-board.ts
 * One case per shape of file people actually turn up with.
 */
import { parseBoardCsv, boardToCsv, CSV_TEMPLATE } from '../lib/csv-board'

let pass = 0
let fail = 0

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

function cell(r: ReturnType<typeof parseBoardCsv>, round: number, cat: number, row: number) {
  const c = r.board.rounds[round].categories[cat].clues[row]
  return [c.question, c.answer, c.value]
}

/* 1. The long format, exactly as the template describes it. */
{
  const r = parseBoardCsv(CSV_TEMPLATE, { fileName: 'template.csv' })
  check('long/layout', r.layout, 'long')
  check('long/not swapped', r.swapped, false)
  check('long/rounds', r.board.rounds.length, 2)
  check('long/round1 cats', r.board.rounds[0].categories.map((c) => c.name), ['WORLD CAPITALS', 'MOVIE QUOTES'])
  check('long/values', r.board.rounds[0].categories[0].clues.map((c) => c.value), [200, 400, 600])
  check('long/first clue', cell(r, 0, 0, 0)[1], 'Paris')
  check('long/quoted comma survives', cell(r, 0, 0, 1)[0], "Chile's capital, in a valley under the Andes")
  check('long/escaped quotes survive', cell(r, 0, 1, 0)[0], '"Here\'s looking at you, kid" ends this 1942 film')
  check('long/daily double', r.stats.dailyDoubles, 1)
  check('long/dj values', r.board.rounds[1].categories[0].clues.map((c) => c.value), [400, 800])
  check('long/final', r.board.finalJeopardy?.categoryName, 'AMERICAN HISTORY')
  check('long/no blanks', r.stats.blanks, 0)
}

/* 2. Headers in a different order, oddly named, with extra columns, a title
      line above the header, and a section heading between the rounds. */
{
  const csv = [
    'Our Office Party Game,,,,',
    'Clue Text,Correct Response,Category Name,Value ($),Notes,DD?',
    'Founded Rome in 753 BC per legend,Romulus,ANCIENT STUFF,$200,ignore me,',
    'The Rosetta Stone language,Greek,ANCIENT STUFF,"$1,000",,yes',
    'Double Jeopardy,,,,,',
    'Number of bones in an adult human,206,BODY,$400,,',
  ].join('\n')
  const r = parseBoardCsv(csv, { fileName: 'party.csv' })
  check('reordered/layout', r.layout, 'long')
  check('reordered/title from preamble is ignored for header', r.board.rounds[0].categories[0].name, 'ANCIENT STUFF')
  check('reordered/comma money', r.board.rounds[0].categories[0].clues.map((c) => c.value), [200, 1000])
  check('reordered/dd flag', r.board.rounds[0].categories[0].clues[1].isDailyDouble, true)
  check('reordered/section heading switched rounds', r.board.rounds.length, 2)
  check('reordered/dj clue', cell(r, 1, 0, 0)[0], 'Number of bones in an adult human')
}

/* 3. J-Archive's convention: the "answer" column holds the clue. */
{
  const csv = [
    'round,category,value,answer,question',
    '1,POTPOURRI,200,"This planet is known as the red planet",What is Mars?',
    '1,POTPOURRI,400,"He wrote ""Hamlet"" and ""Macbeth"" around the turn of the 17th century",Who is Shakespeare?',
    '2,SCIENCE,400,"The process by which plants convert sunlight into chemical energy",What is photosynthesis?',
  ].join('\n')
  const r = parseBoardCsv(csv, { fileName: 'jarchive.csv' })
  check('swapped/detected', r.swapped, true)
  check('swapped/clue is the long text', cell(r, 0, 0, 0)[0], 'This planet is known as the red planet')
  check('swapped/answer is the response', cell(r, 0, 0, 0)[1], 'What is Mars?')
  check('swapped/warned', r.warnings.some((w) => w.includes('other way round')), true)

  const forced = parseBoardCsv(csv, { fileName: 'jarchive.csv', swap: false })
  check('swapped/override honoured', cell(forced, 0, 0, 0)[0], 'What is Mars?')
}

/* 4. Tab-separated, as pasted straight out of Excel. */
{
  const csv = ['Category\tValue\tClue\tAnswer', 'MATH\t200\tTwo plus two\t4', 'MATH\t400\tThe square root of 81\t9'].join('\n')
  const r = parseBoardCsv(csv, { fileName: 'pasted.tsv' })
  check('tabs/parsed', r.stats.clues, 2)
  check('tabs/values', r.board.rounds[0].categories[0].clues.map((c) => c.value), [200, 400])
}

/* 5. The pairs layout: a category per row, clue/answer across. */
{
  const csv = [
    'Category,Clue 1,Answer 1,Clue 2,Answer 2,Clue 3,Answer 3',
    'TV THEMES,"Smelly cat, smelly cat",Friends,A tossed salad and scrambled eggs,Frasier,Those were the days,All in the Family',
    'US STATES,The Beaver State,Oregon,The Show Me State,Missouri,,',
  ].join('\n')
  const r = parseBoardCsv(csv, { fileName: 'pairs.csv' })
  check('pairs/layout', r.layout, 'pairs')
  check('pairs/cats', r.board.rounds[0].categories.map((c) => c.name), ['TV THEMES', 'US STATES'])
  check('pairs/ladder', r.board.rounds[0].categories[0].clues.map((c) => c.value), [200, 400, 600])
  check('pairs/clue', cell(r, 0, 0, 1)[0], 'A tossed salad and scrambled eggs')
  check('pairs/answer', cell(r, 0, 1, 0)[1], 'Oregon')
  check('pairs/gap stays blank', cell(r, 0, 1, 2), ['', '', 600])
}

/* 6. The pairs layout with dollar values in the headers and no numbering. */
{
  const csv = [
    'Category,$200 Clue,$200 Answer,$400 Clue,$400 Answer',
    'FRUIT,A yellow curved fruit,Banana,Keeps the doctor away,Apple',
  ].join('\n')
  const r = parseBoardCsv(csv, { fileName: 'money-pairs.csv' })
  check('pairs$/layout', r.layout, 'pairs')
  check('pairs$/values from headers', r.board.rounds[0].categories[0].clues.map((c) => c.value), [200, 400])
}

/* 7. The hand-made grid: money across the top, categories down the side. */
{
  const csv = [
    'Category,$200,$400,$600',
    'GEOGRAPHY,Longest river in Africa | The Nile,Smallest country | Vatican City,Deepest lake | Lake Baikal',
    'ANIMALS,Fastest land animal | Cheetah,A group of crows | A murder,',
  ].join('\n')
  const r = parseBoardCsv(csv, { fileName: 'grid.csv' })
  check('grid/layout', r.layout, 'grid')
  check('grid/values', r.board.rounds[0].categories[0].clues.map((c) => c.value), [200, 400, 600])
  check('grid/clue', cell(r, 0, 0, 0)[0], 'Longest river in Africa')
  check('grid/answer', cell(r, 0, 0, 0)[1], 'The Nile')
  check('grid/never swaps', r.swapped, false)
  check('grid/ragged row blank', cell(r, 0, 1, 2), ['', '', 600])
}

/* 8. The same grid transposed: categories across the top, money down. */
{
  const csv = [
    ',HISTORY,SPORTS',
    '$200,Year WWII ended | 1945,Hoop count in basketball | Two',
    '$400,Signed the Declaration first | John Hancock,Innings in a baseball game | Nine',
  ].join('\n')
  const r = parseBoardCsv(csv, { fileName: 'transposed.csv' })
  check('transposed/layout', r.layout, 'grid')
  check('transposed/cats', r.board.rounds[0].categories.map((c) => c.name), ['HISTORY', 'SPORTS'])
  check('transposed/values', r.board.rounds[0].categories[0].clues.map((c) => c.value), [200, 400])
  check('transposed/answer', cell(r, 0, 1, 1)[1], 'Nine')
}

/* 9. No header row at all — columns read by their contents. */
{
  const csv = [
    'SPACE,200,"The closest star to Earth",The Sun',
    'SPACE,400,"The largest planet in the solar system",Jupiter',
    'SPACE,600,"The number of moons orbiting Mars",Two',
  ].join('\n')
  const r = parseBoardCsv(csv, { fileName: 'headerless.csv' })
  check('headerless/clues', r.stats.clues, 3)
  check('headerless/category', r.board.rounds[0].categories[0].name, 'SPACE')
  check('headerless/values', r.board.rounds[0].categories[0].clues.map((c) => c.value), [200, 400, 600])
  check('headerless/clue text', cell(r, 0, 0, 0)[0], 'The closest star to Earth')
  check('headerless/warned', r.warnings.some((w) => w.includes('No header row')), true)
}

/* 10. No values anywhere — the ladder fills in. */
{
  const csv = ['category,clue,answer', 'DOGS,Smallest AKC breed,Chihuahua', 'DOGS,Breed from Siberia that pulls sleds,Husky'].join('\n')
  const r = parseBoardCsv(csv, { fileName: 'no-values.csv' })
  check('ladder/values', r.board.rounds[0].categories[0].clues.map((c) => c.value), [200, 400])
  check('ladder/warned', r.warnings.some((w) => w.includes('standard ladder')), true)
}

/* 11. Titles: from a column, then the file name. */
{
  const withCol = parseBoardCsv('title,category,clue,answer\nFriday Night Trivia,MISC,A clue,An answer', { fileName: 'x.csv' })
  check('title/from column', withCol.title, 'Friday Night Trivia')
  const fromFile = parseBoardCsv('category,clue,answer\nMISC,A clue here,An answer', { fileName: 'family-trivia-2026.csv' })
  check('title/from file name', fromFile.title, 'Family trivia 2026')
}

/* 12. Only a Double Jeopardy round — loaded as the first round. */
{
  const r = parseBoardCsv('round,category,value,clue,answer\nDJ,OPERA,400,Verdi opera set in Egypt,Aida', { fileName: 'dj.csv' })
  check('dj-only/one round', r.board.rounds.length, 1)
  check('dj-only/warned', r.warnings.some((w) => w.includes('only had a Double Jeopardy')), true)
}

/* 13. Oversized files get trimmed, loudly. */
{
  const rows = ['category,value,clue,answer']
  for (let c = 0; c < 15; c++) for (let v = 0; v < 12; v++) rows.push(`CAT ${c},${(v + 1) * 100},Clue ${c}-${v} with some length to it,Answer ${v}`)
  const r = parseBoardCsv(rows.join('\n'), { fileName: 'huge.csv' })
  check('cap/categories', r.board.rounds[0].categories.length, 12)
  check('cap/rows', r.board.rounds[0].categories[0].clues.length, 10)
  check('cap/warned cats', r.warnings.some((w) => w.includes('kept the first 12')), true)
  check('cap/warned rows', r.warnings.some((w) => w.includes('kept the first 10')), true)
}

/* 14. Two clues at the same value in one category move to the next free row. */
{
  const csv = ['category,value,clue,answer', 'A,200,First clue text here,One', 'A,200,Second clue text here,Two', 'A,400,Third clue text here,Three'].join('\n')
  const r = parseBoardCsv(csv, { fileName: 'dupes.csv' })
  check('collide/kept all three', r.stats.clues, 3)
  check('collide/warned', r.warnings.some((w) => w.includes('shared a slot')), true)
}

/* 15. Daily Doubles, however the file marks them. */
{
  const csv = [
    'round,category,value,clue,answer',
    '1,OPERA,"DD: $1,000",Verdi opera set in ancient Egypt,Aida',
    '1,OPERA,400,[DD] This Puccini heroine dies of consumption,Mimi',
    '1,OPERA,600,A normal clue with no marker at all,Carmen',
  ].join('\n')
  const r = parseBoardCsv(csv, { fileName: 'dd.csv' })
  const clues = r.board.rounds[0].categories[0].clues
  check('dd/value-column marker', clues.find((c) => c.value === 1000)?.isDailyDouble, true)
  check('dd/clue-text marker', clues.find((c) => c.value === 400)?.isDailyDouble, true)
  check('dd/marker stripped from clue', clues.find((c) => c.value === 400)?.question, 'This Puccini heroine dies of consumption')
  check('dd/plain clue untouched', clues.find((c) => c.value === 600)?.isDailyDouble, false)
  check('dd/counted', r.stats.dailyDoubles, 2)
}

/* 16. Round trip: a board out as CSV comes back the same. */
{
  const a = parseBoardCsv(CSV_TEMPLATE, { fileName: 't.csv' })
  const b = parseBoardCsv(boardToCsv(a.title, a.board), { fileName: 't.csv' })
  check('roundtrip/board matches', b.board, a.board)
}

/* 17. Garbage in, a useful complaint out. */
{
  for (const [name, text] of [
    ['empty', ''],
    ['prose', 'Here are some trivia questions I wrote last night for the party.'],
  ] as const) {
    let msg = ''
    try {
      parseBoardCsv(text, { fileName: `${name}.csv` })
    } catch (e: any) {
      msg = e.message
    }
    check(`reject/${name}`, msg.length > 0, true)
    if (msg) console.log(`        → ${msg}`)
  }
}

console.log(`\n${pass} pass, ${fail} fail`)
if (fail > 0) process.exitCode = 1
