/**
 * Seed game data from the Jeopardy TSV file into Supabase clue_pool table.
 *
 * Usage: npm run seed
 * Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local
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

interface ClueRow {
  game_id_source: number
  category: string
  round: string
  question: string
  answer: string
  value: number
}

function parseTSV(filePath: string): ClueRow[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const rows: ClueRow[] = []

  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cols = line.split('\t')
    if (cols.length < 6) continue

    const gameId = parseInt(cols[0]) || 0
    const category = cols[2]?.trim()
    const round = cols[3]?.trim()
    const question = cols[4]?.trim()
    const answer = cols[5]?.trim()
    const valueStr = cols[6]?.replace(/[$,]/g, '').trim()
    const value = parseInt(valueStr) || 0

    // Skip entries missing essential data
    if (!category || !question || !answer) continue
    // Skip Final Jeopardy for now (handled separately)
    if (round === 'Final Jeopardy') continue

    rows.push({
      game_id_source: gameId,
      category,
      round,
      question,
      answer,
      value,
    })
  }

  return rows
}

async function seed() {
  const tsvPath = path.resolve(__dirname, '../../../../Jeopardy - Master.tsv')

  if (!fs.existsSync(tsvPath)) {
    // Try alternate location
    const altPath = '/Users/michaelwrede/Downloads/Jeopardy - Master.tsv'
    if (!fs.existsSync(altPath)) {
      console.error(`TSV file not found at ${tsvPath} or ${altPath}`)
      process.exit(1)
    }
    console.log(`Using TSV from: ${altPath}`)
    var rows = parseTSV(altPath)
  } else {
    console.log(`Using TSV from: ${tsvPath}`)
    var rows = parseTSV(tsvPath)
  }

  console.log(`Parsed ${rows.length} clues from TSV`)

  // Clear existing pool
  const { error: deleteError } = await supabase.from('clue_pool').delete().gte('id', 0)
  if (deleteError) {
    console.error('Failed to clear clue_pool:', deleteError)
  }

  // Insert in batches of 500
  const batchSize = 500
  let inserted = 0

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await supabase.from('clue_pool').insert(batch)

    if (error) {
      console.error(`Failed to insert batch ${i / batchSize + 1}:`, error)
    } else {
      inserted += batch.length
      console.log(`Inserted ${inserted}/${rows.length} clues...`)
    }
  }

  // Show stats
  const { count } = await supabase.from('clue_pool').select('*', { count: 'exact', head: true })
  console.log(`\nDone! ${count} clues in the pool.`)

  // Show category breakdown
  const { data: categories } = await supabase
    .from('clue_pool')
    .select('category, round')

  if (categories) {
    const roundCounts = new Map<string, number>()
    const catCounts = new Map<string, number>()
    for (const c of categories) {
      roundCounts.set(c.round, (roundCounts.get(c.round) || 0) + 1)
      catCounts.set(c.category, (catCounts.get(c.category) || 0) + 1)
    }
    console.log('\nBy round:')
    for (const [round, count] of roundCounts) {
      console.log(`  ${round}: ${count} clues`)
    }
    console.log(`\nUnique categories: ${catCounts.size}`)
  }
}

seed().catch(console.error)
