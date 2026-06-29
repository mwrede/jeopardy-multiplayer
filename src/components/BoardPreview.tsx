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

function RoundGrid({
  round,
  label,
  compact = false,
}: {
  round: CustomBoard['rounds'][number]
  label?: string
  /** When true, shrink text and remove the min-width so the board fits in a narrow column. */
  compact?: boolean
}) {
  if (!round || round.categories.length === 0) return null
  const rowCount = Math.max(...round.categories.map((c) => c.clues.length))
  const catText = compact ? 'text-[8px] md:text-[10px]' : 'text-[10px] md:text-xs'
  const catCell = compact ? 'min-h-[34px] md:min-h-[40px] px-1 py-1.5' : 'min-h-[44px] md:min-h-[56px] px-1.5 py-2'
  const valueText = compact ? 'text-[8px] md:text-[10px]' : 'text-[10px] md:text-xs'
  const questionText = compact ? 'text-[8px] md:text-[10px]' : 'text-[10px] md:text-xs'
  return (
    <div className="w-full max-w-full">
      {label && (
        <p className="text-jeopardy-gold-light text-xs uppercase tracking-widest font-bold mb-1.5 text-center">
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
            minWidth: compact ? '0' : 'min(100%, 600px)',
          }}
        >
          {round.categories.map((cat, ci) => (
            <div
              key={`cat-${ci}`}
              className={`bg-jeopardy-blue text-white font-bold uppercase tracking-wide flex items-center justify-center text-center ${catCell}`}
              style={{ textShadow: '1px 2px 3px rgba(0,0,0,0.5)' }}
            >
              <span className={`${catText} leading-tight line-clamp-3`}>
                {cat.name || <span className="text-white/40 italic">(untitled)</span>}
              </span>
            </div>
          ))}
          {Array.from({ length: rowCount }).map((_, ri) =>
            round.categories.map((cat, ci) => {
              const clue = cat.clues[ri]
              const value = clue?.value ?? (ri + 1) * 200
              const hasQuestion = !!clue?.question?.trim()
              return (
                <div
                  key={`v-${ri}-${ci}`}
                  className="bg-jeopardy-blue-cell flex flex-col items-stretch justify-start px-1 py-1 aspect-[4/3] relative overflow-hidden"
                >
                  <span
                    className={`text-jeopardy-gold-light font-bold ${valueText} text-center shrink-0`}
                    style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.7)' }}
                  >
                    ${value}
                  </span>
                  {hasQuestion ? (
                    <span
                      className={`text-white ${questionText} leading-tight line-clamp-4 mt-0.5 text-left flex-1`}
                      style={{ textShadow: 'none' }}
                    >
                      {clue!.question}
                    </span>
                  ) : (
                    <span className="flex-1" />
                  )}
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
    const r1 = board.rounds[0]
    const r2 = board.rounds[1]
    return (
      // lg+: 5/5/2 grid so it reads left → right (J!, DJ!, FJ!)
      // smaller: vertical stack
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {r1 && (
          <div className="lg:col-span-5">
            <RoundGrid round={r1} label="Jeopardy!" compact />
          </div>
        )}
        {r2 && (
          <div className="lg:col-span-5">
            <RoundGrid round={r2} label="Double Jeopardy!" compact />
          </div>
        )}
        {board.finalJeopardy && (
          <div className="lg:col-span-2 lg:flex lg:items-center">
            <div className="bg-jeopardy-blue/40 border border-jeopardy-gold/50 rounded-xl px-3 py-4 text-center w-full">
              <p className="text-jeopardy-gold-light text-[10px] uppercase tracking-widest mb-1.5">
                Final Jeopardy!
              </p>
              <p className="text-white font-bold text-sm md:text-base leading-tight">
                {board.finalJeopardy.categoryName}
              </p>
            </div>
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
