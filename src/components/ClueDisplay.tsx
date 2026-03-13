'use client'

import { useState, useEffect, useRef } from 'react'
import { submitAnswer } from '@/lib/game-api'
import { BuzzerButton } from './BuzzerButton'
import type { Clue, Player, Game } from '@/types/game'

interface ClueDisplayProps {
  game: Game
  clue: Clue
  players: Player[]
  myPlayerId: string | null
  isMyTurn: boolean
  buzzWinnerId: string | null
  buzzWindowOpen: boolean
  onClose: () => void
}

export function ClueDisplay({
  game,
  clue,
  players,
  myPlayerId,
  isMyTurn,
  buzzWinnerId,
  buzzWindowOpen,
  onClose,
}: ClueDisplayProps) {
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const isBuzzWinner = buzzWinnerId === myPlayerId
  const buzzWinner = players.find((p) => p.id === buzzWinnerId)

  // Focus input when player wins the buzz
  useEffect(() => {
    if (isBuzzWinner && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isBuzzWinner])

  // Timer countdown
  useEffect(() => {
    if (!isBuzzWinner || timeLeft === null) return
    if (timeLeft <= 0) {
      handleSubmitAnswer()
      return
    }
    const timer = setTimeout(() => setTimeLeft((t) => (t !== null ? t - 1 : null)), 1000)
    return () => clearTimeout(timer)
  }, [timeLeft, isBuzzWinner])

  // Start answer timer when winning buzz
  useEffect(() => {
    if (isBuzzWinner) {
      setTimeLeft(Math.floor(game.settings.answer_time_ms / 1000))
    }
  }, [isBuzzWinner, game.settings.answer_time_ms])

  async function handleSubmitAnswer() {
    if (submitting || !myPlayerId) return
    setSubmitting(true)
    try {
      await submitAnswer(game.id, clue.id, myPlayerId, answer.trim())
    } catch (e) {
      console.error('Failed to submit answer:', e)
    } finally {
      setSubmitting(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmitAnswer()
    }
  }

  return (
    <div className="fixed inset-0 bg-jeopardy-dark/95 z-50 flex flex-col">
      {/* Clue value */}
      <div className="text-center pt-8 pb-4">
        <span className="text-jeopardy-gold text-2xl font-bold">
          ${clue.value.toLocaleString()}
        </span>
      </div>

      {/* Clue text */}
      <div className="flex-1 flex items-center justify-center px-8">
        <p className="text-2xl md:text-4xl text-white text-center leading-relaxed font-serif">
          {clue.question}
        </p>
      </div>

      {/* Bottom section: buzzer or answer input */}
      <div className="pb-8">
        {/* Someone else buzzed in */}
        {buzzWinnerId && !isBuzzWinner && (
          <div className="text-center py-4">
            <p className="text-xl text-blue-300">
              {buzzWinner?.name || 'Someone'} buzzed in!
            </p>
          </div>
        )}

        {/* Answer input (only for buzz winner) */}
        {isBuzzWinner && (
          <div className="px-4 space-y-3">
            {timeLeft !== null && (
              <div className="text-center">
                <span
                  className={`text-2xl font-bold font-mono ${
                    timeLeft <= 5 ? 'text-red-400' : 'text-white'
                  }`}
                >
                  {timeLeft}s
                </span>
              </div>
            )}
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your answer..."
                maxLength={200}
                className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-4 text-white text-lg placeholder:text-gray-500 focus:outline-none focus:border-jeopardy-gold"
                autoComplete="off"
              />
              <button
                onClick={handleSubmitAnswer}
                disabled={submitting || !answer.trim()}
                className="bg-jeopardy-gold text-jeopardy-dark px-6 rounded-xl font-bold text-lg hover:brightness-110 disabled:opacity-50"
              >
                {submitting ? '...' : 'Submit'}
              </button>
            </div>
          </div>
        )}

        {/* Buzzer (when buzz window is open and player hasn't buzzed) */}
        {!buzzWinnerId && myPlayerId && (
          <BuzzerButton
            gameId={game.id}
            clueId={clue.id}
            playerId={myPlayerId}
            buzzWindowOpen={buzzWindowOpen}
            isBuzzWinner={false}
            isLockedOut={false}
          />
        )}
      </div>
    </div>
  )
}
