/**
 * Topic Board builder.
 *
 * A topic board is assembled from a user-chosen list of category headers.
 * Each header is either:
 *
 *   - a curated theme  → pulls from the pre-tagged `category_type` column
 *                        (geography, history, corporate, …). High quality,
 *                        indexed, fast.
 *   - a free-text term → pulls ANY clue that mentions the term, matching the
 *                        category name OR the question text OR the answer.
 *                        This is what makes "mechanical engineering" work even
 *                        though no J-Archive category is named that.
 *
 * The board's category slots are split as evenly as possible across the chosen
 * topics. Pick geography + pop culture + history on a 6-wide board and you get
 * 2 columns each. Pick more topics than there are slots and the extras roll
 * into the next round, so a full game (6 + 6) can showcase up to 12 topics.
 */

import { supabase } from './supabase'

export const MAX_TOPICS = 12

export type BoardTopic = {
  /** 'theme' = curated category_type; 'term' = free-text clue search. */
  kind: 'theme' | 'term'
  /** category_type value, or the raw search term. */
  value: string
  /** Display name used for the board's category header. */
  label: string
}

export type PoolClue = { question: string; answer: string }

/**
 * Strip characters that would break PostgREST's `.or()` filter grammar
 * (commas and parens are separators there) plus SQL LIKE wildcards.
 */
export function sanitizeTerm(raw: string): string {
  return raw.replace(/[,()%_*]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Decide which topic fills each category slot of a round.
 *
 * Fewer topics than slots → split evenly, grouped (AA BB CC), leftovers to the
 * earliest topics. More topics than slots → this round takes its own window of
 * the topic list so later rounds surface the rest.
 */
export function allocateTopics(
  topics: BoardTopic[],
  slots: number,
  roundIndex: number,
): BoardTopic[] {
  if (topics.length === 0) return []

  if (topics.length >= slots) {
    const start = (roundIndex * slots) % topics.length
    return Array.from({ length: slots }, (_, i) => topics[(start + i) % topics.length])
  }

  const base = Math.floor(slots / topics.length)
  const extra = slots - base * topics.length
  const out: BoardTopic[] = []
  topics.forEach((t, i) => {
    const n = base + (i < extra ? 1 : 0)
    for (let k = 0; k < n; k++) out.push(t)
  })
  return out
}

/**
 * Header text for the nth board column belonging to a topic.
 * Repeats get numeral suffixes so two "GEOGRAPHY" columns are distinguishable.
 */
export function headerFor(topic: BoardTopic, occurrence: number): string {
  const base = topic.label.toUpperCase()
  if (occurrence === 0) return base
  const numerals = ['', ' II', ' III', ' IV', ' V', ' VI']
  return base + (numerals[occurrence] ?? ` ${occurrence + 1}`)
}

/**
 * Fetch a de-duplicated pool of clues for one topic in one round.
 * Themes filter on category_type; terms search category + question + answer.
 */
/**
 * Turn a raw Postgres error into something a player can act on. Statement
 * timeouts here mean a missing index, not a bad topic — saying so saves a
 * pointless round of "try a broader term".
 */
function describeQueryError(message: string, label: string): string {
  if (/statement timeout/i.test(message)) {
    return (
      `Search for "${label}" timed out. The clue database is missing its ` +
      `search indexes — run supabase-migration-category-type-index.sql ` +
      `(and supabase-migration-clue-text-trigram.sql for typed categories).`
    )
  }
  return `Clue search failed for "${label}": ${message}`
}

/** De-dupe rows by question text (the same clue recurs across airings). */
function dedupe(rows: any[]): PoolClue[] {
  const seen = new Set<string>()
  const out: PoolClue[] = []
  for (const row of rows) {
    const q = row?.question as string
    const a = row?.answer as string
    if (!q || !a) continue
    const key = q.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ question: q, answer: a })
  }
  return out
}

export async function fetchTopicPool(
  topic: BoardTopic,
  roundName: string,
  limit = 800,
): Promise<PoolClue[]> {
  // Curated theme: one indexed equality lookup on the pre-tagged column.
  if (topic.kind === 'theme') {
    const { data, error } = await supabase
      .from('clue_pool')
      .select('question, answer')
      .eq('round', roundName)
      .eq('category_type', topic.value)
      .limit(limit)
    if (error) {
      console.warn(`[topic-board] theme fetch failed for "${topic.label}":`, error.message)
      throw new Error(describeQueryError(error.message, topic.label))
    }
    return dedupe(data ?? [])
  }

  // Free-text term: match the category name, the clue text, or the answer.
  //
  // Deliberately three separate .ilike() queries rather than one .or().
  // supabase-js splices an .or() string raw into the URL, where the '%'
  // wildcards start percent-escape sequences and multi-word values break the
  // filter grammar — the query silently returns nothing. .ilike() is encoded
  // properly by the client, so this actually works.
  const safe = sanitizeTerm(topic.value)
  if (!safe) return []
  const pattern = `%${safe}%`
  const per = Math.ceil(limit / 2)

  const [byCategory, byQuestion, byAnswer] = await Promise.all([
    supabase.from('clue_pool').select('question, answer')
      .eq('round', roundName).ilike('category', pattern).limit(per),
    supabase.from('clue_pool').select('question, answer')
      .eq('round', roundName).ilike('question', pattern).limit(per),
    supabase.from('clue_pool').select('question, answer')
      .eq('round', roundName).ilike('answer', pattern).limit(per),
  ])

  const failures = [byCategory, byQuestion, byAnswer].filter((r) => r.error)
  if (failures.length === 3) {
    // Every probe failed — surface it instead of pretending the topic is empty.
    throw new Error(
      `Clue search failed for "${topic.label}": ${failures[0].error!.message}. ` +
      `If this says "statement timeout", the clue-text search indexes are missing — ` +
      `run supabase-migration-clue-text-trigram.sql.`,
    )
  }
  for (const f of failures) {
    console.warn(`[topic-board] partial miss for "${topic.label}":`, f.error!.message)
  }

  // Category-name hits first — those are whole real categories, so they play
  // best; clue-text and answer hits backfill.
  const exact = dedupe([
    ...(byCategory.data ?? []),
    ...(byQuestion.data ?? []),
    ...(byAnswer.data ?? []),
  ])

  // A multi-word phrase rarely appears verbatim in clue text — "mechanical
  // engineering" as a literal substring is nearly empty. When the exact search
  // comes up thin, widen to clues that mention every significant word, even if
  // they're apart. Single-word topics skip this entirely.
  const terms = significantWords(safe)
  if (exact.length >= 40 || terms.length < 2) return exact

  const widened = await fetchAllWordsPool(terms, roundName, per)
  return dedupe([...exact, ...widened])
}

/** Words worth searching on — drops stopwords and very short tokens. */
function significantWords(phrase: string): string[] {
  const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'for', 'to'])
  return phrase
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
}

/**
 * Find clues mentioning EVERY given word (not necessarily adjacent).
 * Anchors on the longest word — the most selective — then filters the rest
 * client-side, since chaining .ilike() across different columns would AND them
 * per-column rather than across the row.
 */
async function fetchAllWordsPool(
  terms: string[],
  roundName: string,
  limit: number,
): Promise<PoolClue[]> {
  const anchor = [...terms].sort((a, b) => b.length - a.length)[0]
  const pattern = `%${anchor}%`

  const [cat, q, a] = await Promise.all([
    supabase.from('clue_pool').select('category, question, answer')
      .eq('round', roundName).ilike('category', pattern).limit(limit),
    supabase.from('clue_pool').select('category, question, answer')
      .eq('round', roundName).ilike('question', pattern).limit(limit),
    supabase.from('clue_pool').select('category, question, answer')
      .eq('round', roundName).ilike('answer', pattern).limit(limit),
  ])

  const rows = [...(cat.data ?? []), ...(q.data ?? []), ...(a.data ?? [])]
  const others = terms.filter((t) => t !== anchor)

  const matching = rows.filter((r: any) => {
    const haystack = `${r.category ?? ''} ${r.question ?? ''} ${r.answer ?? ''}`.toLowerCase()
    return others.every((t) => haystack.includes(t))
  })

  return dedupe(matching)
}

/** In-place Fisher-Yates. */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Build one round of a topic board: inserts categories + clues and returns the
 * created clue ids (used downstream for Daily Double placement).
 */
export async function buildTopicRound(opts: {
  gameId: string
  topics: BoardTopic[]
  roundName: string
  roundNumber: number
  roundIndex: number
  values: number[]
  numCategories: number
  cluesPerCat: number
}): Promise<string[]> {
  const {
    gameId, topics, roundName, roundNumber, roundIndex,
    values, numCategories, cluesPerCat,
  } = opts

  const slotTopics = allocateTopics(topics, numCategories, roundIndex)

  // One pool per distinct topic in this round, fetched in parallel.
  const distinct = Array.from(new Set(slotTopics.map((t) => t.value)))
  const pools = new Map<string, PoolClue[]>()
  await Promise.all(
    distinct.map(async (value) => {
      const topic = slotTopics.find((t) => t.value === value)!
      pools.set(value, shuffle(await fetchTopicPool(topic, roundName)))
    }),
  )

  const cursor = new Map<string, number>()     // pool read position per topic
  const occurrence = new Map<string, number>() // header numbering per topic
  const clueIds: string[] = []
  let position = 0
  const thin: string[] = []

  for (const topic of slotTopics) {
    const pool = pools.get(topic.value) ?? []
    const start = cursor.get(topic.value) ?? 0
    const slice = pool.slice(start, start + cluesPerCat)

    if (slice.length < cluesPerCat) {
      // This topic ran dry — leave the slot for the backfill pass below.
      if (!thin.includes(topic.label)) thin.push(topic.label)
      continue
    }
    cursor.set(topic.value, start + cluesPerCat)

    const occ = occurrence.get(topic.value) ?? 0
    occurrence.set(topic.value, occ + 1)

    const { data: cat, error: catErr } = await supabase
      .from('categories')
      .insert({
        game_id: gameId,
        name: headerFor(topic, occ),
        round_number: roundNumber,
        position,
      })
      .select('id')
      .single()
    if (catErr || !cat) continue

    for (let i = 0; i < cluesPerCat; i++) {
      const { data: clue } = await supabase
        .from('clues')
        .insert({
          category_id: cat.id,
          value: values[i],
          question: slice[i].question,
          answer: slice[i].answer,
          is_daily_double: false,
        })
        .select('id')
        .single()
      if (clue) clueIds.push(clue.id)
    }
    position++
  }

  // Backfill: if some topics were too thin, top the board up from whichever
  // topics still have clues left rather than failing the whole game.
  if (position < numCategories) {
    for (const value of distinct) {
      if (position >= numCategories) break
      const pool = pools.get(value) ?? []
      let start = cursor.get(value) ?? 0
      const topic = slotTopics.find((t) => t.value === value)!

      while (position < numCategories && pool.length - start >= cluesPerCat) {
        const slice = pool.slice(start, start + cluesPerCat)
        start += cluesPerCat
        cursor.set(value, start)

        const occ = occurrence.get(value) ?? 0
        occurrence.set(value, occ + 1)

        const { data: cat } = await supabase
          .from('categories')
          .insert({
            game_id: gameId,
            name: headerFor(topic, occ),
            round_number: roundNumber,
            position,
          })
          .select('id')
          .single()
        if (!cat) break

        for (let i = 0; i < cluesPerCat; i++) {
          const { data: clue } = await supabase
            .from('clues')
            .insert({
              category_id: cat.id,
              value: values[i],
              question: slice[i].question,
              answer: slice[i].answer,
              is_daily_double: false,
            })
            .select('id')
            .single()
          if (clue) clueIds.push(clue.id)
        }
        position++
      }
    }
  }

  if (position === 0) {
    const found = distinct
      .map((v) => {
        const label = slotTopics.find((t) => t.value === v)!.label
        return `${label}: ${(pools.get(v) ?? []).length} clues`
      })
      .join(', ')
    throw new Error(
      `Not enough clues to fill ${roundName} — each column needs ${cluesPerCat}. ` +
      `Found ${found}. Try broader topics, fewer of them, or the Rapid board size.`,
    )
  }

  return clueIds
}

/**
 * Pick a Final Jeopardy clue that matches one of the chosen topics, falling
 * back to any FJ clue when none of them hit.
 */
export async function pickTopicFinal(topics: BoardTopic[]): Promise<{
  category: string
  question: string
  answer: string
} | null> {
  for (const topic of shuffle([...topics])) {
    let rows: any[] = []

    if (topic.kind === 'theme') {
      const { data } = await supabase
        .from('clue_pool')
        .select('category, question, answer')
        .eq('round', 'Final Jeopardy')
        .eq('category_type', topic.value)
        .limit(50)
      rows = data ?? []
    } else {
      const safe = sanitizeTerm(topic.value)
      if (!safe) continue
      const pattern = `%${safe}%`
      // Separate .ilike() calls for the same reason as fetchTopicPool.
      const [cat, q, a] = await Promise.all([
        supabase.from('clue_pool').select('category, question, answer')
          .eq('round', 'Final Jeopardy').ilike('category', pattern).limit(25),
        supabase.from('clue_pool').select('category, question, answer')
          .eq('round', 'Final Jeopardy').ilike('question', pattern).limit(25),
        supabase.from('clue_pool').select('category, question, answer')
          .eq('round', 'Final Jeopardy').ilike('answer', pattern).limit(25),
      ])
      rows = [...(cat.data ?? []), ...(q.data ?? []), ...(a.data ?? [])]
    }

    if (rows.length > 0) {
      const pick = rows[Math.floor(Math.random() * rows.length)]
      return { category: pick.category, question: pick.question, answer: pick.answer }
    }
  }
  return null
}
