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
  ROUND_VALUES,
  DAILY_CLUES,
  DAILY_MAX,
  DAILY_DAYS,
  type DailyBoard as Board,
} from '@/lib/daily-data'
import { loadDailyNight, type DailyNight } from '@/lib/daily-night'
import type { ClueResponse } from '@/lib/episode'
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
 * A whole game from one real night in the show's history: a 3×3 Jeopardy
 * round, a 3×3 Double Jeopardy round at doubled values, then Final Jeopardy
 * with a wager. Same board for everyone, changing at local midnight. No name
 * gate and no intro screen — the board is live the moment the page is, because
 * anything in front of it is a reason to leave. ONE SHOT: a day you've played
 * shows you your own board back, marked.
 *
 * The clue opens INSIDE the board, in the space the grid was using, the way
 * the real board turns over to show a clue. It is deliberately not a takeover:
 * the standings stay beside it, the page doesn't move under you, and closing a
 * clue puts you back exactly where you were.
 *
 * Standings sit to the right, three of them: today, all time, and the streaks.
 * Your own line is read out of this browser first so it's instant and survives
 * a missing table; everyone else's comes from Supabase.
 */
const CLUE_SECONDS = 30
const FINAL_SECONDS = 45

type Stage = 'answering' | 'reveal'
type FinalStage = 'wager' | 'answering' | 'reveal'

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
  /** The three people who actually played this board, on television. */
  const [night, setNight] = useState<DailyNight | null>(null)

  const [active, setActive] = useState<{ rd: number; c: number; r: number } | null>(null)
  const [stage, setStage] = useState<Stage>('answering')
  const [typed, setTyped] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(CLUE_SECONDS)
  const [lastOutcome, setLastOutcome] = useState<ClueOutcome>('pass')

  /** The between-rounds card, until it's been dismissed. */
  const [curtainSeen, setCurtainSeen] = useState(false)
  const [finalStage, setFinalStage] = useState<FinalStage | null>(null)
  const [wagerText, setWagerText] = useState('')
  /** What's on the line for Final — locked when the wager is. */
  const [stake, setStake] = useState(0)
  /** Which round a FINISHED board is showing back. */
  const [viewRound, setViewRound] = useState(1)

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
    if (saved && !plays[day]) {
      setResolved(saved.clueResults)
      // Back into a run that had already turned the corner: no second curtain.
      if (saved.clueResults.some((x) => x.rd === 2)) setCurtainSeen(true)
    }

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

  /* The real contestants, off J-Archive via our own cached route. Late, quiet
     and entirely optional: the board plays the same whether this lands or not,
     so a failure here is swallowed rather than surfaced. */
  useEffect(() => {
    if (!board) return
    let gone = false
    loadDailyNight(board)
      .then((n) => { if (!gone) setNight(n) })
      .catch(() => {})
    return () => { gone = true }
  }, [board])

  /* Progress. One clue per cell per round; Final is rd 3. */
  const r1Count = resolved.filter((x) => x.rd === 1).length
  const r2Count = resolved.filter((x) => x.rd === 2).length
  const finalResult = resolved.find((x) => x.rd === 3)
  const round: 1 | 2 = r1Count < 9 ? 1 : 2
  const boardDone = r1Count >= 9 && r2Count >= 9
  const myScore = scoreOf(resolved)
  const showCurtain = r1Count >= 9 && r2Count === 0 && !curtainSeen && !active && !mine

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

  // ── The Final Jeopardy clock ─────────────────────────────────────────
  useEffect(() => {
    if (finalStage !== 'answering') return
    setSecondsLeft(FINAL_SECONDS)
    const started = Date.now()
    const t = setInterval(() => {
      const s = FINAL_SECONDS - Math.floor((Date.now() - started) / 1000)
      setSecondsLeft(Math.max(0, s))
      if (s <= 0) { clearInterval(t); resolveFinal('') }
    }, 250)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalStage])

  // Both rounds cleared → Final Jeopardy.
  useEffect(() => {
    if (mine || !boardDone || finalResult || finalStage !== null || active) return
    setWagerText('')
    setFinalStage('wager')
  }, [mine, boardDone, finalResult, finalStage, active])

  // ── How long today's board has left ──────────────────────────────────
  useEffect(() => {
    if (!mine || !ranked) { setLeft(null); return }
    setLeft(secondsUntilTomorrow())
    const t = setInterval(() => setLeft(secondsUntilTomorrow()), 30_000)
    return () => clearInterval(t)
  }, [mine, ranked])

  function openClue(rd: number, c: number, r: number) {
    if (!board || mine) return
    if (resolved.some((x) => x.rd === rd && x.c === c && x.r === r)) return
    setTyped('')
    setStage('answering')
    setSecondsLeft(CLUE_SECONDS)
    setActive({ rd, c, r })
  }

  function resolve(kind: 'answer' | 'pass' | 'timeout', text: string) {
    if (!active || !board || !date) return
    const { rd, c, r } = active
    const clue = board.rounds[rd - 1][c].clues[r]
    const outcome: ClueOutcome =
      kind === 'answer' && text.trim()
        ? checkAnswerDetailed(text, clue.a).correct ? 'correct' : 'wrong'
        : 'pass'
    const next = [
      ...resolved,
      { rd, c, r, outcome, value: ROUND_VALUES[rd - 1][r], answer: text.trim() || undefined },
    ]
    setResolved(next)
    setLastOutcome(outcome)
    setStage('reveal')
    saveRun(date, next)
  }

  function closeClue() {
    setActive(null)
  }

  /** The wager rides on Final; you can't bet more than you have. */
  function confirmWager() {
    const max = Math.max(0, myScore)
    const w = Math.min(max, Math.max(0, Math.round(Number(wagerText) || 0)))
    setStake(w)
    setTyped('')
    setFinalStage('answering')
  }

  function resolveFinal(text: string) {
    if (!board || !date) return
    // Not answering Final is a miss, and the wager goes with it — as on the show.
    const outcome: ClueOutcome =
      text.trim() && checkAnswerDetailed(text, board.final.a).correct ? 'correct' : 'wrong'
    const next = [
      ...resolved,
      { rd: 3, c: 0, r: 0, outcome, value: stake, answer: text.trim() || undefined },
    ]
    setResolved(next)
    setLastOutcome(outcome)
    setFinalStage('reveal')
    saveRun(date, next)
  }

  function closeFinal() {
    setFinalStage(null)
    finish(resolved)
  }

  /**
   * The day is over: keep it in this browser whatever happens next, then try to
   * put it on the board. A name we already know goes up without asking.
   */
  function finish(res: DailyClueResult[]) {
    if (!board || !date) return
    const play: LocalPlay = {
      date,
      boardKey: board.day.boardKey,
      score: scoreOf(res),
      correct: res.filter((x) => x.outcome === 'correct').length,
      outcomes: outcomeList(res),
      finalValue: res.find((x) => x.rd === 3)?.value ?? 0,
    }
    if (ranked) noteLocalPlay(play)
    else noteCatchUp(play)
    setMine(play)
    setViewRound(1)
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

  const { day } = board
  /* A finished day is read back out of this browser's record; a day in progress
     is whatever has been resolved so far. */
  const marks = mine ? restoreFromLocal(mine) : resolved
  const shown: 1 | 2 = mine ? (viewRound as 1 | 2) : round
  const finalMark = marks.find((x) => x.rd === 3)

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

      {/* Who played it on television, and what they made on exactly these clues. */}
      {night && <ScoreToBeat night={night} mine={mine} />}

      <div
        className={`mt-2.5 grid items-start gap-2.5 md:gap-3 ${
          ranked ? 'md:grid-cols-[minmax(0,1fr)_296px]' : ''
        }`}
      >
        {/* ── The board, and whatever it is currently showing ────────── */}
        <div className="min-w-0">
          {/* Which round, and — once the day is done — a way back to the other
              one. During play the round is wherever you've got to. */}
          <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
            {mine ? (
              <span className="flex gap-1">
                {([1, 2] as const).map((rd) => (
                  <button
                    key={rd}
                    onClick={() => setViewRound(rd)}
                    className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] transition-colors ${
                      shown === rd
                        ? 'bg-jeopardy-gold text-black'
                        : 'text-blue-100/55 hover:text-white'
                    }`}
                  >
                    {rd === 1 ? 'Jeopardy' : 'Double Jeopardy'}
                  </button>
                ))}
              </span>
            ) : (
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-jeopardy-gold-light sm:text-[10px]">
                {round === 1 ? 'Jeopardy round' : 'Double Jeopardy'}
              </span>
            )}
            <span className="text-[9px] uppercase tracking-[0.14em] text-blue-100/45">
              {mine
                ? `${mine.correct} of ${DAILY_CLUES} right`
                : `${formatMoney(myScore)} · ${9 - (round === 1 ? r1Count : r2Count)} left this round`}
            </span>
          </div>

          <div className="board-wrapper">
            {/* The clue takes the board's own space rather than the screen —
                the way the board itself turns over to show one. */}
            {active ? (
              <CluePanel
                category={board.rounds[active.rd - 1][active.c].name}
                clue={board.rounds[active.rd - 1][active.c].clues[active.r]}
                show={board.rounds[active.rd - 1][active.c].show}
                airDate={board.rounds[active.rd - 1][active.c].airDate}
                value={ROUND_VALUES[active.rd - 1][active.r]}
                responses={night?.responsesFor(active.rd, active.c, active.r) ?? null}
                stage={stage}
                typed={typed}
                setTyped={setTyped}
                secondsLeft={secondsLeft}
                outcome={lastOutcome}
                myScore={myScore}
                left={18 - resolved.filter((x) => x.rd !== 3).length}
                onAnswer={() => resolve('answer', typed)}
                onPass={() => resolve('pass', '')}
                onClose={closeClue}
              />
            ) : showCurtain ? (
              <Curtain score={myScore} onGo={() => setCurtainSeen(true)} />
            ) : finalStage ? (
              <FinalPanel
                final={board.final}
                finalResponses={night?.finalResponses ?? null}
                stage={finalStage}
                typed={typed}
                setTyped={setTyped}
                wagerText={wagerText}
                setWagerText={setWagerText}
                stake={stake}
                maxWager={Math.max(0, scoreOf(resolved.filter((x) => x.rd !== 3)))}
                secondsLeft={secondsLeft}
                outcome={lastOutcome}
                myScore={myScore}
                onWager={confirmWager}
                onAnswer={() => resolveFinal(typed)}
                onClose={closeFinal}
              />
            ) : (
              <div className="grid grid-cols-3 gap-1 p-1">
                {board.rounds[shown - 1].map((cat, c) => (
                  <div
                    key={c}
                    className="board-category min-h-[46px] px-1.5 py-1.5 text-[9px] font-bold uppercase leading-tight text-white sm:min-h-[56px] sm:text-[11px] md:text-xs"
                  >
                    {cat.name}
                  </div>
                ))}
                {[0, 1, 2].map((r) =>
                  board.rounds[shown - 1].map((_, c) => {
                    const res = marks.find((x) => x.rd === shown && x.c === c && x.r === r)
                    return (
                      <button
                        key={`${c}:${r}`}
                        onClick={() => openClue(shown, c, r)}
                        disabled={!!res || !!mine}
                        aria-label={
                          res
                            ? `$${ROUND_VALUES[shown - 1][r]} — ${res.outcome}`
                            : `${board.rounds[shown - 1][c].name}, $${ROUND_VALUES[shown - 1][r]}`
                        }
                        className={`min-h-[58px] text-xl sm:min-h-[70px] sm:text-2xl md:min-h-[82px] md:text-3xl ${
                          res
                            ? res.outcome === 'correct'
                              ? 'board-cell board-cell-correct'
                              : res.outcome === 'wrong'
                                ? 'board-cell board-cell-wrong'
                                /* The shared answered style paints its text
                                   away; a clue you passed on has to still
                                   read as one. */
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
                          : `$${ROUND_VALUES[shown - 1][r]}`}
                      </button>
                    )
                  }),
                )}
              </div>
            )}
          </div>

          {/* Under the board: where you are, or where you finished. */}
          {mine ? (
            <Result
              play={mine}
              night={night}
              finalMark={finalMark}
              finalCategory={board.final.category}
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
                    ? 'Two rounds and a Final. 30 seconds a clue, one shot — today only.'
                    : 'Two rounds and a Final — a day you missed, played for the record, not the leaderboard.'
                  : `${DAILY_CLUES - resolved.length} clue${DAILY_CLUES - resolved.length === 1 ? '' : 's'} to go · ${formatMoney(myScore)} so far`}
              </p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-blue-100/45">
                Perfect board {formatMoney(DAILY_MAX)} + Final
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
              {/* Today's table, with the three people who actually played this
                  board in it. They are the field you're really up against —
                  especially on a day nobody else has played yet — and they're
                  dimmed and labelled so nobody reads them as site players. */}
              <Panel
                title="🏆 Today"
                note={todayRows.length ? `${todayRows.length} ${todayRows.length === 1 ? 'player' : 'players'}` : ''}
                rows={[
                  ...todayRows.slice(0, 20).map((r) => ({
                    key: r.identityKey,
                    name: r.name,
                    value: formatMoney(r.score),
                    sub: `${r.correct}/${DAILY_CLUES} right`,
                    you: r.identityKey === identity,
                    score: r.score,
                  })),
                  ...(night?.contestants ?? []).map((c) => ({
                    key: `tv:${c.name}`,
                    name: `📺 ${c.name}${c.won ? ' 👑' : ''}`,
                    value: formatMoney(c.onBoard),
                    sub: 'that night',
                    you: false,
                    tv: true,
                    score: c.onBoard,
                  })),
                ].sort((a, b) => b.score - a.score)}
                empty={
                  tableMissing
                    ? 'Standings go live once supabase-migration-daily.sql is run.'
                    : rows === null
                      ? 'Counting…'
                      : 'Nobody has played today yet. Set the number.'
                }
                footnote={
                  night
                    ? tableMissing
                      ? 'Contestant money is their real answers re-scored on this board. Standings go live once supabase-migration-daily.sql is run.'
                      : 'Contestant money is their real answers re-scored on this board.'
                    : undefined
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
    </section>
  )
}

/* ─────────────────────────── small parts ─────────────────────────── */

/**
 * The three people who played this board on television, and what they made on
 * the eighteen clues that are on yours. The winner's real total rides along as
 * context — it is a much bigger number, off a board three times the size, and
 * saying so is the difference between a target and a lie.
 */
function ScoreToBeat({ night, mine }: { night: DailyNight; mine: LocalPlay | null }) {
  const champ = night.contestants.find((c) => c.won)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/10 bg-black/25 px-3 py-1.5">
      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-copper">
        {mine ? 'That night' : 'Score to beat'}
      </span>
      {[...night.contestants]
        .sort((a, b) => b.onBoard - a.onBoard)
        .map((c) => (
          <span key={c.name} className="text-[11px] leading-tight text-blue-100/70">
            {c.won && <span aria-label="won that night">👑 </span>}
            <span className="font-semibold text-white">{c.name}</span>{' '}
            <span className="tabular-nums text-jeopardy-gold-light">{formatMoney(c.onBoard)}</span>
          </span>
        ))}
      <span className="text-[10px] leading-tight text-blue-100/45">
        on these clues
        {champ ? ` · 👑 ${champ.name} scored ${formatMoney(champ.night)} across the whole night` : ''}
      </span>
    </div>
  )
}

/** What the people on television did with the clue you just played. */
function ThatNight({ responses }: { responses: ClueResponse[] | null }) {
  if (!responses) return null
  return (
    <p className="mt-2 text-[11px] text-white/55">
      {responses.length === 0 ? (
        'That night: nobody got it'
      ) : (
        <>
          That night:{' '}
          {responses.map((r, i) => (
            <span key={`${r.name}-${i}`}>
              {i > 0 && ', '}
              <span className={r.right ? 'text-green-300' : 'text-red-300'}>
                {r.name} {r.right ? 'got it' : 'missed'}
              </span>
            </span>
          ))}
        </>
      )}
    </p>
  )
}

/** The board's own footprint, so a clue or a curtain doesn't move the page. */
const PANEL = 'flex min-h-[236px] flex-col items-center justify-center bg-[#060CE9] px-4 py-5 text-center sm:min-h-[276px] md:min-h-[312px]'

/**
 * The nineteen outcomes in board order: Jeopardy round category by category
 * (index = c * 3 + r), then Double Jeopardy, then Final last.
 */
function outcomeList(res: DailyClueResult[]): ClueOutcome[] {
  const out: ClueOutcome[] = []
  for (const rd of [1, 2]) {
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        out.push(res.find((x) => x.rd === rd && x.c === c && x.r === r)?.outcome ?? 'pass')
      }
    }
  }
  out.push(res.find((x) => x.rd === 3)?.outcome ?? 'pass')
  return out
}

/**
 * A finished day, rebuilt from what this browser kept. Enough to mark the board
 * and to put the score back on the leaderboard after a refresh; the typed
 * answers aren't kept, and aren't needed. A day played before the board became
 * a full game has only nine outcomes — the rest read as passes.
 */
function restoreFromLocal(play: LocalPlay): DailyClueResult[] {
  const out: DailyClueResult[] = []
  let i = 0
  for (const rd of [1, 2]) {
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        out.push({ rd, c, r, outcome: play.outcomes[i++] ?? 'pass', value: ROUND_VALUES[rd - 1][r] })
      }
    }
  }
  out.push({ rd: 3, c: 0, r: 0, outcome: play.outcomes[i] ?? 'pass', value: play.finalValue ?? 0 })
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

/** Between the rounds, in the board's own space. */
function Curtain({ score, onGo }: { score: number; onGo: () => void }) {
  return (
    <div className={PANEL}>
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-jeopardy-gold-light">
        That&apos;s the Jeopardy round
      </p>
      <p className="mt-2 text-3xl font-bold text-white md:text-4xl">{formatMoney(score)}</p>
      <h3
        className="mt-5 text-2xl uppercase tracking-wide text-jeopardy-gold-light md:text-3xl"
        style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '2px 2px 5px rgba(0,0,0,0.6)' }}
      >
        Double Jeopardy
      </h3>
      <p className="mt-1.5 text-xs text-white/80">Every value doubles. Nine more clues.</p>
      <button onClick={onGo} className="btn-stage btn-copper btn-stage-sm mt-4">
        Bring on the board
      </button>
    </div>
  )
}

/**
 * The clue, in the board's own space rather than over the page.
 *
 * Enter answers, and on the reveal Enter takes you back to the board — it
 * returns to the BOARD rather than jumping to the next clue, because choosing
 * the clue is the game.
 */
function CluePanel({
  category,
  clue,
  show,
  airDate,
  value,
  responses,
  stage,
  typed,
  setTyped,
  secondsLeft,
  outcome,
  myScore,
  left,
  onAnswer,
  onPass,
  onClose,
}: {
  category: string
  clue: { q: string; a: string }
  show: string | null
  airDate: string | null
  value: number
  /** Who rang in on this clue the night it aired; null until that's known. */
  responses: ClueResponse[] | null
  stage: Stage
  typed: string
  setTyped: (s: string) => void
  secondsLeft: number
  outcome: ClueOutcome
  myScore: number
  left: number
  onAnswer: () => void
  onPass: () => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [stage, clue.q])

  useEffect(() => {
    if (stage !== 'reveal') return
    /* The Enter that answered the clue is STILL BUBBLING when this listener is
       added — React handles the key at its root, flushes, and the event then
       carries on up to window — so without this it dismissed the very reveal it
       had just opened and nobody ever saw the correct response. An event
       dispatched before the listener existed carries the earlier timestamp. */
    const since = performance.now()
    const onKey = (e: KeyboardEvent) => {
      if (e.timeStamp < since) return
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, onClose])

  return (
    <div className={PANEL}>
      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/80">
        {category} · <span className="text-jeopardy-gold-light">${value}</span>
      </p>

      <p
        className="clue-type mx-auto mt-3 max-w-xl text-base uppercase leading-snug text-white sm:text-lg md:text-xl"
        style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.6)' }}
      >
        {clue.q}
      </p>

      {stage === 'answering' ? (
        <>
          <div className="mx-auto mt-4 h-1 w-full max-w-sm overflow-hidden rounded-full bg-black/40">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                secondsLeft <= 5 ? 'bg-red-500' : 'bg-jeopardy-gold-light'
              }`}
              style={{ width: `${(secondsLeft / CLUE_SECONDS) * 100}%` }}
            />
          </div>
          <p className={`mt-1 text-[10px] tabular-nums ${secondsLeft <= 5 ? 'text-red-300' : 'text-white/60'}`}>
            {secondsLeft}s
          </p>
          <div className="mx-auto mt-3 flex w-full max-w-md flex-wrap items-center justify-center gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) onAnswer() }}
              placeholder="What is…?"
              className="field-stage h-10 min-w-0 flex-1 text-center text-sm"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button onClick={onAnswer} disabled={!typed.trim()} className="btn-stage btn-copper btn-stage-sm shrink-0">
              Answer
            </button>
            <button onClick={onPass} className="btn-stage btn-stage-ghost btn-stage-sm shrink-0">
              Pass
            </button>
          </div>
        </>
      ) : (
        <div className="mt-4">
          <p
            className={`text-lg font-bold md:text-xl ${
              outcome === 'correct' ? 'text-green-400' : outcome === 'wrong' ? 'text-red-400' : 'text-white/70'
            }`}
          >
            {outcome === 'correct'
              ? `Right! +${formatMoney(value)}`
              : outcome === 'wrong'
                ? `No — that's -${formatMoney(value)}`
                : 'Time / passed'}
          </p>
          <p className="mt-1.5 text-sm text-white/85">
            Correct response:{' '}
            <span className="font-bold text-jeopardy-gold-light">{clue.a}</span>
          </p>
          <ThatNight responses={responses} />
          <p className="mt-2 text-[11px] text-white/60">
            Your total:{' '}
            <span className="font-bold tabular-nums text-jeopardy-gold-light">{formatMoney(myScore)}</span>
          </p>
          <button onClick={onClose} className="btn-stage btn-copper btn-stage-sm mt-3">
            {left <= 0 ? 'On to Final Jeopardy' : `Back to the board · ${left} left`}
          </button>
          {left > 0 && (
            <p className="mt-1.5 text-[9px] uppercase tracking-[0.16em] text-white/40">
              Press Enter — you pick the next one
            </p>
          )}
        </div>
      )}

      {(show || airDate) && (
        <p className="mt-4 text-[9px] uppercase tracking-[0.16em] text-white/40">
          {show}
          {show && airDate ? ' · ' : ''}
          {airDate ? `aired ${formatAirDate(airDate)}` : ''}
        </p>
      )}
    </div>
  )
}

/** Final Jeopardy: the category, your wager, the clue, the damage. */
function FinalPanel({
  final,
  finalResponses,
  stage,
  typed,
  setTyped,
  wagerText,
  setWagerText,
  stake,
  maxWager,
  secondsLeft,
  outcome,
  myScore,
  onWager,
  onAnswer,
  onClose,
}: {
  final: Board['final']
  /** How the three of them wagered and answered Final that night. */
  finalResponses: { name: string; right: boolean; wager: number }[] | null
  stage: FinalStage
  typed: string
  setTyped: (s: string) => void
  wagerText: string
  setWagerText: (s: string) => void
  stake: number
  maxWager: number
  secondsLeft: number
  outcome: ClueOutcome
  myScore: number
  onWager: () => void
  onAnswer: () => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [stage])

  return (
    <div className={PANEL}>
      <p
        className="text-xl uppercase tracking-wide text-jeopardy-gold-light md:text-2xl"
        style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '2px 2px 5px rgba(0,0,0,0.6)' }}
      >
        Final Jeopardy
      </p>
      <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.24em] text-white/85">
        {final.category}
      </p>

      {stage === 'wager' ? (
        <>
          <p className="mx-auto mt-3 max-w-md text-xs text-white/80">
            You have{' '}
            <span className="font-bold text-jeopardy-gold-light">{formatMoney(myScore)}</span>.
            Wager anything up to{' '}
            <span className="font-bold text-jeopardy-gold-light">{formatMoney(maxWager)}</span> —
            then the clue appears and the money rides on it.
          </p>
          <div className="mx-auto mt-3 flex w-full max-w-sm flex-wrap items-center justify-center gap-1.5">
            <input
              ref={inputRef}
              type="number"
              inputMode="numeric"
              min={0}
              max={maxWager}
              value={wagerText}
              onChange={(e) => setWagerText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && wagerText.trim()) onWager() }}
              placeholder="Your wager"
              className="field-stage h-10 min-w-0 flex-1 text-center text-sm"
            />
            <button
              onClick={() => setWagerText(String(maxWager))}
              className="btn-stage btn-stage-ghost btn-stage-sm shrink-0"
            >
              All of it
            </button>
            <button
              onClick={onWager}
              disabled={!wagerText.trim()}
              className="btn-stage btn-copper btn-stage-sm shrink-0"
            >
              Lock it in
            </button>
          </div>
          {maxWager === 0 && (
            <p className="mt-2 text-[10px] text-white/55">
              Nothing to wager with — lock in $0 and answer for the record.
            </p>
          )}
        </>
      ) : stage === 'answering' ? (
        <>
          <p
            className="clue-type mx-auto mt-3 max-w-xl text-base uppercase leading-snug text-white sm:text-lg md:text-xl"
            style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.6)' }}
          >
            {final.q}
          </p>
          <div className="mx-auto mt-4 h-1 w-full max-w-sm overflow-hidden rounded-full bg-black/40">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                secondsLeft <= 8 ? 'bg-red-500' : 'bg-jeopardy-gold-light'
              }`}
              style={{ width: `${(secondsLeft / FINAL_SECONDS) * 100}%` }}
            />
          </div>
          <p className={`mt-1 text-[10px] tabular-nums ${secondsLeft <= 8 ? 'text-red-300' : 'text-white/60'}`}>
            {secondsLeft}s · {formatMoney(stake)} on the line
          </p>
          <div className="mx-auto mt-3 flex w-full max-w-md flex-wrap items-center justify-center gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && typed.trim()) onAnswer() }}
              placeholder="What is…?"
              className="field-stage h-10 min-w-0 flex-1 text-center text-sm"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button onClick={onAnswer} disabled={!typed.trim()} className="btn-stage btn-copper btn-stage-sm shrink-0">
              Lock in answer
            </button>
          </div>
        </>
      ) : (
        <div className="mt-3">
          <p
            className={`text-lg font-bold md:text-xl ${
              outcome === 'correct' ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {outcome === 'correct' ? `Right! +${formatMoney(stake)}` : `No — that's -${formatMoney(stake)}`}
          </p>
          <p className="mt-1.5 text-sm text-white/85">
            Correct response: <span className="font-bold text-jeopardy-gold-light">{final.a}</span>
          </p>
          {finalResponses && finalResponses.length > 0 && (
            <p className="mt-2 text-[11px] text-white/55">
              That night:{' '}
              {finalResponses.map((f, i) => (
                <span key={`${f.name}-${i}`}>
                  {i > 0 && ', '}
                  <span className={f.right ? 'text-green-300' : 'text-red-300'}>
                    {f.name} {f.right ? 'got it' : 'missed'}
                  </span>
                  <span className="text-white/40"> ({formatMoney(f.wager)})</span>
                </span>
              ))}
            </p>
          )}
          <p className="mt-2 text-xs text-white/70">
            Final total:{' '}
            <span className="text-base font-bold tabular-nums text-jeopardy-gold-light">
              {formatMoney(myScore)}
            </span>
          </p>
          <button onClick={onClose} className="btn-stage btn-copper btn-stage-sm mt-3">
            See how you did
          </button>
        </div>
      )}
    </div>
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
  footnote,
}: {
  title: string
  note: string
  rows: { key: string; name: string; value: string; sub: string; you: boolean; tv?: boolean }[]
  empty: string
  footnote?: string
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
              className={`flex items-center gap-2 px-3 py-1 ${
                r.you ? 'bg-jeopardy-gold/10' : r.tv ? 'bg-white/[0.02]' : ''
              }`}
            >
              <span
                className={`w-3.5 shrink-0 text-center text-[10px] font-black tabular-nums ${
                  i === 0 ? 'text-jeopardy-gold-light' : 'text-blue-100/40'
                }`}
              >
                {i + 1}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-[12px] font-semibold ${
                  r.tv ? 'text-blue-100/70' : 'text-white'
                }`}
              >
                {r.name}
                {r.you && <span className="ml-1 text-[8px] uppercase tracking-wider text-jeopardy-gold-light">you</span>}
              </span>
              <span className="shrink-0 text-right">
                <span
                  className={`block text-[12px] font-bold leading-tight tabular-nums ${
                    r.tv ? 'text-jeopardy-gold-light/70' : 'text-jeopardy-gold-light'
                  }`}
                >
                  {r.value}
                </span>
                <span className="block text-[8px] leading-none text-blue-100/50">{r.sub}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {footnote && (
        <p className="px-3 pb-1.5 pt-1 text-[9px] leading-snug text-blue-100/45">{footnote}</p>
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
  night,
  finalMark,
  finalCategory,
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
  night: DailyNight | null
  finalMark: DailyClueResult | undefined
  finalCategory: string
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

  /**
   * The grid everyone recognises, as the board actually reads: the Jeopardy
   * round on the left, Double Jeopardy on the right, Final on its own line.
   * No clues given away.
   */
  function grid(): string {
    const at = (i: number) => {
      const o = play.outcomes[i]
      return o === 'correct' ? '🟩' : o === 'wrong' ? '🟥' : '⬛'
    }
    const rows = [0, 1, 2].map(
      (r) =>
        [0, 1, 2].map((c) => at(c * 3 + r)).join('') +
        '  ' +
        [0, 1, 2].map((c) => at(9 + c * 3 + r)).join(''),
    )
    return `${rows.join('\n')}\nFinal ${at(18)}`
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
      `Same board, same night: ${site}`,
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
        <button onClick={share} className="btn-stage btn-copper btn-stage-sm">
          {copied ? 'Copied!' : '📋 Share result'}
        </button>
      </div>

      {/* The emoji grid, right there — people share what they can already see. */}
      <pre className="mt-2 select-all text-center font-sans text-sm leading-[1.2] tracking-[0.1em] text-white/90 sm:text-base">
        {grid()}
      </pre>

      {/* How Final went, which the grid can only say yes or no about. */}
      {finalMark && (
        <p className="mt-1 text-center text-[11px] text-blue-100/70">
          Final · {finalCategory} — wagered{' '}
          <span className="font-bold text-jeopardy-gold-light">{formatMoney(finalMark.value)}</span>{' '}
          and {finalMark.outcome === 'correct' ? 'got it' : 'missed'}
        </p>
      )}

      {/* You against the three who actually played it. */}
      {night && <AgainstTheRoom play={play} night={night} />}

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

/**
 * Where you finished among the people who played this board on television.
 *
 * Their money is re-scored on YOUR board — the same eighteen clues at the same
 * values, their real answers — because comparing your nineteen clues to a
 * sixty-one-clue night would flatter nobody and mean nothing. The real total
 * is still named underneath, so the estimate never pretends to be the record.
 */
function AgainstTheRoom({ play, night }: { play: LocalPlay; night: DailyNight }) {
  const field = [
    ...night.contestants.map((c) => ({
      name: c.name,
      score: c.onBoard,
      you: false,
      won: c.won,
      night: c.night,
      correct: c.correct,
    })),
    { name: 'You', score: play.score, you: true, won: false, night: 0, correct: play.correct },
  ].sort((a, b) => b.score - a.score)

  const mine = field.findIndex((r) => r.you) + 1
  const champ = night.contestants.find((c) => c.won)

  return (
    <div className="mt-2 border-t border-white/10 pt-2">
      <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-copper">
        On these clues · you finished {mine === 1 ? 'first' : mine === 2 ? 'second' : mine === 3 ? 'third' : 'fourth'} of {field.length}
      </p>
      <ol className="space-y-0.5">
        {field.map((r, i) => (
          <li
            key={r.name + i}
            className={`flex items-center gap-2 rounded px-1.5 py-0.5 text-[12px] ${
              r.you ? 'bg-jeopardy-gold/15 text-white' : 'text-blue-100/80'
            }`}
          >
            <span className="w-3 shrink-0 text-center text-[10px] font-black tabular-nums text-blue-100/45">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold">
              {r.won && <span aria-label="won that night">👑 </span>}
              {r.name}
              {!r.you && (
                <span className="ml-1.5 text-[10px] font-normal text-blue-100/45">
                  {r.correct} right
                </span>
              )}
            </span>
            <span className="shrink-0 font-bold tabular-nums text-jeopardy-gold-light">
              {formatMoney(r.score)}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-1 text-[10px] leading-snug text-blue-100/45">
        Their real answers, re-scored on this board — three of the night\u2019s six categories, at
        these values.
        {champ ? ` ${champ.name} scored ${formatMoney(champ.night)} across the whole night.` : ''}
      </p>
    </div>
  )
}
