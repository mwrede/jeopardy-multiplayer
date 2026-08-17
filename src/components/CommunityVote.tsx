'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  castVote, startVotedGame,
  SIZE_OPTIONS, DIFFICULTY_OPTIONS, DECADE_OPTIONS,
  type SizeVote, type DifficultyVote, type DecadeVote,
} from '@/lib/community-vote'
import { leaveCommunityLobby } from '@/lib/community'
import type { Player } from '@/types/game'

/**
 * The vote can't wait forever: one player closing their tab mid-vote used to
 * strand the other two on "2 of 3 voted" until they gave up — the table then
 * sat wedged in game_voting for good. After this window the vote closes with
 * whatever ballots are in (missing votes fall back to sensible defaults).
 */
const VOTE_WINDOW_MS = 75_000

/**
 * Three strangers agreeing on what to play.
 *
 * Everyone picks a size, a difficulty and an era. Once all three have locked
 * in, the majority wins each choice independently — ties go to a coin flip, so
 * no seat at the table carries more weight than another.
 */
export function CommunityVote({
  gameId,
  players,
  myPlayerId,
  votingSince,
}: {
  gameId: string
  players: Player[]
  myPlayerId: string | null
  /** When the game entered game_voting (games.updated_at) — anchors the deadline. */
  votingSince?: string | null
}) {
  const [size, setSize] = useState<SizeVote>('half')
  const [difficulty, setDifficulty] = useState<DifficultyVote>('standard')
  const [decade, setDecade] = useState<DecadeVote>('any')
  const [locked, setLocked] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [leaving, setLeaving] = useState(false)
  const router = useRouter()

  // You can change your mind at any point, including here. The others keep
  // voting without you.
  async function leaveGame() {
    if (!myPlayerId) { router.push('/community'); return }
    setLeaving(true)
    setError('')
    try {
      await leaveCommunityLobby(myPlayerId, gameId)
      localStorage.removeItem('playerId')
      router.push('/community')
    } catch (e: any) {
      setLeaving(false)
      setError(e?.message || 'Could not leave the game.')
    }
  }

  const votesIn = players.filter((p) => (p as any).vote_size).length
  const everyoneVoted = players.length > 0 && votesIn >= players.length

  // Every client sees the same deadline because it's anchored on a timestamp
  // in the game row, not on when each tab happened to mount.
  const mountedAt = useRef(Date.now())
  const anchor = votingSince ? Date.parse(votingSince) : NaN
  const deadline = (isNaN(anchor) ? mountedAt.current : anchor) + VOTE_WINDOW_MS

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const secondsLeft = Math.max(0, Math.ceil((deadline - now) / 1000))

  // Fire the start exactly once per table. With everyone voted, the first
  // seat by join order does it. Once time is up, seats take turns a few
  // seconds apart — so a vanished first player can't block the start, and
  // claimGameSeed makes even a genuine race safe (one caller wins, the rest
  // no-op).
  const firedRef = useRef(false)
  useEffect(() => {
    if (starting || firedRef.current || players.length === 0 || !myPlayerId) return

    const seats = [...players].sort((a, b) => a.join_order - b.join_order)
    const myIndex = seats.findIndex((p) => p.id === myPlayerId)
    if (myIndex === -1) return

    // The deadline path stays live even once everyone has voted — if the
    // first seat locked in and then closed their tab, someone still has to
    // pull the trigger.
    const myTurnToFire =
      (everyoneVoted && myIndex === 0) || now >= deadline + myIndex * 4_000

    if (!myTurnToFire) return

    firedRef.current = true
    setStarting(true)
    startVotedGame(gameId).catch((e) => {
      console.warn('[CommunityVote] start failed:', e)
      firedRef.current = false
      setStarting(false)
    })
  }, [everyoneVoted, now, deadline, players, myPlayerId, gameId, starting])

  async function lockIn() {
    if (!myPlayerId) return
    setLocked(true)
    setError('')
    try {
      await castVote(myPlayerId, { size, difficulty, decade })
    } catch (e: any) {
      setLocked(false)
      // Swallowing this made the button look broken. The usual cause is the
      // vote columns not existing yet, so name that directly.
      const msg = String(e?.message || e)
      setError(
        /column|schema|vote_/i.test(msg)
          ? 'Voting isn\'t set up on the database yet — run supabase-migration-community-votes.sql.'
          : msg || 'Could not save your vote.',
      )
    }
  }

  return (
    <div className="min-h-screen bg-jeopardy-dark px-4 pb-10 pt-8">
      <div className="mx-auto max-w-md">
        <p className="text-center text-[10px] uppercase tracking-[0.3em] text-jeopardy-gold-light">
          Community Play
        </p>
        <h1 className="mt-1 text-center text-2xl font-bold text-white">
          {locked ? 'Waiting for the others…' : 'What are we playing?'}
        </h1>
        <p className="mt-2 text-center text-sm text-gray-400">
          Majority wins each one. Ties are a coin flip.
        </p>
        <p className="mt-1 text-center text-xs text-gray-500">
          {starting
            ? 'Building the board…'
            : secondsLeft > 0
              ? `Vote closes in ${secondsLeft}s — then the ballots that are in decide.`
              : 'Time! Closing the vote…'}
        </p>

        <div className="mt-5 flex justify-center gap-1.5">
          {players.map((p) => (
            <span
              key={p.id}
              className={`h-2.5 w-2.5 rounded-full ${
                (p as any).vote_size ? 'bg-green-500' : 'bg-white/20'
              }`}
              title={`${p.name}${(p as any).vote_size ? ' — voted' : ' — still choosing'}`}
            />
          ))}
        </div>

        <fieldset disabled={locked} className="mt-6 space-y-5 disabled:opacity-50">
          <Group label="Board size">
            {SIZE_OPTIONS.map((o) => (
              <Choice key={o.id} active={size === o.id} onClick={() => setSize(o.id)}>
                {o.label}
                <span className="block text-[10px] font-normal opacity-70">{o.desc}</span>
              </Choice>
            ))}
          </Group>

          <Group label="Difficulty">
            {DIFFICULTY_OPTIONS.map((o) => (
              <Choice key={o.id} active={difficulty === o.id} onClick={() => setDifficulty(o.id)}>
                {o.label}
              </Choice>
            ))}
          </Group>

          <Group label="Era">
            {DECADE_OPTIONS.map((o) => (
              <Choice key={o.id} active={decade === o.id} onClick={() => setDecade(o.id)}>
                {o.label}
              </Choice>
            ))}
          </Group>
        </fieldset>

        {error && (
          <p className="mt-4 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-center text-sm text-red-300">
            {error}
          </p>
        )}

        {!locked ? (
          <button onClick={lockIn} className="btn-primary mt-6 w-full py-4 text-lg">
            Lock in my vote
          </button>
        ) : (
          <p className="mt-6 text-center text-sm text-gray-400">
            {starting ? 'Building the board…' : `${votesIn} of ${players.length} voted`}
          </p>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={leaveGame}
            disabled={leaving}
            className="text-xs uppercase tracking-[0.22em] text-gray-500 transition-colors hover:text-white disabled:opacity-50"
          >
            {leaving ? 'Leaving…' : 'Leave game'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-jeopardy-gold-light">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function Choice({
  active, onClick, children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`min-w-[72px] rounded-lg border-2 px-3 py-2 text-sm font-bold transition-colors ${
        active
          ? 'border-jeopardy-gold bg-jeopardy-gold/25 text-white'
          : 'border-white/15 bg-white/5 text-gray-300 hover:border-white/30'
      }`}
    >
      {children}
    </button>
  )
}
