/**
 * J-Archive Scraper
 *
 * Scrapes all Jeopardy! games from j-archive.com and saves them as JSON.
 * The JSON can then be loaded into the Supabase clue_pool table.
 *
 * Usage: npm run scrape
 *
 * Options (env vars):
 *   SEASONS=1,2,3     - Only scrape specific seasons (default: all)
 *   DELAY=2000         - Delay between requests in ms (default: 1500)
 *   OUTPUT=data.json   - Output file path (default: jarchive-data.json)
 *   RESUME=true        - Resume from existing output file (skip already-scraped games)
 */

import * as fs from 'fs'
import * as path from 'path'
import * as cheerio from 'cheerio'

const BASE_URL = 'https://j-archive.com'
const DELAY_MS = parseInt(process.env.DELAY || '1500')
const OUTPUT_FILE = path.resolve(__dirname, '../../', process.env.OUTPUT || 'jarchive-data.json')
const RESUME = process.env.RESUME === 'true'

// All known seasons (regular + special)
const ALL_SEASONS = [
  '1','2','3','4','5','6','7','8','9','10',
  '11','12','13','14','15','16','17','18','19','20',
  '21','22','23','24','25','26','27','28','29','30',
  '31','32','33','34','35','36','37','38','39','40',
  '41','42',
  'bbab','cwcpi','goattournament','jm','ncc','pcj','superjeopardy','trebekpilots'
]

interface ScrapedClue {
  game_id_source: number
  category: string
  round: string
  question: string
  answer: string
  value: number
  is_daily_double: boolean
  air_date: string | null
  game_title: string
  player1: string
  player2: string
  player3: string
  season: string
  notes: string
}

interface GameListing {
  gameId: number
  title: string
  airDate: string | null
  players: string
  notes: string
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchPage(url: string, retries = 3): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'JeopardyGameApp/1.0 (personal project)',
          'Accept': 'text/html',
        },
      })
      if (!response.ok) {
        if (response.status === 429) {
          console.log(`  Rate limited, waiting 30s...`)
          await sleep(30000)
          continue
        }
        throw new Error(`HTTP ${response.status}`)
      }
      return await response.text()
    } catch (err: any) {
      console.log(`  Fetch error (attempt ${attempt}/${retries}): ${err.message}`)
      if (attempt < retries) {
        await sleep(5000 * attempt)
      }
    }
  }
  return ''
}

async function getGameIdsFromSeason(season: string): Promise<GameListing[]> {
  const url = `${BASE_URL}/showseason.php?season=${season}`
  const html = await fetchPage(url)
  if (!html) return []

  const $ = cheerio.load(html)
  const games: GameListing[] = []

  // Each game is in a table row with a link to showgame.php
  $('table tr').each((_, row) => {
    const $row = $(row)
    const link = $row.find('a[href*="showgame.php?game_id="]')
    if (!link.length) return

    const href = link.attr('href') || ''
    const gameIdMatch = href.match(/game_id=(\d+)/)
    if (!gameIdMatch) return

    const gameId = parseInt(gameIdMatch[1])
    const linkText = link.text().trim()

    // Extract air date from link text like "#9155, aired 2024-07-26"
    // The &nbsp; is decoded as \u00a0
    const dateMatch = linkText.match(/aired\s*(\d{4}-\d{2}-\d{2})/)
    const airDate = dateMatch ? dateMatch[1] : null

    // Players are in the second td, notes in the third
    const tds = $row.find('td')
    const players = tds.eq(1).text().trim()
    const notes = tds.eq(2).text().trim()

    games.push({
      gameId,
      title: linkText.replace(/\u00a0/g, ' '),
      airDate,
      players,
      notes,
    })
  })

  return games
}

function parseRoundClues(
  $: cheerio.CheerioAPI,
  roundSelector: string,
  roundName: string
): Array<{ category: string; question: string; answer: string; value: number; isDailyDouble: boolean }> {
  const clues: Array<{ category: string; question: string; answer: string; value: number; isDailyDouble: boolean }> = []
  const $round = $(roundSelector)
  if (!$round.length) return clues

  const $table = $round.find('table.round')
  if (!$table.length) return clues

  // Get direct rows of the round table (not nested inner table rows)
  const directRows = $table.children('tbody').children('tr')

  // Get categories from the first row
  const categories: string[] = []
  directRows.first().children('td.category').each((_, td) => {
    const name = $(td).find('td.category_name').text().trim()
    categories.push(name)
  })

  if (categories.length === 0) return clues

  // Parse clue rows (rows after the category header row)
  const rows = directRows.toArray()
  for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
    const $cells = $(rows[rowIdx]).children('td.clue')

    $cells.each((colIdx, cell) => {
      const $cell = $(cell)
      const category = categories[colIdx] || ''
      if (!category) return

      // Get value
      const $valueCell = $cell.find('td.clue_value')
      const $ddValueCell = $cell.find('td.clue_value_daily_double')
      const isDailyDouble = $ddValueCell.length > 0

      let value = 0
      const valueText = ($valueCell.length ? $valueCell.text() : $ddValueCell.text()).replace(/[^0-9]/g, '')
      value = parseInt(valueText) || 0

      // For daily doubles, use the standard value based on position
      // Row 1 = $200/$400, Row 2 = $400/$800, etc.
      if (isDailyDouble && roundName === 'Jeopardy Round') {
        value = rowIdx * 200
      } else if (isDailyDouble && roundName === 'Double Jeopardy') {
        value = rowIdx * 400
      }

      // Get clue text - the visible td (not the hidden _r one)
      // Clue IDs follow pattern: clue_J_col_row or clue_DJ_col_row
      const prefix = roundName === 'Jeopardy Round' ? 'J' : 'DJ'
      const clueId = `clue_${prefix}_${colIdx + 1}_${rowIdx}`
      const $clueText = $cell.find(`#${clueId}`)
      const question = $clueText.text().trim()

      // Get answer from the hidden response td
      const $responseText = $cell.find(`#${clueId}_r`)
      const answer = $responseText.find('em.correct_response').text().trim()

      if (question && answer) {
        clues.push({ category, question, answer, value, isDailyDouble })
      }
    })
  }

  return clues
}

function parseFinalJeopardy(
  $: cheerio.CheerioAPI
): { category: string; question: string; answer: string } | null {
  const $fj = $('#final_jeopardy_round')
  if (!$fj.length) return null

  const category = $fj.find('td.category_name').text().trim()
  const question = $fj.find('#clue_FJ').text().trim()
  const answer = $fj.find('em.correct_response').text().trim()

  if (category && question && answer) {
    return { category, question, answer }
  }
  return null
}

async function scrapeGame(gameId: number, season: string, listing: GameListing): Promise<ScrapedClue[]> {
  const url = `${BASE_URL}/showgame.php?game_id=${gameId}`
  const html = await fetchPage(url)
  if (!html) return []

  const $ = cheerio.load(html)
  const clues: ScrapedClue[] = []

  // Get game title from page
  const gameTitle = $('#game_title h1').text().trim() || listing.title

  // Get air date from title like "Show #652 - Tuesday, June 9, 1987"
  // Or use the listing's air date
  let airDate = listing.airDate
  if (!airDate) {
    const titleTag = $('title').text()
    const titleDateMatch = titleTag.match(/aired\s*(\d{4}-\d{2}-\d{2})/)
    if (titleDateMatch) airDate = titleDateMatch[1]
  }

  // Get notes from game page comments + season listing notes
  const gameComments = $('#game_comments').text().trim()
  const notes = [listing.notes, gameComments].filter(Boolean).join('. ').trim()

  // Get player names
  const playerNames: string[] = []
  $('p.contestants a').each((_, el) => {
    const name = $(el).text().trim()
    if (name) playerNames.push(name)
  })

  const player1 = playerNames[0] || ''
  const player2 = playerNames[1] || ''
  const player3 = playerNames[2] || ''

  const baseFields = {
    game_id_source: gameId,
    air_date: airDate,
    game_title: gameTitle,
    player1,
    player2,
    player3,
    season,
    notes,
  }

  // Parse Jeopardy Round
  for (const clue of parseRoundClues($, '#jeopardy_round', 'Jeopardy Round')) {
    clues.push({ ...baseFields, category: clue.category, round: 'Jeopardy Round', question: clue.question, answer: clue.answer, value: clue.value, is_daily_double: clue.isDailyDouble })
  }

  // Parse Double Jeopardy Round
  for (const clue of parseRoundClues($, '#double_jeopardy_round', 'Double Jeopardy')) {
    clues.push({ ...baseFields, category: clue.category, round: 'Double Jeopardy', question: clue.question, answer: clue.answer, value: clue.value, is_daily_double: clue.isDailyDouble })
  }

  // Parse Final Jeopardy
  const fj = parseFinalJeopardy($)
  if (fj) {
    clues.push({ ...baseFields, category: fj.category, round: 'Final Jeopardy', question: fj.question, answer: fj.answer, value: 0, is_daily_double: false })
  }

  return clues
}

async function main() {
  const seasons = process.env.SEASONS
    ? process.env.SEASONS.split(',').map(s => s.trim())
    : ALL_SEASONS

  console.log(`=== J-Archive Scraper ===`)
  console.log(`Seasons to scrape: ${seasons.join(', ')}`)
  console.log(`Delay between requests: ${DELAY_MS}ms`)
  console.log(`Output file: ${OUTPUT_FILE}`)
  console.log()

  // Load existing data if resuming
  let allClues: ScrapedClue[] = []
  const scrapedGameIds = new Set<number>()

  if (RESUME && fs.existsSync(OUTPUT_FILE)) {
    console.log(`Resuming from existing file...`)
    const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'))
    allClues = existing
    for (const clue of allClues) {
      scrapedGameIds.add(clue.game_id_source)
    }
    console.log(`Loaded ${allClues.length} existing clues from ${scrapedGameIds.size} games`)
    console.log()
  }

  let totalGames = 0
  let totalNewClues = 0

  for (const season of seasons) {
    console.log(`--- Season ${season} ---`)
    const listings = await getGameIdsFromSeason(season)
    console.log(`  Found ${listings.length} games`)

    if (listings.length === 0) {
      await sleep(DELAY_MS)
      continue
    }

    let seasonGames = 0
    let seasonClues = 0

    for (const listing of listings) {
      if (scrapedGameIds.has(listing.gameId)) {
        continue
      }

      await sleep(DELAY_MS)

      const clues = await scrapeGame(listing.gameId, season, listing)
      if (clues.length > 0) {
        allClues.push(...clues)
        scrapedGameIds.add(listing.gameId)
        seasonGames++
        seasonClues += clues.length
        totalGames++
        totalNewClues += clues.length

        // Save progress every 50 games
        if (totalGames % 50 === 0) {
          fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allClues))
          console.log(`    [checkpoint] Saved ${allClues.length} total clues from ${scrapedGameIds.size} games`)
        }
      }

      // Log progress
      if (seasonGames % 10 === 0 && seasonGames > 0) {
        console.log(`    Scraped ${seasonGames}/${listings.length} games (${seasonClues} clues)`)
      }
    }

    console.log(`  Season ${season} done: ${seasonGames} new games, ${seasonClues} new clues`)

    // Save after each season
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allClues))
  }

  // Final save with pretty printing
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allClues))

  console.log()
  console.log(`=== COMPLETE ===`)
  console.log(`Total games scraped: ${scrapedGameIds.size}`)
  console.log(`Total clues: ${allClues.length}`)
  console.log(`New in this run: ${totalGames} games, ${totalNewClues} clues`)
  console.log(`Output: ${OUTPUT_FILE}`)

  // Stats
  const roundCounts = new Map<string, number>()
  const seasonCounts = new Map<string, number>()
  for (const c of allClues) {
    roundCounts.set(c.round, (roundCounts.get(c.round) || 0) + 1)
    seasonCounts.set(c.season, (seasonCounts.get(c.season) || 0) + 1)
  }
  console.log(`\nBy round:`)
  for (const [round, count] of roundCounts) {
    console.log(`  ${round}: ${count} clues`)
  }
  console.log(`\nBy season (top 10):`)
  const sortedSeasons = [...seasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  for (const [s, count] of sortedSeasons) {
    console.log(`  Season ${s}: ${count} clues`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
