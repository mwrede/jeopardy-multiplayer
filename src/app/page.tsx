'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { deleteCustomBoard } from '@/lib/game-api'
import { useUser } from '@/lib/auth'
import { getMyBoards, type BoardSummary } from '@/lib/profile-api'
import { ChromeWordmark } from '@/components/ChromeWordmark'
import { TypingClue } from '@/components/TypingClue'

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

        {/* Wordmark — carries the identity on its own, no tagline needed */}
        <header className="text-center">
          <ChromeWordmark className="mx-auto h-auto w-full max-w-[300px] md:max-w-[420px]" />
        </header>

        {/* The two things you can do — built as two cells of a real board,
            mounted in a walnut panel. */}
        <div className="board-panel mt-10 md:mt-14">
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

            <a href="/create" className="tile">
              {/* A clue being written, live — the authoring loop, shown. */}
              <TypingClue />
              <span
                className="pointer-events-none absolute right-4 top-4 text-3xl opacity-70"
                aria-hidden="true"
              >
                &#9997;
              </span>
              <div className="tile-body">
                <h2 className="tile-title text-3xl md:text-4xl">Create a Board</h2>
                <p className="mt-2 text-sm text-blue-100/75">
                  Write your own categories and clues, then host the game.
                </p>
              </div>
            </a>
          </div>
        </div>

        {/* Saved boards */}
        {myBoards.length > 0 && (
          <section className="mt-14">
            <div className="eyebrow-copper mb-4">Your boards</div>
            <ul className="grid gap-1.5">
              {myBoards.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center gap-4 rounded-md border border-white/10 bg-black/30 px-4 py-3 transition-colors hover:border-copper/50 hover:bg-black/50"
                >
                  <span className="flex-1 truncate font-semibold text-white">{b.title}</span>
                  <span className="hidden text-[11px] uppercase tracking-[0.16em] text-ink-stage-2 sm:block">
                    {!b.is_public && 'Private \u00b7 '}
                    {new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <span className="flex gap-1.5">
                    <button
                      onClick={() => router.push(`/create?boardId=${b.id}`)}
                      className="btn-stage btn-stage-sm btn-stage-ghost"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleShareBoard(b.id)}
                      className="btn-stage btn-stage-sm btn-stage-ghost"
                      title="Copy a link to this board"
                    >
                      {copiedId === b.id ? 'Copied' : 'Share'}
                    </button>
                    <button
                      onClick={() => handleDeleteBoard(b.id, b.title)}
                      className="btn-stage btn-stage-sm btn-stage-ghost"
                      title="Delete this board"
                    >
                      &#10005;
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {error && <p className="mt-6 text-center text-sm text-copper-glow">{error}</p>}

        <p className="mt-16 text-center text-xs text-ink-stage-2">
          Joining a game? Scan the QR code on the host&apos;s screen, or open the link they send you.
        </p>
      </div>
    </main>
  )

}
