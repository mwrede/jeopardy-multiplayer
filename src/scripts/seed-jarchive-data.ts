/**
 * Seed J-Archive data into Supabase clue_pool table.
 *
 * Reads the JSON file produced by scrape-jarchive.ts and inserts into Supabase.
 * Run the migration (supabase-migration-jarchive.sql) first to add new columns.
 *
 * Usage: npm run seed:jarchive
 *
 * Options (env vars):
 *   INPUT=file.json   - Input file (default: jarchive-data.json)
 *   CLEAR=true        - Clear existing clue_pool before inserting (default: false)
 */

import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

// Load env from .env.local
const envPath = path.join(__dirname, '../../.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const [key, ...valueParts] = line.split('=')
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim()
    }
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const INPUT_FILE = path.resolve(__dirname, '../../', process.env.INPUT || 'jarchive-data.json')
const CLEAR = process.env.CLEAR === 'true'

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

async function seed() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Input file not found: ${INPUT_FILE}`)
    console.error(`Run 'npm run scrape' first to generate the data file.`)
    process.exit(1)
  }

  console.log(`Loading data from: ${INPUT_FILE}`)
  const rawData = fs.readFileSync(INPUT_FILE, 'utf-8')
  const clues: ScrapedClue[] = JSON.parse(rawData)
  console.log(`Loaded ${clues.length} clues`)

  if (CLEAR) {
    console.log(`Clearing existing clue_pool...`)
    const { error: deleteError } = await supabase.from('clue_pool').delete().gte('id', 0)
    if (deleteError) {
      console.error('Failed to clear clue_pool:', deleteError)
    } else {
      console.log('Cleared.')
    }
  }

  // Insert in batches of 500
  const batchSize = 500
  let inserted = 0
  let errors = 0

  for (let i = 0; i < clues.length; i += batchSize) {
    const batch = clues.slice(i, i + batchSize).map(c => ({
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

    const { error } = await supabase.from('clue_pool').insert(batch)

    if (error) {
      console.error(`Failed batch at offset ${i}:`, error.message)
      errors++
    } else {
      inserted += batch.length
    }

    if ((i / batchSize) % 20 === 0) {
      console.log(`  Progress: ${inserted}/${clues.length} inserted (${errors} failed batches)`)
    }
  }

  // Final stats
  const { count } = await supabase.from('clue_pool').select('*', { count: 'exact', head: true })
  console.log(`\n=== DONE ===`)
  console.log(`Inserted: ${inserted} clues`)
  console.log(`Failed batches: ${errors}`)
  console.log(`Total in clue_pool: ${count}`)

  // Show breakdown
  const { data: roundData } = await supabase.rpc('get_clue_pool_stats').select()
  if (!roundData) {
    // Fallback: just show a count
    const { data: sampleRounds } = await supabase
      .from('clue_pool')
      .select('round')
      .limit(10000)
    if (sampleRounds) {
      const roundCounts = new Map<string, number>()
      for (const r of sampleRounds) {
        roundCounts.set(r.round, (roundCounts.get(r.round) || 0) + 1)
      }
      console.log(`\nBy round (sample):`)
      for (const [round, cnt] of roundCounts) {
        console.log(`  ${round}: ${cnt}+`)
      }
    }
  }
}

seed().catch(console.error)
