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
export function ContestantScores({ gameIdSource }: { gameIdSource: number }) {
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
    <div className="mb-5 overflow-hidden rounded-md border border-copper/30 bg-black/40">
      {/* The podium art from the home board — the three people whose night
          this was. Full-bleed: capped at max-w-md it sat in the middle of a
          wide panel with dark voids either side and 40% of itself cropped
          away, which is what made this read as squashed. */}
      <div className="relative h-[104px] overflow-hidden sm:h-[150px] md:h-[184px]">
        <img
          src="/contestants.png"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full select-none object-cover opacity-90"
          style={{ objectPosition: 'center 12%' }}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40" />
        <p className="absolute left-3 top-2.5 text-[9px] font-bold uppercase tracking-[0.24em] text-copper sm:text-[10px]">
          ▸ The night this aired
        </p>
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
