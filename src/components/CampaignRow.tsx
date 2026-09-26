'use client'

import { useEffect, useState } from 'react'
import { campaignStandings, type Standings } from '@/lib/campaign'
import { REAL_STREAKS } from '@/lib/streaks'

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString()}`
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/**
 * The campaign's door on the home page, and the shared record under it.
 *
 * Sits below the three game cells as its own wide row rather than a fourth
 * cell: it's a different kind of game — you against three people who aren't
 * here — and the podium art says so before the words do.
 */
export function CampaignRow() {
  return (
    <a
      href="/campaign"
      className="banner relative mt-2 !block overflow-hidden !px-0 !py-0 border-copper/60 transition-transform hover:translate-y-0 hover:scale-[1.004]"
    >
      <div className="flex items-stretch">
        <div className="relative min-w-0 flex-1 px-4 py-4 sm:px-5 sm:py-5">
          <p className="text-[9px] font-bold uppercase tracking-[0.24em] text-copper sm:text-[10px]">
            ★ Campaign · against real contestants
          </p>
          <p className="home-cell-title mt-1.5 !text-[22px] leading-none text-jeopardy-gold-light sm:!text-[28px]">
            Can you beat real contestants &amp; go on a streak?
          </p>
          <p className="mt-2 max-w-md text-[11px] leading-snug text-blue-100/75 sm:text-xs">
            Take the fourth podium on a real night. The three who played it score exactly as they did.
            Win, and you&apos;re back tomorrow against the next episode.
          </p>
        </div>
        {/* The three podiums. Full art on a wide screen, the heads on a phone. */}
        <div className="relative w-[38%] shrink-0 bg-black sm:w-[40%]">
          <img
            src="/contestants.png"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover object-[center_18%]"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0b1a5c] via-transparent to-transparent" />
        </div>
      </div>
    </a>
  )
}

/** One of the three lists. */
function List({
  title,
  note,
  rows,
  empty,
}: {
  title: string
  note: string
  rows: { key: string; name: string; sub: string; value: string; tone: 'gold' | 'green' | 'red' }[]
  empty: string
}) {
  return (
    <div className="banner !block !px-0 !py-0 overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 border-b border-white/10 px-3 py-2">
        <span className="banner-title text-jeopardy-gold-light">{title}</span>
        <span className="banner-sub shrink-0 text-blue-100/60">{note}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[11px] text-blue-100/60">{empty}</p>
      ) : (
        <ol className="max-h-[236px] divide-y divide-white/5 overflow-y-auto overscroll-contain">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-center gap-2.5 px-3 py-1.5">
              <span className={`w-4 shrink-0 text-center text-[11px] font-black tabular-nums ${i === 0 ? 'text-jeopardy-gold-light' : 'text-blue-100/40'}`}>
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-white">{r.name}</span>
                <span className="block truncate text-[9px] leading-tight text-blue-100/50">{r.sub}</span>
              </span>
              <span
                className={`shrink-0 text-[13px] font-bold tabular-nums ${
                  r.tone === 'green' ? 'text-green-300' : r.tone === 'red' ? 'text-red-300' : 'text-jeopardy-gold-light'
                }`}
              >
                {r.value}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * Who beat them, who fell short, and the longest runs — everyone's, from the
 * shared table. Until supabase-migration-campaign.sql has been run only the
 * real-life record shows, so the row never looks broken.
 */
export function CampaignStandings() {
  const [st, setSt] = useState<Standings | null>(null)
  useEffect(() => { campaignStandings().then(setSt).catch(() => setSt({ available: false, streaks: [], beat: [], fell: [] })) }, [])

  const top3 = REAL_STREAKS.slice(0, 3)
  const who = (r: { player_name: string; hometown: string | null }) =>
    r.hometown ? `${r.player_name} · ${r.hometown}` : r.player_name
  const them = (r: { their_scores: { name: string; score: number }[] }) =>
    r.their_scores.slice().sort((a, b) => b.score - a.score)[0]

  return (
    <div className="mt-2">
      <div className="grid gap-2 sm:grid-cols-3 sm:gap-2.5">
        <List
          title="🔥 Longest streaks"
          note="nights won in a row"
          rows={(st?.streaks ?? []).map((s, i) => ({
            key: `${s.name}-${i}`,
            name: s.name,
            sub: `${s.hometown ? `${s.hometown} · ` : ''}${money(s.winnings)}`,
            value: `${s.streak} ${s.streak === 1 ? 'night' : 'nights'}`,
            tone: 'gold' as const,
          }))}
          empty={st === null ? 'Counting…' : 'Nobody has won a night yet. Be the first.'}
        />
        <List
          title="✓ Beat them"
          note="most recent"
          rows={(st?.beat ?? []).map((r) => {
            const t = them(r)
            return {
              key: `${r.run_id}-${r.game_id_source}`,
              name: who(r),
              sub: `${money(r.my_score)} vs ${t ? `${t.name} ${money(t.score)}` : 'the field'} · ${r.aired_on ?? ''} · ${day(r.created_at)}`,
              value: `night ${r.streak_after}`,
              tone: 'green' as const,
            }
          })}
          empty={st === null ? 'Counting…' : 'Nobody has beaten a real board yet.'}
        />
        <List
          title="✗ Fell short"
          note="most recent"
          rows={(st?.fell ?? []).map((r) => {
            const t = them(r)
            return {
              key: `${r.run_id}-${r.game_id_source}`,
              name: who(r),
              sub: `${money(r.my_score)} vs ${t ? `${t.name} ${money(t.score)}` : 'the field'} · ${r.aired_on ?? ''} · ${day(r.created_at)}`,
              value: r.streak_after > 0 ? `after ${r.streak_after}` : 'night 1',
              tone: 'red' as const,
            }
          })}
          empty={st === null ? 'Counting…' : 'No losses yet — nobody has played.'}
        />
      </div>
      <p className="mt-2 px-1 text-center text-[10px] text-blue-100/55">
        The real record: {top3.map((r, i) => (
          <span key={r.name}>
            {i > 0 && ' · '}
            <span className="font-semibold text-blue-100/80">{r.name}</span> {r.games}
          </span>
        ))} — regular play, since 2003.
      </p>
    </div>
  )
}
