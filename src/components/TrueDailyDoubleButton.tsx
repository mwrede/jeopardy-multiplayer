'use client'

import { maxDailyDoubleWager } from '@/lib/wager'

/**
 * TRUE DAILY DOUBLE — one tap to put the most you are allowed to bet on the
 * clue.
 *
 * The showy wager, and the one that's most annoying to type: it's your exact
 * total, which changes every clue. So the button fills the wager in rather
 * than placing it — the second tap on Lock In is the one that commits you,
 * which is the right amount of ceremony for betting everything.
 *
 * It used to hide itself for anyone at zero or in the red, on the grounds that
 * "all of it" means nothing there. But the rules already answer that: your cap
 * is the greater of your score and the board's top value, so a player on $0
 * can still bet the full $1,000. Hiding the button just denied the person
 * having the worst game the one move that could rescue it. Now everybody gets
 * it, and it says plainly which of the two caps it is filling in.
 */
export function TrueDailyDoubleButton({
  score,
  topValue,
  onPick,
  disabled,
}: {
  score: number
  /** Top clue value on the board this round — the other half of the cap. */
  topValue: number
  /** Called with the amount, to fill the wager field. */
  onPick: (amount: number) => void
  disabled?: boolean
}) {
  const max = maxDailyDoubleWager(score, topValue)
  const allIn = score >= topValue

  return (
    <button
      onClick={() => onPick(max)}
      disabled={disabled}
      className="w-full rounded-xl border border-jeopardy-gold/60 bg-jeopardy-gold/15 px-4 py-3
                 text-center transition-all hover:bg-jeopardy-gold/25 active:scale-[0.98]
                 disabled:opacity-40"
    >
      <span className="block text-sm font-bold uppercase tracking-[0.18em] text-jeopardy-gold">
        {allIn ? 'True Daily Double' : 'Bet the Max'}
      </span>
      <span className="mt-0.5 block text-xs text-gray-300">
        {allIn ? 'Wager everything' : 'The most you can bet'} — ${max.toLocaleString()}
      </span>
    </button>
  )
}
