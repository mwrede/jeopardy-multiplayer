'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { signOut, useUser } from '@/lib/auth'
import {
  getProfileStats,
  getOpponentsPlayed,
  getMyBoards,
  type ProfileStats,
  type OpponentSummary,
  type BoardSummary,
} from '@/lib/profile-api'

/**
 * Top-right profile button + dropdown panel. Shows stats, opponents faced,
 * and boards the signed-in user has authored. Renders a "Sign in" link
 * when no one is logged in.
 */
export function ProfileMenu() {
  const router = useRouter()
  const pathname = usePathname()
  const { user, profile, loading } = useUser()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [opponents, setOpponents] = useState<OpponentSummary[]>([])
  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [dataLoading, setDataLoading] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    setDataLoading(true)
    Promise.all([
      getProfileStats(user.id),
      getOpponentsPlayed(user.id, 10),
      getMyBoards(user.id),
    ])
      .then(([s, o, b]) => {
        setStats(s)
        setOpponents(o)
        setBoards(b)
      })
      .catch(console.error)
      .finally(() => setDataLoading(false))
  }, [open, user])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (loading) {
    return <div className="fixed top-3 right-3 w-9 h-9 rounded-full bg-white/5" />
  }

  if (!user) {
    return (
      <a
        href={`/login?next=${encodeURIComponent(pathname || '/')}`}
        className="btn-stage btn-stage-sm btn-copper fixed top-3 right-3 z-50"
      >
        Sign in
      </a>
    )
  }

  const initials = (profile?.display_name || user.email || 'P')
    .split(/[\s@]+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div ref={panelRef} className="fixed top-3 right-3 z-50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 bg-black/50 hover:bg-black/70 border border-white/20 text-white text-sm font-semibold pl-1 pr-3 py-1 rounded-full transition-colors backdrop-blur-sm"
        aria-label="Open profile menu"
      >
        <span
          className="w-7 h-7 rounded-full text-black text-xs font-bold flex items-center justify-center"
          style={{ background: 'linear-gradient(180deg, #FFC57A, #F58A2C)', boxShadow: '0 0 10px rgba(255,155,68,0.55)' }}
        >
          {initials || 'P'}
        </span>
        <span className="hidden sm:inline max-w-[120px] truncate">
          {profile?.display_name || user.email}
        </span>
      </button>

      {open && (
        <div className="plate absolute right-0 mt-2 w-[min(380px,calc(100vw-1.5rem))] shadow-2xl">
          <div className="plate-surface p-4 text-sm">
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-white/10">
              <div className="min-w-0">
                <p className="text-white font-bold text-base truncate">
                  {profile?.display_name || 'Player'}
                </p>
                <p className="text-ink-stage-3 text-xs truncate">{user.email}</p>
              </div>
              <button
                onClick={async () => { await signOut(); setOpen(false); router.refresh() }}
                className="text-ink-stage-2 hover:text-copper text-xs px-2 py-1 transition-colors uppercase tracking-widest"
                style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}
              >
                Sign out
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <Stat label="Games" value={dataLoading ? '…' : String(stats?.gamesPlayed ?? 0)} />
              <Stat label="Wins" value={dataLoading ? '…' : String(stats?.wins ?? 0)} />
              <Stat
                label="Win rate"
                value={
                  dataLoading
                    ? '…'
                    : stats && stats.gamesPlayed > 0
                      ? `${Math.round(stats.winRate * 100)}%`
                      : '—'
                }
              />
              <Stat
                label="Total points"
                value={dataLoading ? '…' : (stats?.totalPoints ?? 0).toLocaleString()}
              />
            </div>

            <Section title={`Opponents${opponents.length > 0 ? ` (${opponents.length})` : ''}`}>
              {opponents.length === 0 ? (
                <p className="text-ink-stage-3 text-xs italic">No opponents yet. Play a game!</p>
              ) : (
                <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
                  {opponents.map((o) => (
                    <li key={(o.userId || 'name') + ':' + o.name} className="flex items-center justify-between text-xs">
                      <span className="text-white truncate">{o.name}</span>
                      <span className="text-copper tabular-nums" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>{o.encounters}×</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={`Your boards${boards.length > 0 ? ` (${boards.length})` : ''}`}>
              {boards.length === 0 ? (
                <p className="text-ink-stage-3 text-xs italic">
                  You haven't saved any boards.{' '}
                  <a href="/create" className="text-copper underline underline-offset-2">Create one</a>
                </p>
              ) : (
                <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {boards.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-white truncate flex-1" title={b.title}>{b.title}</span>
                      <a
                        href={`/create?boardId=${b.id}`}
                        className="text-copper hover:text-copper-glow px-2 py-1 uppercase tracking-widest"
                        style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}
                        onClick={() => setOpen(false)}
                      >
                        Edit
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/40 border border-white/10 rounded-md px-3 py-2">
      <p className="text-copper text-[10px] uppercase tracking-[0.2em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>{label}</p>
      <p className="text-white font-bold text-lg">{value}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-copper text-[11px] uppercase tracking-[0.24em] mb-1.5" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
        {title}
      </p>
      {children}
    </div>
  )
}
