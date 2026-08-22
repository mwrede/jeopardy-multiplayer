'use client'

import type { Category, Clue, Player, Game } from '@/types/game'
import { GAME_LENGTH_CONFIG } from '@/types/game'
import { selectClue } from '@/lib/game-api'

interface GameBoardProps {
  game: Game
  categories: Category[]
  clues: Clue[]
  players: Player[]
  myPlayerId: string | null
  isMyTurn: boolean
  /**
   * Let this player pick even when it isn't their turn. Set once the board has
   * been sitting on someone who isn't acting, so one absent player can't stop
   * the game — picking takes the turn, so play simply carries on with them.
   */
  canPickAnyway?: boolean
}

export function GameBoard({
  game,
  categories,
  clues,
  players,
  myPlayerId,
  isMyTurn,
  canPickAnyway = false,
}: GameBoardProps) {
  const canPick = isMyTurn || canPickAnyway
  const lengthConfig = GAME_LENGTH_CONFIG[game.settings?.gameLength || 'full']
  const roundCategories = categories
    .filter((c) => Number(c.round_number) === Number(game.current_round))
    .sort((a, b) => a.position - b.position)
    .slice(0, lengthConfig.categories)

  const values = game.current_round === 2 ? lengthConfig.values2 : lengthConfig.values1
  const colCount = roundCategories.length || lengthConfig.categories

  function getClue(categoryId: string, value: number): Clue | undefined {
    return clues.find((c) => c.category_id === categoryId && c.value === value)
  }

  async function handleCellClick(clue: Clue | undefined) {
    if (!clue || clue.is_answered || !canPick || !myPlayerId || !game) return

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
        canPick
          ? 'bg-jeopardy-gold/15 border border-jeopardy-gold/40'
          : ''
      }`}>
        {isMyTurn ? (
          <span className="text-jeopardy-gold font-bold">Your turn — pick a clue!</span>
        ) : canPickAnyway ? (
          <span className="text-jeopardy-gold font-bold">
            {currentPlayer?.name || 'They'} hasn&apos;t picked — go ahead and pick one
          </span>
        ) : (
          <span className="text-white/50 font-medium">
            {currentPlayer?.name || 'Someone'} is picking...
          </span>
        )}
      </div>

      {/* Board Grid - authentic Jeopardy look */}
      <div className="flex-1 px-1.5 md:px-3 pb-3 pt-1">
        <div className="board-wrapper h-full">
          <div className={`grid gap-[3px] md:gap-1 h-full ${
            colCount <= 3 ? 'grid-cols-3' : 'grid-cols-6'
          }`}>
            {/* Category headers */}
            {roundCategories.map((cat) => (
              <div
                key={cat.id}
                className="board-category p-1.5 md:p-3 min-h-[44px] md:min-h-[60px]"
              >
                {/* Steps up through the large breakpoints: the same board is a
                    phone in your hand and a TV across the room, and 14px
                    category headers are unreadable from a sofa. */}
                <span className="text-[9px] md:text-sm lg:text-lg xl:text-2xl 2xl:text-3xl font-bold text-white uppercase leading-tight line-clamp-3 text-center tracking-wide">
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
                const wasWrong = clue?.answered_correct === false
                const answeredByPlayer =
                  isAnswered && clue?.answered_by
                    ? players.find((p) => p.id === clue.answered_by)
                    : null

                return (
                  <button
                    key={`${cat.id}-${value}`}
                    onClick={() => handleCellClick(clue)}
                    disabled={isAnswered || !canPick}
                    className={`board-cell py-3 md:py-5 min-h-[44px] ${
                      isAnswered
                        ? wasCorrect
                          ? 'board-cell-correct'
                          : wasWrong
                            ? 'board-cell-wrong'
                            : 'board-cell-answered'
                        : ''
                    } ${!canPick && !isAnswered ? 'opacity-70' : ''}`}
                  >
                    {isAnswered ? (
                      answeredByPlayer ? (
                        <span className={`text-[8px] md:text-xs lg:text-base xl:text-lg font-bold truncate block px-0.5 ${
                          wasCorrect ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {answeredByPlayer.name}
                        </span>
                      ) : (
                        <span className="text-sm md:text-lg text-gray-500/60">—</span>
                      )
                    ) : (
                      <span className="text-sm md:text-2xl lg:text-4xl xl:text-5xl 2xl:text-6xl font-bold" style={{ fontFamily: 'Swiss911, Impact, Arial Black, sans-serif' }}>
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
