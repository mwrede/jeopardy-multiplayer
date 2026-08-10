'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { hostOpenBuzzers, hostJudge, hostAdjustScore, getBuzzOrder, type BuzzOrderRow } from '@/lib/game-api'
import { supabase } from '@/lib/supabase'
import type { Clue, Player } from '@/types/game'

/**
 * BUZZER CONSOLE — a floating panel on the presenter's own screen.
 *
 * Everything a host does while a clue is live, in one window they can put
 * wherever it suits them: lock and unlock the buzzers, watch people ring in,
 * rule on answers, and nudge scores. Drag it by the title bar, resize from the
 * corner, collapse it to a strip when the board needs the room.
 *
 * Position and size persist per room, so it comes back where it was left.
 */

const MIN_W = 260
const MIN_H = 220

type Box = { x: number; y: number; w: number; h: number }

function loadBox(roomCode: string): Box {
  if (typeof window === 'undefined') return { x: 24, y: 90, w: 340, h: 420 }
  try {
    const raw = localStorage.getItem(`buzzerConsole:${roomCode}`)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { x: 24, y: 90, w: 340, h: 420 }
}

export function BuzzerConsole({
  gameId,
  roomCode,
  players,
  currentClue,
  phase,
}: {
  gameId: string
  roomCode: string
  players: Player[]
  currentClue: Clue | null
  phase: string
}) {
  const [box, setBox] = useState<Box>(() => loadBox(roomCode))
  const [minimized, setMinimized] = useState(false)
  const [buzzOrder, setBuzzOrder] = useState<BuzzOrderRow[]>([])
  const [busy, setBusy] = useState(false)
  const drag = useRef<{ mode: 'move' | 'resize'; dx: number; dy: number } | null>(null)

  const buzzersOpen = phase === 'buzz_window'
  const liveClue = !!currentClue && phase !== 'board_selection'

  useEffect(() => {
    try { localStorage.setItem(`buzzerConsole:${roomCode}`, JSON.stringify(box)) } catch {}
  }, [box, roomCode])

  // Poll the queue while a clue is live — buzzes arrive from other devices.
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
  const step = currentClue?.value || 100

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
        className="flex cursor-grab items-center gap-2 border-b border-white/15 bg-[#161C5C] px-3 py-2 active:cursor-grabbing"
      >
        <span className="flex-1 select-none truncate text-[11px] font-bold uppercase tracking-[0.18em] text-jeopardy-gold-light">
          Buzzer console
        </span>
        {buzzersOpen && (
          <span className="rounded bg-green-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
            Open
          </span>
        )}
        <button
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
            {!liveClue ? (
              <p className="py-6 text-center text-xs italic text-gray-500">
                Pick a clue to start taking buzzes
              </p>
            ) : (
              <>
                <p className="mb-2 truncate text-[10px] uppercase tracking-[0.2em] text-gray-400">
                  ${currentClue!.value} · answer
                </p>
                <p className="mb-3 text-sm font-bold text-jeopardy-gold-light">{currentClue!.answer}</p>

                <button
                  onClick={toggleBuzzers}
                  disabled={busy}
                  className={`w-full rounded-lg py-3 text-sm font-bold uppercase tracking-[0.14em] text-white transition-colors ${
                    buzzersOpen ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'
                  }`}
                >
                  {buzzersOpen ? '🔒 Lock buzzers' : '🔓 Unlock buzzers'}
                </button>

                <div className="mt-3 space-y-1.5">
                  {waiting.length === 0 && tried.length === 0 && (
                    <p className="py-3 text-center text-xs italic text-gray-500">
                      {buzzersOpen ? 'Waiting for someone to ring in…' : 'Buzzers locked'}
                    </p>
                  )}
                  {waiting.map((b, i) => (
                    <div
                      key={b.player_id}
                      className={`flex items-center gap-2 rounded-lg px-2 py-2 ${
                        i === 0 ? 'bg-jeopardy-gold/20 ring-1 ring-jeopardy-gold' : 'bg-white/5'
                      }`}
                    >
                      <span className="w-4 text-center text-[11px] font-bold tabular-nums text-jeopardy-gold-light">
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate text-sm font-semibold text-white">
                        {nameOf(b.player_id)}
                      </span>
                      <button
                        onClick={() => run(() => hostJudge(gameId, currentClue!.id, b.player_id, true))}
                        disabled={busy}
                        className="rounded bg-green-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-green-500"
                        title="Correct — awards and ends the clue"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => run(() => hostJudge(gameId, currentClue!.id, b.player_id, false))}
                        disabled={busy}
                        className="rounded bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-500"
                        title="Wrong — deducts and passes on"
                      >
                        ✗
                      </button>
                    </div>
                  ))}
                  {tried.map((b) => (
                    <div key={b.player_id} className="flex items-center gap-2 rounded px-2 py-1 text-xs">
                      <span>{b.is_correct ? '✅' : '❌'}</span>
                      <span className="flex-1 truncate text-gray-500 line-through">{nameOf(b.player_id)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Scores — always reachable, clue or no clue */}
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-gray-400">Scores</p>
              <div className="space-y-1">
                {players.length === 0 && <p className="text-xs italic text-gray-500">No contestants yet</p>}
                {[...players].sort((a, b) => b.score - a.score).map((p) => (
                  <div key={p.id} className="flex items-center gap-1.5 text-sm">
                    <span className="flex-1 truncate text-white">{p.name}</span>
                    <span className={`w-16 text-right font-bold tabular-nums ${p.score < 0 ? 'text-red-400' : 'text-jeopardy-gold-light'}`}>
                      {p.score < 0 ? `-$${Math.abs(p.score)}` : `$${p.score}`}
                    </span>
                    <button
                      onClick={() => run(() => hostAdjustScore(p.id, step))}
                      disabled={busy}
                      className="rounded bg-white/10 px-2 text-sm font-bold text-green-400 hover:bg-white/20"
                    >
                      +
                    </button>
                    <button
                      onClick={() => run(() => hostAdjustScore(p.id, -step))}
                      disabled={busy}
                      className="rounded bg-white/10 px-2 text-sm font-bold text-red-400 hover:bg-white/20"
                    >
                      −
                    </button>
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
