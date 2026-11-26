'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  hostOpenBuzzers,
  hostJudge,
  hostAdjustScore,
  hostSetScore,
  hostCloseClue,
  hostGrantFloor,
  hostTakeBackFloor,
  getBuzzOrder,
  type BuzzOrderRow,
} from '@/lib/game-api'
import { supabase } from '@/lib/supabase'
import type { Clue, Player } from '@/types/game'
import { JoinQr } from './JoinQr'

/**
 * BUZZER CONSOLE — a floating panel on the presenter's own screen.
 *
 * Everything a host does while a clue is live, in one window they can put
 * wherever it suits them: lock and unlock the buzzers, watch people ring in,
 * hand the floor to whoever gets to answer, rule on it, and fix scores.
 * Drag it by the title bar, resize from the corner, collapse it to a strip
 * when the board needs the room.
 *
 * The console deliberately owns the clock. Nothing here times out on its own
 * and nothing is graded automatically — a hosted game is a person with a
 * microphone, and every decision waits for them. The one thing the room does
 * without being asked is pick the fastest buzzer, because that is a
 * measurement rather than a judgment.
 *
 * Position and size persist per room, so it comes back where it was left.
 */

const MIN_W = 300
const MIN_H = 260

type Box = { x: number; y: number; w: number; h: number }

/** Big enough to hold a queue and a dozen scores without a scroll. */
const DEFAULT_BOX: Box = { x: 24, y: 76, w: 380, h: 600 }

function loadBox(roomCode: string): Box {
  if (typeof window === 'undefined') return DEFAULT_BOX
  try {
    const raw = localStorage.getItem(`buzzerConsole:${roomCode}`)
    if (raw) {
      const b = JSON.parse(raw) as Box
      // An old saved box from before the panel grew would reopen too small to
      // show the scores, which is the thing the host most needs to see.
      return { ...b, w: Math.max(MIN_W, b.w), h: Math.max(420, b.h) }
    }
  } catch {}
  return DEFAULT_BOX
}

function formatMoney(n: number): string {
  return n < 0 ? `-$${Math.abs(n).toLocaleString()}` : `$${n.toLocaleString()}`
}

export function BuzzerConsole({
  gameId,
  roomCode,
  players,
  currentClue,
  phase,
  currentPlayerId,
  dailyDoubleWager,
}: {
  gameId: string
  roomCode: string
  players: Player[]
  currentClue: Clue | null
  phase: string
  /** Who holds the floor, per the game row. */
  currentPlayerId?: string | null
  /** The wager typed on the presenter's screen, for a Daily Double. */
  dailyDoubleWager?: number
}) {
  const [box, setBox] = useState<Box>(() => loadBox(roomCode))
  const [minimized, setMinimized] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [buzzOrder, setBuzzOrder] = useState<BuzzOrderRow[]>([])
  const [busy, setBusy] = useState(false)
  /** Score being typed over, by player id — see the score field below. */
  const [scoreDraft, setScoreDraft] = useState<Record<string, string>>({})
  const drag = useRef<{ mode: 'move' | 'resize'; dx: number; dy: number } | null>(null)

  const buzzersOpen = phase === 'buzz_window'
  const liveClue = !!currentClue && phase !== 'board_selection'
  const step = currentClue?.value || 100

  useEffect(() => {
    try { localStorage.setItem(`buzzerConsole:${roomCode}`, JSON.stringify(box)) } catch {}
  }, [box, roomCode])

  // Poll the queue while a clue is live — buzzes and typed answers both
  // arrive from other devices, so this is also how the host watches someone
  // write their answer out.
  useEffect(() => {
    if (!liveClue || !currentClue) { setBuzzOrder([]); return }
    let cancelled = false
    const load = () => {
      getBuzzOrder(gameId, currentClue.id)
        .then((rows) => { if (!cancelled) setBuzzOrder(rows) })
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 600)
    return () => { cancelled = true; clearInterval(t) }
  }, [gameId, currentClue?.id, liveClue])

  // Drag / resize. Pointer events so a trackpad and a touchscreen behave alike.
  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.mode === 'move') {
      setBox((b) => ({
        ...b,
        x: Math.max(0, Math.min(window.innerWidth - 80, e.clientX - d.dx)),
        y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - d.dy)),
      }))
    } else {
      setBox((b) => ({
        ...b,
        w: Math.max(MIN_W, e.clientX - b.x + d.dx),
        h: Math.max(MIN_H, e.clientY - b.y + d.dy),
      }))
    }
  }, [])

  const endDrag = useCallback(() => { drag.current = null }, [])

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
    }
  }, [onPointerMove, endDrag])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  function toggleBuzzers() {
    if (buzzersOpen) {
      run(async () => {
        await supabase.from('games')
          .update({ phase: 'clue_reading', buzz_window_open: false, updated_at: new Date().toISOString() })
          .eq('id', gameId)
      })
    } else {
      run(() => hostOpenBuzzers(gameId))
    }
  }

  const waiting = buzzOrder.filter((b) => b.is_correct === null)
  const tried = buzzOrder.filter((b) => b.is_correct !== null)
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'Player'
  /** Who is typing right now, if the host has given anyone the floor. */
  const onTheFloor = phase === 'player_answering' ? currentPlayerId ?? null : null
  const floorAnswer = onTheFloor
    ? buzzOrder.find((b) => b.player_id === onTheFloor)?.answer ?? ''
    : ''

  const judge = (playerId: string, correct: boolean) =>
    run(() => hostJudge(gameId, currentClue!.id, playerId, correct, dailyDoubleWager))

  const sorted = [...players].sort((a, b) => b.score - a.score)

  return (
    <div
      className="fixed z-40 flex flex-col overflow-hidden rounded-xl border border-white/25 bg-[#0B1140] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)]"
      style={{ left: box.x, top: box.y, width: box.w, height: minimized ? undefined : box.h }}
    >
      {/* Title bar — the drag handle */}
      <div
        onPointerDown={(e) => {
          drag.current = { mode: 'move', dx: e.clientX - box.x, dy: e.clientY - box.y }
        }}
        className="flex cursor-grab items-center gap-1.5 border-b border-white/15 bg-[#161C5C] px-3 py-2 active:cursor-grabbing"
      >
        <span className="flex-1 select-none truncate text-[11px] font-bold uppercase tracking-[0.18em] text-jeopardy-gold-light">
          Buzzer console
        </span>
        {buzzersOpen && (
          <span className="rounded bg-green-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
            Open
          </span>
        )}
        {/* The code has to be reachable mid-game, not just at setup: people
            turn up late, and phones lose the tab. */}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setShowQr((v) => !v)}
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums transition-colors ${
            showQr ? 'bg-jeopardy-gold text-black' : 'bg-white/10 text-gray-300 hover:bg-white/20'
          }`}
          title="Show the join code"
        >
          ⌗ {players.length}
        </button>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setMinimized((m) => !m)}
          className="rounded px-2 py-0.5 text-xs text-gray-300 hover:bg-white/10 hover:text-white"
          title={minimized ? 'Expand' : 'Minimize'}
        >
          {minimized ? '▢' : '—'}
        </button>
      </div>

      {!minimized && (
        <>
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {showQr && (
              <div className="mb-3 rounded-lg border border-white/15 bg-black/30 p-3">
                <p className="mb-2 text-center text-[10px] uppercase tracking-[0.2em] text-jeopardy-gold-light">
                  Scan to join · any time
                </p>
                <JoinQr roomCode={roomCode} size="md" />
              </div>
            )}

            {!liveClue ? (
              <p className="py-6 text-center text-xs italic text-gray-500">
                Pick a clue to start taking buzzes
              </p>
            ) : (
              <>
                {/* The clue's value, and deliberately NOT its answer.
                    The console floats over the board, and the board is the
                    thing on the projector — so anything printed here is
                    printed in front of the room. The host reads the correct
                    response off the clue screen with Reveal, where showing it
                    is the point. */}
                <p className="mb-3 truncate text-[10px] uppercase tracking-[0.2em] text-gray-400">
                  ${currentClue!.value} clue
                </p>

                <button
                  onClick={toggleBuzzers}
                  disabled={busy}
                  className={`w-full rounded-lg py-3 text-sm font-bold uppercase tracking-[0.14em] text-white transition-colors ${
                    buzzersOpen ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'
                  }`}
                >
                  {buzzersOpen ? '🔒 Lock buzzers' : '🔓 Unlock buzzers'}
                </button>

                {/* WHOEVER HAS THE FLOOR.
                    Their phone is unlocked and whatever they type lands here
                    as they type it. It's optional for them — most rooms just
                    say the answer out loud — so this says which it is rather
                    than leaving the host staring at an empty box. */}
                {onTheFloor && (
                  <div className="mt-3 rounded-lg border border-jeopardy-gold/60 bg-jeopardy-gold/10 p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm font-bold text-white">
                        {nameOf(onTheFloor)}
                      </span>
                      <span className="text-[9px] uppercase tracking-[0.18em] text-jeopardy-gold-light">
                        answering
                      </span>
                    </div>
                    <p className={`mt-1.5 min-h-[1.5rem] text-sm ${floorAnswer ? 'font-semibold text-white' : 'italic text-gray-400'}`}>
                      {floorAnswer || 'Listening — nothing typed'}
                    </p>
                    <div className="mt-2 flex gap-1.5">
                      <button
                        onClick={() => judge(onTheFloor, true)}
                        disabled={busy}
                        className="flex-1 rounded bg-green-600 py-1.5 text-xs font-bold text-white hover:bg-green-500"
                      >
                        ✓ Correct
                      </button>
                      <button
                        onClick={() => judge(onTheFloor, false)}
                        disabled={busy}
                        className="flex-1 rounded bg-red-600 py-1.5 text-xs font-bold text-white hover:bg-red-500"
                      >
                        ✗ Wrong
                      </button>
                      <button
                        onClick={() => run(() => hostTakeBackFloor(gameId))}
                        disabled={busy}
                        className="rounded bg-white/10 px-2 py-1.5 text-xs font-semibold text-gray-300 hover:bg-white/20"
                        title="Take the floor back without ruling"
                      >
                        ↩
                      </button>
                    </div>
                  </div>
                )}

                {/* THE QUEUE, fastest first. */}
                <div className="mt-3 space-y-1.5">
                  {waiting.length === 0 && tried.length === 0 && (
                    <p className="py-3 text-center text-xs italic text-gray-500">
                      {buzzersOpen ? 'Waiting for someone to ring in…' : 'Buzzers locked'}
                    </p>
                  )}
                  {waiting
                    .filter((b) => b.player_id !== onTheFloor)
                    .map((b, i) => (
                      <div
                        key={b.player_id}
                        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 ${
                          i === 0 && !onTheFloor ? 'bg-jeopardy-gold/20 ring-1 ring-jeopardy-gold' : 'bg-white/5'
                        }`}
                      >
                        <span className="w-4 text-center text-[11px] font-bold tabular-nums text-jeopardy-gold-light">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-white">
                            {nameOf(b.player_id)}
                          </span>
                          {b.reaction_ms !== null && (
                            <span className="block text-[10px] font-mono text-blue-200/60">
                              {(b.reaction_ms / 1000).toFixed(2)}s
                            </span>
                          )}
                        </span>
                        {/* Let them answer — unlocks their phone so they can
                            type. The host can skip it entirely and just rule
                            on what they hear. */}
                        <button
                          onClick={() => run(() => hostGrantFloor(gameId, currentClue!.id, b.player_id))}
                          disabled={busy}
                          className="rounded bg-jeopardy-gold px-2 py-1 text-xs font-bold text-black hover:bg-jeopardy-gold-light"
                          title="Give them the floor — their phone unlocks to type"
                        >
                          ▶
                        </button>
                        <button
                          onClick={() => judge(b.player_id, true)}
                          disabled={busy}
                          className="rounded bg-green-600 px-2 py-1 text-xs font-bold text-white hover:bg-green-500"
                          title="Correct — awards and ends the clue"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => judge(b.player_id, false)}
                          disabled={busy}
                          className="rounded bg-red-600 px-2 py-1 text-xs font-bold text-white hover:bg-red-500"
                          title="Wrong — deducts and passes on"
                        >
                          ✗
                        </button>
                      </div>
                    ))}
                  {/* Already ruled on, with what they said — the room's record
                      of what has been tried and missed. */}
                  {tried.map((b) => (
                    <div key={b.player_id} className="flex items-start gap-2 rounded px-2 py-1 text-xs">
                      <span>{b.is_correct ? '✅' : '❌'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-gray-500 line-through">{nameOf(b.player_id)}</span>
                        {b.answer && (
                          <span className="block truncate text-[11px] text-gray-500">“{b.answer}”</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => run(() => hostCloseClue(gameId, currentClue!.id))}
                  disabled={busy}
                  className="mt-2 w-full rounded-lg border border-white/15 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Nobody got it
                </button>
              </>
            )}

            {/* SCORES — every player, always, clue or no clue.
                Never a top-ten: the whole reason to open this panel is to fix
                somebody's score, and the person who needs fixing is usually
                last. */}
            <div className="mt-4 border-t border-white/10 pt-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400">
                  Scores · {players.length}
                </p>
                {liveClue && (
                  <p className="text-[10px] text-gray-500">± ${step.toLocaleString()} per tap</p>
                )}
              </div>
              <div className="space-y-1">
                {players.length === 0 && (
                  <p className="text-xs italic text-gray-500">
                    No contestants yet — tap ⌗ above for the join code
                  </p>
                )}
                {sorted.map((p) => (
                  <div key={p.id} className="flex items-center gap-1 text-sm">
                    <span className="min-w-0 flex-1 truncate text-white">{p.name}</span>
                    {/* Typing straight over the number is the only fix for a
                        score that drifted several clues ago. Commits on Enter
                        or on leaving the field; Escape abandons it. */}
                    <input
                      type="text"
                      inputMode="numeric"
                      value={scoreDraft[p.id] ?? formatMoney(p.score)}
                      onChange={(e) => setScoreDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                      onFocus={(e) => {
                        setScoreDraft((d) => ({ ...d, [p.id]: String(p.score) }))
                        requestAnimationFrame(() => e.target.select())
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape') {
                          setScoreDraft((d) => { const n = { ...d }; delete n[p.id]; return n })
                          ;(e.target as HTMLInputElement).blur()
                        }
                      }}
                      onBlur={() => {
                        const raw = scoreDraft[p.id]
                        setScoreDraft((d) => { const n = { ...d }; delete n[p.id]; return n })
                        if (raw === undefined) return
                        const parsed = parseInt(raw.replace(/[^0-9-]/g, ''), 10)
                        if (!isNaN(parsed) && parsed !== p.score) run(() => hostSetScore(p.id, parsed))
                      }}
                      className={`w-[72px] shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-right font-bold tabular-nums hover:border-white/20 focus:border-jeopardy-gold focus:bg-black/40 focus:outline-none ${
                        p.score < 0 ? 'text-red-400' : 'text-jeopardy-gold-light'
                      }`}
                      title="Type a score to set it outright"
                    />
                    <button
                      onClick={() => run(() => hostAdjustScore(p.id, step))}
                      disabled={busy}
                      className="shrink-0 rounded bg-white/10 px-2 text-sm font-bold text-green-400 hover:bg-white/20"
                      title={`Add $${step.toLocaleString()}`}
                    >
                      +
                    </button>
                    <button
                      onClick={() => run(() => hostAdjustScore(p.id, -step))}
                      disabled={busy}
                      className="shrink-0 rounded bg-white/10 px-2 text-sm font-bold text-red-400 hover:bg-white/20"
                      title={`Take off $${step.toLocaleString()}`}
                    >
                      −
                    </button>
                    {/* Award the live clue to someone who never buzzed — they
                        shouted it, or the host is running the buzzers for a
                        room that isn't using phones at all. */}
                    {liveClue && (
                      <button
                        onClick={() => judge(p.id, true)}
                        disabled={busy}
                        className="shrink-0 rounded bg-green-700/70 px-1.5 text-[11px] font-bold text-white hover:bg-green-600"
                        title="They got this clue — award it and close the clue"
                      >
                        ✓
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Resize grip */}
          <div
            onPointerDown={(e) => {
              e.stopPropagation()
              drag.current = { mode: 'resize', dx: box.x + box.w - e.clientX, dy: box.y + box.h - e.clientY }
            }}
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
            style={{
              background:
                'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.35) 60%, transparent 60%, transparent 75%, rgba(255,255,255,0.35) 75%)',
            }}
            title="Drag to resize"
          />
        </>
      )}
    </div>
  )
}
