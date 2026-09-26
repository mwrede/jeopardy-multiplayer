'use client'

import { useEffect, useState } from 'react'
import type { GameLength, Player } from '@/types/game'
import { fetchContestants, scaleToBoard } from '@/lib/contestants'

type Row = { key: string; name: string; score: number; real: boolean; you: boolean }

/**
 * The final standings, with the real contestants IN the table.
 *
 * Before this the results screen showed the real scores in a separate panel
 * above the players, which told you what they scored but not where you
 * finished among them. Now they're ranked in the same list, scaled to the
 * board that was played, and plainly marked — copper, outlined, tagged REAL —
 * so a third-place finish behind two people from 2003 reads as exactly that.
 *
 * On a board that never aired there's nobody to add and it's just the players.
 */
export function FinalStandings({
  players,
  sourceGameId,
  size,
  myPlayerId,
}: {
  players: Player[]
  sourceGameId?: number
  size: GameLength
  myPlayerId?: string | null
}) {
  const [real, setReal] = useState<{ name: string; score: number }[]>([])

  useEffect(() => {
    if (!sourceGameId) { setReal([]); return }
    let cancelled = false
    fetchContestants(sourceGameId).then((r) => {
      if (cancelled) return
      setReal(
        r.contestants
          .filter((c) => c.final != null)
          .map((c) => ({ name: c.nickname, score: scaleToBoard(c.final as number, size) })),
      )
    })
    return () => { cancelled = true }
  }, [sourceGameId, size])

  const rows: Row[] = [
    ...players.map((p) => ({ key: p.id, name: p.name, score: p.score, real: false, you: p.id === myPlayerId })),
    ...real.map((r) => ({ key: `real:${r.name}`, name: r.name, score: r.score, real: true, you: false })),
  ].sort((a, b) => b.score - a.score)

  const medal = (i: number) => (i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`)

  return (
    <div className="w-full max-w-sm space-y-2">
      {rows.map((r, i) => (
        <div
          key={r.key}
          className={`flex items-center justify-between rounded-xl px-4 py-3 ${
            r.real
              ? 'border-2 border-copper/60 bg-copper/10'
              : i === 0
                ? 'border-2 border-jeopardy-gold bg-jeopardy-gold/20'
                : r.you
                  ? 'border border-jeopardy-gold/40 bg-white/5'
                  : 'bg-white/5'
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-xl">{medal(i)}</span>
            <span className={`truncate font-bold ${r.real ? 'text-copper' : 'text-white'} ${r.real ? 'text-base' : 'text-lg'}`}>
              {r.name}
            </span>
            {r.real && (
              <span className="shrink-0 rounded-full border border-copper/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-copper">
                Real
              </span>
            )}
            {r.you && <span className="shrink-0 text-[10px] uppercase text-white/50">you</span>}
          </div>
          <span className={`shrink-0 text-lg font-bold tabular-nums ${r.score < 0 ? 'text-red-400' : r.real ? 'text-copper' : 'text-jeopardy-gold'}`}>
            ${r.score.toLocaleString()}
          </span>
        </div>
      ))}
      {real.length > 0 && size !== 'full' && (
        <p className="pt-1 text-center text-[10px] text-white/50">Real contestants scaled to this board size.</p>
      )}
    </div>
  )
}
