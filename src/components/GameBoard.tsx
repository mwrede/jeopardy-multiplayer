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
      {/* Scoreboard */}
      <div className="flex gap-2 px-2 py-3 overflow-x-auto">
        {players
          .sort((a, b) => b.score - a.score)
          .map((p) => (
            <div
              key={p.id}
              className={`flex-shrink-0 px-4 py-2 rounded-lg text-center min-w-[100px] ${
                p.id === game.current_player_id
                  ? 'bg-jeopardy-blue border-2 border-jeopardy-gold'
                  : 'bg-white/5'
              } ${p.id === myPlayerId ? 'ring-1 ring-blue-400/50' : ''}`}
            >
              <p className="text-xs text-gray-400 truncate">{p.name}</p>
              <p
                className={`text-lg font-bold ${
                  p.score < 0 ? 'text-red-400' : 'text-jeopardy-gold'
                }`}
              >
                ${p.score.toLocaleString()}
              </p>
            </div>
          ))}
      </div>

      {/* Turn indicator */}
      <div className="text-center py-2 text-sm">
        {isMyTurn ? (
          <span className="text-jeopardy-gold font-semibold">Your turn - pick a clue!</span>
        ) : (
          <span className="text-gray-400">
            {currentPlayer?.name || 'Someone'} is picking...
          </span>
        )}
      </div>

      {/* Board Grid */}
      <div className="flex-1 grid grid-cols-6 gap-1 md:gap-2 px-1 md:px-4 pb-4">
        {/* Category headers */}
        {roundCategories.map((cat) => (
          <div
            key={cat.id}
            className="bg-jeopardy-blue rounded p-1 md:p-2 flex items-center justify-center text-center"
          >
            <span className="text-[10px] md:text-sm font-bold text-white uppercase leading-tight">
              {cat.name}
            </span>
          </div>
        ))}

        {/* Value cells */}
        {values.map((value) =>
          roundCategories.map((cat) => {
            const clue = getClue(cat.id, value)
            const isAnswered = clue?.is_answered ?? false

            return (
              <button
                key={`${cat.id}-${value}`}
                onClick={() => handleCellClick(clue)}
                disabled={isAnswered || !isMyTurn}
                className={`board-cell text-lg md:text-2xl py-3 md:py-6 ${
                  isAnswered ? 'board-cell-answered' : ''
                } ${!isMyTurn && !isAnswered ? 'opacity-70' : ''}`}
              >
                {isAnswered ? '' : `$${value}`}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
