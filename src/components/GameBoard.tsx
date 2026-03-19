'use client'

import type { Category, Clue, Player, Game } from '@/types/game'
import { selectClue } from '@/lib/game-api'

interface GameBoardProps {
  game: Game
  categories: Category[]
  clues: Clue[]
  players: Player[]
  myPlayerId: string | null
  isMyTurn: boolean
}

const ROUND_VALUES: Record<number, number[]> = {
  1: [200, 400, 600, 800, 1000],
  2: [400, 800, 1200, 1600, 2000],
}

export function GameBoard({
  game,
  categories,
  clues,
  players,
  myPlayerId,
  isMyTurn,
}: GameBoardProps) {
  const roundCategories = categories
    .filter((c) => Number(c.round_number) === Number(game.current_round))
    .sort((a, b) => a.position - b.position)
    .slice(0, 6)

  const values = ROUND_VALUES[game.current_round] || ROUND_VALUES[1]

  function getClue(categoryId: string, value: number): Clue | undefined {
    return clues.find((c) => c.category_id === categoryId && c.value === value)
  }

  async function handleCellClick(clue: Clue | undefined) {
    if (!clue || clue.is_answered || !isMyTurn || !myPlayerId || !game) return

    try {
      await selectClue(game.id, clue.id, myPlayerId)
    } catch (e) {
      console.error('Failed to select clue:', e)
    }
  }

  const currentPlayer = players.find((p) => p.id === game.current_player_id)

  return (
    <div className="flex flex-col h-full">
      {/* Turn indicator (scoreboard is shown by the parent page) */}
      <div className={`text-center py-2 mx-2 rounded-lg text-base ${
        isMyTurn
          ? 'bg-jeopardy-gold/15 border border-jeopardy-gold/40'
          : ''
      }`}>
        {isMyTurn ? (
          <span className="text-jeopardy-gold font-bold">Your turn — pick a clue!</span>
        ) : (
          <span className="text-white/50 font-medium">
            {currentPlayer?.name || 'Someone'} is picking...
          </span>
        )}
      </div>

      {/* Board Grid - authentic Jeopardy look */}
      <div className="flex-1 px-1.5 md:px-3 pb-3 pt-1">
        <div className="board-wrapper h-full">
          <div className="grid grid-cols-6 gap-[3px] md:gap-1 h-full">
            {/* Category headers */}
            {roundCategories.map((cat) => (
              <div
                key={cat.id}
                className="board-category p-1.5 md:p-3 min-h-[44px] md:min-h-[60px]"
              >
                <span className="text-[9px] md:text-sm font-bold text-white uppercase leading-tight line-clamp-3 text-center tracking-wide">
                  {cat.name}
                </span>
              </div>
            ))}

            {/* Value cells */}
            {values.map((value) =>
              roundCategories.map((cat) => {
                const clue = getClue(cat.id, value)
                const isAnswered = clue?.is_answered ?? false
                const wasCorrect = clue?.answered_correct === true
                const answeredByPlayer =
                  isAnswered && clue?.answered_by
                    ? players.find((p) => p.id === clue.answered_by)
                    : null

                return (
                  <button
                    key={`${cat.id}-${value}`}
                    onClick={() => handleCellClick(clue)}
                    disabled={isAnswered || !isMyTurn}
                    className={`board-cell py-3 md:py-5 min-h-[44px] ${
                      isAnswered
                        ? wasCorrect
                          ? 'board-cell-correct'
                          : 'board-cell-wrong'
                        : ''
                    } ${!isMyTurn && !isAnswered ? 'opacity-70' : ''}`}
                  >
                    {isAnswered ? (
                      answeredByPlayer ? (
                        <span className={`text-[8px] md:text-xs font-bold truncate block px-0.5 ${
                          wasCorrect ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {answeredByPlayer.name}
                        </span>
                      ) : (
                        <span className="text-sm md:text-lg text-gray-500/60">—</span>
                      )
                    ) : (
                      <span className="text-sm md:text-2xl font-bold" style={{ fontFamily: 'Swiss911, Impact, Arial Black, sans-serif' }}>
                        ${value}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
