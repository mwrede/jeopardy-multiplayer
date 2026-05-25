'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { joinGame, deleteCustomBoard } from '@/lib/game-api'
import { useUser } from '@/lib/auth'
import { getMyBoards, type BoardSummary } from '@/lib/profile-api'

/**
 * LANDING PAGE
 *
 * Two primary actions:
 *  - Find a Game  → /find  (search + filter, then pick party/multiplayer)
 *  - Create a Game → /create (custom board builder)
 *
 * Join-by-code lives at the top so players hopping in from a TV display
 * don't have to scroll past anything.
 */
export default function Home() {
  const router = useRouter()
  const { user, profile } = useUser()
  const [playerName, setPlayerName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [myBoards, setMyBoards] = useState<BoardSummary[]>([])

  useEffect(() => {
    if (profile?.display_name && !playerName) setPlayerName(profile.display_name)
  }, [profile, playerName])

  useEffect(() => {
    if (!user) {
      setMyBoards([])
      return
    }
    getMyBoards(user.id).then(setMyBoards).catch(() => setMyBoards([]))
  }, [user])

  async function handleDeleteBoard(boardId: string, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return
    try {
      await deleteCustomBoard(boardId)
      setMyBoards((prev) => prev.filter((b) => b.id !== boardId))
    } catch (e: any) {
      setError(e.message || 'Failed to delete board')
    }
  }

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
      const { game, player } = await joinGame(roomCode.trim(), playerName.trim(), user?.id)
      localStorage.setItem('playerId', player.id)
      localStorage.setItem('playerName', player.name)
      const isMultiplayer = (game.settings as any)?.gameMode === 'multiplayer'
      router.push(`/game/${game.room_code}${isMultiplayer ? '/play' : ''}`)
    } catch (e: any) {
      setError(e.message || 'Failed to join game')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center p-6">
      <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-28 md:h-40 lg:h-52 w-auto mb-6 mt-4" />

      {/* Join existing party game — top spot for fast access */}
      <div className="w-full max-w-sm mb-10">
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

      {/* Two primary actions */}
      <div className="w-full max-w-3xl grid gap-4 md:grid-cols-2 lg:gap-6 mb-10">
        <a
          href="/find"
          className="group bg-jeopardy-blue-cell/30 hover:bg-jeopardy-blue-cell/50 border-2 border-jeopardy-blue rounded-2xl p-8 lg:p-12 text-center transition-all hover:scale-[1.02]"
        >
          <p className="text-4xl lg:text-6xl mb-3">🔍</p>
          <h2 className="text-2xl lg:text-3xl font-bold text-white mb-2">Find a Game</h2>
          <p className="text-gray-400 text-sm lg:text-base">
            Search real Jeopardy! games, themed mashups, and custom boards. Pick party or multiplayer mode.
          </p>
        </a>

        <a
          href="/create"
          className="group bg-green-900/20 hover:bg-green-900/30 border-2 border-green-500/40 rounded-2xl p-8 lg:p-12 text-center transition-all hover:scale-[1.02]"
        >
          <p className="text-4xl lg:text-6xl mb-3">✏️</p>
          <h2 className="text-2xl lg:text-3xl font-bold text-green-400 mb-2">Create a Game</h2>
          <p className="text-gray-400 text-sm lg:text-base">
            Build your own categories, clues, and answers. Save to play again later.
          </p>
        </a>
      </div>

      {/* Your saved boards — only when signed in and you have some */}
      {user && myBoards.length > 0 && (
        <div className="w-full max-w-4xl mb-10">
          <div className="flex items-center justify-between mb-3">
            <p className="text-gray-400 text-sm font-semibold uppercase tracking-wider">
              Your boards ({myBoards.length})
            </p>
            <a href="/create" className="text-green-400 hover:text-green-300 text-xs">
              + New board
            </a>
          </div>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {myBoards.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-1.5 bg-green-900/15 hover:bg-green-900/25 border border-green-500/40 rounded-lg px-3 py-2 transition-colors"
              >
                <span className="text-white text-sm truncate flex-1" title={b.title}>
                  {b.title}
                </span>
                {!b.is_public && (
                  <span className="text-[10px] text-gray-500 uppercase">Private</span>
                )}
                <button
                  onClick={() => router.push(`/create?boardId=${b.id}`)}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-2.5 py-1.5 rounded transition-colors whitespace-nowrap"
                  title="Edit this board"
                >
                  ✏️
                </button>
                <button
                  onClick={() => handleDeleteBoard(b.id, b.title)}
                  className="bg-red-700/60 hover:bg-red-600 text-white text-xs font-bold px-2 py-1.5 rounded transition-colors whitespace-nowrap"
                  title="Delete this board"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}
