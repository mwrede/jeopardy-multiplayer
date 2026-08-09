'use client'

import { Suspense } from 'react'
import { GameBrowser } from '@/components/GameBrowser'
import { ProfileMenu } from '@/components/ProfileMenu'

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
            {/* Way back on the left, account on the right. The account control
                lives here rather than floating over the page — pinned, it used
                to cover the search button on a phone. */}
            <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/10 pb-5">
              <a href="/" className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink-stage-2 transition-colors hover:text-copper">
                ← Home
              </a>
              <ProfileMenu />
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
