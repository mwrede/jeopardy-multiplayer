'use client'

import type { CustomBoard } from '@/types/game'

type Props = {
  board: CustomBoard
  /** Which round to show (defaults to round 1). Ignored when `showAllRounds`. */
  round?: number
  /**
   * Stack every round vertically with section headings, plus a Final
   * Jeopardy! banner at the bottom. Use for real J-Archive games where
   * you want the whole game visible on one page.
   */
  showAllRounds?: boolean
}

function RoundGrid({ round, label }: { round: CustomBoard['rounds'][number]; label?: string }) {
  if (!round || round.categories.length === 0) return null
  const rowCount = Math.max(...round.categories.map((c) => c.clues.length))
  return (
    <div className="w-full max-w-full">
      {label && (
        <p className="text-jeopardy-gold-light text-xs uppercase tracking-widest font-bold mb-1.5">
          {label}
        </p>
      )}
      <div className="overflow-x-auto">
        <div
          className="grid gap-[2px]"
          style={{
            gridTemplateColumns: `repeat(${round.categories.length}, minmax(0, 1fr))`,
            background: '#000428',
            padding: '2px',
            borderRadius: '8px',
            minWidth: 'min(100%, 600px)',
          }}
        >
          {round.categories.map((cat, ci) => (
            <div
              key={`cat-${ci}`}
              className="bg-jeopardy-blue text-white font-bold uppercase tracking-wide flex items-center justify-center text-center min-h-[44px] md:min-h-[56px] px-1.5 py-2"
              style={{ textShadow: '1px 2px 3px rgba(0,0,0,0.5)' }}
            >
              <span className="text-[10px] md:text-xs leading-tight line-clamp-3">
                {cat.name || <span className="text-white/40 italic">(untitled)</span>}
              </span>
            </div>
          ))}
          {Array.from({ length: rowCount }).map((_, ri) =>
            round.categories.map((cat, ci) => {
              const clue = cat.clues[ri]
              const value = clue?.value ?? (ri + 1) * 200
              const isDailyDouble = clue?.isDailyDouble === true
              return (
                <div
                  key={`v-${ri}-${ci}`}
                  className="bg-jeopardy-blue-cell flex items-center justify-center aspect-[4/3] relative"
                >
                  {isDailyDouble && (
                    <span className="absolute top-0.5 right-0.5 text-[7px] md:text-[9px] bg-jeopardy-gold/90 text-black font-bold px-1 rounded">
                      DD
                    </span>
                  )}
                  <span
                    className="text-jeopardy-gold-light font-bold text-sm md:text-2xl"
                    style={{
                      fontFamily: 'Swiss911, Impact, Arial Black, sans-serif',
                      textShadow: '1px 2px 3px rgba(0,0,0,0.7)',
                    }}
                  >
                    ${value}
                  </span>
                </div>
              )
            }),
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Read-only Jeopardy! board preview. Shows the category names along the top
 * and the dollar values in each cell — the actual clue text stays hidden so
 * sharing a board doesn't spoil it. Mirrors the real in-game board styling.
 *
 * In `showAllRounds` mode, stacks every round vertically with labels and
 * also shows a Final Jeopardy! category banner (useful for real games where
 * all three rounds are well-defined).
 */
export function BoardPreview({ board, round = 0, showAllRounds = false }: Props) {
  if (showAllRounds) {
    if (board.rounds.length === 0 && !board.finalJeopardy) {
      return <p className="text-gray-500 text-center text-sm py-8">This game has no clues.</p>
    }
    return (
      <div className="flex flex-col gap-5">
        {board.rounds.map((r, idx) => (
          <RoundGrid
            key={idx}
            round={r}
            label={idx === 0 ? 'Jeopardy!' : idx === 1 ? 'Double Jeopardy!' : `Round ${idx + 1}`}
          />
        ))}
        {board.finalJeopardy && (
          <div className="bg-jeopardy-blue/40 border border-jeopardy-gold/40 rounded-xl px-4 py-3 text-center">
            <p className="text-jeopardy-gold-light text-xs uppercase tracking-widest mb-1">
              Final Jeopardy!
            </p>
            <p className="text-white font-bold text-base md:text-lg">
              {board.finalJeopardy.categoryName}
            </p>
          </div>
        )}
      </div>
    )
  }

  const r = board.rounds[round]
  if (!r || r.categories.length === 0) {
    return <p className="text-gray-500 text-center text-sm py-8">This board has no categories yet.</p>
  }
  return <RoundGrid round={r} />
}
