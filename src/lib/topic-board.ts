/**
 * Topic Board builder.
 *
 * A topic board is assembled from a user-chosen list of category headers.
 * Each header is either:
 *
 *   - a curated theme  → pulls from the pre-tagged `category_type` column
 *                        (geography, history, corporate, …). High quality,
 *                        indexed, fast.
 *   - a free-text term → matches the category name first, then the clue text.
 *                        Never the answer: a clue whose ANSWER happens to
 *                        contain "health care" is a clue about whatever its
 *                        category says it is, not a health care clue.
 *                        Question text is the backstop that makes narrow
 *                        subjects work when no category is named for them.
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

export type PoolClue = {
  /** The real J-Archive category this clue was written for, e.g. "U.S. RIVERS". */
  category: string
  question: string
  answer: string
}

/**
 * Typed terms that are really just one of the curated themes under another
 * name. Someone asking for "geography" wants LAKES and EUROPEAN CAPITALS, not
 * the handful of categories with the word "geography" in the title — and the
 * theme lookup is both broader and better tagged.
 */
const THEME_ALIASES: Record<string, string> = {
  geography: 'geography', geo: 'geography', maps: 'geography', countries: 'geography',
  world: 'geography', places: 'geography',
  history: 'history', historical: 'history', 'world history': 'history',
  science: 'science', sciences: 'science', biology: 'science', chemistry: 'science',
  physics: 'science', space: 'science', astronomy: 'science',
  sports: 'sports', sport: 'sports', athletics: 'sports',
  'pop culture': 'pop_culture', popculture: 'pop_culture', celebrities: 'pop_culture',
  movies: 'pop_culture', film: 'pop_culture', tv: 'pop_culture', television: 'pop_culture',
  food: 'food', 'food and drink': 'food', 'food & drink': 'food', cooking: 'food',
  cuisine: 'food', drinks: 'food',
  literature: 'literature', books: 'literature', novels: 'literature', poetry: 'literature',
  authors: 'literature', writers: 'literature',
  music: 'music', songs: 'music', bands: 'music', rock: 'music',
  corporate: 'corporate', business: 'corporate', brands: 'corporate', companies: 'corporate',
  finance: 'corporate',
  politics: 'politics', political: 'politics', presidents: 'politics',
  government: 'politics', elections: 'politics',
}

/**
 * Words to look for in CATEGORY names for a typed topic.
 *
 * Two jobs. First, a multi-word phrase is split up: "%health care%" as a single
 * pattern matches no category at all (and times out the trigram index trying),
 * while "health" matches HEALTH & MEDICINE, SICKNESS & HEALTH, HEALTH MATTERS.
 *
 * Second, a handful of everyday subjects are broadened to the words J-Archive
 * actually names its categories with. Nobody writes a category called "health
 * care", but there are dozens called MEDICINE, ANATOMY, DISEASES, HOSPITALS and
 * THE HUMAN BODY — which is what someone asking for health care wants to play.
 */
const RELATED_CATEGORY_TERMS: Record<string, string[]> = {
  health: ['health', 'medic', 'anatomy', 'disease', 'doctor', 'hospital', 'body'],
  healthcare: ['health', 'medic', 'anatomy', 'disease', 'doctor', 'hospital', 'body'],
  medicine: ['medic', 'health', 'anatomy', 'disease', 'doctor'],
  medical: ['medic', 'health', 'anatomy', 'disease', 'doctor'],
  law: ['law', 'legal', 'court', 'crime', 'judge'],
  legal: ['law', 'legal', 'court', 'crime', 'judge'],
  animals: ['animal', 'bird', 'mammal', 'insect', 'dog', 'cat', 'fish'],
  animal: ['animal', 'bird', 'mammal', 'insect', 'dog', 'cat', 'fish'],
  technology: ['tech', 'computer', 'internet', 'gadget', 'invention'],
  tech: ['tech', 'computer', 'internet', 'gadget', 'invention'],
  religion: ['religio', 'bible', 'church', 'faith', 'saint'],
  war: ['war', 'battle', 'military', 'army'],
  art: ['art', 'painting', 'sculpture', 'museum'],
  transport: ['transport', 'car', 'train', 'plane', 'ship'],
  fashion: ['fashion', 'clothing', 'style', 'designer'],
}

export function relatedCategoryTerms(term: string): string[] {
  const words = significantWords(sanitizeTerm(term))
  const out = new Set<string>()
  for (const w of words) {
    out.add(w)
    for (const extra of RELATED_CATEGORY_TERMS[w] ?? []) out.add(extra)
  }
  // Whole phrase too, for the cases where a category really is named that.
  const whole = sanitizeTerm(term).toLowerCase()
  if (whole && words.length === 1) out.add(whole)
  // Capped: each one is its own query.
  return [...out].slice(0, 8)
}

/** The curated theme a typed term really means, if it means one. */
export function themeForTerm(term: string): string | null {
  return THEME_ALIASES[term.trim().toLowerCase()] ?? null
}

/**
 * Resolve a topic to what should actually be searched. A typed term matching a
 * curated theme becomes that theme, so it draws on the whole tagged pool.
 */
export function resolveTopic(topic: BoardTopic): BoardTopic {
  if (topic.kind === 'theme') return topic
  const theme = themeForTerm(topic.value)
  return theme ? { ...topic, kind: 'theme', value: theme } : topic
}

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
 * Themes filter on category_type; terms search category name, then clue text.
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
    out.push({ category: (row?.category as string) ?? '', question: q, answer: a })
  }
  return out
}

/**
 * Split a topic's clues back into the real categories they were written for,
 * keeping only those with enough clues to fill a column on their own.
 *
 * This is what makes a Geography board read like Jeopardy: six columns headed
 * LAKES, EUROPEAN CAPITALS, U.S. RIVERS rather than six headed GEOGRAPHY. The
 * clues were always drawn from categories like those — the names were simply
 * being thrown away, which also left every column an incoherent mix of lakes,
 * capitals and rivers instead of five clues about one thing.
 */
export function groupIntoRealCategories(
  pool: PoolClue[],
  cluesPerCat: number,
): { name: string; clues: PoolClue[] }[] {
  const byCategory = new Map<string, PoolClue[]>()
  for (const clue of pool) {
    const name = (clue.category ?? '').trim()
    if (!name) continue
    const list = byCategory.get(name) ?? []
    list.push(clue)
    byCategory.set(name, list)
  }

  const full: { name: string; clues: PoolClue[] }[] = []
  for (const [name, clues] of byCategory) {
    if (clues.length >= cluesPerCat) full.push({ name, clues })
  }
  return shuffle(full)
}

/**
 * Is this real category a fair header for the topic that found it?
 *
 * Always, for a curated theme — every category carrying that tag is on-topic.
 * For a typed term the pool also contains clues that merely MENTION the word,
 * so a search for "football" can drag in five clues from 1998 MOVIES; heading a
 * column with that would be a non sequitur. Those fall back to the term itself.
 */
function categoryFitsTopic(topic: BoardTopic, categoryName: string): boolean {
  if (topic.kind === 'theme') return true
  const haystack = categoryName.toLowerCase()
  const words = relatedCategoryTerms(topic.value)
  if (words.length === 0) return false
  // Match at a word START, not anywhere in the string. Plain substring matching
  // put HAS ANYBODY SEEN MY "GAL"? on a health board, because "anybody"
  // contains "body". Anchoring only the front still lets a stem like "medic"
  // reach MEDICINE and MEDICAL, which is the point of the related terms.
  return words.some((w) => {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escaped}`, 'i').test(haystack)
  })
}

export async function fetchTopicPool(
  rawTopic: BoardTopic,
  roundName: string,
  limit = 800,
): Promise<PoolClue[]> {
  const topic = resolveTopic(rawTopic)

  // Curated theme: one indexed equality lookup on the pre-tagged column.
  if (topic.kind === 'theme') {
    const { data, error } = await supabase
      .from('clue_pool')
      .select('category, question, answer')
      .eq('round', roundName)
      .eq('category_type', topic.value)
      .limit(limit)
    if (error) {
      console.warn(`[topic-board] theme fetch failed for "${topic.label}":`, error.message)
      throw new Error(describeQueryError(error.message, topic.label))
    }
    return dedupe(data ?? [])
  }

  // Free-text term: match the category name first, then the clue text.
  //
  // NOT the answer. Searching answers is what made "health care" return a
  // scatter of unrelated categories whose answers merely happened to contain
  // the phrase — a clue about a president whose answer is "Medicare" is not a
  // health care clue, it's a presidents clue. Matching the category name finds
  // whole categories that really are about the topic; clue text is the
  // backstop for subjects too specific to have their own category.
  //
  // Deliberately separate .ilike() queries rather than one .or().
  // supabase-js splices an .or() string raw into the URL, where the '%'
  // wildcards start percent-escape sequences and multi-word values break the
  // filter grammar — the query silently returns nothing. .ilike() is encoded
  // properly by the client, so this actually works.
  const safe = sanitizeTerm(topic.value)
  if (!safe) return []
  const pattern = `%${safe}%`
  const per = Math.ceil(limit / 2)

  const catTerms = relatedCategoryTerms(topic.value)
  const [categoryResults, byQuestion] = await Promise.all([
    Promise.all(
      catTerms.map((t) =>
        supabase.from('clue_pool').select('category, question, answer')
          .eq('round', roundName).ilike('category', `%${t}%`).limit(per),
      ),
    ),
    supabase.from('clue_pool').select('category, question, answer')
      .eq('round', roundName).ilike('question', pattern).limit(per),
  ])

  const byCategory = {
    data: categoryResults.flatMap((r) => r.data ?? []),
    error: categoryResults.every((r) => r.error) ? categoryResults[0]?.error : null,
  }

  const failures = [byCategory, byQuestion].filter((r) => r.error)
  if (failures.length === 2) {
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

  const [cat, q] = await Promise.all([
    supabase.from('clue_pool').select('category, question, answer')
      .eq('round', roundName).ilike('category', pattern).limit(limit),
    supabase.from('clue_pool').select('category, question, answer')
      .eq('round', roundName).ilike('question', pattern).limit(limit),
  ])

  const rows = [...(cat.data ?? []), ...(q.data ?? [])]
  const others = terms.filter((t) => t !== anchor)

  // Category and question only — the answer is excluded here too, so a clue
  // doesn't qualify just because the word turns up in its solution.
  const matching = rows.filter((r: any) => {
    const haystack = `${r.category ?? ''} ${r.question ?? ''}`.toLowerCase()
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

  // Each topic's clues, split back into the real categories they came from.
  // These are what actually head the columns.
  const realCategories = new Map<string, { name: string; clues: PoolClue[] }[]>()
  for (const value of distinct) {
    const topic = slotTopics.find((t) => t.value === value)!
    realCategories.set(
      value,
      groupIntoRealCategories(pools.get(value) ?? [], cluesPerCat)
        .filter((c) => categoryFitsTopic(topic, c.name)),
    )
  }

  // No board should show the same header twice, whichever topic reached it —
  // ASIAN HISTORY is tagged both geography and history.
  const usedNames = new Set<string>()
  const occurrence = new Map<string, number>() // header numbering per topic
  const clueIds: string[] = []
  let position = 0
  const thin: string[] = []

  // A clue that already went on the board must not turn up again in a
  // fallback column — the same pool feeds both paths.
  const usedQuestions = new Set<string>()
  const clueKey = (c: PoolClue) => c.question.trim().toLowerCase()

  /** The next unused clues for a topic, or null if it can't fill a column. */
  function takeLooseClues(topicValue: string): PoolClue[] | null {
    const pool = pools.get(topicValue) ?? []
    const slice: PoolClue[] = []
    for (const clue of pool) {
      if (usedQuestions.has(clueKey(clue))) continue
      slice.push(clue)
      if (slice.length === cluesPerCat) return slice
    }
    return null
  }

  /** Insert one column and its clues. Returns false if the insert failed. */
  async function writeColumn(name: string, slice: PoolClue[]): Promise<boolean> {
    const { data: cat, error: catErr } = await supabase
      .from('categories')
      .insert({ game_id: gameId, name, round_number: roundNumber, position })
      .select('id')
      .single()
    if (catErr || !cat) return false

    for (const clue of slice) usedQuestions.add(clueKey(clue))

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
    return true
  }

  /** The next real category this topic can still offer, if any. */
  function takeRealCategory(topicValue: string): { name: string; clues: PoolClue[] } | null {
    const queue = realCategories.get(topicValue) ?? []
    while (queue.length > 0) {
      const next = queue.shift()!
      if (usedNames.has(next.name.toUpperCase())) continue
      usedNames.add(next.name.toUpperCase())
      return next
    }
    return null
  }

  for (const topic of slotTopics) {
    const real = takeRealCategory(topic.value)

    if (real) {
      await writeColumn(real.name.toUpperCase(), real.clues.slice(0, cluesPerCat))
      continue
    }

    // No whole category left for this topic — fall back to a mixed column
    // under the topic's own name, which is still better than no column.
    const slice = takeLooseClues(topic.value)
    if (!slice) {
      if (!thin.includes(topic.label)) thin.push(topic.label)
      continue
    }

    const occ = occurrence.get(topic.value) ?? 0
    occurrence.set(topic.value, occ + 1)
    await writeColumn(headerFor(topic, occ), slice)
  }

  // Backfill: if some topics were too thin, top the board up from whichever
  // topics still have something left rather than failing the whole game.
  // Whole categories first here too, so a backfilled column reads like the
  // rest of the board.
  if (position < numCategories) {
    for (const value of distinct) {
      while (position < numCategories) {
        const real = takeRealCategory(value)
        if (!real) break
        await writeColumn(real.name.toUpperCase(), real.clues.slice(0, cluesPerCat))
      }
    }
  }

  if (position < numCategories) {
    for (const value of distinct) {
      if (position >= numCategories) break
      const topic = slotTopics.find((t) => t.value === value)!

      while (position < numCategories) {
        const slice = takeLooseClues(value)
        if (!slice) break

        const occ = occurrence.get(value) ?? 0
        occurrence.set(value, occ + 1)

        if (!(await writeColumn(headerFor(topic, occ), slice))) break
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
  for (const rawTopic of shuffle([...topics])) {
    const topic = resolveTopic(rawTopic)
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
      const [cat, q] = await Promise.all([
        supabase.from('clue_pool').select('category, question, answer')
          .eq('round', 'Final Jeopardy').ilike('category', pattern).limit(25),
        supabase.from('clue_pool').select('category, question, answer')
          .eq('round', 'Final Jeopardy').ilike('question', pattern).limit(25),
      ])
      rows = [...(cat.data ?? []), ...(q.data ?? [])]
    }

    if (rows.length > 0) {
      const pick = rows[Math.floor(Math.random() * rows.length)]
      return { category: pick.category, question: pick.question, answer: pick.answer }
    }
  }
  return null
}
