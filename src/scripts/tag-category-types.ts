/**
 * Tag all clue_pool rows with category_type based on category name keywords.
 * Usage: npx tsx src/scripts/tag-category-types.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

const envPath = path.join(__dirname, '../../.env.local')
const envContent = fs.readFileSync(envPath, 'utf-8')
for (const line of envContent.split('\n')) {
  const [key, ...v] = line.split('=')
  if (key && v.length) process.env[key.trim()] = v.join('=').trim()
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const THEMES: Record<string, { include: string[]; exclude: string[] }> = {
  geography: {
    include: ['geography', 'geograph', 'capital city', 'capital cities', 'capitals of', 'continent', 'on the map', 'atlas', 'latitude', 'longitude', 'border', 'island', 'islands', 'ocean', 'oceans', 'river', 'rivers', 'mountain', 'mountains', 'countries', 'country', 'lake', 'lakes', 'peninsula', 'strait', 'gulf', 'archipelago', 'hemisphere', 'topography', 'landform', 'u.s. state', 'u.s. cities', 'world cities', 'african', 'european', 'asian', 'south american'],
    exclude: ['country music', 'country song', 'country singer', 'country road', 'country cook', 'mountain dew', 'fantasy island', 'gilligan', 'rock island'],
  },
  history: {
    include: ['history', 'historic', 'century', 'ancient', 'civil war', 'world war', 'revolution', 'medieval', 'colonial', 'dynasty', 'empire', 'the 1', 'the 2', 'b.c.', 'a.d.', 'founding father', 'declaration of', 'constitution', 'pharaoh', 'roman', 'greek', 'vikings', 'crusade'],
    exclude: ['cooking', 'cook', 'kitchen', 'recipe', 'food', 'wine', 'film history', 'rock history', 'music history', 'tv history', 'movie', 'fashion history'],
  },
  science: {
    include: ['science', 'scientist', 'biology', 'chemistry', 'physics', 'element', 'atom', 'molecule', 'dna', 'laboratory', 'experiment', 'periodic table', 'astronomy', 'planet', 'planets', 'space', 'nasa', 'dinosaur', 'fossil', 'evolution', 'anatomy', 'medicine', 'medical', 'geology', 'meteorology', 'botany', 'zoology', 'genetics'],
    exclude: ['political science', 'science fiction', 'rocket science'],
  },
  sports: {
    include: ['sport', 'football', 'baseball', 'basketball', 'hockey', 'soccer', 'tennis', 'golf', 'olympic', 'nfl', 'nba', 'mlb', 'nhl', 'athlete', 'touchdown', 'home run', 'super bowl', 'world series', 'boxing', 'wrestling', 'marathon', 'swimming', 'track and field', 'world cup'],
    exclude: ['good sport', 'transport'],
  },
  pop_culture: {
    include: ['pop culture', 'celebrity', 'celebrities', 'tv show', 'television', 'sitcom', 'reality tv', 'movie', 'movies', 'film', 'hollywood', 'oscar', 'grammy', 'emmy', 'broadway', 'musical', 'cartoon', 'anime', 'comic', 'comics', 'superhero', 'video game', 'viral', 'meme', 'streaming', 'netflix'],
    exclude: ['musical instrument', 'musical term'],
  },
  food: {
    include: ['food', 'cooking', 'cook', 'cuisine', 'recipe', 'chef', 'restaurant', 'wine', 'beer', 'cocktail', 'drink', 'dessert', 'baking', 'kitchen', 'spice', 'chocolate', 'pasta', 'pizza', 'sushi', 'vegetable', 'fruit', 'meat', 'seafood', 'gourmet', 'appetizer', 'breakfast', 'lunch', 'dinner'],
    exclude: ['cook county', 'captain cook', 'cooked up'],
  },
  literature: {
    include: ['literature', 'literary', 'novel', 'novels', 'author', 'authors', 'book', 'books', 'poetry', 'poet', 'poem', 'shakespeare', 'fiction', 'nonfiction', 'bestseller', 'classic', 'library', 'chapter', 'playwright', 'memoir'],
    exclude: ['book of the bible', 'booking', 'facebook', 'textbook', 'notebook', 'comic book'],
  },
  music: {
    include: ['music', 'musician', 'song', 'songs', 'singer', 'band', 'album', 'rock & roll', 'jazz', 'classical music', 'opera', 'composer', 'symphony', 'lyric', 'lyrics', 'concert', 'hip hop', 'rap', 'r&b', 'country music', 'pop music'],
    exclude: ['musical instrument', 'face the music'],
  },
  corporate: {
    include: ['business', 'corporate', 'company', 'companies', 'brand', 'brands', 'ceo', 'stock', 'wall street', 'fortune 500', 'entrepreneur', 'industry', 'industries', 'commerce', 'finance', 'banking', 'corporation', 'advertising', 'marketing'],
    exclude: ['monkey business', 'show business', 'funny business', 'risky business', 'unfinished business', 'nobody', "three's company"],
  },
}

function classify(catName: string): string | null {
  const cl = catName.toLowerCase()
  for (const [theme, rules] of Object.entries(THEMES)) {
    const included = rules.include.some(k => cl.includes(k))
    const excluded = rules.exclude.some(k => cl.includes(k))
    if (included && !excluded) return theme
  }
  return null
}

async function main() {
  // Build category -> type map from local JSON
  console.log('Loading jarchive-data.json...')
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../../jarchive-data.json'), 'utf-8'))

  const catTypeMap = new Map<string, string>()
  for (const c of data) {
    const cat = c.category as string
    if (!catTypeMap.has(cat)) {
      const t = classify(cat)
      if (t) catTypeMap.set(cat, t)
    }
  }

  console.log(`Classified ${catTypeMap.size} categories`)

  // Group categories by type for batch updates
  const typeToCategories = new Map<string, string[]>()
  for (const [cat, type] of catTypeMap) {
    if (!typeToCategories.has(type)) typeToCategories.set(type, [])
    typeToCategories.get(type)!.push(cat)
  }

  // Update in batches — for each type, update all rows with matching category names
  let totalUpdated = 0
  for (const [type, categories] of typeToCategories) {
    console.log(`\nUpdating ${categories.length} categories as '${type}'...`)

    // Batch categories in groups of 50 to avoid URL length limits
    for (let i = 0; i < categories.length; i += 50) {
      const batch = categories.slice(i, i + 50)
      const { error, count } = await supabase
        .from('clue_pool')
        .update({ category_type: type }, { count: 'exact' })
        .in('category', batch)

      if (error) {
        console.error(`  Error at batch ${i}: ${error.message}`)
      } else {
        totalUpdated += count || 0
        if ((i / 50) % 5 === 0) {
          console.log(`  Progress: ${i}/${categories.length} categories, ${totalUpdated} total rows updated`)
        }
      }
    }
  }

  console.log(`\n=== DONE ===`)
  console.log(`Total rows updated: ${totalUpdated}`)

  // Verify counts
  for (const type of typeToCategories.keys()) {
    const { count } = await supabase
      .from('clue_pool')
      .select('*', { count: 'exact', head: true })
      .eq('category_type', type)
    console.log(`  ${type}: ${count} clues`)
  }
}

main().catch(console.error)
