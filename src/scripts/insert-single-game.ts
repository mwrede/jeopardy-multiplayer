/**
 * Insert a single J-Archive game into the clue_pool table.
 * Game ID 4294 - Show #6664 - 2013 Kids Week game 4
 *
 * Usage: npx tsx src/scripts/insert-single-game.ts
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

const GAME_ID_SOURCE = 4294

const baseFields = {
  game_id_source: GAME_ID_SOURCE,
  air_date: '2013-08-01',
  game_title: 'Show #6664 - Thursday, August 1, 2013',
  player1: 'Josiah Washington',
  player2: 'Blythe McWhirter',
  player3: 'Clement Doucette',
  season: '29',
  notes: '2013 Kids Week game 4',
}

const clues = [
  // === JEOPARDY ROUND ===
  // AT THE TOY STORE
  { ...baseFields, round: 'Jeopardy Round', category: 'AT THE TOY STORE', value: 200, question: 'Naturally, this talking toy with a mind of its own speaks furbish', answer: 'Furby', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'AT THE TOY STORE', value: 400, question: '"Just spit it out", says trivia game called this Rule', answer: '5 Second Rule', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'AT THE TOY STORE', value: 600, question: 'This doll brand is quite cute, though its name might suggest otherwise', answer: 'Uglydoll', is_daily_double: false },

  // GEOGRAPHY 101
  { ...baseFields, round: 'Jeopardy Round', category: 'GEOGRAPHY 101', value: 200, question: 'Nile is longer, but in volume, this is the world\'s largest river', answer: 'the Amazon', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'GEOGRAPHY 101', value: 400, question: 'Stretching about 5,500 miles, the world\'s longest land mountain range is this South American one', answer: 'the Andes', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'GEOGRAPHY 101', value: 600, question: '277 miles long & often 1 mile deep, it\'s the largest gorge in the U.S.A.', answer: 'the Grand Canyon', is_daily_double: true },
  { ...baseFields, round: 'Jeopardy Round', category: 'GEOGRAPHY 101', value: 800, question: 'About 23 degrees south of the equator is the Tropic of this', answer: 'Capricorn', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'GEOGRAPHY 101', value: 1000, question: 'The largest peninsula on earth is mostly made up of this Middle Eastern country', answer: 'Saudi Arabia', is_daily_double: false },

  // COLORFUL EXPRESSIONS
  { ...baseFields, round: 'Jeopardy Round', category: 'COLORFUL EXPRESSIONS', value: 200, question: 'Literally or figuratively, it\'s what you wave when you surrender', answer: 'a white flag', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'COLORFUL EXPRESSIONS', value: 400, question: 'This type of structure is seen here', answer: 'a greenhouse', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'COLORFUL EXPRESSIONS', value: 600, question: 'Ryan Seacrest interviews celebs at the Oscars "live from" this colorful place', answer: 'the red carpet', is_daily_double: false },

  // CELEBRITIES
  { ...baseFields, round: 'Jeopardy Round', category: 'CELEBRITIES', value: 200, question: 'At the 2012 Kids\' Choice Awards, he was named favorite male singer', answer: 'Justin Bieber', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'CELEBRITIES', value: 400, question: 'Elle Fanning\'s favorite actresses include Meryl Streep, Jodie Foster & this older sister', answer: 'Dakota Fanning', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'CELEBRITIES', value: 600, question: 'This NBA shooting guard was named for expensive Japanese beef', answer: 'Kobe Bryant', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'CELEBRITIES', value: 800, question: 'Funnyman who starred in "Grown Ups", "Jack and Jill" & "Bedtime Stories"', answer: 'Adam Sandler', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'CELEBRITIES', value: 1000, question: 'Before his "Twilight" role, he played Cedric Diggory in a Harry Potter film', answer: 'Robert Pattinson', is_daily_double: false },

  // THIS & THAT
  { ...baseFields, round: 'Jeopardy Round', category: 'THIS & THAT', value: 200, question: 'This Egyptian landmark has endured 4,500 years of time\'s ravages', answer: 'the Sphinx', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'THIS & THAT', value: 400, question: 'On June 21, Fairbanks in this state celebrates summer start with midnight sun baseball', answer: 'Alaska', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'THIS & THAT', value: 600, question: 'This mammal\'s name derives from Greek words meaning "nose-horned"', answer: 'a rhinoceros', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'THIS & THAT', value: 800, question: 'In 1968, 1,000 people with disabilities took part in the first of these international competitions', answer: 'the Special Olympics', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: 'THIS & THAT', value: 1000, question: 'After a deadly duel in 1804, this vice president fled to Philadelphia to escape arrest', answer: 'Aaron Burr', is_daily_double: false },

  // BOOKS' MISSING ADJECTIVES
  { ...baseFields, round: 'Jeopardy Round', category: "BOOKS' MISSING ADJECTIVES", value: 200, question: '"___ House on the Prairie"', answer: 'Little', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: "BOOKS' MISSING ADJECTIVES", value: 400, question: 'Chris Van Allsburg\'s "The ___ Express"', answer: 'Polar', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: "BOOKS' MISSING ADJECTIVES", value: 600, question: 'By Natalie Babbitt, "Tuck ___"', answer: 'Everlasting', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: "BOOKS' MISSING ADJECTIVES", value: 800, question: '"Sarah, ___ and ___"', answer: 'Plain and Tall', is_daily_double: false },
  { ...baseFields, round: 'Jeopardy Round', category: "BOOKS' MISSING ADJECTIVES", value: 1000, question: 'Second to last book in "A Series of Unfortunate Events": "The ___ Peril"', answer: 'Penultimate', is_daily_double: false },

  // === DOUBLE JEOPARDY ROUND ===
  // IT HAPPENED ON AUGUST 1
  { ...baseFields, round: 'Double Jeopardy', category: 'IT HAPPENED ON AUGUST 1', value: 400, question: 'This Western state was a mile high when it gained statehood August 1, 1876', answer: 'Colorado', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'IT HAPPENED ON AUGUST 1', value: 800, question: 'August 1, 1981 this channel debuted with a Buggles video; still around but not so much with the videos', answer: 'MTV', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'IT HAPPENED ON AUGUST 1', value: 2000, question: 'It was abolished in Britain\'s Caribbean colonies August 1, 1834', answer: 'slavery', is_daily_double: true },

  // ANIMATION APPRECIATION
  { ...baseFields, round: 'Double Jeopardy', category: 'ANIMATION APPRECIATION', value: 400, question: 'In 2012 Manny the mammoth & his pals encountered "Continental Drift" in this animated film series', answer: 'Ice Age', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'ANIMATION APPRECIATION', value: 800, question: 'In 2012 this character spoke for the trees, with Ed Helms voicing the Once-ler', answer: 'the Lorax', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'ANIMATION APPRECIATION', value: 1200, question: 'Fix-It Felix, Jr.\'s nemesis is this title guy', answer: 'Wreck-It Ralph', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'ANIMATION APPRECIATION', value: 2000, question: 'These 2 title words preceded "Action", "World Tour" & "Island" in a "Survivor" spoof', answer: 'Total Drama', is_daily_double: false },

  // SCIENCE ROUNDUP
  { ...baseFields, round: 'Double Jeopardy', category: 'SCIENCE ROUNDUP', value: 400, question: 'The common cold usually starts in the upper respiratory tract, caused by one of these', answer: 'a virus', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'SCIENCE ROUNDUP', value: 800, question: 'More than 400 types of salamanders belong to this class of animals, not reptiles', answer: 'amphibians', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'SCIENCE ROUNDUP', value: 1600, question: 'Messages from the brain travel up to 200 mph along these bundles of axon & dendrite fibers', answer: 'nerves', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'SCIENCE ROUNDUP', value: 2000, question: 'This instrument\'s name comes from the Greek words meaning "heat measure"', answer: 'a thermometer', is_daily_double: false },

  // INTERESTED IN A JOB, KID?
  { ...baseFields, round: 'Double Jeopardy', category: 'INTERESTED IN A JOB, KID?', value: 400, question: 'Get this government job... but you\'re not 35 yet & you haven\'t lived in the U.S. for 14 years', answer: 'President', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'INTERESTED IN A JOB, KID?', value: 800, question: 'Tim Cook took over from Steve Jobs as CEO of this tech company in 2011', answer: 'Apple', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'INTERESTED IN A JOB, KID?', value: 1200, question: 'Think you can join Vince Wilfork as a tackle on this Tom Brady-led NFL team', answer: 'the Patriots', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'INTERESTED IN A JOB, KID?', value: 1600, question: 'Time to specialize in this organ along with the lungs as a cardiothoracic surgeon', answer: 'the heart', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'INTERESTED IN A JOB, KID?', value: 2000, question: 'Crunch the numbers & the deductions as a CPA, a certified public this', answer: 'accountant', is_daily_double: false },

  // EXPLORATION
  { ...baseFields, round: 'Double Jeopardy', category: 'EXPLORATION', value: 400, question: 'On October 12, 1492 he wrote about the people of San Salvador swimming out to his ships', answer: 'Christopher Columbus', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'EXPLORATION', value: 800, question: 'In 1958 Vivian Fuchs became the first to cross Antarctica; he was joined by this conqueror of Everest', answer: 'Edmund Hillary', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'EXPLORATION', value: 1200, question: 'Jacques Cartier\'s explorations of this 800-mile river laid the basis for French claims in the New World', answer: 'the St. Lawrence River', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: 'EXPLORATION', value: 2000, question: 'This Spaniard discovered Florida in 1513 & was the first to describe the Gulf Stream', answer: 'Ponce de León', is_daily_double: false },

  // "HEAD" OF THE CLASS
  { ...baseFields, round: 'Double Jeopardy', category: '"HEAD" OF THE CLASS', value: 400, question: 'On cars, some of these are low beam', answer: 'headlights', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: '"HEAD" OF THE CLASS', value: 800, question: 'On a newspaper front page, this type runs across the whole width', answer: 'a headline', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: '"HEAD" OF THE CLASS', value: 1200, question: 'In 1609 this Englishman sailed the Half Moon into New York Bay', answer: 'Hudson', is_daily_double: false },
  { ...baseFields, round: 'Double Jeopardy', category: '"HEAD" OF THE CLASS', value: 1600, question: 'Used to pull braces tight while you sleep', answer: 'headgear', is_daily_double: false },

  // === FINAL JEOPARDY ===
  { ...baseFields, round: 'Final Jeopardy', category: 'POSTAL ABBREVIATIONS', value: 0, question: 'Like NM & MN, the postal abbreviations of these 2 states are the reverse of one another', answer: 'Alabama (AL) & Louisiana (LA)', is_daily_double: false },
]

async function insertGame() {
  // Check if game already exists
  const { data: existing, error: checkError } = await supabase
    .from('clue_pool')
    .select('id', { count: 'exact', head: true })
    .eq('game_id_source', GAME_ID_SOURCE)

  if (checkError) {
    console.error('Error checking existing data:', checkError.message)
    process.exit(1)
  }

  if (existing && (existing as any).length > 0) {
    console.log(`Game ${GAME_ID_SOURCE} already exists in clue_pool. Deleting old entries first...`)
    const { error: deleteError } = await supabase
      .from('clue_pool')
      .delete()
      .eq('game_id_source', GAME_ID_SOURCE)
    if (deleteError) {
      console.error('Failed to delete existing entries:', deleteError.message)
      process.exit(1)
    }
  }

  console.log(`Inserting ${clues.length} clues for game ${GAME_ID_SOURCE} (Show #6664)...`)

  const { error } = await supabase.from('clue_pool').insert(clues)

  if (error) {
    console.error('Insert failed:', error.message)
    process.exit(1)
  }

  // Verify
  const { count } = await supabase
    .from('clue_pool')
    .select('*', { count: 'exact', head: true })
    .eq('game_id_source', GAME_ID_SOURCE)

  console.log(`\nDone! Inserted ${count} clues for Show #6664 (game_id: ${GAME_ID_SOURCE})`)
  console.log(`  Air date: 2013-08-01`)
  console.log(`  Contestants: Josiah Washington, Blythe McWhirter, Clement Doucette`)
  console.log(`  Rounds: Jeopardy (27 clues), Double Jeopardy (22 clues), Final Jeopardy (1 clue)`)
}

insertGame().catch(console.error)
