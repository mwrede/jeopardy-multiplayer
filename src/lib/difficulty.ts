/**
 * Difficulty tiers and the season-number/calendar-year arithmetic, shared by
 * the game browser and the mashup builder. They used to be defined only inside
 * GameBrowser, which is why the mashup builder had no way to offer the same
 * filters.
 */

/**
 * Difficulty tiers, ordered easiest → hardest. Each tier maps to a filter
 * the backend already understands (notesFilter or season). The "standard"
 * tier carries no filter — it pulls from the regular daily tape, which is
 * harder than kids/teen/college but not at Tournament-of-Champions level.
 * Pop Culture Jeopardy is reachable via the Season dropdown — it doesn't
 * belong on a difficulty axis.
 */
export const DIFFICULTIES: Array<{
  id: string
  label: string
  emoji: string
  description: string
  season?: string
  notesFilter?: string
  /** Tailwind classes for the active state — subtle green→red gradient across the row. */
  activeClass: string
  hoverClass: string
}> = [
  {
    id: 'kids',
    label: 'Kids',
    emoji: '🍼',
    description: 'Kids Week — easiest',
    notesFilter: 'Kids Week',
    activeClass: 'bg-emerald-500 text-black border-emerald-300',
    hoverClass: 'hover:bg-emerald-500/20 hover:border-emerald-400/60',
  },
  {
    id: 'teen',
    label: 'Teen',
    emoji: '🎓',
    description: 'Teen Tournament',
    notesFilter: 'Teen Tournament',
    activeClass: 'bg-lime-500 text-black border-lime-300',
    hoverClass: 'hover:bg-lime-500/20 hover:border-lime-400/60',
  },
  {
    id: 'college',
    label: 'College',
    emoji: '🏛️',
    description: 'College Championship',
    notesFilter: 'College',
    activeClass: 'bg-yellow-500 text-black border-yellow-300',
    hoverClass: 'hover:bg-yellow-500/20 hover:border-yellow-400/60',
  },
  {
    id: 'standard',
    label: 'Standard',
    emoji: '⭐',
    description: 'Regular nightly Jeopardy!',
    // no filter — full clue pool
    activeClass: 'bg-orange-500 text-black border-orange-300',
    hoverClass: 'hover:bg-orange-500/20 hover:border-orange-400/60',
  },
  {
    id: 'champions',
    label: 'Champions',
    emoji: '🏆',
    description: 'Tournament of Champions — top adult players',
    notesFilter: 'Tournament of Champions',
    activeClass: 'bg-red-500 text-white border-red-300',
    hoverClass: 'hover:bg-red-500/20 hover:border-red-400/60',
  },
  {
    id: 'masters',
    label: 'Masters',
    emoji: '👑',
    description: 'Jeopardy! Masters — hardest',
    season: 'jm',
    activeClass: 'bg-red-700 text-white border-red-400',
    hoverClass: 'hover:bg-red-700/30 hover:border-red-500/60',
  },
]

/** The calendar year a season STARTED in. Season 42 opened in 2025. */
export function seasonToYear(s: string): number | null {
  const n = parseInt(s, 10)
  if (isNaN(n)) return null
  return 1983 + n
}

/**
 * Years to offer, newest first. A season runs September to July, so the newest
 * season reaches into the FOLLOWING calendar year.
 */
export function yearOptions(numericSeasons: string[]): number[] {
  const latest = numericSeasons.length
    ? Math.max(...numericSeasons.map(Number)) + 1984
    : new Date().getFullYear()
  const out: number[] = []
  for (let y = latest; y >= 1984; y--) out.push(y)
  return out
}

/** The clue_pool narrowing a difficulty id means, for mashup board building. */
export function filtersForDifficulty(id: string): { notesFilter?: string; season?: string } {
  const d = DIFFICULTIES.find((x) => x.id === id)
  if (!d) return {}
  return { notesFilter: d.notesFilter, season: d.season }
}
