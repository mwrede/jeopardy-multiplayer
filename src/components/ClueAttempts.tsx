'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getBuzzOrder, type BuzzOrderRow } from '@/lib/game-api'
import { formatReaction } from '@/lib/buzz-stats'
import type { Player } from '@/types/game'

/**
 * EVERY ANSWER GIVEN ON A CLUE — who said it, what they actually said, and
 * whether it counted.
 *
 * A wrong answer is public. The room gets to hear it, so it gets to see it:
 * the name, the words, the ✗, and what it cost. That's the fair version — the
 * player who misses isn't quietly written off screen, and nobody else wastes
 * their buzz repeating a guess that's already been ruled out.
 *
 * Shown while the buzzers are reopened after a wrong answer (it's the record of
 * what not to say), and again on the reveal.
 */
export function ClueAttempts({
  gameId,
  clueId,
  players,
  variant = 'tv',
  refreshKey,
  heading = 'Answers given',
  live = false,
  value,
  announceLatest = false,
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
  /**
   * Keep it current without waiting for a phase flip — realtime plus a 1s
   * poll. Needed in unlimited-buzzer mode, where answers land one after
   * another with the phase sitting still.
   */
  live?: boolean
  /** Clue value — shows what each attempt won or cost. */
  value?: number
  /** Call out the newest wrong answer above the list, big enough to read across a room. */
  announceLatest?: boolean
}) {
  const [rows, setRows] = useState<BuzzOrderRow[]>([])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      getBuzzOrder(gameId, clueId).then((r) => {
        if (!cancelled) setRows(r)
      })
    }
    load()
    if (!live) return () => { cancelled = true }

    const channel = supabase
      .channel(`attempts:${clueId}`)
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
  }, [gameId, clueId, refreshKey, live])

  // Only rows where someone actually attempted an answer
  const attempts = rows.filter((r) => r.is_correct !== null)
  if (attempts.length === 0) return null

  const isTv = variant === 'tv'
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name || 'Player'

  // With the race off a clue can be answered by several people at once, so the
  // heading carries the tally. One attempt needs no tally — that's just the
  // clue's own result, already on screen above.
  const rightCount = attempts.filter((r) => r.is_correct).length
  const tally =
    attempts.length > 1
      ? `${attempts.length} answered · ${rightCount} right`
      : null

  // The newest attempt, which for the announcement is only interesting when it
  // was wrong: a correct answer ends the clue and gets its own reveal screen.
  const newest = attempts[attempts.length - 1]
  const announce = announceLatest && newest && newest.is_correct === false ? newest : null

  return (
    <div className={isTv ? 'mt-8 w-full max-w-2xl' : 'mt-5 w-full max-w-sm'}>
      {announce && (
        <div
          className={`mb-3 rounded-xl border-2 border-red-500/70 bg-red-950/50 text-center ${
            isTv ? 'px-6 py-4' : 'px-4 py-3'
          }`}
        >
          <p className={`font-bold text-red-300 ${isTv ? 'text-3xl' : 'text-base'}`}>
            ✗ {nameOf(announce.player_id)} said
            {' '}
            <span className="italic">
              {(announce.answer ?? '').trim() ? `"${(announce.answer ?? '').trim()}"` : 'nothing'}
            </span>
          </p>
          {typeof value === 'number' && value > 0 && (
            <p className={`text-red-400/80 ${isTv ? 'text-xl mt-1' : 'text-xs mt-0.5'}`}>
              −${value.toLocaleString()}
            </p>
          )}
        </div>
      )}

      <p className={`text-gray-500 uppercase tracking-[0.2em] font-bold mb-2 text-center ${isTv ? 'text-sm' : 'text-[10px]'}`}>
        {heading}
        {tally && <span className="ml-2 normal-case tracking-normal text-gray-600">{tally}</span>}
      </p>
      <div className="space-y-1.5">
        {attempts.map((r) => {
          const name = nameOf(r.player_id)
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
                {typeof r.reaction_ms === 'number' && (
                  <span className={`ml-2 font-mono text-gray-500 ${isTv ? 'text-sm' : 'text-[10px]'}`}>
                    {formatReaction(r.reaction_ms)}
                  </span>
                )}
              </span>
              <span
                className={`italic truncate text-right flex-1 ${
                  r.is_correct ? 'text-green-300' : 'text-red-300'
                } ${isTv ? 'text-lg' : 'text-sm'}`}
              >
                {said ? `"${said}"` : '(no answer)'}
              </span>
              {typeof value === 'number' && value > 0 && (
                <span
                  className={`shrink-0 font-mono tabular-nums ${
                    r.is_correct ? 'text-green-400' : 'text-red-400'
                  } ${isTv ? 'text-base' : 'text-[11px]'}`}
                >
                  {r.is_correct ? '+' : '−'}${value.toLocaleString()}
                </span>
              )}
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
