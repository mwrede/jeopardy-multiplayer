'use client'

import { useEffect, useState } from 'react'
import { useGameChannel } from '@/hooks/useGameChannel'
import {
  hostOpenBuzzers,
  hostJudge,
  hostAdjustScore,
  hostCloseClue,
  getBuzzOrder,
  type BuzzOrderRow,
} from '@/lib/game-api'
import { supabase } from '@/lib/supabase'

/**
 * PRESENTER CONTROL — the second screen.
 *
 * The board goes on the TV; this goes in the host's hand. It shows the things
 * a host needs and the room must not see: the correct response, the buzzer
 * lock, the order people rang in, and the scores.
 *
 * Everything here reads from the game row rather than local state, so it stays
 * in step with the TV no matter which device drove the last action.
 */
export function PresenterControl({ roomCode }: { roomCode: string }) {
  const { game, players, categories, clues } = useGameChannel(roomCode)
  const [buzzOrder, setBuzzOrder] = useState<BuzzOrderRow[]>([])
  const [busy, setBusy] = useState(false)

  const contestants = players.filter((p) => p.name !== 'Presenter')
  const currentClue = game?.current_clue_id
    ? clues.find((c) => c.id === game.current_clue_id) ?? null
    : null
  const category = currentClue ? categories.find((c) => c.id === currentClue.category_id) : null
  const buzzersOpen = game?.phase === 'buzz_window'
  const liveClue = !!currentClue && game?.phase !== 'board_selection'

  // Poll the queue while a clue is live — buzzes land on other people's devices.
  useEffect(() => {
    if (!game?.id || !game.current_clue_id || !liveClue) { setBuzzOrder([]); return }
    let cancelled = false
    const load = () => {
      getBuzzOrder(game.id, game.current_clue_id!)
        .then((rows) => { if (!cancelled) setBuzzOrder(rows) })
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 600)
    return () => { cancelled = true; clearInterval(t) }
  }, [game?.id, game?.current_clue_id, liveClue])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  function lockBuzzers() {
    if (!game) return
    const gameId = game.id
    run(async () => {
      await supabase
        .from('games')
        .update({ phase: 'clue_reading', buzz_window_open: false, updated_at: new Date().toISOString() })
        .eq('id', gameId)
    })
  }

  if (!game) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0B1140]">
        <p className="text-gray-400">Connecting to room {roomCode}…</p>
      </div>
    )
  }

  const tried = buzzOrder.filter((b) => b.is_correct !== null)
  const waiting = buzzOrder.filter((b) => b.is_correct === null)
  const nameOf = (id: string) => contestants.find((p) => p.id === id)?.name ?? 'Player'

  return (
    <div className="min-h-screen bg-[#0B1140] pb-10 text-white">
      <div className="mx-auto max-w-2xl px-4 pt-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.28em] text-jeopardy-gold-light">
            Presenter control
          </p>
          <p className="font-mono text-xs tracking-[0.2em] text-gray-400">{roomCode}</p>
        </div>

        {!liveClue ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center">
            <p className="font-semibold text-white">Waiting on a clue</p>
            <p className="mt-1 text-sm text-gray-400">
              Pick one on the board screen — it&apos;ll appear here with its answer.
            </p>
          </div>
        ) : (
          <>
            {/* What the room can't see */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-[10px] uppercase tracking-[0.22em] text-gray-400">
                {category?.name} · ${currentClue!.value}
              </p>
              <p className="clue-type mt-2 text-base text-white">{currentClue!.question}</p>
              <p className="mt-3 border-t border-white/10 pt-3 text-lg font-bold text-jeopardy-gold-light">
                {currentClue!.answer}
              </p>
            </div>

            {/* The lock */}
            <button
              onClick={() => (buzzersOpen ? lockBuzzers() : run(() => hostOpenBuzzers(game.id)))}
              disabled={busy}
              className={`mt-3 w-full rounded-xl py-5 text-lg font-bold uppercase tracking-[0.18em] transition-colors ${
                buzzersOpen
                  ? 'bg-red-600 text-white hover:bg-red-500'
                  : 'bg-green-600 text-white hover:bg-green-500'
              }`}
            >
              {buzzersOpen ? '🔒 Lock buzzers' : '🔓 Unlock buzzers'}
            </button>
            <p className="mt-1.5 text-center text-xs text-gray-500">
              {buzzersOpen
                ? 'Open — players can ring in, and their phones show the clue'
                : 'Locked — read the clue, then unlock'}
            </p>

            {/* Who rang in, in order */}
            <div className="mt-5">
              <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-gray-400">
                Buzz order {waiting.length > 0 && `· ${waiting[0] ? nameOf(waiting[0].player_id) + ' is up' : ''}`}
              </p>

              {waiting.length === 0 && tried.length === 0 && (
                <p className="rounded-lg bg-white/5 px-4 py-6 text-center text-sm italic text-gray-500">
                  Nobody has buzzed yet
                </p>
              )}

              <div className="space-y-2">
                {waiting.map((b, i) => (
                  <div
                    key={b.player_id}
                    className={`flex items-center gap-3 rounded-lg px-3 py-3 ${
                      i === 0 ? 'bg-jeopardy-gold/20 ring-2 ring-jeopardy-gold' : 'bg-white/5'
                    }`}
                  >
                    <span className="w-6 text-center text-sm font-bold tabular-nums text-jeopardy-gold-light">
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate font-semibold">{nameOf(b.player_id)}</span>
                    {i === 0 && <span className="text-[10px] uppercase tracking-wider text-jeopardy-gold-light">Answering</span>}
                    <button
                      onClick={() => run(() => hostJudge(game.id, currentClue!.id, b.player_id, true))}
                      disabled={busy}
                      className="rounded-lg bg-green-600 px-4 py-2 font-bold text-white hover:bg-green-500"
                      title="Correct — awards and ends the clue"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => run(() => hostJudge(game.id, currentClue!.id, b.player_id, false))}
                      disabled={busy}
                      className="rounded-lg bg-red-600 px-4 py-2 font-bold text-white hover:bg-red-500"
                      title="Wrong — deducts and passes to the next buzzer"
                    >
                      ✗
                    </button>
                  </div>
                ))}

                {tried.map((b) => (
                  <div key={b.player_id} className="flex items-center gap-3 rounded-lg bg-black/30 px-3 py-2 text-sm">
                    <span className="w-6 text-center">{b.is_correct ? '✅' : '❌'}</span>
                    <span className="flex-1 truncate text-gray-400 line-through">{nameOf(b.player_id)}</span>
                    {b.answer ? <span className="truncate italic text-gray-500">&ldquo;{b.answer}&rdquo;</span> : null}
                  </div>
                ))}
              </div>

              <button
                onClick={() => run(() => hostCloseClue(game.id, currentClue!.id))}
                disabled={busy}
                className="mt-3 w-full rounded-lg border border-white/15 bg-white/5 py-3 text-sm font-semibold text-gray-300 hover:bg-white/10"
              >
                Nobody got it — close the clue
              </button>
            </div>
          </>
        )}

        {/* Scores */}
        <div className="mt-6">
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-gray-400">Scores</p>
          <div className="space-y-1.5">
            {contestants.length === 0 && (
              <p className="text-sm italic text-gray-500">No contestants yet</p>
            )}
            {[...contestants].sort((a, b) => b.score - a.score).map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2">
                <span className="flex-1 truncate font-semibold">{p.name}</span>
                <span className={`w-24 text-right font-bold tabular-nums ${p.score < 0 ? 'text-red-400' : 'text-jeopardy-gold-light'}`}>
                  {p.score < 0 ? `-$${Math.abs(p.score).toLocaleString()}` : `$${p.score.toLocaleString()}`}
                </span>
                <button
                  onClick={() => run(() => hostAdjustScore(p.id, currentClue?.value || 100))}
                  disabled={busy}
                  className="rounded bg-white/10 px-3 py-1.5 font-bold text-green-400 hover:bg-white/20"
                >
                  +
                </button>
                <button
                  onClick={() => run(() => hostAdjustScore(p.id, -(currentClue?.value || 100)))}
                  disabled={busy}
                  className="rounded bg-white/10 px-3 py-1.5 font-bold text-red-400 hover:bg-white/20"
                >
                  −
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
