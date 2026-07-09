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
    <main className="stage-page p-4 md:p-8 pb-24">
      <div className="max-w-6xl mx-auto">
        <div className="frame">
          <span className="led-strip led-strip-left" />
          <span className="led-strip led-strip-right" />

          <div className="frame-inner p-6 md:p-10">
            {/* Masthead */}
            <div className="flex items-center justify-between gap-4 pb-6 mb-4 border-b border-white/10">
              <a href="/" className="text-ink-stage-2 uppercase text-[10px] tracking-[0.22em] font-bold hover:text-copper transition-colors">
                ← Home
              </a>
              <div className="text-copper uppercase text-xs tracking-[0.28em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                ▸ The Archive ◂
              </div>
              <div className="text-ink-stage-2 uppercase text-[10px] tracking-[0.22em] font-bold text-right hidden md:block">
                42 seasons indexed
              </div>
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
