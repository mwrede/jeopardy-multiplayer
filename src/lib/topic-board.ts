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
export async function fetchTopicPool(
  topic: BoardTopic,
  roundName: string,
  limit = 800,
): Promise<PoolClue[]> {
  let query = supabase
    .from('clue_pool')
    .select('question, answer')
    .eq('round', roundName)

  if (topic.kind === 'theme') {
    query = query.eq('category_type', topic.value)
  } else {
    const safe = sanitizeTerm(topic.value)
    if (!safe) return []
    // The whole point: a term hits the category name, the clue text, or the answer.
    query = query.or(
      `category.ilike.%${safe}%,question.ilike.%${safe}%,answer.ilike.%${safe}%`,
    )
  }

  const { data, error } = await query.limit(limit)
  if (error) {
    console.warn(`[topic-board] pool fetch failed for "${topic.label}":`, error.message)
    return []
  }

  // De-dupe by question — the same clue can appear across multiple airings.
  const seen = new Set<string>()
  const out: PoolClue[] = []
  for (const row of data ?? []) {
    const q = (row as any).question as string
    const a = (row as any).answer as string
    if (!q || !a) continue
    const key = q.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ question: q, answer: a })
  }
  return out
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
    throw new Error(
      `No clues found for ${thin.join(', ') || 'those topics'} in ${roundName}. ` +
      `Try broader topics or a smaller board size.`,
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
    let query = supabase
      .from('clue_pool')
      .select('category, question, answer')
      .eq('round', 'Final Jeopardy')

    if (topic.kind === 'theme') {
      query = query.eq('category_type', topic.value)
    } else {
      const safe = sanitizeTerm(topic.value)
      if (!safe) continue
      query = query.or(
        `category.ilike.%${safe}%,question.ilike.%${safe}%,answer.ilike.%${safe}%`,
      )
    }

    const { data } = await query.limit(50)
    if (data && data.length > 0) {
      const pick = data[Math.floor(Math.random() * data.length)] as any
      return { category: pick.category, question: pick.question, answer: pick.answer }
    }
  }
  return null
}
