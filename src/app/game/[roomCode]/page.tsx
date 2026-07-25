'use client'

import { useParams } from 'next/navigation'
import { useGameChannel } from '@/hooks/useGameChannel'
import { BuzzerButton } from '@/components/BuzzerButton'
import { BuzzOrder } from '@/components/BuzzOrder'
import { GameKeyboard } from '@/components/GameKeyboard'
import {
  removePlayer,
  startGame,
  startGameFromSource,
  startCustomGame,
  selectClue,
  submitAnswer,
  submitWager,
  submitBuzz,
  submitFinalWager,
  submitFinalAnswer,
  advanceToFinalClue,
  advanceToFinalAnswering,
  startFinalReveal,
  passOnClue,
  passAfterBuzz,
  skipClue,
} from '@/lib/game-api'
import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { CLUE_INTRO_MS, computeClueReadingDelay } from '@/lib/clue-timing'
import { AnimatedClueReveal } from '@/components/AnimatedClueReveal'
import { playBuzzSound, playCorrectSound, playWrongSound, playTickSound } from '@/lib/sounds'
import { GAME_LENGTH_CONFIG } from '@/types/game'

/**
 * PLAYER VIEW (Phone)
 *
 * Jackbox-style phone controller.
 * All actions just write to the DB — the useGameChannel hook
 * picks up changes via postgres_changes + polling and syncs all clients.
 */

export default function PlayerPage() {
  const params = useParams()
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
    refreshState,
  } = useGameChannel(roomCode)

  const [answer, setAnswer] = useState('')
  const [wager, setWager] = useState('')
  const [finalWagerInput, setFinalWagerInput] = useState('')
  const [finalAnswerInput, setFinalAnswerInput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [finalWagerLocked, setFinalWagerLocked] = useState(false)
  const [finalAnswerLocked, setFinalAnswerLocked] = useState(false)
  const [hasPassed, setHasPassed] = useState(false)
  // Per-clue: has THIS player already attempted (answered wrong or timed out)?
  // If so, the buzzer is hidden when the window reopens for other players.
  const [hasTriedAnswer, setHasTriedAnswer] = useState(false)
  // Rebuzz detection: buzz window reopening after any attempts.
  const [isRebuzz, setIsRebuzz] = useState(false)
  // Reset per-clue state when the clue changes.
  useEffect(() => {
    setHasTriedAnswer(false)
    setHasPassed(false)
    setIsRebuzz(false)
  }, [game?.current_clue_id])
  // Detect phase player_answering → buzz_window as a rebuzz.
  const prevPhaseRef = useRef<string | null>(null)
  useEffect(() => {
    if (game?.phase === 'buzz_window' && prevPhaseRef.current === 'player_answering') {
      setIsRebuzz(true)
    }
    prevPhaseRef.current = game?.phase ?? null
  }, [game?.phase])
  const [buzzCountdown, setBuzzCountdown] = useState<number | null>(null)
  const [buzzArmed, setBuzzArmed] = useState(false)
  const [answerCountdown, setAnswerCountdown] = useState<number | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const buzzIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const answerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const answerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset state when phase changes
  useEffect(() => {
    if (game?.phase === 'final_wager') {
      setFinalWagerLocked(myPlayer?.final_wager != null)
      setFinalWagerInput('')
    }
    if (game?.phase === 'final_clue' || game?.phase === 'final_answering') {
      setFinalAnswerLocked(myPlayer?.final_answer != null && myPlayer?.final_answer !== '')
      setFinalAnswerInput('')
    }
    // Reset pass state when entering a new clue phase
    if (game?.phase === 'clue_reading' || game?.phase === 'board_selection') {
      setHasPassed(false)
    }
  }, [game?.phase])

  // Remove self from lobby when closing tab
  useEffect(() => {
    if (!game || game.phase !== 'lobby' || !myPlayerId) return
    const handleUnload = () => { removePlayer(myPlayerId) }
    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [game?.phase, myPlayerId])

  // Fallback transition: clue_reading → buzz_window.
  // The host's /display page is the primary trigger, but if no TV display is
  // open (solo testing, host tab closed, etc.) the buzz window would never
  // open and the buzzer would stay disabled. Any player firing this is fine
  // because the UPDATE is idempotent (last write wins).
  const phaseTransitionRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'clue_reading') {
      if (phaseTransitionRef.current) clearTimeout(phaseTransitionRef.current)
      return
    }
    const currentClue = game.current_clue_id ? clues.find((c) => c.id === game.current_clue_id) : null
    // `|| computeClueReadingDelay` (not `??`) so that legacy games saved with
    // reading_period_ms=0 still get the intro+voice reveal, not an instant flip.
    const delay = (game.settings?.reading_period_ms || 0) > 0
      ? (game.settings!.reading_period_ms as number)
      : computeClueReadingDelay(currentClue?.question)
    phaseTransitionRef.current = setTimeout(async () => {
      await supabase.from('games').update({
        phase: 'buzz_window',
        buzz_window_open: true,
        buzz_window_start: new Date(Date.now() + 700).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', game.id).eq('phase', 'clue_reading')  // only flip if still clue_reading
    }, delay)
    return () => {
      if (phaseTransitionRef.current) clearTimeout(phaseTransitionRef.current)
    }
  }, [game?.phase, game?.id, game?.current_clue_id, clues, game?.settings?.reading_period_ms])

  // Buzz window countdown + arming. Scheduled against buzz_window_start (a
  // ~700ms-future timestamp) so every phone arms at the same moment.
  const buzzArmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    setBuzzArmed(false)
    if (!game || game.phase !== 'buzz_window') {
      setBuzzCountdown(null)
      if (buzzIntervalRef.current) clearInterval(buzzIntervalRef.current)
      if (buzzArmTimeoutRef.current) clearTimeout(buzzArmTimeoutRef.current)
      buzzIntervalRef.current = null
      buzzArmTimeoutRef.current = null
      return
    }

    const totalMs = game.settings?.buzz_window_ms ?? 15000
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

    return () => {
      if (buzzIntervalRef.current) clearInterval(buzzIntervalRef.current)
      if (buzzArmTimeoutRef.current) clearTimeout(buzzArmTimeoutRef.current)
    }
  }, [game?.phase, game?.id, game?.buzz_window_start])

  // Answer countdown timer when it's your turn to answer
  useEffect(() => {
    const isAnswering = game?.phase === 'player_answering' && game?.current_player_id === myPlayerId

    if (!isAnswering || !game) {
      setAnswerCountdown(null)
      if (answerIntervalRef.current) clearInterval(answerIntervalRef.current)
      if (answerTimeoutRef.current) clearTimeout(answerTimeoutRef.current)
      answerIntervalRef.current = null
      answerTimeoutRef.current = null
      return
    }

    const totalMs = game.settings?.answer_time_ms ?? 15000
    const totalSec = Math.ceil(totalMs / 1000)
    setAnswerCountdown(totalSec)

    answerIntervalRef.current = setInterval(() => {
      setAnswerCountdown((prev) => (prev !== null && prev > 0 ? prev - 1 : 0))
    }, 1000)

    // Auto-pass when time runs out
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

  // Play tick sounds on countdown changes
  const prevBuzzRef2 = useRef<number | null>(null)
  useEffect(() => {
    if (buzzCountdown !== null && prevBuzzRef2.current !== null && buzzCountdown !== prevBuzzRef2.current && buzzCountdown > 0) {
      playTickSound(buzzCountdown <= 5)
    }
    prevBuzzRef2.current = buzzCountdown
  }, [buzzCountdown])

  const prevAnswerRef2 = useRef<number | null>(null)
  useEffect(() => {
    if (answerCountdown !== null && prevAnswerRef2.current !== null && answerCountdown !== prevAnswerRef2.current && answerCountdown > 0) {
      playTickSound(answerCountdown <= 5)
    }
    prevAnswerRef2.current = answerCountdown
  }, [answerCountdown])

  // Wrap actions: write to DB, refresh, show errors. Re-throws so callers
  // (e.g. BuzzerButton) can render their own inline error if they want.
  async function doAction(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await fn()
      await refreshState()
    } catch (e: any) {
      const msg = e?.message || 'Something went wrong'
      setError(msg)
      console.error(e)
      throw new Error(msg)
    } finally {
      setBusy(false)
    }
  }

  const handleStartGame = () => doAction(async () => {
    if (!game) return
    const settings = game.settings as any
    if (settings?.customBoard) {
      await startCustomGame(game.id, settings.customBoard)
    } else if (settings?.sourceGameId) {
      await startGameFromSource(game.id, settings.sourceGameId)
    } else {
      await startGame(game.id)
    }
  })

  const handleSelectClue = (clueId: string) => doAction(async () => {
    if (!game || !myPlayer) return
    await selectClue(game.id, clueId, myPlayer.id)
  })

  const handleBuzz = () => doAction(async () => {
    if (!game) { console.warn('[handleBuzz] no game state'); return }
    if (!myPlayer) {
      console.warn('[handleBuzz] no myPlayer — stale localStorage playerId?')
      throw new Error('You\'re not joined to this game. Refresh and rejoin.')
    }
    if (!game.current_clue_id) { console.warn('[handleBuzz] no current clue'); return }
    console.log('[handleBuzz] submitting buzz')
    playBuzzSound()
    await submitBuzz(game.id, game.current_clue_id, myPlayer.id)
  })

  const handlePass = () => doAction(async () => {
    if (!game || !myPlayer || !game.current_clue_id) return
    await passOnClue(game.id, game.current_clue_id, myPlayer.id)
    setHasPassed(true)
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
    const wagerVals = GAME_LENGTH_CONFIG[game.settings?.gameLength || 'full']
    const maxRoundVal = (game.current_round === 2 ? wagerVals.values2 : wagerVals.values1).slice(-1)[0] || 1000
    const maxWager = Math.max(myPlayer.score, maxRoundVal)
    const w = parseInt(wager) || 5
    await submitWager(game.id, myPlayer.id, Math.min(Math.max(w, 5), maxWager))
    setWager('')
  })

  const handleFinalWager = () => doAction(async () => {
    if (!myPlayer) return
    const maxWager = Math.max(myPlayer.score, 0)
    const w = parseInt(finalWagerInput) || 0
    const clamped = Math.min(Math.max(w, 0), maxWager)
    await submitFinalWager(myPlayer.id, clamped)
    setFinalWagerLocked(true)
    setFinalWagerInput('')
  })

  const handleFinalAnswer = () => doAction(async () => {
    if (!myPlayer || !finalAnswerInput.trim()) return
    await submitFinalAnswer(myPlayer.id, finalAnswerInput.trim())
    setFinalAnswerLocked(true)
    setFinalAnswerInput('')
  })

  // Auto-advance: when all wagers are in, move to showing the clue
  useEffect(() => {
    if (!game || game.phase !== 'final_wager') return
    const allWagered = players.length > 0 && players.every((p) => p.final_wager != null)
    if (allWagered) {
      advanceToFinalClue(game.id)
    }
  }, [game?.phase, game?.id, players])

  // Auto-advance: when all answers are in, start reveal
  useEffect(() => {
    if (!game || game.phase !== 'final_answering') return
    const allAnswered = players.length > 0 && players.every((p) => p.final_answer != null && p.final_answer !== '')
    if (allAnswered) {
      startFinalReveal(game.id)
    }
  }, [game?.phase, game?.id, players])

  // No game loaded yet
  if (!game || !myPlayer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-jeopardy-dark">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-jeopardy-gold border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Connecting to game...</p>
        </div>
      </div>
    )
  }

  const currentClue = game.current_clue_id
    ? clues.find((c) => c.id === game.current_clue_id)
    : null

  // ===== LOBBY =====
  if (game.phase === 'lobby') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-jeopardy-dark">
        <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-20 w-auto mb-4" />
        <button
          onClick={() => {
            navigator.clipboard.writeText(game.room_code)
            setCodeCopied(true)
            setTimeout(() => setCodeCopied(false), 2000)
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors mb-8"
        >
          <span className="text-gray-400 text-sm">Room</span>
          <span className="text-white font-mono text-lg font-bold tracking-widest">{game.room_code}</span>
          <span className="text-xs text-gray-500">{codeCopied ? 'Copied!' : 'Copy'}</span>
        </button>

        <div className="w-full max-w-sm space-y-3 mb-8">
          {players.map((p) => (
            <div
              key={p.id}
              className={`flex items-center justify-between px-4 py-3 rounded-xl ${
                p.id === myPlayerId
                  ? 'bg-jeopardy-blue/30 border border-jeopardy-blue/50'
                  : 'bg-white/5'
              }`}
            >
              <span className="font-semibold flex items-center gap-2">
                {p.name}
                {p.is_creator && (
                  <span className="text-[10px] uppercase tracking-widest text-jeopardy-gold font-bold">Host</span>
                )}
              </span>
              {/* Only the host can kick, and never themselves */}
              {myPlayer.is_creator && p.id !== myPlayerId && (
                <button
                  onClick={async () => { await removePlayer(p.id); await refreshState() }}
                  className="text-xs text-red-400/60 hover:text-red-400 transition-colors px-2"
                  title="Remove player"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        {myPlayer.is_creator ? (
          <button
            onClick={handleStartGame}
            disabled={busy || players.length < 1}
            className="btn-primary w-full max-w-sm py-5 text-xl"
          >
            {busy ? 'Starting...' : 'Start Game'}
          </button>
        ) : (
          <p className="text-gray-400 text-center max-w-sm">
            Waiting for the host to start the game...
          </p>
        )}

        {error && <p className="text-red-400 text-center text-sm mt-4 max-w-sm">{error}</p>}
      </div>
    )
  }

  // ===== ROUND END (transition between rounds) =====
  if (game.phase === 'round_end') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark p-6">
        <PlayerHeader myPlayer={myPlayer} game={game} />
        <div className="flex-1 flex flex-col items-center justify-center">
          <h2 className="text-4xl font-bold text-jeopardy-gold mb-4 animate-pulse">
            {game.current_round === 2 ? 'Double Jeopardy!' : 'Final Jeopardy!'}
          </h2>
          <p className="text-gray-400 text-lg">Get ready...</p>
        </div>
      </div>
    )
  }

  // ===== FINAL JEOPARDY: Category reveal =====
  if (game.phase === 'final_category') {
    return (
      <div className="min-h-screen flex flex-col bg-jeopardy-dark p-6">
        <PlayerHeader myPlayer={myPlayer} game={game} />
        <div className="flex-1 flex flex-col items-center justify-center">
          <h2 className="text-3xl font-bold text-jeopardy-gold mb-6">Final Jeopardy!</h2>
          <p className="text-gray-400 mb-4">The category is...</p>
          <div className="bg-jeopardy-blue rounded-xl px-8 py-6 border border-jeopardy-gold/50">
            <p className="text-2xl font-bold text-white text-center uppercase">
              {game.final_category_name}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ===== FINAL JEOPARDY: Wager =====
  if (game.phase === 'final_wager') {
    const maxWager = Math.max(myPlayer.score, 0)

    if (finalWagerLocked || myPlayer.final_wager != null) {
      return (
        <div className="min-h-screen flex flex-col bg-jeopardy-dark p-6">
          <PlayerHeader myPlayer={myPlayer} game={game} />
          <div className="flex-1 flex flex-col items-center justify-center">
            <h2 className="text-2xl font-bold text-jeopardy-gold mb-4">Wager Locked In!</h2>
            <p className="text-3xl font-bold text-white">
              ${(myPlayer.final_wager ?? 0).toLocaleString()}
            </p>
            <p className="text-gray-400 mt-4">Waiting for other players...</p>
          </div>
        </div>
      )
    }

    return (
      <div className="min-h-screen flex flex-col bg-jeopardy-dark p-6">
        <PlayerHeader myPlayer={myPlayer} game={game} />
        <div className="flex-1 flex flex-col items-center justify-center">
          <h2 className="text-2xl font-bold text-jeopardy-gold mb-2">Final Jeopardy!</h2>
          <p className="text-gray-400 text-lg mb-1 uppercase">{game.final_category_name}</p>
          <p className="text-gray-500 mb-6">Wager $0 - ${maxWager.toLocaleString()}</p>

          <input
            type="number"
            value={finalWagerInput}
            onChange={(e) => setFinalWagerInput(e.target.value)}
            min={0}
            max={maxWager}
            placeholder="Enter your wager"
            className="input-base max-w-xs text-2xl text-center"
            autoFocus
          />
          <button
            onClick={handleFinalWager}
            disabled={busy}
            className="btn-primary w-full max-w-xs mt-4 py-4 text-xl"
          >
            Lock In Wager
          </button>
        </div>
        {error && <p className="text-red-400 text-center text-sm mt-4">{error}</p>}
      </div>
    )
  }

  // ===== FINAL JEOPARDY: Clue display + answer =====
  if (game.phase === 'final_clue' || game.phase === 'final_answering') {
    if (finalAnswerLocked || (myPlayer.final_answer != null && myPlayer.final_answer !== '')) {
      return (
        <div className="min-h-screen flex flex-col bg-jeopardy-dark p-6">
          <PlayerHeader myPlayer={myPlayer} game={game} />
          <div className="flex-1 flex flex-col items-center justify-center">
            <h2 className="text-2xl font-bold text-green-400 mb-4">Answer Submitted!</h2>
            <p className="text-gray-400">Waiting for other players...</p>
          </div>
        </div>
      )
    }

    return (
      <div className="min-h-screen flex flex-col bg-jeopardy-dark">
        <PlayerHeader myPlayer={myPlayer} game={game} />
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <h2 className="text-xl font-bold text-jeopardy-gold mb-2 uppercase">{game.final_category_name}</h2>
          <p className="text-gray-400 text-sm">Look at the TV for the clue!</p>
        </div>

        <div className="sticky bottom-0 bg-jeopardy-dark/95 backdrop-blur-sm border-t border-white/10 p-4 pb-[env(safe-area-inset-bottom,16px)]">
          <div className="w-full max-w-sm mx-auto space-y-3">
            <input
              type="text"
              value={finalAnswerInput}
              onChange={(e) => setFinalAnswerInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFinalAnswer()
              }}
              placeholder="What is..."
              maxLength={200}
              className="input-base text-xl"
              autoFocus
              autoComplete="off"
            />
            <button
              onClick={handleFinalAnswer}
              disabled={!finalAnswerInput.trim() || busy}
              className="btn-primary w-full py-4 text-xl"
            >
              Submit Final Answer
            </button>
            {error && <p className="text-red-400 text-center text-sm">{error}</p>}
          </div>
        </div>
      </div>
    )
  }

  // ===== FINAL REVEAL =====
  if (game.phase === 'final_reveal' || game.phase === 'game_over') {
    return (
      <div className="min-h-screen flex flex-col bg-jeopardy-dark p-6">
        <PlayerHeader myPlayer={myPlayer} game={game} />
        <div className="flex-1 flex flex-col items-center justify-center">
          <h2 className="text-3xl font-bold text-jeopardy-gold mb-4">
            {game.phase === 'game_over' ? 'Game Over!' : 'Final Results...'}
          </h2>
          <p className="text-gray-400 text-lg">Look at the TV!</p>

          {/* Show my result */}
          <div className={`mt-8 px-8 py-6 rounded-2xl text-center ${
            myPlayer.final_correct
              ? 'bg-green-600/20 border border-green-500'
              : 'bg-red-600/20 border border-red-500'
          }`}>
            <p className={`text-xl font-bold ${myPlayer.final_correct ? 'text-green-400' : 'text-red-400'}`}>
              {myPlayer.final_correct ? 'You got it right!' : 'Incorrect'}
            </p>
            <p className={`text-3xl font-bold mt-2 ${myPlayer.score < 0 ? 'text-red-400' : 'text-jeopardy-gold'}`}>
              ${myPlayer.score.toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ===== CLUE RESULT (show who got it right/wrong) =====
  if (game.phase === 'clue_result' && currentClue) {
    const wasCorrect = currentClue.answered_correct === true
    const noOneAnswered = !currentClue.answered_by
    const answerer = currentClue.answered_by
      ? players.find((p) => p.id === currentClue.answered_by)
      : null
    const iWasAnswerer = currentClue.answered_by === myPlayerId
    const clueCategory = categories.find((c) => c.id === currentClue.category_id)
    const isDailyDouble = currentClue.is_daily_double === true
    const swing = isDailyDouble ? (answerer?.final_wager ?? 0) : currentClue.value

    return (
      <div className="min-h-screen flex flex-col bg-jeopardy-dark">
        <PlayerHeader myPlayer={myPlayer} game={game} />

        <div className="flex-1 flex flex-col items-center justify-center p-6">
          {/* Buzz order — surfaced first when 2+ people raced for the buzz */}
          <div className="w-full max-w-sm mb-5">
            <BuzzOrder gameId={game.id} clueId={currentClue.id} players={players} variant="compact" />
          </div>

          {/* Category + Value */}
          {clueCategory && (
            <p className="text-blue-300 text-sm font-bold uppercase tracking-wide mb-1">
              {clueCategory.name}
            </p>
          )}
          <p className="text-jeopardy-gold text-lg font-bold mb-1">
            ${currentClue.value.toLocaleString()}
          </p>
          {isDailyDouble && answerer && (
            <p className="text-jeopardy-gold-light text-xs font-bold uppercase tracking-wider mb-6">
              ⭐ Daily Double — wagered ${swing.toLocaleString()}
            </p>
          )}
          {!isDailyDouble && <div className="mb-5" />}

          {/* Result card */}
          <div className={`w-full max-w-sm px-8 py-8 rounded-2xl text-center ${
            noOneAnswered
              ? 'bg-gray-600/15 border-2 border-gray-500'
              : wasCorrect
                ? 'bg-green-600/15 border-2 border-green-500'
                : 'bg-red-600/15 border-2 border-red-500'
          }`}>
            <p className={`text-5xl font-bold mb-3 ${
              noOneAnswered ? 'text-gray-400' : wasCorrect ? 'text-green-400' : 'text-red-400'
            }`}>
              {noOneAnswered ? '—' : wasCorrect ? '✓' : '✗'}
            </p>
            <p className="text-xl text-white font-semibold mb-1">
              {noOneAnswered
                ? 'No one answered'
                : iWasAnswerer
                  ? (wasCorrect ? 'You got it right!' : 'Incorrect!')
                  : (wasCorrect
                      ? `${answerer?.name || 'Someone'} got it right!`
                      : `${answerer?.name || 'Someone'} got it wrong`)}
            </p>
            {!noOneAnswered && (
              <p className={`text-2xl font-bold mt-2 ${
                wasCorrect ? 'text-green-300' : 'text-red-300'
              }`}>
                {wasCorrect ? '+' : '-'}${swing.toLocaleString()}
              </p>
            )}
          </div>

          {/* Answer + wrong-answer text live on the TV only, not on phones. */}
        </div>
      </div>
    )
  }

  // ===== BOARD SELECTION (active player picks) =====
  if (game.phase === 'board_selection' && isMyTurn) {
    const lc = GAME_LENGTH_CONFIG[game.settings?.gameLength || 'full']
    const roundCats = categories
      .filter((c) => Number(c.round_number) === Number(game.current_round))
      .sort((a, b) => a.position - b.position)
      .slice(0, lc.categories)
    const values = game.current_round === 2 ? lc.values2 : lc.values1
    const colCount = roundCats.length || lc.categories

    return (
      <div className="min-h-screen flex flex-col bg-jeopardy-dark p-2">
        <PlayerHeader myPlayer={myPlayer} game={game} />

        <div className="text-center py-3 mx-2 rounded-xl bg-jeopardy-gold/15 border border-jeopardy-gold/40">
          <span className="text-jeopardy-gold font-bold text-lg">Your turn — pick a clue!</span>
        </div>

        <div className={`flex-1 grid gap-1.5 px-1 pt-2 ${colCount <= 3 ? 'grid-cols-3' : 'grid-cols-6'}`}>
          {roundCats.map((cat) => (
            <div key={cat.id} className="bg-jeopardy-blue rounded p-1.5 flex items-center justify-center min-h-[36px]">
              <span className="text-[9px] font-bold text-white uppercase text-center leading-tight line-clamp-2">
                {cat.name}
              </span>
            </div>
          ))}

          {values.map((value) =>
            roundCats.map((cat) => {
              const clue = clues.find((c) => c.category_id === cat.id && c.value === value)
              const answered = clue?.is_answered ?? false
              const wasCorrect = clue?.answered_correct === true
              const answeredByPlayer =
                answered && clue?.answered_by
                  ? players.find((p) => p.id === clue.answered_by)
                  : null
              return (
                <button
                  key={`${cat.id}-${value}`}
                  onClick={() => clue && !answered && handleSelectClue(clue.id)}
                  disabled={answered}
                  className={`board-cell py-3 min-h-[44px] ${
                    answered
                      ? wasCorrect
                        ? 'board-cell-correct'
                        : 'board-cell-wrong'
                      : ''
                  }`}
                >
                  {answered ? (
                    answeredByPlayer ? (
                      <span className={`text-[8px] font-bold truncate block px-0.5 ${
                        wasCorrect ? 'text-green-300' : 'text-red-400'
                      }`}>
                        {answeredByPlayer.name}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500/70">—</span>
                    )
                  ) : (
                    <span className="text-sm font-bold">{`$${value}`}</span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    )
  }

  // ===== BOARD SELECTION (waiting for other player) =====
  if (game.phase === 'board_selection' && !isMyTurn) {
    const picker = players.find((p) => p.id === game.current_player_id)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark p-6">
        <PlayerHeader myPlayer={myPlayer} game={game} />
        <p className="text-gray-400 text-xl mt-8">
          {picker?.name || 'Someone'} is picking a clue...
        </p>
      </div>
    )
  }

  // ===== BUZZER (clue reading or buzz window) =====
  if (
    (game.phase === 'clue_reading' || game.phase === 'buzz_window') &&
    currentClue
  ) {
    return (
      <div className="min-h-screen flex flex-col bg-jeopardy-dark">
        <PlayerHeader myPlayer={myPlayer} game={game} />

        <div className="flex-1 flex flex-col items-center justify-center px-4 py-6 gap-4 min-h-0">
          {isRebuzz && game.phase === 'buzz_window' && (
            <p className="text-jeopardy-gold text-sm font-bold uppercase tracking-[0.3em]">
              Buzzer Reopened
            </p>
          )}
          {/* Same animated intro + typed reveal the TV shows, synced by the
              server-side clue_reading timestamp. */}
          <AnimatedClueReveal
            key={currentClue.id}
            variant="phone"
            category={categories.find((c) => c.id === currentClue.category_id)?.name ?? null}
            value={currentClue.value}
            question={currentClue.question}
            phaseStartedAt={game.updated_at ? new Date(game.updated_at).getTime() : Date.now()}
            revealDurationMs={
              (game.settings?.reading_period_ms && game.settings.reading_period_ms > 0)
                ? game.settings.reading_period_ms
                : Math.max(3000, Math.min(15000, currentClue.question.length * 55))
            }
          />
          {game.phase === 'buzz_window' && buzzCountdown !== null && (
            <p className={`text-5xl font-bold font-mono ${
              buzzCountdown <= 5 ? 'text-red-400' : 'text-white/60'
            }`}>
              {buzzCountdown}
            </p>
          )}
        </div>

        <div className="p-4 space-y-3">
          {hasTriedAnswer ? (
            <div className="w-full py-8 rounded-2xl bg-red-950/40 border border-red-900/60 text-center">
              <p className="text-red-300 text-xl font-semibold">You got it wrong</p>
              <p className="text-gray-400 text-sm mt-1">Waiting for other players to buzz in...</p>
            </div>
          ) : hasPassed ? (
            <div className="w-full py-8 rounded-2xl bg-gray-800 text-center">
              <p className="text-gray-400 text-xl font-semibold">Passed</p>
              <p className="text-gray-500 text-sm mt-1">Waiting for others...</p>
            </div>
          ) : (
            <>
              <BuzzerButton
                gameId={game.id}
                clueId={currentClue.id}
                playerId={myPlayer.id}
                buzzWindowOpen={game.phase === 'buzz_window' && buzzArmed}
                isBuzzWinner={false}
                isLockedOut={false}
                onBuzz={handleBuzz}
              />
              {game.phase === 'buzz_window' && (
                <button
                  onClick={handlePass}
                  disabled={busy}
                  className="btn-secondary w-full py-4 text-lg active:scale-95"
                >
                  I Don&apos;t Know
                </button>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // ===== ANSWERING =====
  if (game.phase === 'player_answering' && currentClue) {
    const isAnswering = game.current_player_id === myPlayerId

    if (isAnswering) {
      return (
        <div className="min-h-screen flex flex-col bg-jeopardy-dark">
          <PlayerHeader myPlayer={myPlayer} game={game} />

          <div className="flex-1 flex flex-col items-center justify-center p-4">
            <p className="text-jeopardy-gold text-2xl font-bold mb-2">Your turn to answer!</p>
            {answerCountdown !== null && (
              <p className={`text-4xl font-bold mb-4 ${answerCountdown <= 5 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                {answerCountdown}s
              </p>
            )}
          </div>

          {/* Sticky bottom input — stays above mobile keyboard, with voice option */}
          <div className="sticky bottom-0 bg-jeopardy-dark/95 backdrop-blur-sm border-t border-white/10 p-4 pb-[env(safe-area-inset-bottom,16px)]">
            <div className="w-full max-w-sm mx-auto">
              <GameKeyboard
                value={answer}
                onChange={setAnswer}
                onSubmit={handleSubmitAnswer}
                mode="letters"
                placeholder="Type or 🎤 speak your answer..."
                submitLabel="Submit Answer"
                submitDisabled={!answer.trim()}
                maxLength={200}
                secondaryAction={{ label: "I Don't Know", onClick: handlePassAfterBuzz, disabled: busy }}
              />
            </div>
          </div>
        </div>
      )
    }

    const answerer = players.find((p) => p.id === game.current_player_id)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark p-6">
        <PlayerHeader myPlayer={myPlayer} game={game} />
        <p className="text-gray-400 text-xl mt-8">
          {answerer?.name} is answering...
        </p>
      </div>
    )
  }

  // ===== DAILY DOUBLE ANSWERING =====
  if (game.phase === 'daily_double_answering' && isMyTurn && currentClue) {
    return (
      <div className="min-h-screen flex flex-col bg-jeopardy-dark">
        <PlayerHeader myPlayer={myPlayer} game={game} />
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <p className="text-jeopardy-gold text-2xl font-bold mb-2">Daily Double!</p>
          <p className="text-gray-400">Type your answer below</p>
        </div>
        <div className="sticky bottom-0 bg-jeopardy-dark/95 backdrop-blur-sm border-t border-white/10 p-4 pb-[env(safe-area-inset-bottom,16px)]">
          <div className="w-full max-w-sm mx-auto">
            <GameKeyboard
              value={answer}
              onChange={setAnswer}
              onSubmit={handleSubmitAnswer}
              mode="letters"
              placeholder="Type or 🎤 speak your answer..."
              submitLabel="Submit Answer"
              submitDisabled={!answer.trim()}
              maxLength={200}
            />
          </div>
        </div>
      </div>
    )
  }

  // ===== DAILY DOUBLE WAGER =====
  if (game.phase === 'daily_double_wager' && isMyTurn) {
    const wagerVals = GAME_LENGTH_CONFIG[game.settings?.gameLength || 'full']
    const maxRoundVal = (game.current_round === 2 ? wagerVals.values2 : wagerVals.values1).slice(-1)[0] || 1000
    const maxWager = Math.max(myPlayer.score, maxRoundVal)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark p-6">
        <PlayerHeader myPlayer={myPlayer} game={game} />
        <h2 className="text-3xl font-bold text-jeopardy-gold mb-6 mt-8">Daily Double!</h2>
        <p className="text-gray-400 mb-4">Wager $5 - ${maxWager.toLocaleString()}</p>
        <input
          type="number"
          value={wager}
          onChange={(e) => {
            // Clamp on type so a player under $1000 can't stage a wager they can't afford
            const raw = e.target.value.replace(/[^0-9]/g, '')
            if (!raw) { setWager(''); return }
            const n = parseInt(raw, 10)
            setWager(String(Math.min(n, maxWager)))
          }}
          min={5}
          max={maxWager}
          inputMode="numeric"
          className="input-base max-w-xs text-2xl text-center"
          autoFocus
        />
        <button
          onClick={handleSubmitWager}
          className="btn-primary w-full max-w-xs mt-4 py-4 text-xl"
        >
          Lock In Wager
        </button>
      </div>
    )
  }

  // ===== DAILY DOUBLE (other players watching) =====
  if ((game.phase === 'daily_double_wager' || game.phase === 'daily_double_answering') && !isMyTurn) {
    const ddPlayer = players.find((p) => p.id === game.current_player_id)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark p-6">
        <PlayerHeader myPlayer={myPlayer} game={game} />
        <h2 className="text-3xl font-bold text-jeopardy-gold mb-4 mt-8 animate-pulse">Daily Double!</h2>
        <p className="text-white text-xl mb-2">{ddPlayer?.name || 'Someone'}</p>
        <p className="text-gray-400">
          {game.phase === 'daily_double_wager' ? 'is making their wager...' : 'is answering...'}
        </p>
      </div>
    )
  }

  // ===== DEFAULT / WAITING STATE =====
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark p-6">
      <PlayerHeader myPlayer={myPlayer} game={game} />
      <p className="text-gray-400 text-lg mt-8">Watch the TV...</p>
      <div className="mt-4 flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-xs text-gray-500">{connected ? 'Connected' : 'Reconnecting...'}</span>
      </div>
    </div>
  )
}

function PlayerHeader({ myPlayer, game }: { myPlayer: { name: string; score: number }; game: { current_round: number } }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-black/30 rounded-b-xl">
      <span className="font-semibold text-white">{myPlayer.name}</span>
      <span className={`text-xl font-bold ${myPlayer.score < 0 ? 'text-red-400' : 'text-jeopardy-gold'}`}>
        ${myPlayer.score.toLocaleString()}
      </span>
    </div>
  )
}

/**
 * Fetches the answerer's buzz row to show what they typed when they got the
 * clue wrong (or auto-passed with no text). Renders nothing when the answer
 * was correct or nobody buzzed.
 */
function WrongAnswerDisplay({
  gameId,
  clueId,
  answererId,
}: {
  gameId: string
  clueId: string
  answererId: string | null | undefined
}) {
  const [typed, setTyped] = useState<string | null>(null)

  useEffect(() => {
    if (!answererId) { setTyped(null); return }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('buzzes')
        .select('answer, is_correct')
        .eq('game_id', gameId)
        .eq('clue_id', clueId)
        .eq('player_id', answererId)
        .maybeSingle()
      if (cancelled) return
      // Show only when they got it wrong
      if (data && data.is_correct === false) {
        setTyped((data.answer ?? '').trim())
      } else {
        setTyped(null)
      }
    })()
    return () => { cancelled = true }
  }, [gameId, clueId, answererId])

  if (typed === null) return null
  return (
    <div className="mt-5 text-center">
      <p className="text-gray-500 text-sm mb-1">Their answer:</p>
      <p className="text-red-300 text-lg font-semibold italic">
        {typed ? `"${typed}"` : '(no answer)'}
      </p>
    </div>
  )
}
