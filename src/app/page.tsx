'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { joinGame, deleteCustomBoard } from '@/lib/game-api'
import { useUser } from '@/lib/auth'
import { getMyBoards, type BoardSummary } from '@/lib/profile-api'
import { ChromeWordmark } from '@/components/ChromeWordmark'

/**
 * LANDING PAGE — stage set
 *
 * Wood picture-frame around a deep-blue stage plate. Chrome JEOPARDY!
 * wordmark on top, then a Reservations panel (Join by code), then two
 * action cards for Find / Create, then the signed-in user's boards.
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
    if (!playerName.trim()) { setError('Enter your name'); return }
    if (!roomCode.trim() || roomCode.trim().length < 4) { setError('Enter the room code from the TV'); return }
    setLoading(true); setError('')
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

  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <main className="stage-page p-4 md:p-8 pb-24">
      <div className="max-w-5xl mx-auto">
        <div className="frame">
          <span className="led-strip led-strip-left" />
          <span className="led-strip led-strip-right" />

          <div className="frame-inner p-6 md:p-10">
            {/* Masthead */}
            <div className="flex items-center justify-between gap-4 pb-6 mb-2 border-b border-white/10">
              <div className="text-ink-stage-2 uppercase text-[10px] tracking-[0.22em] font-bold">
                {profile?.display_name || 'Guest'}
              </div>
              <div className="text-copper uppercase text-xs tracking-[0.24em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                ▸ Multiplayer ◂
              </div>
              <div className="text-ink-stage-2 uppercase text-[10px] tracking-[0.22em] font-bold text-right">
                {dateLabel}
              </div>
            </div>

            {/* Hero wordmark */}
            <div className="text-center py-10 md:py-12">
              <ChromeWordmark className="mx-auto w-full max-w-[640px] h-auto" />
              <p className="mt-4 text-copper tracking-[0.32em] uppercase text-xs md:text-sm" style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '0 0 10px rgba(255,155,68,0.5)' }}>
                ▸ A Trivia Party in Three Rounds ◂
              </p>
              <p className="mt-4 text-ink-stage text-sm md:text-base max-w-xl mx-auto">
                Search 42 seasons of Jeopardy!, build your own board, or drop into a friend's game with a room code.
              </p>
            </div>

            {/* Join a party */}
            <div className="eyebrow-copper my-6">Jump into a party</div>
            <div className="plate">
              <div className="plate-surface p-5 md:p-7">
                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] gap-4 md:items-end">
                  <div>
                    <label className="block mb-1.5 text-copper uppercase text-[10px] tracking-[0.22em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                      Your name
                    </label>
                    <input
                      type="text"
                      placeholder="Your name"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      maxLength={15}
                      className="field-stage"
                    />
                  </div>
                  <div>
                    <label className="block mb-1.5 text-copper uppercase text-[10px] tracking-[0.22em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                      Room code
                    </label>
                    <input
                      type="text"
                      placeholder="ABCDEF"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                      maxLength={6}
                      className="field-stage field-code-stage"
                    />
                  </div>
                  <button
                    onClick={handleJoinParty}
                    disabled={loading}
                    className="btn-stage btn-copper btn-stage-lg md:mt-0"
                  >
                    {loading ? '…' : 'Join Room'}
                  </button>
                </div>
                {error && <p className="mt-3 text-center text-sm text-copper-glow">{error}</p>}
              </div>
            </div>

            {/* Action cards */}
            <div className="eyebrow-copper my-6 mt-8">Or start something new</div>
            <div className="grid gap-4 md:grid-cols-2">
              <a href="/find" className="plate group transition-transform hover:-translate-y-0.5">
                <div className="plate-surface grid grid-rows-[auto_1fr_auto] gap-3 p-6 md:p-7 min-h-[210px]">
                  <span className="text-copper uppercase text-xs tracking-[0.28em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '0 0 8px rgba(255,155,68,0.4)' }}>
                    ▸ Play
                  </span>
                  <div>
                    <h2 className="display-chrome text-4xl md:text-[42px] leading-none">Find a Game</h2>
                    <p className="mt-3 text-ink-stage text-sm max-w-[34ch]">
                      Real Jeopardy! episodes, themed mashups, and community boards — searchable end-to-end.
                    </p>
                  </div>
                  <span className="btn-stage btn-copper self-start">Open Archive →</span>
                </div>
              </a>

              <a href="/create" className="plate group transition-transform hover:-translate-y-0.5">
                <div className="plate-surface grid grid-rows-[auto_1fr_auto] gap-3 p-6 md:p-7 min-h-[210px]">
                  <span className="text-copper uppercase text-xs tracking-[0.28em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '0 0 8px rgba(255,155,68,0.4)' }}>
                    ▸ Create
                  </span>
                  <div>
                    <h2 className="display-chrome text-4xl md:text-[42px] leading-none">Build a Board</h2>
                    <p className="mt-3 text-ink-stage text-sm max-w-[34ch]">
                      Draft your own categories and clues. Present at a party or save it for later.
                    </p>
                  </div>
                  <span className="btn-stage btn-chrome self-start">New Board →</span>
                </div>
              </a>
            </div>

            {/* Saved boards (only when signed in and non-empty) */}
            {user && myBoards.length > 0 && (
              <>
                <div className="eyebrow-copper my-6 mt-8">Your saved boards</div>
                <div className="grid gap-1">
                  {myBoards.map((b, i) => (
                    <div
                      key={b.id}
                      className="grid grid-cols-[44px_1fr_auto_auto] gap-4 items-center px-4 py-3 rounded-md border border-white/10 bg-black/40 hover:border-copper/60 hover:bg-black/60 transition-colors"
                    >
                      <span
                        className="text-copper text-xl tabular-nums"
                        style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '0 0 10px rgba(255,155,68,0.55)' }}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-white font-semibold truncate">{b.title}</span>
                      <span className="text-ink-stage-2 uppercase text-[11px] tracking-[0.2em] hidden md:block" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                        {!b.is_public && 'Private · '}
                        {new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <span className="flex gap-1.5">
                        <button
                          onClick={() => router.push(`/create?boardId=${b.id}`)}
                          className="btn-stage btn-stage-sm btn-stage-ghost"
                          title="Edit this board"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteBoard(b.id, b.title)}
                          className="btn-stage btn-stage-sm btn-stage-ghost"
                          title="Delete this board"
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
