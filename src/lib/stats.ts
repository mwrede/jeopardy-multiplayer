/**
 * Usage stats, read straight out of the game tables.
 *
 * No tracking script is involved and none of this is sampled: these are the
 * actual games, players and buzzes, going back to the first one. Analytics can
 * tell you someone opened /find; only this knows which board they picked, how
 * many people sat down, and where they stopped.
 *
 * Aggregation happens here rather than in SQL because PostgREST can't GROUP BY
 * without a stored function, and a stored function means a hand-run migration.
 * The row counts are small (hundreds of games, thousands of buzzes) and each
 * query asks for only the columns it needs, so pulling and folding in the
 * browser is cheaper than it sounds. CAPS keeps that honest as the app grows —
 * when a number is capped the page says so rather than quietly under-reporting.
 */

import { supabase } from './supabase'

const CAP = { games: 5000, players: 20000, buzzes: 20000 }

/** PostgREST caps a single response at its own max-rows, whatever .limit()
 *  says — 1,000 here. Asking for 20,000 buzzes quietly returned 1,000 and the
 *  page reported that as the total. So read in pages until one comes back
 *  short, or the cap is reached. */
const PAGE = 1000

async function readAll<T>(
  table: string,
  columns: string,
  cap: number,
  order?: { column: string; ascending: boolean },
): Promise<{ rows: T[]; capped: boolean }> {
  const rows: T[] = []
  for (let from = 0; from < cap; from += PAGE) {
    let q = supabase.from(table).select(columns)
    if (order) q = q.order(order.column, { ascending: order.ascending })
    const { data, error } = await q.range(from, Math.min(from + PAGE, cap) - 1)
    if (error) throw error
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE) return { rows, capped: false }
  }
  return { rows, capped: true }
}

export type Slice = { label: string; count: number }

export type Stats = {
  totals: {
    games: number
    finished: number
    seats: number
    people: number
    buzzes: number
    judged: number
    capped: boolean
  }
  funnel: { label: string; count: number; note: string }[]
  byWeek: { week: string; games: number }[]
  modes: Slice[]
  sizes: Slice[]
  sources: Slice[]
  seatsPerGame: Slice[]
  topBoards: { kind: string; key: string; count: number }[]
  answers: { correct: number; wrong: number; passed: number }
  reaction: { median: number | null; quick: number | null; n: number }
  firstGame: string | null
}

/** Monday of the week a timestamp falls in, as YYYY-MM-DD. */
function weekOf(iso: string): string {
  const d = new Date(iso)
  const day = (d.getUTCDay() + 6) % 7 // Monday = 0
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}

/** Sort a tally into a descending slice list. */
function slices(counts: Map<string, number>, order?: string[]): Slice[] {
  const out = [...counts.entries()].map(([label, count]) => ({ label, count }))
  if (order) {
    out.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
  } else {
    out.sort((a, b) => b.count - a.count)
  }
  return out
}

/** What a game's settings say it was built from. */
function sourceOf(s: any): string {
  if (!s) return 'Random board'
  if (s.sourceGameId) return 'A real episode'
  if (s.boardTopics) return 'Build your own'
  if (s.categoryThemes || s.categoryTheme) return 'Themed mashup'
  if (s.customBoardId || s.customBoard) return 'Custom board'
  return 'Random board'
}

export async function loadStats(): Promise<Stats> {
  const [gamesRead, playersRead, buzzesRead, countsRes] = await Promise.all([
    readAll<any>('games', 'id, status, created_at, settings', CAP.games, {
      column: 'created_at', ascending: false,
    }),
    readAll<any>('players', 'game_id, name', CAP.players),
    readAll<any>('buzzes', 'is_correct, is_pass, reaction_ms', CAP.buzzes),
    supabase.from('play_counts').select('kind, key, count').order('count', { ascending: false }).limit(12),
  ])

  const games = gamesRead.rows
  const players = playersRead.rows
  const buzzes = buzzesRead.rows

  // ── Seats, and the games that were run by a host ──────────────────────────
  // createPresentationGame seeds a player literally called "Presenter", which
  // is the only reliable fingerprint of a hosted game: it writes gameMode
  // 'party' like every other non-multiplayer game, so settings can't tell them
  // apart. The Presenter is furniture, not a contestant, so it never counts as
  // a seat either.
  const seatsByGame = new Map<string, number>()
  const hostedGames = new Set<string>()
  const names = new Set<string>()
  for (const p of players as any[]) {
    if (p.name === 'Presenter') { hostedGames.add(p.game_id); continue }
    seatsByGame.set(p.game_id, (seatsByGame.get(p.game_id) ?? 0) + 1)
    const n = (p.name || '').trim().toLowerCase()
    if (n) names.add(n)
  }

  // ── Funnel ────────────────────────────────────────────────────────────────
  const started = games.filter((g: any) => !['lobby', 'starting'].includes(g.status))
  const reachedFinal = games.filter((g: any) => ['final_jeopardy', 'finished'].includes(g.status))
  const finished = games.filter((g: any) => g.status === 'finished')

  // ── Tallies ───────────────────────────────────────────────────────────────
  const byWeek = new Map<string, number>()
  const modes = new Map<string, number>()
  const sizes = new Map<string, number>()
  const sources = new Map<string, number>()
  const seatCounts = new Map<string, number>()

  for (const g of games as any[]) {
    byWeek.set(weekOf(g.created_at), (byWeek.get(weekOf(g.created_at)) ?? 0) + 1)

    const s = g.settings || {}
    const mode = hostedGames.has(g.id)
      ? 'Hosted'
      : s.gameMode === 'multiplayer'
        ? 'Just phones'
        : 'Shared screen'
    modes.set(mode, (modes.get(mode) ?? 0) + 1)

    const size = { full: 'Full 6×5', half: 'Half 6×3', rapid: 'Rapid 3×3' }[s.gameLength as string] || 'Full 6×5'
    sizes.set(size, (sizes.get(size) ?? 0) + 1)

    const src = sourceOf(s)
    sources.set(src, (sources.get(src) ?? 0) + 1)

    const n = seatsByGame.get(g.id) ?? 0
    const bucket = n === 0 ? 'Nobody joined' : n === 1 ? '1 player' : `${n} players`
    seatCounts.set(bucket, (seatCounts.get(bucket) ?? 0) + 1)
  }

  // ── Answers and buzz speed ────────────────────────────────────────────────
  let correct = 0, wrong = 0, passed = 0
  const reactions: number[] = []
  for (const b of buzzes as any[]) {
    if (b.is_pass) passed++
    else if (b.is_correct === true) correct++
    else if (b.is_correct === false) wrong++
    // Floor of 120ms: simple visual reaction bottoms out around 100ms, so
    // anything faster is a device whose clock drifted, not a record. Reporting
    // "fastest ever 8ms" as a headline is just showing off a bug.
    if (typeof b.reaction_ms === 'number' && b.reaction_ms >= 120 && b.reaction_ms < 10000) {
      reactions.push(b.reaction_ms)
    }
  }
  reactions.sort((a, b) => a - b)

  const weeks = [...byWeek.entries()]
    .map(([week, n]) => ({ week, games: n }))
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-20)

  const oldest = games.length ? (games[games.length - 1] as any).created_at : null

  return {
    totals: {
      games: games.length,
      finished: finished.length,
      seats: [...seatsByGame.values()].reduce((a, b) => a + b, 0),
      people: names.size,
      buzzes: buzzes.length,
      judged: correct + wrong,
      capped: gamesRead.capped || playersRead.capped || buzzesRead.capped,
    },
    funnel: [
      { label: 'Room made', count: games.length, note: 'someone hit Play' },
      { label: 'Game started', count: started.length, note: 'past the lobby' },
      { label: 'Reached Final', count: reachedFinal.length, note: 'played the whole board' },
      { label: 'Finished', count: finished.length, note: 'saw the results screen' },
    ],
    byWeek: weeks,
    modes: slices(modes),
    sizes: slices(sizes, ['Full 6×5', 'Half 6×3', 'Rapid 3×3']),
    sources: slices(sources),
    seatsPerGame: [...seatCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => (parseInt(a.label, 10) || 0) - (parseInt(b.label, 10) || 0)),
    topBoards: (countsRes.data ?? []) as any,
    answers: { correct, wrong, passed },
    reaction: {
      median: reactions.length ? reactions[Math.floor(reactions.length / 2)] : null,
      // The tenth percentile rather than the single fastest: one device with a
      // drifted clock owns "fastest ever" forever, and the floor above was
      // already doing the reporting ("fastest 120ms" when 120 is the cutoff).
      quick: reactions.length ? reactions[Math.floor(reactions.length * 0.1)] : null,
      n: reactions.length,
    },
    firstGame: oldest,
  }
}
