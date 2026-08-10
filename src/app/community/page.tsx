'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/auth'
import { ProfileMenu } from '@/components/ProfileMenu'
import {
  listCommunityLobbies,
  findOrCreateGame,
  joinCommunityLobby,
  LOBBY_SEATS,
  type CommunityLobby,
} from '@/lib/community'

/**
 * COMMUNITY PLAY — drop into a game with strangers.
 *
 * Three to a game, starting the moment the third player sits down. Plays
 * exactly like any other multiplayer game once it begins; the only difference
 * is that you didn't have to know anybody to get in.
 */
export default function CommunityPage() {
  const router = useRouter()
  const { user } = useUser()

  const [name, setName] = useState('')
  const [lobbies, setLobbies] = useState<CommunityLobby[]>([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setName(localStorage.getItem('playerName') || '')
  }, [])

  // Poll so a lobby filling up is visible without a refresh.
  useEffect(() => {
    let cancelled = false
    const load = () => {
      listCommunityLobbies()
        .then((l) => { if (!cancelled) { setLobbies(l); setLoading(false) } })
        .catch(() => { if (!cancelled) setLoading(false) })
    }
    load()
    const t = setInterval(load, 4000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  async function go(fn: () => Promise<{ roomCode: string; started: boolean }>) {
    const trimmed = name.trim()
    if (!trimmed) { setError('Pick a name first'); return }
    setJoining(true)
    setError('')
    try {
      const { roomCode } = await fn()
      router.push(`/game/${roomCode}/play`)
    } catch (e: any) {
      setError(e?.message || 'Could not get you into a game')
      setJoining(false)
    }
  }

  return (
    <main className="stage-page-deep px-4 pb-24 md:px-8">
      <div className="mx-auto w-full max-w-2xl px-1 pt-8 md:pt-12">
        <div className="mb-6 flex items-center justify-between gap-4 border-b border-white/10 pb-5">
          <a href="/" className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink-stage-2 transition-colors hover:text-copper">
            ← Home
          </a>
          <ProfileMenu />
        </div>

        <h1 className="display-chrome text-3xl leading-none md:text-4xl">Community Play</h1>
        <p className="mt-3 text-sm text-ink-stage">
          {LOBBY_SEATS} players a game. It starts the moment the third person sits down —
          then it plays like any other multiplayer game.
        </p>

        {/* Your name — the one other players see. */}
        <div className="mt-6">
          <label className="mb-1.5 block text-[10px] uppercase tracking-[0.22em] text-copper" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
            Your name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pick a name"
            maxLength={15}
            className="field-stage"
          />
        </div>

        <button
          onClick={() => go(() => findOrCreateGame(name.trim(), user?.id))}
          disabled={joining}
          className="btn-stage btn-copper btn-stage-lg mt-4 w-full"
        >
          {joining ? 'Finding a game…' : 'Play now'}
        </button>
        <p className="mt-2 text-center text-xs text-ink-stage-2">
          Sits you down wherever there&apos;s room, or opens a new game if every table is full.
        </p>

        {error && <p className="mt-4 text-center text-sm text-copper-glow">{error}</p>}

        {/* Games with someone already waiting. */}
        <div className="mt-9">
          <div className="eyebrow-copper mb-3">Waiting for players</div>

          {loading && <p className="text-sm italic text-ink-stage-2">Looking for games…</p>}

          {!loading && lobbies.length === 0 && (
            <p className="rounded-lg border border-white/10 bg-black/30 px-4 py-6 text-center text-sm text-ink-stage-2">
              Nobody&apos;s waiting right now. Hit Play now and you&apos;ll be first —
              the game starts when two more join.
            </p>
          )}

          <div className="space-y-2">
            {lobbies.map((l) => (
              <div
                key={l.id}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-4 py-3"
              >
                <span className="font-mono text-sm tracking-[0.2em] text-white">{l.roomCode}</span>

                {/* Seats, drawn — quicker to read than "2/3". */}
                <span className="flex gap-1" aria-label={`${l.playerCount} of ${LOBBY_SEATS} seats taken`}>
                  {Array.from({ length: LOBBY_SEATS }, (_, i) => (
                    <span
                      key={i}
                      className={`h-2.5 w-2.5 rounded-full ${
                        i < l.playerCount ? 'bg-jeopardy-gold-light' : 'bg-white/15'
                      }`}
                    />
                  ))}
                </span>

                <span className="flex-1 text-xs text-ink-stage-2">
                  {LOBBY_SEATS - l.playerCount} seat{LOBBY_SEATS - l.playerCount === 1 ? '' : 's'} left
                </span>

                <button
                  onClick={() => go(() => joinCommunityLobby(l.roomCode, name.trim(), user?.id))}
                  disabled={joining}
                  className="btn-stage btn-stage-sm btn-chrome"
                >
                  Join
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
