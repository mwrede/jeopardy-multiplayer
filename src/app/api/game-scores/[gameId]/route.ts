/**
 * What the real contestants scored on this episode.
 *
 * Read live from J-Archive rather than mirrored into a table: the archive
 * publishes the score lines on the game page already, old episodes never
 * change, and a table would have meant a migration plus a multi-hour backfill
 * of 9,400 games to answer a question about the one game you're looking at.
 * Vercel caches each response for a week, so a popular game is fetched once.
 */

import { NextResponse } from 'next/server'
import * as cheerio from 'cheerio'

export const revalidate = 604800 // a week

type Contestant = {
  nickname: string
  /** Score at the end of the Jeopardy! round. */
  afterRound1: number | null
  /** Score at the end of Double Jeopardy!, i.e. going into Final. */
  afterRound2: number | null
  /** Score after Final Jeopardy — what they actually walked away with. */
  final: number | null
}

/** "$22,400" / "$-1,000" → 22400 / -1000. */
function money(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!cleaned) return null
  const n = parseInt(cleaned, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Read one of J-Archive's score tables. They're headed by an <h3> and hold a
 * row of nicknames over a row of dollar amounts, in matching column order.
 */
function readScoreTable($: cheerio.CheerioAPI, headingContains: string) {
  const heading = $('h3').filter((_, el) => $(el).text().includes(headingContains)).first()
  if (!heading.length) return null

  const table = heading.nextAll('table').first()
  if (!table.length) return null

  const names: string[] = []
  table.find('td.score_player_nickname').each((_, td) => { names.push($(td).text().trim()) })

  const scores: (number | null)[] = []
  table.find('td.score_positive, td.score_negative').each((_, td) => { scores.push(money($(td).text())) })

  if (names.length === 0) return null
  return { names, scores }
}

export async function GET(
  _req: Request,
  { params }: { params: { gameId: string } },
) {
  const gameId = parseInt(params.gameId, 10)
  if (!Number.isFinite(gameId) || gameId <= 0) {
    return NextResponse.json({ error: 'Bad game id' }, { status: 400 })
  }

  let html: string
  try {
    const res = await fetch(`https://j-archive.com/showgame.php?game_id=${gameId}`, {
      headers: { 'User-Agent': 'JeopardyGameApp/1.0 (personal project)' },
      next: { revalidate },
    })
    if (!res.ok) {
      return NextResponse.json({ contestants: [], unavailable: true }, { status: 200 })
    }
    html = await res.text()
  } catch {
    // A scoreboard is a nice-to-have on a preview screen. Never fail the
    // preview over it — the caller just doesn't draw the panel.
    return NextResponse.json({ contestants: [], unavailable: true }, { status: 200 })
  }

  const $ = cheerio.load(html)

  const r1 = readScoreTable($, 'end of the Jeopardy! Round')
  const r2 = readScoreTable($, 'end of the Double Jeopardy! Round')
  const fin = readScoreTable($, 'Final scores')

  // The nickname rows are the join key: a player can appear in a different
  // column order between tables, and the full names in the contestants line
  // aren't what these tables use.
  const order = fin?.names ?? r2?.names ?? r1?.names ?? []
  const at = (t: { names: string[]; scores: (number | null)[] } | null, name: string) => {
    if (!t) return null
    const i = t.names.indexOf(name)
    return i >= 0 ? (t.scores[i] ?? null) : null
  }

  const contestants: Contestant[] = order.map((nickname) => ({
    nickname,
    afterRound1: at(r1, nickname),
    afterRound2: at(r2, nickname),
    final: at(fin, nickname),
  }))

  return NextResponse.json({ contestants, unavailable: contestants.length === 0 })
}
