'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createGame, searchGames, getSeasons, listCustomBoards, loadCustomBoard, loadGamePreview, forkGameToCustomBoard, incrementPlayCount, getPlayCounts, joinGame, type CustomBoardRow as CustomBoardApiRow } from '@/lib/game-api'
import { supabase } from '@/lib/supabase'
import { DEFAULT_CASUAL_SETTINGS } from '@/types/game'
import type { GameSearchResult, GameSearchFilters, GameLength } from '@/types/game'
import { useUser } from '@/lib/auth'
import { MASHUPS, MIXABLE_THEMES, THEME_STYLES, type Mashup } from './mashup-themes'
import { BoardPreview } from './BoardPreview'
import type { CustomBoard } from '@/types/game'

type PlayMode = 'party' | 'multiplayer'

type CustomBoardRow = CustomBoardApiRow

/**
 * Difficulty tiers, ordered easiest → hardest. Each tier maps to a filter
 * the backend already understands (notesFilter or season). The "standard"
 * tier carries no filter — it pulls from the regular daily tape, which is
 * harder than kids/teen/college but not at Tournament-of-Champions level.
 * Pop Culture Jeopardy is reachable via the Season dropdown — it doesn't
 * belong on a difficulty axis.
 */
const DIFFICULTIES: Array<{
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
  const searchParams = useSearchParams()
  const { user, profile } = useUser()
  const [creating, setCreating] = useState(false)

  const [query, setQuery] = useState('')
  const [difficultyFilter, setDifficultyFilter] = useState('')
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
  // Mashup preview modal — used by themed mashups, mix builder, and topic.
  // Sized 2×3 mode+size picker inside, plus Share (and Edit where the mashup
  // has configurable state).
  const [mashupPreview, setMashupPreview] = useState<
    | { kind: 'themed'; mashup: Mashup }
    | { kind: 'mix' }
    | { kind: 'topic' }
    | null
  >(null)
  const [mashupPreviewMode, setMashupPreviewMode] = useState<'idle' | 'choose-mode' | 'copied'>('idle')
  // Preview modal — works for both custom boards and real J-Archive games.
  // Real games show all rounds stacked; custom boards have round tabs.
  const [previewBoard, setPreviewBoard] = useState<{
    kind: 'custom' | 'game'
    /** boardId (string) for custom, sourceGameId (stringified) for real games. */
    id: string
    title: string
    board: CustomBoard
    /** Real-game-only metadata for the modal header. */
    subtitle?: string
    isOwner: boolean
    activeRound: number
  } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [previewMode, setPreviewMode] = useState<'idle' | 'choose-mode' | 'copied'>('idle')

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

  // Deep links opened from Share buttons. Each param auto-opens the right
  // preview modal: ?board=<id>, ?game=<id>, ?mashup=<id>, ?mix=<a,b>, ?topic=<term>.
  useEffect(() => {
    if (!searchParams) return

    const boardId = searchParams.get('board')
    if (boardId && previewBoard?.id !== boardId) {
      loadCustomBoard(boardId)
        .then((data) => {
          setPreviewBoard({
            kind: 'custom',
            id: boardId,
            title: data.title,
            board: data.board_data,
            isOwner: !!(user && data.creator_user_id && user.id === data.creator_user_id),
            activeRound: 0,
          })
        })
        .catch((e) => setPreviewError(e?.message || 'Could not load shared board'))
    }

    const gameIdRaw = searchParams.get('game')
    const gameId = gameIdRaw ? parseInt(gameIdRaw, 10) : NaN
    if (!isNaN(gameId) && previewBoard?.id !== String(gameId)) {
      openGamePreview({
        game_id_source: gameId,
        game_title: '',
        air_date: '',
        season: '',
        player1: '',
        player2: '',
        player3: '',
        clue_count: 0,
      } as GameSearchResult)
    }

    const mashupId = searchParams.get('mashup')
    if (mashupId) {
      const m = MASHUPS.find((x) => x.id === mashupId)
      if (m && (!mashupPreview || (mashupPreview.kind === 'themed' && mashupPreview.mashup.id !== m.id))) {
        setMashupPreview({ kind: 'themed', mashup: m })
        setMashupPreviewMode('idle')
      }
    }

    const mixParam = searchParams.get('mix')
    if (mixParam) {
      const themes = mixParam.split(',').filter(Boolean)
      if (themes.length > 0) {
        setMixThemes(new Set(themes))
        if (!mashupPreview || mashupPreview.kind !== 'mix') {
          setMashupPreview({ kind: 'mix' })
          setMashupPreviewMode('idle')
        }
      }
    }

    const topicParam = searchParams.get('topic')
    if (topicParam) {
      setTopicQuery(topicParam)
      if (!mashupPreview || mashupPreview.kind !== 'topic') {
        setMashupPreview({ kind: 'topic' })
        setMashupPreviewMode('idle')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

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
    const diff = DIFFICULTIES.find((d) => d.id === difficultyFilter)
    return {
      query: query.trim() || undefined,
      season: seasonFilter || diff?.season || undefined,
      notesFilter: diff?.notesFilter || undefined,
      page: p,
    }
  }, [query, seasonFilter, difficultyFilter])

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
  }, [seasonFilter, difficultyFilter])

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
    setDifficultyFilter('')
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
      setDifficultyFilter('')
      setYearFilter('')
      setSeasonFilter('')
    }
  }

  const filtersActive = !!(difficultyFilter || seasonFilter || yearFilter)
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

  /** Load a custom board and pop the preview modal. */
  async function openPreview(boardId: string, boardTitle: string, creatorUserId: string | null | undefined) {
    setPreviewLoading(true)
    setPreviewError('')
    setPreviewMode('idle')
    try {
      const data = await loadCustomBoard(boardId)
      setPreviewBoard({
        kind: 'custom',
        id: boardId,
        title: boardTitle,
        board: data.board_data,
        isOwner: !!(user && creatorUserId && user.id === creatorUserId),
        activeRound: 0,
      })
    } catch (e: any) {
      setPreviewError(e?.message || 'Could not load board')
    } finally {
      setPreviewLoading(false)
    }
  }

  /**
   * Fork a real game into a fresh editable custom board, then jump to the
   * editor. Requires sign-in — custom_boards UPDATE is owner-only, so
   * anonymous forks would be read-only after creation.
   */
  async function forkAndEdit(sourceGameId: number) {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent('/find?game=' + sourceGameId)}`)
      return
    }
    setCreating(true)
    try {
      const { id } = await forkGameToCustomBoard(sourceGameId, user.id)
      router.push(`/create?boardId=${id}`)
    } catch (e: any) {
      setPreviewError(e?.message || 'Could not fork this game')
    } finally {
      setCreating(false)
    }
  }

  /** Load a real J-Archive game and pop the preview modal with all rounds. */
  async function openGamePreview(g: GameSearchResult) {
    setPreviewLoading(true)
    setPreviewError('')
    setPreviewMode('idle')
    try {
      const data = await loadGamePreview(g.game_id_source)
      const dateStr = data.airDate
        ? new Date(data.airDate + 'T00:00:00').toLocaleDateString('en-US', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
          })
        : null
      const subtitleParts = [
        dateStr,
        data.season ? `Season ${data.season}` : null,
        data.players.length > 0 ? data.players.join(' • ') : null,
      ].filter(Boolean) as string[]
      setPreviewBoard({
        kind: 'game',
        id: String(g.game_id_source),
        title: data.title,
        board: data.board,
        subtitle: subtitleParts.join(' · ') || undefined,
        isOwner: false,
        activeRound: 0,
      })
    } catch (e: any) {
      setPreviewError(e?.message || 'Could not load game preview')
    } finally {
      setPreviewLoading(false)
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
        <div className="mb-4">
          <p className="text-gray-500 text-xs mb-2 uppercase tracking-wider">Difficulty</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {DIFFICULTIES.map((d) => {
              const active = difficultyFilter === d.id
              return (
                <button
                  key={d.id}
                  onClick={() => setDifficultyFilter(active ? '' : d.id)}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${
                    active
                      ? d.activeClass + ' scale-105'
                      : 'bg-white/5 text-gray-300 border-white/15 ' + d.hoverClass
                  }`}
                  title={d.description}
                >
                  <span>{d.emoji}</span> {d.label}
                </button>
              )
            })}
            {difficultyFilter && (
              <button
                onClick={() => setDifficultyFilter('')}
                className="text-gray-500 hover:text-white text-xs px-2 self-center"
              >
                Any
              </button>
            )}
          </div>
        </div>
      )}

      {showGameFilters && (
        <div className="flex flex-wrap gap-3 mb-4 items-end">
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
        {/* Mix Mashup card — single click opens the configurator modal. */}
        {showMashups && !filtersActive && (() => {
          const style = THEME_STYLES.mix
          return (
            <button
              key="mashup:mix"
              onClick={() => { setMashupPreview({ kind: 'mix' }); setMashupPreviewMode('idle') }}
              className={`relative w-full text-left rounded-2xl ${cardPad} transition-all border-2 overflow-hidden hover:scale-[1.005]`}
              style={style.cardStyle}
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
                {mixThemes.size > 0 && (
                  <p className="text-jeopardy-gold-light text-xs mt-1.5">
                    {mixThemes.size} theme{mixThemes.size === 1 ? '' : 's'} selected
                  </p>
                )}
              </div>
            </button>
          )
        })()}

        {/* Topic Mashup card */}
        {showMashups && !filtersActive && (() => {
          const style = THEME_STYLES.topic
          const term = topicQuery.trim()
          return (
            <button
              key="mashup:topic"
              onClick={() => { setMashupPreview({ kind: 'topic' }); setMashupPreviewMode('idle') }}
              className={`relative w-full text-left rounded-2xl ${cardPad} transition-all border-2 overflow-hidden hover:scale-[1.005]`}
              style={style.cardStyle}
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
                {term && (
                  <p className="text-jeopardy-gold-light text-xs mt-1.5">Current: "{term}"</p>
                )}
              </div>
            </button>
          )
        })()}

        {mashupResults.map((m) => {
          const style = THEME_STYLES[m.theme || 'random'] || THEME_STYLES.random
          return (
            <button
              key={`mashup:${m.id}`}
              onClick={() => { setMashupPreview({ kind: 'themed', mashup: m }); setMashupPreviewMode('idle') }}
              className={`relative w-full text-left rounded-2xl ${cardPad} transition-all border-2 overflow-hidden hover:scale-[1.005]`}
              style={style.cardStyle}
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
                <span className={`text-xs self-center whitespace-nowrap ${style.accentClass}`}>
                  Preview ›
                </span>
              </div>
            </button>
          )
        })}

        {gameVisible.map((g) => (
          <button
            key={`game:${g.game_id_source}`}
            onClick={() => openGamePreview(g)}
            disabled={previewLoading}
            className={`w-full text-left rounded-2xl ${cardPad} transition-all border-2 bg-jeopardy-blue/15 border-jeopardy-blue/50 hover:bg-jeopardy-blue/25 hover:border-jeopardy-blue disabled:opacity-50`}
            title="Click to preview all three rounds"
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
              <span className="text-white/80 text-xs self-center whitespace-nowrap">
                {previewLoading ? 'Loading…' : 'Preview ›'}
              </span>
            </div>
          </button>
        ))}

        {customVisible.map((cb) => (
          <button
            key={`custom:${cb.id}`}
            onClick={() => openPreview(cb.id, cb.title, cb.creator_user_id)}
            disabled={previewLoading}
            className={`w-full text-left rounded-2xl ${cardPad} transition-all border-2 bg-green-500/10 border-green-500/40 hover:bg-green-500/20 hover:border-green-400/70 disabled:opacity-50`}
            title="Click to preview the board"
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
              <span className="text-green-300 text-xs self-center whitespace-nowrap">
                {previewLoading ? 'Loading…' : 'Preview ›'}
              </span>
            </div>
          </button>
        ))}

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

      {/* Mashup preview modal — themed, mix, or topic. */}
      {mashupPreview && (() => {
        const mp = mashupPreview
        const themedStyle = mp.kind === 'themed' ? THEME_STYLES[mp.mashup.theme || 'random'] || THEME_STYLES.random : null
        const style =
          mp.kind === 'mix' ? THEME_STYLES.mix : mp.kind === 'topic' ? THEME_STYLES.topic : themedStyle!
        const title =
          mp.kind === 'themed' ? mp.mashup.label : mp.kind === 'mix' ? 'Mix Your Own' : 'Topic Mashup'
        const description =
          mp.kind === 'themed'
            ? mp.mashup.description
            : mp.kind === 'mix'
              ? 'Pick two or more themes and we\'ll alternate categories from each.'
              : 'Type any topic and we\'ll find categories whose name matches.'
        const themesArr = Array.from(mixThemes)
        const term = topicQuery.trim()
        const canPlay =
          mp.kind === 'themed' ||
          (mp.kind === 'mix' && themesArr.length > 0) ||
          (mp.kind === 'topic' && !!term)

        const startMode = (mode: PlayMode, size: GameLength) => {
          setMashupPreview(null)
          setMashupPreviewMode('idle')
          if (mp.kind === 'themed') handlePlayMashup(mp.mashup, mode, size)
          else if (mp.kind === 'mix') handlePlayMix(themesArr, mode, size)
          else if (mp.kind === 'topic' && term) handlePlayTopic(term, mode, size)
        }

        const share = async () => {
          let url = `${window.location.origin}/find`
          if (mp.kind === 'themed') url += `?mashup=${encodeURIComponent(mp.mashup.id)}`
          else if (mp.kind === 'mix') url += `?mix=${encodeURIComponent(themesArr.join(','))}`
          else if (mp.kind === 'topic') url += `?topic=${encodeURIComponent(term)}`
          try {
            await navigator.clipboard.writeText(url)
            setMashupPreviewMode('copied')
            setTimeout(() => setMashupPreviewMode((m) => (m === 'copied' ? 'idle' : m)), 1800)
          } catch {
            prompt('Copy this link to share:', url)
          }
        }

        return (
          <div
            className="fixed inset-0 z-40 flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-sm overflow-y-auto animate-fade-in"
            onClick={() => { setMashupPreview(null); setMashupPreviewMode('idle') }}
          >
            <div
              className="bg-jeopardy-dark border-2 border-white/20 rounded-2xl p-5 sm:p-7 w-full max-w-2xl shadow-2xl my-4 relative overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              style={style.cardStyle}
            >
              <div className="absolute top-3 right-12 text-4xl opacity-25 select-none pointer-events-none">
                {style.icons.join(' ')}
              </div>
              <div className="relative">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="min-w-0">
                    <p className={`text-xs uppercase tracking-wider mb-1 ${style.accentClass}`}>
                      {style.icons[0]} {mp.kind === 'mix' ? 'Mix Mashup' : mp.kind === 'topic' ? 'Topic Mashup' : 'Mashup'}
                    </p>
                    <h2 className="text-white font-bold text-2xl sm:text-3xl truncate">{title}</h2>
                    <p className="text-gray-300 text-sm mt-1">{description}</p>
                  </div>
                  <button
                    onClick={() => { setMashupPreview(null); setMashupPreviewMode('idle') }}
                    className="text-gray-400 hover:text-white text-2xl leading-none px-2 shrink-0"
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>

                {/* Editable content per mashup kind */}
                {mp.kind === 'mix' && (
                  <div className="mb-5">
                    <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Themes</p>
                    <div className="flex flex-wrap gap-1.5">
                      {MIXABLE_THEMES.map((t) => {
                        const active = mixThemes.has(t.theme!)
                        const ts = THEME_STYLES[t.theme!]
                        return (
                          <button
                            key={t.id}
                            onClick={() => {
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
                    </div>
                    {themesArr.length > 0 && (
                      <button
                        onClick={() => setMixThemes(new Set())}
                        className="text-xs text-gray-400 hover:text-white mt-2"
                      >
                        Clear selection
                      </button>
                    )}
                  </div>
                )}

                {mp.kind === 'topic' && (
                  <div className="mb-5">
                    <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Topic</p>
                    <input
                      type="text"
                      value={topicQuery}
                      onChange={(e) => setTopicQuery(e.target.value)}
                      placeholder="e.g. football"
                      maxLength={60}
                      className="w-full bg-white/15 border border-white/30 rounded-xl px-4 py-3 text-white text-base placeholder:text-white/50 focus:outline-none focus:ring-1 focus:ring-yellow-300/50 focus:border-yellow-300/60"
                      autoFocus
                    />
                  </div>
                )}

                {/* Action bar */}
                {mashupPreviewMode === 'idle' && (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      onClick={() => setMashupPreviewMode('choose-mode')}
                      disabled={creating || !canPlay}
                      className={`font-bold px-6 py-2.5 rounded-xl text-base transition-all disabled:opacity-40 ${style.playBtnClass}`}
                      title={!canPlay ? (mp.kind === 'mix' ? 'Pick at least one theme' : 'Enter a topic first') : undefined}
                    >
                      ▶ Play
                    </button>
                    <button
                      onClick={share}
                      disabled={!canPlay}
                      className="bg-white/10 hover:bg-white/20 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-all border border-white/20 disabled:opacity-40"
                    >
                      🔗 Share
                    </button>
                  </div>
                )}

                {mashupPreviewMode === 'copied' && (
                  <p className="text-green-400 text-center text-sm font-semibold">
                    ✓ Link copied to clipboard
                  </p>
                )}

                {mashupPreviewMode === 'choose-mode' && (() => {
                  const sizes: Array<{ id: GameLength; label: string; desc: string }> = [
                    { id: 'full', label: 'Full', desc: '6×5' },
                    { id: 'half', label: 'Half', desc: '6×3' },
                    { id: 'rapid', label: 'Rapid', desc: '3×3' },
                  ]
                  return (
                    <div className="flex flex-col items-center gap-3">
                      <p className="text-gray-200 text-sm font-semibold">Pick a mode and board size:</p>
                      <div className="w-full max-w-md space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="w-28 sm:w-32 text-left text-white font-bold text-sm shrink-0">
                            📺 Party
                            <span className="block text-[10px] font-normal opacity-60">TV + phones</span>
                          </div>
                          <div className="grid grid-cols-3 gap-1.5 flex-1">
                            {sizes.map((s) => (
                              <button
                                key={s.id}
                                onClick={() => startMode('party', s.id)}
                                disabled={creating}
                                className={`font-bold px-2 py-2.5 rounded-lg text-sm transition-all disabled:opacity-50 ${style.playBtnClass}`}
                              >
                                {s.label}
                                <span className="block text-[10px] opacity-70 font-normal">{s.desc}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-28 sm:w-32 text-left text-white font-bold text-sm shrink-0">
                            🌐 Multiplayer
                            <span className="block text-[10px] font-normal opacity-60">Own device</span>
                          </div>
                          <div className="grid grid-cols-3 gap-1.5 flex-1">
                            {sizes.map((s) => (
                              <button
                                key={s.id}
                                onClick={() => startMode('multiplayer', s.id)}
                                disabled={creating}
                                className={`font-bold px-2 py-2.5 rounded-lg text-sm transition-all disabled:opacity-50 ${style.multiplayerBtnClass}`}
                              >
                                {s.label}
                                <span className="block text-[10px] opacity-70 font-normal">{s.desc}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => setMashupPreviewMode('idle')}
                        className="text-gray-400 hover:text-white text-xs mt-1"
                      >
                        Back
                      </button>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Preview modal — opens when a custom board or real game card is clicked */}
      {previewBoard && (() => {
        const pb = previewBoard
        const isGame = pb.kind === 'game'
        const headerLabel = isGame ? '📺 Real Game' : '✏️ Custom Board'
        const headerClass = isGame ? 'text-jeopardy-blue-light text-white' : 'text-green-400'
        const startMode = (mode: PlayMode, size: GameLength) => {
          const id = pb.id
          setPreviewBoard(null)
          setPreviewMode('idle')
          if (isGame) handlePlayGame(parseInt(id, 10), mode, size)
          else handlePlayCustom(id, mode, size)
        }
        return (
          <div
            className="fixed inset-0 z-40 flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-sm overflow-y-auto animate-fade-in"
            onClick={() => { setPreviewBoard(null); setPreviewMode('idle') }}
          >
            <div
              className={`bg-jeopardy-dark border-2 border-white/20 rounded-2xl p-5 sm:p-7 w-full shadow-2xl my-4 ${
                isGame ? 'max-w-6xl' : 'max-w-3xl'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="min-w-0">
                  <p className={`text-xs uppercase tracking-wider mb-1 ${isGame ? 'text-white/70' : 'text-green-400'}`}>
                    {headerLabel}
                  </p>
                  <h2 className="text-white font-bold text-2xl sm:text-3xl truncate">{pb.title}</h2>
                  {pb.subtitle && (
                    <p className="text-gray-400 text-sm mt-1 truncate">{pb.subtitle}</p>
                  )}
                </div>
                <button
                  onClick={() => { setPreviewBoard(null); setPreviewMode('idle') }}
                  className="text-gray-400 hover:text-white text-2xl leading-none px-2 shrink-0"
                  aria-label="Close preview"
                >
                  ×
                </button>
              </div>

              {/* Board(s) */}
              <div className="mb-5">
                {isGame ? (
                  /* Real games: every round + FJ visible on one page. */
                  <BoardPreview board={pb.board} showAllRounds />
                ) : (
                  /* Custom boards: round tabs (often only have round 1). */
                  <>
                    {pb.board.rounds.length > 1 && (
                      <div className="flex gap-2 mb-3 text-xs">
                        {pb.board.rounds.map((_, i) => (
                          <button
                            key={i}
                            onClick={() => setPreviewBoard({ ...pb, activeRound: i })}
                            className={`px-3 py-1.5 rounded-full font-semibold transition-colors ${
                              pb.activeRound === i
                                ? 'bg-jeopardy-blue text-white'
                                : 'bg-white/5 text-gray-400 hover:bg-white/10'
                            }`}
                          >
                            {i === 0 ? 'Jeopardy!' : i === 1 ? 'Double Jeopardy!' : `Round ${i + 1}`}
                          </button>
                        ))}
                      </div>
                    )}
                    <BoardPreview board={pb.board} round={pb.activeRound} />
                    {pb.board.finalJeopardy && (
                      <div className="bg-jeopardy-blue/40 border border-jeopardy-gold/40 rounded-xl px-4 py-3 mt-5 text-center">
                        <p className="text-jeopardy-gold-light text-xs uppercase tracking-wider mb-1">
                          Final Jeopardy! Category
                        </p>
                        <p className="text-white font-bold text-base">
                          {pb.board.finalJeopardy.categoryName}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Action bar */}
              {previewMode === 'idle' && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {pb.isOwner && !isGame && (
                    <button
                      onClick={() => router.push(`/create?boardId=${pb.id}`)}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-all"
                    >
                      ✏️ Edit
                    </button>
                  )}
                  {isGame && (
                    <button
                      onClick={() => forkAndEdit(parseInt(pb.id, 10))}
                      disabled={creating}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-all disabled:opacity-50"
                      title={user ? 'Fork this game into a custom board you can edit' : 'Sign in to fork and edit this game'}
                    >
                      ✏️ Edit
                    </button>
                  )}
                  <button
                    onClick={() => setPreviewMode('choose-mode')}
                    disabled={creating}
                    className={`font-bold px-6 py-2.5 rounded-xl text-base transition-all disabled:opacity-50 ${
                      isGame
                        ? 'bg-white hover:bg-gray-100 text-jeopardy-blue'
                        : 'bg-green-500 hover:bg-green-400 text-black'
                    }`}
                  >
                    ▶ Play
                  </button>
                  <button
                    onClick={async () => {
                      const url = isGame
                        ? `${window.location.origin}/find?game=${pb.id}`
                        : `${window.location.origin}/find?board=${pb.id}`
                      try {
                        await navigator.clipboard.writeText(url)
                        setPreviewMode('copied')
                        setTimeout(() => setPreviewMode((m) => (m === 'copied' ? 'idle' : m)), 1800)
                      } catch {
                        prompt('Copy this link to share:', url)
                      }
                    }}
                    className="bg-white/10 hover:bg-white/20 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-all border border-white/20"
                  >
                    🔗 Share
                  </button>
                </div>
              )}

              {previewMode === 'copied' && (
                <p className="text-green-400 text-center text-sm font-semibold">
                  ✓ Link copied to clipboard
                </p>
              )}

              {previewMode === 'choose-mode' && (() => {
                const sizes: Array<{ id: GameLength; label: string; desc: string }> = [
                  { id: 'full', label: 'Full', desc: '6×5' },
                  { id: 'half', label: 'Half', desc: '6×3' },
                  { id: 'rapid', label: 'Rapid', desc: '3×3' },
                ]
                const partyCls = isGame
                  ? 'bg-white hover:bg-gray-100 text-jeopardy-blue'
                  : 'bg-green-500 hover:bg-green-400 text-black'
                const mpCls = isGame
                  ? 'bg-jeopardy-blue hover:bg-jeopardy-blue/80 text-white border border-white/30'
                  : 'bg-green-700 hover:bg-green-600 text-white border border-green-400/40'
                return (
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-gray-300 text-sm font-semibold">Pick a mode and board size:</p>
                    <div className="w-full max-w-md space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-28 sm:w-32 text-left text-white font-bold text-sm shrink-0">
                          📺 Party
                          <span className="block text-[10px] font-normal opacity-60">TV + phones</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 flex-1">
                          {sizes.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => startMode('party', s.id)}
                              disabled={creating}
                              className={`font-bold px-2 py-2.5 rounded-lg text-sm transition-all disabled:opacity-50 ${partyCls}`}
                            >
                              {s.label}
                              <span className="block text-[10px] opacity-70 font-normal">{s.desc}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-28 sm:w-32 text-left text-white font-bold text-sm shrink-0">
                          🌐 Multiplayer
                          <span className="block text-[10px] font-normal opacity-60">Own device</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 flex-1">
                          {sizes.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => startMode('multiplayer', s.id)}
                              disabled={creating}
                              className={`font-bold px-2 py-2.5 rounded-lg text-sm transition-all disabled:opacity-50 ${mpCls}`}
                            >
                              {s.label}
                              <span className="block text-[10px] opacity-70 font-normal">{s.desc}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setPreviewMode('idle')}
                      className="text-gray-400 hover:text-white text-xs mt-1"
                    >
                      Back
                    </button>
                  </div>
                )
              })()}
            </div>
          </div>
        )
      })()}

      {previewError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-sm bg-red-900/90 border border-red-500 text-red-100 text-sm px-4 py-2 rounded-xl shadow-lg">
          {previewError}
          <button onClick={() => setPreviewError('')} className="ml-3 text-red-300 hover:text-white">✕</button>
        </div>
      )}

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
