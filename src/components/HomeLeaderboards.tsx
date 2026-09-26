'use client'

import { useEffect, useState } from 'react'
import { getPlayLeaderboard, type WinsRow } from '@/lib/leaderboard'
import { fetchAllChallengeResults, overallLeaderboard, formatMoney, type OverallRow } from '@/lib/challenge'

/** One leaderboard: a heading, then a numbered table. */
function Board({
  title,
  note,
  href,
  rows,
  empty,
}: {
  title: string
  note: string
  href: string
  rows: { name: string; value: string; sub: string }[]
  empty: string
}) {
  return (
    <div className="banner !block !py-0 !px-0 overflow-hidden">
      <a href={href} className="flex items-baseline justify-between gap-2 border-b border-white/10 px-3 py-2 transition-colors hover:bg-white/5">
        <span className="banner-title text-jeopardy-gold-light">{title}</span>
        <span className="banner-sub shrink-0 text-blue-100/60">{note}</span>
      </a>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[11px] text-blue-100/60">{empty}</p>
      ) : (
        /* Everyone, scrolling — not a top five. The height is about six rows,
           so the board reads as a list you can dig into rather than a
           podium. */
        <ol className="max-h-[236px] divide-y divide-white/5 overflow-y-auto overscroll-contain">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex items-center gap-2.5 px-3 py-1.5">
              {/* Rank is its own column so names of any length still line up. */}
              <span
                className={`w-4 shrink-0 text-center text-[11px] font-black tabular-nums ${
                  i === 0 ? 'text-jeopardy-gold-light' : 'text-blue-100/40'
                }`}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white">
                {r.name}
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[13px] font-bold tabular-nums text-jeopardy-gold-light">
                  {r.value}
                </span>
                <span className="block text-[9px] leading-none text-blue-100/50">{r.sub}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * The two standings on the home page.
 *
 * These replaced a pair of banners that each named one champion. A single name
 * tells you who's ahead but not whether that's by a mile or a nose, and there
 * was nothing in it for anyone in second.
 */
export function HomeLeaderboards() {
  const [play, setPlay] = useState<WinsRow[] | null>(null)
  const [solo, setSolo] = useState<OverallRow[] | null>(null)

  useEffect(() => {
    getPlayLeaderboard(500).then(setPlay).catch(() => setPlay([]))
    fetchAllChallengeResults()
      .then((r) => setSolo(overallLeaderboard(r)))
      .catch(() => setSolo([]))
  }, [])

  return (
    <div className="mt-2 grid gap-2 sm:gap-2.5 sm:grid-cols-2">
      <Board
        title="👑 Most wins"
        note="everyone who's finished a game"
        href="/find"
        rows={(play ?? []).map((r) => ({
          name: r.name,
          value: formatMoney(r.total),
          sub: `${r.wins} ${r.wins === 1 ? 'win' : 'wins'} · ${r.games} played`,
        }))}
        empty={play === null ? 'Counting…' : 'Nobody has won a game yet.'}
      />
      <Board
        title="🏅 Best solo run"
        note="Daily Challenge"
        href="/challenge"
        rows={(solo ?? [])
          .slice()
          .sort((a, b) => b.bestGame - a.bestGame)
          .map((r) => ({
            name: r.name,
            value: formatMoney(r.bestGame),
            sub: `${r.gamesPlayed} board${r.gamesPlayed === 1 ? '' : 's'}`,
          }))}
        empty={solo === null ? 'Counting…' : 'Nobody has finished a board yet.'}
      />
    </div>
  )
}
