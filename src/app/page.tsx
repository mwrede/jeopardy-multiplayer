'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { joinGame } from '@/lib/game-api'

/**
 * LANDING PAGE
 *
 * Two game modes:
 * 1. Party: TV + phones (Jackbox-style) — go to /host for TV, join by code on phone
 * 2. Multiplayer: everything on your device — public or private rooms
 */
export default function Home() {
  const router = useRouter()
  const [playerName, setPlayerName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleJoinParty() {
    if (!playerName.trim()) {
      setError('Enter your name')
      return
    }
    if (!roomCode.trim() || roomCode.trim().length < 4) {
      setError('Enter the room code from the TV')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { game, player } = await joinGame(roomCode.trim(), playerName.trim())
      localStorage.setItem('playerId', player.id)
      localStorage.setItem('playerName', player.name)
      // Route to play page for multiplayer, party page for party mode
      const isMultiplayer = (game.settings as any)?.gameMode === 'multiplayer'
      router.push(`/game/${game.room_code}${isMultiplayer ? '/play' : ''}`)
    } catch (e: any) {
      setError(e.message || 'Failed to join game')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-28 md:h-40 w-auto mb-8" />

      {/* Two mode cards */}
      <div className="w-full max-w-lg grid gap-4 md:grid-cols-2 mb-10">
        {/* Multiplayer */}
        <a
          href="/multiplayer"
          className="group bg-jeopardy-blue-cell/30 hover:bg-jeopardy-blue-cell/50 border-2 border-jeopardy-blue rounded-2xl p-6 text-center transition-all hover:scale-[1.02]"
        >
          <p className="text-3xl mb-2">🌐</p>
          <h2 className="text-xl font-bold text-white mb-1">Multiplayer</h2>
          <p className="text-gray-400 text-sm">Play on your phone or computer. No TV needed.</p>
        </a>

        {/* Party */}
        <a
          href="/host"
          className="group bg-jeopardy-gold/10 hover:bg-jeopardy-gold/20 border-2 border-jeopardy-gold/50 rounded-2xl p-6 text-center transition-all hover:scale-[1.02]"
        >
          <p className="text-3xl mb-2">📺</p>
          <h2 className="text-xl font-bold text-jeopardy-gold mb-1">Party</h2>
          <p className="text-gray-400 text-sm">Host on a TV, players buzz in on phones.</p>
        </a>
      </div>

      {/* Join existing party game */}
      <div className="w-full max-w-sm">
        <p className="text-gray-500 text-sm text-center mb-3">Join a party game by code</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={30}
            className="input-base text-base flex-1"
          />
          <input
            type="text"
            placeholder="Code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            maxLength={6}
            className="input-base text-lg tracking-[0.2em] text-center font-mono w-28"
          />
          <button
            onClick={handleJoinParty}
            disabled={loading}
            className="btn-primary px-5 py-3 text-base whitespace-nowrap"
          >
            {loading ? '...' : 'Join'}
          </button>
        </div>
        {error && <p className="text-red-400 text-center text-sm mt-2">{error}</p>}
      </div>
    </main>
  )
}
