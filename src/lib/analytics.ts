/**
 * Custom events, sent to whichever analytics are switched on.
 *
 * Vercel Web Analytics is always on (it's first-party and needs no key).
 * Google Analytics only joins in when NEXT_PUBLIC_GA_ID is set, so local dev
 * and previews stay out of that property.
 *
 * Nothing identifying is ever sent — room codes, player names and answers stay
 * out of event params on purpose. What goes out is shape-of-play only (which
 * mode, which board size), which is what "how are people using this" needs.
 */

import { track as vercelTrack } from '@vercel/analytics'

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || ''

declare global {
  interface Window {
    gtag?: (...args: any[]) => void
    dataLayer?: any[]
  }
}

/** Record a custom event. Safe to call anywhere, including during SSR. */
export function track(event: string, params: Record<string, string | number | boolean> = {}) {
  if (typeof window === 'undefined') return
  try {
    vercelTrack(event, params)
  } catch {
    // Analytics must never be able to break a game.
  }
  if (GA_ID && window.gtag) window.gtag('event', event, params)
}

/** Fire a page_view by hand — the App Router doesn't reload between routes. */
export function trackPageView(path: string) {
  if (!GA_ID || typeof window === 'undefined' || !window.gtag) return
  window.gtag('event', 'page_view', { page_path: path, page_location: window.location.href })
}

/**
 * A game was created. `source` is what the board came from, `mode` is how it
 * will be played — together these answer "what do people actually start?"
 */
export function trackGameStart(
  source: 'game' | 'mashup' | 'topics' | 'mix' | 'custom' | 'challenge',
  mode: 'party' | 'multiplayer' | 'hosted',
  size: string
) {
  track('game_start', { board_source: source, play_mode: mode, board_size: size })
}
