'use client'

import type { CustomBoard } from '@/types/game'

type Props = {
  board: CustomBoard
  /** Which round to show (defaults to round 1). */
  round?: number
}

/**
 * Read-only Jeopardy! board preview. Shows the category names along the top
 * and the dollar values in each cell — the actual clue text stays hidden so
 * sharing a board doesn't spoil it. Mirrors the real in-game board styling.
 */
export function BoardPreview({ board, round = 0 }: Props) {
  const r = board.rounds[round]
  if (!r || r.categories.length === 0) {
    return (
      <p className="text-gray-500 text-center text-sm py-8">
        This board has no categories yet.
      </p>
    )
  }

  // Use the max number of clues per category to determine row count.
  const rowCount = Math.max(...r.categories.map((c) => c.clues.length))

  return (
    <div className="w-full max-w-full overflow-x-auto">
      <div
        className="grid gap-[2px] mx-auto"
        style={{
          gridTemplateColumns: `repeat(${r.categories.length}, minmax(0, 1fr))`,
          background: '#000428',
          padding: '2px',
          borderRadius: '8px',
        }}
      >
        {/* Category headers */}
        {r.categories.map((cat, ci) => (
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

        {/* Value cells, row by row */}
        {Array.from({ length: rowCount }).map((_, ri) =>
          r.categories.map((cat, ci) => {
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
                  className="text-jeopardy-gold-light font-bold text-base md:text-2xl"
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
  )
}
