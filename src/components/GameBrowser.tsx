'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createGame, searchGames, getSeasons, listCustomBoards, loadCustomBoard, incrementPlayCount, getPlayCounts, joinGame, type CustomBoardRow as CustomBoardApiRow } from '@/lib/game-api'
import { supabase } from '@/lib/supabase'
import { DEFAULT_CASUAL_SETTINGS } from '@/types/game'
import type { GameSearchResult, GameSearchFilters, GameLength } from '@/types/game'
import { useUser } from '@/lib/auth'
import { MASHUPS, MIXABLE_THEMES, THEME_STYLES, type Mashup } from './mashup-themes'

type PlayMode = 'party' | 'multiplayer'

type CustomBoardRow = CustomBoardApiRow

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
  const { user, profile } = useUser()
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
  // Mix Mashup builder — which themes the user has picked when the mix
  // card is expanded.
  const [mixThemes, setMixThemes] = useState<Set<string>>(new Set())
  // Size picker modal: when set, a "Pick board size" overlay appears.
  // runner receives the chosen size and starts the game.
  const [pendingPlay, setPendingPlay] = useState<{
    label: string
    runner: (size: GameLength) => void
  } | null>(null)
  // Topic Mashup: free-text term the user types to build a custom board.
  const [topicQuery, setTopicQuery] = useState('')

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

  /**
   * Route to /play in multiplayer mode (host plays too) or /display in party
   * mode (TV + phones). In multiplayer mode we also auto-join the creator as
   * a player so they don't see the JoinForm on landing.
   */
  async function routeToGame(roomCode: string, mode: PlayMode) {
    if (mode === 'multiplayer') {
      const name = profile?.display_name || localStorage.getItem('playerName') || ''
      if (name.trim()) {
        try {
          const { player } = await joinGame(roomCode, name.trim(), user?.id)
          localStorage.setItem('playerId', player.id)
          localStorage.setItem('playerName', player.name)
        } catch (e) {
          console.warn('[GameBrowser] auto-join failed; play page will prompt for name', e)
        }
      }
      router.push(`/game/${roomCode}/play`)
    } else {
      router.push(`/game/${roomCode}/display`)
    }
  }

  /**
   * Open the size picker. The runner receives the chosen size and actually
   * starts the game; this keeps the picker generic across mashup / game /
   * custom / mix.
   */
  function promptForSize(label: string, runner: (size: GameLength) => void) {
    setPendingPlay({ label, runner })
  }

  async function handlePlayGame(sourceGameId: number, mode: PlayMode, size: GameLength) {
    setCreating(true)
    try {
      const settings: any = { ...DEFAULT_CASUAL_SETTINGS, gameLength: size, sourceGameId }
      if (mode === 'multiplayer') settings.gameMode = 'multiplayer'
      const { game } = await createGame(settings)
      void incrementPlayCount('game', String(sourceGameId))
      await routeToGame(game.room_code, mode)
    } catch (e) {
      console.error('Failed to create game:', e)
    } finally {
      setCreating(false)
    }
  }

  async function handlePlayMashup(mashup: Mashup, mode: PlayMode, size: GameLength) {
    setCreating(true)
    try {
      const settings: any = { ...DEFAULT_CASUAL_SETTINGS, gameLength: size }
      if (mashup.theme) settings.categoryTheme = mashup.theme
      if (mode === 'multiplayer') settings.gameMode = 'multiplayer'
      const { game } = await createGame(settings)
      void incrementPlayCount('mashup', mashup.id)
      await routeToGame(game.room_code, mode)
    } catch (e) {
      console.error('Failed to create mashup:', e)
    } finally {
      setCreating(false)
    }
  }

  /** Topic Mashup: starts a game with categories whose name matches a free-text term. */
  async function handlePlayTopic(topic: string, mode: PlayMode, size: GameLength) {
    const term = topic.trim()
    if (!term) return
    setCreating(true)
    try {
      const settings: any = { ...DEFAULT_CASUAL_SETTINGS, gameLength: size, customCategorySearch: term }
      if (mode === 'multiplayer') settings.gameMode = 'multiplayer'
      const { game } = await createGame(settings)
      void incrementPlayCount('mashup', 'topic:' + term.toLowerCase())
      await routeToGame(game.room_code, mode)
    } catch (e: any) {
      console.error('Failed to create topic mashup:', e)
      setSearchError(e?.message || 'Could not build a board for that topic.')
    } finally {
      setCreating(false)
    }
  }

  /** Mix Mashup: starts a game pulling from any of the selected themes. */
  async function handlePlayMix(themes: string[], mode: PlayMode, size: GameLength) {
    if (themes.length === 0) return
    setCreating(true)
    try {
      const settings: any = { ...DEFAULT_CASUAL_SETTINGS, gameLength: size, categoryThemes: themes }
      if (mode === 'multiplayer') settings.gameMode = 'multiplayer'
      const { game } = await createGame(settings)
      // Record the mix under a stable key so popular combos rise in the count.
      void incrementPlayCount('mashup', 'mix:' + [...themes].sort().join('+'))
      await routeToGame(game.room_code, mode)
    } catch (e) {
      console.error('Failed to create mix:', e)
    } finally {
      setCreating(false)
    }
  }

  async function handlePlayCustom(boardId: string, mode: PlayMode, size: GameLength) {
    setCreating(true)
    try {
      const board = await loadCustomBoard(boardId)
      const settings: any = { ...DEFAULT_CASUAL_SETTINGS, gameLength: size, customBoardId: boardId }
      if (mode === 'multiplayer') settings.gameMode = 'multiplayer'
      const { game } = await createGame(settings)
      await supabase.from('games').update({
        settings: { ...settings, customBoard: board.board_data },
      }).eq('id', game.id)
      void incrementPlayCount('custom', boardId)
      await routeToGame(game.room_code, mode)
    } catch (e) {
      console.error('Failed to create custom game:', e)
    } finally {
      setCreating(false)
    }
  }

  const noResults =
    !searching && mashupResults.length === 0 && gameVisible.length === 0 && customVisible.length === 0

  const searchInputPad = compact ? 'px-5 py-3 text-base' : 'px-6 py-4 text-lg'
  const searchBtnPad = compact ? 'px-6 py-3 text-base' : 'px-8 py-4 text-lg'
  const cardPad = compact ? 'p-4' : 'p-5'

  return (
    <div className="w-full">
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
        {/* Mix Mashup — multi-select builder. Only when type filter includes mashups. */}
        {showMashups && !filtersActive && (() => {
          const key = 'mashup:mix'
          const isSelected = selectedKey === key
          const style = THEME_STYLES.mix
          const themesArr = Array.from(mixThemes)
          return (
            <button
              key={key}
              onClick={() => setSelectedKey(isSelected ? null : key)}
              className={`relative w-full text-left rounded-2xl ${cardPad} transition-all border-2 overflow-hidden`}
              style={isSelected ? style.cardSelectedStyle : style.cardStyle}
            >
              <div className="absolute top-2 right-3 text-2xl opacity-30 select-none pointer-events-none">
                {style.icons.join(' ')}
              </div>
              <div className="relative">
                <span className={`text-xs uppercase tracking-wider font-bold ${style.accentClass}`}>
                  🎨 Mix Mashup
                </span>
                <h3 className="text-white font-bold text-lg">Mix Your Own</h3>
                <p className="text-gray-300 text-sm mt-1">
                  Pick two or more themes to blend them into a single board.
                </p>

                {isSelected && (
                  <div className="mt-3 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {MIXABLE_THEMES.map((t) => {
                      const active = mixThemes.has(t.theme!)
                      const ts = THEME_STYLES[t.theme!]
                      return (
                        <button
                          key={t.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            setMixThemes((prev) => {
                              const next = new Set(prev)
                              if (next.has(t.theme!)) next.delete(t.theme!)
                              else next.add(t.theme!)
                              return next
                            })
                          }}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                            active
                              ? 'text-white font-semibold border-white/80'
                              : 'text-gray-300 border-white/20 hover:border-white/40'
                          }`}
                          style={active ? ts.cardSelectedStyle : { background: 'rgba(255,255,255,0.04)' }}
                        >
                          {ts.icons[0]} {t.label.replace(' Mashup', '')}
                        </button>
                      )
                    })}
                    {themesArr.length > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setMixThemes(new Set()) }}
                        className="text-xs text-gray-400 hover:text-white px-3 py-1.5"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}

                {isSelected && themesArr.length > 0 && (
                  <div className="mt-3 flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        const labels = themesArr.map((t) => MIXABLE_THEMES.find((m) => m.theme === t)?.label.replace(' Mashup', '') || t).join(' + ')
                        promptForSize(`${labels} (Party)`, (size) => handlePlayMix(themesArr, 'party', size))
                      }}
                      disabled={creating}
                      className={`font-bold px-5 py-2.5 rounded-xl text-sm transition-all whitespace-nowrap disabled:opacity-50 ${style.playBtnClass}`}
                    >
                      📺 Party ({themesArr.length})
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        const labels = themesArr.map((t) => MIXABLE_THEMES.find((m) => m.theme === t)?.label.replace(' Mashup', '') || t).join(' + ')
                        promptForSize(`${labels} (Multiplayer)`, (size) => handlePlayMix(themesArr, 'multiplayer', size))
                      }}
                      disabled={creating}
                      className={`font-bold px-5 py-2.5 rounded-xl text-sm transition-all whitespace-nowrap disabled:opacity-50 ${style.multiplayerBtnClass}`}
                    >
                      🌐 Multiplayer ({themesArr.length})
                    </button>
                  </div>
                )}
              </div>
            </button>
          )
        })()}

        {/* Topic Mashup — type any topic and we build a board from matching category names. */}
        {showMashups && !filtersActive && (() => {
          const key = 'mashup:topic'
          const isSelected = selectedKey === key
          const style = THEME_STYLES.topic
          const term = topicQuery.trim()
          return (
            <button
              key={key}
              onClick={() => setSelectedKey(isSelected ? null : key)}
              className={`relative w-full text-left rounded-2xl ${cardPad} transition-all border-2 overflow-hidden`}
              style={isSelected ? style.cardSelectedStyle : style.cardStyle}
            >
              <div className="absolute top-2 right-3 text-2xl opacity-30 select-none pointer-events-none">
                {style.icons.join(' ')}
              </div>
              <div className="relative">
                <span className={`text-xs uppercase tracking-wider font-bold ${style.accentClass}`}>
                  🔍 Topic Mashup
                </span>
                <h3 className="text-white font-bold text-lg">Type a topic</h3>
                <p className="text-gray-300 text-sm mt-1">
                  Anything: football, the Beatles, Africa, dinosaurs — we'll find categories matching the name.
                </p>

                {isSelected && (
                  <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={topicQuery}
                      onChange={(e) => setTopicQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && term) {
                          promptForSize(`Topic: ${term} (Party)`, (size) => handlePlayTopic(term, 'party', size))
                        }
                      }}
                      placeholder="e.g. football"
                      maxLength={60}
                      className="w-full bg-white/15 border border-white/30 rounded-xl px-4 py-3 text-white text-base placeholder:text-white/50 focus:outline-none focus:ring-1 focus:ring-yellow-300/50 focus:border-yellow-300/60"
                      autoFocus
                    />

                    {term && (
                      <div className="mt-3 flex flex-col sm:flex-row gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            promptForSize(`Topic: ${term} (Party)`, (size) => handlePlayTopic(term, 'party', size))
                          }}
                          disabled={creating}
                          className={`font-bold px-5 py-2.5 rounded-xl text-sm transition-all whitespace-nowrap disabled:opacity-50 ${style.playBtnClass}`}
                        >
                          📺 Party
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            promptForSize(`Topic: ${term} (Multiplayer)`, (size) => handlePlayTopic(term, 'multiplayer', size))
                          }}
                          disabled={creating}
                          className={`font-bold px-5 py-2.5 rounded-xl text-sm transition-all whitespace-nowrap disabled:opacity-50 ${style.multiplayerBtnClass}`}
                        >
                          🌐 Multiplayer
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </button>
          )
        })()}

        {mashupResults.map((m) => {
          const key = `mashup:${m.id}`
          const isSelected = selectedKey === key
          const style = THEME_STYLES[m.theme || 'random'] || THEME_STYLES.random
          return (
            <button
              key={key}
              onClick={() => setSelectedKey(isSelected ? null : key)}
              className={`relative w-full text-left rounded-2xl ${cardPad} transition-all border-2 overflow-hidden`}
              style={isSelected ? style.cardSelectedStyle : style.cardStyle}
            >
              <div className="absolute top-2 right-3 text-2xl opacity-30 select-none pointer-events-none">
                {style.icons.join(' ')}
              </div>
              <div className="relative flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <span className={`text-xs uppercase tracking-wider font-bold ${style.accentClass}`}>
                    {style.icons[0]} Mashup
                  </span>
                  <h3 className="text-white font-bold text-lg">{m.label}</h3>
                  <p className="text-gray-300 text-sm mt-1">{m.description}</p>
                </div>
                {isSelected && (
                  <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        promptForSize(`${m.label} (Party)`, (size) => handlePlayMashup(m, 'party', size))
                      }}
                      disabled={creating}
                      className={`font-bold px-5 py-2.5 rounded-xl text-sm transition-all whitespace-nowrap disabled:opacity-50 ${style.playBtnClass}`}
                    >
                      📺 Party
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        promptForSize(`${m.label} (Multiplayer)`, (size) => handlePlayMashup(m, 'multiplayer', size))
                      }}
                      disabled={creating}
                      className={`font-bold px-5 py-2.5 rounded-xl text-sm transition-all whitespace-nowrap disabled:opacity-50 ${style.multiplayerBtnClass}`}
                    >
                      🌐 Multiplayer
                    </button>
                  </div>
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
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        const label = g.game_title || `Game #${g.game_id_source}`
                        promptForSize(`${label} (Party)`, (size) => handlePlayGame(g.game_id_source, 'party', size))
                      }}
                      disabled={creating}
                      className="bg-white hover:bg-gray-100 text-jeopardy-blue font-bold px-5 py-2.5 rounded-xl text-sm transition-all whitespace-nowrap disabled:opacity-50"
                    >
                      📺 Party
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        const label = g.game_title || `Game #${g.game_id_source}`
                        promptForSize(`${label} (Multiplayer)`, (size) => handlePlayGame(g.game_id_source, 'multiplayer', size))
                      }}
                      disabled={creating}
                      className="bg-jeopardy-blue hover:bg-jeopardy-blue/80 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-all whitespace-nowrap disabled:opacity-50 border border-white/30"
                    >
                      🌐 Multiplayer
                    </button>
                  </div>
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
                  <div className="flex flex-col sm:flex-row gap-2">
                    {user && cb.creator_user_id === user.id && (
                      <button
                        onClick={(e) => { e.stopPropagation(); router.push(`/create?boardId=${cb.id}`) }}
                        className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-2.5 rounded-xl text-sm transition-all whitespace-nowrap"
                        title="Edit this board"
                      >
                        ✏️ Edit
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        promptForSize(`${cb.title} (Party)`, (size) => handlePlayCustom(cb.id, 'party', size))
                      }}
                      disabled={creating}
                      className="bg-green-500 hover:bg-green-400 text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all whitespace-nowrap disabled:opacity-50"
                    >
                      📺 Party
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        promptForSize(`${cb.title} (Multiplayer)`, (size) => handlePlayCustom(cb.id, 'multiplayer', size))
                      }}
                      disabled={creating}
                      className="bg-green-700 hover:bg-green-600 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-all whitespace-nowrap disabled:opacity-50 border border-green-400/40"
                    >
                      🌐 Multiplayer
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

      {/* Size-picker modal — appears after clicking Party or Multiplayer */}
      {pendingPlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
          onClick={() => setPendingPlay(null)}
        >
          <div
            className="bg-jeopardy-dark border-2 border-white/20 rounded-2xl p-6 max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">Starting</p>
            <p className="text-white font-bold text-lg mb-5 truncate" title={pendingPlay.label}>
              {pendingPlay.label}
            </p>
            <p className="text-gray-300 text-sm font-semibold mb-3">Pick your board size:</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {([
                { id: 'full' as GameLength, label: 'Full', desc: '6×5', sub: '30 clues' },
                { id: 'half' as GameLength, label: 'Half', desc: '6×3', sub: '18 clues' },
                { id: 'rapid' as GameLength, label: 'Rapid', desc: '3×3', sub: '9 clues' },
              ]).map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    const run = pendingPlay.runner
                    setPendingPlay(null)
                    run(s.id)
                  }}
                  disabled={creating}
                  className="bg-jeopardy-gold/15 hover:bg-jeopardy-gold/30 border-2 border-jeopardy-gold/60 text-jeopardy-gold rounded-xl py-4 transition-all disabled:opacity-50"
                >
                  <div className="font-bold text-lg leading-tight">{s.label}</div>
                  <div className="text-xs opacity-80 mt-0.5">{s.desc}</div>
                  <div className="text-[10px] opacity-60">{s.sub}</div>
                </button>
              ))}
            </div>
            <button
              onClick={() => setPendingPlay(null)}
              className="w-full text-gray-400 hover:text-white text-sm py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
