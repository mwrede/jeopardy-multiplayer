'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createGame, joinGame } from '@/lib/game-api'
import { supabase } from '@/lib/supabase'
import { DEFAULT_CASUAL_SETTINGS } from '@/types/game'
import type { GameLength } from '@/types/game'

/**
 * MULTIPLAYER LOBBY
 *
 * Create or join a multiplayer game (no TV needed).
 * - Public: find an open room or create one
 * - Private: create a room and share the code
 * - Join: enter a room code
 */
export default function MultiplayerLobby() {
  const router = useRouter()
  const [playerName, setPlayerName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [gameLength, setGameLength] = useState<GameLength>('rapid')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCreate() {
    if (!playerName.trim()) {
      setError('Enter your name')
      return
    }
    setLoading(true)
    setError('')
    try {
      const settings = {
        ...DEFAULT_CASUAL_SETTINGS,
        gameMode: 'multiplayer' as const,
        gameLength,
      }
      const { game } = await createGame(settings)
      // Join the game we just created
      const { player } = await joinGame(game.room_code, playerName.trim())
      localStorage.setItem('playerId', player.id)
      localStorage.setItem('playerName', player.name)
      router.push(`/game/${game.room_code}/play`)
    } catch (e: any) {
      setError(e.message || 'Failed to create game')
    } finally {
      setLoading(false)
    }
  }

  async function handleJoin() {
    if (!playerName.trim()) {
      setError('Enter your name')
      return
    }
    if (!roomCode.trim() || roomCode.trim().length < 4) {
      setError('Enter a room code')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { game, player } = await joinGame(roomCode.trim(), playerName.trim())
      localStorage.setItem('playerId', player.id)
      localStorage.setItem('playerName', player.name)
      router.push(`/game/${game.room_code}/play`)
    } catch (e: any) {
      setError(e.message || 'Failed to join game')
    } finally {
      setLoading(false)
    }
  }

  async function handlePublic() {
    if (!playerName.trim()) {
      setError('Enter your name')
      return
    }
    setLoading(true)
    setError('')
    try {
      // Try to find an open multiplayer lobby
      const { data: openGames } = await supabase
        .from('games')
        .select('room_code')
        .eq('status', 'lobby')
        .order('created_at', { ascending: false })
        .limit(10)

      // Filter to multiplayer games by checking settings
      let joinedRoom: string | null = null
      if (openGames) {
        for (const g of openGames) {
          try {
            const { game, player } = await joinGame(g.room_code, playerName.trim())
            if ((game.settings as any)?.gameMode === 'multiplayer') {
              localStorage.setItem('playerId', player.id)
              localStorage.setItem('playerName', player.name)
              joinedRoom = game.room_code
              break
            }
          } catch {
            // Room full or name taken, try next
          }
        }
      }

      if (joinedRoom) {
        router.push(`/game/${joinedRoom}/play`)
      } else {
        // No open rooms — create a new one
        await handleCreate()
      }
    } catch (e: any) {
      setError(e.message || 'Failed to find a game')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-jeopardy-dark">
      <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-20 md:h-32 w-auto mb-6" />
      <h2 className="text-2xl font-bold text-white mb-8">Multiplayer</h2>

      {/* Name input */}
      <div className="w-full max-w-sm mb-6">
        <input
          type="text"
          placeholder="Your name"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          maxLength={30}
          className="input-base text-lg"
          autoFocus
        />
      </div>

      {/* Game length */}
      <div className="flex gap-3 mb-8">
        {([
          { id: 'full' as GameLength, label: 'Full', desc: '6×5' },
          { id: 'half' as GameLength, label: 'Half', desc: '6×3' },
          { id: 'rapid' as GameLength, label: 'Rapid', desc: '3×3' },
        ]).map((gl) => (
          <button
            key={gl.id}
            onClick={() => setGameLength(gl.id)}
            className={`px-5 py-2 rounded-xl text-center transition-all ${
              gameLength === gl.id
                ? 'bg-jeopardy-gold/20 border-2 border-jeopardy-gold text-jeopardy-gold'
                : 'bg-white/5 border-2 border-transparent text-gray-400 hover:bg-white/10'
            }`}
          >
            <span className="font-bold block">{gl.label}</span>
            <span className="text-xs opacity-60">{gl.desc}</span>
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div className="w-full max-w-sm space-y-3">
        <button
          onClick={handlePublic}
          disabled={loading}
          className="btn-primary w-full py-4 text-lg"
        >
          {loading ? 'Finding game...' : '🌐 Quick Match'}
        </button>

        <button
          onClick={handleCreate}
          disabled={loading}
          className="btn-secondary w-full py-4 text-lg"
        >
          🔒 Create Private Room
        </button>

        <div className="flex gap-2 pt-2">
          <input
            type="text"
            placeholder="Room code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            maxLength={6}
            className="input-base text-lg tracking-[0.2em] text-center font-mono flex-1"
          />
          <button
            onClick={handleJoin}
            disabled={loading}
            className="btn-primary px-6 py-3"
          >
            Join
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-center text-sm mt-4">{error}</p>}

      <a href="/" className="text-gray-500 hover:text-white text-sm mt-8 transition-colors">
        ← Back
      </a>
    </main>
  )
}
