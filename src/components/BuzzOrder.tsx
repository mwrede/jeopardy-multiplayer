'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getBuzzOrder, type BuzzOrderRow } from '@/lib/game-api'
import { formatReaction } from '@/lib/buzz-stats'
import type { Player } from '@/types/game'

type Props = {
  gameId: string
  clueId: string
  players: Player[]
  /** Layout density. `compact` is for phones/players, default is for the TV display. */
  variant?: 'compact' | 'display'
  /**
   * Hide the ✓/✗ marks. Set while answers are still being typed in
   * unlimited-buzzer mode: everyone is answering at the same time, and showing
   * that the quickest buzzer was right would hand the answer to the rest.
   */
  hideResults?: boolean
  /** Heading above the list. */
  heading?: string
}

/**
 * WHO BUZZED, AND HOW FAST.
 *
 * The order is by reaction time — the gap between the buzzer arming on a
 * player's own device and them pressing it — so this is the room's record of
 * who was genuinely quickest, not of whose packet arrived first. Everyone's own
 * time is shown next to their name; second place onwards also shows how far
 * behind the leader they were.
 *
 * Polls on a 1s interval, plus realtime, so late buzzes appear as they land.
 */
export function BuzzOrder({
  gameId,
  clueId,
  players,
  variant = 'display',
  hideResults = false,
  heading = 'Buzz order',
}: Props) {
  const [buzzes, setBuzzes] = useState<BuzzOrderRow[]>([])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      getBuzzOrder(gameId, clueId).then((b) => {
        if (!cancelled) setBuzzes(b)
      })
    }
    load()

    // Realtime subscription on buzzes for this clue, plus a 1s poll fallback.
    const channel = supabase
      .channel(`buzzes:${clueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'buzzes', filter: `clue_id=eq.${clueId}` },
        () => load(),
      )
      .subscribe()

    const timer = setInterval(load, 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
      channel.unsubscribe()
    }
  }, [gameId, clueId])

  const timed = buzzes.some((b) => typeof b.reaction_ms === 'number')

  // A lone buzz is worth showing once it comes with a time on it — "0.48s" is
  // a real fact about that player. Without timings it isn't: there's no first
  // place to award when only one person rang in.
  if (buzzes.length === 0) return null
  if (buzzes.length < 2 && !timed) return null

  // Only the top 5 are interesting — anyone slower than fifth probably wasn't
  // really racing for the buzz.
  const TOP_N = 5
  const visible = buzzes.slice(0, TOP_N)
  const hidden = buzzes.length - visible.length
  const leadReaction = visible[0].reaction_ms
  const firstMs = new Date(visible[0].server_timestamp).getTime()

  const isCompact = variant === 'compact'
  const containerCls = isCompact
    ? 'bg-white/5 border border-white/10 rounded-xl px-3 py-2 w-full'
    : 'bg-white/5 border border-white/10 rounded-2xl px-5 py-4 w-full max-w-md'
  const headerCls = isCompact ? 'text-[10px] mb-1.5' : 'text-xs mb-2'

  return (
    <div className={containerCls}>
      <p className={`text-gray-400 uppercase tracking-wider ${headerCls}`}>
        {heading}
      </p>
      <ul className={isCompact ? 'space-y-1' : 'space-y-1.5'}>
        {visible.map((b, idx) => {
          const player = players.find((p) => p.id === b.player_id)
          if (!player) return null
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`
          const correctness = hideResults
            ? ''
            : b.is_correct === true ? 'text-green-400' : b.is_correct === false ? 'text-red-400' : ''

          // Each player's own reaction is the headline number. The gap behind
          // the leader is the secondary one — computed from reactions when we
          // have them, and from arrival times only as a last resort.
          const own = typeof b.reaction_ms === 'number' ? formatReaction(b.reaction_ms) : null
          let gapLabel: string | null = null
          if (idx > 0) {
            if (typeof b.reaction_ms === 'number' && typeof leadReaction === 'number') {
              gapLabel = `+${Math.max(0, b.reaction_ms - leadReaction)}ms`
            } else {
              gapLabel = `+${Math.max(0, new Date(b.server_timestamp).getTime() - firstMs)}ms`
            }
          }

          return (
            <li
              key={b.player_id}
              className={`flex items-center justify-between gap-3 ${isCompact ? 'text-xs' : 'text-sm'}`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-6 text-center font-bold ${
                    idx === 0 ? 'text-jeopardy-gold' : 'text-gray-500'
                  }`}
                >
                  {medal}
                </span>
                <span
                  className={`truncate ${idx === 0 ? 'text-white font-bold' : 'text-white/70'} ${correctness}`}
                >
                  {player.name}
                  {!hideResults && b.is_correct === true && ' ✓'}
                  {!hideResults && b.is_correct === false && ' ✗'}
                </span>
              </span>
              <span
                className={`flex items-center gap-2 font-mono ${isCompact ? 'text-[10px]' : 'text-xs'}`}
              >
                <span className={idx === 0 ? 'text-jeopardy-gold' : 'text-white/60'}>
                  {own ?? (idx === 0 ? '1st' : '')}
                </span>
                {gapLabel && <span className="text-gray-500">{gapLabel}</span>}
              </span>
            </li>
          )
        })}
      </ul>
      {hidden > 0 && (
        <p className={`text-gray-500 mt-2 text-center ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
          +{hidden} more
        </p>
      )}
    </div>
  )
}
