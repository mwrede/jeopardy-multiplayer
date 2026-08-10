'use client'

import { useState } from 'react'
import type { GameLength } from '@/types/game'

export type PlayMode = 'party' | 'multiplayer' | 'hosted'

const SIZES: Array<{ id: GameLength; label: string; desc: string }> = [
  { id: 'full', label: 'Full', desc: '6×5' },
  { id: 'half', label: 'Half', desc: '6×3' },
  { id: 'rapid', label: 'Rapid', desc: '3×3' },
]

/**
 * Pick how to play, in as few decisions as possible.
 *
 * Party and multiplayer are the same game — the only real difference is
 * whether there's a screen everyone looks at. So they're one choice here, and
 * the TV question only comes up after you've picked a size. Hosted is a
 * genuinely different shape (a person runs the board and judges), so it stays
 * its own row and launches in one click.
 *
 * Lives in one component because this grid appears in two modals, and the
 * last time it was duplicated a new option only made it into one of them.
 */
export function PlayModePicker({
  onPick,
  onBack,
  creating,
}: {
  onPick: (mode: PlayMode, size: GameLength) => void
  onBack: () => void
  creating?: boolean
}) {
  const [pendingSize, setPendingSize] = useState<GameLength | null>(null)

  if (pendingSize) {
    return (
      <div className="flex flex-col items-center gap-4 border-t border-white/10 pt-5">
        <p
          className="text-copper uppercase text-sm tracking-[0.28em]"
          style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '0 0 8px rgba(255,155,68,0.4)' }}
        >
          ▸ How are you playing? ◂
        </p>
        <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            onClick={() => onPick('party', pendingSize)}
            disabled={creating}
            className="btn-stage btn-copper !h-auto flex-col py-4"
          >
            <span className="text-lg">📺</span>
            <span>With a TV</span>
            <span className="text-[10px] font-normal opacity-75">Board on one screen, phones buzz</span>
          </button>
          <button
            onClick={() => onPick('multiplayer', pendingSize)}
            disabled={creating}
            className="btn-stage btn-chrome !h-auto flex-col py-4"
          >
            <span className="text-lg">📱</span>
            <span>Just phones</span>
            <span className="text-[10px] font-normal opacity-75">Everyone gets their own board</span>
          </button>
        </div>
        <button onClick={() => setPendingSize(null)} className="mt-1 text-xs text-ink-stage-2 hover:text-copper">
          Back
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 border-t border-white/10 pt-5">
      <p
        className="text-copper uppercase text-sm tracking-[0.28em]"
        style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '0 0 8px rgba(255,155,68,0.4)' }}
      >
        ▸ Pick a mode and board size ◂
      </p>
      <div className="w-full max-w-md space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-28 shrink-0 text-left text-sm font-bold text-white sm:w-32">
            🎮 Multiplayer
            <span className="block text-[10px] font-normal opacity-60">Play together</span>
          </div>
          <div className="grid flex-1 grid-cols-3 gap-1.5">
            {SIZES.map((s) => (
              <button
                key={s.id}
                onClick={() => setPendingSize(s.id)}
                disabled={creating}
                className="btn-stage btn-copper btn-stage-sm !h-[52px] px-1"
              >
                <span>
                  {s.label}
                  <span className="block text-[10px] font-normal opacity-80">{s.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-28 shrink-0 text-left text-sm font-bold text-white sm:w-32">
            🎤 Hosted
            <span className="block text-[10px] font-normal opacity-60">You run it</span>
          </div>
          <div className="grid flex-1 grid-cols-3 gap-1.5">
            {SIZES.map((s) => (
              <button
                key={s.id}
                onClick={() => onPick('hosted', s.id)}
                disabled={creating}
                className="btn-stage btn-stage-ghost btn-stage-sm !h-[52px] px-1"
              >
                <span>
                  {s.label}
                  <span className="block text-[10px] font-normal opacity-80">{s.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <button onClick={onBack} className="mt-1 text-xs text-ink-stage-2 hover:text-copper">
        Back
      </button>
    </div>
  )
}
