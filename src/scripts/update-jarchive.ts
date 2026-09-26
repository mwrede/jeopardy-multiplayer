/**
 * Catch up on new J-Archive games.
 *
 * Unlike `npm run scrape` (which re-walks every season into a JSON file),
 * this asks the season listing what games exist, skips the ones already in
 * clue_pool, and inserts only what's new. Safe to run repeatedly — running it
 * twice in a row is a no-op the second time.
 *
 * Usage: npm run update:jarchive
 *
 * Options (env vars):
 *   SEASONS=42,43   - Seasons to check (default: 42,43 — the current two)
 *   DELAY=1500      - Delay between J-Archive requests in ms
 *   DRY=true        - Report what would be added, insert nothing
 */

import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import { getGameIdsFromSeason, scrapeGame } from './scrape-jarchive'

const envPath = path.join(__dirname, '../../.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const [key, ...rest] = line.split('=')
    if (key && rest.length > 0) process.env[key.trim()] = rest.join('=').trim()
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const SEASONS = (process.env.SEASONS || '42,43').split(',').map((s) => s.trim()).filter(Boolean)
const DELAY_MS = parseInt(process.env.DELAY || '1500')
const DRY = process.env.DRY === 'true'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Is this game already seeded? One indexed lookup per game id — cheaper and
 * far more reliable than pulling every distinct id out of a 600k-row table,
 * which times out.
 */
async function alreadyHave(gameId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('clue_pool')
    .select('game_id_source')
    .eq('game_id_source', gameId)
    .limit(1)
  if (error) throw new Error(`lookup failed for game ${gameId}: ${error.message}`)
  return (data?.length ?? 0) > 0
}

async function main() {
  console.log(`=== J-Archive catch-up ===`)
  console.log(`Seasons: ${SEASONS.join(', ')}${DRY ? '  (DRY RUN)' : ''}`)

  let addedGames = 0
  let addedClues = 0

  for (const season of SEASONS) {
    console.log(`\n--- Season ${season} ---`)
    const listings = await getGameIdsFromSeason(season)
    console.log(`  J-Archive lists ${listings.length} games`)
    if (listings.length === 0) continue

    // Oldest first, so a run interrupted halfway leaves no gap in the middle.
    listings.sort((a, b) => a.gameId - b.gameId)

    const missing: typeof listings = []
    for (const l of listings) {
      if (!(await alreadyHave(l.gameId))) missing.push(l)
    }
    console.log(`  ${missing.length} not yet in clue_pool`)

    for (const listing of missing) {
      await sleep(DELAY_MS)
      const clues = await scrapeGame(listing.gameId, season, listing)
      if (clues.length === 0) {
        console.log(`  #${listing.gameId}: no clues parsed (unaired or incomplete) — skipping`)
        continue
      }
      if (DRY) {
        console.log(`  [dry] #${listing.gameId} ${listing.airDate || '?'} — ${clues.length} clues`)
        addedGames++
        addedClues += clues.length
        continue
      }
      const rows = clues.map((c) => ({
        game_id_source: c.game_id_source,
        category: c.category,
        round: c.round,
        question: c.question,
        answer: c.answer,
        value: c.value,
        is_daily_double: c.is_daily_double,
        air_date: c.air_date || null,
        game_title: c.game_title,
        player1: c.player1,
        player2: c.player2,
        player3: c.player3,
        season: c.season,
        notes: c.notes || null,
      }))
      const { error } = await supabase.from('clue_pool').insert(rows)
      if (error) {
        console.error(`  #${listing.gameId}: insert failed — ${error.message}`)
        continue
      }
      addedGames++
      addedClues += rows.length
      console.log(`  + #${listing.gameId} ${listing.airDate || '?'} — ${rows.length} clues`)
    }
  }

  console.log(`\n=== DONE ===`)
  console.log(`Games added: ${addedGames}`)
  console.log(`Clues added: ${addedClues}`)
  if (addedGames > 0 && !DRY) {
    console.log(
      `\nNEXT: run supabase-after-jarchive-import.sql in the Supabase dashboard.\n` +
      `games_index is a materialized view — until it is refreshed the browser\n` +
      `still shows the old newest game.`,
    )
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
