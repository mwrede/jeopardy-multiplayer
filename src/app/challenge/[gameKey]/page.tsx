'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useUser } from '@/lib/auth'
import { checkAnswerDetailed } from '@/lib/answer-check'
import {
  getChallengeGame,
  CHALLENGE_CLUE_VALUES,
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
 * ONE CHALLENGE BOARD — the solo game itself.
 *
 * The trick that makes solo feel like a table of four: before you start, up
 * to three REAL previous players are dealt in beside you. Their finished
 * games are on record clue by clue, so when you resolve a clue, their
 * recorded result for that same clue lands on their score at the same moment.
 * By the end their totals are their true final scores — you genuinely just
 * played the game those people played.
 *
 * One play per person, enforced by the database. A half-finished run is
 * parked in this browser so a refresh resumes rather than resets — and
 * resumes against the same three opponents.
 */

const CLUE_SECONDS = 30

type Phase = 'loading' | 'played' | 'intro' | 'playing' | 'done'

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

/** A ghost's score counting only the clues the live player has resolved. */
function ghostScoreSoFar(op: ChallengeResult, resolved: ClueResult[]): number {
  const done = new Set(resolved.map((r) => `${r.c}:${r.r}`))
  return scoreOf(op.clue_results.filter((r) => done.has(`${r.c}:${r.r}`)))
}

function ghostOutcomeOn(op: ChallengeResult, c: number, r: number): ClueOutcome {
  return op.clue_results.find((x) => x.c === c && x.r === r)?.outcome ?? 'pass'
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

  // The open clue, and what's happened inside it.
  const [active, setActive] = useState<{ c: number; r: number } | null>(null)
  const [overlayStage, setOverlayStage] = useState<'answering' | 'reveal'>('answering')
  const [typed, setTyped] = useState('')
  const [lastOutcome, setLastOutcome] = useState<ClueOutcome>('pass')
  const [secondsLeft, setSecondsLeft] = useState(CLUE_SECONDS)
  const [submitting, setSubmitting] = useState(false)

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
          if (saved.clueResults.length >= 9) {
            // The board was cleared but never recorded — a refresh on the
            // final screen, or a submit that failed. Record it now rather
            // than stranding a finished game in "playing".
            finalize(saved.name, id, saved.clueResults)
          } else {
            setPhase('playing')
          }
        } else {
          setName(
            localStorage.getItem('playerName') ||
            profile?.display_name ||
            '',
          )
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
  // profile arrives after user; it only seeds the name field, so user/loading
  // are the real triggers.
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

  // ── Clue timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || overlayStage !== 'answering') return
    setSecondsLeft(CLUE_SECONDS)
    const started = Date.now()
    const t = setInterval(() => {
      const left = CLUE_SECONDS - Math.floor((Date.now() - started) / 1000)
      setSecondsLeft(Math.max(0, left))
      if (left <= 0) {
        clearInterval(t)
        resolveClue('pass', '')
      }
    }, 250)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, overlayStage])

  const myScore = scoreOf(clueResults)

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

  function openClue(c: number, r: number) {
    if (clueResults.some((x) => x.c === c && x.r === r)) return
    setTyped('')
    setOverlayStage('answering')
    setActive({ c, r })
  }

  function resolveClue(kind: 'answer' | 'pass', text: string) {
    if (!active || !game) return
    const { c, r } = active
    const clue = game.categories[c].clues[r]
    const value = CHALLENGE_CLUE_VALUES[r]

    let outcome: ClueOutcome = 'pass'
    if (kind === 'answer' && text.trim()) {
      outcome = checkAnswerDetailed(text, clue.answer).correct ? 'correct' : 'wrong'
    }

    const next = [...clueResults, { c, r, outcome, value, answer: text.trim() || undefined }]
    setClueResults(next)
    setLastOutcome(outcome)
    setOverlayStage('reveal')
    saveRun(name, opponents, next)
  }

  function closeClue() {
    if (!game || !identity) { setActive(null); return }
    const finished = clueResults.length >= 9
    setActive(null)
    if (finished) finalize(name, identity, clueResults)
  }

  /**
   * Board cleared — record it and pull the fresh standings. The unique
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
            {mine.correct_count} of 9 right · #{rank} of {allResults.length} — this board is done for you.
          </p>
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
            9 clues · {CLUE_SECONDS}s each · right answers win the money, wrong ones lose it.
            Once you start, this board is spent.
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
      ...opponents.map((o) => ({ name: o.player_name, score: o.score, you: false })),
    ].sort((a, b) => b.score - a.score)
    const won = table[0]?.you && (table.length === 1 || table[0].score > table[1].score)

    return (
      <Shell>
        <BoardHeading game={game} />
        <div className="mt-6 rounded-xl border-2 border-jeopardy-gold bg-jeopardy-gold/10 p-5 text-center">
          <p className="text-[10px] uppercase tracking-[0.28em] text-jeopardy-gold-light">
            {submitting ? 'Recording your score…' : won ? 'You won the table' : 'Final scores'}
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
        </div>
        {error && <p className="mt-4 text-center text-sm text-copper-glow">{error}</p>}
        <Standings results={allResults} identity={identity} title="Leaderboard" />
        <BackToHub />
      </Shell>
    )
  }

  // ── phase === 'playing' ──────────────────────────────────────────────
  const resolvedKeys = new Set(clueResults.map((x) => `${x.c}:${x.r}`))

  return (
    <Shell wide>
      <BoardHeading game={game} compact />

      {/* Score rail: you and the table, live. */}
      <div className="mx-auto mt-4 flex max-w-2xl flex-wrap items-stretch justify-center gap-2">
        <ScoreCard name={`${name} (you)`} score={myScore} you />
        {opponents.map((o) => (
          <ScoreCard key={o.id} name={o.player_name} score={ghostScoreSoFar(o, clueResults)} />
        ))}
      </div>

      <div className="board-wrapper mx-auto mt-5 max-w-2xl">
        <div className="grid grid-cols-3 gap-1 p-1">
          {game.categories.map((cat, c) => (
            <div key={c} className="board-category min-h-[64px] px-2 py-2 text-[11px] font-bold uppercase leading-tight text-white md:text-sm">
              {cat.name}
            </div>
          ))}
          {[0, 1, 2].map((r) =>
            game.categories.map((_, c) => {
              const done = resolvedKeys.has(`${c}:${r}`)
              const res = clueResults.find((x) => x.c === c && x.r === r)
              return (
                <button
                  key={`${c}:${r}`}
                  onClick={() => openClue(c, r)}
                  disabled={done}
                  className={`min-h-[72px] text-2xl md:min-h-[88px] md:text-4xl ${
                    done
                      ? res?.outcome === 'correct'
                        ? 'board-cell board-cell-correct'
                        : res?.outcome === 'wrong'
                          ? 'board-cell board-cell-wrong'
                          : 'board-cell board-cell-answered'
                      : 'board-cell'
                  }`}
                  style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}
                >
                  {done
                    ? res?.outcome === 'correct' ? '✓' : res?.outcome === 'wrong' ? '✗' : ''
                    : `$${CHALLENGE_CLUE_VALUES[r]}`}
                </button>
              )
            }),
          )}
        </div>
      </div>

      <p className="mt-3 text-center text-[11px] text-ink-stage-2">
        {9 - clueResults.length} clue{9 - clueResults.length === 1 ? '' : 's'} left — pick any cell.
      </p>

      {/* The clue, full screen — answer it or let the clock run out. */}
      {active && (
        <ClueOverlay
          game={game}
          c={active.c}
          r={active.r}
          stage={overlayStage}
          typed={typed}
          setTyped={setTyped}
          secondsLeft={secondsLeft}
          outcome={lastOutcome}
          opponents={opponents}
          myScore={myScore}
          isLast={clueResults.length >= 9}
          onAnswer={() => resolveClue('answer', typed)}
          onPass={() => resolveClue('pass', '')}
          onClose={closeClue}
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
        {game.series === 'michaels' ? "Michael's Jeopardy Challenge" : 'Jeopardy Challenge'} · {TIER_LABELS[game.tier]}
      </p>
      <h1 className={`display-chrome leading-none ${compact ? 'mt-1 text-2xl' : 'mt-2 text-3xl md:text-4xl'}`}>
        {game.title}
      </h1>
      {!compact && <p className="mt-2 text-sm text-ink-stage-2">{game.blurb}</p>}
    </div>
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
 * The pre-game matchup card: you on one side, the real previous players
 * you're up against on the other. Their scores are NOT shown — you find out
 * how they did the way they found out, one clue at a time.
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

  if (opponents.length === 0) {
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

      <div className="mt-4 flex flex-wrap items-center justify-center gap-3 md:gap-5">
        <div className="flex flex-col items-center gap-1.5">
          <Avatar name={name || 'You'} size={flashy ? 72 : 60} />
          <span className="max-w-[90px] truncate text-xs font-bold text-white">{name || 'You'}</span>
        </div>

        <span
          className={`px-1 ${flashy ? 'text-3xl text-fuchsia-300' : 'text-2xl text-copper'}`}
          style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}
        >
          VS
        </span>

        {opponents.map((o) => (
          <div key={o.id} className="flex flex-col items-center gap-1.5">
            <Avatar name={o.player_name} size={flashy ? 72 : 60} />
            <span className="max-w-[90px] truncate text-xs font-bold text-ink-stage">{o.player_name}</span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[11px] text-ink-stage-2">
        These are real players and real games — as you clear each clue you&apos;ll see
        who of them got it, and their money lands as you go.
      </p>
    </div>
  )
}

function ScoreCard({ name, score, you }: { name: string; score: number; you?: boolean }) {
  return (
    <div
      className={`flex min-w-[120px] flex-1 flex-col items-center rounded-lg border px-3 py-2 sm:flex-none ${
        you ? 'border-jeopardy-gold bg-jeopardy-gold/15' : 'border-white/10 bg-black/30'
      }`}
    >
      <span className={`max-w-[130px] truncate text-[11px] font-bold ${you ? 'text-white' : 'text-ink-stage-2'}`}>
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

function ClueOverlay({
  game, c, r, stage, typed, setTyped, secondsLeft, outcome, opponents, myScore, isLast,
  onAnswer, onPass, onClose,
}: {
  game: ChallengeGame
  c: number
  r: number
  stage: 'answering' | 'reveal'
  typed: string
  setTyped: (s: string) => void
  secondsLeft: number
  outcome: ClueOutcome
  opponents: ChallengeResult[]
  myScore: number
  isLast: boolean
  onAnswer: () => void
  onPass: () => void
  onClose: () => void
}) {
  const clue = game.categories[c].clues[r]
  const value = CHALLENGE_CLUE_VALUES[r]
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (stage === 'answering') inputRef.current?.focus()
  }, [stage])

  const gotIt = opponents.filter((o) => ghostOutcomeOn(o, c, r) === 'correct')
  const missedIt = opponents.filter((o) => ghostOutcomeOn(o, c, r) === 'wrong')
  const passedIt = opponents.filter((o) => ghostOutcomeOn(o, c, r) === 'pass')

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#060CE9] px-5 py-8">
      <div className="w-full max-w-2xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/80">
          {game.categories[c].name} · <span className="text-jeopardy-gold-light">${value}</span>
        </p>

        <p className="clue-type mx-auto mt-6 max-w-xl text-xl uppercase text-white md:text-2xl" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.6)' }}>
          {clue.question}
        </p>

        {stage === 'answering' ? (
          <>
            {/* The clock, draining. */}
            <div className="mx-auto mt-8 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-black/40">
              <div
                className={`h-full rounded-full transition-all duration-300 ${secondsLeft <= 5 ? 'bg-red-500' : 'bg-jeopardy-gold-light'}`}
                style={{ width: `${(secondsLeft / CLUE_SECONDS) * 100}%` }}
              />
            </div>
            <p className={`mt-1 text-xs tabular-nums ${secondsLeft <= 5 ? 'text-red-300' : 'text-white/60'}`}>
              {secondsLeft}s
            </p>

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
                <button onClick={onPass} className="btn-stage btn-stage-ghost">
                  Pass
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="mx-auto mt-8 max-w-md">
            <p
              className={`text-2xl font-bold ${
                outcome === 'correct' ? 'text-green-400' : outcome === 'wrong' ? 'text-red-400' : 'text-white/70'
              }`}
            >
              {outcome === 'correct' ? `Right! +$${value}` : outcome === 'wrong' ? `No — that's -$${value}` : 'Time / passed'}
            </p>
            <p className="mt-2 text-sm text-white/85">
              Correct response: <span className="font-bold text-jeopardy-gold-light">{clue.answer}</span>
            </p>

            {/* Who at THIS table got it — real players, real records. */}
            {opponents.length > 0 && (
              <div className="mt-5 space-y-1 rounded-lg bg-black/30 px-4 py-3 text-left text-sm">
                {gotIt.length > 0 && (
                  <p className="text-green-300">
                    ✓ {gotIt.map((o) => o.player_name).join(', ')} got this one
                  </p>
                )}
                {missedIt.length > 0 && (
                  <p className="text-red-300">
                    ✗ {missedIt.map((o) => o.player_name).join(', ')} missed it
                  </p>
                )}
                {passedIt.length > 0 && (
                  <p className="text-white/50">
                    — {passedIt.map((o) => o.player_name).join(', ')} let it go
                  </p>
                )}
              </div>
            )}

            <p className="mt-4 text-xs text-white/60">
              Your total: <span className="font-bold tabular-nums text-jeopardy-gold-light">{formatMoney(myScore)}</span>
            </p>

            <button onClick={onClose} className="btn-stage btn-copper mt-5">
              {isLast ? 'Final scores' : 'Back to the board'}
            </button>
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
                  <td className="py-2 text-right tabular-nums text-ink-stage-2">{row.correct_count}/9</td>
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
