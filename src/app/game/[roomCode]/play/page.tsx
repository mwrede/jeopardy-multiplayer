'use client'

import { useParams, useRouter } from 'next/navigation'
import { useGameChannel } from '@/hooks/useGameChannel'
import { GameBoard } from '@/components/GameBoard'
import { ClueText } from '@/components/ClueText'
import { BuzzerButton } from '@/components/BuzzerButton'
import { ClueAttempts } from '@/components/ClueAttempts'
import { BuzzOrder } from '@/components/BuzzOrder'
import { GameKeyboard } from '@/components/GameKeyboard'
import { CommunityVote } from '@/components/CommunityVote'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  setReady,
  startGame,
  startGameFromSource,
  startCustomGame,
  selectClue,
  submitAnswer,
  submitWager,
  submitBuzz,
  submitFinalWager,
  submitFinalAnswer,
  advanceFromRoundEnd,
  advanceFromClueResult,
  advanceToFinalWager,
  advanceToFinalClue,
  advanceToFinalAnswering,
  startFinalReveal,
  advanceToGameOver,
  skipClue,
  passOnClue,
  passAfterBuzz,
  removePlayer,
  rematchGame,
  joinGame,
  skipCurrentPlayer,
  openBuzzWindow,
} from '@/lib/game-api'
import { leaveCommunityLobby } from '@/lib/community'
import { GAME_LENGTH_CONFIG } from '@/types/game'
import { buzzOpenDelayMs } from '@/lib/clue-timing'
import {
  playCorrectSound, playWrongSound, playTimeUpSound,
  playDailyDoubleSound, playBuzzSound, playTickSound, playSelectSound,
} from '@/lib/sounds'

function JoinForm({ roomCode, onJoined }: { roomCode: string; onJoined: (playerId: string) => void }) {
  const [name, setName] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')

  async function handleJoin() {
    if (!name.trim()) { setJoinError('Enter your name'); return }
    setJoining(true)
    setJoinError('')
    try {
      const { player } = await joinGame(roomCode, name.trim())
      localStorage.setItem('playerId', player.id)
      localStorage.setItem('playerName', player.name)
      window.location.reload()
    } catch (e: any) {
      setJoinError(e.message || 'Failed to join')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-jeopardy-dark">
      <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-16 w-auto mb-4" />
      <p className="text-gray-400 text-lg mb-2">Room <span className="text-white font-mono font-bold tracking-widest">{roomCode}</span></p>
      <h2 className="text-xl font-bold text-white mb-6">Enter your name to join</h2>
      <div className="w-full max-w-sm space-y-3">
        <input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleJoin() }}
          maxLength={15}
          className="input-base text-lg"
          autoFocus
        />
        <button onClick={handleJoin} disabled={joining} className="btn-primary w-full py-4 text-lg">
          {joining ? 'Joining...' : 'Join Game'}
        </button>
      </div>
      {joinError && <p className="text-red-400 text-center text-sm mt-4">{joinError}</p>}
    </div>
  )
}

export default function PlayPage() {
  const params = useParams()
  const router = useRouter()
  const roomCode = params.roomCode as string
  const {
    game,
    players,
    categories,
    clues,
    myPlayer,
    myPlayerId,
    isMyTurn,
    connected,
    onlineIds,
    refreshState,
  } = useGameChannel(roomCode)

  const [answer, setAnswer] = useState('')
  const [wager, setWager] = useState('')
  const [finalWagerInput, setFinalWagerInput] = useState('')
  const [finalAnswerInput, setFinalAnswerInput] = useState('')
  const [finalCountdown, setFinalCountdown] = useState<number | null>(null)
  const finalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finalIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const finalAnswerInputRef = useRef<string>('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [finalWagerLocked, setFinalWagerLocked] = useState(false)
  const [finalAnswerLocked, setFinalAnswerLocked] = useState(false)
  const [hasPassed, setHasPassed] = useState(false)
  const [buzzCountdown, setBuzzCountdown] = useState<number | null>(null)
  const [buzzArmed, setBuzzArmed] = useState(false)
  // Per-clue: has THIS player already attempted? If so, hide their buzzer
  // when the window reopens for players who haven't tried yet.
  const [hasTriedAnswer, setHasTriedAnswer] = useState(false)
  const [answerCountdown, setAnswerCountdown] = useState<number | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [gameAirDate, setGameAirDate] = useState<string | null>(null)
  const [leavingGame, setLeavingGame] = useState(false)
  const [wagerCountdown, setWagerCountdown] = useState<number | null>(null)
  const wagerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wagerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const finalWagerInputRef = useRef<string>('')
  // Offer to skip the player holding up the game, but only after a pause —
  // long enough that someone simply thinking is never skipped out of turn.
  const [skipReady, setSkipReady] = useState(false)
  // Removing someone takes two taps. A native confirm() is easy to dismiss by
  // accident on a phone and can't be styled; arming the button in place is
  // clearer and just as hard to do by mistake.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  /**
   * Walk away from a community game mid-play. The others keep the board, their
   * scores and every clue already answered — see leaveCommunityLobby.
   */
  async function leaveCommunityGame() {
    if (!game || !myPlayerId) { router.push('/community'); return }
    setLeavingGame(true)
    try {
      await leaveCommunityLobby(myPlayerId, game.id)
      localStorage.removeItem('playerId')
      router.push('/community')
    } catch (e: any) {
      setLeavingGame(false)
      setError(e?.message || 'Could not leave the game.')
    }
  }

  /**
   * Take a player out of the game entirely — for someone who has plainly gone,
   * rather than someone merely losing.
   */
  async function handleRemovePlayer(targetId: string, name: string) {
    if (!game) return
    if (confirmRemoveId !== targetId) {
      setConfirmRemoveId(targetId)
      // Disarm on its own, so a half-pressed button never lingers — but leave
      // long enough to read the prompt and aim at it on a phone.
      setTimeout(() => setConfirmRemoveId((id) => (id === targetId ? null : id)), 10000)
      return
    }
    setConfirmRemoveId(null)
    setError('')
    try {
      await removePlayer(targetId, game.id)
    } catch (e: any) {
      setError(e?.message || `Could not remove ${name}.`)
    }
  }

  /** Move the turn on when whoever holds it isn't acting. */
  async function handleSkipTurn() {
    if (!game?.current_player_id) return
    setError('')
    try {
      await skipCurrentPlayer(game.id, game.current_player_id)
    } catch (e: any) {
      setError(e?.message || 'Could not skip that turn.')
    }
  }

  // Fetch air date of the source game
  useEffect(() => {
    if (!game?.settings) return
    const sourceId = (game.settings as any)?.sourceGameId
    if (!sourceId) return
    supabase.from('clue_pool').select('air_date').eq('game_id_source', sourceId).limit(1)
      .then(({ data }) => { if (data?.[0]?.air_date) setGameAirDate(data[0].air_date) })
  }, [game?.settings])
  const buzzIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const answerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const answerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // === SOUND EFFECTS ===
  const prevPhaseRef = useRef<string | null>(null)
  useEffect(() => {
    if (!game) return
    const prev = prevPhaseRef.current
    const curr = game.phase
    if (prev !== curr) {
      if (curr === 'clue_reading') playSelectSound()
      if (curr === 'player_answering') playBuzzSound()
      if (curr === 'daily_double_wager') playDailyDoubleSound()
      if (curr === 'clue_result') {
        const resultClue = game.current_clue_id
          ? clues.find((c) => c.id === game.current_clue_id) : null
        if (resultClue?.answered_correct === true) playCorrectSound()
        else if (resultClue?.answered_by && resultClue?.answered_correct === false) playWrongSound()
        else playTimeUpSound()
      }
    }
    prevPhaseRef.current = curr
  }, [game?.phase, game?.current_clue_id, clues])

  // === AUTO-TRANSITIONS (same as display page) ===

  // clue_reading → buzz_window
  const transitionRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'clue_reading') {
      if (transitionRef.current) clearTimeout(transitionRef.current)
      return
    }
    // Was `?? 0`, which meant this page opened the buzzers the moment the clue
    // appeared — and since every client races to make this flip, the earliest
    // one wins, so it opened them for the whole room while the TV was still
    // typing the clue out.
    const currentQuestion = game.current_clue_id
      ? clues.find((c) => c.id === game.current_clue_id)?.question
      : null
    const delay = buzzOpenDelayMs({
      question: currentQuestion,
      readingPeriodMs: game.settings?.reading_period_ms,
      phaseStartedAt: game.updated_at,
    })
    transitionRef.current = setTimeout(async () => {
      await openBuzzWindow(game.id, { onlyIfReading: true })
    }, delay)
    return () => { if (transitionRef.current) clearTimeout(transitionRef.current) }
  }, [game?.phase, game?.id, game?.updated_at, game?.current_clue_id, clues])

  // Buzz countdown + arming. buzz_window_start is written ~700ms in the
  // future so every client arms at the same wall-clock moment, not whenever
  // each one happens to observe the phase change.
  const buzzTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const buzzArmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    setBuzzArmed(false)
    if (!game || game.phase !== 'buzz_window') {
      setBuzzCountdown(null)
      if (buzzTimeoutRef.current) clearTimeout(buzzTimeoutRef.current)
      if (buzzArmTimeoutRef.current) clearTimeout(buzzArmTimeoutRef.current)
      if (buzzIntervalRef.current) clearInterval(buzzIntervalRef.current)
      return
    }
    // Per-window duration wins over the game-wide setting: a REOPENED buzz
    // window after a wrong answer is deliberately shorter than the first one.
    const totalMs = game.buzz_window_ms ?? game.settings?.buzz_window_ms ?? 15000
    const scheduledMs = game.buzz_window_start
      ? new Date(game.buzz_window_start).getTime()
      : Date.now()
    // Clamp so a badly-skewed device clock still arms within 1.2s.
    const openDelay = Math.max(0, Math.min(1200, scheduledMs - Date.now()))
    const armAt = Date.now() + openDelay

    buzzArmTimeoutRef.current = setTimeout(() => setBuzzArmed(true), openDelay)
    setBuzzCountdown(Math.ceil(totalMs / 1000))
    buzzIntervalRef.current = setInterval(() => {
      const remaining = Math.max(0, totalMs - (Date.now() - armAt))
      setBuzzCountdown(Math.ceil(remaining / 1000))
    }, 250)
    buzzTimeoutRef.current = setTimeout(async () => {
      if (game.current_clue_id) await skipClue(game.id, game.current_clue_id)
    }, openDelay + totalMs)
    return () => {
      if (buzzTimeoutRef.current) clearTimeout(buzzTimeoutRef.current)
      if (buzzArmTimeoutRef.current) clearTimeout(buzzArmTimeoutRef.current)
      if (buzzIntervalRef.current) clearInterval(buzzIntervalRef.current)
    }
  }, [game?.phase, game?.id, game?.buzz_window_start])

  // Answer countdown + auto-skip
  useEffect(() => {
    const isAnswering = game?.phase === 'player_answering' && game?.current_player_id === myPlayerId
    if (!isAnswering || !game) {
      setAnswerCountdown(null)
      if (answerIntervalRef.current) clearInterval(answerIntervalRef.current)
      if (answerTimeoutRef.current) clearTimeout(answerTimeoutRef.current)
      return
    }
    const totalMs = game.settings?.answer_time_ms ?? 15000
    setAnswerCountdown(Math.ceil(totalMs / 1000))
    answerIntervalRef.current = setInterval(() => {
      setAnswerCountdown((prev) => (prev !== null && prev > 0 ? prev - 1 : 0))
    }, 1000)
    answerTimeoutRef.current = setTimeout(async () => {
      if (game.current_clue_id && myPlayerId) {
        setHasTriedAnswer(true)
        await passAfterBuzz(game.id, game.current_clue_id, myPlayerId)
      }
    }, totalMs)
    return () => {
      if (answerIntervalRef.current) clearInterval(answerIntervalRef.current)
      if (answerTimeoutRef.current) clearTimeout(answerTimeoutRef.current)
    }
  }, [game?.phase, game?.id, game?.current_player_id, myPlayerId])

  // round_end → board_selection after 4s
  const roundEndRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'round_end') { if (roundEndRef.current) clearTimeout(roundEndRef.current); return }
    roundEndRef.current = setTimeout(() => advanceFromRoundEnd(game.id), 4000)
    return () => { if (roundEndRef.current) clearTimeout(roundEndRef.current) }
  }, [game?.phase, game?.id])

  // clue_result → next after 4s
  const clueResultRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'clue_result') { if (clueResultRef.current) clearTimeout(clueResultRef.current); return }
    clueResultRef.current = setTimeout(() => advanceFromClueResult(game.id), 4000)
    return () => { if (clueResultRef.current) clearTimeout(clueResultRef.current) }
  }, [game?.phase, game?.id])

  // final_category → final_wager after 5s
  const finalCatRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'final_category') { if (finalCatRef.current) clearTimeout(finalCatRef.current); return }
    finalCatRef.current = setTimeout(() => advanceToFinalWager(game.id), 5000)
    return () => { if (finalCatRef.current) clearTimeout(finalCatRef.current) }
  }, [game?.phase, game?.id])

  // final_clue → final_answering after 5s
  const finalClueRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'final_clue') { if (finalClueRef.current) clearTimeout(finalClueRef.current); return }
    finalClueRef.current = setTimeout(() => advanceToFinalAnswering(game.id), 5000)
    return () => { if (finalClueRef.current) clearTimeout(finalClueRef.current) }
  }, [game?.phase, game?.id])

  // final_reveal → game_over after 8s
  const revealRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'final_reveal') { if (revealRef.current) clearTimeout(revealRef.current); return }
    revealRef.current = setTimeout(() => advanceToGameOver(game.id), 8000)
    return () => { if (revealRef.current) clearTimeout(revealRef.current) }
  }, [game?.phase, game?.id])

  // Tick sounds
  const prevBuzzCount = useRef<number | null>(null)
  useEffect(() => {
    if (buzzCountdown !== null && prevBuzzCount.current !== null && buzzCountdown !== prevBuzzCount.current && buzzCountdown > 0)
      playTickSound(buzzCountdown <= 5)
    prevBuzzCount.current = buzzCountdown
  }, [buzzCountdown])

  const prevAnswerCount = useRef<number | null>(null)
  useEffect(() => {
    if (answerCountdown !== null && prevAnswerCount.current !== null && answerCountdown !== prevAnswerCount.current && answerCountdown > 0)
      playTickSound(answerCountdown <= 5)
    prevAnswerCount.current = answerCountdown
  }, [answerCountdown])

  // Remove self from lobby when closing tab
  useEffect(() => {
    if (!game || game.phase !== 'lobby' || !myPlayerId) return
    const handleUnload = () => {
      // Use sendBeacon for reliability on tab close
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/players?id=eq.${myPlayerId}`
      navigator.sendBeacon(url) // Best-effort; actual delete via kick button
      removePlayer(myPlayerId)
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [game?.phase, myPlayerId])

  // Reset state on phase changes
  useEffect(() => {
    if (game?.phase === 'final_wager') { setFinalWagerLocked(myPlayer?.final_wager != null); setFinalWagerInput('') }
    if (game?.phase === 'final_clue' || game?.phase === 'final_answering') {
      setFinalAnswerLocked(myPlayer?.final_answer != null && myPlayer?.final_answer !== ''); setFinalAnswerInput('')
    }
    if (game?.phase === 'clue_reading' || game?.phase === 'board_selection') setHasPassed(false)
  }, [game?.phase])

  // Reset per-clue attempt state when the clue changes
  useEffect(() => {
    setHasTriedAnswer(false)
    setHasPassed(false)
  }, [game?.current_clue_id])

  // Auto-advance finals.
  //
  // Everyone wagering moves it on immediately; otherwise the clock does. A
  // player who closed their tab still has a row, and that row never wagers —
  // waiting on it left Final Jeopardy stuck for everyone who stayed.
  //
  // The deadline is anchored on when the phase began rather than on when this
  // tab noticed, so every client agrees on it and a reload doesn't buy anyone
  // a fresh fifteen seconds.
  useEffect(() => {
    if (!game || game.phase !== 'final_wager') return
    if (players.length > 0 && players.every((p) => p.final_wager != null)) {
      advanceToFinalClue(game.id)
      return
    }
    const startedAt = Date.parse(game.updated_at ?? '')
    const totalMs = game.settings?.final_wager_ms ?? 15000
    // A moment past the players' own clocks, so their auto-submitted wagers
    // land before the phase turns over.
    const deadline = (isNaN(startedAt) ? Date.now() : startedAt) + totalMs + 1500
    const t = setTimeout(() => advanceToFinalClue(game.id), Math.max(0, deadline - Date.now()))
    return () => clearTimeout(t)
  }, [game?.phase, game?.id, game?.updated_at, game?.settings?.final_wager_ms, players])

  useEffect(() => {
    if (!game || game.phase !== 'final_answering') return
    if (players.length > 0 && players.every((p) => p.final_answer != null)) startFinalReveal(game.id)
  }, [game?.phase, game?.id, players])

  // Final Jeopardy wager clock. Mirrors the answer clock below: at zero it
  // locks in whatever is typed, and $0 if nothing is.
  useEffect(() => { finalWagerInputRef.current = finalWagerInput }, [finalWagerInput])
  useEffect(() => {
    const isMyWager =
      game?.phase === 'final_wager' &&
      myPlayer &&
      !finalWagerLocked &&
      myPlayer.final_wager == null
    if (!isMyWager) {
      setWagerCountdown(null)
      if (wagerTimerRef.current) clearTimeout(wagerTimerRef.current)
      if (wagerIntervalRef.current) clearInterval(wagerIntervalRef.current)
      wagerTimerRef.current = null
      wagerIntervalRef.current = null
      return
    }
    // Anchored on the same instant the round-advance uses, so the number on
    // screen is the truth. Counting 15 from whenever this tab mounted meant a
    // reload showed more time than it had, and the round moved on before the
    // wager it was still promising could be submitted.
    const startedAt = Date.parse(game.updated_at ?? '')
    const totalMs = game.settings?.final_wager_ms ?? 15000
    const deadline = (isNaN(startedAt) ? Date.now() : startedAt) + totalMs
    const remaining = () => Math.max(0, deadline - Date.now())

    setWagerCountdown(Math.ceil(remaining() / 1000))
    wagerIntervalRef.current = setInterval(() => {
      setWagerCountdown(Math.ceil(remaining() / 1000))
    }, 250)
    wagerTimerRef.current = setTimeout(async () => {
      if (!myPlayer) return
      const maxWager = Math.max(myPlayer.score, 0)
      const typed = parseInt(finalWagerInputRef.current) || 0
      await submitFinalWager(myPlayer.id, Math.min(Math.max(typed, 0), maxWager))
      setFinalWagerLocked(true)
      setFinalWagerInput('')
    }, remaining())
    return () => {
      if (wagerTimerRef.current) clearTimeout(wagerTimerRef.current)
      if (wagerIntervalRef.current) clearInterval(wagerIntervalRef.current)
    }
  }, [game?.phase, game?.updated_at, myPlayer?.id, myPlayer?.score, finalWagerLocked, myPlayer?.final_wager, game?.settings?.final_wager_ms])

  // Final Jeopardy answer clock. Auto-submits whatever's typed at zero,
  // including nothing.
  useEffect(() => { finalAnswerInputRef.current = finalAnswerInput }, [finalAnswerInput])
  useEffect(() => {
    const isMyFinal =
      game?.phase === 'final_answering' &&
      myPlayer &&
      !finalAnswerLocked &&
      myPlayer.final_answer == null
    if (!isMyFinal) {
      setFinalCountdown(null)
      if (finalTimerRef.current) clearTimeout(finalTimerRef.current)
      if (finalIntervalRef.current) clearInterval(finalIntervalRef.current)
      finalTimerRef.current = null
      finalIntervalRef.current = null
      return
    }
    const totalMs = game.settings?.final_answer_ms ?? 15000
    setFinalCountdown(Math.ceil(totalMs / 1000))
    finalIntervalRef.current = setInterval(() => {
      setFinalCountdown((n) => (n !== null && n > 0 ? n - 1 : 0))
    }, 1000)
    finalTimerRef.current = setTimeout(async () => {
      if (myPlayer) {
        await submitFinalAnswer(myPlayer.id, finalAnswerInputRef.current.trim())
        setFinalAnswerLocked(true)
        setFinalAnswerInput('')
      }
    }, totalMs)
    return () => {
      if (finalTimerRef.current) clearTimeout(finalTimerRef.current)
      if (finalIntervalRef.current) clearInterval(finalIntervalRef.current)
    }
  }, [game?.phase, myPlayer?.id, finalAnswerLocked, myPlayer?.final_answer, game?.settings?.final_answer_ms])

  // Someone with the page closed isn't about to pick, so there's no reason to
  // sit through the full pause before the others may act. Still a few seconds
  // rather than none: a backgrounded phone can drop its socket briefly, and
  // that shouldn't cost anyone their turn.
  const currentPlayerOnline =
    !game?.current_player_id || onlineIds.has(game.current_player_id)
  const SKIP_GRACE_ONLINE_MS = 20000
  const SKIP_GRACE_OFFLINE_MS = 6000

  // Phases that wait on one named player, and so can stall on them.
  //
  // Deliberately no automatic skip on "their row is gone": games.current_player_id
  // is a foreign key with no ON DELETE rule, so it can never point at a deleted
  // player — the delete is refused first. An auto-skip keyed on the client's
  // player list would therefore never fire for a real absence, but WOULD fire
  // while that list is still loading, skipping someone who never had a turn.
  const stallablePhase =
    game?.phase === 'board_selection' || game?.phase === 'daily_double_wager'

  useEffect(() => {
    setSkipReady(false)
    if (!stallablePhase || isMyTurn || !game) return
    const startedAt = Date.parse(game.updated_at ?? '')
    const grace = currentPlayerOnline ? SKIP_GRACE_ONLINE_MS : SKIP_GRACE_OFFLINE_MS
    const readyAt = (isNaN(startedAt) ? Date.now() : startedAt) + grace
    const t = setTimeout(() => setSkipReady(true), Math.max(0, readyAt - Date.now()))
    return () => clearTimeout(t)
  }, [stallablePhase, isMyTurn, game?.updated_at, game?.phase, currentPlayerOnline])

  // Auto-redirect on rematch
  useEffect(() => {
    if (!game?.rematch_room_code) return
    // Find this player's new ID in the rematch game
    const newCode = game.rematch_room_code
    const myName = myPlayer?.name || localStorage.getItem('playerName')
    if (!myName) {
      router.push(`/game/${newCode}/play`)
      return
    }
    // Join the new game (reconnect with same name)
    joinGame(newCode, myName).then(({ player }) => {
      localStorage.setItem('playerId', player.id)
      router.push(`/game/${newCode}/play`)
    }).catch(() => {
      router.push(`/game/${newCode}/play`)
    })
  }, [game?.rematch_room_code])

  // === ACTION HANDLERS ===
  async function doAction(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError('')
    try { await fn(); await refreshState() }
    catch (e: any) {
      const msg = e?.message || 'Something went wrong'
      setError(msg)
      console.error(e)
      // Re-throw so callers (e.g. BuzzerButton) can render their own
      // inline error instead of the click silently disappearing.
      throw new Error(msg)
    }
    finally { setBusy(false) }
  }

  const handleReady = () => doAction(async () => {
    if (!myPlayer) return
    await setReady(myPlayer.id, !myPlayer.is_ready)
  })

  const handleStartGame = () => doAction(async () => {
    if (!game) return
    const settings = game.settings as any
    if (settings?.customBoard) {
      // Custom board game
      await startCustomGame(game.id, settings.customBoard)
    } else if (settings?.sourceGameId) {
      await startGameFromSource(game.id, settings.sourceGameId)
    } else {
      await startGame(game.id)
    }
  })

  const handleBuzz = () => doAction(async () => {
    if (!game || !myPlayer || !game.current_clue_id) return
    playBuzzSound()
    await submitBuzz(game.id, game.current_clue_id, myPlayer.id)
  })

  const handlePass = () => doAction(async () => {
    if (!game || !myPlayer || !game.current_clue_id) return
    // Record pass and check if all players have passed
    await passOnClue(game.id, game.current_clue_id, myPlayer.id)
    setHasPassed(true)
    // Note: we do NOT cancel buzzTimeoutRef here — if the all-passed check
    // fails due to a race condition (concurrent passes), the buzz timeout
    // will fire skipClue as a fallback to advance the game.
  })

  const handleSubmitAnswer = () => doAction(async () => {
    if (!game || !myPlayer || !game.current_clue_id || !answer.trim()) return
    setHasTriedAnswer(true)
    await submitAnswer(game.id, game.current_clue_id, myPlayer.id, answer.trim())
    setAnswer('')
  })

  const handlePassAfterBuzz = () => doAction(async () => {
    if (!game || !myPlayer || !game.current_clue_id) return
    setHasTriedAnswer(true)
    await passAfterBuzz(game.id, game.current_clue_id, myPlayer.id)
  })

  const handleSubmitWager = () => doAction(async () => {
    if (!game || !myPlayer) return
    const wagerConfig = GAME_LENGTH_CONFIG[game.settings?.gameLength || 'full']
    const roundValues = game.current_round === 2 ? wagerConfig.values2 : wagerConfig.values1
    const maxWager = Math.max(myPlayer.score, roundValues[roundValues.length - 1] || 1000)
    const w = parseInt(wager) || 5
    await submitWager(game.id, myPlayer.id, Math.min(Math.max(w, 5), maxWager))
    setWager('')
  })

  const handleFinalWager = () => doAction(async () => {
    if (!myPlayer) return
    const maxWager = Math.max(myPlayer.score, 0)
    const w = parseInt(finalWagerInput) || 0
    await submitFinalWager(myPlayer.id, Math.min(Math.max(w, 0), maxWager))
    setFinalWagerLocked(true); setFinalWagerInput('')
  })

  const handleFinalAnswer = () => doAction(async () => {
    if (!myPlayer || !finalAnswerInput.trim()) return
    await submitFinalAnswer(myPlayer.id, finalAnswerInput.trim())
    setFinalAnswerLocked(true); setFinalAnswerInput('')
  })

  // === LOADING ===
  if (!game) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-jeopardy-dark">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-jeopardy-gold border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Connecting to game...</p>
        </div>
      </div>
    )
  }

  // === JOIN FORM (no player yet — e.g. scanned QR code) ===
  if (!myPlayer) {
    return <JoinForm roomCode={roomCode} onJoined={(playerId) => {
      localStorage.setItem('playerId', playerId)
      refreshState()
    }} />
  }

  const currentClue = game.current_clue_id ? clues.find((c) => c.id === game.current_clue_id) : null
  const currentPlayer = players.find((p) => p.id === game.current_player_id)

  // === LOBBY ===
  const isCommunityGame = (game.settings as any)?.community === true

  // Community Play: three strangers agree on the format before any board
  // exists. Only community games ever reach this phase.
  if (game.phase === 'game_voting') {
    return (
      <CommunityVote
        gameId={game.id}
        players={players}
        myPlayerId={myPlayerId}
        votingSince={game.updated_at}
      />
    )
  }

  // A community game still filling up. Handled here as well as on /community
  // so it never matters which page a player is sitting on — whoever lands here
  // early waits with everyone else and moves through on the same phase flip.
  if (isCommunityGame && (game.phase === 'lobby' || game.status === 'lobby')) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-jeopardy-dark px-6">
        <p className="text-[10px] uppercase tracking-[0.3em] text-jeopardy-gold-light">
          Community Play
        </p>
        <p className="mt-2 font-mono text-2xl tracking-[0.25em] text-white">{game.room_code}</p>

        <div className="mt-5 flex gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <span
              key={i}
              className={`h-3.5 w-3.5 rounded-full ${
                i < players.length ? 'bg-jeopardy-gold-light' : 'bg-white/20'
              }`}
            />
          ))}
        </div>

        <p className="mt-4 text-white">
          {players.length >= 3 ? 'Starting…' : `Waiting for ${3 - players.length} more`}
        </p>
        {players.length > 0 && (
          <p className="mt-1 text-sm text-gray-400">{players.map((p) => p.name).join(' · ')}</p>
        )}

        <a href="/community" className="btn-stage btn-stage-sm btn-stage-ghost mt-6">
          Leave this game
        </a>
      </div>
    )
  }

  if (game.phase === 'lobby') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-jeopardy-dark">
        <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-16 w-auto mb-4" />

        <button
          onClick={() => { navigator.clipboard.writeText(game.room_code); setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000) }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors mb-6"
        >
          <span className="text-gray-400 text-sm">Room</span>
          <span className="text-white font-mono text-lg font-bold tracking-widest">{game.room_code}</span>
          <span className="text-xs text-gray-500">{codeCopied ? 'Copied!' : 'Copy'}</span>
        </button>

        <div className="w-full max-w-sm space-y-3 mb-6">
          {players.map((p) => (
            <div key={p.id} className={`flex items-center justify-between px-4 py-3 rounded-xl ${
              p.id === myPlayerId ? 'bg-jeopardy-blue/30 border border-jeopardy-blue/50' : 'bg-white/5'
            }`}>
              <span className="font-semibold">{p.name}</span>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${p.is_ready ? 'text-green-400' : 'text-gray-500'}`}>
                  {p.is_ready ? 'Ready' : 'Not ready'}
                </span>
                {p.id !== myPlayerId && (
                  <button
                    onClick={async () => { await removePlayer(p.id); await refreshState() }}
                    className="text-xs text-red-400/60 hover:text-red-400 transition-colors px-2"
                    title="Remove player"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <button onClick={handleReady} disabled={busy}
          className={`w-full max-w-sm py-4 rounded-2xl font-bold text-xl transition-all ${
            myPlayer.is_ready ? 'btn-secondary' : 'bg-green-600 text-white'
          }`}>
          {myPlayer.is_ready ? 'Cancel Ready' : 'Ready Up'}
        </button>

        {players.every((p) => p.is_ready) && players.length >= 1 && (
          (game.settings as any)?.gameMode !== 'multiplayer' || myPlayer.is_creator
        ) && (
          <button onClick={handleStartGame} disabled={busy}
            className="btn-primary w-full max-w-sm mt-3 py-4 text-xl">
            {busy ? 'Starting...' : 'Start Game'}
          </button>
        )}
        {players.every((p) => p.is_ready) && players.length >= 1 &&
          (game.settings as any)?.gameMode === 'multiplayer' && !myPlayer.is_creator && (
          <p className="text-gray-500 text-center mt-3">Waiting for host to start...</p>
        )}

        {error && <p className="text-red-400 text-center text-sm mt-4">{error}</p>}
      </div>
    )
  }

  // === SCOREBOARD (shared across phases) ===
  const Scoreboard = () => (
    <div className="bg-black/40 flex-shrink-0">
      <div className="flex items-center justify-between gap-2 px-3 py-1">
        <span className="text-[10px] text-gray-500 font-mono">{game.room_code}</span>
        <div className="flex items-center gap-3">
          {gameAirDate && (
            <span className="text-[10px] text-gray-500">
              {new Date(gameAirDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
          {/* Skip whoever's turn it is. Lives up here because the two phases
              that can stall — picking a clue and wagering on a Daily Double —
              both show this header, so one control covers both. Stays
              disabled briefly so nobody is skipped mid-thought. */}
          {stallablePhase && !isMyTurn && currentPlayer && (
            <button
              onClick={handleSkipTurn}
              disabled={!skipReady}
              title={
                skipReady
                  ? `Skip ${currentPlayer.name} and move to the next player`
                  : `You can skip ${currentPlayer.name} if they keep the game waiting`
              }
              className="text-[10px] uppercase tracking-[0.18em] text-gray-500 transition-colors hover:text-white disabled:opacity-30 disabled:hover:text-gray-500"
            >
              Skip
            </button>
          )}
          {/* Community games are with strangers, so there has to be a way out
              at any moment. Whoever stays keeps the board and their scores. */}
          {isCommunityGame && (
            <button
              onClick={leaveCommunityGame}
              disabled={leavingGame}
              className="text-[10px] uppercase tracking-[0.18em] text-gray-500 transition-colors hover:text-white disabled:opacity-50"
            >
              {leavingGame ? 'Leaving…' : 'Leave'}
            </button>
          )}
        </div>
      </div>
      <div className="flex gap-2 px-2 pb-2 overflow-x-auto">
        {players.sort((a, b) => b.score - a.score).map((p) => {
          // Faded means the page isn't open on their end. It corrects itself
          // the moment they come back, so it says "away", not "gone".
          const away = !onlineIds.has(p.id) && p.id !== myPlayerId
          return (
          <div key={p.id} title={away ? `${p.name} doesn't have the game open` : undefined}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-center min-w-[80px] border-b-3 ${
            p.id === game.current_player_id ? 'bg-jeopardy-blue-cell/50 border-b-2 border-jeopardy-gold' : 'bg-jeopardy-blue-dark/30'
          } ${p.id === myPlayerId ? 'ring-1 ring-blue-400/30' : ''} ${away ? 'opacity-40 grayscale' : ''}`}>
            <p className="text-[10px] text-white/60 truncate font-semibold uppercase">
              {p.name}
              {/* Take out someone who has plainly gone. Freely in a private
                  game among friends; in Community — where these are strangers
                  and two players could otherwise gang up on the leader — only
                  once that player is actually holding the game up. */}
              {p.id !== myPlayerId && (!isCommunityGame || (skipReady && p.id === game.current_player_id)) && (
                <button
                  onClick={() => handleRemovePlayer(p.id, p.name)}
                  title={`Remove ${p.name} from the game`}
                  aria-label={
                    confirmRemoveId === p.id
                      ? `Confirm removing ${p.name}`
                      : `Remove ${p.name} from the game`
                  }
                  className={`ml-1 align-middle leading-none transition-colors ${
                    confirmRemoveId === p.id
                      ? 'text-[9px] font-bold text-red-400'
                      : 'px-1 text-[13px] text-gray-500 hover:text-red-400'
                  }`}
                >
                  {confirmRemoveId === p.id ? 'REMOVE?' : '×'}
                </button>
              )}
            </p>
            <p className={`text-sm font-bold ${p.score < 0 ? 'text-red-400' : 'text-jeopardy-gold-light'}`}>
              ${p.score.toLocaleString()}
            </p>
          </div>
          )
        })}
      </div>
    </div>
  )

  // === ROUND END ===
  if (game.phase === 'round_end') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark p-6">
        <h2 className="text-4xl font-bold text-jeopardy-gold mb-4 animate-pulse">
          {game.current_round === 2 ? 'Double Jeopardy!' : 'Final Jeopardy!'}
        </h2>
        <Scoreboard />
      </div>
    )
  }

  // === CLUE RESULT ===
  if (game.phase === 'clue_result' && currentClue) {
    const wasCorrect = currentClue.answered_correct === true
    const noOneAnswered = !currentClue.answered_by
    const answerer = currentClue.answered_by ? players.find((p) => p.id === currentClue.answered_by) : null
    const clueCategory = categories.find((c) => c.id === currentClue.category_id)
    const isDailyDouble = currentClue.is_daily_double === true
    const swing = isDailyDouble ? (answerer?.final_wager ?? 0) : currentClue.value

    return (
      <div className="min-h-screen flex flex-col bg-jeopardy-dark">
        <Scoreboard />
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          {/* Buzz order — surfaced first when 2+ people raced for the buzz */}
          <div className="w-full max-w-sm mb-4">
            <BuzzOrder gameId={game.id} clueId={currentClue.id} players={players} variant="compact" />
          </div>

          {clueCategory && <p className="text-blue-300 text-sm font-bold uppercase mb-1">{clueCategory.name}</p>}
          <p className="text-jeopardy-gold text-lg font-bold mb-1">${currentClue.value.toLocaleString()}</p>
          {isDailyDouble && answerer && (
            <p className="text-jeopardy-gold-light text-xs font-bold uppercase tracking-wider mb-3">
              ⭐ Daily Double — wagered ${swing.toLocaleString()}
            </p>
          )}
          {!isDailyDouble && <div className="mb-3" />}
          <div className={`px-8 py-6 rounded-2xl text-center ${
            noOneAnswered ? 'bg-gray-600/15 border-2 border-gray-500'
              : wasCorrect ? 'bg-green-600/15 border-2 border-green-500'
                : 'bg-red-600/15 border-2 border-red-500'
          }`}>
            <p className={`text-4xl font-bold mb-2 ${noOneAnswered ? 'text-gray-400' : wasCorrect ? 'text-green-400' : 'text-red-400'}`}>
              {noOneAnswered ? "Time's Up!" : wasCorrect ? '✓ Correct!' : '✗ Wrong!'}
            </p>
            {answerer && (
              <p className="text-white text-lg">
                {answerer.name} {wasCorrect ? `+$${swing.toLocaleString()}` : `-$${swing.toLocaleString()}`}
              </p>
            )}
          </div>
          <div className="mt-4 text-center">
            <p className="text-gray-500 text-sm mb-1">Answer:</p>
            <p className="text-white text-lg font-bold">{currentClue.answer}</p>
          </div>

          {/* Every answer attempted on this clue */}
          <ClueAttempts gameId={game.id} clueId={currentClue.id} players={players} variant="phone" />
        </div>
      </div>
    )
  }

  // === FINAL JEOPARDY PHASES ===
  if (game.phase === 'final_category') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark p-6">
        <h2 className="text-3xl font-bold text-jeopardy-gold mb-6">Final Jeopardy!</h2>
        <div className="bg-jeopardy-blue rounded-xl px-8 py-6 border border-jeopardy-gold/50">
          <p className="text-2xl font-bold text-white text-center uppercase">{game.final_category_name}</p>
        </div>
      </div>
    )
  }

  if (game.phase === 'final_wager') {
    const maxWager = Math.max(myPlayer.score, 0)
    if (finalWagerLocked || myPlayer.final_wager != null) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark p-6">
          <h2 className="text-2xl font-bold text-jeopardy-gold mb-4">Wager Locked!</h2>
          <p className="text-3xl font-bold text-white">${(myPlayer.final_wager ?? 0).toLocaleString()}</p>
          <p className="text-gray-400 mt-4">Waiting for others — the clue comes up shortly either way.</p>
        </div>
      )
    }
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center bg-jeopardy-dark p-6 overflow-hidden">
        <h2 className="text-2xl font-bold text-jeopardy-gold mb-2">Final Jeopardy!</h2>
        <p className="text-gray-400 mb-2 uppercase">{game.final_category_name}</p>
        <p className="text-gray-500 mb-2">Wager $0 - ${maxWager.toLocaleString()}</p>
        {/* Nobody should be able to hold up Final Jeopardy by walking away. */}
        <p className={`mb-4 text-sm font-bold tabular-nums ${
          wagerCountdown !== null && wagerCountdown <= 5 ? 'text-red-400' : 'text-jeopardy-gold-light'
        }`}>
          {wagerCountdown !== null
            ? `${wagerCountdown}s to lock in`
            : 'Locking in soon'}
        </p>
        <div className="w-full max-w-xs">
          <GameKeyboard value={finalWagerInput} onChange={setFinalWagerInput} onSubmit={handleFinalWager}
            mode="numbers" placeholder="Enter wager" submitLabel="Lock In Wager"
            submitDisabled={!finalWagerInput.trim() || busy} />
        </div>
      </div>
    )
  }

  if (game.phase === 'final_clue' || game.phase === 'final_answering') {
    if (finalAnswerLocked || (myPlayer.final_answer != null && myPlayer.final_answer !== '')) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark p-6">
          <h2 className="text-2xl font-bold text-green-400 mb-4">Answer Submitted!</h2>
          <p className="text-gray-400">Waiting for others...</p>
        </div>
      )
    }
    return (
      <div className="h-[100dvh] flex flex-col bg-jeopardy-dark overflow-hidden">
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-6 py-2 overflow-y-auto gap-3">
          <h2 className="text-lg font-bold text-jeopardy-gold mb-1 uppercase flex-shrink-0">{game.final_category_name}</h2>
          <p className="text-xl text-white text-center leading-relaxed font-serif max-w-lg flex-shrink-0">{game.final_clue_text}</p>
          {finalCountdown !== null && (
            <p className={`text-5xl font-bold font-mono ${finalCountdown <= 5 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
              {finalCountdown}s
            </p>
          )}
        </div>
        <div className="flex-shrink-0 bg-jeopardy-dark/95 border-t border-white/10 p-2 pb-[env(safe-area-inset-bottom,8px)]">
          <div className="w-full max-w-sm mx-auto">
            <GameKeyboard value={finalAnswerInput} onChange={setFinalAnswerInput} onSubmit={handleFinalAnswer}
              mode="letters" placeholder="What is..." submitLabel="Submit Final Answer"
              submitDisabled={!finalAnswerInput.trim() || busy} maxLength={200} />
          </div>
        </div>
      </div>
    )
  }

  if (game.phase === 'final_reveal' || game.phase === 'game_over') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark p-6">
        <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-16 w-auto mb-4" />
        <h1 className="text-3xl font-bold text-jeopardy-gold mb-2">
          {game.phase === 'game_over' ? (players.sort((a, b) => b.score - a.score)[0]?.name || 'Winner') + ' wins!' : 'Final Results...'}
        </h1>
        <div className="w-full max-w-sm space-y-3 mt-6">
          {players.sort((a, b) => b.score - a.score).map((p, i) => (
            <div key={p.id} className={`flex items-center justify-between px-5 py-4 rounded-xl ${
              i === 0 ? 'bg-jeopardy-gold/20 border-2 border-jeopardy-gold' : 'bg-white/5'
            }`}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">{i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}</span>
                <span className="font-bold text-xl">{p.name}</span>
              </div>
              <span className={`text-xl font-bold ${p.score < 0 ? 'text-red-400' : 'text-jeopardy-gold'}`}>
                ${p.score.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
        {game.phase === 'game_over' && (
          <div className="flex flex-col items-center gap-3 mt-8">
            {myPlayer.is_creator && (
              <button
                onClick={async () => {
                  try {
                    await rematchGame(game.id)
                  } catch (e: any) {
                    console.error('Rematch failed:', e)
                  }
                }}
                disabled={busy}
                className="btn-primary px-8 py-4 text-lg"
              >
                Rematch
              </button>
            )}
            {!myPlayer.is_creator && !game.rematch_room_code && (
              <p className="text-gray-500 text-sm">Waiting for host to start rematch...</p>
            )}
            <a href="/multiplayer" className="text-gray-500 hover:text-white text-sm transition-colors">
              Back to Lobby
            </a>
          </div>
        )}
      </div>
    )
  }

  // === ACTIVE GAME: Board + Clue + Buzzer ===
  const showClue = currentClue && (
    game.phase === 'clue_reading' || game.phase === 'buzz_window' ||
    game.phase === 'player_answering' || game.phase === 'daily_double_answering'
  )

  // === DAILY DOUBLE WAGER (clue hidden until wager is placed) ===
  if (game.phase === 'daily_double_wager' && currentClue) {
    const clueCategory = categories.find((c) => c.id === currentClue.category_id)
    return (
      <div className="h-[100dvh] flex flex-col bg-jeopardy-dark overflow-hidden">
        <Scoreboard />
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-6 py-2">
          <h2 className="text-3xl font-bold text-jeopardy-gold mb-2 animate-pulse">Daily Double!</h2>
          {clueCategory && (
            <p className="text-blue-300 text-base font-bold uppercase tracking-wide mb-1">{clueCategory.name}</p>
          )}
          <p className="text-jeopardy-gold text-lg font-bold mb-4">${currentClue.value.toLocaleString()}</p>
          {isMyTurn ? (
            <p className="text-white text-base">Make your wager below</p>
          ) : (
            <p className="text-gray-400 text-base">{currentPlayer?.name} is making their wager...</p>
          )}
        </div>
        <div className="flex-shrink-0 bg-jeopardy-dark/95 border-t border-white/10 p-2 pb-[env(safe-area-inset-bottom,8px)]">
          {isMyTurn ? (
            <div className="w-full max-w-sm mx-auto">
              <GameKeyboard value={wager} onChange={setWager} onSubmit={handleSubmitWager}
                mode="numbers" placeholder="Enter wager" submitLabel="Lock In Wager"
                submitDisabled={!wager.trim()} />
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-gray-500">Waiting for wager...</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-jeopardy-dark overflow-hidden">
      <Scoreboard />

      {showClue && currentClue ? (
        <>
          {/* Clue display — scrollable if text is long */}
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-6 py-2 overflow-y-auto">
            {(() => {
              const cat = categories.find((c) => c.id === currentClue.category_id)
              return cat ? <p className="text-blue-300 text-sm font-bold uppercase tracking-wide mb-1 flex-shrink-0">{cat.name}</p> : null
            })()}
            <p className="text-jeopardy-gold text-lg font-bold mb-2 flex-shrink-0">${currentClue.value.toLocaleString()}</p>
            <p className="text-lg md:text-xl text-white text-center leading-relaxed font-serif max-w-lg flex-shrink-0">
              <ClueText text={currentClue.question} />
            </p>

            {/* Phase indicators */}
            {game.phase === 'buzz_window' && buzzCountdown !== null && (
              <p className={`text-2xl font-bold font-mono mt-2 flex-shrink-0 ${buzzCountdown <= 5 ? 'text-red-400' : 'text-white/60'}`}>
                {buzzCountdown}
              </p>
            )}
            {game.phase === 'player_answering' && (
              <div className="mt-2 text-center flex-shrink-0">
                <p className="text-green-400 font-bold text-sm">
                  {game.current_player_id === myPlayerId ? 'Your turn to answer!' : `${currentPlayer?.name} is answering...`}
                </p>
                {answerCountdown !== null && game.current_player_id === myPlayerId && (
                  <p className={`text-xl font-bold mt-1 ${answerCountdown <= 5 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                    {answerCountdown}s
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Bottom controls */}
          <div className="flex-shrink-0 bg-jeopardy-dark/95 border-t border-white/10 p-2 pb-[env(safe-area-inset-bottom,8px)]">
            {game.phase === 'daily_double_answering' && !isMyTurn ? (
              <div className="text-center py-4">
                <p className="text-jeopardy-gold font-bold text-lg animate-pulse">Daily Double!</p>
                <p className="text-gray-400 text-sm">{currentPlayer?.name} is answering...</p>
              </div>
            ) : game.phase === 'daily_double_answering' && isMyTurn ? (
              <div className="w-full max-w-sm mx-auto">
                <GameKeyboard value={answer} onChange={setAnswer} onSubmit={handleSubmitAnswer}
                  mode="letters" placeholder="Type or 🎤 speak your answer..." submitLabel="Submit Answer"
                  submitDisabled={!answer.trim()} maxLength={200} />
              </div>
            ) : game.phase === 'player_answering' && game.current_player_id === myPlayerId ? (
              <div className="w-full max-w-sm mx-auto">
                <GameKeyboard value={answer} onChange={setAnswer} onSubmit={handleSubmitAnswer}
                  mode="letters" placeholder="Type or 🎤 speak your answer..." submitLabel="Submit"
                  submitDisabled={!answer.trim()} maxLength={200}
                  secondaryAction={{ label: 'Pass', onClick: handlePassAfterBuzz, disabled: busy }} />
              </div>
            ) : (game.phase === 'buzz_window' || game.phase === 'clue_reading') ? (
              <>
              {/* The buzzers reopen after every wrong answer, so the room can
                  see what's already been said and missed. */}
              <ClueAttempts
                gameId={game.id}
                clueId={currentClue.id}
                players={players}
                variant="phone"
                refreshKey={game.updated_at}
                heading="Already tried"
              />
              {hasTriedAnswer ? (
                <div className="text-center py-4 rounded-xl bg-red-950/40 border border-red-900/60">
                  <p className="text-red-300 font-semibold">You got it wrong</p>
                  <p className="text-gray-400 text-xs mt-0.5">Waiting for other players...</p>
                </div>
              ) : hasPassed ? (
                <div className="text-center py-4"><p className="text-gray-400">Passed</p></div>
              ) : (
                <div className="space-y-2">
                  <BuzzerButton gameId={game.id} clueId={currentClue.id} playerId={myPlayer.id}
                    buzzWindowOpen={game.phase === 'buzz_window' && buzzArmed} isBuzzWinner={false} isLockedOut={false} onBuzz={handleBuzz} />
                  {game.phase === 'buzz_window' && (
                    <button onClick={handlePass} disabled={busy} className="btn-secondary w-full py-3 text-sm">I Don&apos;t Know</button>
                  )}
                </div>
              )}
              </>
            ) : (
              <div className="text-center py-4"><p className="text-gray-500">Waiting...</p></div>
            )}
          </div>
        </>
      ) : (
        /* Board view */
        <div className="flex-1">
          <GameBoard game={game} categories={categories} clues={clues} players={players}
            myPlayerId={myPlayerId} isMyTurn={isMyTurn}
            canPickAnyway={skipReady && game.phase === 'board_selection'} />
        </div>
      )}

      {/* Connection indicator */}
      <div className="fixed top-2 right-2">
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
      </div>

      {/* Floating error banner — visible during all gameplay phases */}
      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-md mx-auto bg-red-900/90 border border-red-500 text-red-100 text-sm px-4 py-2 rounded-xl shadow-lg">
          {error}
          <button onClick={() => setError('')} className="ml-3 text-red-300 hover:text-white">✕</button>
        </div>
      )}
    </div>
  )
}
