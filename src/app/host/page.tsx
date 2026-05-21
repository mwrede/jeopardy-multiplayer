'use client'

import { GameBrowser } from '@/components/GameBrowser'

/**
 * HOST / TV SCREEN — Game picker.
 * Renders the unified game browser; everything (search, filters, play) lives there.
 */
export default function HostPage() {
  return (
    <main className="min-h-screen flex flex-col items-center p-8 bg-jeopardy-dark">
      <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-32 md:h-44 w-auto mb-6 mt-4" />
      <div className="w-full max-w-5xl">
        <GameBrowser />
      </div>
    </main>
  )
}
