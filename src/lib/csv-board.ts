/**
 * CSV import — a board out of whatever spreadsheet somebody already has.
 *
 * People turn up with clues they wrote in Google Sheets or exported from some
 * other trivia tool, and no two of those files are shaped alike. Rather than
 * publish one format and reject everything else, this reads the three shapes
 * that actually show up:
 *
 *   long    one clue per row, columns named in any order and any extras
 *           ignored:  round, category, value, clue, answer, daily double
 *   pairs   one category per row, clue/answer columns running across:
 *           Category, Clue 1, Answer 1, Clue 2, Answer 2, …
 *   grid    the hand-made sheet — money down one axis, categories down the
 *           other, each cell holding "clue | answer"
 *
 * Every assumption it had to make comes back in `warnings`, so the author can
 * see what it did before any of it lands in the editor.
 *
 * One quirk worth knowing: in the show's own language the CLUE is the "answer"
 * and the response is the "question", and anything derived from J-Archive
 * keeps that convention. So a file with both columns may have them the
 * opposite way round from what the words suggest. `swapped` records which way
 * this file was read, and the importer offers a toggle — the heuristic (the
 * clue is the longer of the two) is a good guess, not a fact.
 */

import type { CustomBoard, CustomCategory, CustomRound } from '@/types/game'

/** Which shape the file turned out to be. Shown in the preview. */
export type CsvLayout = 'long' | 'pairs' | 'grid'

export interface CsvImportStats {
  categories: number
  /** Cells with a clue or an answer in them. */
  clues: number
  /** Cells left empty — the board is playable with gaps, but worth showing. */
  blanks: number
  dailyDoubles: number
  rounds: number
  hasFinal: boolean
}

export interface CsvImportResult {
  title: string
  board: CustomBoard
  layout: CsvLayout
  /** True when the file's "answer" column held the clue (show-style files). */
  swapped: boolean
  warnings: string[]
  stats: CsvImportStats
}

/** Past these the editor grid stops being a board and starts being a wall. */
export const MAX_CATEGORIES = 12
export const MAX_ROWS = 10
const MAX_DATA_ROWS = 5000

/* ------------------------------------------------------------------ *
 * Reading the file
 * ------------------------------------------------------------------ */

/**
 * RFC4180-ish reader: quoted fields, "" escapes, newlines inside quotes, and
 * CRLF / CR / LF line endings all handled. Written out rather than pulled from
 * a package because it's the only CSV in the app and this is 30 lines.
 */
export function parseDelimited(text: string, delim: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"' && field.trim() === '') { quoted = true; field = ''; i++; continue }
    if (ch === delim) { row.push(field); field = ''; i++; continue }
    if (ch === '\r' || ch === '\n') {
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1
      row.push(field); rows.push(row); row = []; field = ''
      continue
    }
    field += ch; i++
  }
  row.push(field)
  rows.push(row)
  return rows.map((r) => r.map((c) => c.trim()))
}

/**
 * Pick the delimiter by actually parsing with each candidate and seeing which
 * one yields a consistent table. Tabs matter: a sheet copied out of Excel and
 * pasted into the box is tab-separated, not comma-separated.
 *
 * Pipe is deliberately not a candidate — it's the in-cell clue/answer
 * separator the grid layout uses.
 */
function pickDelimiter(text: string): string {
  const sample = text.slice(0, 20000)
  let best = ','
  let bestScore = -1
  for (const d of [',', '\t', ';']) {
    const rows = parseDelimited(sample, d).filter((r) => r.some((c) => c !== ''))
    if (!rows.length) continue
    const counts = new Map<number, number>()
    for (const r of rows) counts.set(r.length, (counts.get(r.length) || 0) + 1)
    let modal = 1
    let modalN = 0
    for (const [len, n] of counts) if (n > modalN || (n === modalN && len > modal)) { modal = len; modalN = n }
    if (modal < 2) continue
    // Reward both regularity and width: a 6-column file that parses cleanly
    // beats a 2-column one that also parses cleanly.
    const score = (modalN / rows.length) * Math.min(modal, 12)
    if (score > bestScore) { bestScore = score; best = d }
  }
  return best
}

/* ------------------------------------------------------------------ *
 * Column names
 * ------------------------------------------------------------------ */

type Field = 'round' | 'category' | 'value' | 'question' | 'answer' | 'dailyDouble' | 'order' | 'title'

const HEADER_PATTERNS: Array<[Field, RegExp]> = [
  ['round', /^(round|rnd|r|game round|jeopardy round)$/],
  ['category', /^(category|categories|cat|topic|subject|category name|column|heading)$/],
  ['value', /^(value|values|point|points|amount|dollar|dollars|price|clue value|money|\$)$/],
  ['question', /^(question|q|clue|clue text|prompt|front|text|body|clue question)$/],
  ['answer', /^(answer|a|response|correct response|correct answer|answers|solution|back)$/],
  ['dailyDouble', /^(daily double|dd|is daily double|double|wager)$/],
  ['order', /^(order|row|position|index|clue number|clue no|clue #|#|slot)$/],
  ['title', /^(title|game|game title|board|board title|game name|name)$/],
]

/** Headers in the wild: "Clue_Text", "DAILY DOUBLE?", "Value ($)". */
function normHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[_\-.]+/g, ' ')
    .replace(/[?:*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function fieldFor(header: string): Field | null {
  const h = normHeader(header)
  if (!h) return null
  for (const [field, re] of HEADER_PATTERNS) if (re.test(h)) return field
  return null
}

/**
 * The pairs layout's across-columns, numbered or priced, with the value on
 * either side of the word: "Clue 1", "Question 3", "$400 clue", "Answer 400".
 */
const CLUE_COL = /^\$?\d*\s*(clue|question|q)\s*\$?\d*$/
const ANSWER_COL = /^\$?\d*\s*(answer|response|a)\s*\$?\d*$/

interface HeaderScan {
  index: number
  map: Partial<Record<Field, number>>
  clueCols: number[]
  answerCols: number[]
  score: number
}

/** The header is usually row 0, but files often carry a title line above it. */
function findHeader(rows: string[][]): HeaderScan | null {
  let best: HeaderScan | null = null
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i]
    if (row.filter((c) => c !== '').length < 2) continue
    const map: Partial<Record<Field, number>> = {}
    const clueCols: number[] = []
    const answerCols: number[] = []
    row.forEach((cell, ci) => {
      const h = normHeader(cell)
      if (CLUE_COL.test(h)) clueCols.push(ci)
      if (ANSWER_COL.test(h)) answerCols.push(ci)
      const f = fieldFor(cell)
      if (f && map[f] === undefined) map[f] = ci
    })
    const score = Object.keys(map).length + (clueCols.length > 1 ? clueCols.length : 0)
    if (score >= 2 && (!best || score > best.score)) best = { index: i, map, clueCols, answerCols, score }
  }
  return best
}

/* ------------------------------------------------------------------ *
 * Cell values
 * ------------------------------------------------------------------ */

/** "$1,200" → 1200. "DD: $2000" → 2000, and flags the Daily Double. */
function normValue(raw: string): { value?: number; dd: boolean } {
  if (!raw) return { dd: false }
  const dd = /\bdd\b|daily\s*double/i.test(raw)
  const m = raw.replace(/,/g, '').match(/\d+(\.\d+)?/)
  const n = m ? Math.round(parseFloat(m[0])) : NaN
  return { value: Number.isFinite(n) ? n : undefined, dd }
}

function isMoneyish(raw: string): boolean {
  if (!raw) return false
  return /^\$?\s*\d{1,3}(,?\d{3})*(\.\d+)?\s*$/.test(raw.trim())
}

/** Round labels come as 1/2/3, J/DJ/FJ, or the names spelled out. */
function normRound(raw: string): 1 | 2 | 'final' | null {
  const s = normHeader(raw)
  if (!s) return null
  if (/final|^fj$|^f$|^3$|tiebreak/.test(s)) return 'final'
  if (/double|^dj$|^d$|^2$|^two$/.test(s)) return 2
  if (/jeopardy|^j$|^1$|^one$|single|first/.test(s)) return 1
  return null
}

const TRUTHY = /^(true|t|yes|y|1|x|dd|daily double|✓|✔)$/i

/**
 * Daily Doubles are marked every which way: a column of their own, "DD:" in
 * front of the dollar value (how J-Archive writes it), or "[DD]" stuck on the
 * front of the clue itself. The last one would otherwise be read aloud to the
 * room as part of the clue.
 */
const DD_PREFIX = /^\s*[[(*]?\s*(dd|daily\s*double)\s*[:)\]*-]+\s*/i

function stripDailyDoubleMark(text: string): { text: string; dd: boolean } {
  const m = DD_PREFIX.exec(text)
  if (!m) return { text, dd: false }
  return { text: text.slice(m[0].length).trim(), dd: true }
}

/** The responses people type: "What is Paris?" is a response, not a clue. */
const PHRASED_AS_QUESTION = /^\s*(what|who|where|when|why|how|which)\b/i

/* ------------------------------------------------------------------ *
 * Which column is the clue?
 * ------------------------------------------------------------------ */

interface RawClue {
  round: 1 | 2 | 'final'
  category: string
  question: string
  answer: string
  value?: number
  order?: number
  isDailyDouble: boolean
}

/**
 * Decide whether the file has the clue and the response the other way round
 * from the column names. The clue is nearly always the longer text; when the
 * two are close in length, the one written as a question is the response.
 */
function looksSwapped(clues: Array<{ question: string; answer: string }>): boolean {
  let qLen = 0
  let aLen = 0
  let qAsk = 0
  let aAsk = 0
  let n = 0
  for (const c of clues) {
    if (!c.question || !c.answer) continue
    n++
    qLen += c.question.length
    aLen += c.answer.length
    if (PHRASED_AS_QUESTION.test(c.question)) qAsk++
    if (PHRASED_AS_QUESTION.test(c.answer)) aAsk++
  }
  if (!n) return false
  const ratio = aLen / Math.max(1, qLen)
  if (ratio > 1.3) return true
  if (ratio < 0.77) return false
  return qAsk > aAsk
}

function applySwap(clues: RawClue[]) {
  for (const c of clues) {
    const q = c.question
    c.question = c.answer
    c.answer = q
  }
}

/* ------------------------------------------------------------------ *
 * Building the board
 * ------------------------------------------------------------------ */

/** The show's ladder, which is what an imported game should look like. */
function ladderValue(rowIdx: number, roundIdx: 0 | 1): number {
  return (rowIdx + 1) * (roundIdx === 0 ? 200 : 400)
}

function buildRound(clues: RawClue[], roundIdx: 0 | 1, warnings: string[]): CustomRound | null {
  if (!clues.length) return null

  // Categories keep the order they first appear in the file.
  const order: string[] = []
  const names = new Map<string, string>()
  const byCat = new Map<string, RawClue[]>()
  for (const c of clues) {
    const key = c.category.toLowerCase()
    if (!byCat.has(key)) { byCat.set(key, []); order.push(key); names.set(key, c.category) }
    byCat.get(key)!.push(c)
  }

  let keys = order
  if (keys.length > MAX_CATEGORIES) {
    warnings.push(
      `${keys.length} categories in ${roundIdx === 0 ? 'the first round' : 'Double Jeopardy'} — kept the first ${MAX_CATEGORIES}, dropped ${keys
        .slice(MAX_CATEGORIES)
        .map((k) => names.get(k) || 'unnamed')
        .join(', ')}.`,
    )
    keys = keys.slice(0, MAX_CATEGORIES)
  }

  const lists = keys.map((k) => byCat.get(k)!)
  const maxLen = Math.max(...lists.map((l) => l.length))

  // Row labels: the file's own dollar values when they form a sane ladder,
  // otherwise the show's. A file where every clue has a distinct value (1, 2,
  // 3, … 30) isn't describing rows, so it falls back to position.
  let labels: number[] = []
  let byValue = false
  const everyValue = clues.every((c) => c.value != null)
  if (everyValue) {
    const uniq = Array.from(new Set(clues.map((c) => c.value!))).sort((a, b) => a - b)
    if (uniq.length <= Math.max(maxLen, 2) * 1.5 && uniq.length <= MAX_ROWS) { labels = uniq; byValue = true }
  }
  if (!byValue) {
    // Borrow the first column's values if it has any, so a partly-filled
    // value column still sets the ladder.
    const borrowed = lists[0].map((c) => c.value).filter((v): v is number => v != null)
    labels = Array.from({ length: Math.max(maxLen, 1) }, (_, i) => borrowed[i] ?? ladderValue(i, roundIdx))
    if (everyValue) {
      warnings.push('The value column read as clue numbering rather than dollar values, so rows kept their file order.')
    } else if (!borrowed.length) {
      warnings.push(`No dollar values in the file — used the standard ladder (${ladderValue(0, roundIdx)}–${ladderValue(Math.max(maxLen, 1) - 1, roundIdx)}).`)
    }
  }

  let rows = Math.min(Math.max(labels.length, maxLen), MAX_ROWS)
  if (Math.max(labels.length, maxLen) > MAX_ROWS) {
    warnings.push(`${Math.max(labels.length, maxLen)} clues deep in one category — kept the first ${MAX_ROWS}.`)
  }
  labels = labels.slice(0, rows)
  while (labels.length < rows) labels.push(ladderValue(labels.length, roundIdx))

  const grid: Array<Array<RawClue | null>> = lists.map(() => Array(rows).fill(null))
  let collisions = 0
  let dropped = 0
  lists.forEach((list, ci) => {
    const used = new Set<number>()
    list.forEach((clue, i) => {
      let idx = byValue ? labels.indexOf(clue.value!) : clue.order != null ? clue.order - 1 : i
      if (idx < 0 || idx >= rows) idx = i
      const before = idx
      while (idx < rows && used.has(idx)) idx++
      if (idx >= rows) { dropped++; return }
      if (idx !== before) collisions++
      used.add(idx)
      grid[ci][idx] = clue
    })
  })
  if (collisions) warnings.push(`${collisions} clue${collisions === 1 ? '' : 's'} shared a slot with another in the same category and moved to the next free row.`)
  if (dropped) warnings.push(`${dropped} clue${dropped === 1 ? ' did not' : 's did not'} fit the grid and ${dropped === 1 ? 'was' : 'were'} left out.`)

  const categories: CustomCategory[] = grid.map((col, ci) => ({
    name: names.get(keys[ci]) || `Category ${ci + 1}`,
    clues: labels.map((value, ri) => {
      const c = col[ri]
      return {
        question: c?.question || '',
        answer: c?.answer || '',
        value,
        isDailyDouble: !!c?.isDailyDouble,
      }
    }),
  }))

  return { categories }
}

function buildBoard(raws: RawClue[], warnings: string[]): { board: CustomBoard; stats: CsvImportStats } {
  const r1 = raws.filter((c) => c.round === 1)
  const r2 = raws.filter((c) => c.round === 2)
  const finals = raws.filter((c) => c.round === 'final')

  let first = r1
  let second = r2
  if (!first.length && second.length) {
    warnings.push('The file only had a Double Jeopardy round, so it was loaded as the first round.')
    first = second
    second = []
  }

  const round1 = buildRound(first, 0, warnings)
  if (!round1) throw new Error('No clues found in the file.')
  const round2 = second.length ? buildRound(second, 1, warnings) : null

  const board: CustomBoard = { rounds: round2 ? [round1, round2] : [round1] }

  if (finals.length) {
    const f = finals[0]
    board.finalJeopardy = {
      categoryName: f.category || 'Final Jeopardy',
      question: f.question,
      answer: f.answer,
    }
    if (finals.length > 1) warnings.push(`${finals.length} Final Jeopardy clues — kept the first one.`)
  }

  let clues = 0
  let blanks = 0
  let dailyDoubles = 0
  let categories = 0
  for (const round of board.rounds) {
    categories += round.categories.length
    for (const cat of round.categories) {
      for (const clue of cat.clues) {
        if (clue.question || clue.answer) clues++
        else blanks++
        if (clue.isDailyDouble) dailyDoubles++
      }
    }
  }

  return {
    board,
    stats: { categories, clues, blanks, dailyDoubles, rounds: board.rounds.length, hasFinal: !!board.finalJeopardy },
  }
}

/* ------------------------------------------------------------------ *
 * The three layouts
 * ------------------------------------------------------------------ */

function readLong(rows: string[][], scan: HeaderScan, warnings: string[]): { raws: RawClue[]; title: string } {
  const { map } = scan
  const out: RawClue[] = []
  let title = ''
  let sectionRound: 1 | 2 | 'final' | null = null

  for (let i = scan.index + 1; i < rows.length; i++) {
    const row = rows[i]
    const filled = row.filter((c) => c !== '').length
    if (!filled) continue

    // A lone cell between blocks is a section heading ("Double Jeopardy!").
    if (filled === 1) {
      const only = row.find((c) => c !== '') || ''
      const r = normRound(only)
      if (r) { sectionRound = r; continue }
    }

    const at = (f: Field) => (map[f] !== undefined ? row[map[f]!] || '' : '')
    const question = at('question')
    const answer = at('answer')
    const category = at('category')
    if (!question && !answer) continue

    if (map.title !== undefined && !title) title = at('title')

    const v = normValue(at('value'))
    const ddCell = at('dailyDouble')
    const orderRaw = at('order')
    const orderNum = orderRaw ? parseInt(orderRaw.replace(/[^\d]/g, ''), 10) : NaN

    out.push({
      round: normRound(at('round')) ?? sectionRound ?? 1,
      category,
      question,
      answer,
      value: v.value,
      order: Number.isFinite(orderNum) && orderNum > 0 ? orderNum : undefined,
      isDailyDouble: v.dd || TRUTHY.test(ddCell.trim()),
    })
  }

  if (map.category === undefined) warnings.push('No category column — every clue landed in one column.')
  return { raws: out, title }
}

/** Column headers in the pairs layout can carry the dollar value: "$400 clue". */
function valueFromHeader(header: string): number | undefined {
  const raw = header.trim()
  const m = raw.replace(/,/g, '').match(/\d+/)
  if (!m) return undefined
  const n = parseInt(m[0], 10)
  // "Clue 1" is an ordinal, "$200" / "Clue 400" is money.
  if (raw.includes('$') || n >= 100) return n
  return undefined
}

function readPairs(rows: string[][], scan: HeaderScan, warnings: string[]): { raws: RawClue[]; title: string } {
  const header = rows[scan.index]
  const clueSet = new Set(scan.clueCols)
  const answerSet = new Set(scan.answerCols)

  // Walk left to right, matching each clue column with the answer column that
  // follows it. A trailing clue with no answer still imports, just blank.
  const pairs: Array<{ q: number; a?: number; value?: number }> = []
  let pending: number | null = null
  for (let ci = 0; ci < header.length; ci++) {
    if (clueSet.has(ci)) {
      if (pending !== null) pairs.push({ q: pending, value: valueFromHeader(header[pending]) })
      pending = ci
    } else if (answerSet.has(ci) && pending !== null) {
      pairs.push({ q: pending, a: ci, value: valueFromHeader(header[pending]) ?? valueFromHeader(header[ci]) })
      pending = null
    }
  }
  if (pending !== null) pairs.push({ q: pending, value: valueFromHeader(header[pending]) })

  const catCol = scan.map.category ?? 0
  const out: RawClue[] = []
  let title = ''
  let sectionRound: 1 | 2 | 'final' | null = null

  for (let i = scan.index + 1; i < rows.length; i++) {
    const row = rows[i]
    const filled = row.filter((c) => c !== '').length
    if (!filled) continue
    if (filled === 1) {
      const only = row.find((c) => c !== '') || ''
      const r = normRound(only)
      if (r) { sectionRound = r; continue }
      if (!title) title = only
      continue
    }

    const category = row[catCol] || ''
    const rowRound =
      (scan.map.round !== undefined ? normRound(row[scan.map.round] || '') : null) ??
      (normRound(category) === 'final' ? 'final' : null) ??
      sectionRound ??
      1

    pairs.forEach((p, pi) => {
      const question = row[p.q] || ''
      const answer = p.a !== undefined ? row[p.a] || '' : ''
      if (!question && !answer) return
      out.push({
        round: rowRound,
        category: rowRound === 'final' ? category : category,
        question,
        answer,
        value: p.value,
        order: pi + 1,
        isDailyDouble: false,
      })
    })
  }

  if (!pairs.some((p) => p.a !== undefined)) warnings.push('No answer columns were found next to the clue columns, so answers are blank.')
  return { raws: out, title }
}

const CELL_SEPS = ['|', '\n', ' // ', ' -- ', ' :: ', ' / ']

/** One separator for the whole file, decided by what most cells actually use. */
function pickCellSep(cells: string[]): string | null {
  const filled = cells.filter((c) => c !== '')
  if (!filled.length) return null
  for (const sep of CELL_SEPS) {
    const n = filled.filter((c) => c.includes(sep)).length
    if (n >= Math.max(2, filled.length * 0.5)) return sep
  }
  return null
}

function splitCell(cell: string, sep: string | null): { question: string; answer: string } {
  if (!sep) return { question: cell, answer: '' }
  const idx = cell.indexOf(sep)
  if (idx < 0) return { question: cell.trim(), answer: '' }
  return { question: cell.slice(0, idx).trim(), answer: cell.slice(idx + sep.length).trim() }
}

/**
 * The hand-made sheet. Either the money runs across the header and each row is
 * a category, or the money runs down the first column and each column is a
 * category. Both turn up; which one a file is shows in where the dollar
 * values sit.
 */
function readGrid(rows: string[][], warnings: string[]): { raws: RawClue[]; title: string } | null {
  const table = rows.filter((r) => r.some((c) => c !== ''))
  if (table.length < 2) return null

  const headerIdx = table.findIndex((r) => r.filter((c) => c !== '').length >= 2)
  if (headerIdx < 0) return null
  const header = table[headerIdx]
  const body = table.slice(headerIdx + 1)
  if (!body.length) return null

  const headerMoney = header.slice(1).filter((c) => c !== '')
  const headerIsMoney = headerMoney.length >= 2 && headerMoney.filter(isMoneyish).length >= headerMoney.length * 0.6
  const firstCol = body.map((r) => r[0] || '').filter((c) => c !== '')
  const firstColIsMoney = firstCol.length >= 2 && firstCol.filter(isMoneyish).length >= firstCol.length * 0.6

  if (!headerIsMoney && !firstColIsMoney) return null

  const title = headerIdx > 0 ? table[0].find((c) => c !== '') || '' : ''
  const allCells: string[] = []
  for (const r of body) for (let ci = 1; ci < r.length; ci++) if (r[ci]) allCells.push(r[ci])
  const sep = pickCellSep(allCells)
  if (!sep) warnings.push('No clue/answer separator found in the cells, so every cell was read as a clue with no answer. Put "clue | answer" in each cell to import both.')

  const out: RawClue[] = []

  if (headerIsMoney) {
    // Money across the top; each row is a category.
    const values = header.map((h) => normValue(h).value)
    let sectionRound: 1 | 2 | 'final' = 1
    for (const row of body) {
      const label = row[0] || ''
      const filled = row.filter((c) => c !== '').length
      if (filled === 1) {
        const r = normRound(label)
        if (r && r !== 'final') { sectionRound = r; continue }
      }
      const asFinal = normRound(label) === 'final'
      for (let ci = 1; ci < row.length; ci++) {
        if (!row[ci]) continue
        const { question, answer } = splitCell(row[ci], sep)
        if (!question && !answer) continue
        out.push({
          round: asFinal ? 'final' : sectionRound,
          category: label,
          question,
          answer,
          value: values[ci],
          order: ci,
          isDailyDouble: false,
        })
      }
    }
  } else {
    // Money down the side; each column is a category.
    for (let ci = 1; ci < header.length; ci++) {
      const category = header[ci] || ''
      for (let ri = 0; ri < body.length; ri++) {
        const cell = body[ri][ci]
        if (!cell) continue
        const { question, answer } = splitCell(cell, sep)
        if (!question && !answer) continue
        const label = body[ri][0] || ''
        out.push({
          round: normRound(label) === 'final' ? 'final' : 1,
          category,
          question,
          answer,
          value: normValue(label).value,
          order: ri + 1,
          isDailyDouble: false,
        })
      }
    }
  }

  return out.length ? { raws: out, title } : null
}

/**
 * No header row at all — guess the columns from what's in them. The value
 * column is the one full of money, the clue is the longest text, the answer is
 * the next longest, and the category is the one that repeats itself.
 */
function readHeaderless(rows: string[][], warnings: string[]): { raws: RawClue[]; title: string } | null {
  const table = rows.filter((r) => r.some((c) => c !== ''))
  if (table.length < 2) return null
  const width = Math.max(...table.map((r) => r.length))
  if (width < 3) return null

  const col = (ci: number) => table.map((r) => r[ci] || '')
  const stats = Array.from({ length: width }, (_, ci) => {
    const cells = col(ci).filter((c) => c !== '')
    const avg = cells.length ? cells.reduce((a, c) => a + c.length, 0) / cells.length : 0
    const distinct = new Set(cells.map((c) => c.toLowerCase())).size
    return {
      ci,
      avg,
      money: cells.length ? cells.filter(isMoneyish).length / cells.length : 0,
      rounds: cells.length ? cells.filter((c) => normRound(c) !== null && c.length <= 20).length / cells.length : 0,
      repeat: cells.length ? distinct / cells.length : 1,
      filled: cells.length,
    }
  }).filter((s) => s.filled > 0)

  const taken = new Set<number>()
  const valueCol = stats.find((s) => s.money >= 0.8)
  if (valueCol) taken.add(valueCol.ci)
  const roundCol = stats.find((s) => !taken.has(s.ci) && s.rounds >= 0.9 && s.repeat <= 0.4)
  if (roundCol) taken.add(roundCol.ci)

  const text = stats.filter((s) => !taken.has(s.ci)).sort((a, b) => b.avg - a.avg)
  if (text.length < 2) return null
  const [qCol, aCol] = [text[0], text[1]].sort((a, b) => a.ci - b.ci)
  taken.add(qCol.ci)
  taken.add(aCol.ci)
  const catCol = stats.filter((s) => !taken.has(s.ci)).sort((a, b) => a.repeat - b.repeat)[0]

  const out: RawClue[] = []
  for (const row of table) {
    const question = row[qCol.ci] || ''
    const answer = row[aCol.ci] || ''
    if (!question && !answer) continue
    const v = valueCol ? normValue(row[valueCol.ci] || '') : { value: undefined, dd: false }
    out.push({
      round: roundCol ? normRound(row[roundCol.ci] || '') ?? 1 : 1,
      category: catCol ? row[catCol.ci] || '' : '',
      question,
      answer,
      value: v.value,
      isDailyDouble: v.dd,
    })
  }
  if (!out.length) return null

  warnings.push(
    `No header row was recognised, so the columns were read by their contents: clue from column ${qCol.ci + 1}, answer from column ${aCol.ci + 1}${
      catCol ? `, category from column ${catCol.ci + 1}` : ''
    }${valueCol ? `, value from column ${valueCol.ci + 1}` : ''}.`,
  )
  return { raws: out, title: '' }
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export interface ParseOptions {
  /** Used as the board title when the file doesn't name itself. */
  fileName?: string
  /**
   * Force the clue/answer orientation. Left undefined, the parser decides and
   * reports what it chose in `swapped` so the UI can offer the other reading.
   */
  swap?: boolean
}

/** Title from the file name: "family-trivia-2026.csv" → "Family trivia 2026". */
function titleFromFileName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!base) return ''
  return base.charAt(0).toUpperCase() + base.slice(1)
}

export function parseBoardCsv(text: string, opts: ParseOptions = {}): CsvImportResult {
  if (!text.trim()) throw new Error('That file was empty.')

  const delim = pickDelimiter(text)
  const all = parseDelimited(text, delim)
  const rows = all.filter((r) => r.some((c) => c !== ''))
  if (!rows.length) throw new Error('That file was empty.')
  if (rows.length > MAX_DATA_ROWS) throw new Error(`That file has ${rows.length} rows — more than one game's worth. Split it up and import a game at a time.`)

  const warnings: string[] = []
  const scan = findHeader(rows)

  let layout: CsvLayout
  let read: { raws: RawClue[]; title: string } | null = null

  if (scan && scan.clueCols.length >= 2 && scan.answerCols.length >= 1) {
    layout = 'pairs'
    read = readPairs(rows, scan, warnings)
  } else if (scan && (scan.map.question !== undefined || scan.map.answer !== undefined)) {
    layout = 'long'
    read = readLong(rows, scan, warnings)
  } else {
    const grid = readGrid(rows, warnings)
    if (grid) {
      layout = 'grid'
      read = grid
    } else {
      // The grid attempt may have left a note that no longer applies.
      warnings.length = 0
      const guessed = readHeaderless(rows, warnings)
      if (!guessed) {
        throw new Error(
          "Couldn't tell what's in this file. The simplest shape that always works is one clue per row with the columns Round, Category, Value, Clue, Answer — download the template below and paste your clues into it.",
        )
      }
      layout = 'long'
      read = guessed
    }
  }

  const raws = read.raws
  if (!raws.length) throw new Error('No clues found in the file — the rows under the header were all empty.')

  for (const c of raws) {
    const marked = stripDailyDoubleMark(c.question)
    if (marked.dd) {
      c.question = marked.text
      c.isDailyDouble = true
    }
  }

  // Only a file naming both columns can be the wrong way round; the grid and
  // pairs layouts take their order from the cell itself.
  const canSwap = layout !== 'grid'
  const detected = canSwap ? looksSwapped(raws) : false
  const swapped = opts.swap ?? detected
  if (swapped) {
    applySwap(raws)
    if (opts.swap === undefined) {
      warnings.push("The clue and the answer looked the other way round from the column names — in the show's language the clue IS the \"answer\" — so they were swapped back. Flip them if that's wrong.")
    }
  }

  const { board, stats } = buildBoard(raws, warnings)

  const title = (read.title || '').trim() || titleFromFileName(opts.fileName || '') || 'Imported board'

  return { title, board, layout, swapped, warnings, stats }
}

/* ------------------------------------------------------------------ *
 * The other direction
 * ------------------------------------------------------------------ */

function csvCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const ROUND_LABEL = ['Jeopardy', 'Double Jeopardy']

/**
 * A board back out as CSV, in the long format `parseBoardCsv` reads best.
 * Doubles as the way an author gets their own board into a spreadsheet, edits
 * it there, and brings it back.
 */
export function boardToCsv(title: string, board: CustomBoard): string {
  const lines = ['Round,Category,Value,Clue,Answer,Daily Double']
  board.rounds.forEach((round, ri) => {
    for (const cat of round.categories) {
      for (const clue of cat.clues) {
        if (!clue.question && !clue.answer) continue
        lines.push(
          [
            ROUND_LABEL[ri] || `Round ${ri + 1}`,
            cat.name,
            String(clue.value),
            clue.question,
            clue.answer,
            clue.isDailyDouble ? 'yes' : '',
          ]
            .map(csvCell)
            .join(','),
        )
      }
    }
  })
  if (board.finalJeopardy) {
    const f = board.finalJeopardy
    lines.push(['Final Jeopardy', f.categoryName, '', f.question, f.answer, ''].map(csvCell).join(','))
  }
  return `${lines.join('\n')}\n`
}

/**
 * A filename for a board's export. Strips what a filesystem would object to
 * and keeps the author's own title, so a board they named "Kids Week" comes
 * back as `Kids Week.csv` rather than `board.csv`.
 */
export function csvFilename(title: string): string {
  const base = (title || '').replace(/[^\w\- ]+/g, '').trim()
  return `${base || 'board'}.csv`
}

/** Handed out as a download so an author can start from a file that works. */
export const CSV_TEMPLATE = `Round,Category,Value,Clue,Answer,Daily Double
Jeopardy,WORLD CAPITALS,200,This city on the Seine is France's capital,Paris,
Jeopardy,WORLD CAPITALS,400,"Chile's capital, in a valley under the Andes",Santiago,
Jeopardy,WORLD CAPITALS,600,This capital sits on both sides of the Bosphorus — and isn't Turkey's capital,Istanbul,yes
Jeopardy,MOVIE QUOTES,200,"""Here's looking at you, kid"" ends this 1942 film",Casablanca,
Jeopardy,MOVIE QUOTES,400,"""You're gonna need a bigger boat"" — close enough, in this 1975 blockbuster",Jaws,
Jeopardy,MOVIE QUOTES,600,Buzz Lightyear's catchphrase goes to infinity and this,And beyond,
Double Jeopardy,CHEMISTRY,400,This element's symbol comes from the Latin natrium,Sodium,
Double Jeopardy,CHEMISTRY,800,The only metal that's liquid at room temperature,Mercury,
Final Jeopardy,AMERICAN HISTORY,,This document's first three words are written larger than the rest,The Constitution ("We the People"),
`
