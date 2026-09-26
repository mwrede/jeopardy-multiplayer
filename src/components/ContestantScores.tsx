'use client'

import { useEffect, useState } from 'react'
import { GAME_LENGTH_CONFIG, type GameLength } from '@/types/game'

type Contestant = {
  nickname: string
  afterRound1: number | null
  afterRound2: number | null
  final: number | null
}

/** Total dollars sitting on a board of this size, both rounds. */
function boardDollars(size: GameLength): number {
  const cfg = GAME_LENGTH_CONFIG[size]
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0)
  return cfg.categories * sum(cfg.values1) + cfg.categories * sum(cfg.values2)
}

const FULL_DOLLARS = boardDollars('full')

/**
 * The score to beat on a shorter board.
 *
 * A Half board holds 40% of the money a full one does and a Rapid board 20%,
 * so the night's real winning total isn't a fair mark against it. Scaling by
 * the dollars actually on the board is rough — it takes no view on Final
 * Jeopardy or on which clues get found — which is why it's labelled as a
 * target rather than a score.
 */
function parFor(finalScore: number, size: GameLength): number {
  const scaled = finalScore * (boardDollars(size) / FULL_DOLLARS)
  return Math.round(scaled / 100) * 100
}

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString()}`

/**
 * What the real contestants did with this exact board, shown before you play
 * it — the number worth chasing. Fetched from the archive through our own
 * route; if it isn't available the panel simply doesn't appear, because a
 * scoreboard is never a reason to block a preview.
 */
export function ContestantScores({
  gameIdSource,
  heading = '▸ The night this aired',
  className = '',
}: {
  gameIdSource: number
  /** The eyebrow. Before a game it's context; after one it's the comparison. */
  heading?: string
  className?: string
}) {
  const [rows, setRows] = useState<Contestant[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    fetch(`/api/game-scores/${gameIdSource}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setRows(d?.contestants ?? []) })
      .catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [gameIdSource])

  if (!rows || rows.length === 0) return null

  const scored = rows.filter((r) => r.final != null)
  if (scored.length === 0) return null

  const winner = scored.reduce((a, b) => ((b.final ?? 0) > (a.final ?? 0) ? b : a))
  const winning = winner.final ?? 0

  return (
    <div className={`overflow-hidden rounded-md border border-copper/30 bg-black/40 ${className}`}>
      {/* The three people whose night this was, podiums and all.
          No fixed height and no object-cover: any crop tight enough to keep
          this strip a sensible depth cut the podiums off at the rail. The
          image keeps its own proportions and is capped on WIDTH instead, so
          the whole thing is always visible and the depth follows from it.
          The surround is black because the artwork's own background is —
          there's no seam to see, just more stage. */}
      {/* The eyebrow gets its own bar rather than floating over the art:
          overlaid, it landed on the left contestant's face as soon as the
          image filled a phone's width. */}
      <p className="bg-black/60 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.24em] text-copper sm:text-[10px]">
        {heading}
      </p>
      <div className="flex justify-center bg-black">
        <img
          src="/contestants.png"
          alt=""
          aria-hidden="true"
          className="w-full max-w-[520px] select-none"
        />
      </div>

      <div className="grid grid-cols-3 divide-x divide-white/10 border-t border-white/10">
        {rows.slice(0, 3).map((c) => {
          const isWinner = c.nickname === winner.nickname && c.final != null
          return (
            <div key={c.nickname} className="px-1.5 py-2 text-center sm:px-2 sm:py-2.5">
              <p className="truncate text-[9px] font-bold uppercase tracking-wider text-ink-stage-2 sm:text-[11px]">
                {isWinner && '👑 '}{c.nickname}
              </p>
              <p
                className={`text-base font-bold tabular-nums sm:text-lg ${
                  (c.final ?? 0) < 0 ? 'text-red-300' : isWinner ? 'text-jeopardy-gold-light' : 'text-white'
                }`}
              >
                {c.final != null ? money(c.final) : '—'}
              </p>
              {c.afterRound2 != null && (
                <p className="text-[9px] leading-tight text-ink-stage-2 sm:text-[10px]">
                  {money(c.afterRound2)} into Final
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Shorter boards hold less money, so the night's real total isn't the
          mark to beat there. */}
      <div className="border-t border-white/10 bg-black/30 px-3 py-2 text-center text-[10px] leading-relaxed text-ink-stage-2 sm:text-[11px]">
        Score to beat: <span className="font-bold text-white">{money(winning)}</span> on a Full board
        <span className="opacity-70">
          {' '}· about {money(parFor(winning, 'half'))} on Half
          {' '}· {money(parFor(winning, 'rapid'))} on Rapid
        </span>
      </div>
    </div>
  )
}
