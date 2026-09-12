'use client'

import { useState } from 'react'
import { setBuzzerMode } from '@/lib/game-api'
import type { Game } from '@/types/game'

/**
 * UNLIMITED BUZZER switch.
 *
 * Off is the show's rule: fastest buzz wins the clue, everyone else is shut
 * out. On, the buzzer stops being a race — everyone who rings in answers, on
 * their own, and every correct answer scores full value, so one clue can pay
 * the whole room. You still buzz and your time is still recorded; it just
 * doesn't decide whether you get to play.
 *
 * Flippable between clues as well as in the lobby, because which way a room
 * wants it is usually only obvious once they've tried the other one.
 *
 * `canEdit` should be false mid-clue — changing the rules with a buzz window
 * open would move the goalposts on whoever is already holding the buzzer.
 */
export function BuzzModeToggle({
  game,
  canEdit,
  variant = 'full',
}: {
  game: Game
  canEdit: boolean
  /** `full` for lobbies, `chip` for the one-line version in a game header. */
  variant?: 'full' | 'chip'
}) {
  const unlimited = !!(game.settings as any)?.unlimitedBuzzer
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function flip(next: boolean) {
    if (busy || next === unlimited) return
    setBusy(true)
    setError('')
    try {
      await setBuzzerMode(game.id, next)
    } catch (e: any) {
      setError(e?.message || 'Could not change the buzzer mode')
    } finally {
      setBusy(false)
    }
  }

  if (variant === 'chip') {
    const label = unlimited ? 'Everyone answers' : 'Fastest buzz'
    if (!canEdit) {
      return (
        <span
          className="text-[10px] uppercase tracking-[0.18em] text-gray-500"
          title={
            unlimited
              ? 'Unlimited buzzer: everyone who buzzes answers and can score'
              : 'Fastest buzz wins the clue'
          }
        >
          {label}
        </span>
      )
    }
    return (
      <button
        onClick={() => flip(!unlimited)}
        disabled={busy}
        title={
          unlimited
            ? 'Unlimited buzzer is ON — everyone who buzzes answers and can score. Tap to go back to fastest-buzz-wins.'
            : 'Fastest buzz wins. Tap to turn on unlimited buzzer — everyone who buzzes answers and can score.'
        }
        className={`text-[10px] uppercase tracking-[0.18em] transition-colors disabled:opacity-40 ${
          unlimited ? 'text-jeopardy-gold hover:text-jeopardy-gold-light' : 'text-gray-500 hover:text-white'
        }`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400">Buzzer</p>
        {unlimited && (
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-jeopardy-gold">
            Unlimited
          </span>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => flip(false)}
          disabled={!canEdit || busy}
          className={`rounded-xl px-3 py-2.5 text-left transition-all ${
            !unlimited
              ? 'bg-jeopardy-blue/40 border border-jeopardy-gold/60'
              : 'bg-black/20 border border-white/10'
          } ${canEdit ? 'hover:border-white/30' : 'cursor-default opacity-90'}`}
        >
          <span className="block text-sm font-bold text-white">Fastest buzz</span>
          <span className="mt-0.5 block text-[10px] leading-snug text-gray-400">
            First thumb gets the clue
          </span>
        </button>

        <button
          onClick={() => flip(true)}
          disabled={!canEdit || busy}
          className={`rounded-xl px-3 py-2.5 text-left transition-all ${
            unlimited
              ? 'bg-jeopardy-blue/40 border border-jeopardy-gold/60'
              : 'bg-black/20 border border-white/10'
          } ${canEdit ? 'hover:border-white/30' : 'cursor-default opacity-90'}`}
        >
          <span className="block text-sm font-bold text-white">Everyone answers</span>
          <span className="mt-0.5 block text-[10px] leading-snug text-gray-400">
            No race — everyone who buzzes can score
          </span>
        </button>
      </div>

      {!canEdit && (
        <p className="mt-2 text-[10px] text-gray-500">The host sets this.</p>
      )}
      {error && <p className="mt-2 text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
