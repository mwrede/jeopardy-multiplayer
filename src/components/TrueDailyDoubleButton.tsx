'use client'

/**
 * TRUE DAILY DOUBLE — one tap to put your whole score on the clue.
 *
 * The showy wager, and the one that's most annoying to type: it's your exact
 * total, which changes every clue. So the button fills the wager in rather than
 * placing it — the second tap on Lock In is the one that commits you, which is
 * the right amount of ceremony for betting everything.
 *
 * Hidden for anyone at zero or in the red. "All of it" means nothing there —
 * a negative total can't be wagered, and offering an all-in to the player
 * having the worst game is a joke at their expense.
 */
export function TrueDailyDoubleButton({
  score,
  onPick,
  disabled,
}: {
  score: number
  /** Called with the full score, to fill the wager field. */
  onPick: (amount: number) => void
  disabled?: boolean
}) {
  if (score <= 0) return null

  return (
    <button
      onClick={() => onPick(score)}
      disabled={disabled}
      className="w-full rounded-xl border border-jeopardy-gold/60 bg-jeopardy-gold/15 px-4 py-3
                 text-center transition-all hover:bg-jeopardy-gold/25 active:scale-[0.98]
                 disabled:opacity-40"
    >
      <span className="block text-sm font-bold uppercase tracking-[0.18em] text-jeopardy-gold">
        True Daily Double
      </span>
      <span className="mt-0.5 block text-xs text-gray-300">
        Wager everything — ${score.toLocaleString()}
      </span>
    </button>
  )
}
