'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createGame, searchGames, getSeasons, listCustomBoards, loadCustomBoard, loadGamePreview, incrementPlayCount, getPlayCounts, joinGame, type CustomBoardRow as CustomBoardApiRow } from '@/lib/game-api'
import { supabase } from '@/lib/supabase'
import { DEFAULT_CASUAL_SETTINGS } from '@/types/game'
import type { GameSearchResult, GameSearchFilters, GameLength } from '@/types/game'
import { useUser } from '@/lib/auth'
import { MASHUPS, MIXABLE_THEMES, THEME_STYLES, type Mashup } from './mashup-themes'
import { TopicBoardBuilder } from './TopicBoardBuilder'
import type { BoardTopic } from '@/lib/topic-board'
import { BoardPreview } from './BoardPreview'
import type { CustomBoard } from '@/types/game'

type PlayMode = 'party' | 'multiplayer' | 'hosted'

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
  // Real games front-and-center by default; user can toggle to mashups / custom via the chips.
  const [typeFilter, setTypeFilter] = useState<'all' | 'games' | 'mashups' | 'custom'>('games')

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
      const msg = e?.message || 'Search failed. Check the browser console.'
      // searchGames already crafts a friendly message for timeouts and short
      // queries; only append the migration hint for schema-level errors.
      const isSchemaErr = /does not exist|could not find column/i.test(msg)
      setSearchError(isSchemaErr ? `${msg} — run the pending Supabase migrations.` : msg)
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
    // Hosted games open the presenter screen — the host runs the board and
    // judges; contestants join from there by QR.
    if (mode === 'hosted') {
      router.push(`/game/${roomCode}/present`)
      return
    }
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
   * Fork a real game into the editor — no sign-in required. Stashes a draft
   * in localStorage that /create picks up via the ?draft=fork param; the
   * user can tweak everything and either Present (no save) or Sign in to
   * persist the board.
   */
  async function forkAndEdit(sourceGameId: number) {
    setCreating(true)
    try {
      const preview = await loadGamePreview(sourceGameId)
      localStorage.setItem(
        'jeopardy:draftBoard',
        JSON.stringify({ title: `Forked: ${preview.title}`, board: preview.board }),
      )
      router.push('/create?draft=fork')
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

  /**
   * Topic Board: user-chosen mix of curated themes and typed headers.
   * The board splits its category slots evenly across them.
   */
  async function handlePlayTopicBoard(topics: BoardTopic[], mode: PlayMode, size: GameLength) {
    if (topics.length === 0) return
    setCreating(true)
    setSearchError('')
    try {
      const settings: any = { ...DEFAULT_CASUAL_SETTINGS, gameLength: size, boardTopics: topics }
      if (mode === 'multiplayer') settings.gameMode = 'multiplayer'
      const { game } = await createGame(settings)
      void incrementPlayCount('mashup', 'topics:' + topics.map((t) => t.value).sort().join('+'))
      await routeToGame(game.room_code, mode)
    } catch (e: any) {
      console.error('Failed to create topic board:', e)
      setSearchError(e?.message || 'Could not build a board from those categories.')
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
      {/* Hero prompt */}
      <div className="text-center mb-6">
        <h2 className="display-chrome text-3xl md:text-4xl leading-none">
          Search 9,300 Jeopardy Games
        </h2>
      </div>

      {/* Big search bar */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 mb-4">
        <label className="flex items-center gap-3 h-[68px] px-5 bg-black/75 border border-white/25 rounded-lg shadow-[inset_0_2px_4px_rgba(0,0,0,0.35)] focus-within:border-copper focus-within:shadow-[inset_0_2px_4px_rgba(0,0,0,0.35),0_0_0_3px_rgba(255,155,68,0.2)] transition-all">
          <span
            aria-hidden
            className="relative w-8 h-8 rounded-full border-2 border-copper shadow-[0_0_10px_rgba(255,155,68,0.55)] shrink-0"
          >
            <span className="absolute -bottom-2 -right-1.5 w-3 h-[3px] bg-copper rounded-sm rotate-45 origin-left shadow-[0_0_8px_rgba(255,155,68,0.7)]" />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(false, 0) }}
            placeholder="Search by title, name, date"
            className="flex-1 bg-transparent border-none outline-none text-white font-bold text-lg placeholder:text-ink-stage-3 placeholder:italic placeholder:font-normal"
          />
        </label>
        <button
          onClick={() => runSearch(false, 0)}
          disabled={searching}
          className="btn-stage btn-copper btn-stage-lg"
        >
          {searching ? '…' : 'Search'}
        </button>
      </div>

      {/* Type chips */}
      <div className="flex flex-wrap gap-1.5 items-center mb-3">
        <span className="text-copper uppercase text-[11px] tracking-[0.28em] mr-1.5 self-center" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
          Show
        </span>
        <button
          onClick={() => handleTypeFilter('games')}
          className={`chip-stage ${typeFilter === 'games' ? 'chip-stage-active' : ''}`}
        >
          📺 Real Games
        </button>
        <button
          onClick={() => handleTypeFilter('mashups')}
          className={`chip-stage ${typeFilter === 'mashups' ? 'chip-stage-active' : ''}`}
        >
          🎨 Mashups
        </button>
        <button
          onClick={() => handleTypeFilter('custom')}
          className={`chip-stage ${typeFilter === 'custom' ? 'chip-stage-active' : ''}`}
        >
          ✏️ Custom
        </button>
        {typeFilter !== 'all' && (
          <button
            onClick={() => setTypeFilter('all')}
            className="text-ink-stage-2 hover:text-copper text-xs px-2 self-center uppercase tracking-widest"
          >
            All
          </button>
        )}
      </div>

      {searchError && (
        <div className="mb-4 px-4 py-3 rounded-md bg-red-900/40 border border-red-400/40 text-copper-glow text-sm">
          {searchError}
        </div>
      )}

      {showGameFilters && (
        <div className="mb-4">
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-copper uppercase text-[11px] tracking-[0.28em] mr-1.5 self-center" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
              Level
            </span>
            {DIFFICULTIES.map((d) => {
              const active = difficultyFilter === d.id
              return (
                <button
                  key={d.id}
                  onClick={() => setDifficultyFilter(active ? '' : d.id)}
                  className={`chip-stage ${active ? 'chip-stage-active' : ''}`}
                  title={d.description}
                >
                  <span>{d.emoji}</span> {d.label}
                </button>
              )
            })}
            {difficultyFilter && (
              <button
                onClick={() => setDifficultyFilter('')}
                className="text-ink-stage-2 hover:text-copper text-xs px-2 self-center uppercase tracking-widest"
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
            <label className="text-copper text-[10px] block mb-1 uppercase tracking-[0.22em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
              Year
            </label>
            <select
              value={yearFilter}
              onChange={(e) => handleYearChange(e.target.value)}
              className="field-stage cursor-pointer h-[42px] py-0"
            >
              <option value="" className="bg-gray-900">Any year</option>
              {years.map((y) => (
                <option key={y} value={String(y)} className="bg-gray-900">{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-copper text-[10px] block mb-1 uppercase tracking-[0.22em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
              Season
            </label>
            <select
              value={seasonFilter}
              onChange={(e) => handleSeasonChange(e.target.value)}
              className="field-stage cursor-pointer h-[42px] py-0"
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
              className="text-ink-stage-2 hover:text-copper text-sm px-3 py-2.5 transition-colors uppercase tracking-widest"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {/* Build-your-own board: curated themes + typed headers in one place. */}
        {showMashups && !filtersActive && (
          <TopicBoardBuilder
            onPlay={handlePlayTopicBoard}
            creating={creating}
            error={searchError}
          />
        )}

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
            className="w-full text-left grid grid-cols-[76px_1fr_auto] gap-4 items-center px-4 py-3.5 rounded-md border border-white/10 bg-black/40 hover:border-copper/70 hover:bg-black/60 hover:translate-x-0.5 transition-all disabled:opacity-50"
            title="Click to preview all three rounds"
          >
            <span
              className="text-copper text-2xl tabular-nums self-start"
              style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '0 0 10px rgba(255,155,68,0.5)' }}
            >
              {g.game_id_source}
            </span>
            <div className="min-w-0">
              <h3 className="text-white font-bold text-base truncate">
                {g.game_title || `Show No. ${g.game_id_source}`}
              </h3>
              {(g.player1 || g.player2 || g.player3) && (
                <p className="text-ink-stage-2 text-sm italic truncate">
                  {[g.player1, g.player2, g.player3].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <div className="text-right text-ink-stage-2 uppercase text-[11px] tracking-[0.2em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
              {g.air_date && (
                <div className="text-copper">
                  {new Date(g.air_date + 'T00:00:00').toLocaleDateString('en-US', {
                    weekday: 'short', month: 'short', day: 'numeric', year: '2-digit',
                  })}
                </div>
              )}
              <div>{g.season ? `S${g.season} · ` : ''}{g.clue_count} clues</div>
            </div>
          </button>
        ))}

        {customVisible.map((cb) => (
          <button
            key={`custom:${cb.id}`}
            onClick={() => openPreview(cb.id, cb.title, cb.creator_user_id)}
            disabled={previewLoading}
            className="w-full text-left grid grid-cols-[40px_1fr_auto] gap-4 items-center px-4 py-3 rounded-md border border-white/10 bg-black/40 hover:border-copper/70 hover:bg-black/60 transition-all disabled:opacity-50"
            title="Click to preview the board"
          >
            <span className="text-2xl text-center">✏️</span>
            <div className="min-w-0">
              <h4 className="m-0 text-white font-bold text-base truncate">{cb.title}</h4>
              <small className="text-ink-stage-2 uppercase text-[11px] tracking-widest" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                Custom board · {new Date(cb.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </small>
            </div>
            <span className="text-copper text-[11px] uppercase tracking-[0.2em] self-center" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
              {previewLoading ? 'Loading…' : 'Preview ›'}
            </span>
          </button>
        ))}

        {hasMore && showGames && (
          <button
            onClick={() => runSearch(true, page + 1)}
            disabled={searching}
            className="btn-stage w-full"
          >
            {searching ? 'Loading…' : 'Load More Games'}
          </button>
        )}

        {noResults && (
          <div className="text-center py-10 px-4">
            <p className="text-ink-stage text-lg mb-3">
              {queryActive || filtersActive ? 'No games match your search.' : 'No J-Archive games found.'}
            </p>
            {!queryActive && !filtersActive && showGames && !searchError && (
              <div className="inline-block text-left bg-black/40 border border-white/15 rounded-md px-5 py-4 text-sm">
                <p className="text-ink-stage mb-2 font-semibold">Common causes:</p>
                <ul className="text-ink-stage-2 space-y-1 list-disc list-inside">
                  <li>The <code className="text-copper">clue_pool</code> table is empty (J-Archive data not seeded yet)</li>
                  <li>A pending migration hasn't been applied to Supabase</li>
                </ul>
                <p className="text-ink-stage-3 text-xs mt-3">Run in the Supabase SQL editor to check:</p>
                <pre className="text-ink-stage text-xs font-mono bg-black/60 rounded px-3 py-2 mt-1 overflow-x-auto">
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
            className="fixed inset-0 z-40 flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-sm overflow-y-auto animate-fade-in"
            onClick={() => { setMashupPreview(null); setMashupPreviewMode('idle') }}
          >
            <div
              className="plate w-full max-w-2xl my-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="plate-surface p-5 sm:p-7 relative overflow-hidden">
                <div className="absolute top-3 right-12 text-4xl opacity-20 select-none pointer-events-none">
                  {style.icons.join(' ')}
                </div>
                <div className="relative">
                  <div className="flex items-start justify-between gap-4 mb-4 pb-4 border-b border-white/10">
                    <div className="min-w-0">
                      <p className="text-copper uppercase text-[11px] tracking-[0.28em] mb-1.5" style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '0 0 8px rgba(255,155,68,0.45)' }}>
                        ▸ {style.icons[0]} {mp.kind === 'mix' ? 'Mix Mashup' : mp.kind === 'topic' ? 'Topic Mashup' : 'Mashup'}
                      </p>
                      <h2 className="display-chrome text-3xl sm:text-4xl leading-none truncate">{title}</h2>
                      <p className="text-ink-stage-2 text-sm mt-2">{description}</p>
                    </div>
                    <button
                      onClick={() => { setMashupPreview(null); setMashupPreviewMode('idle') }}
                      className="text-ink-stage-2 hover:text-copper text-2xl leading-none px-2 shrink-0 transition-colors"
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>

                  {/* Editable content per mashup kind */}
                  {mp.kind === 'mix' && (
                    <div className="mb-5">
                      <p className="text-copper text-xs uppercase tracking-[0.28em] mb-2" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                        Themes
                      </p>
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
                              className={`chip-stage ${active ? 'chip-stage-active' : ''}`}
                            >
                              {ts.icons[0]} {t.label.replace(' Mashup', '')}
                            </button>
                          )
                        })}
                      </div>
                      {themesArr.length > 0 && (
                        <button
                          onClick={() => setMixThemes(new Set())}
                          className="text-xs text-ink-stage-2 hover:text-copper mt-3 uppercase tracking-widest"
                        >
                          Clear selection
                        </button>
                      )}
                    </div>
                  )}

                  {mp.kind === 'topic' && (
                    <div className="mb-5">
                      <p className="text-copper text-xs uppercase tracking-[0.28em] mb-2" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                        Topic
                      </p>
                      <input
                        type="text"
                        value={topicQuery}
                        onChange={(e) => setTopicQuery(e.target.value)}
                        placeholder="e.g. football"
                        maxLength={60}
                        className="field-stage"
                        autoFocus
                      />
                    </div>
                  )}

                  {/* Action bar */}
                  {mashupPreviewMode === 'idle' && (
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-5 border-t border-white/10">
                      <button
                        onClick={() => setMashupPreviewMode('choose-mode')}
                        disabled={creating || !canPlay}
                        className="btn-stage btn-copper btn-stage-lg"
                        title={!canPlay ? (mp.kind === 'mix' ? 'Pick at least one theme' : 'Enter a topic first') : undefined}
                      >
                        ▶ Play
                      </button>
                      <button
                        onClick={share}
                        disabled={!canPlay}
                        className="btn-stage btn-stage-ghost btn-stage-sm"
                      >
                        🔗 Share
                      </button>
                    </div>
                  )}

                  {mashupPreviewMode === 'copied' && (
                    <p className="text-copper text-center text-sm font-semibold pt-4">
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
                      <div className="flex flex-col items-center gap-4 pt-5 border-t border-white/10">
                        <p className="text-copper uppercase text-sm tracking-[0.28em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '0 0 8px rgba(255,155,68,0.4)' }}>
                          ▸ Pick a mode and board size ◂
                        </p>
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
                                  className="btn-stage btn-copper btn-stage-sm !h-[52px] px-1"
                                >
                                  <span>{s.label}<span className="block text-[10px] opacity-80 font-normal">{s.desc}</span></span>
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
                                  className="btn-stage btn-chrome btn-stage-sm !h-[52px] px-1"
                                >
                                  <span>{s.label}<span className="block text-[10px] opacity-80 font-normal">{s.desc}</span></span>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-28 sm:w-32 text-left text-white font-bold text-sm shrink-0">
                              🎤 Hosted
                              <span className="block text-[10px] font-normal opacity-60">You run it</span>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5 flex-1">
                              {sizes.map((s) => (
                                <button
                                  key={s.id}
                                  onClick={() => startMode('hosted', s.id)}
                                  disabled={creating}
                                  className="btn-stage btn-stage-ghost btn-stage-sm !h-[52px] px-1"
                                >
                                  <span>{s.label}<span className="block text-[10px] opacity-80 font-normal">{s.desc}</span></span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => setMashupPreviewMode('idle')}
                          className="text-ink-stage-2 hover:text-copper text-xs mt-1"
                        >
                          Back
                        </button>
                      </div>
                    )
                  })()}
                </div>
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
            className="fixed inset-0 z-40 flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-sm overflow-y-auto animate-fade-in"
            onClick={() => { setPreviewBoard(null); setPreviewMode('idle') }}
          >
            <div
              className={`plate w-full my-4 ${isGame ? 'max-w-6xl' : 'max-w-3xl'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="plate-surface p-5 sm:p-7">
                <div className="flex items-start justify-between gap-4 mb-4 pb-4 border-b border-white/10">
                  <div className="min-w-0">
                    <p className="text-copper uppercase text-[11px] tracking-[0.28em] mb-1.5" style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '0 0 8px rgba(255,155,68,0.45)' }}>
                      ▸ {headerLabel}
                    </p>
                    <h2 className="display-chrome text-3xl sm:text-4xl leading-none truncate">{pb.title}</h2>
                    {pb.subtitle && (
                      <p className="text-ink-stage-2 text-sm mt-2 truncate">{pb.subtitle}</p>
                    )}
                  </div>
                  <button
                    onClick={() => { setPreviewBoard(null); setPreviewMode('idle') }}
                    className="text-ink-stage-2 hover:text-copper text-2xl leading-none px-2 shrink-0 transition-colors"
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
                              className={`chip-stage ${pb.activeRound === i ? 'chip-stage-active' : ''}`}
                            >
                              {i === 0 ? 'Jeopardy!' : i === 1 ? 'Double Jeopardy!' : `Round ${i + 1}`}
                            </button>
                          ))}
                        </div>
                      )}
                      <BoardPreview board={pb.board} round={pb.activeRound} />
                      {pb.board.finalJeopardy && (
                        <div className="bg-black/40 border border-copper/40 rounded-md px-4 py-3 mt-5 text-center">
                          <p className="text-copper text-xs uppercase tracking-[0.28em] mb-1" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                            ▸ Final Jeopardy! Category
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
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-5 border-t border-white/10">
                    {pb.isOwner && !isGame && (
                      <button
                        onClick={() => router.push(`/create?boardId=${pb.id}`)}
                        className="btn-stage btn-chrome btn-stage-sm"
                      >
                        ✏️ Edit
                      </button>
                    )}
                    {isGame && (
                      <button
                        onClick={() => forkAndEdit(parseInt(pb.id, 10))}
                        disabled={creating}
                        className="btn-stage btn-chrome btn-stage-sm"
                        title={user ? 'Fork this game into a custom board you can edit' : 'Sign in to fork and edit this game'}
                      >
                        ✏️ Edit
                      </button>
                    )}
                    <button
                      onClick={() => setPreviewMode('choose-mode')}
                      disabled={creating}
                      className="btn-stage btn-copper btn-stage-lg"
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
                      className="btn-stage btn-stage-ghost btn-stage-sm"
                    >
                      🔗 Share
                    </button>
                  </div>
                )}

                {previewMode === 'copied' && (
                  <p className="text-copper text-center text-sm font-semibold pt-4">
                    ✓ Link copied to clipboard
                  </p>
                )}

                {previewMode === 'choose-mode' && (() => {
                  const sizes: Array<{ id: GameLength; label: string; desc: string }> = [
                    { id: 'full', label: 'Full', desc: '6×5' },
                    { id: 'half', label: 'Half', desc: '6×3' },
                    { id: 'rapid', label: 'Rapid', desc: '3×3' },
                  ]
                  return (
                    <div className="flex flex-col items-center gap-4 pt-5 border-t border-white/10">
                      <p className="text-copper uppercase text-sm tracking-[0.28em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '0 0 8px rgba(255,155,68,0.4)' }}>
                        ▸ Pick a mode and board size ◂
                      </p>
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
                                className="btn-stage btn-copper btn-stage-sm !h-[52px] px-1"
                              >
                                <span>{s.label}<span className="block text-[10px] opacity-80 font-normal">{s.desc}</span></span>
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
                                className="btn-stage btn-chrome btn-stage-sm !h-[52px] px-1"
                              >
                                <span>{s.label}<span className="block text-[10px] opacity-80 font-normal">{s.desc}</span></span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-28 sm:w-32 text-left text-white font-bold text-sm shrink-0">
                            🎤 Hosted
                            <span className="block text-[10px] font-normal opacity-60">You run it</span>
                          </div>
                          <div className="grid grid-cols-3 gap-1.5 flex-1">
                            {sizes.map((s) => (
                              <button
                                key={s.id}
                                onClick={() => startMode('hosted', s.id)}
                                disabled={creating}
                                className="btn-stage btn-stage-ghost btn-stage-sm !h-[52px] px-1"
                              >
                                <span>{s.label}<span className="block text-[10px] opacity-80 font-normal">{s.desc}</span></span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => setPreviewMode('idle')}
                        className="text-ink-stage-2 hover:text-copper text-xs mt-1"
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

      {previewError && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-sm bg-red-900/90 border border-red-500 text-red-100 text-sm px-4 py-2 rounded-xl shadow-lg">
          {previewError}
          <button onClick={() => setPreviewError('')} className="ml-3 text-red-300 hover:text-white">✕</button>
        </div>
      )}

      {/* Size-picker modal — appears after clicking Party or Multiplayer */}
      {pendingPlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in"
          onClick={() => setPendingPlay(null)}
        >
          <div className="plate max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="plate-surface p-6">
              <p className="text-copper uppercase text-[11px] tracking-[0.28em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '0 0 8px rgba(255,155,68,0.45)' }}>
                ▸ Starting
              </p>
              <p className="text-white font-bold text-lg mt-1 mb-5 truncate" title={pendingPlay.label}>
                {pendingPlay.label}
              </p>
              <p className="text-ink-stage-2 uppercase text-xs tracking-[0.22em] mb-3" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                Pick your board size
              </p>
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
                    className="btn-stage btn-copper !h-auto py-4 flex-col leading-tight"
                  >
                    <span className="text-base">{s.label}</span>
                    <span className="text-[10px] opacity-80 mt-0.5 tracking-normal normal-case font-normal">{s.desc}</span>
                    <span className="text-[9px] opacity-70 tracking-normal normal-case font-normal">{s.sub}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setPendingPlay(null)}
                className="w-full text-ink-stage-2 hover:text-copper text-sm py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
