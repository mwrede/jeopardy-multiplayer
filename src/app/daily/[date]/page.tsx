'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ProfileMenu } from '@/components/ProfileMenu'
import { DailyBoard } from '@/components/DailyBoard'
import { boardForDate, daysBetween, shortDate, todayISO, DAILY_EPOCH } from '@/lib/daily-data'

/**
 * A PAST board of the day — the catch-up shelf.
 *
 * The same board everyone else got on that date — both rounds and the Final —
 * played the same way, but off the books: no leaderboard, no streak. Today's
 * board is the one that counts, and it lives on the front page.
 */
export default function PastDailyPage() {
  const params = useParams<{ date: string }>()
  const date = String(params?.date ?? '')

  // Today is a client fact; deciding it in render would disagree with the
  // server for anyone whose calendar day differs from the build machine's.
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => setToday(todayISO()), [])

  const wellFormed = /^\d{4}-\d{2}-\d{2}$/.test(date) && !!boardForDate(date)
  const beforeStart = wellFormed && daysBetween(DAILY_EPOCH, date) < 0
  const isToday = today !== null && date === today
  const future = today !== null && daysBetween(today, date) > 0

  return (
    <main className="stage-page-deep flat-stage px-4 pb-24 md:px-8">
      <div className="mx-auto w-full max-w-5xl px-1 pt-6 md:pt-10">
        <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/10 pb-4">
          <a
            href="/challenge#catch-up"
            className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink-stage-2 transition-colors hover:text-copper"
          >
            ← Past boards
          </a>
          <ProfileMenu />
        </div>

        {!wellFormed || beforeStart ? (
          <p className="mt-16 text-center text-sm text-ink-stage-2">
            There was no board of the day on that date.{' '}
            <a href="/" className="text-copper underline">Today&apos;s board</a>
          </p>
        ) : future ? (
          <p className="mt-16 text-center text-sm text-ink-stage-2">
            {shortDate(date)} hasn&apos;t happened yet.{' '}
            <a href="/" className="text-copper underline">Play today&apos;s board</a>
          </p>
        ) : isToday ? (
          <p className="mt-16 text-center text-sm text-ink-stage-2">
            That&apos;s today — and today&apos;s board is ranked.{' '}
            <a href="/" className="text-copper underline">Play it on the front page</a>
          </p>
        ) : today === null ? (
          <p className="mt-16 text-center text-sm italic text-ink-stage-2">Setting up the board…</p>
        ) : (
          <DailyBoard forDate={date} ranked={false} />
        )}
      </div>
    </main>
  )
}
