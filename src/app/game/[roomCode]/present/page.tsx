'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useGameChannel } from '@/hooks/useGameChannel'
import { ClueText, clueTextLength } from '@/components/ClueText'
import { clampDailyDoubleWager, maxDailyDoubleWager, topClueValue } from '@/lib/wager'
import { ScoreToBeat } from '@/components/ScoreToBeat'
import { useState, useEffect, useCallback } from 'react'
import {
  hostOpenBuzzers,
  hostJudge,
  hostAdjustScore,
  hostSelectClue,
  getBuzzOrder,
  type BuzzOrderRow,
} from '@/lib/game-api'
import { supabase } from '@/lib/supabase'
import type { Category, Clue } from '@/types/game'
import { PresenterControl } from '@/components/PresenterControl'
import { BuzzerConsole } from '@/components/BuzzerConsole'
import { hasYouTube } from '@/lib/youtube'
import { JoinQr, JoinQrOverlay } from '@/components/JoinQr'

/**
 * PRESENT — the host's screen.
 *
 * Two ways to score, chosen at setup:
 *
 *   Manual   — the host keeps score for whoever is in the room, however many
 *              of them there are. Nothing to join, nothing to sync; the whole
 *              game lives in this tab.
 *   Buzzers  — players join on their phones and become the players. The host
 *              still drives the board, but decides when buzzers open, sees
 *              who got in first, and rules on each answer. Players never see
 *              the clue until the buzzers open, so nobody reads ahead.
 *
 * Either way the host owns the board and the scores — the +/- buttons are
 * always live, because the person running the room gets the last word.
 */

interface Team {
  name: string
  score: number
}

type PresentPhase = 'setup' | 'board' | 'clue' | 'answer' | 'daily_double'
type Scoring = 'manual' | 'buzzers'

/**
 * How big a clue gets on the room's screen. Presenting is the one surface
 * read from across a room rather than from a lap, so a clue should be as
 * large as it can be and still land whole — a clue the host has to scroll
 * mid-read is worse than a smaller one.
 *
 * Length picks the size, because length is what decides whether it fits:
 * two thirds of clues are under 90 characters and have room to be enormous,
 * while the rare 200-character clue has none and stays where it is. The
 * steps are per-breakpoint too — 96px only breaks into sensible lines on a
 * wide screen.
 */
function clueSizeClass(text: string): string {
  // A picture or video clue gives most of the height to the media (ClueText's
  // `tv` variant caps a photo at 45vh and a player at a 16:9 frame), so its
  // words keep the smaller size.
  if (text.includes('[img:') || hasYouTube(text)) return 'text-3xl md:text-5xl'
  const len = clueTextLength(text)
  if (len <= 90) return 'text-4xl md:text-6xl lg:text-7xl xl:text-[6rem] xl:leading-[1.08]'
  if (len <= 170) return 'text-4xl md:text-6xl xl:text-7xl xl:leading-[1.12]'
  return 'text-4xl md:text-6xl'
}

export default function PresentPage() {
  const { roomCode } = useParams<{ roomCode: string }>()
  const router = useRouter()
  const search = useSearchParams()
  // ?control=1 is the presenter's own device: the answer, the buzzer lock,
  // the buzz order and the scores. Everything the room must not see.
  const isControl = search.get('control') === '1'
  const { game, players, categories, clues } = useGameChannel(roomCode)

  const [scoring, setScoring] = useState<Scoring>('manual')
  const [teams, setTeams] = useState<Team[]>([
    { name: 'Player 1', score: 0 },
    { name: 'Player 2', score: 0 },
    { name: 'Player 3', score: 0 },
  ])
  /**
   * One player is a game of solitaire but it's still a game. There's no upper
   * limit: a classroom is thirty, and a cap that stops the host typing the
   * thirty-first name is a cap on the room, not on the software. ScoreRow
   * shrinks the cards to fit instead.
   */
  const MIN_PLAYERS = 1

  /** Grow or shrink the list to exactly n, keeping any names already typed. */
  const setPlayerCount = (n: number) => {
    const size = Math.max(MIN_PLAYERS, n)
    setTeams((prev) =>
      Array.from({ length: size }, (_, i) => prev[i] || { name: `Player ${i + 1}`, score: 0 }),
    )
  }

  const [phase, setPhase] = useState<PresentPhase>('setup')
  const [activeClue, setActiveClue] = useState<Clue | null>(null)
  const [activeCategory, setActiveCategory] = useState<Category | null>(null)
  const [answeredClueIds, setAnsweredClueIds] = useState<Set<string>>(new Set())
  const [currentRound, setCurrentRound] = useState(1)
  const [showMenu, setShowMenu] = useState(false)
  const [ddWager, setDdWager] = useState('')
  const [buzzOrder, setBuzzOrder] = useState<BuzzOrderRow[]>([])
  // NOT local state: with the board on a laptop and the buzzer controls on a
  // phone, whichever device acted last is the truth, and that's the game row.
  const buzzersOpen = game?.phase === 'buzz_window'
  const [justScored, setJustScored] = useState<string | null>(null)
  const [showJoinCode, setShowJoinCode] = useState(false)

  // Hooks above run unconditionally; the control screen owns its own state.
  if (isControl) return <PresenterControl roomCode={roomCode} />

  const usingBuzzers = scoring === 'buzzers'
  // createPresentationGame seeds a placeholder "Presenter" row so the board
  // can be built before anyone joins. It isn't a contestant — keep it out of
  // the scoreboard and the buzz queue.
  // Sorted by join order, not by whatever order realtime delivered them in:
  // a late joiner is appended to the end of the local list, and without a
  // stable sort every score card on the strip shuffles the moment somebody
  // new scans in — mid-clue, under the host's cursor.
  const contestants = players
    .filter((p) => p.name !== 'Presenter')
    .sort((a, b) => a.join_order - b.join_order)

  const roundCategories = categories
    .filter((c) => c.round_number === currentRound)
    .sort((a, b) => a.position - b.position)
  const roundClues = clues.filter((c) => roundCategories.some((cat) => cat.id === c.category_id))
  const allAnswered = roundClues.length > 0 && roundClues.every((c) => answeredClueIds.has(c.id))
  const hasRound2 = categories.some((c) => c.round_number === 2)

  // Daily Double caps. In buzzer mode the wager belongs to whoever uncovered
  // the clue; in manual mode the host hasn't said whose it is yet, so the
  // all-in offer is the best score on the board.
  const ddTopValue = topClueValue(game?.settings?.gameLength, currentRound)
  const ddBestScore = usingBuzzers
    ? Math.max(0, ...contestants.map((p) => p.score ?? 0))
    : Math.max(0, ...teams.map((t) => t.score))
  const ddQuickWagers = [
    { label: 'Max', amount: maxDailyDoubleWager(ddBestScore, ddTopValue) },
    { label: 'Board top', amount: ddTopValue },
  ].filter((w, i, all) => all.findIndex((x) => x.amount === w.amount) === i)

  const getCluesForCategory = useCallback(
    (catId: string) => clues.filter((c) => c.category_id === catId).sort((a, b) => a.value - b.value),
    [clues],
  )

  /* ── Buzz queue polling — only while buzzers are actually live ─────────── */
  useEffect(() => {
    if (!usingBuzzers || !game?.id || !activeClue || phase === 'board') { setBuzzOrder([]); return }
    let cancelled = false
    const load = () => {
      getBuzzOrder(game.id, activeClue.id)
        .then((rows) => { if (!cancelled) setBuzzOrder(rows) })
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 700)
    return () => { cancelled = true; clearInterval(t) }
  }, [usingBuzzers, game?.id, activeClue?.id, phase])

  /**
   * The clue this screen is showing, once the SERVER agrees it's the live one.
   *
   * Clicking a cell sets activeClue immediately but hostSelectClue is a round
   * trip, so for a moment the game row still describes the PREVIOUS clue —
   * phase 'board_selection' or 'clue_result'. The follow-the-phone effect
   * below read that stale phase as "this clue is over", closed the clue the
   * host had only just opened and marked it answered, so it could never be
   * opened again. That's the "I click it and nothing shows up" bug. Waiting
   * for current_clue_id to name our clue is what makes the phase trustworthy.
   */
  const [liveClueId, setLiveClueId] = useState<string | null>(null)
  useEffect(() => {
    if (activeClue && game?.current_clue_id === activeClue.id) setLiveClueId(activeClue.id)
  }, [game?.current_clue_id, activeClue])

  /**
   * Follow the phone. When the presenter rules on an answer from their own
   * device the clue resolves server-side, and this screen — which may be the
   * one projected — has to come back to the board on its own. Without this the
   * laptop sits on a finished clue until someone hits Continue.
   */
  useEffect(() => {
    if (!usingBuzzers || !activeClue) return
    if (liveClueId !== activeClue.id) return
    if (game?.phase === 'clue_result' || game?.phase === 'board_selection') {
      setAnsweredClueIds((prev) => new Set([...prev, activeClue.id]))
      setActiveClue(null)
      setActiveCategory(null)
      setBuzzOrder([])
      setPhase('board')
    }
  }, [game?.phase, usingBuzzers, activeClue, liveClueId])

  function handleCellClick(clue: Clue) {
    if (answeredClueIds.has(clue.id)) return
    const cat = categories.find((c) => c.id === clue.category_id)
    setActiveClue(clue)
    setActiveCategory(cat || null)
    setBuzzOrder([])
    if (usingBuzzers && game) {
      // Phones show "get ready" — the clue itself stays hidden until buzzers open.
      hostSelectClue(game.id, clue.id).catch(() => {})
    }
    if (clue.is_daily_double) { setPhase('daily_double'); setDdWager('') }
    else setPhase('clue')
  }

  function openBuzzers() {
    if (!game || !activeClue) return
    hostOpenBuzzers(game.id).catch(() => {})
  }

  function awardPoints(teamIdx: number, correct: boolean) {
    if (!activeClue) return
    const points = activeClue.is_daily_double && ddWager
      ? clampDailyDoubleWager(parseInt(ddWager), teams[teamIdx]?.score ?? 0, ddTopValue)
      : activeClue.value
    setTeams((prev) =>
      prev.map((t, i) => (i === teamIdx ? { ...t, score: t.score + (correct ? points : -points) } : t)),
    )
  }

  function judgeBuzzer(playerId: string, correct: boolean) {
    if (!game || !activeClue) return
    // The Daily Double wager lives on this screen; without passing it the
    // server settles the clue at its face value.
    const wager = activeClue.is_daily_double ? parseInt(ddWager) || undefined : undefined
    hostJudge(game.id, activeClue.id, playerId, correct, wager).catch(() => {})
    if (!correct) return
    // Correct ends the clue. Hold just long enough for the ✓ to register and
    // the new score to arrive over realtime, then drop back to the board so
    // the host sees the money land.
    setJustScored(playerId)
    setTimeout(() => { setJustScored(null); backToBoard() }, 900)
  }

  function backToBoard() {
    if (activeClue) setAnsweredClueIds((prev) => new Set([...prev, activeClue.id]))
    if (usingBuzzers && game) {
      supabase.from('games')
        .update({ phase: 'board_selection', current_clue_id: null, buzz_window_open: false, updated_at: new Date().toISOString() })
        .eq('id', game.id).then(() => {})
    }
    setActiveClue(null); setActiveCategory(null); setBuzzOrder([])
    setPhase('board')
  }

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (phase === 'setup') return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (phase === 'clue') {
          if (usingBuzzers && !buzzersOpen) openBuzzers()
          else setPhase('answer')
        } else if (phase === 'answer') backToBoard()
      }
      if (e.key === 'Escape' && phase !== 'board') backToBoard()
      const num = parseInt(e.key)
      if (phase === 'answer' && !usingBuzzers && num >= 1 && num <= teams.length) awardPoints(num - 1, true)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase, activeClue, teams.length, ddWager, usingBuzzers, buzzersOpen])

  /* ── SETUP ────────────────────────────────────────────────────────────── */
  if (phase === 'setup') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-jeopardy-blue-cell p-6">
        <div className="w-full max-w-md space-y-6 rounded-2xl border border-white/20 bg-jeopardy-dark p-8">
          <h1 className="text-center text-3xl font-bold text-jeopardy-gold-light">Presentation Setup</h1>

          <div>
            <label className="mb-2 block text-sm text-gray-300">Scoring</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setScoring('manual')}
                className={`rounded-lg px-3 py-3 text-sm font-bold transition-colors ${
                  scoring === 'manual' ? 'bg-jeopardy-gold text-black' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                Manual scoring
                <span className="mt-0.5 block text-[10px] font-normal opacity-70">You keep score</span>
              </button>
              <button
                onClick={() => setScoring('buzzers')}
                className={`rounded-lg px-3 py-3 text-sm font-bold transition-colors ${
                  scoring === 'buzzers' ? 'bg-jeopardy-gold text-black' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                Phone buzzers
                <span className="mt-0.5 block text-[10px] font-normal opacity-70">Players buzz in</span>
              </button>
            </div>
          </div>

          {usingBuzzers ? (
            <div className="space-y-5">
              {/* Two different people need two different links, and only one
                  of them should ever be on screen in front of the room. */}
              <div className="rounded-xl border border-white/15 bg-black/30 p-4">
                <p className="mb-1 text-[10px] uppercase tracking-[0.24em] text-jeopardy-gold-light">
                  Contestants join here
                </p>
                <p className="mb-3 text-sm text-gray-300">
                  Show this to the room. Everyone who joins becomes a team.
                </p>
                <JoinQr roomCode={roomCode} />
              </div>

              {/* However many turn up. The list scrolls rather than the page,
                  so the Start button stays where the host left it. */}
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-[0.24em] text-gray-400">
                  Joined ({contestants.length})
                </p>
                {contestants.length === 0 && (
                  <p className="text-sm italic text-gray-500">
                    Waiting for players… you can start without them and let people join as they arrive.
                  </p>
                )}
                <div className="max-h-56 space-y-1.5 overflow-y-auto">
                  {contestants.map((p, i) => (
                    <div key={p.id} className="flex items-center gap-3 rounded bg-white/5 px-3 py-2">
                      <span className="w-6 shrink-0 text-xs tabular-nums text-jeopardy-gold-light">{i + 1}</span>
                      <span className="truncate font-semibold text-white">{p.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-2 block text-sm text-gray-300">Number of Players</label>
                <div className="flex gap-2">
                  {[2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      onClick={() => setPlayerCount(n)}
                      className={`flex-1 rounded-lg py-2 font-bold transition-colors ${
                        teams.length === n ? 'bg-jeopardy-gold text-black' : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  {/* The presets cover a living room; a classroom needs more
                      than six, so the count isn't capped at the buttons. */}
                  <button
                    onClick={() => setPlayerCount(teams.length + 1)}
                    title="Add another player"
                    className={`w-11 shrink-0 rounded-lg py-2 font-bold transition-colors ${
                      teams.length > 6 ? 'bg-jeopardy-gold text-black' : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    +
                  </button>
                </div>
                {teams.length > 6 && (
                  <p className="mt-1.5 text-[11px] text-gray-400">{teams.length} players</p>
                )}
              </div>
              <div className="space-y-2">
                <label className="block text-sm text-gray-300">Player Names</label>
                {teams.map((team, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={team.name}
                      onChange={(e) =>
                        setTeams((prev) => prev.map((t, j) => (j === i ? { ...t, name: e.target.value } : t)))
                      }
                      className="input-base flex-1 text-base"
                      placeholder={`Player ${i + 1}`}
                    />
                    {/* Removing a row is the only way back down from a count
                        the preset buttons can't express. */}
                    <button
                      onClick={() => setTeams((prev) => prev.filter((_, j) => j !== i))}
                      disabled={teams.length <= MIN_PLAYERS}
                      aria-label={`Remove ${team.name || `Player ${i + 1}`}`}
                      title={`Remove ${team.name || `Player ${i + 1}`}`}
                      className="shrink-0 rounded-lg px-3 py-2 text-lg leading-none text-gray-500 transition-colors hover:bg-white/10 hover:text-red-400 disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-gray-500"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setPlayerCount(teams.length + 1)}
                  className="w-full rounded-lg border border-dashed border-white/20 py-2 text-sm font-semibold text-gray-400 transition-colors hover:border-jeopardy-gold/60 hover:text-white"
                >
                  + Add a player
                </button>
              </div>
            </>
          )}

          <button
            onClick={() => {
              if (usingBuzzers && game) {
                // Phones key off gameMode to decide whether to show the clue
                // when buzzers open. Without this they'd sit on "Watch the TV".
                supabase.from('games')
                  .update({ settings: { ...(game.settings as any), gameMode: 'host' } })
                  .eq('id', game.id).then(() => {})
              }
              setPhase('board')
            }}
            className="btn-primary w-full py-4 text-lg"
          >
            Start Presenting
          </button>
        </div>
      </div>
    )
  }

  /** Floating host controls — same panel over the board and over a clue. */
  const console_ = usingBuzzers && game ? (
    <BuzzerConsole
      gameId={game.id}
      roomCode={roomCode}
      players={contestants}
      currentClue={activeClue}
      phase={game.phase}
      currentPlayerId={game.current_player_id}
      // The wager is typed on this screen, so the console has to be told it
      // or a Daily Double settles at the cell's face value.
      dailyDoubleWager={activeClue?.is_daily_double ? parseInt(ddWager) || undefined : undefined}
    />
  ) : null

  /* ── CLUE / ANSWER ────────────────────────────────────────────────────── */
  if ((phase === 'clue' || phase === 'answer' || phase === 'daily_double') && activeClue) {
    const waitingToOpen = usingBuzzers && phase === 'clue' && !buzzersOpen

    return (
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-jeopardy-blue-cell">
        {/* Control bar */}
        <div className="flex shrink-0 items-center justify-between gap-4 bg-jeopardy-dark px-4 py-2.5 text-white">
          <button onClick={backToBoard} className="flex items-center gap-2 text-sm hover:opacity-80">
            Continue <Kbd>ESC</Kbd>
          </button>
          <span className="truncate text-sm font-bold">
            {activeCategory?.name} for {activeClue.value}
            {activeClue.source_year ? (
              <span className="ml-2 font-normal text-blue-200/60">· {activeClue.source_year}</span>
            ) : null}
          </span>
          {waitingToOpen ? (
            <button onClick={openBuzzers} className="flex items-center gap-2 text-sm font-bold text-jeopardy-gold-light hover:text-white">
              Open Buzzers <Kbd>Spacebar</Kbd>
            </button>
          ) : (
            <button onClick={() => setPhase(phase === 'answer' ? 'clue' : 'answer')} className="flex items-center gap-2 text-sm hover:opacity-80">
              Reveal Correct Response <Kbd>Spacebar</Kbd>
            </button>
          )}
        </div>

        {/* The clue */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-10 py-6 text-center">
          {phase === 'daily_double' ? (
            <div className="space-y-5">
              <p className="text-5xl font-bold text-jeopardy-gold-light">Daily Double!</p>
              <input
                type="number"
                value={ddWager}
                onChange={(e) => setDdWager(e.target.value)}
                className="input-base mx-auto w-56 text-center text-3xl"
                placeholder="Wager"
                autoFocus
              />
              {/* The real cap, spelled out: the greater of the player's score
                  and the board's top value. A host asked to adjudicate that
                  from memory gets it wrong. */}
              <p className="text-sm text-blue-200/70">
                $5 up to the greater of their score and ${ddTopValue.toLocaleString()}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {ddQuickWagers.map((w) => (
                  <button
                    key={w.label}
                    onClick={() => setDdWager(String(w.amount))}
                    className="btn-stage btn-stage-ghost btn-stage-sm"
                  >
                    {w.label} · ${w.amount.toLocaleString()}
                  </button>
                ))}
              </div>
              <button onClick={() => setPhase('clue')} className="btn-primary mx-auto block px-8 py-3 text-lg">
                Show Clue
              </button>
            </div>
          ) : (
            <>
              <p className={`clue-type max-w-7xl text-white ${clueSizeClass(activeClue.question)}`}>
                <ClueText text={activeClue.question} variant="tv" />
              </p>
              {phase === 'answer' && (
                <p className={`mt-8 font-bold text-jeopardy-gold-light ${clueSizeClass(activeClue.question)}`}>
                  <ClueText text={activeClue.answer} variant="tv" />
                </p>
              )}
              {waitingToOpen && (
                <p className="mt-12 text-xs uppercase tracking-[0.3em] text-blue-200/60">
                  Buzzers closed · players can&apos;t see this yet
                </p>
              )}
            </>
          )}
        </div>

        {/* Buzz queue */}
        {console_}
        <ScoreRow
          usingBuzzers={usingBuzzers}
          players={contestants}
          teams={teams}
          step={activeClue.value || 100}
          onManual={(i, d) => setTeams((prev) => prev.map((t, j) => (j === i ? { ...t, score: t.score + d } : t)))}
          onPlayer={(id, d) => hostAdjustScore(id, d).catch(() => {})}
        />
      </div>
    )
  }

  /* ── BOARD ────────────────────────────────────────────────────────────── */
  const cols = roundCategories.length || 1
  const rows = Math.max(...roundCategories.map((cat) => getCluesForCategory(cat.id).length), 1)

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-jeopardy-dark">
      {/* h-[100dvh] + overflow-hidden rather than min-h-screen: the board has
          to shrink to fit, not grow and push the scores off the bottom.
          Same construction as GameBoard so hosting looks like the game. */}
      <div className="min-h-0 flex-1 px-1.5 pb-2 pt-1 md:px-3">
        <div className="board-wrapper h-full">
          <div
            className="grid h-full gap-[3px] md:gap-1"
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `auto repeat(${rows}, 1fr)` }}
          >
            {roundCategories.map((cat) => (
              <div key={cat.id} className="board-category min-h-[44px] p-1.5 md:min-h-[60px] md:p-3">
                {/* Four lines rather than three: the headers grow with the
                    screen, and the longest category names need the extra line
                    before they'd be cut off. */}
                <span className="line-clamp-4 text-center text-[9px] font-bold uppercase leading-tight tracking-wide text-white md:text-sm lg:text-lg xl:text-xl 2xl:text-2xl">
                  {cat.name}
                </span>
              </div>
            ))}

            {roundCategories.length > 0 &&
              Array.from({ length: rows }).map((_, rowIdx) =>
                roundCategories.map((cat) => {
                  const clue = getCluesForCategory(cat.id)[rowIdx]
                  if (!clue) return <div key={`e-${cat.id}-${rowIdx}`} className="board-cell board-cell-answered" />
                  const answered = answeredClueIds.has(clue.id)
                  return (
                    <button
                      key={clue.id}
                      onClick={() => !answered && handleCellClick(clue)}
                      disabled={answered}
                      className={`board-cell min-h-[44px] py-3 md:py-5 ${answered ? 'board-cell-answered' : ''}`}
                    >
                      {!answered && (
                        <span
                          className="text-sm font-bold md:text-2xl"
                          style={{ fontFamily: 'Swiss911, Impact, Arial Black, sans-serif' }}
                        >
                          ${clue.value.toLocaleString()}
                        </span>
                      )}
                    </button>
                  )
                }),
              )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-3 border-t-2 border-black bg-black/50 px-4 py-2">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="rounded border-2 border-white/30 bg-jeopardy-blue-cell px-2 py-3 text-xs font-bold leading-none tracking-widest text-white"
          style={{ writingMode: 'vertical-lr' }}
        >
          MENU
        </button>
        {usingBuzzers && (
          <button
            onClick={() => setShowJoinCode(true)}
            className="rounded border-2 border-jeopardy-gold/50 bg-jeopardy-blue-cell px-2 py-3 text-xs font-bold leading-none tracking-widest text-jeopardy-gold-light"
            style={{ writingMode: 'vertical-lr' }}
            title="Put the join code on screen"
          >
            JOIN
          </button>
        )}
        <ScoreRow
          bare
          usingBuzzers={usingBuzzers}
          players={contestants}
          teams={teams}
          step={100}
          onManual={(i, d) => setTeams((prev) => prev.map((t, j) => (j === i ? { ...t, score: t.score + d } : t)))}
          onPlayer={(id, d) => hostAdjustScore(id, d).catch(() => {})}
        />
        {allAnswered && hasRound2 && currentRound === 1 && (
          <button onClick={() => setCurrentRound(2)} className="btn-primary ml-2 px-4 py-2 text-sm">
            Double Jeopardy! →
          </button>
        )}
        {/* Only renders on a board taken from a real episode. The host's own
            round tracker drives it, not games.current_round, since a hosted
            game moves rounds on this screen. */}
        {game && (
          <div className="w-[260px] shrink-0 empty:hidden">
            <ScoreToBeat
              game={{ settings: game.settings, current_round: currentRound, phase: game.phase }}
              clues={clues}
              categories={categories}
              variant="phone"
            />
          </div>
        )}
      </div>

      {console_}

      {showJoinCode && (
        <JoinQrOverlay
          roomCode={roomCode}
          joined={contestants.length}
          onClose={() => setShowJoinCode(false)}
        />
      )}

      {showMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowMenu(false)}>
          <div className="w-full max-w-xs space-y-3 rounded-2xl border border-white/20 bg-jeopardy-dark p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-center text-lg font-bold text-white">Menu</h3>
            <button onClick={() => { setPhase('setup'); setShowMenu(false) }} className="btn-secondary w-full py-2 text-sm">
              {usingBuzzers ? 'Scoring & players' : 'Edit players'}
            </button>
            {usingBuzzers && (
              <button
                onClick={() => { setShowJoinCode(true); setShowMenu(false) }}
                className="btn-secondary w-full py-2 text-sm"
              >
                Show join code
              </button>
            )}
            <button
              onClick={() => {
                setAnsweredClueIds(new Set()); setCurrentRound(1)
                setTeams((prev) => prev.map((t) => ({ ...t, score: 0 })))
                setShowMenu(false)
              }}
              className="btn-secondary w-full py-2 text-sm"
            >
              Reset board
            </button>
            <button onClick={() => router.push('/')} className="btn-secondary w-full py-2 text-sm text-red-400">
              Exit to home
            </button>
            <button onClick={() => setShowMenu(false)} className="btn-secondary w-full py-2 text-sm">Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded bg-white px-2 py-0.5 text-xs font-semibold text-black">{children}</kbd>
}

/** Score cards. Buzzer games score the real players; manual games score the
 *  local list the host set up. */
function ScoreRow({
  usingBuzzers, players, teams, step, onManual, onPlayer, bare,
}: {
  usingBuzzers: boolean
  players: { id: string; name: string; score: number }[]
  teams: Team[]
  step: number
  onManual: (index: number, delta: number) => void
  onPlayer: (playerId: string, delta: number) => void
  bare?: boolean
}) {
  const rows = usingBuzzers
    ? players.map((p) => ({ key: p.id, name: p.name, score: p.score, bump: (d: number) => onPlayer(p.id, d) }))
    : teams.map((t, i) => ({ key: String(i), name: t.name, score: t.score, bump: (d: number) => onManual(i, d) }))

  /**
   * EVERY player, always.
   *
   * This used to cut to a top-ten leaderboard past ten players, with a
   * "+5 more" card standing in for the rest. That is precisely backwards: the
   * reason to look at this strip is to add or correct somebody's points, and
   * the people who need correcting are the ones who aren't in the top ten. A
   * host with fifteen in the room could see ten of them and had no way to
   * reach the other five at all.
   *
   * So the cards shrink instead of disappearing. Fifteen narrow cards fit
   * across a laptop; past that the strip scrolls sideways, which is a
   * nuisance but never a dead end.
   */
  const n = rows.length
  const cardW =
    n <= 6 ? 'w-[110px] md:w-[140px]'
    : n <= 10 ? 'w-[96px] md:w-[116px]'
    : n <= 16 ? 'w-[64px] md:w-[78px]'
    : n <= 24 ? 'w-[56px] md:w-[62px]'
    : 'w-[48px] md:w-[52px]'
  // The gap closes up as the row fills, which is what buys the last two or
  // three cards their place on screen rather than just off the right edge.
  const gap = n <= 10 ? 'gap-3' : n <= 16 ? 'gap-1.5' : 'gap-1'
  const nameSize = n <= 10 ? 'text-sm md:text-base' : 'text-[11px] md:text-xs'
  const scoreSize = n <= 6 ? 'text-lg md:text-xl' : n <= 16 ? 'text-base md:text-lg' : 'text-sm'

  const cards = (
    <>
      {rows.length === 0 && <p className="text-sm text-gray-500">No players yet</p>}
      {rows.map((r) => (
        <div key={r.key} className={`${cardW} shrink-0 overflow-hidden rounded-lg bg-white text-center`}>
          <p className={`truncate border-b-2 border-jeopardy-blue-cell px-1.5 py-1 font-bold italic text-black ${nameSize}`}>
            {r.name}
          </p>
          <p className={`border-b border-gray-300 px-1 py-1 font-bold tabular-nums text-black ${scoreSize}`}>
            {r.score < 0 ? `-$${Math.abs(r.score).toLocaleString()}` : `$${r.score.toLocaleString()}`}
          </p>
          <div className="flex">
            <button onClick={() => r.bump(step)} className="flex-1 py-0.5 text-lg font-bold leading-none text-green-600 transition-colors hover:bg-green-50">+</button>
            <button onClick={() => r.bump(-step)} className="flex-1 py-0.5 text-lg font-bold leading-none text-red-600 transition-colors hover:bg-red-50">−</button>
          </div>
        </div>
      ))}
    </>
  )

  // One row, scrolled sideways if it has to be — wrapping would make the
  // footer taller and steal height from the board above it. The cards get
  // their own scroll box rather than sharing the footer's, so the MENU and
  // JOIN buttons beside them stay put instead of scrolling away with the
  // scores.
  const strip = (
    <div className={`flex min-w-0 flex-1 items-center justify-center overflow-x-auto ${gap}`}>
      {cards}
    </div>
  )
  if (bare) return strip
  return (
    <div className="flex shrink-0 items-center justify-center gap-3 border-t-2 border-black bg-black/60 px-4 py-2">
      {strip}
    </div>
  )
}
