'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { joinGame, listCustomBoards, loadCustomBoard, createPresentationGame, deleteCustomBoard } from '@/lib/game-api'

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
  const [boards, setBoards] = useState<Array<{ id: string; title: string; created_at: string }>>([])
  const [boardsLoading, setBoardsLoading] = useState(true)
  const [playingBoardId, setPlayingBoardId] = useState<string | null>(null)

  useEffect(() => {
    listCustomBoards()
      .then((b) => setBoards(b))
      .catch(() => setBoards([]))
      .finally(() => setBoardsLoading(false))
  }, [])

  async function handlePlayBoard(boardId: string) {
    setPlayingBoardId(boardId)
    setError('')
    try {
      const board = await loadCustomBoard(boardId)
      const roomCode = await createPresentationGame(board.board_data)
      router.push(`/game/${roomCode}/present`)
    } catch (e: any) {
      setError(e.message || 'Failed to start presentation')
      setPlayingBoardId(null)
    }
  }

  async function handleDeleteBoard(boardId: string, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return
    try {
      await deleteCustomBoard(boardId)
      setBoards((prev) => prev.filter((b) => b.id !== boardId))
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
      <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-28 md:h-40 lg:h-52 w-auto mb-8" />

      {/* Mode cards */}
      <div className="w-full max-w-lg lg:max-w-4xl grid gap-4 md:grid-cols-3 lg:gap-6 mb-10">
        {/* Multiplayer */}
        <a
          href="/multiplayer"
          className="group bg-jeopardy-blue-cell/30 hover:bg-jeopardy-blue-cell/50 border-2 border-jeopardy-blue rounded-2xl p-6 lg:p-10 text-center transition-all hover:scale-[1.02]"
        >
          <p className="text-3xl lg:text-5xl mb-2">🌐</p>
          <h2 className="text-xl lg:text-2xl font-bold text-white mb-1">Multiplayer</h2>
          <p className="text-gray-400 text-sm lg:text-base">Play on your phone or computer. No TV needed.</p>
        </a>

        {/* Party */}
        <a
          href="/host"
          className="group bg-jeopardy-gold/10 hover:bg-jeopardy-gold/20 border-2 border-jeopardy-gold/50 rounded-2xl p-6 lg:p-10 text-center transition-all hover:scale-[1.02]"
        >
          <p className="text-3xl lg:text-5xl mb-2">📺</p>
          <h2 className="text-xl lg:text-2xl font-bold text-jeopardy-gold mb-1">Party</h2>
          <p className="text-gray-400 text-sm lg:text-base">Host on a TV, players buzz in on phones.</p>
        </a>

        {/* Create Your Own */}
        <a
          href="/create"
          className="group bg-green-900/20 hover:bg-green-900/30 border-2 border-green-500/40 rounded-2xl p-6 lg:p-10 text-center transition-all hover:scale-[1.02]"
        >
          <p className="text-3xl lg:text-5xl mb-2">✏️</p>
          <h2 className="text-xl lg:text-2xl font-bold text-green-400 mb-1">Create Board</h2>
          <p className="text-gray-400 text-sm lg:text-base">Build your own categories, clues, and answers.</p>
        </a>
      </div>

      {/* Saved custom boards */}
      {!boardsLoading && boards.length > 0 && (
        <div className="w-full max-w-lg lg:max-w-4xl mb-8">
          <p className="text-gray-400 text-sm text-center mb-3">
            Saved boards — click ▶ to present
          </p>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3 max-h-64 overflow-y-auto pr-1">
            {boards.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-1.5 bg-green-900/10 hover:bg-green-900/20 border border-green-500/30 rounded-lg px-3 py-2 transition-colors"
              >
                <span className="text-white text-sm truncate flex-1" title={b.title}>
                  {b.title}
                </span>
                <button
                  onClick={() => handlePlayBoard(b.id)}
                  disabled={playingBoardId === b.id}
                  className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-2.5 py-1.5 rounded transition-colors disabled:opacity-50 whitespace-nowrap"
                  title="Present this board"
                >
                  {playingBoardId === b.id ? '...' : '▶'}
                </button>
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
