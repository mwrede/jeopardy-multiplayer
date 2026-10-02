'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { signInWithGoogle, useUser } from '@/lib/auth'
import { checkAnswerDetailed } from '@/lib/answer-check'
import { formatMoney, type ClueOutcome } from '@/lib/challenge'
import { formatAirDate } from '@/lib/challenge-data'
import {
  boardForDate,
  todayISO,
  shortDate,
  secondsUntilTomorrow,
  untilTomorrowLabel,
  DAILY_VALUES,
  DAILY_CLUES,
  DAILY_MAX,
  DAILY_DAYS,
  type DailyBoard as Board,
} from '@/lib/daily-data'
import {
  allTimeStandings,
  dailyIdentity,
  dayStandings,
  fetchDailyResults,
  localStreak,
  markPosted,
  noteCatchUp,
  noteLocalPlay,
  readCatchUps,
  readLocalPlays,
  readRun,
  saveRun,
  clearRun,
  scoreOf,
  streakStandings,
  submitDailyResult,
  type DailyClueResult,
  type DailyResult,
  type LocalPlay,
} from '@/lib/daily'

/**
 * THE BOARD OF THE DAY — the front page's first thing, and the only thing on
 * it you can actually play without going anywhere.
 *
 * Nine real clues from one real night in the show's history, $200 to $600, the
 * same board for everyone, changing at local midnight. No name gate and no
 * intro screen: the board is live the moment the page is, because anything in
 * front of it is a reason to leave. ONE SHOT — a day you've played shows you
 * your own board back, marked.
 *
 * Standings sit to the right of it, three of them: today, all time, and the
 * streaks. Your own line is read out of this browser first so it's instant and
 * survives a missing table; everyone else's comes from Supabase.
 */
const CLUE_SECONDS = 30

type Stage = 'answering' | 'reveal'

export function DailyBoard({
  forDate,
  ranked = true,
}: {
  /** Play a PAST day instead of today — the catch-up shelf. */
  forDate?: string
  /**
   * False for a catch-up board: it is played, kept and shared, but it never
   * goes on a leaderboard and never touches a streak. A daily leaderboard
   * anyone can fill in after the fact isn't one.
   */
  ranked?: boolean
} = {}) {
  const { user, profile, loading: userLoading } = useUser()

  /* The date is decided on the client. Deciding it during render would let the
     server's calendar day disagree with the player's and tear the markup. */
  const [date, setDate] = useState<string | null>(null)
  const [board, setBoard] = useState<Board | null>(null)

  const [resolved, setResolved] = useState<DailyClueResult[]>([])
  const [mine, setMine] = useState<LocalPlay | null>(null)
  const [myStreak, setMyStreak] = useState({ current: 0, best: 0 })

  const [rows, setRows] = useState<DailyResult[] | null>(null)
  const [tableMissing, setTableMissing] = useState(false)

  const [active, setActive] = useState<{ c: number; r: number } | null>(null)
  const [stage, setStage] = useState<Stage>('answering')
  const [typed, setTyped] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(CLUE_SECONDS)
  const [lastOutcome, setLastOutcome] = useState<ClueOutcome>('pass')

  const [identity, setIdentity] = useState<string | null>(null)
  /** Guards the automatic post so one finished day is sent once, not on every render. */
  const posting = useRef(false)
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<null | 'recorded' | 'already-played'>(null)
  const [error, setError] = useState('')
  const [left, setLeft] = useState<number | null>(null)
  const [daysPlayed, setDaysPlayed] = useState(0)

  // ── Mount: today's board, your record, the standings ─────────────────
  useEffect(() => {
    const day = forDate || todayISO()
    setDate(day)
    setBoard(boardForDate(day))

    const plays = ranked ? readLocalPlays() : readCatchUps()
    setMine(plays[day] ?? null)
    setMyStreak(localStreak())
    setDaysPlayed(Object.keys(readLocalPlays()).length)

    const saved = readRun(day)
    if (saved && !plays[day]) setResolved(saved.clueResults)

    setName(localStorage.getItem('playerName') || '')
  }, [forDate, ranked])

  /* Identity waits for the auth check: minting a guest id first would file a
     signed-in player's day under the wrong person. */
  useEffect(() => {
    if (userLoading) return
    setIdentity(dailyIdentity(user?.id))
  }, [user, userLoading])

  // An account's display name is a better default than an empty field.
  useEffect(() => {
    if (!name && profile?.display_name) setName(profile.display_name)
  // Only ever seeds an empty field; typing is never overwritten.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.display_name])

  const loadRows = useCallback(() => {
    fetchDailyResults()
      .then((res) => {
        if (res.ok) { setRows(res.rows); setTableMissing(false) }
        else { setRows([]); setTableMissing(res.missing) }
      })
      .catch(() => setRows([]))
  }, [])

  useEffect(() => { loadRows() }, [loadRows])

  // ── The clue clock ───────────────────────────────────────────────────
  useEffect(() => {
    if (!active || stage !== 'answering') return
    setSecondsLeft(CLUE_SECONDS)
    const started = Date.now()
    const t = setInterval(() => {
      const s = CLUE_SECONDS - Math.floor((Date.now() - started) / 1000)
      setSecondsLeft(Math.max(0, s))
      if (s <= 0) { clearInterval(t); resolve('timeout', '') }
    }, 250)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stage])

  // ── How long today's board has left ──────────────────────────────────
  useEffect(() => {
    if (!mine || !ranked) { setLeft(null); return }
    setLeft(secondsUntilTomorrow())
    const t = setInterval(() => setLeft(secondsUntilTomorrow()), 30_000)
    return () => clearInterval(t)
  }, [mine, ranked])

  const myScore = scoreOf(resolved)
  const done = resolved.length >= DAILY_CLUES

  function openClue(c: number, r: number) {
    if (!board || mine) return
    if (resolved.some((x) => x.c === c && x.r === r)) return
    setTyped('')
    setStage('answering')
    setSecondsLeft(CLUE_SECONDS)
    setActive({ c, r })
  }

  function resolve(kind: 'answer' | 'pass' | 'timeout', text: string) {
    if (!active || !board || !date) return
    const { c, r } = active
    const clue = board.categories[c].clues[r]
    const outcome: ClueOutcome =
      kind === 'answer' && text.trim()
        ? checkAnswerDetailed(text, clue.a).correct ? 'correct' : 'wrong'
        : 'pass'
    const next = [...resolved, { c, r, outcome, value: DAILY_VALUES[r], answer: text.trim() || undefined }]
    setResolved(next)
    setLastOutcome(outcome)
    setStage('reveal')
    saveRun(date, next)
  }

  /** Closing the ninth clue ends the day. */
  function closeClue() {
    setActive(null)
    if (resolved.length >= DAILY_CLUES) finish(resolved)
  }

  /**
   * Straight on to the next clue without going back through the board.
   * Answering nine clues should be nine actions, not eighteen — the board is
   * there to be looked at, not to be tapped through twice per clue.
   */
  function nextClue() {
    const next = firstUnplayed(resolved)
    if (!next) { closeClue(); return }
    setTyped('')
    setStage('answering')
    setSecondsLeft(CLUE_SECONDS)
    setActive(next)
  }

  /**
   * The day is over: keep it in this browser whatever happens next, then try to
   * put it on the board. A name we already know goes up without asking.
   */
  function finish(res: DailyClueResult[]) {
    if (!board || !date) return
    const play: LocalPlay = {
      date,
      boardKey: `${board.day.boardKey}:${board.day.round}`,
      score: scoreOf(res),
      correct: res.filter((x) => x.outcome === 'correct').length,
      // Category by category, cheapest row first: index = c * 3 + r.
      outcomes: boardOrder(res).map((x) => x.outcome),
    }
    if (ranked) noteLocalPlay(play)
    else noteCatchUp(play)
    setMine(play)
    if (ranked) {
      setMyStreak(localStreak(date))
      setDaysPlayed(Object.keys(readLocalPlays()).length)
    }
    clearRun(date)
    /* Posting is the effect below's job. One way in, so a finished day can't
       be sent twice and come back as 'already played' on its own first go. */
  }

  /**
   * Put a finished day on the public board as soon as there's a name to put on
   * it — which is immediately for anyone who has played here before.
   *
   * It is also what catches a day played as a guest and then SIGNED IN for:
   * coming back from Google remounts this with an account identity, and the
   * day goes up under the account instead of the browser.
   *
   * A day already posted is never posted again, so nobody appears twice on one
   * date. Days posted as a guest stay with the guest — there is no updating
   * another identity's row — so signing in moves tomorrow, not yesterday.
   */
  useEffect(() => {
    if (!ranked || !mine || mine.posted || !identity || posting.current) return
    const nm = name.trim()
    if (!nm) return
    posting.current = true
    void record(nm, mine, restoreFromLocal(mine))
  // record() reads the rest off the same render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, identity, name, ranked])

  async function record(nm: string, play: LocalPlay, res: DailyClueResult[]) {
    if (!board || !date) return
    // Normally set by now; computed here too so a fast finish can't lose a day.
    const id = identity ?? dailyIdentity(user?.id)
    setSubmitting(true)
    setError('')
    try { localStorage.setItem('playerName', nm) } catch {}
    try {
      const outcome = await submitDailyResult({
        date,
        boardKey: play.boardKey,
        identityKey: id,
        userId: user?.id,
        playerName: nm,
        score: play.score,
        correctCount: play.correct,
        clueResults: res,
      })
      setSubmitted(outcome)
      markPosted(date)
      setMine((m) => (m ? { ...m, posted: true } : m))
      loadRows()
    } catch (e: any) {
      /* The migration notice is worth repeating verbatim; anything else is
         Supabase being unreachable, and the raw message helps nobody. */
      const msg = String(e?.message || '')
      setError(
        /supabase-migration-daily/.test(msg)
          ? msg
          : 'Couldn’t reach the leaderboard — your score is kept in this browser.',
      )
      // Let them try again by hand rather than silently never retrying.
      posting.current = false
    } finally {
      setSubmitting(false)
    }
  }

  /* Standings. Everything below comes off the one fetch. */
  const today = date ?? ''
  const todayRows = useMemo(() => dayStandings(rows ?? [], today), [rows, today])
  const allTime = useMemo(() => allTimeStandings(rows ?? []), [rows])
  const streaks = useMemo(() => streakStandings(rows ?? [], today), [rows, today])
  const myRank = identity ? todayRows.findIndex((r) => r.identityKey === identity) + 1 : 0
  /* Your streak: the server's view when it has one, this browser's otherwise. */
  const serverStreak = identity ? streaks.find((s) => s.identityKey === identity) : undefined
  const streak = serverStreak
    ? { current: serverStreak.current, best: Math.max(serverStreak.best, myStreak.best) }
    : myStreak

  // The board can't be built (every scheduled board re-keyed away): say nothing.
  if (!board || !date) return <Skeleton />

  const { day, categories } = board
  const marks = boardOrder(mine ? restoreFromLocal(mine) : resolved)

  return (
    <section className="mt-4 md:mt-6">
      {/* The day, across the top: the board and the standings both hang off
          this, so neither column has a header of its own and the two line up
          at exactly the same height. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[9px] font-bold uppercase tracking-[0.24em] text-copper sm:text-[10px]">
          ★ Board of the day · {shortDate(date)}
        </p>
        <p className="text-[9px] uppercase tracking-[0.16em] text-blue-100/45 sm:text-[10px]">
          Day {board.dayNumber} of {DAILY_DAYS.length}
          {board.show ? ` · ${board.show}` : ''}
          {board.airDate ? ` · aired ${formatAirDate(board.airDate)}` : ''}
        </p>
      </div>

      <h2 className="home-cell-title mt-1 !text-[21px] leading-none text-jeopardy-gold-light sm:!text-[25px] md:!text-[28px]">
        {day.occasion}
      </h2>
      <p className="mt-1.5 text-[11px] leading-snug text-blue-100/75 sm:text-xs">{day.story}</p>

      <div
        className={`mt-2.5 grid items-start gap-2.5 md:gap-3 ${
          ranked ? 'md:grid-cols-[minmax(0,1fr)_296px]' : ''
        }`}
      >
        {/* ── The board ─────────────────────────────────────────────── */}
        <div className="min-w-0">
          <div className="board-wrapper">
            <div className="grid grid-cols-3 gap-1 p-1">
              {categories.map((cat, c) => (
                <div
                  key={c}
                  className="board-category min-h-[46px] px-1.5 py-1.5 text-[9px] font-bold uppercase leading-tight text-white sm:min-h-[56px] sm:text-[11px] md:text-xs"
                >
                  {cat.name}
                </div>
              ))}
              {[0, 1, 2].map((r) =>
                categories.map((_, c) => {
                  const res = marks.find((x) => x.c === c && x.r === r)
                  return (
                    <button
                      key={`${c}:${r}`}
                      onClick={() => openClue(c, r)}
                      disabled={!!res || !!mine}
                      aria-label={
                        res
                          ? `$${DAILY_VALUES[r]} — ${res.outcome}`
                          : `${categories[c].name}, $${DAILY_VALUES[r]}`
                      }
                      className={`min-h-[58px] text-xl sm:min-h-[70px] sm:text-2xl md:min-h-[82px] md:text-3xl ${
                        res
                          ? res.outcome === 'correct'
                            ? 'board-cell board-cell-correct'
                            : res.outcome === 'wrong'
                              ? 'board-cell board-cell-wrong'
                              /* The shared answered style paints its text away;
                                 a day you passed on has to still read as one. */
                              : 'board-cell board-cell-answered !text-white/40'
                          : 'board-cell'
                      }`}
                      style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}
                    >
                      {res
                        ? res.outcome === 'correct'
                          ? '✓'
                          : res.outcome === 'wrong'
                            ? '✗'
                            : '–'
                        : `$${DAILY_VALUES[r]}`}
                    </button>
                  )
                }),
              )}
            </div>
          </div>

          {/* Under the board: where you are, or where you finished. */}
          {mine ? (
            <Result
              play={mine}
              rank={myRank}
              field={todayRows.length}
              streak={streak}
              ranked={ranked}
              name={name}
              setName={setName}
              signedIn={!!user}
              onSignIn={() => signInWithGoogle('/')}
              onRecord={() => record(name.trim(), mine, restoreFromLocal(mine))}
              submitting={submitting}
              submitted={submitted}
              recorded={!!identity && todayRows.some((r) => r.identityKey === identity)}
              tableMissing={tableMissing}
              error={error}
              left={left}
              board={board}
            />
          ) : (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
              <p className="text-[11px] text-blue-100/70">
                {resolved.length === 0
                  ? ranked
                    ? 'Nine clues, 30 seconds each. One shot — today only.'
                    : 'Nine clues, 30 seconds each. A day you missed — played for the record, not the leaderboard.'
                  : `${DAILY_CLUES - resolved.length} to go · ${formatMoney(myScore)} so far`}
              </p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-blue-100/45">
                Perfect board {formatMoney(DAILY_MAX)}
              </p>
            </div>
          )}
        </div>

        {/* ── The standings: one panel, top-aligned with the board, and on a
               phone it falls in underneath it rather than beside it. ────── */}
        {ranked && (
          <aside className="md:sticky md:top-3">
            <div className="banner !block divide-y divide-white/10 overflow-hidden !px-0 !py-0">
              <YourLine
                streak={streak}
                play={mine}
                rank={myRank}
                field={todayRows.length}
                daysPlayed={daysPlayed}
              />
              <Panel
                title="🏆 Today"
                note={todayRows.length ? `${todayRows.length} ${todayRows.length === 1 ? 'player' : 'players'}` : ''}
                rows={todayRows.slice(0, 20).map((r) => ({
                  key: r.identityKey,
                  name: r.name,
                  value: formatMoney(r.score),
                  sub: `${r.correct}/${DAILY_CLUES} right`,
                  you: r.identityKey === identity,
                }))}
                empty={
                  tableMissing
                    ? 'Standings go live once supabase-migration-daily.sql is run.'
                    : rows === null
                      ? 'Counting…'
                      : 'Nobody has played today yet. Set the number.'
                }
              />
              <Panel
                title="💰 All time"
                note="every day played"
                rows={allTime.slice(0, 20).map((r) => ({
                  key: r.identityKey,
                  name: r.name,
                  value: formatMoney(r.total),
                  sub: `${r.days} day${r.days === 1 ? '' : 's'} · best ${formatMoney(r.best)}`,
                  you: r.identityKey === identity,
                }))}
                empty={tableMissing ? '—' : rows === null ? 'Counting…' : 'No days on the books yet.'}
              />
              <Panel
                title="🔥 Streaks"
                note="days in a row"
                rows={streaks
                  .filter((r) => r.current > 0 || r.best > 1)
                  .slice(0, 20)
                  .map((r) => ({
                    key: r.identityKey,
                    name: r.name,
                    value: `${r.current}`,
                    sub: `best ${r.best}`,
                    you: r.identityKey === identity,
                  }))}
                empty={
                  tableMissing
                    ? '—'
                    : rows === null
                      ? 'Counting…'
                      : 'Nobody has a streak going. Two days in a row starts one.'
                }
              />
              <a
                href="/challenge#catch-up"
                className="block px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-blue-100/55 transition-colors hover:bg-white/5 hover:text-copper"
              >
                Missed a day? Past boards →
              </a>
            </div>
          </aside>
        )}
      </div>

      {/* The clue, full screen, the way the game shows one. */}
      {active && (
        <ClueOverlay
          category={categories[active.c].name}
          clue={categories[active.c].clues[active.r]}
          show={categories[active.c].show}
          airDate={categories[active.c].airDate}
          value={DAILY_VALUES[active.r]}
          stage={stage}
          typed={typed}
          setTyped={setTyped}
          secondsLeft={secondsLeft}
          outcome={lastOutcome}
          myScore={myScore}
          left={DAILY_CLUES - resolved.length}
          onAnswer={() => resolve('answer', typed)}
          onPass={() => resolve('pass', '')}
          onNext={nextClue}
          onClose={closeClue}
        />
      )}
    </section>
  )
}

/* ─────────────────────────── small parts ─────────────────────────── */

/** The next cell nobody has taken, cheapest row first across the three
 *  categories — the order a board is normally worked through. */
function firstUnplayed(res: DailyClueResult[]): { c: number; r: number } | null {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (!res.some((x) => x.c === c && x.r === r)) return { c, r }
    }
  }
  return null
}

/** Board order — category by category, cheapest row first. */
function boardOrder(res: DailyClueResult[]): DailyClueResult[] {
  return [...res].sort((a, b) => a.c - b.c || a.r - b.r)
}

/**
 * A finished day, rebuilt from the nine outcomes kept in this browser. Enough
 * to mark the board and to put the score back on the leaderboard after a
 * refresh; the typed answers aren't kept, and aren't needed.
 */
function restoreFromLocal(play: LocalPlay): DailyClueResult[] {
  const out: DailyClueResult[] = []
  let i = 0
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      const outcome = play.outcomes[i++] ?? 'pass'
      out.push({ c, r, outcome, value: DAILY_VALUES[r] })
    }
  }
  return out
}

function Skeleton() {
  return (
    <section className="mt-4 md:mt-6">
      <div className="board-wrapper">
        <div className="grid grid-cols-3 gap-1 p-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="min-h-[58px] bg-jeopardy-blue-dark sm:min-h-[70px]" />
          ))}
        </div>
      </div>
    </section>
  )
}

/** Your own line, above the three tables: the streak, and today. */
function YourLine({
  streak,
  play,
  rank,
  field,
  daysPlayed,
}: {
  streak: { current: number; best: number }
  play: LocalPlay | null
  rank: number
  field: number
  daysPlayed: number
}) {
  return (
    <div className="flex items-center gap-2.5 bg-white/[0.04] px-3 py-2">
      <span className="text-xl leading-none">{streak.current > 0 ? '🔥' : '🎯'}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold leading-tight text-white">
          {streak.current > 0
            ? `${streak.current} day${streak.current === 1 ? '' : 's'} in a row`
            : 'No streak going'}
        </span>
        <span className="block text-[10px] leading-tight text-blue-100/60">
          {play
            ? `Today ${formatMoney(play.score)} · ${play.correct}/${DAILY_CLUES}${rank > 0 ? ` · #${rank} of ${field}` : ''}`
            : streak.current > 0
              ? 'Play today to keep it going'
              : 'Play today to start one'}
          {streak.best > streak.current ? ` · best ${streak.best}` : ''}
          {daysPlayed > 0 ? ` · ${daysPlayed} played` : ''}
        </span>
      </span>
    </div>
  )
}

/** One standings table, in the same clothes as the home page's others. */
function Panel({
  title,
  note,
  rows,
  empty,
}: {
  title: string
  note: string
  rows: { key: string; name: string; value: string; sub: string; you: boolean }[]
  empty: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 px-3 py-1.5">
        <span className="banner-title text-jeopardy-gold-light">{title}</span>
        {note && <span className="banner-sub shrink-0 text-blue-100/55">{note}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-2.5 text-[11px] leading-snug text-blue-100/60">{empty}</p>
      ) : (
        <ol className="max-h-[140px] divide-y divide-white/5 overflow-y-auto overscroll-contain">
          {rows.map((r, i) => (
            <li
              key={r.key}
              className={`flex items-center gap-2 px-3 py-1 ${r.you ? 'bg-jeopardy-gold/10' : ''}`}
            >
              <span
                className={`w-3.5 shrink-0 text-center text-[10px] font-black tabular-nums ${
                  i === 0 ? 'text-jeopardy-gold-light' : 'text-blue-100/40'
                }`}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white">
                {r.name}
                {r.you && <span className="ml-1 text-[8px] uppercase tracking-wider text-jeopardy-gold-light">you</span>}
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[12px] font-bold leading-tight tabular-nums text-jeopardy-gold-light">
                  {r.value}
                </span>
                <span className="block text-[8px] leading-none text-blue-100/50">{r.sub}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * The day you just played, under your marked-up board.
 *
 * Three things, in the order people want them: what you got, a result worth
 * pasting into a group chat, and a way to make it count for something — which
 * is what signing in does. Nothing here is a gate: the score is already yours,
 * already on the board if we know your name, and already kept in this browser
 * whatever Supabase is doing.
 */
function Result({
  play,
  rank,
  field,
  streak,
  ranked,
  name,
  setName,
  onRecord,
  onSignIn,
  signedIn,
  submitting,
  submitted,
  recorded,
  tableMissing,
  error,
  left,
  board,
}: {
  play: LocalPlay
  rank: number
  field: number
  streak: { current: number; best: number }
  /** False on a catch-up day: played and shareable, but off the books. */
  ranked: boolean
  name: string
  setName: (s: string) => void
  onRecord: () => void
  onSignIn: () => void
  signedIn: boolean
  submitting: boolean
  submitted: null | 'recorded' | 'already-played'
  recorded: boolean
  tableMissing: boolean
  error: string
  left: number | null
  board: Board
}) {
  const [copied, setCopied] = useState(false)
  const onBoard =
    !ranked || recorded || !!play.posted || submitted === 'recorded' || submitted === 'already-played'

  /** The grid everyone recognises: three rows of three, no clues given away. */
  function grid(): string {
    return [0, 1, 2]
      .map((r) =>
        [0, 1, 2]
          .map((c) => {
            const o = play.outcomes[c * 3 + r]
            return o === 'correct' ? '🟩' : o === 'wrong' ? '🟥' : '⬛'
          })
          .join(''),
      )
      .join('\n')
  }

  async function share() {
    const site = typeof window !== 'undefined' ? window.location.origin : 'https://jplay.dev'
    const text = [
      `JPLAY · Board of the day — ${shortDate(play.date)}`,
      board.day.occasion,
      '',
      grid(),
      '',
      `${formatMoney(play.score)} · ${play.correct}/${DAILY_CLUES} right${
        ranked && streak.current > 1 ? ` · 🔥 ${streak.current} days` : ''
      }`,
      `Same nine clues, same day: ${site}`,
    ].join('\n')

    /* Copy, not the share sheet: this text is built to be PASTED into a group
       chat, and "Copied!" is the whole interaction. The native sheet is used
       where there's no clipboard to write to. */
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
      return
    } catch {}
    try {
      if (navigator.share) { await navigator.share({ text }); return }
    } catch { return }
    window.prompt('Copy your result:', text)
  }

  return (
    <div className="mt-2 rounded-xl border border-jeopardy-gold/45 bg-jeopardy-gold/10 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-sm text-white">
          <span className="text-lg font-bold text-jeopardy-gold-light">{formatMoney(play.score)}</span>
          <span className="text-blue-100/75">
            {' '}· {play.correct} of {DAILY_CLUES} right
            {ranked && onBoard && rank > 0 ? ` · #${rank} of ${field} today` : ''}
            {ranked && streak.current > 1 ? ` · 🔥 ${streak.current} days` : ''}
          </span>
        </p>
        <span className="flex items-center gap-1.5">
          <button onClick={share} className="btn-stage btn-copper btn-stage-sm">
            {copied ? 'Copied!' : '📋 Share result'}
          </button>
          <a href={`/challenge/${board.day.boardKey}`} className="btn-stage btn-stage-ghost btn-stage-sm">
            Full game
          </a>
        </span>
      </div>

      {/* The emoji grid, right there — people share what they can already see. */}
      <pre className="mt-2 select-all text-center font-sans text-base leading-[1.15] tracking-[0.12em] text-white/90">
        {grid()}
      </pre>

      {/* Not on the public board yet. Signing in is the way to keep it for
          good; a name is the way to skip that. */}
      {!onBoard && !tableMissing && (
        <div className="mt-2 border-t border-white/10 pt-2">
          {!signedIn && (
            <>
              <p className="mb-1.5 text-[11px] text-blue-100/75">
                Sign in to lock today in — your streak, your scores and your name follow you
                to any device.
              </p>
              <button onClick={onSignIn} className="btn-stage btn-chrome btn-stage-sm w-full sm:w-auto">
                Continue with Google
              </button>
            </>
          )}
          <div className={`flex items-center gap-1.5 ${signedIn ? '' : 'mt-2'}`}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onRecord() }}
              placeholder="Your name"
              maxLength={30}
              className="field-stage h-9 min-w-0 flex-1 px-2.5 text-sm sm:max-w-[190px]"
            />
            <button
              onClick={onRecord}
              disabled={!name.trim() || submitting}
              className="btn-stage btn-copper btn-stage-sm shrink-0 disabled:opacity-40"
            >
              {submitting ? '…' : signedIn ? 'Put me on the board' : 'Or post as a guest'}
            </button>
          </div>
        </div>
      )}

      {/* Already on the board, but as a guest: the account is still worth
          having, because a guest's streak lives and dies with this browser.
          Days already posted stay where they are — there's no updating another
          identity's row — so this only ever changes where TOMORROW lands. */}
      {ranked && onBoard && !signedIn && !tableMissing && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2">
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-blue-100/65">
            Your streak lives in this browser. Sign in and it follows you.
          </p>
          <button onClick={onSignIn} className="btn-stage btn-chrome btn-stage-sm shrink-0">
            Sign in
          </button>
        </div>
      )}

      <p className="mt-1.5 text-[11px] leading-snug text-blue-100/65">
        {!ranked ? (
          <>
            A day you missed, so it’s off the books — catch-up boards don’t rank and don’t
            build a streak. <a href="/" className="text-copper underline">Today’s board</a> does
            both.
          </>
        ) : submitted === 'already-played'
          ? 'You already had a score on today’s board — the first one stands. '
          : tableMissing
            ? 'Your score is kept in this browser. Run supabase-migration-daily.sql to turn the standings on. '
            : onBoard
              ? `On today’s board${name.trim() ? ` as ${name.trim()}` : ''}. `
              : 'Your score is kept in this browser either way. '}
        {ranked && !tableMissing && left !== null && <>A new board in {untilTomorrowLabel(left)}.</>}
      </p>
      {error && <p className="mt-1 text-[11px] text-copper-glow">{error}</p>}
    </div>
  )
}

/** The clue, the way the game shows one: board blue, nothing else on screen. */
function ClueOverlay({
  category,
  clue,
  show,
  airDate,
  value,
  stage,
  typed,
  setTyped,
  secondsLeft,
  outcome,
  myScore,
  left,
  onAnswer,
  onPass,
  onNext,
  onClose,
}: {
  category: string
  clue: { q: string; a: string }
  show: string | null
  airDate: string | null
  value: number
  stage: Stage
  typed: string
  setTyped: (s: string) => void
  secondsLeft: number
  outcome: ClueOutcome
  myScore: number
  left: number
  onAnswer: () => void
  onPass: () => void
  onNext: () => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [stage, clue.q])

  /* On the reveal, Enter carries on — the same key that just answered, so a
     whole board can be played without the hands leaving the keyboard. */
  useEffect(() => {
    if (stage !== 'reveal') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNext() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, onNext])

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-[#060CE9] px-5 py-8">
      <div className="w-full max-w-2xl text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/80">
          {category} · <span className="text-jeopardy-gold-light">${value}</span>
        </p>

        <p
          className="clue-type mx-auto mt-6 max-w-xl text-xl uppercase text-white md:text-2xl"
          style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.6)' }}
        >
          {clue.q}
        </p>

        {stage === 'answering' ? (
          <>
            <div className="mx-auto mt-8 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-black/40">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  secondsLeft <= 5 ? 'bg-red-500' : 'bg-jeopardy-gold-light'
                }`}
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
              {outcome === 'correct'
                ? `Right! +${formatMoney(value)}`
                : outcome === 'wrong'
                  ? `No — that's -${formatMoney(value)}`
                  : 'Time / passed'}
            </p>
            <p className="mt-2 text-sm text-white/85">
              Correct response: <span className="font-bold text-jeopardy-gold-light">{clue.a}</span>
            </p>
            <p className="mt-4 text-xs text-white/60">
              Your total:{' '}
              <span className="font-bold tabular-nums text-jeopardy-gold-light">{formatMoney(myScore)}</span>
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <button onClick={onNext} className="btn-stage btn-copper">
                {left <= 0 ? 'See how you did' : `Next clue → (${left} left)`}
              </button>
              {left > 0 && (
                <button onClick={onClose} className="btn-stage btn-stage-ghost btn-stage-sm">
                  Pick my own
                </button>
              )}
            </div>
            {left > 0 && (
              <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-white/40">
                Press Enter to keep going
              </p>
            )}
          </div>
        )}

        {(show || airDate) && (
          <p className="mt-6 text-[10px] uppercase tracking-[0.18em] text-white/45">
            {show}
            {show && airDate ? ' · ' : ''}
            {airDate ? `aired ${formatAirDate(airDate)}` : ''}
          </p>
        )}
      </div>
    </div>
  )
}
