'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { deleteCustomBoard, createGameFromCustomBoard, createPresentationGame, loadCustomBoard } from '@/lib/game-api'
import { useUser } from '@/lib/auth'
import { getLibrary, forgetBoard, type LibraryBoard } from '@/lib/board-library'
import { getFriendsChampion } from '@/lib/leaderboard'
import { getChallengeChampion, formatMoney } from '@/lib/challenge'
import { ChromeWordmark } from '@/components/ChromeWordmark'
import { TypingClue } from '@/components/TypingClue'
import { ProfileMenu } from '@/components/ProfileMenu'

/** Corner chip naming a tile's mode — private, public, or solo. */
function TileBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="absolute right-2 top-2 z-10 rounded-full border border-white/25 bg-black/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-jeopardy-gold-light shadow-md">
      {children}
    </span>
  )
}

/**
 * A tile's artwork spot, given over to a real person: the reigning champion
 * of that mode, crowned. Until someone holds the crown, it's "up for grabs".
 */
function TileChampion({ champ }: { champ: { name: string; stat: string } | null }) {
  return (
    // justify-start, not center: a three-line tile title climbs into the
    // art area, so the champion stack hugs the top to stay clear of it.
    <span className="tile-art flex flex-col items-center justify-start gap-0.5 pt-6" aria-hidden="true">
      <span style={{ fontSize: 40, lineHeight: 1.1, filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.5))' }}>&#128081;</span>
      <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-jeopardy-gold-light">
        Top Player
      </span>
      {champ ? (
        <span className="max-w-[92%] truncate text-base font-bold text-white">
          {champ.name} <span className="font-bold tabular-nums text-jeopardy-gold-light">· {champ.stat}</span>
        </span>
      ) : (
        <span className="text-sm font-semibold text-blue-100/70">Up for grabs</span>
      )}
    </span>
  )
}

/**
 * LANDING PAGE
 *
 * Chrome wordmark, then the two things you come here to do: play a game or
 * build a board.
 *
 * At the foot of the page, a room code box. Scanning the host's QR is still
 * the usual way in, but it only helps someone sitting in front of that screen —
 * a player whose phone died, whose tab closed, or who simply left mid-game had
 * no way back to a game they were already in.
 */
export default function Home() {
  const router = useRouter()
  const { user, profile } = useUser()
  const [error, setError] = useState('')
  const [myBoards, setMyBoards] = useState<LibraryBoard[]>([])
  const [busyBoard, setBusyBoard] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [rejoinCode, setRejoinCode] = useState('')
  // The reigning champions shown on the tiles — real names, real records.
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

  // Play used to hardwire TV mode. Now it asks — the same three ways the
  // board editor offers: shared screen, everyone on phones, or hosted.
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

        {/* Four separately framed buttons — each a board cell in its own
            walnut panel, rather than one board split down the middle. Each
            carries a corner badge naming its mode: private, public, or solo. */}
        <div className="mt-10 grid gap-5 sm:grid-cols-2 md:mt-14 xl:grid-cols-4">
          <div className="board-panel">
            <div className="board-panel-inner">
              <a href="/find" className="tile">
                <TileBadge>Private games</TileBadge>
                <TileChampion champ={friendsChamp} />
                <div className="tile-body">
                  <h2 className="tile-title text-3xl md:text-4xl">Play with Friends &#10084;&#65039;</h2>
                </div>
              </a>
            </div>
          </div>

          <div className="board-panel">
            <div className="board-panel-inner">
              <a href="/community" className="tile">
                <TileBadge>Public · vs real people</TileBadge>
                {/* The three contestants at their podiums — strangers, met on stage. */}
                <img
                  src="/contestants.png"
                  alt=""
                  aria-hidden="true"
                  className="tile-art"
                />
                <div className="tile-body">
                  <h2 className="tile-title text-3xl md:text-4xl">Play Strangers</h2>
                </div>
              </a>
            </div>
          </div>

          <div className="board-panel">
            <div className="board-panel-inner">
              <a href="/challenge" className="tile">
                <TileBadge>Solo</TileBadge>
                <TileChampion champ={soloChamp} />
                <div className="tile-body">
                  <h2 className="tile-title text-3xl md:text-4xl">Solo Challenge</h2>
                </div>
              </a>
            </div>
          </div>

          <div className="board-panel">
            <div className="board-panel-inner">
              <a href="/create" className="tile">
                <TileBadge>Board builder</TileBadge>
                {/* A clue being written, live — the authoring loop, shown. */}
                <TypingClue />
                <div className="tile-body">
                  <h2 className="tile-title text-3xl md:text-4xl">Create a Board</h2>
                </div>
              </a>

              {/* Your boards sit with the tile that made them. Separate links,
                  not nested inside the tile's anchor. */}
            </div>
          </div>
        </div>

        {/* Your boards — below the tiles, in their own panel, so the two
            buttons stay the same height and this list gets room to grow. */}
        <section className="mt-6">
          <div className="board-panel">
            <div className="board-panel-inner">
              <div className="bg-[#070E9A] px-4 py-2.5">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-jeopardy-gold-light">
                  Your boards
                </p>
              </div>
              {myBoards.length === 0 && (
              <p className="mt-1 border-t-2 border-black bg-[#070E9A] px-3 py-3 text-center text-[11px] text-blue-100/60">
              Boards you make or save will show up here.
              </p>
            )}
            {myBoards.length > 0 && (
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
            )}
            </div>
          </div>
        </section>

        {error && <p className="mt-6 text-center text-sm text-copper-glow">{error}</p>}

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

        {/* Below everything: the way back into a game you're already in. */}
        <section className="mt-16 border-t border-white/10 pt-8">
          <div className="mx-auto max-w-sm text-center">
            <div className="eyebrow-copper mb-2">Join or rejoin a game</div>
            <p className="mb-4 text-xs text-ink-stage-2">
              Got a room code? Type it in. If you were already playing, this puts you
              back on your own seat and score.
            </p>
            <div className="flex gap-2">
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
                className="field-stage flex-1 text-center font-mono tracking-[0.3em]"
              />
              <button onClick={handleRejoin} className="btn-stage btn-copper">
                Go
              </button>
            </div>
            <p className="mt-4 text-xs text-ink-stage-2">
              Or scan the QR code on the host&apos;s screen.
            </p>
          </div>
        </section>
      </div>
    </main>
  )

}
