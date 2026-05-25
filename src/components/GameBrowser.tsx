'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createGame, searchGames, getSeasons, listCustomBoards, loadCustomBoard, incrementPlayCount, getPlayCounts } from '@/lib/game-api'
import { supabase } from '@/lib/supabase'
import { DEFAULT_CASUAL_SETTINGS } from '@/types/game'
import type { GameSearchResult, GameSearchFilters, GameLength } from '@/types/game'

type Mashup = { id: string; label: string; description: string; theme?: string }
type CustomBoardRow = { id: string; title: string; created_at: string }

const MASHUPS: Mashup[] = [
  { id: 'random', label: 'Random Mashup', description: '6 random categories from the full clue pool' },
  { id: 'geography', label: 'Geography Mashup', description: 'Geography-themed categories', theme: 'geography' },
  { id: 'history', label: 'History Mashup', description: 'History-themed categories', theme: 'history' },
  { id: 'science', label: 'Science Mashup', description: 'Science-themed categories', theme: 'science' },
  { id: 'sports', label: 'Sports Mashup', description: 'Sports-themed categories', theme: 'sports' },
  { id: 'pop_culture', label: 'Pop Culture Mashup', description: 'Pop Culture-themed categories', theme: 'pop_culture' },
  { id: 'food', label: 'Food & Drink Mashup', description: 'Food & Drink-themed categories', theme: 'food' },
  { id: 'literature', label: 'Literature Mashup', description: 'Literature-themed categories', theme: 'literature' },
  { id: 'music', label: 'Music Mashup', description: 'Music-themed categories', theme: 'music' },
  { id: 'corporate', label: 'Corporate Mashup', description: 'Corporate-themed categories', theme: 'corporate' },
]

const TOURNAMENTS: Array<{ label: string; season?: string; notesFilter?: string }> = [
  { label: 'Kids Week', notesFilter: 'Kids Week' },
  { label: 'Teen Tournament', notesFilter: 'Teen Tournament' },
  { label: 'College Championship', notesFilter: 'College' },
  { label: 'Tournament of Champions', notesFilter: 'Tournament of Champions' },
  { label: 'Jeopardy Masters', season: 'jm' },
  { label: 'Pop Culture Jeopardy', season: 'pcj' },
]

const SPECIAL_SEASON_LABELS: Record<string, string> = {
  bbab: 'Battle of the Bay Area Brains',
  cwcpi: 'Celebrity Wheel of Fortune Crossover',
  goattournament: 'Greatest of All Time',
  jm: 'Jeopardy! Masters',
  ncc: 'National College Championship',
  pcj: 'Pop Culture Jeopardy!',
  superjeopardy: 'Super Jeopardy!',
  trebekpilots: 'Trebek Pilots',
}

type Props = {
  compact?: boolean
}

/**
 * Unified game picker: search bar + Tournament/Year/Season filters across
 * real J-Archive games, themed mashups, and user-created custom boards.
 * Color-coded so you can tell the three types apart. Clicking Play creates
 * a game and routes the user to the host display.
 */
export function GameBrowser({ compact = false }: Props) {
  const router = useRouter()
  const [gameLength, setGameLength] = useState<GameLength>('full')
  const [creating, setCreating] = useState(false)

  const [query, setQuery] = useState('')
  const [tournamentFilter, setTournamentFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [seasonFilter, setSeasonFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'games' | 'mashups' | 'custom'>('all')

  const [gameResults, setGameResults] = useState<GameSearchResult[]>([])
  const [customResults, setCustomResults] = useState<CustomBoardRow[]>([])
  const [searching, setSearching] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(0)

  const [seasons, setSeasons] = useState<string[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const [mashupCounts, setMashupCounts] = useState<Map<string, number>>(new Map())
  const [gameCounts, setGameCounts] = useState<Map<string, number>>(new Map())
  const [customCounts, setCustomCounts] = useState<Map<string, number>>(new Map())
  const [searchError, setSearchError] = useState('')

  useEffect(() => {
    getSeasons().then(setSeasons).catch(console.error)
    getPlayCounts('mashup').then(setMashupCounts).catch(() => {})
    listCustomBoards()
      .then(async (boards) => {
        setCustomResults(boards)
        if (boards.length > 0) {
          const counts = await getPlayCounts('custom', boards.map((b) => b.id))
          setCustomCounts(counts)
        }
      })
      .catch(() => setCustomResults([]))
  }, [])

  const seasonToYear = (s: string) => {
    const n = parseInt(s)
    if (isNaN(n)) return null
    return 1983 + n
  }

  const yearToSeason = (year: number) => {
    const s = year - 1983
    return s >= 1 ? String(s) : null
  }

  const numericSeasons = seasons.filter((s) => /^\d+$/.test(s))
  const specialSeasons = seasons.filter((s) => !/^\d+$/.test(s))

  const years: number[] = []
  for (let y = 2025; y >= 1984; y--) years.push(y)

  const buildFilters = useCallback((p: number = 0): GameSearchFilters => {
    const tour = TOURNAMENTS.find((t) => t.label === tournamentFilter)
    return {
      query: query.trim() || undefined,
      season: seasonFilter || tour?.season || undefined,
      notesFilter: tour?.notesFilter || undefined,
      page: p,
    }
  }, [query, seasonFilter, tournamentFilter])

  const runSearch = useCallback(async (append: boolean = false, p: number = 0) => {
    setSearching(true)
    if (!append) {
      setSelectedKey(null)
      setSearchError('')
    }
    const filters = buildFilters(p)

    // Real-games search — always runs (no-query/no-filter falls back to "recent
    // J-Archive games" so users see something instead of an empty pane on load).
    // Isolated so a failure here doesn't wipe custom boards/mashups.
    try {
      const games = await searchGames(filters)
      setGameResults((prev) => (append ? [...prev, ...games] : games))
      setHasMore(games.length === 50)
      setPage(p)
      if (games.length > 0) {
        const counts = await getPlayCounts('game', games.map((g) => String(g.game_id_source)))
        setGameCounts((prev) => (append ? new Map([...prev, ...counts]) : counts))
      }
    } catch (e: any) {
      console.error('Game search failed:', e)
      setSearchError(
        e?.message
          ? `${e.message} — if this is "function ... does not exist" or "could not find column", run the pending Supabase migrations.`
          : 'Search failed. Check the browser console.'
      )
    }

    // Custom boards (isolated)
    try {
      const boards = await listCustomBoards(query.trim() || undefined)
      setCustomResults(boards)
      if (boards.length > 0) {
        const counts = await getPlayCounts('custom', boards.map((b) => b.id))
        setCustomCounts(counts)
      }
    } catch (e: any) {
      console.error('Custom board list failed:', e)
    }

    setSearching(false)
  }, [buildFilters, query])

  useEffect(() => {
    runSearch(false, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonFilter, tournamentFilter])

  function handleYearChange(year: string) {
    setYearFilter(year)
    if (year) {
      const s = yearToSeason(parseInt(year))
      if (s && seasons.includes(s)) setSeasonFilter(s)
    } else {
      setSeasonFilter('')
    }
  }

  function handleSeasonChange(season: string) {
    setSeasonFilter(season)
    const y = seasonToYear(season)
    setYearFilter(y ? String(y) : '')
  }

  function handleClearFilters() {
    setQuery('')
    setTournamentFilter('')
    setYearFilter('')
    setSeasonFilter('')
    setTypeFilter('all')
    setGameResults([])
    setHasMore(false)
    listCustomBoards().then(setCustomResults).catch(() => setCustomResults([]))
  }

  function handleTypeFilter(next: typeof typeFilter) {
    const value = typeFilter === next ? 'all' : next
    setTypeFilter(value)
    // Tournament/year/season only apply to real games — clear them when switching away.
    if (value === 'mashups' || value === 'custom') {
      setTournamentFilter('')
      setYearFilter('')
      setSeasonFilter('')
    }
  }

  const filtersActive = !!(tournamentFilter || seasonFilter || yearFilter)
  const queryActive = !!query.trim()
  const showGameFilters = typeFilter === 'all' || typeFilter === 'games'

  const showGames = typeFilter === 'all' || typeFilter === 'games'
  const showMashups = typeFilter === 'all' || typeFilter === 'mashups'
  const showCustom = typeFilter === 'all' || typeFilter === 'custom'

  const mashupResults = !showMashups
    ? []
    : MASHUPS.filter((m) => {
        // In 'all' mode, hide mashups when filters apply (they're games-only attributes).
        if (typeFilter === 'all' && filtersActive) return false
        if (!queryActive) return true
        return m.label.toLowerCase().includes(query.trim().toLowerCase())
      })
        .map((m, idx) => ({ m, idx, count: mashupCounts.get(m.id) || 0 }))
        .sort((a, b) => b.count - a.count || a.idx - b.idx)
        .map((x) => x.m)

  const customVisible = (!showCustom ? [] : (typeFilter === 'all' && filtersActive ? [] : customResults))
    .slice()
    .sort((a, b) => {
      const ca = customCounts.get(a.id) || 0
      const cb = customCounts.get(b.id) || 0
      if (cb !== ca) return cb - ca
      return (b.created_at || '').localeCompare(a.created_at || '')
    })

  const gameVisible = (showGames ? gameResults : [])
    .slice()
    .sort((a, b) => {
      const ca = gameCounts.get(String(a.game_id_source)) || 0
      const cb = gameCounts.get(String(b.game_id_source)) || 0
      if (cb !== ca) return cb - ca
      return (b.air_date || '').localeCompare(a.air_date || '')
    })

  async function handlePlayGame(sourceGameId: number) {
    setCreating(true)
    try {
      const settings: any = { ...DEFAULT_CASUAL_SETTINGS, gameLength, sourceGameId }
      const { game } = await createGame(settings)
      void incrementPlayCount('game', String(sourceGameId))
      router.push(`/game/${game.room_code}/display`)
    } catch (e) {
      console.error('Failed to create game:', e)
    } finally {
      setCreating(false)
    }
  }

  async function handlePlayMashup(mashup: Mashup) {
    setCreating(true)
    try {
      const settings: any = { ...DEFAULT_CASUAL_SETTINGS, gameLength }
      if (mashup.theme) settings.categoryTheme = mashup.theme
      const { game } = await createGame(settings)
      void incrementPlayCount('mashup', mashup.id)
      router.push(`/game/${game.room_code}/display`)
    } catch (e) {
      console.error('Failed to create mashup:', e)
    } finally {
      setCreating(false)
    }
  }

  async function handlePlayCustom(boardId: string) {
    setCreating(true)
    try {
      const board = await loadCustomBoard(boardId)
      const settings: any = { ...DEFAULT_CASUAL_SETTINGS, gameLength, customBoardId: boardId }
      const { game } = await createGame(settings)
      await supabase.from('games').update({
        settings: { ...settings, customBoard: board.board_data },
      }).eq('id', game.id)
      void incrementPlayCount('custom', boardId)
      router.push(`/game/${game.room_code}/display`)
    } catch (e) {
      console.error('Failed to create custom game:', e)
    } finally {
      setCreating(false)
    }
  }

  const noResults =
    !searching && mashupResults.length === 0 && gameVisible.length === 0 && customVisible.length === 0

  const lengthBtnPad = compact ? 'px-4 py-2' : 'px-6 py-3'
  const lengthBtnLabel = compact ? 'text-base' : 'text-lg'
  const searchInputPad = compact ? 'px-5 py-3 text-base' : 'px-6 py-4 text-lg'
  const searchBtnPad = compact ? 'px-6 py-3 text-base' : 'px-8 py-4 text-lg'
  const cardPad = compact ? 'p-4' : 'p-5'
  const sectionMb = compact ? 'mb-4' : 'mb-6'

  return (
    <div className="w-full">
      <div className={`flex flex-wrap gap-3 ${sectionMb} justify-center`}>
        {([
          { id: 'full' as GameLength, label: 'Full', desc: '6×5 board' },
          { id: 'half' as GameLength, label: 'Half', desc: '6×3 board' },
          { id: 'rapid' as GameLength, label: 'Rapid', desc: '3×3 board' },
        ]).map((gl) => (
          <button
            key={gl.id}
            onClick={() => setGameLength(gl.id)}
            className={`${lengthBtnPad} rounded-2xl text-center transition-all ${
              gameLength === gl.id
                ? 'bg-jeopardy-gold/20 border-2 border-jeopardy-gold text-jeopardy-gold'
                : 'bg-white/5 border-2 border-transparent text-gray-400 hover:bg-white/10'
            }`}
          >
            <span className={`font-bold block ${lengthBtnLabel}`}>{gl.label}</span>
            <span className="text-xs opacity-60">{gl.desc}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-3 text-sm">
        <button
          onClick={() => handleTypeFilter('games')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 transition-all ${
            typeFilter === 'games'
              ? 'bg-jeopardy-blue text-white border-jeopardy-blue'
              : 'bg-jeopardy-blue/15 text-white border-jeopardy-blue/60 hover:bg-jeopardy-blue/25'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-jeopardy-blue" /> Real Games
        </button>
        <button
          onClick={() => handleTypeFilter('mashups')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 transition-all ${
            typeFilter === 'mashups'
              ? 'bg-jeopardy-gold text-black border-jeopardy-gold'
              : 'bg-jeopardy-gold/15 text-jeopardy-gold border-jeopardy-gold/50 hover:bg-jeopardy-gold/25'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-jeopardy-gold" /> Mashups
        </button>
        <button
          onClick={() => handleTypeFilter('custom')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 transition-all ${
            typeFilter === 'custom'
              ? 'bg-green-500 text-black border-green-400'
              : 'bg-green-500/15 text-green-400 border-green-500/40 hover:bg-green-500/25'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-green-400" /> Custom Boards
        </button>
        {typeFilter !== 'all' && (
          <button
            onClick={() => setTypeFilter('all')}
            className="text-gray-500 hover:text-white text-xs px-2 transition-colors self-center"
          >
            Show all
          </button>
        )}
      </div>

      <div className={`flex gap-3 mb-4`}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runSearch(false, 0) }}
          placeholder="Search games, mashups, custom boards..."
          className={`flex-1 bg-white/5 border border-white/20 rounded-2xl text-white placeholder-gray-500 focus:outline-none focus:border-jeopardy-gold/50 transition-colors ${searchInputPad}`}
        />
        <button
          onClick={() => runSearch(false, 0)}
          disabled={searching}
          className={`bg-jeopardy-blue hover:bg-jeopardy-blue/80 text-white rounded-2xl font-semibold transition-colors disabled:opacity-50 ${searchBtnPad}`}
        >
          {searching ? '...' : 'Search'}
        </button>
      </div>

      {searchError && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-900/30 border border-red-500/40 text-red-300 text-sm">
          {searchError}
        </div>
      )}

      {showGameFilters && (
        <div className="flex flex-wrap gap-3 mb-4 items-end">
          <div>
            <label className="text-gray-500 text-xs block mb-1">Tournament</label>
            <select
              value={tournamentFilter}
              onChange={(e) => setTournamentFilter(e.target.value)}
              className="bg-white/5 border border-white/20 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-jeopardy-gold/50 cursor-pointer"
            >
              <option value="" className="bg-gray-900">Any tournament</option>
              {TOURNAMENTS.map((t) => (
                <option key={t.label} value={t.label} className="bg-gray-900">{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-gray-500 text-xs block mb-1">Year</label>
            <select
              value={yearFilter}
              onChange={(e) => handleYearChange(e.target.value)}
              className="bg-white/5 border border-white/20 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-jeopardy-gold/50 cursor-pointer"
            >
              <option value="" className="bg-gray-900">Any year</option>
              {years.map((y) => (
                <option key={y} value={String(y)} className="bg-gray-900">{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-gray-500 text-xs block mb-1">Season</label>
            <select
              value={seasonFilter}
              onChange={(e) => handleSeasonChange(e.target.value)}
              className="bg-white/5 border border-white/20 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-jeopardy-gold/50 cursor-pointer"
            >
              <option value="" className="bg-gray-900">Any season</option>
              <optgroup label="Regular" className="bg-gray-900">
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
                      {SPECIAL_SEASON_LABELS[s] || s}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {(queryActive || filtersActive) && (
            <button
              onClick={handleClearFilters}
              className="text-gray-500 hover:text-white text-sm px-3 py-2.5 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {mashupResults.map((m) => {
          const key = `mashup:${m.id}`
          const isSelected = selectedKey === key
          return (
            <button
              key={key}
              onClick={() => setSelectedKey(isSelected ? null : key)}
              className={`w-full text-left rounded-2xl ${cardPad} transition-all border-2 ${
                isSelected
                  ? 'bg-jeopardy-gold/25 border-jeopardy-gold'
                  : 'bg-jeopardy-gold/10 border-jeopardy-gold/40 hover:bg-jeopardy-gold/15'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <span className="text-xs uppercase tracking-wider font-bold text-jeopardy-gold">
                    🎲 Mashup
                  </span>
                  <h3 className="text-white font-bold text-lg">{m.label}</h3>
                  <p className="text-gray-400 text-sm mt-1">{m.description}</p>
                </div>
                {isSelected && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePlayMashup(m) }}
                    disabled={creating}
                    className="bg-jeopardy-gold hover:bg-jeopardy-gold/80 text-black font-bold px-6 py-3 rounded-xl text-base transition-all whitespace-nowrap disabled:opacity-50"
                  >
                    {creating ? 'Creating...' : 'Play'}
                  </button>
                )}
              </div>
            </button>
          )
        })}

        {gameVisible.map((g) => {
          const key = `game:${g.game_id_source}`
          const isSelected = selectedKey === key
          return (
            <button
              key={key}
              onClick={() => setSelectedKey(isSelected ? null : key)}
              className={`w-full text-left rounded-2xl ${cardPad} transition-all border-2 ${
                isSelected
                  ? 'bg-jeopardy-blue/40 border-jeopardy-blue'
                  : 'bg-jeopardy-blue/15 border-jeopardy-blue/50 hover:bg-jeopardy-blue/25'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <span className="text-xs uppercase tracking-wider font-bold text-white/90">
                    📺 Real Game
                  </span>
                  <h3 className="text-white font-bold text-lg truncate">
                    {g.game_title || `Game #${g.game_id_source}`}
                  </h3>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                    {g.air_date && (
                      <span className="text-gray-300 text-sm">
                        {new Date(g.air_date + 'T00:00:00').toLocaleDateString('en-US', {
                          weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
                        })}
                      </span>
                    )}
                    {g.season && <span className="text-gray-400 text-sm">Season {g.season}</span>}
                    <span className="text-gray-400 text-sm">{g.clue_count} clues</span>
                  </div>
                  {(g.player1 || g.player2 || g.player3) && (
                    <p className="text-gray-400 text-sm mt-1">
                      {[g.player1, g.player2, g.player3].filter(Boolean).join(' • ')}
                    </p>
                  )}
                </div>
                {isSelected && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePlayGame(g.game_id_source) }}
                    disabled={creating}
                    className="bg-white hover:bg-gray-100 text-jeopardy-blue font-bold px-6 py-3 rounded-xl text-base transition-all whitespace-nowrap disabled:opacity-50"
                  >
                    {creating ? 'Creating...' : 'Play'}
                  </button>
                )}
              </div>
            </button>
          )
        })}

        {customVisible.map((cb) => {
          const key = `custom:${cb.id}`
          const isSelected = selectedKey === key
          return (
            <button
              key={key}
              onClick={() => setSelectedKey(isSelected ? null : key)}
              className={`w-full text-left rounded-2xl ${cardPad} transition-all border-2 ${
                isSelected
                  ? 'bg-green-500/25 border-green-400'
                  : 'bg-green-500/10 border-green-500/40 hover:bg-green-500/15'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <span className="text-xs uppercase tracking-wider font-bold text-green-400">
                    ✏️ Custom Board
                  </span>
                  <h3 className="text-white font-bold text-lg">{cb.title}</h3>
                  <p className="text-gray-500 text-sm mt-1">
                    Created {new Date(cb.created_at).toLocaleDateString()}
                  </p>
                </div>
                {isSelected && (
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); router.push(`/create?boardId=${cb.id}`) }}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-3 rounded-xl text-base transition-all whitespace-nowrap"
                      title="Edit this board"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handlePlayCustom(cb.id) }}
                      disabled={creating}
                      className="bg-green-500 hover:bg-green-400 text-black font-bold px-6 py-3 rounded-xl text-base transition-all whitespace-nowrap disabled:opacity-50"
                    >
                      {creating ? 'Creating...' : 'Play'}
                    </button>
                  </div>
                )}
              </div>
            </button>
          )
        })}

        {hasMore && showGames && (
          <button
            onClick={() => runSearch(true, page + 1)}
            disabled={searching}
            className="w-full py-4 text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-2xl text-center transition-colors disabled:opacity-50"
          >
            {searching ? 'Loading...' : 'Load More Games'}
          </button>
        )}

        {noResults && (
          <div className="text-center py-10 px-4">
            <p className="text-gray-400 text-lg mb-3">
              {queryActive || filtersActive ? 'No games match your search.' : 'No J-Archive games found.'}
            </p>
            {!queryActive && !filtersActive && showGames && !searchError && (
              <div className="inline-block text-left bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-sm">
                <p className="text-gray-300 mb-2 font-semibold">Common causes:</p>
                <ul className="text-gray-400 space-y-1 list-disc list-inside">
                  <li>The <code className="text-jeopardy-gold">clue_pool</code> table is empty (J-Archive data not seeded yet)</li>
                  <li>A pending migration hasn't been applied to Supabase</li>
                </ul>
                <p className="text-gray-500 text-xs mt-3">
                  Run in the Supabase SQL editor to check:
                </p>
                <pre className="text-gray-300 text-xs font-mono bg-black/30 rounded px-3 py-2 mt-1 overflow-x-auto">
SELECT COUNT(*) AS rows, COUNT(DISTINCT game_id_source) AS games FROM clue_pool;
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
