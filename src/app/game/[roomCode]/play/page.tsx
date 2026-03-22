'use client'

import { useParams, useRouter } from 'next/navigation'
import { useGameChannel } from '@/hooks/useGameChannel'
import { GameBoard } from '@/components/GameBoard'
import { BuzzerButton } from '@/components/BuzzerButton'
import { GameKeyboard } from '@/components/GameKeyboard'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  setReady,
  startGame,
  startGameFromSource,
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
} from '@/lib/game-api'
import { GAME_LENGTH_CONFIG } from '@/types/game'
import {
  playCorrectSound, playWrongSound, playTimeUpSound,
  playDailyDoubleSound, playBuzzSound, playTickSound, playSelectSound,
} from '@/lib/sounds'

/**
 * MULTIPLAYER PLAY PAGE
 *
 * Combined view: board + clues + buzzer + answers all on one screen.
 * No separate TV display needed. Each player sees everything on their device.
 * Auto-transitions (timers) run on every client.
 */
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
  const [gameAirDate, setGameAirDate] = useState<string | null>(null)

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
    const delay = game.settings?.reading_period_ms ?? 0
    transitionRef.current = setTimeout(async () => {
      await supabase.from('games').update({
        phase: 'buzz_window', buzz_window_open: true,
        buzz_window_start: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', game.id)
    }, delay)
    return () => { if (transitionRef.current) clearTimeout(transitionRef.current) }
  }, [game?.phase, game?.id])

  // Buzz countdown + auto-skip (synced to buzz_window_start)
  const buzzTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'buzz_window') {
      setBuzzCountdown(null)
      if (buzzTimeoutRef.current) clearTimeout(buzzTimeoutRef.current)
      if (buzzIntervalRef.current) clearInterval(buzzIntervalRef.current)
      return
    }
    const totalMs = game.settings?.buzz_window_ms ?? 15000
    // Sync timer to when the buzz window actually opened
    const startTime = game.buzz_window_start ? new Date(game.buzz_window_start).getTime() : Date.now()
    const elapsed = Date.now() - startTime
    const remainingMs = Math.max(0, totalMs - elapsed)
    setBuzzCountdown(Math.ceil(remainingMs / 1000))
    buzzIntervalRef.current = setInterval(() => {
      const now = Date.now()
      const remaining = Math.max(0, totalMs - (now - startTime))
      setBuzzCountdown(Math.ceil(remaining / 1000))
    }, 1000)
    // Auto-skip using synced remaining time
    if (remainingMs > 0) {
      buzzTimeoutRef.current = setTimeout(async () => {
        if (game.current_clue_id) await skipClue(game.id, game.current_clue_id)
      }, remainingMs)
    }
    return () => {
      if (buzzTimeoutRef.current) clearTimeout(buzzTimeoutRef.current)
      if (buzzIntervalRef.current) clearInterval(buzzIntervalRef.current)
    }
  }, [game?.phase, game?.id])

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
      if (game.current_clue_id && myPlayerId)
        await passAfterBuzz(game.id, game.current_clue_id, myPlayerId)
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

  // Auto-advance finals
  useEffect(() => {
    if (!game || game.phase !== 'final_wager') return
    if (players.length > 0 && players.every((p) => p.final_wager != null)) advanceToFinalClue(game.id)
  }, [game?.phase, game?.id, players])

  useEffect(() => {
    if (!game || game.phase !== 'final_answering') return
    if (players.length > 0 && players.every((p) => p.final_answer != null && p.final_answer !== '')) startFinalReveal(game.id)
  }, [game?.phase, game?.id, players])

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
    catch (e: any) { setError(e.message || 'Something went wrong'); console.error(e) }
    finally { setBusy(false) }
  }

  const handleReady = () => doAction(async () => {
    if (!myPlayer) return
    await setReady(myPlayer.id, !myPlayer.is_ready)
  })

  const handleStartGame = () => doAction(async () => {
    if (!game) return
    // Check if a specific J-Archive game was selected by the host (stored in settings)
    const sourceGameId = (game.settings as any)?.sourceGameId
    console.log('[handleStartGame] game.settings:', JSON.stringify(game.settings), 'sourceGameId:', sourceGameId)
    if (sourceGameId) {
      await startGameFromSource(game.id, sourceGameId)
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
    // Cancel auto-skip timeout so passOnClue can handle the skip
    if (buzzTimeoutRef.current) { clearTimeout(buzzTimeoutRef.current); buzzTimeoutRef.current = null }
    // Record pass and check if all players have passed
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

  const currentClue = game.current_clue_id ? clues.find((c) => c.id === game.current_clue_id) : null
  const currentPlayer = players.find((p) => p.id === game.current_player_id)

  // === LOBBY ===
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
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-[10px] text-gray-500 font-mono">{game.room_code}</span>
        {gameAirDate && (
          <span className="text-[10px] text-gray-500">
            {new Date(gameAirDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        )}
      </div>
      <div className="flex gap-2 px-2 pb-2 overflow-x-auto">
        {players.sort((a, b) => b.score - a.score).map((p) => (
          <div key={p.id} className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-center min-w-[80px] border-b-3 ${
            p.id === game.current_player_id ? 'bg-jeopardy-blue-cell/50 border-b-2 border-jeopardy-gold' : 'bg-jeopardy-blue-dark/30'
          } ${p.id === myPlayerId ? 'ring-1 ring-blue-400/30' : ''}`}>
            <p className="text-[10px] text-white/60 truncate font-semibold uppercase">{p.name}</p>
            <p className={`text-sm font-bold ${p.score < 0 ? 'text-red-400' : 'text-jeopardy-gold-light'}`}>
              ${p.score.toLocaleString()}
            </p>
          </div>
        ))}
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

    return (
      <div className="min-h-screen flex flex-col bg-jeopardy-dark">
        <Scoreboard />
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          {clueCategory && <p className="text-blue-300 text-sm font-bold uppercase mb-1">{clueCategory.name}</p>}
          <p className="text-jeopardy-gold text-lg font-bold mb-4">${currentClue.value.toLocaleString()}</p>
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
                {answerer.name} {wasCorrect ? `+$${currentClue.value.toLocaleString()}` : `-$${currentClue.value.toLocaleString()}`}
              </p>
            )}
          </div>
          <div className="mt-4 text-center">
            <p className="text-gray-500 text-sm mb-1">Answer:</p>
            <p className="text-white text-lg font-bold">{currentClue.answer}</p>
          </div>
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
          <p className="text-gray-400 mt-4">Waiting for others...</p>
        </div>
      )
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark p-6">
        <h2 className="text-2xl font-bold text-jeopardy-gold mb-2">Final Jeopardy!</h2>
        <p className="text-gray-400 mb-4 uppercase">{game.final_category_name}</p>
        <p className="text-gray-500 mb-6">Wager $0 - ${maxWager.toLocaleString()}</p>
        <input type="number" value={finalWagerInput} onChange={(e) => setFinalWagerInput(e.target.value)}
          min={0} max={maxWager} placeholder="Enter wager" className="input-base max-w-xs text-2xl text-center" autoFocus />
        <button onClick={handleFinalWager} disabled={busy} className="btn-primary w-full max-w-xs mt-4 py-4 text-xl">Lock In Wager</button>
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
      <div className="min-h-screen flex flex-col bg-jeopardy-dark">
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <h2 className="text-xl font-bold text-jeopardy-gold mb-2 uppercase">{game.final_category_name}</h2>
          <p className="text-2xl text-white text-center leading-relaxed font-serif max-w-lg mb-6">{game.final_clue_text}</p>
        </div>
        <div className="sticky bottom-0 bg-jeopardy-dark/95 backdrop-blur-sm border-t border-white/10 p-4 pb-[env(safe-area-inset-bottom,16px)]">
          <div className="w-full max-w-sm mx-auto space-y-3">
            <input type="text" value={finalAnswerInput} onChange={(e) => setFinalAnswerInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleFinalAnswer() }}
              placeholder="What is..." maxLength={200} className="input-base text-xl" autoFocus autoComplete="off" />
            <button onClick={handleFinalAnswer} disabled={!finalAnswerInput.trim() || busy}
              className="btn-primary w-full py-4 text-xl">Submit Final Answer</button>
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
      <div className="min-h-screen flex flex-col bg-jeopardy-dark">
        <Scoreboard />
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-4">
          <h2 className="text-4xl font-bold text-jeopardy-gold mb-4 animate-pulse">Daily Double!</h2>
          {clueCategory && (
            <p className="text-blue-300 text-lg font-bold uppercase tracking-wide mb-2">{clueCategory.name}</p>
          )}
          <p className="text-jeopardy-gold text-xl font-bold mb-6">${currentClue.value.toLocaleString()}</p>
          {isMyTurn ? (
            <p className="text-white text-lg">Make your wager below</p>
          ) : (
            <p className="text-gray-400 text-lg">{currentPlayer?.name} is making their wager...</p>
          )}
        </div>
        <div className="sticky bottom-0 bg-jeopardy-dark/95 backdrop-blur-sm border-t border-white/10 p-3 pb-[env(safe-area-inset-bottom,12px)]">
          {isMyTurn ? (
            <div className="w-full max-w-sm mx-auto space-y-2">
              <input type="number" value={wager} onChange={(e) => setWager(e.target.value)}
                placeholder="Enter wager" className="input-base text-xl text-center" autoFocus />
              <button onClick={handleSubmitWager} className="btn-primary w-full py-3 text-lg">Lock In Wager</button>
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
    <div className="min-h-screen flex flex-col bg-jeopardy-dark">
      <Scoreboard />

      {showClue && currentClue ? (
        <>
          {/* Clue display */}
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-4">
            {(() => {
              const cat = categories.find((c) => c.id === currentClue.category_id)
              return cat ? <p className="text-blue-300 text-sm font-bold uppercase tracking-wide mb-1">{cat.name}</p> : null
            })()}
            <p className="text-jeopardy-gold text-xl font-bold mb-4">${currentClue.value.toLocaleString()}</p>
            <p className="text-xl md:text-2xl text-white text-center leading-relaxed font-serif max-w-lg">
              {currentClue.question}
            </p>

            {/* Phase indicators */}
            {game.phase === 'buzz_window' && buzzCountdown !== null && (
              <p className={`text-3xl font-bold font-mono mt-4 ${buzzCountdown <= 5 ? 'text-red-400' : 'text-white/60'}`}>
                {buzzCountdown}
              </p>
            )}
            {game.phase === 'player_answering' && (
              <div className="mt-4 text-center">
                <p className="text-green-400 font-bold">
                  {game.current_player_id === myPlayerId ? 'Your turn to answer!' : `${currentPlayer?.name} is answering...`}
                </p>
                {answerCountdown !== null && game.current_player_id === myPlayerId && (
                  <p className={`text-2xl font-bold mt-1 ${answerCountdown <= 5 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                    {answerCountdown}s
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Bottom controls */}
          <div className="sticky bottom-0 bg-jeopardy-dark/95 backdrop-blur-sm border-t border-white/10 p-3 pb-[env(safe-area-inset-bottom,12px)]">
            {game.phase === 'daily_double_answering' && !isMyTurn ? (
              <div className="text-center py-4">
                <p className="text-jeopardy-gold font-bold text-lg animate-pulse">Daily Double!</p>
                <p className="text-gray-400 text-sm">{currentPlayer?.name} is answering...</p>
              </div>
            ) : game.phase === 'daily_double_answering' && isMyTurn ? (
              <div className="w-full max-w-sm mx-auto space-y-2">
                <input ref={inputRef} type="text" value={answer} onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitAnswer() }}
                  placeholder="Type your answer..." maxLength={200} className="input-base text-lg" autoFocus autoComplete="off" />
                <button onClick={handleSubmitAnswer} disabled={!answer.trim()} className="btn-primary w-full py-3 text-lg">Submit Answer</button>
              </div>
            ) : game.phase === 'player_answering' && game.current_player_id === myPlayerId ? (
              <div className="w-full max-w-sm mx-auto space-y-2">
                <input ref={inputRef} type="text" value={answer} onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitAnswer() }}
                  placeholder="Type your answer..." maxLength={200} className="input-base text-lg" autoFocus autoComplete="off" />
                <div className="flex gap-2">
                  <button onClick={handleSubmitAnswer} disabled={!answer.trim()} className="btn-primary flex-1 py-3 text-lg">Submit</button>
                  <button onClick={handlePassAfterBuzz} disabled={busy} className="btn-secondary px-4 py-3 text-sm">Pass</button>
                </div>
              </div>
            ) : (game.phase === 'buzz_window' || game.phase === 'clue_reading') ? (
              hasPassed ? (
                <div className="text-center py-4"><p className="text-gray-400">Passed</p></div>
              ) : (
                <div className="space-y-2">
                  <BuzzerButton gameId={game.id} clueId={currentClue.id} playerId={myPlayer.id}
                    buzzWindowOpen={game.phase === 'buzz_window'} isBuzzWinner={false} isLockedOut={false} onBuzz={handleBuzz} />
                  {game.phase === 'buzz_window' && (
                    <button onClick={handlePass} disabled={busy} className="btn-secondary w-full py-3 text-sm">I Don&apos;t Know</button>
                  )}
                </div>
              )
            ) : (
              <div className="text-center py-4"><p className="text-gray-500">Waiting...</p></div>
            )}
          </div>
        </>
      ) : (
        /* Board view */
        <div className="flex-1">
          <GameBoard game={game} categories={categories} clues={clues} players={players}
            myPlayerId={myPlayerId} isMyTurn={isMyTurn} />
        </div>
      )}

      {/* Connection indicator */}
      <div className="fixed top-2 right-2">
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
      </div>
    </div>
  )
}
