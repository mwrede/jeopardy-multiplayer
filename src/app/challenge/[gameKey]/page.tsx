'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useUser } from '@/lib/auth'
import { checkAnswerDetailed } from '@/lib/answer-check'
import { ChallengeShare } from '@/components/ChallengeShare'
import {
  getChallengeGame,
  isDailyDouble,
  formatAirDate,
  ROUND_VALUES,
  CLUES_PER_GAME,
  TIER_LABELS,
  type ChallengeGame,
} from '@/lib/challenge-data'
import {
  fetchGameResults,
  getChallengeIdentity,
  pickOpponents,
  submitChallengeResult,
  formatMoney,
  type ChallengeResult,
  type ClueResult,
  type ClueOutcome,
} from '@/lib/challenge'

/**
 * ONE CHALLENGE BOARD — a full miniature Jeopardy! game, solo.
 *
 * Jeopardy round, Double Jeopardy round, a hidden Daily Double in each, and
 * Final Jeopardy with a wager. Every clue is a real clue from a real episode,
 * and the screen says which game it aired in.
 *
 * The trick that makes solo feel like a real matchup: the board's TOP PLAYER
 * — the actual person holding the best score — is dealt in beside you. Their
 * finished game is on record clue by clue, wagers included, so when you
 * resolve a clue their recorded result lands on their score at the same
 * moment. By the end their total is their true final score.
 *
 * One play per person, enforced by the database. A half-finished run is
 * parked in this browser so a refresh resumes rather than resets — against
 * the same three opponents.
 */

const CLUE_SECONDS = 30
const FJ_SECONDS = 35

type Phase = 'loading' | 'played' | 'intro' | 'playing' | 'done'
type OverlayStage = 'wager' | 'answering' | 'reveal'

/** Where a half-played run is parked between refreshes. */
const runKey = (gameKey: string) => `challengeRun:${gameKey}`

type SavedRun = { name: string; opponentIds: string[]; clueResults: ClueResult[] }

function readRun(gameKey: string): SavedRun | null {
  try {
    const raw = localStorage.getItem(runKey(gameKey))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.clueResults) && typeof parsed?.name === 'string') return parsed
  } catch {}
  return null
}

function scoreOf(results: ClueResult[]): number {
  return results.reduce(
    (sum, r) => sum + (r.outcome === 'correct' ? r.value : r.outcome === 'wrong' ? -r.value : 0),
    0,
  )
}

const cellKey = (rd: number, c: number, r: number) => `${rd}:${c}:${r}`

/** A ghost's score counting only the clues the live player has resolved. */
function ghostScoreSoFar(op: ChallengeResult, resolved: ClueResult[]): number {
  const done = new Set(resolved.map((x) => cellKey(x.rd ?? 1, x.c, x.r)))
  return scoreOf(op.clue_results.filter((x) => done.has(cellKey(x.rd ?? 1, x.c, x.r))))
}

function ghostResultOn(op: ChallengeResult, rd: number, c: number, r: number): ClueResult | undefined {
  return op.clue_results.find((x) => (x.rd ?? 1) === rd && x.c === c && x.r === r)
}

const AVATAR_COLORS = ['#F58A2C', '#38BDF8', '#A78BFA', '#34D399', '#F472B6', '#FACC15']
function avatarColor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export default function ChallengeGamePage() {
  const params = useParams<{ gameKey: string }>()
  const game = getChallengeGame(params.gameKey)
  const { user, profile, loading: userLoading } = useUser()

  const [phase, setPhase] = useState<Phase>('loading')
  const [identity, setIdentity] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [allResults, setAllResults] = useState<ChallengeResult[]>([])
  const [mine, setMine] = useState<ChallengeResult | null>(null)
  const [opponents, setOpponents] = useState<ChallengeResult[]>([])
  const [clueResults, setClueResults] = useState<ClueResult[]>([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // The open board clue and what's happened inside it.
  const [active, setActive] = useState<{ rd: number; c: number; r: number } | null>(null)
  const [overlayStage, setOverlayStage] = useState<OverlayStage>('answering')
  const [typed, setTyped] = useState('')
  const [wagerText, setWagerText] = useState('')
  /** The money on the line for the open clue — cell value, or a locked wager. */
  const [stake, setStake] = useState(0)
  const [lastOutcome, setLastOutcome] = useState<ClueOutcome>('pass')
  const [secondsLeft, setSecondsLeft] = useState(CLUE_SECONDS)

  // Between-round curtain, and the Final Jeopardy sequence.
  const [djSeen, setDjSeen] = useState(false)
  const [fjStage, setFjStage] = useState<null | OverlayStage>(null)

  const r1Count = clueResults.filter((x) => (x.rd ?? 1) === 1).length
  const r2Count = clueResults.filter((x) => x.rd === 2).length
  const fjResult = clueResults.find((x) => x.rd === 3)
  const boardDone = r1Count >= 9 && r2Count >= 9
  const currentRound = r1Count < 9 ? 1 : 2
  const myScore = scoreOf(clueResults)

  // ── Load: who am I, who has played, have I? ──────────────────────────
  useEffect(() => {
    if (userLoading || !game) return
    const id = getChallengeIdentity(user?.id)
    setIdentity(id)

    fetchGameResults(game.key)
      .then((results) => {
        setAllResults(results)
        const my = results.find((r) => r.identity_key === id) ?? null
        setMine(my)
        if (my) {
          try { localStorage.removeItem(runKey(game.key)) } catch {}
          setPhase('played')
          return
        }

        const saved = readRun(game.key)
        if (saved && saved.clueResults.length > 0) {
          // Resume mid-run, against the same table.
          setName(saved.name)
          setClueResults(saved.clueResults)
          const ops = saved.opponentIds
            .map((oid) => results.find((r) => r.id === oid))
            .filter(Boolean) as ChallengeResult[]
          setOpponents(ops)
          if (saved.clueResults.length >= CLUES_PER_GAME) {
            // Cleared but never recorded — a refresh on the final screen, or
            // a submit that failed. Record it now.
            finalize(saved.name, id, saved.clueResults)
          } else {
            setPhase('playing')
          }
        } else {
          setName(localStorage.getItem('playerName') || profile?.display_name || '')
          setOpponents(pickOpponents(results, id))
          setPhase('intro')
        }
      })
      .catch((e) => {
        const msg = String(e?.message || '')
        setError(
          /challenge_results/.test(msg)
            ? 'Leaderboards aren’t live yet — run supabase-migration-challenge-results.sql in the Supabase dashboard first.'
            : msg || 'Could not load this board.',
        )
        setPhase('intro')
      })
  // profile arrives after user; it only seeds the name field.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userLoading, game?.key])

  // ── Persist a run in progress ────────────────────────────────────────
  const saveRun = useCallback((nm: string, ops: ChallengeResult[], res: ClueResult[]) => {
    if (!game) return
    try {
      localStorage.setItem(
        runKey(game.key),
        JSON.stringify({ name: nm, opponentIds: ops.map((o) => o.id), clueResults: res } satisfies SavedRun),
      )
    } catch {}
  }, [game])

  // ── Clue timer (board clues) ─────────────────────────────────────────
  useEffect(() => {
    if (!active || overlayStage !== 'answering') return
    setSecondsLeft(CLUE_SECONDS)
    const started = Date.now()
    const t = setInterval(() => {
      const left = CLUE_SECONDS - Math.floor((Date.now() - started) / 1000)
      setSecondsLeft(Math.max(0, left))
      if (left <= 0) {
        clearInterval(t)
        resolveClue('timeout', '')
      }
    }, 250)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, overlayStage])

  // ── Final Jeopardy timer ─────────────────────────────────────────────
  useEffect(() => {
    if (fjStage !== 'answering') return
    setSecondsLeft(FJ_SECONDS)
    const started = Date.now()
    const t = setInterval(() => {
      const left = FJ_SECONDS - Math.floor((Date.now() - started) / 1000)
      setSecondsLeft(Math.max(0, left))
      if (left <= 0) {
        clearInterval(t)
        resolveFinal('')
      }
    }, 250)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fjStage])

  // Both rounds cleared → Final Jeopardy begins.
  useEffect(() => {
    if (phase === 'playing' && boardDone && !fjResult && fjStage === null && !active) {
      setWagerText('')
      setFjStage('wager')
    }
  }, [phase, boardDone, fjResult, fjStage, active])

  // Game over: present the final screen from the top, standings in view —
  // the page can be left mid-scroll by the board, and the whole point of
  // finishing is seeing where you landed.
  useEffect(() => {
    if (phase === 'done' || phase === 'played') {
      try { window.scrollTo({ top: 0 }) } catch {}
    }
  }, [phase])

  // ── Actions ──────────────────────────────────────────────────────────
  function begin() {
    const trimmed = name.trim()
    if (!trimmed) { setError('Pick a name first — it goes on the leaderboard.'); return }
    setError('')
    try { localStorage.setItem('playerName', trimmed) } catch {}
    setName(trimmed)
    saveRun(trimmed, opponents, [])
    setPhase('playing')
  }

  function openClue(rd: number, c: number, r: number) {
    if (!game || clueResults.some((x) => (x.rd ?? 1) === rd && x.c === c && x.r === r)) return
    setTyped('')
    if (isDailyDouble(game, rd, c, r)) {
      setWagerText('')
      setOverlayStage('wager')
    } else {
      setStake(ROUND_VALUES[rd - 1][r])
      setOverlayStage('answering')
    }
    setActive({ rd, c, r })
  }

  /** Most you can put on a Daily Double: your total, or the round's top value. */
  function ddMax(rd: number): number {
    return Math.max(myScore, ROUND_VALUES[rd - 1][2])
  }

  function confirmWager() {
    if (!active) return
    const max = ddMax(active.rd)
    const w = Math.min(max, Math.max(5, Math.round(Number(wagerText) || 0)))
    setStake(w)
    setOverlayStage('answering')
  }

  function resolveClue(kind: 'answer' | 'pass' | 'timeout', text: string) {
    if (!active || !game) return
    const { rd, c, r } = active
    const clue = game.rounds[rd - 1][c].clues[r]
    const dd = isDailyDouble(game, rd, c, r)

    // On a Daily Double there's no passing — the wager rides on it either way.
    let outcome: ClueOutcome = dd ? 'wrong' : 'pass'
    if (kind === 'answer' && text.trim()) {
      outcome = checkAnswerDetailed(text, clue.a).correct ? 'correct' : 'wrong'
    }

    const next = [...clueResults, { rd, c, r, outcome, value: stake, answer: text.trim() || undefined }]
    setClueResults(next)
    setLastOutcome(outcome)
    setOverlayStage('reveal')
    saveRun(name, opponents, next)
  }

  function closeClue() {
    setActive(null)
  }

  function confirmFjWager() {
    const max = Math.max(0, myScore)
    const w = Math.min(max, Math.max(0, Math.round(Number(wagerText) || 0)))
    setStake(w)
    setTyped('')
    setFjStage('answering')
  }

  function resolveFinal(text: string) {
    if (!game) return
    // Not answering Final Jeopardy is a miss — the wager is lost, as on the show.
    const outcome: ClueOutcome =
      text.trim() && checkAnswerDetailed(text, game.finalJeopardy.a).correct ? 'correct' : 'wrong'
    const next = [...clueResults, { rd: 3, c: 0, r: 0, outcome, value: stake, answer: text.trim() || undefined }]
    setClueResults(next)
    setLastOutcome(outcome)
    setFjStage('reveal')
    saveRun(name, opponents, next)
  }

  function closeFinal() {
    if (!identity) return
    setFjStage(null)
    finalize(name, identity, clueResults)
  }

  /**
   * Game over — record it and pull the fresh standings. The unique
   * constraint is the referee if this somehow runs twice; a rejection for
   * "already played" is recovered by loading the standing result instead.
   */
  async function finalize(nm: string, id: string, res: ClueResult[]) {
    if (!game) return
    setSubmitting(true)
    setPhase('done')
    try {
      await submitChallengeResult({
        gameKey: game.key,
        identityKey: id,
        userId: user?.id,
        playerName: nm,
        score: scoreOf(res),
        correctCount: res.filter((x) => x.outcome === 'correct').length,
        clueResults: res,
      })
      try { localStorage.removeItem(runKey(game.key)) } catch {}
      const results = await fetchGameResults(game.key)
      setAllResults(results)
      setMine(results.find((x) => x.identity_key === id) ?? null)
    } catch (e: any) {
      // Already on the books? Show the recorded game rather than an error.
      const results = await fetchGameResults(game.key).catch(() => null)
      const existing = results?.find((x) => x.identity_key === id)
      if (existing) {
        try { localStorage.removeItem(runKey(game.key)) } catch {}
        setAllResults(results!)
        setMine(existing)
        setPhase('played')
      } else {
        setError(e?.message || 'Could not record your score.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ── Views ────────────────────────────────────────────────────────────
  if (!game) {
    return (
      <Shell>
        <p className="mt-16 text-center text-sm text-ink-stage-2">
          That board doesn&apos;t exist. <a href="/challenge" className="text-copper underline">Back to the Challenge</a>
        </p>
      </Shell>
    )
  }

  if (phase === 'loading') {
    return (
      <Shell>
        <p className="mt-16 text-center text-sm italic text-ink-stage-2">Setting up the board…</p>
      </Shell>
    )
  }

  if (phase === 'played' && mine) {
    const rank = allResults.findIndex((r) => r.id === mine.id) + 1
    return (
      <Shell>
        <BoardHeading game={game} />
        <div className="mt-6 rounded-xl border-2 border-jeopardy-gold bg-jeopardy-gold/10 p-5 text-center">
          <p className="text-[10px] uppercase tracking-[0.28em] text-jeopardy-gold-light">Your one shot</p>
          <p className="mt-2 text-4xl font-bold text-white">{formatMoney(mine.score)}</p>
          <p className="mt-1 text-sm text-ink-stage-2">
            {mine.correct_count} of {CLUES_PER_GAME} right · #{rank} of {allResults.length} — this board is done for you.
          </p>
          <div className="mt-4">
            <ChallengeShare
              game={game}
              result={{ score: mine.score, clueResults: mine.clue_results }}
            />
            <p className="mt-2 text-[11px] text-ink-stage-2">
              Copies your result and a link so someone else can play this exact board.
            </p>
          </div>
        </div>
        <Standings results={allResults} identity={identity} title="Leaderboard" />
        <BackToHub />
      </Shell>
    )
  }

  if (phase === 'intro') {
    return (
      <Shell>
        <BoardHeading game={game} />
        <MatchupIntro game={game} opponents={opponents} name={name} />

        <div className="mx-auto mt-6 max-w-md">
          <label className="mb-1.5 block text-[10px] uppercase tracking-[0.22em] text-copper" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
            Your name on the leaderboard
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pick a name"
            maxLength={15}
            className="field-stage"
          />
          <button onClick={begin} className="btn-stage btn-copper btn-stage-lg mt-4 w-full">
            Play — one shot
          </button>
          <p className="mt-2 text-center text-[11px] text-ink-stage-2">
            Two 3×3 rounds, a hidden Daily Double in each, then Final Jeopardy.
            Right answers win the money, wrong ones lose it — and once you start,
            this board is spent.
          </p>
          {error && <p className="mt-3 text-center text-sm text-copper-glow">{error}</p>}
        </div>

        <Standings results={allResults} identity={identity} title="Current leaderboard" />
        <BackToHub />
      </Shell>
    )
  }

  if (phase === 'done') {
    const table = [
      { name: `${name} (you)`, score: myScore, you: true },
      ...opponents.map((o) => ({ name: `👑 Top Player — ${o.player_name}`, score: o.score, you: false })),
    ].sort((a, b) => b.score - a.score)
    const won = table[0]?.you && (table.length === 1 || table[0].score > table[1].score)

    return (
      <Shell>
        <BoardHeading game={game} />
        <div className="mt-6 rounded-xl border-2 border-jeopardy-gold bg-jeopardy-gold/10 p-5 text-center">
          <p className="text-[10px] uppercase tracking-[0.28em] text-jeopardy-gold-light">
            {submitting
              ? 'Recording your score…'
              : won
                ? opponents.length > 0 ? 'You beat the Top Player' : 'First score on the board'
                : 'Final scores'}
          </p>
          <div className="mx-auto mt-3 max-w-sm space-y-1.5">
            {table.map((p, i) => (
              <div
                key={p.name + i}
                className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                  p.you ? 'bg-jeopardy-gold/20 text-white' : 'bg-black/30 text-ink-stage'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className="w-5 text-left tabular-nums text-ink-stage-2">{i + 1}</span>
                  {p.name}
                </span>
                <span className="font-bold tabular-nums text-jeopardy-gold-light">{formatMoney(p.score)}</span>
              </div>
            ))}
          </div>
          {!submitting && mine && (
            <p className="mt-3 text-sm text-white">
              You&apos;re now{' '}
              <span className="font-bold text-jeopardy-gold-light">
                #{allResults.findIndex((x) => x.id === mine.id) + 1} of {allResults.length}
              </span>{' '}
              on this board.
            </p>
          )}
          {!submitting && (
            <div className="mt-4">
              <ChallengeShare
                game={game}
                result={{ score: myScore, clueResults }}
              />
              <p className="mt-2 text-[11px] text-ink-stage-2">
                Copies your result and a link so someone else can play this exact board.
              </p>
            </div>
          )}
        </div>
        {error && <p className="mt-4 text-center text-sm text-copper-glow">{error}</p>}
        <Standings results={allResults} identity={identity} title="Final standings" />
        <BackToHub />
      </Shell>
    )
  }

  // ── phase === 'playing' ──────────────────────────────────────────────

  // The curtain between rounds.
  if (r1Count >= 9 && r2Count === 0 && !djSeen && !active) {
    return (
      <Shell>
        <BoardHeading game={game} compact />
        <div className="mt-10 rounded-xl border-2 border-jeopardy-gold bg-jeopardy-gold/10 p-8 text-center">
          <p className="text-[10px] uppercase tracking-[0.3em] text-jeopardy-gold-light">
            That&apos;s the Jeopardy round
          </p>
          <p className="mt-3 text-3xl font-bold text-white">{formatMoney(myScore)}</p>
          <h2 className="display-chrome mt-6 text-3xl">Double Jeopardy</h2>
          <p className="mt-2 text-sm text-ink-stage-2">
            Values double — and another Daily Double is hiding out there.
          </p>
          <button onClick={() => setDjSeen(true)} className="btn-stage btn-copper btn-stage-lg mt-6">
            Bring on the board
          </button>
        </div>
      </Shell>
    )
  }

  const roundCats = game.rounds[currentRound - 1]
  const values = ROUND_VALUES[currentRound - 1]

  return (
    <Shell wide>
      <BoardHeading game={game} compact />

      {/* Score rail: you and the table, live. */}
      <div className="mx-auto mt-4 flex max-w-2xl flex-wrap items-stretch justify-center gap-2">
        <ScoreCard name={`${name} (you)`} score={myScore} you />
        {opponents.map((o) => (
          <ScoreCard key={o.id} name={o.player_name} label="👑 Top Player" score={ghostScoreSoFar(o, clueResults)} />
        ))}
      </div>

      {!boardDone && (
        <>
          <p className="mt-4 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-jeopardy-gold-light">
            {currentRound === 1 ? 'Jeopardy Round' : 'Double Jeopardy Round'}
          </p>

          <div className="board-wrapper mx-auto mt-2 max-w-2xl">
            <div className="grid grid-cols-3 gap-1 p-1">
              {roundCats.map((cat, c) => (
                <div key={c} className="board-category min-h-[64px] px-2 py-2 text-[11px] font-bold uppercase leading-tight text-white md:text-sm">
                  {cat.name}
                </div>
              ))}
              {[0, 1, 2].map((r) =>
                roundCats.map((_, c) => {
                  const res = clueResults.find((x) => (x.rd ?? 1) === currentRound && x.c === c && x.r === r)
                  return (
                    <button
                      key={`${c}:${r}`}
                      onClick={() => openClue(currentRound, c, r)}
                      disabled={!!res}
                      className={`min-h-[72px] text-2xl md:min-h-[88px] md:text-4xl ${
                        res
                          ? res.outcome === 'correct'
                            ? 'board-cell board-cell-correct'
                            : res.outcome === 'wrong'
                              ? 'board-cell board-cell-wrong'
                              : 'board-cell board-cell-answered'
                          : 'board-cell'
                      }`}
                      style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}
                    >
                      {res
                        ? res.outcome === 'correct' ? '✓' : res.outcome === 'wrong' ? '✗' : ''
                        : `$${values[r]}`}
                    </button>
                  )
                }),
              )}
            </div>
          </div>

          <p className="mt-3 text-center text-[11px] text-ink-stage-2">
            {currentRound === 1
              ? `${9 - r1Count} clue${9 - r1Count === 1 ? '' : 's'} left, then Double Jeopardy.`
              : `${9 - r2Count} clue${9 - r2Count === 1 ? '' : 's'} left, then Final Jeopardy.`}
          </p>
        </>
      )}

      {/* The clue, full screen. */}
      {active && (
        <ClueOverlay
          game={game}
          rd={active.rd}
          c={active.c}
          r={active.r}
          stage={overlayStage}
          typed={typed}
          setTyped={setTyped}
          wagerText={wagerText}
          setWagerText={setWagerText}
          stake={stake}
          ddMax={ddMax(active.rd)}
          secondsLeft={secondsLeft}
          outcome={lastOutcome}
          opponents={opponents}
          myScore={myScore}
          onWagerConfirm={confirmWager}
          onAnswer={() => resolveClue('answer', typed)}
          onPass={() => resolveClue('pass', '')}
          onClose={closeClue}
        />
      )}

      {/* Final Jeopardy. */}
      {fjStage && (
        <FinalJeopardy
          game={game}
          stage={fjStage}
          typed={typed}
          setTyped={setTyped}
          wagerText={wagerText}
          setWagerText={setWagerText}
          stake={stake}
          maxWager={Math.max(0, scoreOf(clueResults.filter((x) => x.rd !== 3)))}
          secondsLeft={secondsLeft}
          outcome={lastOutcome}
          opponents={opponents}
          myScore={myScore}
          onWagerConfirm={confirmFjWager}
          onAnswer={() => resolveFinal(typed)}
          onClose={closeFinal}
        />
      )}
    </Shell>
  )
}

// ───────────────────────── building blocks ─────────────────────────

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="stage-page-deep px-4 pb-24 md:px-8">
      <div className={`mx-auto w-full px-1 pt-8 md:pt-12 ${wide ? 'max-w-3xl' : 'max-w-2xl'}`}>
        <div className="mb-6 flex items-center justify-between gap-4 border-b border-white/10 pb-5">
          <a href="/challenge" className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink-stage-2 transition-colors hover:text-copper">
            ← Jeopardy Challenge
          </a>
        </div>
        {children}
      </div>
    </main>
  )
}

function BoardHeading({ game, compact }: { game: ChallengeGame; compact?: boolean }) {
  return (
    <div className="text-center">
      <p className="text-[10px] uppercase tracking-[0.3em] text-jeopardy-gold-light">
        {game.series === 'michaels'
          ? "Michael's Jeopardy Challenge"
          : game.series === 'politics'
            ? 'The Politics Challenge'
            : 'Jeopardy Challenge'} · {TIER_LABELS[game.tier]}
      </p>
      <h1 className={`display-chrome leading-none ${compact ? 'mt-1 text-2xl' : 'mt-2 text-3xl md:text-4xl'}`}>
        {game.title}
      </h1>
      {!compact && (
        <>
          <p className="mt-2 text-sm text-ink-stage-2">{game.blurb}</p>
          {/* Standard boards are TITLED by their show number and air date,
              and their blurb tells the story — nothing left to repeat. */}
          {game.episode && game.tier !== 'standard' && (
            <p className="mt-1 text-xs text-copper">
              {game.episode.note} · {game.episode.show}, aired {formatAirDate(game.episode.airDate)}
            </p>
          )}
          {!game.episode && (
            <p className="mt-1 text-xs text-copper">
              Real clues from real games — each one shows the date it aired.
            </p>
          )}
        </>
      )}
    </div>
  )
}

/** The provenance chip on every clue screen: which real game this aired in. */
function SourceLine({ show, airDate }: { show: string | null; airDate: string | null }) {
  if (!airDate && !show) return null
  return (
    <p className="mt-6">
      <span className="inline-block rounded-full border border-white/20 bg-black/25 px-3.5 py-1.5 text-sm text-white/85">
        Real clue from{airDate ? ` the ${formatAirDate(airDate)} game` : ''}
        {show ? ` (${show})` : ''}
      </span>
    </p>
  )
}

function Avatar({ name, size = 56 }: { name: string; size?: number }) {
  return (
    <span
      className="flex items-center justify-center rounded-full border-2 border-white/25 font-bold text-black shadow-lg"
      style={{
        width: size,
        height: size,
        background: avatarColor(name),
        fontSize: size * 0.42,
        fontFamily: 'Impact, "Arial Black", sans-serif',
      }}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

/**
 * The pre-game matchup card: you against the board's TOP PLAYER. Their final
 * score is NOT shown — you find out how they did the way they found out, one
 * clue at a time.
 */
function MatchupIntro({
  game,
  opponents,
  name,
}: {
  game: ChallengeGame
  opponents: ChallengeResult[]
  name: string
}) {
  const flashy = game.tier === 'teen'
  const top = opponents[0]

  if (!top) {
    return (
      <div className="mt-6 rounded-xl border border-white/15 bg-black/30 p-5 text-center">
        <p className="text-sm text-ink-stage">
          Nobody has played this board yet — you&apos;re setting the score everyone
          else will chase.
        </p>
      </div>
    )
  }

  return (
    <div
      className={`mt-6 overflow-hidden rounded-xl border p-5 text-center ${
        flashy
          ? 'border-fuchsia-400/50 bg-gradient-to-br from-fuchsia-950/60 via-black/40 to-sky-950/60'
          : 'border-white/15 bg-black/30'
      }`}
    >
      <p
        className={`text-[10px] uppercase tracking-[0.3em] ${
          flashy ? 'animate-pulse text-fuchsia-300' : 'text-jeopardy-gold-light'
        }`}
      >
        Tonight&apos;s matchup
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-4 md:gap-6">
        <div className="flex flex-col items-center gap-1.5">
          <Avatar name={name || 'You'} size={flashy ? 76 : 64} />
          <span className="max-w-[110px] truncate text-sm font-bold text-white">{name || 'You'}</span>
        </div>

        <span
          className={`px-1 ${flashy ? 'text-4xl text-fuchsia-300' : 'text-3xl text-copper'}`}
          style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}
        >
          VS
        </span>

        <div className="flex flex-col items-center gap-1.5">
          <Avatar name={top.player_name} size={flashy ? 76 : 64} />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-jeopardy-gold-light">
            👑 Top Player
          </span>
          <span className="max-w-[110px] truncate text-sm font-bold text-white">{top.player_name}</span>
        </div>
      </div>

      <p className="mt-4 text-[11px] text-ink-stage-2">
        That&apos;s the real person holding this board&apos;s best score. As you clear each
        clue you&apos;ll see whether they got it, and their money (wagers included)
        lands as you go.
      </p>
    </div>
  )
}

function ScoreCard({ name, score, you, label }: { name: string; score: number; you?: boolean; label?: string }) {
  return (
    <div
      className={`flex min-w-[120px] flex-1 flex-col items-center rounded-lg border px-3 py-2 sm:flex-none ${
        you ? 'border-jeopardy-gold bg-jeopardy-gold/15' : 'border-white/10 bg-black/30'
      }`}
    >
      {label && (
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-jeopardy-gold-light">
          {label}
        </span>
      )}
      <span className={`max-w-[140px] truncate text-[11px] font-bold ${you ? 'text-white' : 'text-ink-stage-2'}`}>
        {name}
      </span>
      <span
        className={`text-lg font-bold tabular-nums ${score < 0 ? 'text-red-400' : 'text-jeopardy-gold-light'}`}
      >
        {formatMoney(score)}
      </span>
    </div>
  )
}

/** "✓ Top Player Mike GOT IT" — the top player's record on this clue, writ large. */
function GhostOutcomes({
  opponents,
  rd,
  c,
  r,
  showAmounts,
}: {
  opponents: ChallengeResult[]
  rd: number
  c: number
  r: number
  showAmounts: boolean
}) {
  if (opponents.length === 0) return null
  const rows = opponents.map((o) => ({ o, res: ghostResultOn(o, rd, c, r) }))
  return (
    <div className="mt-5 space-y-2 rounded-lg bg-black/30 px-4 py-4">
      {rows.map(({ o, res }) => (
        <p
          key={o.id}
          className={`text-xl font-bold md:text-2xl ${
            res?.outcome === 'correct' ? 'text-green-300' : res?.outcome === 'wrong' ? 'text-red-300' : 'text-white/60'
          }`}
        >
          {res?.outcome === 'correct' ? '✓' : res?.outcome === 'wrong' ? '✗' : '—'}{' '}
          <span className="text-base font-bold uppercase tracking-wide text-jeopardy-gold-light md:text-lg">
            👑 Top Player {o.player_name}
          </span>{' '}
          {res?.outcome === 'correct' ? 'GOT IT' : res?.outcome === 'wrong' ? 'MISSED IT' : 'passed'}
          {showAmounts && res && res.outcome !== 'pass' ? ` — ${formatMoney(res.value)}` : ''}
        </p>
      ))}
    </div>
  )
}

function TimerBar({ secondsLeft, total }: { secondsLeft: number; total: number }) {
  return (
    <>
      <div className="mx-auto mt-8 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-black/40">
        <div
          className={`h-full rounded-full transition-all duration-300 ${secondsLeft <= 5 ? 'bg-red-500' : 'bg-jeopardy-gold-light'}`}
          style={{ width: `${(secondsLeft / total) * 100}%` }}
        />
      </div>
      <p className={`mt-1 text-xs tabular-nums ${secondsLeft <= 5 ? 'text-red-300' : 'text-white/60'}`}>
        {secondsLeft}s
      </p>
    </>
  )
}

function ClueOverlay({
  game, rd, c, r, stage, typed, setTyped, wagerText, setWagerText, stake, ddMax,
  secondsLeft, outcome, opponents, myScore, onWagerConfirm, onAnswer, onPass, onClose,
}: {
  game: ChallengeGame
  rd: number
  c: number
  r: number
  stage: OverlayStage
  typed: string
  setTyped: (s: string) => void
  wagerText: string
  setWagerText: (s: string) => void
  stake: number
  ddMax: number
  secondsLeft: number
  outcome: ClueOutcome
  opponents: ChallengeResult[]
  myScore: number
  onWagerConfirm: () => void
  onAnswer: () => void
  onPass: () => void
  onClose: () => void
}) {
  const cat = game.rounds[rd - 1][c]
  const clue = cat.clues[r]
  const dd = isDailyDouble(game, rd, c, r)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [stage])

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-[#060CE9] px-5 py-8">
      <div className="w-full max-w-2xl text-center">
        {stage === 'wager' ? (
          /* ── DAILY DOUBLE wager ── */
          <>
            <h2
              className="text-4xl font-bold uppercase tracking-wide text-jeopardy-gold-light md:text-5xl"
              style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '3px 3px 6px rgba(0,0,0,0.7)' }}
            >
              Daily Double!
            </h2>
            <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.28em] text-white/80">{cat.name}</p>
            <p className="mt-3 text-sm text-white/85">
              You have <span className="font-bold text-jeopardy-gold-light">{formatMoney(myScore)}</span>.
              Wager from $5 up to <span className="font-bold text-jeopardy-gold-light">{formatMoney(ddMax)}</span> —
              then the clue appears and the money rides on it.
            </p>
            <div className="mx-auto mt-5 max-w-xs">
              <input
                ref={inputRef}
                type="number"
                inputMode="numeric"
                min={5}
                max={ddMax}
                value={wagerText}
                onChange={(e) => setWagerText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && wagerText.trim()) onWagerConfirm() }}
                placeholder="Your wager"
                className="field-stage text-center"
              />
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => setWagerText(String(ddMax))}
                  className="btn-stage btn-stage-sm btn-stage-ghost"
                >
                  True Daily Double
                </button>
                <button
                  onClick={onWagerConfirm}
                  disabled={!wagerText.trim()}
                  className="btn-stage btn-copper btn-stage-sm"
                >
                  Lock it in
                </button>
              </div>
            </div>
            <SourceLine show={cat.show} airDate={cat.airDate} />
          </>
        ) : (
          <>
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/80">
              {cat.name} ·{' '}
              <span className="text-jeopardy-gold-light">
                {dd ? `Daily Double — ${formatMoney(stake)}` : `$${stake}`}
              </span>
            </p>

            <p className="clue-type mx-auto mt-6 max-w-xl text-xl uppercase text-white md:text-2xl" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.6)' }}>
              {clue.q}
            </p>

            {stage === 'answering' ? (
              <>
                <TimerBar secondsLeft={secondsLeft} total={CLUE_SECONDS} />
                <div className="mx-auto mt-5 max-w-md">
                  <input
                    ref={inputRef}
                    type="text"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) onAnswer() }}
                    placeholder="What is…?"
                    className="field-stage text-center"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <div className="mt-3 flex justify-center gap-2">
                    <button onClick={onAnswer} disabled={!typed.trim()} className="btn-stage btn-copper">
                      Answer
                    </button>
                    {/* No passing on a Daily Double — the wager rides regardless. */}
                    {!dd && (
                      <button onClick={onPass} className="btn-stage btn-stage-ghost">
                        Pass
                      </button>
                    )}
                  </div>
                </div>
                <SourceLine show={cat.show} airDate={cat.airDate} />
              </>
            ) : (
              /* ── reveal ── */
              <div className="mx-auto mt-8 max-w-md">
                <p
                  className={`text-2xl font-bold ${
                    outcome === 'correct' ? 'text-green-400' : outcome === 'wrong' ? 'text-red-400' : 'text-white/70'
                  }`}
                >
                  {outcome === 'correct'
                    ? `Right! +${formatMoney(stake)}`
                    : outcome === 'wrong'
                      ? `No — that's -${formatMoney(stake)}`
                      : 'Time / passed'}
                </p>
                <p className="mt-2 text-sm text-white/85">
                  Correct response: <span className="font-bold text-jeopardy-gold-light">{clue.a}</span>
                </p>

                <GhostOutcomes opponents={opponents} rd={rd} c={c} r={r} showAmounts={dd} />

                <p className="mt-4 text-xs text-white/60">
                  Your total: <span className="font-bold tabular-nums text-jeopardy-gold-light">{formatMoney(myScore)}</span>
                </p>

                <button onClick={onClose} className="btn-stage btn-copper mt-5">
                  Back to the board
                </button>
                <SourceLine show={cat.show} airDate={cat.airDate} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function FinalJeopardy({
  game, stage, typed, setTyped, wagerText, setWagerText, stake, maxWager,
  secondsLeft, outcome, opponents, myScore, onWagerConfirm, onAnswer, onClose,
}: {
  game: ChallengeGame
  stage: OverlayStage
  typed: string
  setTyped: (s: string) => void
  wagerText: string
  setWagerText: (s: string) => void
  stake: number
  maxWager: number
  secondsLeft: number
  outcome: ClueOutcome
  opponents: ChallengeResult[]
  myScore: number
  onWagerConfirm: () => void
  onAnswer: () => void
  onClose: () => void
}) {
  const fj = game.finalJeopardy
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [stage])

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-[#060CE9] px-5 py-8">
      <div className="w-full max-w-2xl text-center">
        <h2
          className="text-4xl font-bold uppercase tracking-wide text-white md:text-5xl"
          style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '3px 3px 6px rgba(0,0,0,0.7)' }}
        >
          Final Jeopardy!
        </h2>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.28em] text-jeopardy-gold-light">
          {fj.category}
        </p>

        {stage === 'wager' ? (
          <>
            <p className="mt-4 text-sm text-white/85">
              That&apos;s the category. You have{' '}
              <span className="font-bold text-jeopardy-gold-light">{formatMoney(myScore)}</span> — wager
              anything up to {formatMoney(maxWager)} before you see the clue.
            </p>
            <div className="mx-auto mt-5 max-w-xs">
              <input
                ref={inputRef}
                type="number"
                inputMode="numeric"
                min={0}
                max={maxWager}
                value={wagerText}
                onChange={(e) => setWagerText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onWagerConfirm() }}
                placeholder="Your wager"
                className="field-stage text-center"
              />
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button onClick={() => setWagerText(String(maxWager))} className="btn-stage btn-stage-sm btn-stage-ghost">
                  Everything
                </button>
                <button onClick={onWagerConfirm} className="btn-stage btn-copper btn-stage-sm">
                  Lock it in
                </button>
              </div>
            </div>
            <SourceLine show={fj.show} airDate={fj.airDate} />
          </>
        ) : stage === 'answering' ? (
          <>
            <p className="clue-type mx-auto mt-6 max-w-xl text-xl uppercase text-white md:text-2xl" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.6)' }}>
              {fj.q}
            </p>
            <TimerBar secondsLeft={secondsLeft} total={FJ_SECONDS} />
            <div className="mx-auto mt-5 max-w-md">
              <input
                ref={inputRef}
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) onAnswer() }}
                placeholder="What is…?"
                className="field-stage text-center"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <button onClick={onAnswer} disabled={!typed.trim()} className="btn-stage btn-copper mt-3">
                Final answer
              </button>
              <p className="mt-2 text-[11px] text-white/50">
                Wagered: {formatMoney(stake)} — no answer counts as a miss.
              </p>
            </div>
            <SourceLine show={fj.show} airDate={fj.airDate} />
          </>
        ) : (
          <div className="mx-auto mt-6 max-w-md">
            <p className="clue-type mx-auto max-w-xl text-base uppercase text-white/80">{fj.q}</p>
            <p
              className={`mt-5 text-2xl font-bold ${outcome === 'correct' ? 'text-green-400' : 'text-red-400'}`}
            >
              {outcome === 'correct' ? `Right! +${formatMoney(stake)}` : `No — that's -${formatMoney(stake)}`}
            </p>
            <p className="mt-2 text-sm text-white/85">
              Correct response: <span className="font-bold text-jeopardy-gold-light">{fj.a}</span>
            </p>

            <GhostOutcomes opponents={opponents} rd={3} c={0} r={0} showAmounts />

            <p className="mt-4 text-xs text-white/60">
              Your final score: <span className="font-bold tabular-nums text-jeopardy-gold-light">{formatMoney(myScore)}</span>
            </p>

            <button onClick={onClose} className="btn-stage btn-copper mt-5">
              Final scores
            </button>
            <SourceLine show={fj.show} airDate={fj.airDate} />
          </div>
        )}
      </div>
    </div>
  )
}

function Standings({
  results,
  identity,
  title,
}: {
  results: ChallengeResult[]
  identity: string | null
  title: string
}) {
  return (
    <div className="mt-10">
      <div className="eyebrow-copper mb-3">{title}</div>
      {results.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-black/30 px-4 py-6 text-center text-sm text-ink-stage-2">
          No scores yet on this board.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/30 px-4 py-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-[0.18em] text-ink-stage-2">
                <th className="py-2 pr-2 font-normal">#</th>
                <th className="py-2 pr-2 font-normal">Player</th>
                <th className="py-2 pr-2 text-right font-normal">Money</th>
                <th className="py-2 text-right font-normal">Right</th>
              </tr>
            </thead>
            <tbody>
              {results.slice(0, 30).map((row, i) => (
                <tr
                  key={row.id}
                  className={`border-b border-white/5 ${row.identity_key === identity ? 'bg-jeopardy-gold/10' : ''}`}
                >
                  <td className="py-2 pr-2 tabular-nums text-ink-stage-2">{i + 1}</td>
                  <td className="py-2 pr-2 font-semibold text-white">
                    {row.player_name}
                    {row.identity_key === identity && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-wider text-jeopardy-gold-light">You</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right font-bold tabular-nums text-jeopardy-gold-light">{formatMoney(row.score)}</td>
                  <td className="py-2 text-right tabular-nums text-ink-stage-2">{row.correct_count}/{CLUES_PER_GAME}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function BackToHub() {
  return (
    <div className="mt-8 text-center">
      <a href="/challenge" className="btn-stage btn-stage-sm btn-stage-ghost">
        All boards &amp; overall leaderboard
      </a>
    </div>
  )
}
