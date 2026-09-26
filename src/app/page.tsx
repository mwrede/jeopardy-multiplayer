'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { deleteCustomBoard, createGameFromCustomBoard, createPresentationGame, loadCustomBoard } from '@/lib/game-api'
import { useUser } from '@/lib/auth'
import { getLibrary, forgetBoard, type LibraryBoard } from '@/lib/board-library'
import { getFriendsChampion } from '@/lib/leaderboard'
import { getChallengeChampion, formatMoney } from '@/lib/challenge'
import { ChromeWordmark } from '@/components/ChromeWordmark'
import { ProfileMenu } from '@/components/ProfileMenu'

/**
 * One cell of the home board — a game you can go and play.
 *
 * Only games get cells. Create, Join and the champions used to sit in a
 * second row of cells, which quietly made a clue cell mean two different
 * things; they're banners under the board now.
 */
function BoardCell({
  column,
  title,
  sub,
  href,
}: {
  column: string
  title: string
  sub?: string
  href: string
}) {
  return (
    <a href={href} className="board-cell home-cell">
      {/* The header row is hidden on a phone, so each cell wears its own
          category there instead. */}
      <span className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-blue-200/60 md:hidden">
        {column}
      </span>
      <span className="home-cell-title">{title}</span>
      {sub && <span className="mt-2 text-[11px] font-semibold text-blue-100/70 md:text-xs">{sub}</span>}
    </a>
  )
}

/** A banner under the board: not a clue, so not a clue cell. */
function Banner({
  emoji,
  title,
  sub,
  href,
  onClick,
  variant = 'plain',
  className = '',
}: {
  emoji: string
  title: string
  sub?: string
  href?: string
  onClick?: () => void
  variant?: 'plain' | 'copper' | 'walnut'
  className?: string
}) {
  const cls = `banner ${variant === 'copper' ? 'banner-copper' : variant === 'walnut' ? 'banner-walnut' : ''} ${className}`
  const inner = (
    <>
      <span className="banner-emoji">{emoji}</span>
      <span className="min-w-0">
        <span className="banner-title">{title}</span>
        {sub && <span className="banner-sub truncate">{sub}</span>}
      </span>
    </>
  )
  return href ? (
    <a href={href} className={cls}>{inner}</a>
  ) : (
    <button onClick={onClick} className={`${cls} w-full`}>{inner}</button>
  )
}

/**
 * LANDING PAGE
 *
 * The page IS a Jeopardy board: a row of category headers and, under them,
 * the things you can actually do. Same cells, same gutters, same walnut panel
 * as the board a game opens on — so the front door and the game are plainly
 * the same object, and there's no separate visual language to invent.
 *
 * The fifth column is JOIN, which is the one thing a guest arriving from a
 * shared link needs. It used to sit alone at the bottom of the page, below
 * four full-height tiles; here it's above the fold on every screen.
 */
export default function Home() {
  const router = useRouter()
  const { user } = useUser()
  const [error, setError] = useState('')
  const [myBoards, setMyBoards] = useState<LibraryBoard[]>([])
  const [busyBoard, setBusyBoard] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [rejoinCode, setRejoinCode] = useState('')
  // The reigning champions — real names, real records.
  const [friendsChamp, setFriendsChamp] = useState<{ name: string; stat: string } | null>(null)
  const [soloChamp, setSoloChamp] = useState<{ name: string; stat: string } | null>(null)

  useEffect(() => {
    getFriendsChampion()
      .then((c) => c && setFriendsChamp({ name: c.name, stat: `${c.wins} win${c.wins === 1 ? '' : 's'}` }))
      .catch(() => {})
    getChallengeChampion()
      .then((c) => c && setSoloChamp({ name: c.name, stat: formatMoney(c.totalScore) }))
      .catch(() => {})
  }, [])

  /**
   * Room codes are the only thing you need to get back in — the game
   * remembers you by the player id already in this browser, so rejoining
   * lands you back on your own seat and score rather than as a new player.
   */
  function handleRejoin() {
    const code = rejoinCode.trim().toUpperCase()
    if (code.length < 4) { setError('Enter the room code from the game.'); return }
    setError('')
    router.push(`/game/${code}/play`)
  }

  // The library is per-device plus, when signed in, everything you authored.
  // Runs for signed-out visitors too — boards can be made without an account.
  useEffect(() => {
    getLibrary(user?.id).then(setMyBoards).catch(() => setMyBoards([]))
  }, [user])

  /** Delete a board you made — gone for everyone, so confirm first. */
  async function handleDeleteBoard(boardId: string, title: string) {
    if (!confirm(`Delete "${title}"? This deletes it for everyone and can't be undone.`)) return
    try {
      await deleteCustomBoard(boardId)
      forgetBoard(boardId)
      setMyBoards((prev) => prev.filter((b) => b.id !== boardId))
    } catch (e: any) {
      setError(e.message || 'Failed to delete board')
    }
  }

  /** Drop someone else's board from your list. Their board is untouched. */
  function handleRemoveBoard(boardId: string) {
    forgetBoard(boardId)
    setMyBoards((prev) => prev.filter((b) => b.id !== boardId))
  }

  // Play asks how, the same three ways the board editor offers: shared
  // screen, everyone on phones, or hosted.
  const [pickerBoard, setPickerBoard] = useState<{ id: string; title: string } | null>(null)

  /** Start a game on a board from the list, in the chosen mode. */
  async function launchBoard(boardId: string, mode: 'party' | 'multiplayer' | 'present') {
    setBusyBoard(boardId)
    setError('')
    setPickerBoard(null)
    try {
      const board = await loadCustomBoard(boardId)
      if (mode === 'present') {
        const roomCode = await createPresentationGame(board.board_data)
        router.push(`/game/${roomCode}/present`)
        return
      }
      const roomCode = await createGameFromCustomBoard(board.board_data, mode)
      router.push(`/game/${roomCode}/${mode === 'multiplayer' ? 'play' : 'display'}`)
    } catch (e: any) {
      setError(e.message || 'Could not start that board')
      setBusyBoard(null)
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

  /** The three columns of the board — the games. */
  const GAMES = [
    {
      column: 'Friends',
      title: 'Browse the archive',
      sub: 'Every game, 1984 to last night',
      href: '/find',
    },
    {
      column: 'Strangers',
      title: 'Play the room',
      sub: 'Public tables, real people',
      href: '/community',
    },
    {
      column: 'Solo',
      title: 'Daily Challenge',
      sub: 'One board, one shot',
      href: '/challenge',
    },
  ]

  return (
    <main className="stage-page-deep flat-stage px-4 pb-20 md:px-8">
      <div className="mx-auto w-full max-w-5xl px-1 pb-10 pt-6 md:pt-10">

        <div className="mb-2 flex justify-end">
          <ProfileMenu />
        </div>

        <header className="text-center">
          <ChromeWordmark className="mx-auto h-auto w-full max-w-[260px] md:max-w-[380px]" />
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.24em] text-blue-100/65 md:text-[13px]">
            9,400 real games · Free · No sign-up
          </p>
        </header>

        {/* The board: three categories, three clue cells, nothing else. Same
            walnut panel, black gutters and bevelled cells the game itself
            uses — the front door and the game are the same object. */}
        <div className="board-panel mt-6 md:mt-9">
          <div className="board-wrapper">
            <div className="home-board grid grid-cols-3 gap-[3px] md:gap-1">
              {GAMES.map((g) => (
                <div key={g.column} className="board-category hidden min-h-[48px] px-2 md:flex">
                  <span className="text-[13px] font-black uppercase tracking-[0.1em] text-white lg:text-base">
                    {g.column}
                  </span>
                </div>
              ))}
              {GAMES.map((g) => (
                <BoardCell key={g.title} {...g} />
              ))}
            </div>
          </div>
        </div>

        {/* Banners. The two doors first, in copper so nobody mistakes them
            for a clue, then whoever currently holds each crown. */}
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <Banner
            emoji="✏️"
            title="Create a board"
            sub="Write your own clues"
            href="/create"
            variant="copper"
          />

          <div className="banner banner-walnut !py-2.5">
            <span className="banner-emoji">🎟️</span>
            <span className="min-w-0 flex-1">
              <span className="banner-title">Join a game</span>
              <span className="banner-sub">Rejoin your seat and score</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <input
                type="text"
                value={rejoinCode}
                onChange={(e) => setRejoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRejoin() }}
                placeholder="CODE"
                maxLength={6}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="field-stage h-9 w-[104px] px-2 text-center font-mono text-sm tracking-[0.14em]"
              />
              <button onClick={handleRejoin} className="btn-stage btn-copper btn-stage-sm px-3">
                Go
              </button>
            </span>
          </div>
        </div>

        {/* The crowns. Real names, real records — and a nudge when nobody
            holds one yet. */}
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
          <Banner
            emoji="👑"
            title={friendsChamp ? friendsChamp.name : 'Top player'}
            sub={friendsChamp ? `Most wins · ${friendsChamp.stat}` : 'Up for grabs — go win one'}
            href="/find"
          />
          <Banner
            emoji="🏅"
            title={soloChamp ? soloChamp.name : 'Best solo run'}
            sub={soloChamp ? `Best run · ${soloChamp.stat}` : 'Up for grabs — go set it'}
            href="/challenge"
          />
        </div>

        {error && <p className="mt-5 text-center text-sm text-copper-glow">{error}</p>}

        {/* Your boards, as banners rather than a table of rows — same reason
            the rest of this is banners. Only shown when you have some. */}
        {myBoards.length > 0 && (
          <section className="mt-6">
            <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.24em] text-blue-100/55">
              Your boards
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {myBoards.slice(0, 8).map((b) => (
                <div key={b.id} className="banner !gap-2.5 !py-2.5">
                  <span className="banner-emoji">{b.mine ? '📋' : '⭐'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="banner-title truncate text-white" title={b.title}>
                      {b.title}
                    </span>
                    <span className="banner-sub text-blue-100/70">
                      {b.mine ? 'Yours' : 'Saved from someone else'}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => setPickerBoard({ id: b.id, title: b.title })}
                      disabled={busyBoard === b.id}
                      className="rounded-lg bg-white/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-green-300 hover:bg-white/20 disabled:opacity-50"
                    >
                      {busyBoard === b.id ? '…' : '▶ Play'}
                    </button>
                    {/* Only what you authored can be edited. */}
                    {b.mine && (
                      <a
                        href={`/create?boardId=${b.id}`}
                        className="rounded-lg px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-100/70 hover:bg-white/10 hover:text-white"
                      >
                        Edit
                      </a>
                    )}
                    <button
                      onClick={() => handleShareBoard(b.id)}
                      className="rounded-lg px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-100/70 hover:bg-white/10 hover:text-white"
                    >
                      {copiedId === b.id ? 'Copied' : 'Share'}
                    </button>
                    {/* Deleting your own removes it for everyone; removing
                        someone else's just takes it off your list. */}
                    <button
                      onClick={() => (b.mine ? handleDeleteBoard(b.id, b.title) : handleRemoveBoard(b.id))}
                      className="rounded-lg px-1.5 py-1.5 text-[11px] font-bold text-blue-100/50 hover:bg-white/10 hover:text-red-300"
                      title={b.mine ? 'Delete this board' : 'Remove from your list'}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ))}
            </div>
            {myBoards.length > 8 && (
              <p className="mt-2 text-center text-[11px] text-blue-100/60">
                +{myBoards.length - 8} more
              </p>
            )}
          </section>
        )}

        <p className="mt-7 text-center text-[11px] text-ink-stage-2">
          Joining someone&apos;s game? Scan the QR code on their screen, or type the room code above.
        </p>


        {/* How do you want to play this board? Same three ways the editor
            offers, so Play here never silently picks for you. */}
        {pickerBoard && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => setPickerBoard(null)}
          >
            <div className="plate w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
              <div className="plate-surface p-6">
                <h3 className="mb-1 text-xl font-bold text-white">Play “{pickerBoard.title}”</h3>
                <p className="mb-5 text-sm text-ink-stage">
                  Buzzer modes open a lobby first so people can join.
                </p>

                <div className="space-y-2.5">
                  <button
                    onClick={() => launchBoard(pickerBoard.id, 'party')}
                    className="w-full rounded-xl border-2 border-white/15 bg-white/5 px-4 py-3.5 text-left transition-all hover:border-jeopardy-gold hover:bg-white/10"
                  >
                    <span className="block font-bold text-white">📺 With a TV</span>
                    <span className="mt-0.5 block text-xs text-gray-400">
                      Board on one shared screen, everyone buzzes in on their phones.
                    </span>
                  </button>
                  <button
                    onClick={() => launchBoard(pickerBoard.id, 'multiplayer')}
                    className="w-full rounded-xl border-2 border-white/15 bg-white/5 px-4 py-3.5 text-left transition-all hover:border-jeopardy-gold hover:bg-white/10"
                  >
                    <span className="block font-bold text-white">📱 Just phones</span>
                    <span className="mt-0.5 block text-xs text-gray-400">
                      Everyone gets their own board on their own device.
                    </span>
                  </button>
                  <button
                    onClick={() => launchBoard(pickerBoard.id, 'present')}
                    className="w-full rounded-xl border-2 border-white/15 bg-white/5 px-4 py-3.5 text-left transition-all hover:border-jeopardy-gold hover:bg-white/10"
                  >
                    <span className="block font-bold text-white">🎤 Host It</span>
                    <span className="mt-0.5 block text-xs text-gray-400">
                      You run the board and judge answers yourself.
                    </span>
                  </button>
                </div>

                <button
                  onClick={() => setPickerBoard(null)}
                  className="btn-secondary mt-5 w-full py-2.5 text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
