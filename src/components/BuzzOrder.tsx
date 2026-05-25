'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getBuzzOrder, type BuzzOrderRow } from '@/lib/game-api'
import type { Player } from '@/types/game'

type Props = {
  gameId: string
  clueId: string
  players: Player[]
  /** Layout density. `compact` is for phones/players, default is for the TV display. */
  variant?: 'compact' | 'display'
}

/**
 * Shows the chronological order of buzzes for a clue. Whoever buzzed first
 * gets the gold medal; subsequent buzzers show how many ms behind they were.
 * Polls on a 1s interval so late buzzes appear during answer/reveal phases.
 */
export function BuzzOrder({ gameId, clueId, players, variant = 'display' }: Props) {
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

  // Only render when at least two people raced for the buzz — a solo buzz
  // doesn't have a "first" worth highlighting.
  if (buzzes.length < 2) return null

  // Only the top 5 are interesting — anyone slower than fifth probably wasn't
  // really racing for the buzz.
  const TOP_N = 5
  const visible = buzzes.slice(0, TOP_N)
  const hidden = buzzes.length - visible.length
  const firstMs = new Date(visible[0].server_timestamp).getTime()

  const isCompact = variant === 'compact'
  const containerCls = isCompact
    ? 'bg-white/5 border border-white/10 rounded-xl px-3 py-2 w-full'
    : 'bg-white/5 border border-white/10 rounded-2xl px-5 py-4 w-full max-w-md'
  const headerCls = isCompact ? 'text-[10px] mb-1.5' : 'text-xs mb-2'

  return (
    <div className={containerCls}>
      <p className={`text-gray-400 uppercase tracking-wider ${headerCls}`}>
        Buzz order
      </p>
      <ul className={isCompact ? 'space-y-1' : 'space-y-1.5'}>
        {visible.map((b, idx) => {
          const player = players.find((p) => p.id === b.player_id)
          if (!player) return null
          const t = new Date(b.server_timestamp).getTime()
          const gap = idx === 0 ? 0 : t - firstMs
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`
          const correctness =
            b.is_correct === true ? 'text-green-400' : b.is_correct === false ? 'text-red-400' : ''
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
                  {b.is_correct === true && ' ✓'}
                  {b.is_correct === false && ' ✗'}
                </span>
              </span>
              <span
                className={`font-mono ${isCompact ? 'text-[10px]' : 'text-xs'} ${
                  idx === 0 ? 'text-jeopardy-gold' : 'text-gray-500'
                }`}
              >
                {idx === 0 ? '1st' : `+${gap}ms`}
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
