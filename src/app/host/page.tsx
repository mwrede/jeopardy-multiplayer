'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createGame, searchGames } from '@/lib/game-api'
import { supabase } from '@/lib/supabase'
import { DEFAULT_CASUAL_SETTINGS, DEFAULT_STRICT_SETTINGS } from '@/types/game'
import type { GameSearchResult } from '@/types/game'

/**
 * HOST / TV SCREEN - Game Selection
 *
 * The person at the TV picks what game to play:
 * - Random (pulls random categories from the pool)
 * - Browse Games (search J-Archive by title, tournament type, date)
 *
 * After selecting, a room is created and the display shows the room code.
 */
export default function HostPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'casual' | 'strict'>('casual')
  const [creating, setCreating] = useState(false)
  const [stats, setStats] = useState({ categories: 0, clues: 0 })

  // Game browser state
  const [showBrowser, setShowBrowser] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<GameSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [selectedGame, setSelectedGame] = useState<GameSearchResult | null>(null)

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

  // Search games
  const doSearch = useCallback(async (query: string, pageNum: number, append: boolean = false) => {
    setSearching(true)
    try {
      const results = await searchGames(query, pageNum, 50)
      if (append) {
        setSearchResults(prev => [...prev, ...results])
      } else {
        setSearchResults(results)
      }
      setHasMore(results.length === 50)
      setPage(pageNum)
    } catch (e) {
      console.error('Search failed:', e)
    } finally {
      setSearching(false)
    }
  }, [])

  // Load recent games when browser opens
  useEffect(() => {
    if (showBrowser && searchResults.length === 0) {
      doSearch('', 0)
    }
  }, [showBrowser])

  async function handleCreateGame(sourceGameId?: number) {
    setCreating(true)
    try {
      const settings = mode === 'casual' ? DEFAULT_CASUAL_SETTINGS : DEFAULT_STRICT_SETTINGS
      const { game } = await createGame(settings)
      // Store the source game ID in localStorage so display page can use it
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

  // Quick filter buttons
  const quickFilters = [
    { label: 'Teen Tournament', query: 'teen tournament' },
    { label: 'Tournament of Champions', query: 'tournament of champions' },
    { label: 'College Championship', query: 'college championship' },
    { label: 'Teachers Tournament', query: 'teachers tournament' },
    { label: 'All-Star Games', query: 'all-star' },
    { label: 'Celebrity', query: 'celebrity' },
  ]

  return (
    <main className="min-h-screen flex flex-col items-center p-8 bg-jeopardy-dark">
      <h1 className="text-7xl md:text-9xl font-bold text-jeopardy-gold mb-4 tracking-tight mt-8">
        JEOPARDY!
      </h1>
      <p className="text-blue-300 text-2xl mb-12">Select a game to play</p>

      {!showBrowser ? (
        <>
          {/* Game options */}
          <div className="grid gap-6 w-full max-w-4xl md:grid-cols-2 mb-12">
            {/* Random Game */}
            <button
              onClick={() => handleCreateGame()}
              disabled={creating}
              className="group bg-jeopardy-blue/30 hover:bg-jeopardy-blue/50 border-2 border-jeopardy-blue rounded-3xl p-8 text-left transition-all hover:scale-[1.02] disabled:opacity-50"
            >
              <h2 className="text-3xl font-bold text-white mb-2">Random Game</h2>
              <p className="text-gray-400 text-lg mb-4">
                6 random categories, fresh every time
              </p>
              <div className="flex gap-4 text-sm text-gray-500">
                <span>{stats.categories.toLocaleString()} categories available</span>
                <span>{stats.clues.toLocaleString()} clues</span>
              </div>
            </button>

            {/* Browse Games */}
            <button
              onClick={() => setShowBrowser(true)}
              className="group bg-jeopardy-gold/10 hover:bg-jeopardy-gold/20 border-2 border-jeopardy-gold/50 rounded-3xl p-8 text-left transition-all hover:scale-[1.02]"
            >
              <h2 className="text-3xl font-bold text-jeopardy-gold mb-2">Browse Games</h2>
              <p className="text-gray-400 text-lg mb-4">
                Search by tournament, date, or players
              </p>
              <span className="text-sm text-gray-500">9,400+ real Jeopardy! games</span>
            </button>
          </div>

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
          <p className="text-gray-500 text-center">
            {mode === 'casual'
              ? 'No reading delay, 15s answer timer, relaxed rules'
              : 'Reading delay, shorter timers, early-buzz lockout'}
          </p>
        </>
      ) : (
        /* ===== GAME BROWSER ===== */
        <div className="w-full max-w-5xl">
          <button
            onClick={() => { setShowBrowser(false); setSelectedGame(null) }}
            className="text-gray-400 hover:text-white mb-6 flex items-center gap-2 transition-colors"
          >
            <span className="text-xl">&larr;</span> Back to menu
          </button>

          {/* Search bar */}
          <div className="mb-6">
            <div className="flex gap-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setPage(0)
                    doSearch(searchQuery, 0)
                  }
                }}
                placeholder="Search games... (e.g. Teen Tournament, 2024, Ken Jennings)"
                className="flex-1 bg-white/5 border border-white/20 rounded-2xl px-6 py-4 text-white text-lg placeholder-gray-500 focus:outline-none focus:border-jeopardy-gold/50 transition-colors"
                autoFocus
              />
              <button
                onClick={() => { setPage(0); doSearch(searchQuery, 0) }}
                disabled={searching}
                className="bg-jeopardy-blue hover:bg-jeopardy-blue/80 text-white px-8 py-4 rounded-2xl text-lg font-semibold transition-colors disabled:opacity-50"
              >
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          {/* Quick filters */}
          <div className="flex flex-wrap gap-2 mb-8">
            {quickFilters.map((filter) => (
              <button
                key={filter.query}
                onClick={() => {
                  setSearchQuery(filter.query)
                  setPage(0)
                  doSearch(filter.query, 0)
                }}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  searchQuery === filter.query
                    ? 'bg-jeopardy-gold text-black'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {/* Mode selector (inline in browser) */}
          <div className="flex gap-3 mb-6">
            <span className="text-gray-500 py-2">Mode:</span>
            <button
              onClick={() => setMode('casual')}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all ${
                mode === 'casual'
                  ? 'bg-jeopardy-blue text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              Casual
            </button>
            <button
              onClick={() => setMode('strict')}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all ${
                mode === 'strict'
                  ? 'bg-jeopardy-blue text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              Strict
            </button>
          </div>

          {/* Results */}
          {searchResults.length === 0 && !searching ? (
            <p className="text-gray-500 text-center py-12 text-lg">
              {searchQuery ? 'No games found. Try a different search.' : 'Loading games...'}
            </p>
          ) : (
            <div className="space-y-3">
              {searchResults.map((game) => (
                <button
                  key={game.game_id_source}
                  onClick={() => setSelectedGame(
                    selectedGame?.game_id_source === game.game_id_source ? null : game
                  )}
                  className={`w-full text-left rounded-2xl p-5 transition-all border-2 ${
                    selectedGame?.game_id_source === game.game_id_source
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

                    {selectedGame?.game_id_source === game.game_id_source && (
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
              ))}

              {/* Load more */}
              {hasMore && (
                <button
                  onClick={() => doSearch(searchQuery, page + 1, true)}
                  disabled={searching}
                  className="w-full py-4 text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-2xl text-center transition-colors disabled:opacity-50"
                >
                  {searching ? 'Loading...' : 'Load More Games'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  )
}
