'use client'

import { useEffect, useState } from 'react'
import {
  castVote, startVotedGame,
  SIZE_OPTIONS, DIFFICULTY_OPTIONS, DECADE_OPTIONS,
  type SizeVote, type DifficultyVote, type DecadeVote,
} from '@/lib/community-vote'
import type { Player } from '@/types/game'

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
}: {
  gameId: string
  players: Player[]
  myPlayerId: string | null
}) {
  const [size, setSize] = useState<SizeVote>('half')
  const [difficulty, setDifficulty] = useState<DifficultyVote>('standard')
  const [decade, setDecade] = useState<DecadeVote>('any')
  const [locked, setLocked] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  const votesIn = players.filter((p) => (p as any).vote_size).length
  const everyoneVoted = players.length > 0 && votesIn >= players.length

  // Whoever is first in join order fires the start, so it happens once.
  useEffect(() => {
    if (!everyoneVoted || starting) return
    const first = [...players].sort((a, b) => a.join_order - b.join_order)[0]
    if (first?.id !== myPlayerId) return
    setStarting(true)
    startVotedGame(gameId).catch((e) => {
      console.warn('[CommunityVote] start failed:', e)
      setStarting(false)
    })
  }, [everyoneVoted, players, myPlayerId, gameId, starting])

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
