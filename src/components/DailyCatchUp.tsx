'use client'

import { useEffect, useState } from 'react'
import { formatMoney } from '@/lib/challenge'
import { formatAirDate } from '@/lib/challenge-data'
import {
  boardForDate,
  pastDays,
  shortDate,
  todayISO,
  DAILY_CLUES,
  DAILY_DAYS,
  type DailyBoard,
} from '@/lib/daily-data'
import { readCatchUps, readLocalPlays, type LocalPlay } from '@/lib/daily'

/**
 * THE CATCH-UP SHELF — every board of the day that has already been and gone.
 *
 * Today's board is ranked and lives on the front page; these are not, which is
 * the only way the daily leaderboard stays honest. What they are is the rest of
 * the series: twenty days of Jeopardy! history, each nine real clues, and
 * nothing stopping you playing the lot in an afternoon.
 *
 * Dates are a client fact, so the list is built after mount.
 */
export function DailyCatchUp() {
  const [days, setDays] = useState<DailyBoard[] | null>(null)
  const [today, setToday] = useState<DailyBoard | null>(null)
  const [played, setPlayed] = useState<Record<string, LocalPlay>>({})

  useEffect(() => {
    const now = todayISO()
    setToday(boardForDate(now))
    setDays(pastDays(now))
    // A day you played on the day counts here too — it's the same board.
    setPlayed({ ...readCatchUps(), ...readLocalPlays() })
  }, [])

  const done = days?.filter((d) => played[d.date]).length ?? 0

  return (
    <div id="catch-up" className="scroll-mt-4">
      <div className="eyebrow-copper mb-1">Board of the Day</div>
      <p className="mb-4 text-center text-xs text-ink-stage-2">
        One 3×3 a day, each from a day that mattered — Trebek&apos;s first show and his last, the
        biggest one-day total ever won, the night each famous streak ended. Today&apos;s is ranked;
        the ones below are here to be caught up on.
        {days && days.length > 0 && (
          <> You&apos;ve played <span className="text-jeopardy-gold-light">{done} of {days.length}</span>.</>
        )}
      </p>

      {/* Today, first and apart from the rest — it's the one that counts. */}
      {today && (
        <a
          href="/"
          className="mb-2.5 flex items-center gap-3 rounded-xl border border-jeopardy-gold/45 bg-jeopardy-gold/10 px-4 py-3 transition-colors hover:border-jeopardy-gold"
        >
          <span className="shrink-0 rounded-full bg-jeopardy-gold px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-black">
            Today
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-white">{today.day.occasion}</span>
            <span className="block text-[11px] text-ink-stage-2">
              {shortDate(today.date)} · ranked, one shot, and it feeds your streak
            </span>
          </span>
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-jeopardy-gold-light">
            Play →
          </span>
        </a>
      )}

      {days === null ? (
        <p className="rounded-lg border border-white/10 bg-black/30 px-4 py-6 text-center text-sm text-ink-stage-2">
          Loading the shelf…
        </p>
      ) : days.length === 0 ? (
        <p className="rounded-lg border border-white/10 bg-black/30 px-4 py-6 text-center text-sm text-ink-stage-2">
          Nothing to catch up on yet — the first board of the day is the one on the front page.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {days.map((d) => {
            const mine = played[d.date]
            return (
              <a
                key={d.date}
                href={`/daily/${d.date}`}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 transition-colors hover:border-copper/60"
              >
                <span className="w-9 shrink-0 text-center">
                  <span className="block text-[9px] uppercase leading-none tracking-[0.1em] text-ink-stage-2">Day</span>
                  <span className="block text-base font-black leading-tight tabular-nums text-white/80">
                    {d.dayNumber}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-white">
                    {d.day.occasion}
                  </span>
                  <span className="block truncate text-[10px] uppercase tracking-[0.1em] text-ink-stage-2">
                    {shortDate(d.date)}
                    {d.airDate ? ` · aired ${formatAirDate(d.airDate)}` : ''}
                  </span>
                </span>
                {mine ? (
                  <span className="shrink-0 text-right">
                    <span className="block text-[12px] font-bold leading-tight tabular-nums text-jeopardy-gold-light">
                      {formatMoney(mine.score)}
                    </span>
                    <span className="block text-[9px] leading-none text-ink-stage-2">
                      {mine.correct}/{DAILY_CLUES} · again →
                    </span>
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-copper">
                    Play →
                  </span>
                )}
              </a>
            )
          })}
        </div>
      )}

      <p className="mt-2 text-center text-[11px] text-ink-stage-2">
        {DAILY_DAYS.length} days in the rotation. Catch-up boards keep your score in this browser;
        they don&apos;t rank and they don&apos;t build a streak.
      </p>
    </div>
  )
}
