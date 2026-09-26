'use client'

import { useEffect, useRef } from 'react'
import { advanceToFinalClue, startFinalReveal } from '@/lib/game-api'
import type { Game, Player } from '@/types/game'

/**
 * How long Final Jeopardy waits on a player who isn't there any more.
 *
 * A closed tab keeps its player row — scores and answered clues have to
 * survive one — and that row never wagers and never answers. "Everyone is in"
 * was the only thing that moved either Final phase along, so it was never
 * true again: the round sat on "waiting for other players" with nothing left
 * to wait for, and the game simply ended there.
 *
 * So once everyone still in the room has locked in, the missing get ten
 * seconds and then the round goes on without them. Ten rather than none
 * because presence is a hint, not a verdict: a backgrounded phone can drop
 * its socket for a few seconds, and a submit can still be in flight.
 */
const ABSENT_GRACE_MS = 10000

/**
 * Beat past the clock the players can see, so the entries their own phones
 * auto-submit at zero land before the phase turns over.
 */
const WAGER_BUFFER_MS = 1500
const ANSWER_BUFFER_MS = 2500

/**
 * Moves Final Jeopardy along from both of its waiting phases: wagers → clue,
 * and answers → reveal.
 *
 * Every screen runs this and races to call the advance — whichever clock runs
 * out first wins — so there is no host to lose. startFinalReveal claims the
 * transition before it judges, which is what makes losing the race harmless.
 */
export function useFinalAutoAdvance(opts: {
  game: Game | null
  players: Player[]
  onlineIds: Set<string>
  /** This tab's own player, who is here by definition even before presence syncs. */
  myPlayerId?: string | null
}) {
  const { game, players, onlineIds, myPlayerId } = opts
  const phase = game?.phase
  const gameId = game?.id
  const isWager = phase === 'final_wager'
  const isAnswering = phase === 'final_answering'

  /**
   * When this tab first saw everyone who is still here locked in.
   *
   * It has to be an absolute instant rather than a fresh setTimeout: the 2s
   * poll hands back a new players array every time, which re-runs the effect
   * below, and a relative timer would restart on every poll and never fire.
   * There is no server timestamp to anchor on — player rows aren't stamped —
   * so each screen times its own ten seconds from when it noticed.
   */
  const allHereInAtRef = useRef<number | null>(null)
  useEffect(() => {
    allHereInAtRef.current = null
  }, [phase, gameId])

  useEffect(() => {
    if (!game || !gameId || (!isWager && !isAnswering)) return
    if (players.length === 0) return

    const lockedIn = (p: Player) => (isWager ? p.final_wager != null : p.final_answer != null)
    const advance = () => {
      if (isWager) advanceToFinalClue(gameId)
      else startFinalReveal(gameId).catch((e) => console.warn('[final] reveal failed:', e))
    }

    // Everyone in, including anyone who left: nothing to wait for.
    if (players.every(lockedIn)) {
      advance()
      return
    }

    // Waiting only on people who aren't here? Start their grace clock.
    const here = players.filter((p) => p.id === myPlayerId || onlineIds.has(p.id))
    const waitingOnAbsentOnly = here.length > 0 && here.every(lockedIn)
    if (!waitingOnAbsentOnly) allHereInAtRef.current = null
    else if (allHereInAtRef.current === null) allHereInAtRef.current = Date.now()

    // Outer backstop for the ordinary case — nobody is missing, someone is
    // just slow. Anchored on the phase change rather than on when this tab
    // noticed it, so every screen targets the same instant and a reload
    // doesn't buy anyone a fresh window.
    const startedAt = Date.parse(game.updated_at ?? '')
    const windowMs = isWager
      ? game.settings?.final_wager_ms ?? 30000
      : game.settings?.final_answer_ms ?? 30000
    const windowDeadline =
      (isNaN(startedAt) ? Date.now() : startedAt) +
      windowMs +
      (isWager ? WAGER_BUFFER_MS : ANSWER_BUFFER_MS)

    const absentDeadline =
      allHereInAtRef.current === null ? Infinity : allHereInAtRef.current + ABSENT_GRACE_MS

    const deadline = Math.min(windowDeadline, absentDeadline)
    const t = setTimeout(advance, Math.max(0, deadline - Date.now()))
    return () => clearTimeout(t)
  }, [game, gameId, isWager, isAnswering, players, onlineIds, myPlayerId])
}
