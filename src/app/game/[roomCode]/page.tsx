'use client'

import { useParams } from 'next/navigation'
import { useGameChannel } from '@/hooks/useGameChannel'
import { BuzzerButton } from '@/components/BuzzerButton'
import {
  setReady,
  startGame,
  selectClue,
  submitAnswer,
  submitWager,
  submitBuzz,
  submitFinalWager,
  submitFinalAnswer,
  advanceToFinalClue,
  advanceToFinalAnswering,
  startFinalReveal,
} from '@/lib/game-api'
import { useState, useRef, useEffect } from 'react'

/**
 * PLAYER VIEW (Phone)
 *
 * Jackbox-style phone controller.
 * All actions just write to the DB — the useGameChannel hook
 * picks up changes via postgres_changes + polling and syncs all clients.
 */

const ROUND_VALUES: Record<number, number[]> = {
  1: [200, 400, 600, 800, 1000],
  2: [400, 800, 1200, 1600, 2000],
}

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
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset final locks when phase changes
  useEffect(() => {
    if (game?.phase === 'final_wager') {
      setFinalWagerLocked(myPlayer?.final_wager != null)
      setFinalWagerInput('')
    }
    if (game?.phase === 'final_clue' || game?.phase === 'final_answering') {
      setFinalAnswerLocked(myPlayer?.final_answer != null && myPlayer?.final_answer !== '')
      setFinalAnswerInput('')
    }
  }, [game?.phase])

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
    await startGame(game.id)
  })

  const handleSelectClue = (clueId: string) => doAction(async () => {
    if (!game || !myPlayer) return
    await selectClue(game.id, clueId, myPlayer.id)
  })

  const handleBuzz = () => doAction(async () => {
    if (!game || !myPlayer || !game.current_clue_id) return
    await submitBuzz(game.id, game.current_clue_id, myPlayer.id)
  })

  const handleSubmitAnswer = () => doAction(async () => {
    if (!game || !myPlayer || !game.current_clue_id || !answer.trim()) return
    await submitAnswer(game.id, game.current_clue_id, myPlayer.id, answer.trim())
    setAnswer('')
  })

  const handleSubmitWager = () => doAction(async () => {
    if (!game || !myPlayer) return
    const maxWager = Math.max(myPlayer.score, ROUND_VALUES[game.current_round]?.slice(-1)[0] || 1000)
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
        <h2 className="text-3xl font-bold text-jeopardy-gold mb-2">JEOPARDY!</h2>
        <p className="text-gray-400 mb-8">Room {game.room_code}</p>

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
              <span className={`text-sm font-semibold ${p.is_ready ? 'text-green-400' : 'text-gray-500'}`}>
                {p.is_ready ? 'Ready' : 'Not ready'}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={handleReady}
          disabled={busy}
          className={`w-full max-w-sm py-5 rounded-2xl font-bold text-xl transition-all disabled:opacity-50 ${
            myPlayer.is_ready
              ? 'bg-gray-700 text-gray-300'
              : 'bg-green-600 text-white'
          }`}
        >
          {myPlayer.is_ready ? 'Cancel Ready' : 'Ready Up'}
        </button>

        {players.every((p) => p.is_ready) && players.length >= 1 && (
          <button
            onClick={handleStartGame}
            disabled={busy}
            className="w-full max-w-sm mt-3 py-5 rounded-2xl font-bold text-xl bg-jeopardy-gold text-jeopardy-dark disabled:opacity-50"
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
            className="w-full max-w-xs bg-white/10 border border-white/20 rounded-xl px-4 py-4 text-white text-2xl text-center focus:outline-none focus:border-jeopardy-gold"
            autoFocus
          />
          <button
            onClick={handleFinalWager}
            disabled={busy}
            className="w-full max-w-xs mt-4 bg-jeopardy-gold text-jeopardy-dark py-4 rounded-xl font-bold text-xl disabled:opacity-50"
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
      <div className="min-h-screen flex flex-col bg-jeopardy-dark p-6">
        <PlayerHeader myPlayer={myPlayer} game={game} />
        <div className="flex-1 flex flex-col items-center justify-center">
          <h2 className="text-xl font-bold text-jeopardy-gold mb-2 uppercase">{game.final_category_name}</h2>
          <p className="text-gray-400 text-sm mb-6">Look at the TV for the clue!</p>

          <input
            type="text"
            value={finalAnswerInput}
            onChange={(e) => setFinalAnswerInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleFinalAnswer()
            }}
            placeholder="What is..."
            maxLength={200}
            className="w-full max-w-sm bg-white/10 border border-white/20 rounded-xl px-4 py-4 text-white text-xl placeholder:text-gray-500 focus:outline-none focus:border-jeopardy-gold"
            autoFocus
            autoComplete="off"
          />
          <button
            onClick={handleFinalAnswer}
            disabled={!finalAnswerInput.trim() || busy}
            className="w-full max-w-sm mt-4 bg-jeopardy-gold text-jeopardy-dark py-4 rounded-xl font-bold text-xl disabled:opacity-50"
          >
            Submit Final Answer
          </button>
        </div>
        {error && <p className="text-red-400 text-center text-sm mt-4">{error}</p>}
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
    const answerer = players.find((p) => p.id === game.current_player_id)
    const wasCorrect = currentClue.answered_by != null
    const iWasAnswerer = game.current_player_id === myPlayerId
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
            wasCorrect
              ? 'bg-green-600/15 border-2 border-green-500'
              : 'bg-red-600/15 border-2 border-red-500'
          }`}>
            <p className={`text-5xl font-bold mb-3 ${
              wasCorrect ? 'text-green-400' : 'text-red-400'
            }`}>
              {wasCorrect ? '✓' : '✗'}
            </p>
            <p className="text-xl text-white font-semibold mb-1">
              {iWasAnswerer
                ? (wasCorrect ? 'You got it right!' : 'Incorrect!')
                : (wasCorrect
                    ? `${answerer?.name || 'Someone'} got it right!`
                    : `${answerer?.name || 'Someone'} got it wrong`)}
            </p>
            <p className={`text-2xl font-bold mt-2 ${
              wasCorrect ? 'text-green-300' : 'text-red-300'
            }`}>
              {wasCorrect ? '+' : '-'}${currentClue.value.toLocaleString()}
            </p>
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
    const roundCats = categories
      .filter((c) => Number(c.round_number) === Number(game.current_round))
      .sort((a, b) => a.position - b.position)
      .slice(0, 6)
    const values = ROUND_VALUES[game.current_round] || ROUND_VALUES[1]

    return (
      <div className="min-h-screen flex flex-col bg-jeopardy-dark p-2">
        <PlayerHeader myPlayer={myPlayer} game={game} />

        <p className="text-center text-jeopardy-gold font-bold text-lg py-2">
          Pick a clue!
        </p>

        <div className="flex-1 grid grid-cols-6 gap-1">
          {roundCats.map((cat) => (
            <div key={cat.id} className="bg-jeopardy-blue rounded p-1 flex items-center justify-center">
              <span className="text-[8px] font-bold text-white uppercase text-center leading-tight">
                {cat.name}
              </span>
            </div>
          ))}

          {values.map((value) =>
            roundCats.map((cat) => {
              const clue = clues.find((c) => c.category_id === cat.id && c.value === value)
              const answered = clue?.is_answered ?? false
              const answeredByPlayer =
                answered && clue?.answered_by
                  ? players.find((p) => p.id === clue.answered_by)
                  : null
              return (
                <button
                  key={`${cat.id}-${value}`}
                  onClick={() => clue && !answered && handleSelectClue(clue.id)}
                  disabled={answered}
                  className={`board-cell py-2 ${
                    answered
                      ? answeredByPlayer
                        ? 'board-cell-correct'
                        : 'board-cell-wrong'
                      : ''
                  }`}
                >
                  {answered ? (
                    answeredByPlayer ? (
                      <span className="text-[7px] text-green-300 font-bold truncate block px-0.5">
                        {answeredByPlayer.name}
                      </span>
                    ) : (
                      <span className="text-xs text-red-400/70">✗</span>
                    )
                  ) : (
                    <span className="text-sm">{`$${value}`}</span>
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

        <div className="flex-1 flex items-center justify-center px-6">
          <p className="text-gray-400 text-center text-lg">
            Look at the TV for the clue!
          </p>
        </div>

        <div className="p-4">
          <BuzzerButton
            gameId={game.id}
            clueId={currentClue.id}
            playerId={myPlayer.id}
            buzzWindowOpen={game.phase === 'buzz_window'}
            isBuzzWinner={false}
            isLockedOut={false}
            onBuzz={handleBuzz}
          />
        </div>
      </div>
    )
  }

  // ===== ANSWERING =====
  if (game.phase === 'player_answering' && currentClue) {
    const isAnswering = game.current_player_id === myPlayerId

    if (isAnswering) {
      return (
        <div className="min-h-screen flex flex-col bg-jeopardy-dark p-4">
          <PlayerHeader myPlayer={myPlayer} game={game} />

          <div className="flex-1 flex flex-col items-center justify-center">
            <p className="text-jeopardy-gold text-2xl font-bold mb-6">Your turn to answer!</p>

            <div className="w-full max-w-sm space-y-4">
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
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-4 text-white text-xl placeholder:text-gray-500 focus:outline-none focus:border-jeopardy-gold"
                autoFocus
                autoComplete="off"
              />
              <button
                onClick={handleSubmitAnswer}
                disabled={!answer.trim()}
                className="w-full bg-jeopardy-gold text-jeopardy-dark py-4 rounded-xl font-bold text-xl disabled:opacity-50"
              >
                Submit Answer
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

  // ===== DAILY DOUBLE WAGER =====
  if (game.phase === 'daily_double_wager' && isMyTurn) {
    const maxWager = Math.max(myPlayer.score, ROUND_VALUES[game.current_round]?.slice(-1)[0] || 1000)
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
          className="w-full max-w-xs bg-white/10 border border-white/20 rounded-xl px-4 py-4 text-white text-2xl text-center focus:outline-none focus:border-jeopardy-gold"
          autoFocus
        />
        <button
          onClick={handleSubmitWager}
          className="w-full max-w-xs mt-4 bg-jeopardy-gold text-jeopardy-dark py-4 rounded-xl font-bold text-xl"
        >
          Lock In Wager
        </button>
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
