'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { deleteCustomBoard } from '@/lib/game-api'
import { useUser } from '@/lib/auth'
import { getMyBoards, type BoardSummary } from '@/lib/profile-api'
import { ChromeWordmark } from '@/components/ChromeWordmark'
import { TypingClue } from '@/components/TypingClue'
import { ProfileMenu } from '@/components/ProfileMenu'

/**
 * LANDING PAGE
 *
 * Chrome wordmark, then the only two things you can do here: play a game or
 * build a board. No join-by-code form — joining happens by scanning the QR
 * on the host's screen or opening a link they shared, so there is nothing to
 * type here.
 */
export default function Home() {
  const router = useRouter()
  const { user, profile } = useUser()
  const [error, setError] = useState('')
  const [myBoards, setMyBoards] = useState<BoardSummary[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)

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

  /** Copy a shareable link to one of your boards. */
  async function handleShareBoard(boardId: string) {
    const url = `${window.location.origin}/find?board=${boardId}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      window.prompt('Copy this link:', url)
    }
    setCopiedId(boardId)
    setTimeout(() => setCopiedId((id) => (id === boardId ? null : id)), 2000)
  }

  return (
    <main className="stage-page-deep flat-stage px-4 pb-24 md:px-8">
      <div className="mx-auto w-full max-w-5xl px-1 pb-14 pt-10 md:pt-16">

        <div className="mb-2 flex justify-end">
          <ProfileMenu />
        </div>

        {/* Wordmark — carries the identity on its own, no tagline needed */}
        <header className="text-center">
          <ChromeWordmark className="mx-auto h-auto w-full max-w-[300px] md:max-w-[420px]" />
        </header>

        {/* Two separately framed buttons — each a board cell in its own
            walnut panel, rather than one board split down the middle. */}
        <div className="mt-10 grid gap-5 md:mt-14 md:grid-cols-2">
          <div className="board-panel">
            <div className="board-panel-inner">
              <a href="/find" className="tile">
                <img
                  src="/contestants.png"
                  alt=""
                  aria-hidden="true"
                  className="tile-art"
                />
                <div className="tile-body">
                  <h2 className="tile-title text-3xl md:text-4xl">Play Jeopardy!</h2>
                  <p className="mt-2 text-sm text-blue-100/75">
                    Forty-two seasons, themed boards, and community games.
                  </p>
                </div>
              </a>
            </div>
          </div>

          <div className="board-panel">
            <div className="board-panel-inner">
              <a href="/create" className="tile">
                {/* A clue being written, live — the authoring loop, shown. */}
                <TypingClue />
                <div className="tile-body">
                  <h2 className="tile-title text-3xl md:text-4xl">Create a Board</h2>
                  <p className="mt-2 text-sm text-blue-100/75">
                    {myBoards.length > 0
                      ? 'Pick up where you left off, or start a new one.'
                      : 'Write your own categories and clues, then host the game.'}
                  </p>
                </div>
              </a>

              {/* Your boards sit with the tile that made them. Separate links,
                  not nested inside the tile's anchor. */}
              {myBoards.length > 0 && (
                <div className="mt-1 border-t-2 border-black bg-[#070E9A]">
                  {myBoards.slice(0, 4).map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center gap-2 border-b border-black/40 px-3 py-2 last:border-b-0"
                    >
                      <a
                        href={`/create?boardId=${b.id}`}
                        className="flex-1 truncate text-sm font-semibold text-white hover:text-jeopardy-gold-light"
                        title={b.title}
                      >
                        {b.title}
                      </a>
                      <button
                        onClick={() => handleShareBoard(b.id)}
                        className="shrink-0 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-100/70 hover:bg-white/10 hover:text-white"
                      >
                        {copiedId === b.id ? 'Copied' : 'Share'}
                      </button>
                      <button
                        onClick={() => handleDeleteBoard(b.id, b.title)}
                        className="shrink-0 rounded px-2 py-1 text-[10px] font-bold text-blue-100/50 hover:bg-white/10 hover:text-red-300"
                        title="Delete this board"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {myBoards.length > 4 && (
                    <p className="px-3 py-2 text-center text-[11px] text-blue-100/60">
                      +{myBoards.length - 4} more in the editor
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {error && <p className="mt-6 text-center text-sm text-copper-glow">{error}</p>}

        <p className="mt-16 text-center text-xs text-ink-stage-2">
          Joining a game? Scan the QR code on the host&apos;s screen, or open the link they send you.
        </p>
      </div>
    </main>
  )

}
