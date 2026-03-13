'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createGame } from '@/lib/game-api'
import { supabase } from '@/lib/supabase'
import { DEFAULT_CASUAL_SETTINGS, DEFAULT_STRICT_SETTINGS } from '@/types/game'

interface GameOption {
  label: string
  description: string
  categoryCount: number
  clueCount: number
  round: string
}

/**
 * HOST / TV SCREEN - Game Selection
 *
 * The person at the TV picks what game to play:
 * - Random (pulls random categories from the pool)
 * - Could add custom game packs later
 *
 * After selecting, a room is created and the display shows the room code.
 */
export default function HostPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'casual' | 'strict'>('casual')
  const [creating, setCreating] = useState(false)
  const [stats, setStats] = useState({ categories: 0, clues: 0 })

  // Load clue pool stats
  useEffect(() => {
    async function loadStats() {
      const { count: clueCount } = await supabase
        .from('clue_pool')
        .select('*', { count: 'exact', head: true })

      const { data: cats } = await supabase
        .from('clue_pool')
        .select('category')

      const uniqueCats = new Set(cats?.map((c) => c.category) || [])

      setStats({
        categories: uniqueCats.size,
        clues: clueCount || 0,
      })
    }
    loadStats()
  }, [])

  async function handleCreateGame() {
    setCreating(true)
    try {
      const settings = mode === 'casual' ? DEFAULT_CASUAL_SETTINGS : DEFAULT_STRICT_SETTINGS
      const { game } = await createGame(settings)
      // Redirect to the display view
      router.push(`/game/${game.room_code}/display`)
    } catch (e) {
      console.error('Failed to create game:', e)
    } finally {
      setCreating(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-jeopardy-dark">
      <h1 className="text-7xl md:text-9xl font-bold text-jeopardy-gold mb-4 tracking-tight">
        JEOPARDY!
      </h1>
      <p className="text-blue-300 text-2xl mb-16">Select a game to play</p>

      {/* Game options */}
      <div className="grid gap-6 w-full max-w-4xl md:grid-cols-2 mb-12">
        {/* Random Game */}
        <button
          onClick={handleCreateGame}
          disabled={creating}
          className="group bg-jeopardy-blue/30 hover:bg-jeopardy-blue/50 border-2 border-jeopardy-blue rounded-3xl p-8 text-left transition-all hover:scale-[1.02] disabled:opacity-50"
        >
          <h2 className="text-3xl font-bold text-white mb-2">Random Game</h2>
          <p className="text-gray-400 text-lg mb-4">
            6 random categories, fresh every time
          </p>
          <div className="flex gap-4 text-sm text-gray-500">
            <span>{stats.categories} categories available</span>
            <span>{stats.clues.toLocaleString()} clues</span>
          </div>
        </button>

        {/* Coming soon: Custom games */}
        <div className="bg-white/5 border-2 border-white/10 rounded-3xl p-8 text-left opacity-50">
          <h2 className="text-3xl font-bold text-gray-500 mb-2">Custom Game</h2>
          <p className="text-gray-600 text-lg mb-4">
            Build your own categories and clues
          </p>
          <span className="text-sm text-gray-600">Coming soon</span>
        </div>
      </div>

      {/* Mode selector */}
      <div className="flex gap-4 mb-8">
        <button
          onClick={() => setMode('casual')}
          className={`px-8 py-3 rounded-2xl text-lg font-semibold transition-all ${
            mode === 'casual'
              ? 'bg-jeopardy-blue text-white'
              : 'bg-white/5 text-gray-400 hover:bg-white/10'
          }`}
        >
          Casual
        </button>
        <button
          onClick={() => setMode('strict')}
          className={`px-8 py-3 rounded-2xl text-lg font-semibold transition-all ${
            mode === 'strict'
              ? 'bg-jeopardy-blue text-white'
              : 'bg-white/5 text-gray-400 hover:bg-white/10'
          }`}
        >
          Strict
        </button>
      </div>
      <p className="text-gray-500 text-center">
        {mode === 'casual'
          ? 'No reading delay, longer timers, relaxed rules'
          : 'Reading delay, shorter timers, early-buzz lockout'}
      </p>
    </main>
  )
}
