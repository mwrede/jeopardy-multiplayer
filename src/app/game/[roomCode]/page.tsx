'use client'

import { useParams } from 'next/navigation'
import { useGameChannel } from '@/hooks/useGameChannel'
import { BuzzerButton } from '@/components/BuzzerButton'
import { setReady, startGame, selectClue, submitAnswer, submitWager, submitBuzz } from '@/lib/game-api'
import { useState, useRef } from 'react'

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
  const inputRef = useRef<HTMLInputElement>(null)

  // Actions: just write to DB, then trigger an immediate refresh
  async function handleReady() {
    if (!myPlayer) return
    try {
      await setReady(myPlayer.id, !myPlayer.is_ready)
      await refreshState()
    } catch (e) {
      console.error('Ready failed:', e)
    }
  }

  async function handleStartGame() {
    if (!game) return
    try {
      await startGame(game.id)
      await refreshState()
    } catch (e) {
      console.error('Start game failed:', e)
    }
  }

  async function handleSelectClue(clueId: string) {
    if (!game || !myPlayer) return
    try {
      await selectClue(game.id, clueId, myPlayer.id)
      await refreshState()
    } catch (e) {
      console.error('Select clue failed:', e)
    }
  }

  async function handleBuzz() {
    if (!game || !myPlayer || !game.current_clue_id) return
    try {
      await submitBuzz(game.id, game.current_clue_id, myPlayer.id)
      await refreshState()
    } catch (e) {
      console.error('Buzz failed:', e)
    }
  }

  async function handleSubmitAnswer() {
    if (!game || !myPlayer || !game.current_clue_id || !answer.trim()) return
    try {
      await submitAnswer(game.id, game.current_clue_id, myPlayer.id, answer.trim())
      setAnswer('')
      await refreshState()
    } catch (e) {
      console.error('Submit answer failed:', e)
    }
  }

  async function handleSubmitWager() {
    if (!game || !myPlayer) return
    const maxWager = Math.max(myPlayer.score, ROUND_VALUES[game.current_round]?.slice(-1)[0] || 1000)
    const w = parseInt(wager) || 5
    try {
      await submitWager(game.id, myPlayer.id, Math.min(Math.max(w, 5), maxWager))
      setWager('')
      await refreshState()
    } catch (e) {
      console.error('Submit wager failed:', e)
    }
  }

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
          className={`w-full max-w-sm py-5 rounded-2xl font-bold text-xl transition-all ${
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
            className="w-full max-w-sm mt-3 py-5 rounded-2xl font-bold text-xl bg-jeopardy-gold text-jeopardy-dark"
          >
            Start Game
          </button>
        )}
      </div>
    )
  }

  // ===== BOARD SELECTION (active player picks) =====
  if (game.phase === 'board_selection' && isMyTurn) {
    const roundCats = categories
      .filter((c) => c.round_number === game.current_round)
      .sort((a, b) => a.position - b.position)
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
              return (
                <button
                  key={`${cat.id}-${value}`}
                  onClick={() => clue && !answered && handleSelectClue(clue.id)}
                  disabled={answered}
                  className={`board-cell text-sm py-2 ${answered ? 'board-cell-answered' : ''}`}
                >
                  {answered ? '' : `$${value}`}
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
