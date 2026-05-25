'use client'

import { GameBrowser } from '@/components/GameBrowser'

/**
 * FIND A GAME — full-screen game picker.
 * Search/filter across real J-Archive games, themed mashups, and custom
 * boards. Selecting a result lets you Edit (your own boards only),
 * Play Party Mode (TV + phones), or Play Multiplayer (one screen each).
 */
export default function FindPage() {
  return (
    <main className="min-h-screen flex flex-col items-center p-6 md:p-8 bg-jeopardy-dark">
      <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-24 md:h-36 w-auto mb-4 mt-2" />
      <h1 className="text-2xl md:text-3xl font-bold text-white mb-6">Find a Game</h1>
      <div className="w-full max-w-5xl">
        <GameBrowser />
      </div>
      <a href="/" className="text-gray-500 hover:text-white text-sm mt-10 transition-colors">
        ← Back to home
      </a>
    </main>
  )
}
