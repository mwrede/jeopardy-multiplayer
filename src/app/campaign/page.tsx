'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChromeWordmark } from '@/components/ChromeWordmark'
import { FeedbackPrompt } from '@/components/FeedbackPrompt'
import { GameKeyboard } from '@/components/GameKeyboard'
import { AnimatedClueReveal } from '@/components/AnimatedClueReveal'
import { CLUE_INTRO_MS, computeReadingMs } from '@/lib/clue-timing'
import { checkAnswer } from '@/lib/answer-check'
import {
  playBuzzSound, playCorrectSound, playDailyDoubleSound, playSelectSound,
  playTickSound, playTimeUpSound, playWrongSound,
} from '@/lib/sounds'
import { clampDailyDoubleWager, clampFinalWager, maxDailyDoubleWager, maxFinalWager } from '@/lib/wager'
import { fetchEpisode, money, type Episode, type EpisodeContestant } from '@/lib/episode'
import {
  boardFor, cellKey, clearRun, clueAt, contestantFinal, contestantScore, episodeInfo, episodesInYear, firstGameOf,
  loadBest, loadProfile, loadRun, newRunId, nextEpisode, noteBest, recordNight, saveProfile, saveRun, whoAnswered,
  type BestRun, type EpisodeInfo, type NightResult, type Profile, type Run,
} from '@/lib/campaign'
import type { GameLength } from '@/types/game'
import { REAL_STREAKS, rankAmongReal } from '@/lib/streaks'
import {
  clearNightSave, contestantDdWager, loadNightSave, saveNightSave, tournamentsOf, TOURNAMENT_KINDS,
  type NightSave, type Outcome, type Resolved, type Tournament,
} from '@/lib/campaign'
import { useUser } from '@/lib/auth'
import { getChallengeIdentity } from '@/lib/challenge'

/**
 * AGAINST REAL CONTESTANTS — the campaign.
 *
 * Told as a night at the show. You give your name and where you're from, the
 * way every contestant does. You meet the three people who actually played
 * this episode — occupations, hometowns, the returning champion's total. The
 * host asks you to say something about yourself. Then the board, and on every
 * clue you find out who really rang in that night and what it cost or paid
 * them, with their money moving beside yours. Win, and you're back tomorrow
 * against the next episode's three. Lose, and the run is over: the score is
 * how far into the season you got.
 */

type Phase = 'welcome' | 'profile' | 'pick' | 'journey' | 'meet' | 'playing' | 'curtain' | 'final' | 'night' | 'over'

const CLUE_SECONDS = 20
const FINAL_SECONDS = 30
const SIZES: { id: GameLength; label: string; desc: string }[] = [
  { id: 'full', label: 'Full', desc: '6×5 · the whole board · ~20 min' },
  { id: 'half', label: 'Half', desc: '6×3 · the cheaper rows · ~10 min' },
  { id: 'rapid', label: 'Rapid', desc: '3×3 · nine a round · ~5 min' },
]

const thisYear = new Date().getFullYear()
const YEARS = Array.from({ length: thisYear - 1984 + 1 }, (_, i) => thisYear - i)

export default function CampaignPage() {
  const { user } = useUser()
  const [phase, setPhase] = useState<Phase>('welcome')
  const [profile, setProfile] = useState<Profile>({ name: '', hometown: '', anecdote: '' })
  const [run, setRun] = useState<Run | null>(null)
  const [best, setBest] = useState<BestRun | null>(null)

  // Picking a starting night.
  const [year, setYear] = useState(thisYear)
  const [episodes, setEpisodes] = useState<EpisodeInfo[] | null>(null)
  const [picked, setPicked] = useState<EpisodeInfo | null>(null)
  const [chasing, setChasing] = useState<{ name: string; games: number } | null>(null)
  const [chaseBusy, setChaseBusy] = useState<string | null>(null)
  // A tournament to start in, and the kind's listing while it's being chosen.
  const [series, setSeries] = useState<string | null>(null)
  const [tKind, setTKind] = useState<string | null>(null)
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null)
  // The paused night in this browser, if any.
  const [saved, setSaved] = useState<NightSave | null>(null)

  /** Start where a champion started: their first night becomes yours. */
  async function chase(r: { name: string; games: number }) {
    setChaseBusy(r.name)
    setError('')
    const info = await firstGameOf(r.name)
    setChaseBusy(null)
    if (!info) { setError(`Couldn't find ${r.name}'s first game in the archive.`); return }
    setPicked(info)
    setChasing({ name: r.name, games: r.games })
  }

  // The night in progress.
  const [episode, setEpisode] = useState<Episode | null>(null)
  const [size, setSize] = useState<GameLength>('full')
  const [resolved, setResolved] = useState<Record<string, Resolved>>({})
  const [round, setRound] = useState<1 | 2>(1)
  const [active, setActive] = useState<{ rd: number; c: number; r: number } | null>(null)
  const [stage, setStage] = useState<'wager' | 'clue' | 'result'>('clue')
  const [typed, setTypedState] = useState('')
  const [wagerText, setWagerTextState] = useState('')
  // Mirrors of the two text fields that update the instant a key lands. The
  // resolve functions read these rather than the state values. State is what
  // the RENDER saw; a handler that fires from a timer, or an Enter that lands
  // ahead of React's commit, can be holding a render from twenty seconds ago
  // — which graded a Final that timed out as an empty answer even when a
  // perfectly good one was sitting in the box.
  const typedRef = useRef('')
  const wagerRef = useRef('')
  const setTyped = (v: string) => { typedRef.current = v; setTypedState(v) }
  const setWagerText = (v: string) => { wagerRef.current = v; setWagerTextState(v) }
  const [stake, setStake] = useState(0)
  const [last, setLast] = useState<Resolved | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(CLUE_SECONDS)
  // A clue is read out before anyone can answer, exactly as on the other
  // boards: category and value first, then the text typed across the screen.
  // The answer box and the clock only appear once the reading is done.
  const [revealed, setRevealed] = useState(false)
  const [variant] = useState<'tv' | 'phone'>(() =>
    typeof window !== 'undefined' && window.innerWidth >= 768 ? 'tv' : 'phone',
  )

  // Final Jeopardy.
  const [fjStage, setFjStage] = useState<'category' | 'wager' | 'clue' | 'result' | null>(null)
  const [fjResult, setFjResult] = useState<{ right: boolean; delta: number; typed: string } | null>(null)

  const [night, setNight] = useState<NightResult | null>(null)
  const [nextInfo, setNextInfo] = useState<EpisodeInfo | null | 'none'>(null)
  const [error, setError] = useState('')

  /* ── Storage ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const p = loadProfile()
    if (p) setProfile(p)
    setRun(loadRun())
    setBest(loadBest())
    setSaved(loadNightSave())
  }, [])

  // The night on disk, after every clue. Leaving — the button, the tab, the
  // battery — costs at most the clue that was open.
  useEffect(() => {
    if (!episode || !run) return
    if (phase !== 'playing' && phase !== 'curtain' && phase !== 'final') return
    const snap: NightSave = {
      gameId: episode.gameId, size, resolved, round, at: phase,
      final: fjStage === 'result' && fjResult ? { result: fjResult, stake } : null,
      savedAt: new Date().toISOString(),
    }
    saveNightSave(snap)
    setSaved(snap)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, episode?.gameId, size, resolved, round, fjStage, fjResult, stake, !!run])

  /* ── Derived ─────────────────────────────────────────────────────────── */
  const board = useMemo(() => (episode ? boardFor(episode, size) : null), [episode, size])
  const resolvedKeys = useMemo(() => new Set(Object.keys(resolved)), [resolved])
  const myScore = useMemo(
    () => Object.values(resolved).reduce((a, r) => a + r.delta, 0) + (fjResult?.delta ?? 0),
    [resolved, fjResult],
  )
  const theirScores = useMemo(() => {
    if (!episode || !board) return []
    return episode.contestants.map((c) => {
      const base = contestantScore(episode, board, c, resolvedKeys, size === 'full')
      // Once Final is settled, their Final rides on it too.
      if (fjResult) {
        const f = contestantFinal(episode, c, base, size === 'full')
        if (f) return base + (f.right ? f.wager : -f.wager)
      }
      return base
    })
  }, [episode, board, resolvedKeys, fjResult])

  const airedYear = episode?.airedOn ? parseInt(episode.airedOn.slice(-4), 10) || null : null
  const roundClues = (rd: number) => board?.rounds[rd - 1]?.clues ?? []
  const roundDone = (rd: number) => roundClues(rd).every((cl) => resolvedKeys.has(cellKey(rd, cl.c, cl.r)))

  /* ── Timer ───────────────────────────────────────────────────────────── */
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const clueShowing = phase === 'playing' && !!active && stage === 'clue'
  const finalShowing = phase === 'final' && fjStage === 'clue'
  const clueLive = clueShowing && revealed
  const finalLive = finalShowing && revealed

  // Reading time: the intro card, then the text at host pace.
  useEffect(() => {
    if (!clueShowing && !finalShowing) { setRevealed(false); return }
    setRevealed(false)
    const q = clueShowing && active && board
      ? clueAt(board, active.rd, active.c, active.r)?.question ?? ''
      : episode?.final?.question ?? ''
    const t = setTimeout(() => setRevealed(true), CLUE_INTRO_MS + computeReadingMs(q))
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clueShowing, finalShowing, active?.rd, active?.c, active?.r])
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (!clueLive && !finalLive) return
    setSecondsLeft(clueLive ? CLUE_SECONDS : FINAL_SECONDS)
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s > 1) return s - 1
        if (timerRef.current) clearInterval(timerRef.current)
        // Out of time: on the board that's not ringing in; in Final it's
        // whatever's on the paper.
        if (clueLive) resolveClue('pass')
        else resolveFinal()
        return 0
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clueLive, finalLive, active?.rd, active?.c, active?.r])

  // The same tick the multiplayer clocks make — one per second, sharper
  // under five. Not on the reset to full, only as it counts down.
  const prevSeconds = useRef<number | null>(null)
  useEffect(() => {
    const total = clueLive ? CLUE_SECONDS : finalLive ? FINAL_SECONDS : null
    if (total !== null && secondsLeft > 0 && secondsLeft < total && prevSeconds.current !== secondsLeft) {
      playTickSound(secondsLeft <= 5)
    }
    prevSeconds.current = secondsLeft
  }, [secondsLeft, clueLive, finalLive])

  // Enter or Escape on a screen that's only waiting to be read. autoFocus on
  // the button was meant to do this and doesn't survive the overlay
  // re-rendering; a listener on the window does.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (phase === 'playing' && active && stage === 'result') { e.preventDefault(); closeClue() }
      else if (phase === 'final' && fjStage === 'category') { e.preventDefault(); setWagerText(''); setFjStage('wager') }
      else if (phase === 'final' && fjStage === 'result') { e.preventDefault(); void settleNight() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, active, stage, fjStage])

  /* ── Flow ────────────────────────────────────────────────────────────── */

  function beginNew() {
    clearRun()
    clearNightSave()
    setSaved(null)
    setRun(null)
    setSeries(null)
    setPhase(profile.name ? 'pick' : 'profile')
  }

  async function resumeRun() {
    if (!run) return
    const info = await episodeInfo(run.currentGameId)
    if (!info) { setError("Couldn't find the next episode."); return }
    setPicked(info)
    const snap = saved && saved.gameId === run.currentGameId ? saved : null
    if (!snap) { await loadNight(info); return }
    // Tonight was paused: straight back to the board, no green room.
    setError('')
    setEpisode(null)
    setActive(null)
    setLast(null)
    setNight(null)
    setNextInfo(null)
    const ep = await fetchEpisode(info.gameId)
    if (!ep) { setError("The archive doesn't have a full record of that night."); return }
    setSize(snap.size)
    setResolved(snap.resolved)
    setRound(snap.round)
    setEpisode(ep)
    if (snap.at === 'final') {
      setFjResult(snap.final?.result ?? null)
      setStake(snap.final?.stake ?? 0)
      setFjStage(snap.final ? 'result' : 'category')
    } else {
      setFjStage(null)
      setFjResult(null)
    }
    setPhase(snap.at)
  }

  /** Put the night down. It's already on disk; the open clue, if any, goes back unplayed. */
  function pause() {
    if (timerRef.current) clearInterval(timerRef.current)
    setActive(null)
    setLast(null)
    setPhase('welcome')
  }

  async function loadYear(y: number) {
    setYear(y)
    setEpisodes(null)
    setEpisodes(await episodesInYear(y))
  }

  /**
   * Fetch the episode and open the green room. The first night of a run is
   * the trip out — bags, the flight, the studio doors, the stage — so it
   * goes through the journey while the episode loads underneath. Every night
   * after that you're already in Culver City, and you walk straight on.
   */
  async function loadNight(info: EpisodeInfo, travel = false) {
    setError('')
    setEpisode(null)
    setResolved({})
    setRound(1)
    setActive(null)
    setFjStage(null)
    setFjResult(null)
    setNight(null)
    setNextInfo(null)
    setPhase(travel ? 'journey' : 'meet')
    const ep = await fetchEpisode(info.gameId)
    if (!ep) { setError("The archive doesn't have a full record of that night. Pick another."); setPhase('pick'); return }
    setEpisode(ep)
  }

  function takeThePodium() {
    saveProfile(profile)
    if (!run && picked) {
      const fresh: Run = {
        id: newRunId(),
        chasing: chasing ?? undefined,
        series: series ?? picked.series ?? undefined,
        startGameId: picked.gameId,
        currentGameId: picked.gameId,
        season: picked.season,
        streak: 0,
        totalWinnings: 0,
        history: [],
        startedAt: new Date().toISOString(),
        endedAt: null,
      }
      setRun(fresh)
      saveRun(fresh)
    }
    setPhase('playing')
  }

  function openClue(rd: number, c: number, r: number) {
    if (!board) return
    const cl = clueAt(board, rd, c, r)
    if (!cl || resolvedKeys.has(cellKey(rd, c, r))) return
    setActive({ rd, c, r })
    setTyped('')
    setWagerText('')
    setLast(null)
    if (cl.ddWager != null) {
      playDailyDoubleSound()
      setStage('wager')
    } else {
      playSelectSound()
      setStake(cl.value)
      setStage('clue')
    }
  }

  function confirmWager() {
    if (!active || !board) return
    const top = board.rounds[active.rd - 1].values.slice(-1)[0]
    setStake(clampDailyDoubleWager(parseInt(wagerRef.current, 10), myScore, top))
    playSelectSound()
    setStage('clue')
  }

  function resolveClue(kind: 'answer' | 'pass') {
    if (!active || !board) return
    const cl = clueAt(board, active.rd, active.c, active.r)
    if (!cl) return
    const text = typedRef.current
    let outcome: Outcome
    if (kind === 'answer') outcome = checkAnswer(text, cl.answer) ? 'correct' : 'wrong'
    // Nobody passes on a Daily Double: you found it, you answer it.
    else outcome = cl.ddWager != null ? 'wrong' : 'pass'
    const delta = outcome === 'correct' ? stake : outcome === 'wrong' ? -stake : 0
    const res: Resolved = { outcome, delta, typed: kind === 'answer' ? text : '' }
    if (kind === 'answer') {
      playBuzzSound()
      setTimeout(outcome === 'correct' ? playCorrectSound : playWrongSound, 220)
    } else {
      playTimeUpSound()
    }
    setLast(res)
    setResolved((prev) => ({ ...prev, [cellKey(active.rd, active.c, active.r)]: res }))
    setStage('result')
  }

  function closeClue() {
    if (!active) return
    const rd = active.rd
    setActive(null)
    if (rd === 1 && roundDone(1)) setPhase('curtain')
    else if (rd === 2 && roundDone(2)) { setPhase('final'); setFjStage('category') }
  }

  function confirmFjWager() {
    setStake(clampFinalWager(parseInt(wagerRef.current, 10), myScore))
    setTyped('')
    playSelectSound()
    setFjStage('clue')
  }

  function resolveFinal() {
    if (!episode?.final) return
    const text = typedRef.current
    const right = text.trim().length > 0 && checkAnswer(text, episode.final.answer)
    if (right) playCorrectSound()
    else if (text.trim()) playWrongSound()
    else playTimeUpSound()
    setFjResult({ right, delta: right ? stake : -stake, typed: text })
    setFjStage('result')
  }

  async function settleNight() {
    if (!episode || !run || !picked) return
    // Decided: nothing left to come back to.
    clearNightSave()
    setSaved(null)
    const theirs = episode.contestants.map((c, i) => ({ name: c.first, score: theirScores[i] ?? 0 }))
    const best = Math.max(...theirs.map((t) => t.score))
    const won = myScore >= best
    const result: NightResult = {
      gameId: episode.gameId, title: episode.title, airedOn: episode.airedOn, size, myScore, theirs, won,
    }
    const updated: Run = {
      ...run,
      streak: won ? run.streak + 1 : run.streak,
      totalWinnings: run.totalWinnings + Math.max(0, myScore),
      history: [...run.history, result],
      endedAt: won ? null : new Date().toISOString(),
    }
    setNight(result)
    if (won) {
      const nxt = await nextEpisode(episode.gameId, run.series)
      if (nxt) { updated.currentGameId = nxt.gameId; setNextInfo(nxt) }
      else { updated.endedAt = new Date().toISOString(); setNextInfo('none') }
    }
    setRun(updated)
    saveRun(updated)
    setBest(noteBest(updated, profile.name))
    void recordNight(updated, profile, getChallengeIdentity(user?.id), result)
    setPhase('night')
  }

  async function comeBackTomorrow() {
    if (!nextInfo || nextInfo === 'none') return
    setPicked(nextInfo)
    await loadNight(nextInfo)
  }

  /* ── Screens ─────────────────────────────────────────────────────────── */

  const leaderIdx = theirScores.length
    ? theirScores.reduce((b, s, i) => (s > theirScores[b] ? i : b), 0)
    : -1

  // "2012 Tournament of Champions · quarterfinal game 1", or nothing for regular play.
  const nightTag = picked?.series ? `${picked.series}${picked.stage ? ` · ${picked.stage}` : ''}` : null

  const Rail = () => episode ? (
    <div className="mx-auto mt-4 flex max-w-3xl flex-wrap items-stretch justify-center gap-2">
      <Podium name={profile.name || 'You'} score={myScore} you />
      {episode.contestants.map((c, i) => (
        <Podium key={c.seat} name={c.first} score={theirScores[i] ?? 0} seat={c.seat} crowned={i === leaderIdx && theirScores[i] > myScore} />
      ))}
    </div>
  ) : null

  // ── Welcome ────────────────────────────────────────────────────────────
  if (phase === 'welcome') {
    const live = run && !run.endedAt
    return (
      <Shell>
        <Eyebrow>Campaign · Against real contestants</Eyebrow>
        <h1 className="display-chrome mt-2 text-4xl md:text-5xl">Against Real Contestants</h1>
        <p className="mx-auto mt-4 max-w-md text-sm text-ink-stage">
          Take the fourth podium on a real night of Jeopardy!. The three people who played it score exactly as
          they did — clue by clue, beside you. Win and you&apos;re back tomorrow against the next episode. The
          run ends when you lose. How far into the season can you get?
        </p>
        {live && (
          <div className="mx-auto mt-6 max-w-sm rounded-xl border border-copper/50 bg-black/40 p-4 text-left">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-copper">Your run</p>
            <p className="mt-1 text-white">
              <span className="font-bold">{profile.name}</span> from {profile.hometown} ·{' '}
              <span className="font-bold text-jeopardy-gold-light">{run!.streak}</span> night{run!.streak === 1 ? '' : 's'} won ·{' '}
              {money(run!.totalWinnings)}{run!.chasing ? <> · chasing {run!.chasing.name}&apos;s {run!.chasing.games}</> : null}
            </p>
            {saved && saved.gameId === run!.currentGameId ? (
              <>
                <p className="mt-2 text-[11px] text-ink-stage-2">
                  Tonight&apos;s game is paused — {Object.keys(saved.resolved).length} clue{Object.keys(saved.resolved).length === 1 ? '' : 's'} played
                  {saved.at === 'final' ? ', at Final Jeopardy' : saved.at === 'curtain' ? ', Double Jeopardy next' : ''}.
                </p>
                <button onClick={resumeRun} className="btn-stage btn-copper btn-stage-lg mt-3 w-full">
                  Pick it back up →
                </button>
              </>
            ) : (
              <button onClick={resumeRun} className="btn-stage btn-copper btn-stage-lg mt-3 w-full">
                Come back tomorrow →
              </button>
            )}
          </div>
        )}
        {run?.endedAt && (
          <p className="mt-5 text-sm text-ink-stage-2">
            Last run: {run.streak} night{run.streak === 1 ? '' : 's'} won, {money(run.totalWinnings)}.
          </p>
        )}
        <button onClick={beginNew} className={`mt-6 ${live ? 'btn-stage btn-stage-ghost' : 'btn-stage btn-copper btn-stage-lg'}`}>
          {live ? 'Start over' : 'Start a campaign'}
        </button>
        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
        <StreakTable best={best} />
        <BackHome />
      </Shell>
    )
  }

  // ── Profile ────────────────────────────────────────────────────────────
  if (phase === 'profile') {
    return (
      <Shell leave={{ label: 'Exit', onClick: () => setPhase('welcome') }}>
        <Eyebrow>Contestant registration</Eyebrow>
        <h2 className="display-chrome mt-2 text-3xl">Who&apos;s playing?</h2>
        <p className="mt-2 text-sm text-ink-stage">The way it&apos;s read out at the top of every show.</p>
        <div className="mx-auto mt-6 max-w-sm space-y-3 text-left">
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-stage-2">Your name</span>
            <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              maxLength={40} placeholder="Michael" className="field-stage mt-1 w-full" autoFocus />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-stage-2">Where you&apos;re from</span>
            <input value={profile.hometown} onChange={(e) => setProfile({ ...profile, hometown: e.target.value })}
              maxLength={60} placeholder="Philadelphia, Pennsylvania" className="field-stage mt-1 w-full" />
          </label>
          {/* The host's question, asked here so it's on the card when you
              walk out. It stays editable in the green room. */}
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-stage-2">
              &ldquo;Tell us a little about yourself&rdquo;
            </span>
            <textarea value={profile.anecdote} onChange={(e) => setProfile({ ...profile, anecdote: e.target.value })}
              maxLength={280} rows={2} placeholder="I once biked from Cartagena to Buenos Aires…"
              className="field-stage mt-1 h-auto w-full resize-none py-2 text-sm" />
          </label>
          <p className="pt-2 text-center text-sm italic text-white/80">
            &ldquo;{profile.name || 'Your name'}, from {profile.hometown || 'your hometown'}.&rdquo;
          </p>
          <button
            onClick={() => { saveProfile(profile); setPhase('pick') }}
            disabled={!profile.name.trim() || !profile.hometown.trim()}
            className="btn-stage btn-copper btn-stage-lg w-full disabled:opacity-40"
          >
            Continue
          </button>
        </div>
        <BackHome />
      </Shell>
    )
  }

  // ── Pick a starting night ──────────────────────────────────────────────
  if (phase === 'pick') {
    return (
      <Shell wide leave={{ label: 'Exit', onClick: () => setPhase('welcome') }}>
        <Eyebrow>Where does your run begin?</Eyebrow>
        <h2 className="display-chrome mt-2 text-3xl">Pick a night</h2>
        <p className="mt-2 text-sm text-ink-stage">
          Any episode, any year — you play forward through that season, one night at a time.
          Or start on the night a famous run began and try to match it.
        </p>

        <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.28em] text-copper">Any night</p>
        <div className="mx-auto mt-2 flex max-w-lg items-center justify-center gap-3">
          <select value={year} onChange={(e) => loadYear(parseInt(e.target.value, 10))} className="field-stage h-[42px] cursor-pointer py-0">
            {YEARS.map((y) => <option key={y} value={y} className="bg-gray-900">{y}</option>)}
          </select>
          {episodes === null && <button onClick={() => loadYear(year)} className="btn-stage btn-copper">Show that year</button>}
        </div>
        {episodes && (
          <div className="mx-auto mt-4 max-h-[50vh] max-w-lg space-y-1 overflow-y-auto rounded-md border border-white/10 bg-black/40 p-2 text-left">
            {episodes.length === 0 && <p className="p-4 text-center text-sm text-ink-stage-2">Nothing from that year.</p>}
            {episodes.map((e) => (
              <button key={e.gameId} onClick={() => { setPicked(e); setChasing(null); setSeries(e.series) }}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-sm transition-colors ${
                  picked?.gameId === e.gameId ? 'bg-copper/25 text-white' : 'text-white/80 hover:bg-white/5'
                }`}>
                <span className="truncate">{e.title}</span>
                <span className={`ml-3 shrink-0 truncate text-[10px] uppercase tracking-wider ${e.series ? 'max-w-[45%] text-copper' : 'text-ink-stage-2'}`}>
                  {e.series ? `${e.series}${e.stage ? ` · ${e.stage}` : ''}` : `S${e.season}`}
                </span>
              </button>
            ))}
          </div>
        )}
        {/* The tournaments: the champions, the college kids, the teens, the
            teachers. Start at game one and play the event through. */}
        <div className="mx-auto mt-7 max-w-2xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-copper">Or a tournament</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {TOURNAMENT_KINDS.map((k) => (
              <button
                key={k.id}
                onClick={async () => {
                  if (tKind === k.id) { setTKind(null); setTournaments(null); return }
                  setTKind(k.id)
                  setTournaments(null)
                  setTournaments(await tournamentsOf(k.match))
                }}
                className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                  tKind === k.id ? 'border-jeopardy-gold bg-jeopardy-gold/15 text-white' : 'border-white/10 bg-black/40 text-white/80 hover:border-copper/60'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
          {tKind && (
            <div className="mt-2 max-h-[40vh] space-y-1 overflow-y-auto rounded-md border border-white/10 bg-black/40 p-2 text-left">
              {tournaments === null && <p className="p-4 text-center text-sm text-ink-stage-2">Looking them up…</p>}
              {tournaments?.length === 0 && <p className="p-4 text-center text-sm text-ink-stage-2">None in the archive.</p>}
              {tournaments?.map((t) => (
                <button
                  key={t.series}
                  onClick={() => { setPicked(t.games[0]); setSeries(t.series); setChasing(null) }}
                  className={`flex w-full items-center justify-between rounded px-3 py-2 text-sm transition-colors ${
                    series === t.series && picked?.gameId === t.games[0]?.gameId ? 'bg-copper/25 text-white' : 'text-white/80 hover:bg-white/5'
                  }`}
                >
                  <span className="truncate">{t.series}</span>
                  <span className="ml-3 shrink-0 text-[11px] uppercase tracking-wider text-ink-stage-2">
                    {t.games.length} game{t.games.length === 1 ? '' : 's'}{t.games[0]?.stage ? ` · from ${t.games[0].stage}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* The longest runs in the show's history, each a starting line:
            you begin on the same night they did, against the same three. */}
        <div className="mx-auto mt-7 max-w-2xl text-left">
          <p className="text-center text-[10px] font-bold uppercase tracking-[0.28em] text-copper">Or chase a record</p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {REAL_STREAKS.map((r) => {
              const on = chasing?.name === r.name
              return (
                <button
                  key={r.name}
                  onClick={() => { setSeries(null); chase(r) }}
                  disabled={chaseBusy !== null}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                    on ? 'border-jeopardy-gold bg-jeopardy-gold/15' : 'border-white/10 bg-black/40 hover:border-copper/60'
                  } disabled:opacity-60`}
                >
                  <span className={`w-5 shrink-0 text-center text-[11px] font-black tabular-nums ${r.rank <= 3 ? 'text-jeopardy-gold-light' : 'text-white/40'}`}>
                    {r.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">{r.name}</span>
                    <span className="block text-[10px] text-ink-stage-2">
                      {chaseBusy === r.name ? 'Finding their first night…' : on && picked?.airDate ? `Starts ${longDate(picked.airDate)}` : `${r.when} · ${money(r.winnings)}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-base font-bold tabular-nums text-jeopardy-gold-light">{r.games}</span>
                    <span className="block text-[9px] uppercase leading-none text-ink-stage-2">to match</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={() => setPhase('welcome')} className="btn-stage btn-stage-ghost btn-stage-sm">Back</button>
          <button onClick={() => picked && loadNight(picked, true)} disabled={!picked} className="btn-stage btn-copper btn-stage-lg disabled:opacity-40">
            Fly out →
          </button>
        </div>
      </Shell>
    )
  }

  // ── The trip out ───────────────────────────────────────────────────────
  if (phase === 'journey') {
    return (
      <Journey
        name={profile.name}
        hometown={profile.hometown}
        dateLine={picked?.airDate ? longDate(picked.airDate) : picked?.title ?? ''}
        onDone={() => setPhase('meet')}
      />
    )
  }

  // ── Meet the contestants ───────────────────────────────────────────────
  if (phase === 'meet') {
    if (!episode) {
      return <Shell><p className="py-20 text-ink-stage-2">Walking out to the podiums…</p></Shell>
    }
    return (
      <Shell wide leave={{ label: 'Exit', onClick: () => setPhase('welcome') }}>
        <Eyebrow>{nightTag ? `${nightTag} · ` : ''}{episode.airedOn ?? episode.title}{run && run.streak > 0 ? ` · Night ${run.streak + 1} of your run` : ''}</Eyebrow>
        <h2 className="display-chrome mt-2 text-3xl md:text-4xl">Tonight&apos;s contestants</h2>
        <p className="mt-2 text-sm text-ink-stage">The three people who really played this board — and you.</p>

        <div className="mx-auto mt-6 grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {episode.contestants.map((c) => <ContestantCard key={c.seat} c={c} />)}
          <div className="rounded-xl border-2 border-jeopardy-gold/70 bg-jeopardy-gold/10 p-4 text-left">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-jeopardy-gold bg-black/40 text-4xl font-black text-jeopardy-gold-light">
              {(profile.name || '?').slice(0, 1).toUpperCase()}
            </div>
            <p className="mt-3 font-bold text-white">{profile.name}</p>
            <p className="text-xs text-white/80">from {profile.hometown}</p>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-jeopardy-gold-light">The challenger</p>
          </div>
        </div>

        {/* The host's question, read back. Answered at registration; still
            yours to change any night. */}
        <div className="mx-auto mt-6 max-w-lg rounded-xl border border-white/15 bg-black/40 p-4 text-left">
          <p className="text-sm italic text-white/90">
            &ldquo;{profile.name}, tell us a little about yourself.&rdquo;
          </p>
          <textarea
            value={profile.anecdote}
            onChange={(e) => setProfile({ ...profile, anecdote: e.target.value })}
            maxLength={280}
            rows={2}
            placeholder="Something the host can read out…"
            className="field-stage mt-2 h-auto w-full resize-none py-2 text-sm"
          />
        </div>

        <div className="mx-auto mt-5 max-w-lg text-left">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-stage-2">Board size tonight</p>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {SIZES.map((s) => (
              <button key={s.id} onClick={() => setSize(s.id)}
                className={`rounded-lg border-2 px-2 py-2 text-left transition-colors ${
                  size === s.id ? 'border-jeopardy-gold bg-jeopardy-gold/20 text-white' : 'border-white/15 bg-white/5 text-white/70 hover:border-white/40'
                }`}>
                <span className="block text-sm font-bold">{s.label}</span>
                <span className="block text-[10px] leading-tight opacity-70">{s.desc}</span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-stage-2">
            A smaller board is a slice of the real one, and they&apos;re scored on that same slice — it stays a fair race.
          </p>
        </div>

        <button onClick={takeThePodium} className="btn-stage btn-copper btn-stage-lg mt-6">
          Everyone starts at zero. Let&apos;s play →
        </button>
      </Shell>
    )
  }

  // ── The curtain between rounds ─────────────────────────────────────────
  if (phase === 'curtain' && episode) {
    return (
      <Shell leave={{ label: 'Pause & leave', onClick: pause }}>
        <Rail />
        <div className="mt-8 rounded-xl border-2 border-jeopardy-gold bg-jeopardy-gold/10 p-8">
          <Eyebrow>That&apos;s the Jeopardy round</Eyebrow>
          <h2 className="display-chrome mt-4 text-3xl">Double Jeopardy</h2>
          <p className="mt-2 text-sm text-ink-stage-2">Values double, and there are Daily Doubles out there.</p>
          <button onClick={() => { setRound(2); setPhase('playing') }} className="btn-stage btn-copper btn-stage-lg mt-6">
            Bring on the board
          </button>
        </div>
      </Shell>
    )
  }

  // ── The board ──────────────────────────────────────────────────────────
  if (phase === 'playing' && episode && board) {
    const rd = round
    const cats = board.rounds[rd - 1].categories
    const values = board.rounds[rd - 1].values
    const cols = board.cfg.categories
    const left = roundClues(rd).filter((cl) => !resolvedKeys.has(cellKey(rd, cl.c, cl.r))).length
    const activeClue = active ? clueAt(board, active.rd, active.c, active.r) : undefined
    return (
      <Shell wide leave={{ label: 'Pause & leave', onClick: pause }}>
        <Eyebrow>{nightTag ? `${nightTag} · ` : ''}{episode.airedOn ?? episode.title} · {rd === 1 ? 'Jeopardy round' : 'Double Jeopardy'}</Eyebrow>
        <Rail />
        <div className="board-wrapper mx-auto mt-4 max-w-5xl">
          <div className="grid gap-1 p-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {cats.map((name, c) => (
              <div key={c} className="board-category min-h-[56px] px-1.5 py-2 text-[10px] font-bold uppercase leading-tight text-white md:text-xs">
                {name}
              </div>
            ))}
            {values.map((v, r) =>
              cats.map((_, c) => {
                const cl = clueAt(board, rd, c, r)
                const res = resolved[cellKey(rd, c, r)]
                const dead = !cl
                return (
                  <button
                    key={`${c}:${r}`}
                    onClick={() => openClue(rd, c, r)}
                    disabled={dead || !!res}
                    title={dead ? 'Never revealed that night' : undefined}
                    className={`min-h-[56px] text-xl md:min-h-[72px] md:text-3xl ${
                      dead ? 'board-cell board-cell-answered'
                      : res ? (res.outcome === 'correct' ? 'board-cell board-cell-correct' : res.outcome === 'wrong' ? 'board-cell board-cell-wrong' : 'board-cell board-cell-answered')
                      : 'board-cell'
                    }`}
                    style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}
                  >
                    {dead ? '' : res ? (res.outcome === 'correct' ? '✓' : res.outcome === 'wrong' ? '✗' : '') : `$${v}`}
                  </button>
                )
              }),
            )}
          </div>
        </div>
        <p className="mt-3 text-[11px] text-ink-stage-2">
          {left} clue{left === 1 ? '' : 's'} left{rd === 1 ? ', then Double Jeopardy' : ', then Final Jeopardy'}.
        </p>

        {active && activeClue && (
          <Overlay onPause={pause}>
            {stage === 'wager' && (
              <>
                <Big>Daily Double!</Big>
                <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.28em] text-white/80">{cats[active.c]}</p>
                <p className="mt-3 text-sm text-white/85">
                  You have <b className="text-jeopardy-gold-light">{money(myScore)}</b>. Wager $5 up to{' '}
                  <b className="text-jeopardy-gold-light">{money(maxDailyDoubleWager(myScore, values.slice(-1)[0]))}</b>.
                </p>
                <input value={wagerText} onChange={(e) => setWagerText(e.target.value.replace(/[^0-9]/g, ''))}
                  inputMode="numeric" placeholder="Wager" autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') confirmWager() }}
                  className="input-base mx-auto mt-4 max-w-xs text-center text-2xl" />
                <div className="mx-auto mt-3 flex max-w-xs gap-2">
                  <button onClick={() => setWagerText(String(maxDailyDoubleWager(myScore, values.slice(-1)[0])))} className="btn-stage btn-stage-ghost btn-stage-sm flex-1">Bet the max</button>
                  <button onClick={confirmWager} className="btn-primary flex-1 py-2">Show the clue</button>
                </div>
              </>
            )}
            {stage === 'clue' && (
              <>
                <AnimatedClueReveal
                  key={cellKey(active.rd, active.c, active.r)}
                  category={cats[active.c]}
                  value={stake}
                  question={activeClue.question}
                  revealDurationMs={computeReadingMs(activeClue.question)}
                  variant={variant}
                  year={airedYear}
                />
                {revealed ? (
                  <>
                    <Timer secondsLeft={secondsLeft} total={CLUE_SECONDS} />
                    <div className="mx-auto mt-4 w-full max-w-md">
                      <GameKeyboard value={typed} onChange={setTyped} onSubmit={() => resolveClue('answer')}
                        mode="letters" placeholder="What is…" submitLabel="Answer" submitDisabled={!typed.trim()} maxLength={120}
                        secondaryAction={activeClue.ddWager == null ? { label: "Don't ring in", onClick: () => resolveClue('pass') } : undefined} />
                    </div>
                  </>
                ) : (
                  <p className="mt-8 text-xs uppercase tracking-[0.3em] text-white/50">Reading…</p>
                )}
              </>
            )}
            {stage === 'result' && last && (
              <>
                <p className={`text-3xl font-bold ${last.outcome === 'correct' ? 'text-green-400' : last.outcome === 'wrong' ? 'text-red-400' : 'text-white/70'}`}>
                  {last.outcome === 'correct' ? `✓ Right, ${money(last.delta)}` : last.outcome === 'wrong' ? `✗ Wrong, ${money(last.delta)}` : "Didn't ring in"}
                </p>
                <p className="mt-2 text-sm text-white/70">The answer: <b className="text-jeopardy-gold-light">{activeClue.answer}</b></p>

                {/* The night as it happened. */}
                <div className="mx-auto mt-6 max-w-md rounded-xl border border-copper/50 bg-black/40 p-4 text-left">
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-copper">★ That night</p>
                  {whoAnswered(activeClue, episode.contestants).length === 0 ? (
                    <p className="mt-2 text-sm text-white/80">Triple stumper — nobody rang in.</p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {whoAnswered(activeClue, episode.contestants).map(({ who, right }, i) => {
                        const amt = activeClue.ddWager != null
                          ? contestantDdWager(
                              episode, board, who, activeClue, active!.rd,
                              contestantScore(episode, board, who, resolvedKeys, size === 'full', cellKey(active!.rd, active!.c, active!.r)),
                              size === 'full',
                            )
                          : activeClue.value
                        return (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <img src={`/avatars/${who.seat + 1}.png`} alt="" className="h-8 w-8 rounded-full bg-black object-cover" />
                            <span className="flex-1 text-white">{who.first}</span>
                            <span className={right ? 'text-green-400' : 'text-red-400'}>
                              {right ? '✓' : '✗'} {right ? '+' : '-'}{money(amt).replace('-', '')}
                              {activeClue.ddWager != null && <span className="ml-1 text-[10px] text-white/60">Daily Double</span>}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                <button onClick={closeClue} autoFocus className="btn-primary mt-6 px-8 py-3">Back to the board</button>
              </>
            )}
          </Overlay>
        )}
      </Shell>
    )
  }

  // ── Final Jeopardy ─────────────────────────────────────────────────────
  if (phase === 'final' && episode && board) {
    const fj = episode.final
    if (!fj) {
      // The archive has no Final for this night — settle on the board.
      return (
        <Shell leave={{ label: 'Pause & leave', onClick: pause }}>
          <Rail />
          <p className="mt-6 text-sm text-ink-stage-2">The archive has no Final Jeopardy recorded for this night, so the board decides it.</p>
          <button onClick={settleNight} className="btn-stage btn-copper btn-stage-lg mt-4">See the result</button>
        </Shell>
      )
    }
    return (
      <Shell wide>
        <Rail />
        <Overlay onPause={pause}>
          {fjStage === 'category' && (
            <>
              <Big>Final Jeopardy!</Big>
              <p className="mt-3 text-sm text-white/70">The category is</p>
              <p className="mt-2 text-2xl font-bold uppercase text-white">{fj.category}</p>
              <button onClick={() => { setWagerText(''); setFjStage('wager') }} autoFocus className="btn-primary mt-6 px-8 py-3">Place my wager</button>
            </>
          )}
          {fjStage === 'wager' && (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/80">{fj.category}</p>
              <p className="mt-3 text-sm text-white/85">
                You have <b className="text-jeopardy-gold-light">{money(myScore)}</b>. Wager $0 up to <b className="text-jeopardy-gold-light">{money(maxFinalWager(myScore))}</b>.
              </p>
              <div className="mx-auto mt-3 max-w-xs space-y-1 text-left text-sm">
                {episode.contestants.map((c, i) => (
                  <div key={c.seat} className="flex justify-between text-white/80"><span>{c.first}</span><span className="tabular-nums">{money(theirScores[i] ?? 0)}</span></div>
                ))}
              </div>
              <input value={wagerText} onChange={(e) => setWagerText(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric" placeholder="Wager" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') confirmFjWager() }}
                className="input-base mx-auto mt-4 max-w-xs text-center text-2xl" />
              <button onClick={confirmFjWager} className="btn-primary mt-3 px-8 py-3">Lock it in</button>
            </>
          )}
          {fjStage === 'clue' && (
            <>
              <AnimatedClueReveal
                key="final"
                category={fj.category}
                value={stake}
                question={fj.question}
                revealDurationMs={computeReadingMs(fj.question)}
                variant={variant}
                year={airedYear}
              />
              {revealed ? (
                <>
                  <Timer secondsLeft={secondsLeft} total={FINAL_SECONDS} />
                  <div className="mx-auto mt-4 w-full max-w-md">
                    <GameKeyboard value={typed} onChange={setTyped} onSubmit={resolveFinal}
                      mode="letters" placeholder="What is…" submitLabel="Reveal" submitDisabled={false} maxLength={120} />
                  </div>
                </>
              ) : (
                <p className="mt-8 text-xs uppercase tracking-[0.3em] text-white/50">Reading…</p>
              )}
            </>
          )}
          {fjStage === 'result' && fjResult && (
            <>
              <p className="text-sm text-white/70">The answer: <b className="text-jeopardy-gold-light">{fj.answer}</b></p>
              <div className="mx-auto mt-5 max-w-md space-y-2 text-left">
                <FinalRow name={`${profile.name} (you)`} written={fjResult.typed || '—'} right={fjResult.right} wager={stake} total={myScore} you />
                {episode.contestants.map((c, i) => {
                  const before = contestantScore(episode, board, c, resolvedKeys, size === 'full')
                  const f = contestantFinal(episode, c, before, size === 'full')
                  return f
                    ? <FinalRow key={c.seat} name={c.first} seat={c.seat} written={f.written} right={f.right} wager={f.wager} total={theirScores[i] ?? 0} />
                    : <FinalRow key={c.seat} name={c.first} seat={c.seat} written="(no Final recorded)" right={false} wager={0} total={theirScores[i] ?? 0} />
                })}
              </div>
              <button onClick={settleNight} autoFocus className="btn-primary mt-6 px-8 py-3">Final scores</button>
            </>
          )}
        </Overlay>
      </Shell>
    )
  }

  // ── The night's result ─────────────────────────────────────────────────
  if (phase === 'night' && night && run) {
    const rows = [{ name: `${profile.name} (you)`, score: night.myScore, you: true }, ...night.theirs.map((t) => ({ ...t, you: false }))]
      .sort((a, b) => b.score - a.score)
    return (
      <Shell leave={{ label: 'Leave', onClick: () => setPhase('welcome') }}>
        <Eyebrow>{run.series ? `${run.series} · ` : ''}{night.airedOn ?? night.title}</Eyebrow>
        <h2 className={`display-chrome mt-2 text-4xl ${night.won ? 'text-jeopardy-gold-light' : ''}`}>
          {night.won ? "You're our new champion!" : 'The champion holds'}
        </h2>
        <div className="mx-auto mt-5 max-w-sm space-y-2">
          {rows.map((r, i) => (
            <div key={r.name} className={`flex items-center justify-between rounded-xl px-4 py-3 ${r.you ? 'border-2 border-jeopardy-gold bg-jeopardy-gold/15' : 'border border-white/10 bg-white/5'}`}>
              <span className="font-bold text-white">{i === 0 ? '🏆 ' : ''}{r.name}</span>
              <span className={`text-lg font-bold tabular-nums ${r.score < 0 ? 'text-red-400' : 'text-jeopardy-gold-light'}`}>{money(r.score)}</span>
            </div>
          ))}
        </div>
        <p className="mt-5 text-sm text-ink-stage">
          {night.won
            ? <>Night <b className="text-white">{run.streak}</b>{run.chasing ? <> of <b className="text-white">{run.chasing.games}</b> — {run.chasing.name}&apos;s run</> : ' of your run'}. Winnings so far: <b className="text-white">{money(run.totalWinnings)}</b>.</>
            : <>Your run ends at <b className="text-white">{run.streak}</b> night{run.streak === 1 ? '' : 's'} won and <b className="text-white">{money(run.totalWinnings)}</b>{run.chasing ? <>. {run.chasing.name} won {run.chasing.games}.</> : '.'}</>}
        </p>
        {night.won && run.chasing && run.streak >= run.chasing.games && (
          <p className="mt-3 text-lg font-bold text-jeopardy-gold-light">
            You&apos;ve matched {run.chasing.name}. Everything from here is yours alone.
          </p>
        )}
        {night.won && nextInfo && nextInfo !== 'none' && (
          <button onClick={comeBackTomorrow} className="btn-stage btn-copper btn-stage-lg mt-6">
            {run.series ? 'Next game' : 'Come back tomorrow'} → {nextInfo.stage ?? nextInfo.airDate ?? nextInfo.title}
          </button>
        )}
        {night.won && nextInfo === 'none' && (
          <p className="mt-6 text-lg font-bold text-jeopardy-gold-light">{run.series ? `That was the last game of the ${run.series}. You ran the table.` : "That's every night in the archive. You ran it."}</p>
        )}
        {(!night.won || nextInfo === 'none') && (
          <button onClick={() => setPhase('over')} className="btn-stage btn-stage-ghost mt-4">See the whole run</button>
        )}
        <div className="mt-6 flex justify-center">
          <FeedbackPrompt mode="campaign" playerName={profile.name} />
        </div>
      </Shell>
    )
  }

  // ── Run over ───────────────────────────────────────────────────────────
  if (phase === 'over' && run) {
    return (
      <Shell wide>
        <Eyebrow>Your campaign</Eyebrow>
        <h2 className="display-chrome mt-2 text-3xl">{run.streak} night{run.streak === 1 ? '' : 's'} · {money(run.totalWinnings)}</h2>
        {run.chasing && (
          <p className="mt-1 text-sm text-ink-stage-2">
            Chasing {run.chasing.name}&apos;s {run.chasing.games} — {run.streak >= run.chasing.games ? 'matched.' : `${run.chasing.games - run.streak} short.`}
          </p>
        )}
        <div className="mx-auto mt-5 max-w-lg space-y-1.5 text-left">
          {run.history.map((h, i) => (
            <div key={h.gameId} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm">
              <span className="text-white/80">{i + 1}. {h.airedOn ?? h.title}</span>
              <span className={`font-bold tabular-nums ${h.won ? 'text-green-400' : 'text-red-400'}`}>{h.won ? 'Won' : 'Lost'} · {money(h.myScore)}</span>
            </div>
          ))}
        </div>
        <button onClick={beginNew} className="btn-stage btn-copper btn-stage-lg mt-6">Start a new campaign</button>
        <StreakTable best={best} />
        <BackHome />
      </Shell>
    )
  }

  return <Shell><p className="py-20 text-ink-stage-2">Loading…</p></Shell>
}

/* ── Building blocks ──────────────────────────────────────────────────── */

function Shell({ children, wide, leave }: {
  children: React.ReactNode
  wide?: boolean
  /** A way out, top right: "Exit" before the game, "Pause & leave" during it. */
  leave?: { label: string; onClick: () => void }
}) {
  return (
    <main className="stage-page-deep p-4 pb-24 md:p-8">
      <div className={`mx-auto ${wide ? 'max-w-6xl' : 'max-w-2xl'}`}>
        <div className="frame">
          <span className="led-strip led-strip-left" /><span className="led-strip led-strip-right" />
          <div className="frame-inner relative p-5 text-center md:p-9">
            {leave && (
              <button
                onClick={leave.onClick}
                className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/60 transition-colors hover:border-copper/60 hover:text-white md:right-4 md:top-4"
              >
                {leave.label}
              </button>
            )}
            <ChromeWordmark className="mx-auto mb-4 h-auto w-full max-w-[160px]" />
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}
const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-copper">{children}</p>
)
const Big = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-4xl font-bold uppercase tracking-wide text-jeopardy-gold-light md:text-5xl" style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '3px 3px 6px rgba(0,0,0,0.7)' }}>{children}</h2>
)
const BackHome = () => <p className="mt-8"><a href="/" className="text-[10px] uppercase tracking-[0.22em] text-ink-stage-2 hover:text-copper">← Home</a></p>

function Overlay({ children, onPause }: { children: React.ReactNode; onPause?: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-[#030845] px-5 py-8">
      {onPause && (
        <button
          onClick={onPause}
          className="fixed right-4 top-4 z-[60] rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/60 transition-colors hover:border-copper/60 hover:text-white"
        >
          Pause
        </button>
      )}
      <div className="w-full max-w-2xl text-center">{children}</div>
    </div>
  )
}
function Timer({ secondsLeft, total }: { secondsLeft: number; total: number }) {
  return (
    <>
      <div className="mx-auto mt-6 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-black/40">
        <div className={`h-full rounded-full transition-all duration-300 ${secondsLeft <= 5 ? 'bg-red-500' : 'bg-jeopardy-gold-light'}`} style={{ width: `${(secondsLeft / total) * 100}%` }} />
      </div>
      <p className={`mt-1 text-xs tabular-nums ${secondsLeft <= 5 ? 'text-red-300' : 'text-white/60'}`}>{secondsLeft}s</p>
    </>
  )
}
function Podium({ name, score, you, seat, crowned }: { name: string; score: number; you?: boolean; seat?: number; crowned?: boolean }) {
  return (
    <div className={`flex min-w-[120px] items-center gap-2 rounded-lg border px-3 py-2 ${you ? 'border-jeopardy-gold bg-jeopardy-gold/15' : 'border-copper/40 bg-black/40'}`}>
      {seat != null
        ? <img src={`/avatars/${seat + 1}.png`} alt="" className="h-9 w-9 rounded-full bg-black object-cover" />
        : <span className="flex h-9 w-9 items-center justify-center rounded-full border border-jeopardy-gold text-sm font-black text-jeopardy-gold-light">{name.slice(0, 1).toUpperCase()}</span>}
      <div className="min-w-0 text-left">
        <p className="truncate text-[11px] font-bold uppercase tracking-wider text-white/80">{crowned ? '👑 ' : ''}{name}</p>
        <p className={`text-lg font-bold tabular-nums ${score < 0 ? 'text-red-400' : 'text-jeopardy-gold-light'}`}>{money(score)}</p>
      </div>
    </div>
  )
}
function ContestantCard({ c }: { c: EpisodeContestant }) {
  return (
    <div className="rounded-xl border border-copper/50 bg-black/40 p-4 text-left">
      <img src={`/avatars/${c.seat + 1}.png`} alt="" className="h-24 w-24 rounded-full bg-black object-cover" />
      <p className="mt-3 font-bold text-white">{c.name}</p>
      <p className="text-xs text-white/80">{c.occupation ? `${/^[aeiou]/i.test(c.occupation) ? 'an' : 'a'} ${c.occupation}` : ''}{c.hometown ? ` from ${c.hometown}` : ''}</p>
      {c.note && <p className="mt-1 text-[10px] uppercase tracking-wider text-jeopardy-gold-light">🏆 {c.note.replace(/^whose\s+/i, '')}</p>}
    </div>
  )
}
function FinalRow({ name, seat, written, right, wager, total, you }: { name: string; seat?: number; written: string; right: boolean; wager: number; total: number; you?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${you ? 'border-jeopardy-gold bg-jeopardy-gold/15' : 'border-white/10 bg-black/40'}`}>
      {seat != null ? <img src={`/avatars/${seat + 1}.png`} alt="" className="h-9 w-9 rounded-full bg-black object-cover" /> : <span className="w-9" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-white">{name} <span className="ml-1 text-[10px] font-normal text-white/60">wagered {money(wager)}</span></p>
        <p className={`truncate text-xs ${right ? 'text-green-400' : 'text-red-400'}`}>{right ? '✓' : '✗'} &ldquo;{written}&rdquo;</p>
      </div>
      <span className={`shrink-0 text-lg font-bold tabular-nums ${total < 0 ? 'text-red-400' : 'text-jeopardy-gold-light'}`}>{money(total)}</span>
    </div>
  )
}

/**
 * The real record, with your best run placed on it. Every real streak is
 * regular play only — the number a campaign compares to. Your row is what a
 * run would rank if it were on the list, whether or not it makes the cut.
 */
function StreakTable({ best }: { best: BestRun | null }) {
  const mine = best && best.streak > 0 ? best : null
  const rank = mine ? rankAmongReal(mine.streak) : null
  return (
    <div className="mx-auto mt-10 max-w-md text-left">
      <p className="text-center text-[10px] font-bold uppercase tracking-[0.28em] text-copper">
        Longest runs in Jeopardy! history
      </p>
      <p className="mt-1 text-center text-[11px] text-ink-stage-2">
        Regular play, since the five-game limit came off in 2003.
      </p>
      <ol className="mt-3 divide-y divide-white/5 overflow-hidden rounded-xl border border-white/10 bg-black/40">
        {REAL_STREAKS.map((r) => (
          <li key={r.name}>
            {/* Your best slots in above the first real streak it beats. */}
            {mine && rank === r.rank && <MyStreakRow best={mine} rank={rank} />}
            <div className="flex items-center gap-3 px-3 py-2">
              <span className={`w-5 shrink-0 text-center text-[11px] font-black tabular-nums ${r.rank <= 3 ? 'text-jeopardy-gold-light' : 'text-white/40'}`}>
                {r.rank}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{r.name}</span>
                <span className="block text-[10px] text-ink-stage-2">{r.when} · {money(r.winnings)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-base font-bold tabular-nums text-jeopardy-gold-light">{r.games}</span>
                <span className="block text-[9px] uppercase leading-none text-ink-stage-2">games</span>
              </span>
            </div>
          </li>
        ))}
        {mine && rank !== null && rank > REAL_STREAKS.length && <li><MyStreakRow best={mine} rank={rank} /></li>}
        {!mine && (
          <li className="px-3 py-2.5 text-center text-[11px] text-ink-stage-2">
            Win a night and your run appears here, ranked against them.
          </li>
        )}
      </ol>
    </div>
  )
}

function MyStreakRow({ best, rank }: { best: BestRun; rank: number }) {
  return (
    <div className="flex items-center gap-3 border-y border-jeopardy-gold/50 bg-jeopardy-gold/15 px-3 py-2">
      <span className="w-5 shrink-0 text-center text-[11px] font-black tabular-nums text-jeopardy-gold-light">{rank}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">
          {best.name} <span className="text-[10px] uppercase text-jeopardy-gold-light">you</span>
        </span>
        <span className="block text-[10px] text-ink-stage-2">your best run · {money(best.winnings)}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-base font-bold tabular-nums text-jeopardy-gold-light">{best.streak}</span>
        <span className="block text-[9px] uppercase leading-none text-ink-stage-2">{best.streak === 1 ? 'night' : 'nights'}</span>
      </span>
    </div>
  )
}

/** "Friday, September 25, 2026" from an ISO date. */
function longDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

const SCENE_MS = [3400, 3800, 4200, 4200]

/**
 * Four scenes, each a few seconds, then the green room. Bags in the hometown,
 * the flight west, the studio doors, the stage. Skip is always there — the
 * second time through nobody needs the airport.
 */
function Journey({
  name, hometown, dateLine, onDone,
}: {
  name: string
  hometown: string
  dateLine: string
  onDone: () => void
}) {
  const [scene, setScene] = useState(0)
  useEffect(() => {
    if (scene >= SCENE_MS.length) { onDone(); return }
    const t = setTimeout(() => setScene((n) => n + 1), SCENE_MS[scene])
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  const initial = (name || '?').slice(0, 1).toUpperCase()
  const Caption = ({ kicker, line }: { kicker: string; line: string }) => (
    <div className="journey-rise absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-6 pb-8 pt-16 text-center">
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-copper">{kicker}</p>
      <p className="mt-1.5 text-xl font-bold text-white md:text-2xl">{line}</p>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#030845]">
      {/* Scene 1 — packed */}
      {scene === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="journey-rise text-[10px] font-bold uppercase tracking-[0.3em] text-copper">Taping day · {dateLine}</p>
          <div className="journey-walk mt-8 flex items-end gap-3">
            <div className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-jeopardy-gold bg-black/50 text-6xl font-black text-jeopardy-gold-light shadow-2xl">
              {initial}
            </div>
            <span className="mb-1 text-5xl" aria-hidden>🧳</span>
          </div>
          <Caption kicker={hometown || 'Home'} line={`${name}. Bags packed.`} />
        </div>
      )}

      {/* Scene 2 — the flight */}
      {scene === 1 && (
        <div className="absolute inset-0 bg-gradient-to-b from-[#1c3fbf] via-[#4f7fe6] to-[#dbe7ff]">
          <span className="journey-drift absolute left-[12%] top-[22%] text-6xl opacity-80" aria-hidden>☁️</span>
          <span className="journey-drift absolute left-[58%] top-[38%] text-7xl opacity-70 [animation-delay:-2s]" aria-hidden>☁️</span>
          <span className="journey-drift absolute left-[80%] top-[16%] text-5xl opacity-60 [animation-delay:-4s]" aria-hidden>☁️</span>
          <span className="journey-fly absolute text-6xl drop-shadow-xl" aria-hidden>✈️</span>
          <Caption kicker="Wheels up" line={`${hometown || 'Home'} → Los Angeles`} />
        </div>
      )}

      {/* Scene 3 — the studio */}
      {scene === 2 && (
        <div className="absolute inset-0">
          <img src="/studio-outside.jpg" alt="" className="journey-burns absolute inset-0 h-full w-full object-cover" />
          <Caption kicker="Culver City, California" line="Jeopardy! Studios. You're on the list." />
        </div>
      )}

      {/* Scene 4 — the stage */}
      {scene === 3 && (
        <div className="absolute inset-0">
          <img src="/studio-stage.jpg" alt="" className="journey-burns absolute inset-0 h-full w-full object-cover" />
          <div className="journey-flicker pointer-events-none absolute inset-0 bg-white" />
          <Caption kicker="Places, please" line="Podium four is yours." />
        </div>
      )}

      <button
        onClick={onDone}
        className="absolute right-3 top-3 z-10 rounded-full border border-white/25 bg-black/50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white/80 backdrop-blur hover:text-white"
      >
        Skip
      </button>
    </div>
  )
}
