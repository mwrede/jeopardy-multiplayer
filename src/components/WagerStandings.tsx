'use client'

import type { Player } from '@/types/game'

/**
 * Everyone's score, shown while wagering.
 *
 * Wagering in Jeopardy is entirely a question about other people's numbers —
 * whether you can be caught, whether you can catch the leader, what happens if
 * they bet it all. The wager screens showed you only your own cap, which is
 * the one figure that doesn't help you decide.
 *
 * Sorted by score, leader first, with you marked. `locked` adds whether each
 * player has committed yet, for the screens that are also waiting on them.
 */
export function WagerStandings({
  players,
  myPlayerId,
  locked = false,
  variant = 'phone',
}: {
  players: Player[]
  myPlayerId?: string | null
  /** Also show who has locked their wager in. */
  locked?: boolean
  variant?: 'tv' | 'phone'
}) {
  const isTv = variant === 'tv'
  const ranked = [...players].sort((a, b) => b.score - a.score)
  if (ranked.length === 0) return null

  return (
    <div className={`w-full ${isTv ? 'max-w-3xl' : 'max-w-xs'}`}>
      <p
        className={`text-center font-bold uppercase tracking-[0.2em] text-gray-500 ${
          isTv ? 'mb-3 text-sm' : 'mb-1.5 text-[10px]'
        }`}
      >
        Going into Final
      </p>
      <div className={isTv ? 'flex justify-center gap-3' : 'space-y-1'}>
        {ranked.map((p, i) => {
          const mine = !!myPlayerId && p.id === myPlayerId
          return (
            <div
              key={p.id}
              className={`flex items-center gap-2 rounded-lg border px-3 ${
                isTv ? 'min-w-[150px] flex-col py-3' : 'py-1.5'
              } ${
                mine
                  ? 'border-jeopardy-gold/60 bg-jeopardy-gold/10'
                  : 'border-white/10 bg-white/5'
              }`}
            >
              <span
                className={`min-w-0 flex-1 truncate font-semibold ${
                  isTv ? 'text-center text-lg' : 'text-sm'
                } ${mine ? 'text-jeopardy-gold-light' : 'text-white/90'}`}
              >
                {i === 0 && <span aria-hidden className="mr-1">👑</span>}
                {p.name}
                {mine && <span className="ml-1 text-[10px] uppercase opacity-70">you</span>}
              </span>
              <span
                className={`shrink-0 font-bold tabular-nums ${isTv ? 'text-2xl' : 'text-sm'} ${
                  p.score < 0 ? 'text-red-400' : 'text-jeopardy-gold-light'
                }`}
              >
                ${p.score.toLocaleString()}
              </span>
              {locked && (
                /* Never colour alone — the state is worded too. */
                <span
                  className={`shrink-0 whitespace-nowrap font-bold uppercase tracking-wider ${
                    isTv ? 'text-xs' : 'text-[9px]'
                  } ${p.final_wager != null ? 'text-green-400' : 'text-gray-500'}`}
                >
                  {p.final_wager != null ? '✓ In' : 'Wagering…'}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
