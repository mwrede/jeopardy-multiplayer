'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useGameChannel } from '@/hooks/useGameChannel'
import { ClueText } from '@/components/ClueText'
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

/**
 * PRESENT — the host's screen.
 *
 * Two ways to score, chosen at setup:
 *
 *   Manual   — the host keeps score for teams in the room. Nothing to join,
 *              nothing to sync; the whole game lives in this tab.
 *   Buzzers  — players join on their phones and become the teams. The host
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

/** In a big room only the front of the queue matters — nobody judges #47. */
const BUZZ_SHOWN = 8

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
    { name: 'Team 1', score: 0 },
    { name: 'Team 2', score: 0 },
    { name: 'Team 3', score: 0 },
  ])
  const [teamCount, setTeamCount] = useState(3)

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
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  const [justScored, setJustScored] = useState<string | null>(null)
  const [showHostLink, setShowHostLink] = useState(false)
  const [hostCopied, setHostCopied] = useState(false)

  useEffect(() => { setOrigin(window.location.origin) }, [])

  // Hooks above run unconditionally; the control screen owns its own state.
  if (isControl) return <PresenterControl roomCode={roomCode} />

  const usingBuzzers = scoring === 'buzzers'
  // createPresentationGame seeds a placeholder "Presenter" row so the board
  // can be built before anyone joins. It isn't a contestant — keep it out of
  // the scoreboard and the buzz queue.
  const contestants = players.filter((p) => p.name !== 'Presenter')
  const joinUrl = origin ? `${origin}/game/${roomCode}` : ''
  const hostUrl = origin ? `${origin}/game/${roomCode}/present?control=1` : ''

  const roundCategories = categories
    .filter((c) => c.round_number === currentRound)
    .sort((a, b) => a.position - b.position)
  const roundClues = clues.filter((c) => roundCategories.some((cat) => cat.id === c.category_id))
  const allAnswered = roundClues.length > 0 && roundClues.every((c) => answeredClueIds.has(c.id))
  const hasRound2 = categories.some((c) => c.round_number === 2)

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
   * Follow the phone. When the presenter rules on an answer from their own
   * device the clue resolves server-side, and this screen — which may be the
   * one projected — has to come back to the board on its own. Without this the
   * laptop sits on a finished clue until someone hits Continue.
   */
  useEffect(() => {
    if (!usingBuzzers || !activeClue) return
    if (game?.phase === 'clue_result' || game?.phase === 'board_selection') {
      setAnsweredClueIds((prev) => new Set([...prev, activeClue.id]))
      setActiveClue(null)
      setActiveCategory(null)
      setBuzzOrder([])
      setPhase('board')
    }
  }, [game?.phase, usingBuzzers, activeClue])

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
      ? parseInt(ddWager) || activeClue.value
      : activeClue.value
    setTeams((prev) =>
      prev.map((t, i) => (i === teamIdx ? { ...t, score: t.score + (correct ? points : -points) } : t)),
    )
  }

  function judgeBuzzer(playerId: string, correct: boolean) {
    if (!game || !activeClue) return
    hostJudge(game.id, activeClue.id, playerId, correct).catch(() => {})
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
      <div className="flex min-h-screen items-center justify-center bg-[#2E2E96] p-6">
        <div className="w-full max-w-md space-y-6 rounded-2xl border border-white/20 bg-[#1A1A5C] p-8">
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
                Manual teams
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
                  1 · Contestants
                </p>
                <p className="mb-3 text-sm text-gray-300">
                  Show this to the room. Everyone who joins becomes a team.
                </p>
                {joinUrl && (
                  <div className="flex flex-col items-center gap-3">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(joinUrl)}`}
                      alt={`Scan to join room ${roomCode}`}
                      className="h-40 w-40 rounded-lg bg-white p-2"
                    />
                    <p className="font-mono text-2xl font-bold tracking-[0.3em] text-white">{roomCode}</p>
                    <button
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(joinUrl) }
                        catch { window.prompt('Copy this link:', joinUrl) }
                        setCopied(true); setTimeout(() => setCopied(false), 2000)
                      }}
                      className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
                    >
                      {copied ? '✓ Copied' : 'Copy contestant link'}
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-white/15 bg-black/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.24em] text-jeopardy-gold-light">
                      2 · Presenter — keep private
                    </p>
                    <p className="mt-1 text-sm text-gray-300">
                      Answers, the buzzer lock, and who buzzed in what order.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowHostLink((v) => !v)}
                    className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                  >
                    {showHostLink ? 'Hide' : 'Show link'}
                  </button>
                </div>
                {showHostLink && hostUrl && (
                  <div className="mt-3 space-y-2">
                    <p className="break-all rounded bg-black/50 px-3 py-2 font-mono text-xs text-gray-300">
                      {hostUrl}
                    </p>
                    <button
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(hostUrl) }
                        catch { window.prompt('Copy this link:', hostUrl) }
                        setHostCopied(true); setTimeout(() => setHostCopied(false), 2000)
                      }}
                      className="w-full rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
                    >
                      {hostCopied ? '✓ Copied' : 'Copy presenter link'}
                    </button>
                    <p className="text-xs text-gray-500">
                      Open on your phone or laptop and leave the board on the TV.
                      Never put this one on the big screen.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-[0.24em] text-gray-400">
                  Joined ({contestants.length})
                </p>
                {contestants.length === 0 && <p className="text-sm italic text-gray-500">Waiting for players…</p>}
                {contestants.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-3 rounded bg-white/5 px-3 py-2">
                    <span className="w-5 text-xs tabular-nums text-jeopardy-gold-light">{i + 1}</span>
                    <span className="font-semibold text-white">{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-2 block text-sm text-gray-300">Number of Teams</label>
                <div className="flex gap-2">
                  {[2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      onClick={() => {
                        setTeamCount(n)
                        setTeams((prev) =>
                          Array.from({ length: n }, (_, i) => prev[i] || { name: `Team ${i + 1}`, score: 0 }),
                        )
                      }}
                      className={`flex-1 rounded-lg py-2 font-bold transition-colors ${
                        teamCount === n ? 'bg-jeopardy-gold text-black' : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-sm text-gray-300">Team Names</label>
                {teams.slice(0, teamCount).map((team, i) => (
                  <input
                    key={i}
                    type="text"
                    value={team.name}
                    onChange={(e) =>
                      setTeams((prev) => prev.map((t, j) => (j === i ? { ...t, name: e.target.value } : t)))
                    }
                    className="input-base text-base"
                    placeholder={`Team ${i + 1}`}
                  />
                ))}
              </div>
            </>
          )}

          <button
            onClick={() => {
              if (!usingBuzzers) setTeams((prev) => prev.slice(0, teamCount))
              else if (game) {
                // Phones key off gameMode to decide whether to show the clue
                // when buzzers open. Without this they'd sit on "Watch the TV".
                supabase.from('games')
                  .update({ settings: { ...(game.settings as any), gameMode: 'host' } })
                  .eq('id', game.id).then(() => {})
              }
              setPhase('board')
            }}
            disabled={usingBuzzers && contestants.length === 0}
            className="btn-primary w-full py-4 text-lg disabled:opacity-40"
          >
            {usingBuzzers && contestants.length === 0 ? 'Waiting for players…' : 'Start Presenting'}
          </button>
        </div>
      </div>
    )
  }

  /* ── CLUE / ANSWER ────────────────────────────────────────────────────── */
  if ((phase === 'clue' || phase === 'answer' || phase === 'daily_double') && activeClue) {
    const waitingToOpen = usingBuzzers && phase === 'clue' && !buzzersOpen
    const untried = buzzOrder.filter((b) => b.is_correct === null)

    return (
      <div className="flex min-h-screen flex-col bg-[#2E2E96]">
        {/* Control bar */}
        <div className="flex items-center justify-between gap-4 bg-[#1A1A5C] px-4 py-2.5 text-white">
          <button onClick={backToBoard} className="flex items-center gap-2 text-sm hover:opacity-80">
            Continue <Kbd>ESC</Kbd>
          </button>
          <span className="truncate text-sm font-bold">
            {activeCategory?.name} for {activeClue.value}
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
        <div className="flex flex-1 flex-col items-center justify-center px-10 py-8 text-center">
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
              <button onClick={() => setPhase('clue')} className="btn-primary mx-auto block px-8 py-3 text-lg">
                Show Clue
              </button>
            </div>
          ) : (
            <>
              <p className="max-w-6xl text-5xl font-normal leading-tight text-white md:text-7xl">
                <ClueText text={activeClue.question} />
              </p>
              {phase === 'answer' && (
                <p className="mt-12 text-4xl font-bold text-jeopardy-gold-light md:text-6xl">
                  {activeClue.answer}
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
        {/* The management strip. Present whenever buzzers are live, even before
            anyone rings in, so the host knows where verdicts will appear. */}
        {usingBuzzers && buzzersOpen && (
          <div className="border-t border-white/15 bg-black/30 px-4 py-3">
            <p className="mb-2 text-[10px] uppercase tracking-[0.24em] text-blue-200/60">
              {untried.length === 0
                ? 'Buzzers open — waiting for someone to ring in'
                : untried.length > BUZZ_SHOWN
                  ? `Buzzed in — first ${BUZZ_SHOWN} of ${untried.length}`
                  : 'Buzzed in — ✓ awards, ✗ deducts and passes on'}
            </p>
            <div className="flex flex-wrap gap-2">
              {untried.slice(0, BUZZ_SHOWN).map((b, i) => {
                const p = contestants.find((pl) => pl.id === b.player_id)
                if (!p) return null
                const isHolder = p.id === game?.current_player_id
                return (
                  <div
                    key={b.player_id}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
                      isHolder ? 'bg-jeopardy-gold/25 ring-2 ring-jeopardy-gold' : 'bg-white/10'
                    }`}
                  >
                    <span className="text-xs tabular-nums text-blue-200/60">{i + 1}</span>
                    <span className="font-semibold text-white">{p.name}</span>
                    <button onClick={() => judgeBuzzer(p.id, true)} className="rounded bg-green-600 px-2 py-1 text-sm font-bold text-white hover:bg-green-500" title="Correct">✓</button>
                    <button onClick={() => judgeBuzzer(p.id, false)} className="rounded bg-red-600 px-2 py-1 text-sm font-bold text-white hover:bg-red-500" title="Incorrect">✗</button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

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
    <div className="flex min-h-screen flex-col bg-black">
      <div className="flex flex-1 flex-col p-1.5">
        <div
          className="grid flex-1 gap-1.5"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `auto repeat(${rows}, 1fr)` }}
        >
          {roundCategories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center justify-center bg-[#2E2E96] px-2 py-4 text-center text-sm font-bold uppercase leading-tight tracking-wide text-white md:text-xl"
              style={{ textShadow: '2px 2px 3px rgba(0,0,0,0.6)' }}
            >
              {cat.name}
            </div>
          ))}

          {roundCategories.length > 0 &&
            Array.from({ length: rows }).map((_, rowIdx) =>
              roundCategories.map((cat) => {
                const clue = getCluesForCategory(cat.id)[rowIdx]
                if (!clue) return <div key={`e-${cat.id}-${rowIdx}`} className="bg-[#2E2E96]" />
                const answered = answeredClueIds.has(clue.id)
                return (
                  <button
                    key={clue.id}
                    onClick={() => !answered && handleCellClick(clue)}
                    disabled={answered}
                    className={`bg-[#2E2E96] text-4xl font-bold transition-colors md:text-6xl ${
                      answered ? 'cursor-default text-transparent' : 'text-[#E9B23C] hover:bg-[#3838AE]'
                    }`}
                    style={answered ? undefined : { textShadow: '3px 3px 4px rgba(0,0,0,0.55)' }}
                  >
                    ${clue.value.toLocaleString()}
                  </button>
                )
              }),
            )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 bg-black px-4 py-2">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="rounded border-2 border-white/30 bg-[#2E2E96] px-2 py-3 text-xs font-bold leading-none tracking-widest text-white"
          style={{ writingMode: 'vertical-lr' }}
        >
          MENU
        </button>
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
      </div>

      {showMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowMenu(false)}>
          <div className="w-full max-w-xs space-y-3 rounded-2xl border border-white/20 bg-[#1A1A5C] p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-center text-lg font-bold text-white">Menu</h3>
            <button onClick={() => { setPhase('setup'); setShowMenu(false) }} className="btn-secondary w-full py-2 text-sm">
              {usingBuzzers ? 'Scoring & players' : 'Edit teams'}
            </button>
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

/** Team cards. Buzzer games score the real players; manual games score local teams. */
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
  const all = usingBuzzers
    ? players.map((p) => ({ key: p.id, name: p.name, score: p.score, bump: (d: number) => onPlayer(p.id, d) }))
    : teams.map((t, i) => ({ key: String(i), name: t.name, score: t.score, bump: (d: number) => onManual(i, d) }))

  // A big room can't show everyone — 150 cards is unreadable and unclickable.
  // Past ten, show the leaderboard: top ten by score, and say how many are
  // hidden so nobody thinks they vanished.
  const LIMIT = 10
  const overflow = all.length > LIMIT
  const rows = overflow
    ? [...all].sort((a, b) => b.score - a.score).slice(0, LIMIT)
    : all

  const cards = (
    <>
      {rows.length === 0 && <p className="text-sm text-gray-500">No players yet</p>}
      {rows.map((r) => (
        <div key={r.key} className="min-w-[110px] overflow-hidden rounded-lg bg-white text-center md:min-w-[140px]">
          <p className="border-b-2 border-[#2E2E96] px-3 py-1 text-sm font-bold italic text-black md:text-base">
            {r.name}
          </p>
          <p className="border-b border-gray-300 px-3 py-1 text-lg font-bold tabular-nums text-black md:text-xl">
            {r.score < 0 ? `-$${Math.abs(r.score).toLocaleString()}` : `$${r.score.toLocaleString()}`}
          </p>
          <div className="flex">
            <button onClick={() => r.bump(step)} className="flex-1 py-0.5 text-lg font-bold text-green-600 transition-colors hover:bg-green-50">+</button>
            <button onClick={() => r.bump(-step)} className="flex-1 py-0.5 text-lg font-bold text-red-600 transition-colors hover:bg-red-50">−</button>
          </div>
        </div>
      ))}
      {overflow && (
        <div className="self-center rounded-lg bg-white/10 px-3 py-2 text-center">
          <p className="text-[10px] uppercase tracking-[0.2em] text-blue-200/70">Top {LIMIT}</p>
          <p className="text-sm font-bold text-white">+{all.length - LIMIT} more</p>
        </div>
      )}
    </>
  )

  if (bare) return <>{cards}</>
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 border-t-2 border-black bg-black/60 px-4 py-2">
      {cards}
    </div>
  )
}
