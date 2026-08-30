'use client'

import { useState } from 'react'
import { type ChallengeGame } from '@/lib/challenge-data'
import { formatMoney, type ClueResult } from '@/lib/challenge'

/**
 * The share button for a challenge board — one per game, everywhere a game
 * is shown. Clicking copies a paste-ready result to the clipboard: what you
 * made, how many you got right, and a link straight to the same board, so
 * the person you paste it to plays the exact game you played. Before you've
 * played, it copies an invite instead of a score.
 *
 * Copy, not the native share sheet, on purpose: the text is built to be
 * PASTED — into the group chat, Slack, wherever — and a "Copied!" flash is
 * the whole UX.
 */
export function ChallengeShare({
  game,
  result,
  small,
}: {
  game: ChallengeGame
  result?: { score: number; clueResults: ClueResult[] }
  small?: boolean
}) {
  const [copied, setCopied] = useState(false)

  async function share() {
    const url = `${window.location.origin}/challenge/${game.key}`
    // "Game 3" means nothing outside its section — carry the series name.
    const label =
      game.series === 'michaels'
        ? `Michael's Jeopardy Challenge · ${game.title}`
        : game.series === 'politics'
          ? `The Politics Challenge · ${game.title}`
          : game.title

    let text: string
    if (result) {
      // The line reads round by round: money, then rights per round.
      const right = (rd: number) =>
        result.clueResults.filter((x) => (x.rd ?? 1) === rd && x.outcome === 'correct').length
      const fj = result.clueResults.find((x) => x.rd === 3)
      const rounds = [
        `Jeopardy ${right(1)}/9`,
        `Double Jeopardy ${right(2)}/9`,
        ...(fj ? [`Final ${fj.outcome === 'correct' ? '✓' : '✗'}`] : []),
      ].join(' · ')
      text = [
        `🏆 Jeopardy Challenge — ${label}`,
        `💰 ${formatMoney(result.score)}`,
        rounds,
        `One shot, real clues — beat me: ${url}`,
      ].join('\n')
    } else {
      text = [
        `🏆 Jeopardy Challenge — ${label}`,
        `One-shot board, real Jeopardy clues. Play it: ${url}`,
      ].join('\n')
    }

    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard unavailable (old browser, odd context) — hand it over.
      window.prompt('Copy your result:', text)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={share}
      className={small ? 'btn-stage btn-stage-sm btn-stage-ghost' : 'btn-stage btn-chrome'}
      title="Copy your result and a link to this board"
    >
      {copied ? 'Copied!' : 'Share'}
    </button>
  )
}
