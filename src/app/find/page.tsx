'use client'

import { Suspense } from 'react'
import { GameBrowser } from '@/components/GameBrowser'

/**
 * FIND A GAME — the archive.
 * Deep stage backdrop with a walnut picture frame around the browser.
 * Wrapped in Suspense because GameBrowser uses useSearchParams (for the
 * shareable `?board=<id>` and `?game=<id>` deep links).
 */
export default function FindPage() {
  return (
    <main className="stage-page-deep p-4 pb-24 md:p-8">
      <div className="mx-auto max-w-6xl">
        {/* Walnut frame stays — it was the bright gradient behind it that
            clashed, not the wood. Sits on the deep ground now. */}
        <div className="frame">
          <span className="led-strip led-strip-left" />
          <span className="led-strip led-strip-right" />

          <div className="frame-inner p-6 md:p-10">
            {/* Just the way back — the search heading below names the page. */}
            <div className="mb-5 border-b border-white/10 pb-5">
              <a href="/" className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink-stage-2 transition-colors hover:text-copper">
                ← Home
              </a>
            </div>

            <Suspense fallback={<div className="py-16 text-center text-ink-stage-2">Loading…</div>}>
              <GameBrowser />
            </Suspense>
          </div>
        </div>
      </div>
    </main>
  )
}
