'use client'

import { useState } from 'react'
import type { CustomBoard } from '@/types/game'

type OpenClue = {
  category: string
  value: number
  question: string
  answer: string
  isDailyDouble: boolean
  roundLabel: string
} | null

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
  onClueClick,
}: {
  round: CustomBoard['rounds'][number]
  label?: string
  /** When true, shrink text and remove the min-width so the board fits in a narrow column. */
  compact?: boolean
  /** Click a tile to peek at its question + answer in a popup. */
  onClueClick?: (clue: NonNullable<OpenClue>) => void
}) {
  if (!round || round.categories.length === 0) return null
  const rowCount = Math.max(...round.categories.map((c) => c.clues.length))
  const catText = compact ? 'text-[8px] md:text-[10px]' : 'text-[10px] md:text-xs'
  const catCell = compact ? 'min-h-[34px] md:min-h-[40px] px-1 py-1.5' : 'min-h-[44px] md:min-h-[56px] px-1.5 py-2'
  const valueText = compact ? 'text-sm md:text-lg' : 'text-base md:text-2xl'
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
              const hasClue = !!clue && (clue.question?.trim() || clue.answer?.trim())
              const clickable = !!onClueClick && !!hasClue
              return (
                <button
                  key={`v-${ri}-${ci}`}
                  type="button"
                  disabled={!clickable}
                  onClick={() => {
                    if (!clickable || !clue || !onClueClick) return
                    onClueClick({
                      category: cat.name,
                      value,
                      question: clue.question || '',
                      answer: clue.answer || '',
                      isDailyDouble: !!clue.isDailyDouble,
                      roundLabel: label || 'Jeopardy!',
                    })
                  }}
                  className={`bg-jeopardy-blue-cell flex items-center justify-center aspect-[4/3] ${
                    clickable ? 'hover:bg-jeopardy-blue-cell/80 cursor-pointer' : 'cursor-default'
                  }`}
                  title={clickable ? 'Click to reveal the question' : undefined}
                >
                  <span
                    className={`text-jeopardy-gold-light font-bold ${valueText}`}
                    style={{
                      fontFamily: 'Swiss911, Impact, Arial Black, sans-serif',
                      textShadow: '1px 2px 3px rgba(0,0,0,0.7)',
                    }}
                  >
                    ${value}
                  </span>
                </button>
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
  const [openClue, setOpenClue] = useState<OpenClue>(null)
  const [revealAnswer, setRevealAnswer] = useState(false)

  const cluePopup = openClue && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
      onClick={() => { setOpenClue(null); setRevealAnswer(false) }}
    >
      <div
        className="bg-jeopardy-blue border-2 border-jeopardy-gold rounded-2xl p-6 sm:p-8 w-full max-w-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0 flex-1">
            <p className="text-jeopardy-gold-light text-xs uppercase tracking-widest mb-1">
              {openClue.roundLabel}
              {openClue.isDailyDouble && ' · ⭐ Daily Double'}
            </p>
            <p className="text-white text-lg font-bold uppercase tracking-wide truncate">
              {openClue.category}
            </p>
            <p className="text-jeopardy-gold text-2xl font-bold mt-1">${openClue.value}</p>
          </div>
          <button
            onClick={() => { setOpenClue(null); setRevealAnswer(false) }}
            className="text-white/70 hover:text-white text-2xl leading-none px-2 shrink-0"
            aria-label="Close clue"
          >
            ×
          </button>
        </div>
        <div
          className="bg-jeopardy-blue-dark rounded-xl p-5 sm:p-7 text-center"
          style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.6)' }}
        >
          <p className="text-white text-xl sm:text-2xl font-bold leading-snug">
            {openClue.question || <span className="italic text-white/60">(no question)</span>}
          </p>
        </div>
        {revealAnswer ? (
          <div className="mt-4 text-center">
            <p className="text-gray-300 text-xs uppercase tracking-widest mb-1">Answer</p>
            <p className="text-jeopardy-gold-light text-xl sm:text-2xl font-bold">
              {openClue.answer || <span className="italic text-white/40">(no answer)</span>}
            </p>
          </div>
        ) : (
          <div className="mt-4 text-center">
            <button
              onClick={() => setRevealAnswer(true)}
              className="bg-jeopardy-gold hover:bg-jeopardy-gold/80 text-black font-bold px-5 py-2 rounded-xl text-sm transition-colors"
            >
              Reveal answer
            </button>
          </div>
        )}
      </div>
    </div>
  )

  if (showAllRounds) {
    if (board.rounds.length === 0 && !board.finalJeopardy) {
      return <p className="text-gray-500 text-center text-sm py-8">This game has no clues.</p>
    }
    const r1 = board.rounds[0]
    const r2 = board.rounds[1]
    const onClueClick = (c: NonNullable<OpenClue>) => { setOpenClue(c); setRevealAnswer(false) }
    return (
      <>
        {/* lg+: 5/5/2 grid so it reads left → right (J!, DJ!, FJ!) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {r1 && (
            <div className="lg:col-span-5">
              <RoundGrid round={r1} label="Jeopardy!" compact onClueClick={onClueClick} />
            </div>
          )}
          {r2 && (
            <div className="lg:col-span-5">
              <RoundGrid round={r2} label="Double Jeopardy!" compact onClueClick={onClueClick} />
            </div>
          )}
          {board.finalJeopardy && (
            <div className="lg:col-span-2 lg:flex lg:items-center">
              <button
                type="button"
                onClick={() => onClueClick({
                  category: board.finalJeopardy!.categoryName,
                  value: 0,
                  question: board.finalJeopardy!.question,
                  answer: board.finalJeopardy!.answer,
                  isDailyDouble: false,
                  roundLabel: 'Final Jeopardy!',
                })}
                className="bg-jeopardy-blue/40 hover:bg-jeopardy-blue/60 border border-jeopardy-gold/50 rounded-xl px-3 py-4 text-center w-full transition-colors"
              >
                <p className="text-jeopardy-gold-light text-[10px] uppercase tracking-widest mb-1.5">
                  Final Jeopardy!
                </p>
                <p className="text-white font-bold text-sm md:text-base leading-tight">
                  {board.finalJeopardy.categoryName}
                </p>
              </button>
            </div>
          )}
        </div>
        {cluePopup}
      </>
    )
  }

  const r = board.rounds[round]
  if (!r || r.categories.length === 0) {
    return <p className="text-gray-500 text-center text-sm py-8">This board has no categories yet.</p>
  }
  return (
    <>
      <RoundGrid
        round={r}
        onClueClick={(c) => { setOpenClue(c); setRevealAnswer(false) }}
      />
      {cluePopup}
    </>
  )
}
