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
      <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-28 md:h-40 w-auto mb-4" />
      <p className="text-blue-300 mb-10">Join a game on your phone</p>

      <div className="w-full max-w-sm space-y-4">
        <input
          type="text"
          placeholder="Your name"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          maxLength={30}
          className="input-base text-lg"
          autoFocus
        />

        <input
          type="text"
          placeholder="Room code"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          maxLength={6}
          className="input-base text-xl tracking-[0.3em] text-center font-mono"
        />

        <button
          onClick={handleJoin}
          disabled={loading}
          className="btn-primary w-full py-4 text-xl"
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
