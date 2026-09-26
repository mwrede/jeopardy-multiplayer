'use client'

import { useEffect, useState } from 'react'
import type { Category, Clue, GameSettings } from '@/types/game'
import {
  fetchContestants, money, paceAt, targetFor, winnerOf, type Contestant,
} from '@/lib/contestants'

/**
 * The real contestants' scores, live, beside your own.
 *
 * Deliberately NOT styled like the player cards. These three aren't in the
 * room and never were — they played this board years ago and their numbers
 * don't move because of anything you do. So: copper and outlined, headed REAL
 * CONTESTANTS, sitting apart from the blue scoreboard rather than in it.
 *
 * Only appears on a board taken from a real episode. Mashups, custom boards
 * and random boards never aired, so there is nobody to beat.
 */
export function ScoreToBeat({
  game,
  clues,
  categories,
  variant,
}: {
  /** Only the three fields this needs, so the presenter can pass its own
   *  round tracker — a hosted game changes rounds on that screen, not on the
   *  game row. */
  game: { settings: GameSettings | null; current_round: number; phase?: string }
  clues: Clue[]
  categories: Category[]
  /** 'tv' is read from across a room; 'phone' sits under a thumb. */
  variant: 'tv' | 'phone'
}) {
  const sourceGameId = (game.settings as any)?.sourceGameId as number | undefined
  const [rows, setRows] = useState<Contestant[] | null>(null)
  const [airedOn, setAiredOn] = useState<string | null>(null)

  useEffect(() => {
    if (!sourceGameId) { setRows([]); return }
    let cancelled = false
    fetchContestants(sourceGameId).then((r) => {
      if (cancelled) return
      setRows(r.contestants)
      setAiredOn(r.airedOn)
    })
    return () => { cancelled = true }
  }, [sourceGameId])

  if (!sourceGameId || !rows || rows.length === 0) return null

  const winner = winnerOf(rows)
  if (!winner) return null

  const size = game.settings?.gameLength || 'full'
  const round = game.current_round ?? 1

  // How far through the current round the board is. Final Jeopardy has no
  // board of its own, so it counts as done the moment it starts.
  const roundCatIds = new Set(
    categories.filter((c) => Number(c.round_number) === round).map((c) => c.id),
  )
  const roundClues = clues.filter((c) => roundCatIds.has(c.category_id))
  const answered = roundClues.filter((c) => c.is_answered).length
  const isFinal = round >= 3 || String(game.phase).startsWith('final')
  const progress = isFinal ? 1 : roundClues.length ? answered / roundClues.length : 0
  const stage = isFinal ? 3 : round

  // Everyone's position at this point in the night, biggest first.
  const standing = rows
    .map((c) => ({ c, pace: paceAt(c, stage, progress, size) }))
    .sort((a, b) => b.pace - a.pace)

  // The headline is whoever was AHEAD at this point, not whoever eventually
  // won. On the board above, the night's winner was third after round one —
  // billing him as the score to beat while showing him on $0 read as broken.
  // The number to chase is the winning total, and it's on the line below.
  const leader = standing[0]
  const target = targetFor(winner, size)
  const isTv = variant === 'tv'

  return (
    <div
      className={`flex flex-col justify-center rounded-lg border-2 border-copper/70 bg-copper/15 ${
        isTv ? 'min-w-[230px] px-4 py-2' : 'min-w-[150px] px-2.5 py-1.5'
      }`}
    >
      {/* Copper on copper, beside the blue player cards: these three are on a
          different footing from everyone else in the room, so they're on a
          different colour. */}
      <p
        className={`font-bold uppercase tracking-[0.18em] text-copper ${
          isTv ? 'text-[11px]' : 'text-[8px]'
        }`}
      >
        ★ Real contestants
      </p>

      <div className={`flex items-baseline justify-between gap-2 ${isTv ? 'mt-0.5' : ''}`}>
        <span className={`truncate font-bold text-white ${isTv ? 'text-lg' : 'text-[11px]'}`}>
          {leader.c.nickname}
        </span>
        <span
          className={`shrink-0 font-bold tabular-nums text-jeopardy-gold-light ${
            isTv ? 'text-2xl' : 'text-sm'
          }`}
        >
          {money(leader.pace)}
        </span>
      </div>

      <div
        className={`flex flex-wrap gap-x-2 leading-tight text-blue-100/70 ${
          isTv ? 'text-xs' : 'text-[9px]'
        }`}
      >
        {standing.slice(1).map(({ c, pace }) => (
          <span key={c.nickname}>
            {c.nickname} <span className="tabular-nums text-white/80">{money(pace)}</span>
          </span>
        ))}
      </div>

      <p className={`leading-tight text-blue-100/60 ${isTv ? 'mt-1 text-xs' : 'mt-0.5 text-[8px]'}`}>
        Beat {money(target)}
        {size !== 'full' && ' (scaled)'}
        {airedOn && isTv && <span className="opacity-70"> · {airedOn}</span>}
      </p>
    </div>
  )
}
