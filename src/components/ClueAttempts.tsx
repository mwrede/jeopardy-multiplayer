'use client'

import { useEffect, useState } from 'react'
import { getBuzzOrder, type BuzzOrderRow } from '@/lib/game-api'
import type { Player } from '@/types/game'

/**
 * Lists every answer attempted on a clue, in buzz order, with a ✓/✗ per row.
 *
 * Shown on the clue-result reveal, and again while the buzzers are reopened
 * after a wrong answer — at that point it's the room's record of what has
 * already been tried and missed, so nobody buzzes in to repeat it.
 */
export function ClueAttempts({
  gameId,
  clueId,
  players,
  variant = 'tv',
  refreshKey,
  heading = 'Answers given',
}: {
  gameId: string
  clueId: string
  players: Player[]
  variant?: 'tv' | 'phone'
  /**
   * Change this to refetch. A wrong answer reopens the buzzers rather than
   * ending the clue, so this list has to pick up each new attempt while the
   * clue is still live — pass something that moves on every phase flip.
   */
  refreshKey?: string | number
  heading?: string
}) {
  const [rows, setRows] = useState<BuzzOrderRow[]>([])

  useEffect(() => {
    let cancelled = false
    getBuzzOrder(gameId, clueId).then((r) => {
      if (!cancelled) setRows(r)
    })
    return () => { cancelled = true }
  }, [gameId, clueId, refreshKey])

  // Only rows where someone actually attempted an answer
  const attempts = rows.filter((r) => r.is_correct !== null)
  if (attempts.length === 0) return null

  const isTv = variant === 'tv'

  return (
    <div className={isTv ? 'mt-8 w-full max-w-2xl' : 'mt-5 w-full max-w-sm'}>
      <p className={`text-gray-500 uppercase tracking-[0.2em] font-bold mb-2 text-center ${isTv ? 'text-sm' : 'text-[10px]'}`}>
        {heading}
      </p>
      <div className="space-y-1.5">
        {attempts.map((r) => {
          const name = players.find((p) => p.id === r.player_id)?.name || 'Player'
          const said = (r.answer ?? '').trim()
          return (
            <div
              key={r.player_id}
              className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${
                r.is_correct
                  ? 'bg-green-600/15 border border-green-600/40'
                  : 'bg-red-600/10 border border-red-900/40'
              }`}
            >
              <span className={`font-semibold text-white shrink-0 ${isTv ? 'text-lg' : 'text-sm'}`}>
                {name}
              </span>
              <span
                className={`italic truncate text-right flex-1 ${
                  r.is_correct ? 'text-green-300' : 'text-red-300'
                } ${isTv ? 'text-lg' : 'text-sm'}`}
              >
                {said ? `"${said}"` : '(no answer)'}
              </span>
              <span className={`shrink-0 ${r.is_correct ? 'text-green-400' : 'text-red-400'} ${isTv ? 'text-xl' : 'text-base'}`}>
                {r.is_correct ? '✓' : '✗'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
