'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createGame, searchGames, getSeasons } from '@/lib/game-api'
import { supabase } from '@/lib/supabase'
import { DEFAULT_CASUAL_SETTINGS, DEFAULT_STRICT_SETTINGS } from '@/types/game'
import type { GameSearchResult, GameSearchFilters } from '@/types/game'

type Tab = 'random' | 'season' | 'search' | 'tournaments'

/**
 * HOST / TV SCREEN - Game Selection
 *
 * Tabbed interface:
 * - Random Game: one-click start with random categories
 * - By Season: browse by season number or year
 * - Search: free-text search with date range filter
 * - Tournaments: quick-filter buttons for special games
 */
export default function HostPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'casual' | 'strict'>('casual')
  const [creating, setCreating] = useState(false)
  const [stats, setStats] = useState({ categories: 0, clues: 0 })
  const [tab, setTab] = useState<Tab>('random')

  // Game browser state (shared across tabs)
  const [searchResults, setSearchResults] = useState<GameSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [selectedGame, setSelectedGame] = useState<GameSearchResult | null>(null)

  // Search tab state
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Season tab state
  const [seasons, setSeasons] = useState<string[]>([])
  const [selectedSeason, setSelectedSeason] = useState('')
  const [selectedYear, setSelectedYear] = useState('')

  // Tournament tab state
  const [activeTournament, setActiveTournament] = useState('')

  // Load clue pool stats
  useEffect(() => {
    async function loadStats() {
      const { count: clueCount } = await supabase
        .from('clue_pool')
        .select('*', { count: 'exact', head: true })

      const { data: cats } = await supabase
        .from('clue_pool')
        .select('category')

      const uniqueCats = new Set(cats?.map((c) => c.category) || [])

      setStats({
        categories: uniqueCats.size,
        clues: clueCount || 0,
      })
    }
    loadStats()
  }, [])

  // Load seasons list
  useEffect(() => {
    getSeasons().then(setSeasons).catch(console.error)
  }, [])

  // Generic search with filters
  const doSearch = useCallback(async (filters: GameSearchFilters, append: boolean = false) => {
    setSearching(true)
    try {
      const results = await searchGames(filters)
      if (append) {
        setSearchResults((prev) => [...prev, ...results])
      } else {
        setSearchResults(results)
      }
      setHasMore(results.length === (filters.limit || 50))
      setPage(filters.page || 0)
    } catch (e) {
      console.error('Search failed:', e)
    } finally {
      setSearching(false)
    }
  }, [])

  // Season → year mapping (approx: Season 1 = 1984, Season N = 1983 + N)
  const seasonToYear = (s: string) => {
    const n = parseInt(s)
    if (isNaN(n)) return null
    return 1983 + n
  }

  const yearToSeason = (year: number) => {
    const s = year - 1983
    return s >= 1 ? String(s) : null
  }

  // Generate year range
  const years: number[] = []
  for (let y = 2025; y >= 1984; y--) years.push(y)

  // When season tab loads or season changes, fetch games
  useEffect(() => {
    if (tab === 'season' && selectedSeason) {
      setSelectedGame(null)
      doSearch({ season: selectedSeason, page: 0 })
    }
  }, [selectedSeason, tab, doSearch])

  // Handle year change → set matching season
  function handleYearChange(year: string) {
    setSelectedYear(year)
    if (year) {
      const s = yearToSeason(parseInt(year))
      if (s && seasons.includes(s)) {
        setSelectedSeason(s)
      }
    }
  }

  // Handle season change → set matching year
  function handleSeasonChange(season: string) {
    setSelectedSeason(season)
    const y = seasonToYear(season)
    setSelectedYear(y ? String(y) : '')
  }

  // Tournament filters
  const tournamentFilters = [
    { label: 'Teen Tournament', query: 'teen tournament' },
    { label: 'Tournament of Champions', query: 'tournament of champions' },
    { label: 'College Championship', query: 'college championship' },
    { label: 'Teachers Tournament', query: 'teachers tournament' },
    { label: 'All-Star Games', query: 'all-star' },
    { label: 'Celebrity', query: 'celebrity' },
    { label: 'Battle of the Decades', query: 'battle of the decades' },
    { label: 'Jeopardy Masters', query: 'masters' },
    { label: 'GOAT Tournament', query: 'greatest of all time' },
    { label: 'Pop Culture', query: 'pop culture' },
    { label: 'Kids Week', query: 'kids week' },
    { label: 'Power Players', query: 'power players' },
  ]

  async function handleCreateGame(sourceGameId?: number) {
    setCreating(true)
    try {
      const settings = mode === 'casual' ? DEFAULT_CASUAL_SETTINGS : DEFAULT_STRICT_SETTINGS
      const { game } = await createGame(settings)
      if (sourceGameId) {
        localStorage.setItem(`game_source_${game.id}`, String(sourceGameId))
      }
      router.push(`/game/${game.room_code}/display`)
    } catch (e) {
      console.error('Failed to create game:', e)
    } finally {
      setCreating(false)
    }
  }

  // Do free-text search from Search tab
  function handleSearch() {
    setSelectedGame(null)
    doSearch({ query: searchQuery, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, page: 0 })
  }

  // Do tournament search
  function handleTournamentClick(query: string) {
    setActiveTournament(query)
    setSelectedGame(null)
    doSearch({ query, page: 0 })
  }

  // Shared game card renderer
  function GameCard({ game }: { game: GameSearchResult }) {
    const isSelected = selectedGame?.game_id_source === game.game_id_source
    return (
      <button
        key={game.game_id_source}
        onClick={() => setSelectedGame(isSelected ? null : game)}
        className={`w-full text-left rounded-2xl p-5 transition-all border-2 ${
          isSelected
            ? 'bg-jeopardy-gold/10 border-jeopardy-gold/50'
            : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/10'
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-bold text-lg truncate">
              {game.game_title || `Game #${game.game_id_source}`}
            </h3>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
              {game.air_date && (
                <span className="text-gray-400 text-sm">
                  {new Date(game.air_date + 'T00:00:00').toLocaleDateString('en-US', {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              )}
              {game.season && (
                <span className="text-gray-500 text-sm">Season {game.season}</span>
              )}
              <span className="text-gray-500 text-sm">{game.clue_count} clues</span>
            </div>
            {(game.player1 || game.player2 || game.player3) && (
              <p className="text-gray-500 text-sm mt-1">
                {[game.player1, game.player2, game.player3].filter(Boolean).join(' • ')}
              </p>
            )}
          </div>

          {isSelected && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleCreateGame(game.game_id_source)
              }}
              disabled={creating}
              className="bg-jeopardy-gold hover:bg-jeopardy-gold/80 text-black font-bold px-6 py-3 rounded-xl text-base transition-all whitespace-nowrap disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Play This Game'}
            </button>
          )}
        </div>
      </button>
    )
  }

  // Shared results list
  function ResultsList({ currentFilters }: { currentFilters: GameSearchFilters }) {
    if (searchResults.length === 0 && !searching) {
      return (
        <p className="text-gray-500 text-center py-12 text-lg">
          No games found. Try adjusting your filters.
        </p>
      )
    }

    return (
      <div className="space-y-3">
        <p className="text-gray-500 text-sm mb-2">
          {searching ? 'Searching...' : `${searchResults.length}${hasMore ? '+' : ''} games found`}
        </p>
        {searchResults.map((game) => (
          <GameCard key={game.game_id_source} game={game} />
        ))}
        {hasMore && (
          <button
            onClick={() => doSearch({ ...currentFilters, page: page + 1 }, true)}
            disabled={searching}
            className="w-full py-4 text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-2xl text-center transition-colors disabled:opacity-50"
          >
            {searching ? 'Loading...' : 'Load More Games'}
          </button>
        )}
      </div>
    )
  }

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'random', label: 'Random Game', icon: '🎲' },
    { id: 'season', label: 'By Season', icon: '📅' },
    { id: 'search', label: 'Search', icon: '🔍' },
    { id: 'tournaments', label: 'Tournaments', icon: '🏆' },
  ]

  // Numeric seasons for the dropdown
  const numericSeasons = seasons.filter((s) => /^\d+$/.test(s))
  const specialSeasons = seasons.filter((s) => !/^\d+$/.test(s))

  return (
    <main className="min-h-screen flex flex-col items-center p-8 bg-jeopardy-dark">
      <img
        src="/jeopardy-logo.png"
        alt="JEOPARDY!"
        className="h-40 md:h-56 w-auto mb-6 mt-8"
      />

      {/* Mode selector */}
      <div className="flex gap-4 mb-8">
        <button
          onClick={() => setMode('casual')}
          className={`px-8 py-3 rounded-2xl text-lg font-semibold transition-all ${
            mode === 'casual'
              ? 'bg-jeopardy-blue text-white'
              : 'bg-white/5 text-gray-400 hover:bg-white/10'
          }`}
        >
          Casual
        </button>
        <button
          onClick={() => setMode('strict')}
          className={`px-8 py-3 rounded-2xl text-lg font-semibold transition-all ${
            mode === 'strict'
              ? 'bg-jeopardy-blue text-white'
              : 'bg-white/5 text-gray-400 hover:bg-white/10'
          }`}
        >
          Strict
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 mb-8 bg-white/5 p-1.5 rounded-2xl">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id)
              setSelectedGame(null)
              setSearchResults([])
            }}
            className={`px-6 py-3 rounded-xl text-base font-semibold transition-all flex items-center gap-2 ${
              tab === t.id
                ? 'bg-jeopardy-blue text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>{t.icon}</span>
            <span className="hidden md:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="w-full max-w-5xl">
        {/* ===== RANDOM TAB ===== */}
        {tab === 'random' && (
          <div className="flex flex-col items-center py-12">
            <p className="text-gray-400 text-xl mb-8 text-center max-w-lg">
              Start a game with 6 random categories pulled from the full pool of{' '}
              {stats.clues.toLocaleString()} clues across{' '}
              {stats.categories.toLocaleString()} categories.
            </p>
            <button
              onClick={() => handleCreateGame()}
              disabled={creating}
              className="bg-jeopardy-gold hover:bg-jeopardy-gold/80 text-black font-bold text-2xl px-12 py-6 rounded-2xl transition-all hover:scale-105 disabled:opacity-50 shadow-lg"
            >
              {creating ? 'Creating Game...' : '🎲 Start Random Game'}
            </button>
            <p className="text-gray-600 text-sm mt-6">
              {mode === 'casual'
                ? 'Casual mode: No reading delay, 15s answer timer'
                : 'Strict mode: Reading delay, shorter timers, early-buzz lockout'}
            </p>
          </div>
        )}

        {/* ===== BY SEASON TAB ===== */}
        {tab === 'season' && (
          <div>
            <div className="flex flex-wrap gap-4 mb-8">
              {/* Season dropdown */}
              <div className="flex-1 min-w-[200px]">
                <label className="text-gray-500 text-sm block mb-2">Season</label>
                <select
                  value={selectedSeason}
                  onChange={(e) => handleSeasonChange(e.target.value)}
                  className="w-full bg-white/5 border border-white/20 rounded-xl px-4 py-3 text-white text-lg focus:outline-none focus:border-jeopardy-gold/50 transition-colors appearance-none cursor-pointer"
                >
                  <option value="" className="bg-gray-900">Select a season...</option>
                  <optgroup label="Regular Seasons" className="bg-gray-900">
                    {numericSeasons.map((s) => (
                      <option key={s} value={s} className="bg-gray-900">
                        Season {s} ({seasonToYear(s) || '?'})
                      </option>
                    ))}
                  </optgroup>
                  {specialSeasons.length > 0 && (
                    <optgroup label="Special" className="bg-gray-900">
                      {specialSeasons.map((s) => (
                        <option key={s} value={s} className="bg-gray-900">
                          {s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/(^|\s)\w/g, (c) => c.toUpperCase())}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Year dropdown */}
              <div className="min-w-[150px]">
                <label className="text-gray-500 text-sm block mb-2">Year</label>
                <select
                  value={selectedYear}
                  onChange={(e) => handleYearChange(e.target.value)}
                  className="w-full bg-white/5 border border-white/20 rounded-xl px-4 py-3 text-white text-lg focus:outline-none focus:border-jeopardy-gold/50 transition-colors appearance-none cursor-pointer"
                >
                  <option value="" className="bg-gray-900">Any year</option>
                  {years.map((y) => (
                    <option key={y} value={String(y)} className="bg-gray-900">
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedSeason ? (
              <ResultsList currentFilters={{ season: selectedSeason }} />
            ) : (
              <p className="text-gray-500 text-center py-12 text-lg">
                Select a season or year to browse games
              </p>
            )}
          </div>
        )}

        {/* ===== SEARCH TAB ===== */}
        {tab === 'search' && (
          <div>
            {/* Search bar */}
            <div className="mb-6">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearch()
                  }}
                  placeholder="Search by game title, player name, notes..."
                  className="flex-1 bg-white/5 border border-white/20 rounded-2xl px-6 py-4 text-white text-lg placeholder-gray-500 focus:outline-none focus:border-jeopardy-gold/50 transition-colors"
                  autoFocus
                />
                <button
                  onClick={handleSearch}
                  disabled={searching}
                  className="bg-jeopardy-blue hover:bg-jeopardy-blue/80 text-white px-8 py-4 rounded-2xl text-lg font-semibold transition-colors disabled:opacity-50"
                >
                  {searching ? '...' : 'Search'}
                </button>
              </div>
            </div>

            {/* Date range filter */}
            <div className="flex flex-wrap gap-4 mb-8">
              <div>
                <label className="text-gray-500 text-sm block mb-1">From Date</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-white/5 border border-white/20 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-jeopardy-gold/50 transition-colors"
                />
              </div>
              <div>
                <label className="text-gray-500 text-sm block mb-1">To Date</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-white/5 border border-white/20 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-jeopardy-gold/50 transition-colors"
                />
              </div>
              {(dateFrom || dateTo) && (
                <div className="flex items-end">
                  <button
                    onClick={() => { setDateFrom(''); setDateTo('') }}
                    className="text-gray-500 hover:text-white text-sm px-3 py-2.5 transition-colors"
                  >
                    Clear dates
                  </button>
                </div>
              )}
            </div>

            {searchResults.length > 0 || searching ? (
              <ResultsList
                currentFilters={{
                  query: searchQuery,
                  dateFrom: dateFrom || undefined,
                  dateTo: dateTo || undefined,
                }}
              />
            ) : (
              <p className="text-gray-500 text-center py-12 text-lg">
                Search for games by title, player name, or use date filters
              </p>
            )}
          </div>
        )}

        {/* ===== TOURNAMENTS TAB ===== */}
        {tab === 'tournaments' && (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
              {tournamentFilters.map((filter) => (
                <button
                  key={filter.query}
                  onClick={() => handleTournamentClick(filter.query)}
                  className={`px-5 py-4 rounded-xl text-base font-medium transition-all text-center ${
                    activeTournament === filter.query
                      ? 'bg-jeopardy-gold text-black shadow-lg'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border border-white/10'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {activeTournament ? (
              <ResultsList currentFilters={{ query: activeTournament }} />
            ) : (
              <p className="text-gray-500 text-center py-12 text-lg">
                Select a tournament type to browse games
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
