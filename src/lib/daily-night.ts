/**
 * THE NIGHT ITSELF — the three people who actually played the board of the day.
 *
 * Every daily board is nine-plus-nine clues lifted from one real episode, and
 * J-Archive records that episode clue by clue: who rang in, whether they were
 * right, what they wagered on a Daily Double, and how Final went. The same
 * `/api/episode/[gameId]` route the Campaign runs on gives us all of it, so the
 * daily can do what a solo board otherwise can't — tell you what the clue you
 * just missed did to three people on television, and what you have to beat.
 *
 * Two numbers per contestant, and they answer different questions:
 *
 *   · ON THESE CLUES — what they made on the eighteen clues that are actually
 *     on your board, at your board's values, plus their Final. This is the
 *     score to beat, because it's the only one you're playing for.
 *   · THAT NIGHT — what they really finished with, over all sixty-odd clues.
 *     Context, not a target.
 *
 * It is an ESTIMATE and says so on the page. A daily board is three of the
 * night's six categories at normalised values, so a Daily Double wager is
 * scaled to what the cell is worth here, and a Final wager is capped at what
 * they'd have been holding on this board. Nobody's real game is being
 * misreported — it's their real answers, re-scored on a smaller board.
 *
 * Everything here fails soft: no episode, no match, no network, and the daily
 * simply doesn't mention contestants.
 */

import { fetchEpisode, type ClueResponse, type EpisodeClue } from './episode'
import { ROUND_VALUES, type DailyBoard } from './daily-data'

export type ContestantLine = {
  /** As the results name them — usually the first name. */
  name: string
  full: string
  /** Their money on YOUR board: these eighteen clues, your values, their Final. */
  onBoard: number
  /**
   * What they scored across the night's whole board — every clue, real values,
   * real wagers. For an ordinary episode that is exactly what they won; for a
   * tournament final played over two games it is this game's half of it.
   */
  night: number
  /** How many of your eighteen they got right. */
  correct: number
  /** Won the real game. */
  won: boolean
}

export type DailyNight = {
  gameId: number
  contestants: ContestantLine[]
  /** Who rang in on one of your clues, in order. Empty = nobody did. */
  responsesFor: (rd: number, c: number, r: number) => ClueResponse[]
  /** Who got Final right that night, with what they wagered. */
  finalResponses: { name: string; right: boolean; wager: number }[]
}

/** Clue text as an identity: J-Archive and clue_pool disagree about markup. */
function key(s: string): string {
  return s
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * A wager made on a bigger board, brought down to this one. A $4,000 bet on a
 * $1,000 cell is four times the cell; on our $600 version of that cell it's
 * $2,400. Rounded to the hundred, never less than the cell is worth.
 */
function scaleWager(wager: number, realValue: number, ourValue: number): number {
  if (!realValue || realValue <= 0) return Math.max(wager, ourValue)
  const scaled = Math.round((wager * ourValue) / realValue / 100) * 100
  return Math.max(ourValue, scaled)
}

export async function loadDailyNight(board: DailyBoard): Promise<DailyNight | null> {
  const episode = await fetchEpisode(board.day.gameId)
  if (!episode || episode.contestants.length === 0) return null

  /* Match our clues to the night's by their text. The boards were cut from the
     same archive, so this is an identity rather than a guess — but a clue that
     doesn't match is simply skipped rather than mis-scored. */
  const index = new Map<string, { clue: EpisodeClue; rd: number }>()
  episode.rounds.forEach((round, i) => {
    for (const clue of round.clues) index.set(key(clue.question), { clue, rd: i + 1 })
  })

  const mine = new Map<string, EpisodeClue>()
  for (const rd of [1, 2] as const) {
    board.rounds[rd - 1].forEach((cat, c) => {
      cat.clues.forEach((clue, r) => {
        const hit = index.get(key(clue.q))
        if (hit) mine.set(`${rd}:${c}:${r}`, hit.clue)
      })
    })
  }

  /* On these clues, at these values. A name that rang in right takes the cell;
     wrong gives it back, exactly as the show scores it. */
  const onBoard = new Map<string, number>()
  const correct = new Map<string, number>()
  for (const c of episode.contestants) {
    onBoard.set(c.first, 0)
    correct.set(c.first, 0)
  }
  const add = (name: string, delta: number) => {
    const cur = onBoard.get(name)
    if (cur === undefined) return // somebody the contestant list doesn't know
    onBoard.set(name, cur + delta)
  }

  for (const [at, clue] of mine) {
    const [rdStr, , rStr] = at.split(':')
    const ourValue = ROUND_VALUES[Number(rdStr) - 1][Number(rStr)]
    for (const resp of clue.responses) {
      const stake =
        clue.ddWager != null ? scaleWager(clue.ddWager, clue.value, ourValue) : ourValue
      add(resp.name, resp.right ? stake : -stake)
      if (resp.right) correct.set(resp.name, (correct.get(resp.name) ?? 0) + 1)
    }
  }

  // Final, wagered out of what they're holding HERE rather than what they had.
  for (const f of episode.final?.responses ?? []) {
    const held = onBoard.get(f.name)
    if (held === undefined) continue
    const stake = Math.max(0, Math.min(f.wager, Math.max(0, held)))
    add(f.name, f.right ? stake : -stake)
  }

  /* And what they really finished with: every clue of the real board at its
     real value, plus the real Final. */
  const night = new Map<string, number>()
  for (const c of episode.contestants) night.set(c.first, 0)
  for (const round of episode.rounds) {
    for (const clue of round.clues) {
      for (const resp of clue.responses) {
        const cur = night.get(resp.name)
        if (cur === undefined) continue
        const stake = clue.ddWager ?? clue.value
        night.set(resp.name, cur + (resp.right ? stake : -stake))
      }
    }
  }
  for (const f of episode.final?.responses ?? []) {
    const cur = night.get(f.name)
    if (cur === undefined) continue
    night.set(f.name, cur + (f.right ? f.wager : -f.wager))
  }

  /* The night's winner. Normally the biggest total; named explicitly where the
     format makes that wrong (a two-game tournament final carries scores over). */
  const best = Math.max(...episode.contestants.map((c) => night.get(c.first) ?? 0))
  const named = board.day.winner
  const contestants: ContestantLine[] = episode.contestants.map((c) => ({
    name: c.first,
    full: c.name,
    onBoard: onBoard.get(c.first) ?? 0,
    night: night.get(c.first) ?? 0,
    correct: correct.get(c.first) ?? 0,
    won: named ? c.first === named : (night.get(c.first) ?? 0) === best && best > 0,
  }))

  return {
    gameId: board.day.gameId,
    contestants,
    responsesFor: (rd, c, r) => mine.get(`${rd}:${c}:${r}`)?.responses ?? [],
    finalResponses: (episode.final?.responses ?? []).map((f) => ({
      name: f.name,
      right: f.right,
      wager: f.wager,
    })),
  }
}
