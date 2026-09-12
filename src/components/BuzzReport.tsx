'use client'

import { useEffect, useState } from 'react'
import { getGameBuzzStats, formatReaction, type PlayerBuzzStats } from '@/lib/buzz-stats'
import type { Player } from '@/types/game'

/**
 * THE BUZZER TAPE — the end-of-game record of what everyone did on the buzzer.
 *
 * Scores say who won. This says how: who was genuinely quickest, who rang in
 * on everything, and who rang in without knowing it. Every number comes from
 * the buzzes themselves, timed on each player's own device, so nobody's wifi
 * shows up as a slow thumb.
 */
export function BuzzReport({
  gameId,
  players,
  variant = 'tv',
}: {
  gameId: string
  players: Player[]
  variant?: 'tv' | 'phone'
}) {
  const [stats, setStats] = useState<PlayerBuzzStats[] | null>(null)

  useEffect(() => {
    let cancelled = false
    getGameBuzzStats(gameId).then((s) => { if (!cancelled) setStats(s) })
    return () => { cancelled = true }
  }, [gameId])

  if (!stats || stats.length === 0) return null

  const isTv = variant === 'tv'
  const timed = stats.some((s) => s.avgReactionMs !== null)
  const fastest = stats.reduce<number | null>(
    (best, s) => (s.bestReactionMs !== null && (best === null || s.bestReactionMs < best) ? s.bestReactionMs : best),
    null,
  )

  return (
    <div className={isTv ? 'w-full max-w-2xl' : 'w-full max-w-sm'}>
      <p
        className={`text-gray-500 uppercase tracking-[0.2em] font-bold text-center ${
          isTv ? 'text-sm mb-3' : 'text-[10px] mb-2'
        }`}
      >
        On the buzzer
      </p>

      <div className={isTv ? 'space-y-2' : 'space-y-1.5'}>
        {/* Column headings, so the numbers don't need explaining out loud */}
        <div
          className={`flex items-center gap-2 px-3 text-gray-600 uppercase tracking-wider ${
            isTv ? 'text-[11px]' : 'text-[9px]'
          }`}
        >
          <span className="flex-1">Player</span>
          <span className={isTv ? 'w-20 text-right' : 'w-14 text-right'}>Avg</span>
          <span className={isTv ? 'w-20 text-right' : 'w-14 text-right'}>Fastest</span>
          <span className={isTv ? 'w-16 text-right' : 'w-12 text-right'}>Buzzes</span>
          <span className={isTv ? 'w-20 text-right' : 'w-14 text-right'}>Right</span>
        </div>

        {stats.map((s) => {
          const name = players.find((p) => p.id === s.player_id)?.name || 'Player'
          const isQuickest = s.bestReactionMs !== null && s.bestReactionMs === fastest
          return (
            <div
              key={s.player_id}
              className={`flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-3 ${
                isTv ? 'py-2.5 text-lg' : 'py-2 text-xs'
              }`}
            >
              <span className="flex-1 truncate font-semibold text-white">
                {name}
                {isQuickest && timed && (
                  <span className={`ml-2 text-jeopardy-gold ${isTv ? 'text-sm' : 'text-[9px]'}`}>
                    ⚡ quickest
                  </span>
                )}
              </span>
              <span
                className={`font-mono tabular-nums text-right ${isTv ? 'w-20' : 'w-14'} ${
                  s.avgReactionMs !== null ? 'text-white/80' : 'text-gray-600'
                }`}
              >
                {formatReaction(s.avgReactionMs)}
              </span>
              <span
                className={`font-mono tabular-nums text-right ${isTv ? 'w-20' : 'w-14'} ${
                  isQuickest ? 'text-jeopardy-gold' : 'text-white/60'
                }`}
              >
                {formatReaction(s.bestReactionMs)}
              </span>
              <span className={`tabular-nums text-right text-white/60 ${isTv ? 'w-16' : 'w-12'}`}>
                {s.buzzes}
              </span>
              <span className={`tabular-nums text-right ${isTv ? 'w-20' : 'w-14'}`}>
                <span className="text-green-400">{s.correct}</span>
                <span className="text-gray-600">/</span>
                <span className="text-red-400">{s.wrong}</span>
              </span>
            </div>
          )
        })}
      </div>

      {!timed && (
        <p className={`mt-2 text-center text-gray-600 ${isTv ? 'text-xs' : 'text-[9px]'}`}>
          Buzz times need supabase-migration-buzz-reaction.sql
        </p>
      )}
    </div>
  )
}
