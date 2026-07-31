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
    <main className="stage-page-deep px-4 pb-24 md:px-8">
      <div className="mx-auto max-w-6xl px-1 pt-8 md:pt-12">
        {/* Masthead */}
        <div className="mb-6 flex items-center justify-between gap-4 border-b border-white/10 pb-5">
          <a href="/" className="text-[10px] font-bold uppercase tracking-[0.22em] text-ink-stage-2 transition-colors hover:text-copper">
            ← Home
          </a>
          <div className="text-copper uppercase tracking-[0.24em] text-[11px] md:text-xs" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
            Search 9,300 Jeopardy Games
          </div>
          <span aria-hidden="true" className="w-[52px]" />
        </div>

        <Suspense fallback={<div className="py-16 text-center text-ink-stage-2">Loading…</div>}>
          <GameBrowser />
        </Suspense>
      </div>
    </main>
  )
}
