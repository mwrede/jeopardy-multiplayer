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
 * One cell of the home board.
 *
 * `column` is the category it sits under. On a wide screen the header row
 * carries those names and the cell shows only its own text; on a phone the
 * header row is hidden and each cell wears its category as an eyebrow, so the
 * grid can reflow to two columns without losing what anything means.
 */
function BoardCell({
  column,
  title,
  sub,
  href,
  onClick,
  className = '',
}: {
  column: string
  title: string
  sub?: string
  href?: string
  onClick?: () => void
  className?: string
}) {
  const inner = (
    <>
      <span className="mb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-blue-200/60 md:hidden">
        {column}
      </span>
      <span className="home-cell-title">{title}</span>
      {sub && <span className="mt-1.5 text-[11px] font-semibold text-blue-100/70">{sub}</span>}
    </>
  )
  const cls = `board-cell home-cell ${className}`
  return href ? (
    <a href={href} className={cls}>{inner}</a>
  ) : (
    <button onClick={onClick} className={cls}>{inner}</button>
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

  const COLUMNS = ['Friends', 'Strangers', 'Solo', 'Create', 'Join']

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

        {/* The board. Walnut panel, black gutters, clue cells — the same
            construction the game itself uses. */}
        <div className="board-panel mt-7 md:mt-10">
          <div className="board-wrapper">
            <div className="home-board grid grid-cols-2 gap-[3px] md:grid-cols-5 md:gap-1">

              {/* Header row — the categories. Hidden on a phone, where each
                  cell wears its own eyebrow instead. */}
              {COLUMNS.map((name) => (
                <div key={name} className="board-category hidden min-h-[46px] px-2 md:flex">
                  <span className="text-[13px] font-black uppercase tracking-[0.1em] text-white lg:text-sm">
                    {name}
                  </span>
                </div>
              ))}

              {/* Row 1 */}
              <BoardCell
                column="Friends"
                title="Browse the archive"
                sub="Every game, 1984 to last night"
                href="/find"
              />
              <BoardCell
                column="Strangers"
                title="Play the room"
                sub="Public tables, real people"
                href="/community"
              />
              <BoardCell
                column="Solo"
                title="Daily Challenge"
                sub="One board, one shot"
                href="/challenge"
              />
              <BoardCell
                column="Create"
                title="Build a board"
                sub="Write your own clues"
                href="/create"
              />

              {/* JOIN — one tall cell holding the room code. Last on a phone
                  so the grid reads top to bottom; column five on a wide
                  screen, spanning both clue rows like a podium. */}
              <div className="board-cell home-cell order-last col-span-2 !cursor-default flex-col hover:brightness-100 active:scale-100 md:order-none md:col-span-1 md:col-start-5 md:row-span-2 md:row-start-2">
                <span className="mb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-blue-200/60 md:hidden">
                  Join
                </span>
                <span className="home-cell-title">Got a code?</span>
                <span className="mb-3 mt-1.5 text-[11px] font-semibold text-blue-100/70">
                  Rejoin your seat and score
                </span>
                {/* Stacked, not side by side: this cell is one board column
                    wide, and a code field plus a button on one line squeezed
                    "ROOM CODE" down to "ROOM C". */}
                <div className="flex w-full max-w-[220px] flex-col gap-2">
                  <input
                    type="text"
                    value={rejoinCode}
                    onChange={(e) => setRejoinCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRejoin() }}
                    placeholder="ROOM CODE"
                    maxLength={6}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    className="field-stage w-full text-center font-mono text-sm tracking-[0.18em]"
                  />
                  <button onClick={handleRejoin} className="btn-stage btn-copper w-full">
                    Go
                  </button>
                </div>
              </div>

              {/* Row 2 */}
              <BoardCell
                column="Friends"
                title={friendsChamp ? `👑 ${friendsChamp.name}` : 'Mashups'}
                sub={friendsChamp ? `Top player · ${friendsChamp.stat}` : 'Mix any categories you like'}
                href="/find?type=mashups"
              />
              <BoardCell
                column="Strangers"
                title="Who's playing"
                sub="Open tables right now"
                href="/community"
              />
              <BoardCell
                column="Solo"
                title={soloChamp ? `👑 ${soloChamp.name}` : 'High score'}
                sub={soloChamp ? `Best run · ${soloChamp.stat}` : 'Up for grabs'}
                href="/challenge"
              />
              <BoardCell
                column="Create"
                title={myBoards.length > 0 ? `Your boards · ${myBoards.length}` : 'Your boards'}
                sub={myBoards.length > 0 ? 'Play, edit or share below' : 'Nothing saved yet'}
                href={myBoards.length > 0 ? '#your-boards' : '/create'}
              />
            </div>
          </div>
        </div>

        {error && <p className="mt-5 text-center text-sm text-copper-glow">{error}</p>}

        {/* Your boards — only when there are some. An empty slab here was as
            visually heavy as the board above it and said nothing. */}
        {myBoards.length > 0 && (
          <section id="your-boards" className="mt-6 scroll-mt-6">
            <div className="board-panel">
              <div className="board-panel-inner">
                <div className="bg-[#070E9A] px-4 py-2.5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-jeopardy-gold-light">
                    Your boards
                  </p>
                </div>
                <div className="mt-1 border-t-2 border-black bg-[#070E9A]">
                  {myBoards.slice(0, 8).map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center gap-1.5 border-b border-black/40 px-3 py-2 last:border-b-0"
                    >
                      <span className="flex-1 truncate text-sm font-semibold text-white" title={b.title}>
                        {b.title}
                        {!b.mine && (
                          <span className="ml-1.5 text-[9px] uppercase tracking-wider text-blue-100/50">
                            Saved
                          </span>
                        )}
                      </span>

                      <button
                        onClick={() => setPickerBoard({ id: b.id, title: b.title })}
                        disabled={busyBoard === b.id}
                        className="shrink-0 rounded bg-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-green-300 hover:bg-white/20 disabled:opacity-50"
                      >
                        {busyBoard === b.id ? '…' : 'Play'}
                      </button>

                      {/* Only what you authored can be edited. */}
                      {b.mine && (
                        <a
                          href={`/create?boardId=${b.id}`}
                          className="shrink-0 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-100/70 hover:bg-white/10 hover:text-white"
                        >
                          Edit
                        </a>
                      )}

                      <button
                        onClick={() => handleShareBoard(b.id)}
                        className="shrink-0 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-100/70 hover:bg-white/10 hover:text-white"
                      >
                        {copiedId === b.id ? 'Copied' : 'Share'}
                      </button>

                      {/* Deleting your own removes it for everyone; removing
                          someone else's just takes it off your list. */}
                      <button
                        onClick={() => (b.mine ? handleDeleteBoard(b.id, b.title) : handleRemoveBoard(b.id))}
                        className="shrink-0 rounded px-2 py-1 text-[10px] font-bold text-blue-100/50 hover:bg-white/10 hover:text-red-300"
                        title={b.mine ? 'Delete this board' : 'Remove from your list'}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {myBoards.length > 8 && (
                    <p className="px-3 py-2 text-center text-[11px] text-blue-100/60">
                      +{myBoards.length - 8} more
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        <p className="mt-6 text-center text-[11px] text-ink-stage-2">
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
