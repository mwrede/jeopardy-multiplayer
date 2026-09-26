/**
 * One real episode, clue by clue, from J-Archive.
 *
 * Every clue on the archive page carries a hidden response block naming who
 * rang in and whether they were right — <td class="right">Sean</td> — plus
 * the Daily Double wager on the cell and each contestant's Final Jeopardy
 * wager and written answer. That's a complete record of how the night went,
 * which is what a campaign game plays against.
 *
 * Read live and cached a week per episode, for the same reason the scores
 * route is: old episodes never change and a table would mean a migration plus
 * a 9,400-game backfill.
 */

import { NextResponse } from 'next/server'
import * as cheerio from 'cheerio'
import type {
  ClueResponse, Episode, EpisodeClue, EpisodeContestant, EpisodeFinal, EpisodeRound, FinalResponse,
} from '@/lib/episode'

export const revalidate = 604800

function money(text: string): number | null {
  const cleaned = text.replace(/[^0-9-]/g, '')
  if (!cleaned) return null
  const n = parseInt(cleaned, 10)
  return Number.isFinite(n) ? n : null
}

function parseContestants($: cheerio.CheerioAPI): EpisodeContestant[] {
  const out: EpisodeContestant[] = []
  $('p.contestants').each((i, el) => {
    if (i > 2) return
    const name = $(el).find('a').first().text().trim()
    // ", a phd student from Chicago, Illinois (whose 1-day cash winnings total $17,601)"
    let rest = $(el).text().replace(name, '').replace(/^\s*,\s*/, '').trim()
    let note: string | null = null
    const paren = rest.match(/\(([^)]*)\)\s*$/)
    if (paren) { note = paren[1].trim(); rest = rest.slice(0, paren.index).trim() }
    const at = rest.lastIndexOf(' from ')
    let occupation = rest, hometown = ''
    if (at >= 0) { occupation = rest.slice(0, at); hometown = rest.slice(at + 6) }
    occupation = occupation.replace(/^(an?|the)\s+/i, '').trim()
    out.push({
      seat: i as 0 | 1 | 2,
      name,
      first: name.split(/\s+/)[0] || name,
      occupation,
      hometown: hometown.trim(),
      note,
    })
  })
  return out
}

/** The nicknames the results use, matched to full names. */
function applyNicknames($: cheerio.CheerioAPI, contestants: EpisodeContestant[]) {
  const nicks: string[] = []
  $('td.score_player_nickname').each((_, td) => {
    const n = $(td).text().trim()
    if (n && !nicks.includes(n)) nicks.push(n)
  })
  for (const nick of nicks) {
    const c = contestants.find((x) => x.name.toLowerCase().startsWith(nick.toLowerCase()))
    if (c) c.first = nick
  }
}

function parseResponses($: cheerio.CheerioAPI, el: cheerio.Cheerio<any>): ClueResponse[] {
  const out: ClueResponse[] = []
  el.find('td.right, td.wrong').each((_, td) => {
    const name = $(td).text().trim()
    if (!name || /triple stumper/i.test(name)) return
    out.push({ name, right: $(td).hasClass('right') })
  })
  return out
}

function parseRound($: cheerio.CheerioAPI, rootSel: string, prefix: 'J' | 'DJ'): EpisodeRound {
  const root = $(rootSel)
  const categories: string[] = []
  root.find('table.round td.category_name').each((_, td) => { categories.push($(td).text().trim()) })

  const clues: EpisodeClue[] = []
  // First pass finds the row-1 face value, so Daily Doubles (whose cell shows
  // the wager, not the value) can be given the value the row is worth.
  let base = prefix === 'J' ? 200 : 400
  for (let c = 1; c <= categories.length; c++) {
    const v = $(`#clue_${prefix}_${c}_1`).closest('td.clue').find('td.clue_value').text()
    const n = money(v)
    if (n) { base = n; break }
  }

  for (let c = 1; c <= categories.length; c++) {
    for (let r = 1; r <= 5; r++) {
      const q = $(`#clue_${prefix}_${c}_${r}`)
      if (!q.length) continue
      const cell = q.closest('td.clue')
      const ddText = cell.find('td.clue_value_daily_double').text()
      const ddWager = ddText ? money(ddText) : null
      const face = ddWager != null ? base * r : (money(cell.find('td.clue_value').text()) ?? base * r)
      const resp = $(`#clue_${prefix}_${c}_${r}_r`)
      const answer = resp.find('em.correct_response').text().trim()
      const question = q.text().trim()
      if (!question || !answer) continue
      clues.push({
        c: c - 1,
        r: r - 1,
        value: face,
        order: money(cell.find('td.clue_order_number').text()),
        question,
        answer,
        ddWager,
        responses: parseResponses($, resp),
      })
    }
  }
  return { categories, clues }
}

function parseFinal($: cheerio.CheerioAPI): EpisodeFinal {
  const root = $('#final_jeopardy_round')
  if (!root.length) return null
  const category = root.find('td.category_name').first().text().trim()
  const question = $('#clue_FJ').text().trim()
  const resp = $('#clue_FJ_r')
  const answer = resp.find('em.correct_response').text().trim()
  if (!category || !question || !answer) return null

  // Rows alternate: [right|wrong name][written answer] then [wager].
  const responses: FinalResponse[] = []
  let pending: Omit<FinalResponse, 'wager'> | null = null
  resp.find('table tr').each((_, tr) => {
    const tds = $(tr).children('td')
    const first = tds.first()
    if (first.hasClass('right') || first.hasClass('wrong')) {
      pending = { name: first.text().trim(), right: first.hasClass('right'), written: tds.eq(1).text().trim() }
    } else if (pending) {
      responses.push({ ...pending, wager: money(first.text()) ?? 0 })
      pending = null
    }
  })
  return { category, question, answer, responses }
}

export async function GET(_req: Request, { params }: { params: { gameId: string } }) {
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
    if (!res.ok) return NextResponse.json({ unavailable: true })
    html = await res.text()
  } catch {
    return NextResponse.json({ unavailable: true })
  }

  const $ = cheerio.load(html)
  const contestants = parseContestants($)
  applyNicknames($, contestants)
  const rounds: [EpisodeRound, EpisodeRound] = [
    parseRound($, '#jeopardy_round', 'J'),
    parseRound($, '#double_jeopardy_round', 'DJ'),
  ]
  if (contestants.length === 0 || rounds[0].clues.length === 0) {
    return NextResponse.json({ unavailable: true })
  }
  const heading = $('#game_title h1').text().trim()
  const episode: Episode = {
    gameId,
    title: heading,
    airedOn: heading.split(' - ').slice(1).join(' - ').trim() || null,
    contestants,
    rounds,
    final: parseFinal($),
  }
  return NextResponse.json(episode)
}
