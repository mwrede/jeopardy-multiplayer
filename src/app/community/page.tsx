'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, signInWithGoogle } from '@/lib/auth'
import { ProfileMenu } from '@/components/ProfileMenu'
import { getCommunityLeaderboard, MIN_GAMES, type LeaderboardRow } from '@/lib/leaderboard'
import {
  listCommunityLobbies,
  findOrCreateGame,
  joinCommunityLobby,
  leaveCommunityLobby,
  getLobbyState,
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
  const { user, loading: userLoading } = useUser()

  const [name, setName] = useState('')
  const [lobbies, setLobbies] = useState<CommunityLobby[]>([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')
  const [board, setBoard] = useState<LeaderboardRow[]>([])
  // Where you're sitting, if anywhere. Joining keeps you on this page so you
  // can watch the seats fill instead of staring at an empty game screen.
  const [seat, setSeat] = useState<{ roomCode: string; playerId: string } | null>(null)
  const [seatMates, setSeatMates] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    setName(localStorage.getItem('playerName') || '')
  }, [])

  // Nudge people toward a name, but never impose their real one — this is
  // what the other two players see.
  useEffect(() => {
    if (user && !name) setName('')
  }, [user, name])

  useEffect(() => {
    getCommunityLeaderboard().then(setBoard).catch(() => setBoard([]))
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

  async function go(fn: () => Promise<{ roomCode: string; started: boolean; playerId: string }>) {
    const trimmed = name.trim()
    if (!trimmed) { setError('Pick a name first'); return }
    setJoining(true)
    setError('')
    try {
      const { roomCode, playerId } = await fn()
      localStorage.setItem('playerName', trimmed)
      // Stay put — the watcher below moves everyone on together once the
      // third player sits down.
      setSeat({ roomCode, playerId })
    } catch (e: any) {
      setError(e?.message || 'Could not get you into a game')
    } finally {
      setJoining(false)
    }
  }

  async function leave() {
    if (!seat) return
    const { playerId } = seat
    setSeat(null)
    setSeatMates([])
    try { await leaveCommunityLobby(playerId) } catch { /* seat frees on its own */ }
  }

  // Watch your own lobby. When it reaches three the game flips to voting, and
  // everyone still sitting there goes through at the same moment.
  useEffect(() => {
    if (!seat) return
    let cancelled = false
    const tick = async () => {
      const state = await getLobbyState(seat.roomCode).catch(() => null)
      if (cancelled || !state) return
      setSeatMates(state.players)
      if (state.phase === 'game_voting' || state.players.length >= LOBBY_SEATS) {
        router.push(`/game/${seat.roomCode}/play`)
      }
    }
    tick()
    const t = setInterval(tick, 1500)
    return () => { cancelled = true; clearInterval(t) }
  }, [seat, router])

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

        {/* Community is the one place an account is required — results are
            ranked, and a leaderboard keyed to typed names isn't a leaderboard. */}
        {!userLoading && !user && (
          <div className="mt-6 rounded-xl border border-white/15 bg-black/30 p-5 text-center">
            <p className="font-semibold text-white">Sign in to play</p>
            <p className="mx-auto mt-1 max-w-[38ch] text-sm text-ink-stage-2">
              Community games are ranked, so wins need an account to belong to.
              Everything else on the site works without one.
            </p>
            <button
              onClick={() => signInWithGoogle('/community')}
              className="btn-stage btn-copper btn-stage-lg mt-4 w-full"
            >
              Continue with Google
            </button>
          </div>
        )}

        {/* Your name — the one other players see. */}
        <div className={`mt-6 ${!user ? 'pointer-events-none opacity-40' : ''}`}>
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

        {seat ? (
          /* You're in. Watch it fill, or get up. */
          <div className="mt-4 rounded-xl border-2 border-jeopardy-gold bg-jeopardy-gold/10 p-5 text-center">
            <p className="text-[10px] uppercase tracking-[0.28em] text-jeopardy-gold-light">
              You&apos;re in · {seat.roomCode}
            </p>

            <div className="mt-3 flex justify-center gap-2">
              {Array.from({ length: LOBBY_SEATS }, (_, i) => (
                <span
                  key={i}
                  className={`h-3.5 w-3.5 rounded-full ${
                    i < seatMates.length ? 'bg-jeopardy-gold-light' : 'bg-white/20'
                  }`}
                />
              ))}
            </div>

            <p className="mt-3 text-sm text-white">
              {seatMates.length === LOBBY_SEATS
                ? 'Starting…'
                : `Waiting for ${LOBBY_SEATS - seatMates.length} more`}
            </p>
            {seatMates.length > 0 && (
              <p className="mt-1 text-xs text-ink-stage-2">
                {seatMates.map((p) => p.name).join(' · ')}
              </p>
            )}

            <button onClick={leave} className="btn-stage btn-stage-sm btn-stage-ghost mt-4">
              Leave this game
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => go(() => findOrCreateGame(name.trim(), user!.id))}
              disabled={joining || !user}
              className="btn-stage btn-copper btn-stage-lg mt-4 w-full"
            >
              {joining ? 'Finding a game…' : 'Play now'}
            </button>
            <p className="mt-2 text-center text-xs text-ink-stage-2">
              Sits you down wherever there&apos;s room, or opens a new game if every table is full.
            </p>
          </>
        )}

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
                  onClick={() => go(() => joinCommunityLobby(l.roomCode, name.trim(), user!.id))}
                  disabled={joining || !user || !!seat}
                  className="btn-stage btn-stage-sm btn-chrome"
                  title={seat ? 'Leave your current game first' : undefined}
                >
                  {seat?.roomCode === l.roomCode ? 'Seated' : 'Join'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Standings */}
        <div className="mt-10">
          <div className="eyebrow-copper mb-1">Leaderboard</div>
          <p className="mb-3 text-xs text-ink-stage-2">
            Ranked by win rate adjusted for how much you&apos;ve played, so a single
            lucky game doesn&apos;t outrank a long record. {MIN_GAMES}+ games to appear.
          </p>

          {board.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-black/30 px-4 py-6 text-center text-sm text-ink-stage-2">
              Nobody has played {MIN_GAMES} games yet. Be the first.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-[0.18em] text-ink-stage-2">
                    <th className="py-2 pr-2 font-normal">#</th>
                    <th className="py-2 pr-2 font-normal">Player</th>
                    <th className="py-2 pr-2 text-right font-normal">W</th>
                    <th className="py-2 pr-2 text-right font-normal">GP</th>
                    <th className="py-2 text-right font-normal">Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {board.map((r, i) => (
                    <tr key={r.name} className="border-b border-white/5">
                      <td className="py-2 pr-2 tabular-nums text-ink-stage-2">{i + 1}</td>
                      <td className="py-2 pr-2 font-semibold text-white">{r.name}</td>
                      <td className="py-2 pr-2 text-right font-bold tabular-nums text-jeopardy-gold-light">{r.wins}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-ink-stage-2">{r.games}</td>
                      <td className="py-2 text-right tabular-nums text-ink-stage">{Math.round(r.winRate * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
