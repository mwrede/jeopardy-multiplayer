'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { joinGame } from '@/lib/game-api'

/**
 * LANDING PAGE
 *
 * Two paths:
 * 1. TV/Display: Go to /host to select a game and create a room
 * 2. Phone/Player: Enter name + room code to join
 */
export default function Home() {
  const router = useRouter()
  const [playerName, setPlayerName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleJoin() {
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
      router.push(`/game/${game.room_code}`)
    } catch (e: any) {
      setError(e.message || 'Failed to join game')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <h1 className="text-5xl md:text-7xl font-bold text-jeopardy-gold mb-2 tracking-tight">
        JEOPARDY!
      </h1>
      <p className="text-blue-300 mb-10">Join a game on your phone</p>

      <div className="w-full max-w-sm space-y-4">
        <input
          type="text"
          placeholder="Your name"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          maxLength={30}
          className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-4 text-white text-lg placeholder:text-gray-500 focus:outline-none focus:border-jeopardy-gold"
          autoFocus
        />

        <input
          type="text"
          placeholder="Room code"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          maxLength={6}
          className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-4 text-white text-xl placeholder:text-gray-500 focus:outline-none focus:border-jeopardy-gold tracking-[0.3em] text-center font-mono"
        />

        <button
          onClick={handleJoin}
          disabled={loading}
          className="w-full bg-jeopardy-gold text-jeopardy-dark font-bold py-4 rounded-xl text-xl hover:brightness-110 transition-all disabled:opacity-50"
        >
          {loading ? 'Joining...' : 'Join Game'}
        </button>

        {error && <p className="text-red-400 text-center text-sm">{error}</p>}
      </div>

      <div className="mt-12 text-center">
        <p className="text-gray-500 text-sm mb-2">Hosting on a TV?</p>
        <a
          href="/host"
          className="text-jeopardy-gold hover:underline font-semibold"
        >
          Go to Host Screen →
        </a>
      </div>
    </main>
  )
}
