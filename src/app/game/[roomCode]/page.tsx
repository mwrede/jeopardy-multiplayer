'use client'

import { useParams } from 'next/navigation'
import { useGameChannel } from '@/hooks/useGameChannel'
import { BuzzerButton } from '@/components/BuzzerButton'
import {
  setReady,
  removePlayer,
  startGame,
  startGameFromSource,
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
  const [buzzCountdown, setBuzzCountdown] = useState<number | null>(null)
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

  // Buzz window countdown timer on player view
  useEffect(() => {
    if (!game || game.phase !== 'buzz_window') {
      setBuzzCountdown(null)
      if (buzzIntervalRef.current) clearInterval(buzzIntervalRef.current)
      buzzIntervalRef.current = null
      return
    }

    const totalMs = game.settings?.buzz_window_ms ?? 15000
    // Sync timer to when the buzz window actually opened
    const startTime = game.buzz_window_start ? new Date(game.buzz_window_start).getTime() : Date.now()
    const elapsed = Date.now() - startTime
    const remainingMs = Math.max(0, totalMs - elapsed)
    setBuzzCountdown(Math.ceil(remainingMs / 1000))

    buzzIntervalRef.current = setInterval(() => {
      const remaining = Math.max(0, totalMs - (Date.now() - startTime))
      setBuzzCountdown(Math.ceil(remaining / 1000))
    }, 1000)

    return () => {
      if (buzzIntervalRef.current) clearInterval(buzzIntervalRef.current)
    }
  }, [game?.phase, game?.id])

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

  // Wrap actions: write to DB, refresh, show errors
  async function doAction(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await fn()
      await refreshState()
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  const handleReady = () => doAction(async () => {
    if (!myPlayer) return
    await setReady(myPlayer.id, !myPlayer.is_ready)
  })

  const handleStartGame = () => doAction(async () => {
    if (!game) return
    // Check if a specific J-Archive game was selected by the host (stored in settings)
    const sourceGameId = (game.settings as any)?.sourceGameId
    if (sourceGameId) {
      await startGameFromSource(game.id, sourceGameId)
    } else {
      await startGame(game.id)
    }
  })

  const handleSelectClue = (clueId: string) => doAction(async () => {
    if (!game || !myPlayer) return
    await selectClue(game.id, clueId, myPlayer.id)
  })

  const handleBuzz = () => doAction(async () => {
    if (!game || !myPlayer || !game.current_clue_id) return
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
    await submitAnswer(game.id, game.current_clue_id, myPlayer.id, answer.trim())
    setAnswer('')
  })

  const handlePassAfterBuzz = () => doAction(async () => {
    if (!game || !myPlayer || !game.current_clue_id) return
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

        <button
          onClick={handleReady}
          disabled={busy}
          className={`w-full max-w-sm py-5 rounded-2xl font-bold text-xl transition-all active:scale-[0.98] disabled:opacity-50 ${
            myPlayer.is_ready
              ? 'btn-secondary'
              : 'bg-green-600 text-white'
          }`}
        >
          {myPlayer.is_ready ? 'Cancel Ready' : 'Ready Up'}
        </button>

        {players.every((p) => p.is_ready) && players.length >= 1 && (
          <button
            onClick={handleStartGame}
            disabled={busy}
            className="btn-primary w-full max-w-sm mt-3 py-5 text-xl"
          >
            {busy ? 'Starting...' : 'Start Game'}
          </button>
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

    return (
      <div className="min-h-screen flex flex-col bg-jeopardy-dark">
        <PlayerHeader myPlayer={myPlayer} game={game} />

        <div className="flex-1 flex flex-col items-center justify-center p-6">
          {/* Category + Value */}
          {clueCategory && (
            <p className="text-blue-300 text-sm font-bold uppercase tracking-wide mb-1">
              {clueCategory.name}
            </p>
          )}
          <p className="text-jeopardy-gold text-lg font-bold mb-6">
            ${currentClue.value.toLocaleString()}
          </p>

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
                {wasCorrect ? '+' : '-'}${currentClue.value.toLocaleString()}
              </p>
            )}
          </div>

          {/* Correct answer */}
          <div className="mt-6 text-center">
            <p className="text-gray-500 text-sm mb-1">Correct answer:</p>
            <p className="text-white text-lg font-bold">{currentClue.answer}</p>
          </div>
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

        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <p className="text-gray-400 text-center text-lg mb-4">
            Look at the TV for the clue!
          </p>
          {/* Countdown timer */}
          {game.phase === 'buzz_window' && buzzCountdown !== null && (
            <p className={`text-4xl font-bold font-mono ${
              buzzCountdown <= 5 ? 'text-red-400' : 'text-white/60'
            }`}>
              {buzzCountdown}
            </p>
          )}
        </div>

        <div className="p-4 space-y-3">
          {hasPassed ? (
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
                buzzWindowOpen={game.phase === 'buzz_window'}
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

          {/* Sticky bottom input — stays above mobile keyboard */}
          <div className="sticky bottom-0 bg-jeopardy-dark/95 backdrop-blur-sm border-t border-white/10 p-4 pb-[env(safe-area-inset-bottom,16px)]">
            <div className="w-full max-w-sm mx-auto space-y-3">
              <input
                ref={inputRef}
                type="text"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmitAnswer()
                }}
                placeholder="Type your answer..."
                maxLength={200}
                className="input-base text-xl"
                autoFocus
                autoComplete="off"
              />
              <button
                onClick={handleSubmitAnswer}
                disabled={!answer.trim()}
                className="btn-primary w-full py-4 text-xl"
              >
                Submit Answer
              </button>
              <button
                onClick={handlePassAfterBuzz}
                disabled={busy}
                className="btn-secondary w-full py-3 text-lg active:scale-95"
              >
                I Don&apos;t Know
              </button>
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
          <div className="w-full max-w-sm mx-auto space-y-3">
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitAnswer() }}
              placeholder="Type your answer..."
              maxLength={200}
              className="input-base text-xl"
              autoFocus
              autoComplete="off"
            />
            <button onClick={handleSubmitAnswer} disabled={!answer.trim()}
              className="btn-primary w-full py-4 text-xl">Submit Answer</button>
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
          onChange={(e) => setWager(e.target.value)}
          min={5}
          max={maxWager}
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
