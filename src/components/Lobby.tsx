'use client'

import { useState } from 'react'
import { setReady, startGame } from '@/lib/game-api'
import type { Game, Player } from '@/types/game'

interface LobbyProps {
  game: Game
  players: Player[]
  myPlayer: Player | null
}

export function Lobby({ game, players, myPlayer }: LobbyProps) {
  const [starting, setStarting] = useState(false)

  const allReady = players.length >= 2 && players.every((p) => p.is_ready)
  const isCreator = myPlayer?.join_order === 1

  async function handleReady() {
    if (!myPlayer) return
    await setReady(myPlayer.id, !myPlayer.is_ready)
  }

  async function handleStart() {
    setStarting(true)
    try {
      await startGame(game.id)
    } catch (e) {
      console.error('Failed to start game:', e)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <h1 className="text-4xl font-bold text-jeopardy-gold mb-2">Game Lobby</h1>

      {/* Room Code */}
      <div className="bg-white/5 rounded-2xl px-8 py-4 mb-8 text-center">
        <p className="text-gray-400 text-sm mb-1">Room Code</p>
        <p className="text-5xl font-mono font-bold tracking-[0.3em] text-white">
          {game.room_code}
        </p>
        <p className="text-gray-500 text-xs mt-2">
          Share this code with other players
        </p>
      </div>

      {/* Settings */}
      <div className="bg-white/5 rounded-xl px-6 py-3 mb-6 flex gap-4 text-sm">
        <span className="text-gray-400">
          Mode:{' '}
          <span className="text-white font-semibold capitalize">
            {game.settings.mode}
          </span>
        </span>
        <span className="text-gray-400">
          Judge:{' '}
          <span className="text-white font-semibold uppercase">
            {game.settings.judgment}
          </span>
        </span>
      </div>

      {/* Player List */}
      <div className="w-full max-w-md mb-8">
        <h2 className="text-lg font-semibold text-gray-300 mb-3">
          Players ({players.length}/6)
        </h2>
        <div className="flex flex-col gap-2">
          {players.map((p) => (
            <div
              key={p.id}
              className={`flex items-center justify-between px-4 py-3 rounded-xl ${
                p.id === myPlayer?.id ? 'bg-jeopardy-blue/30 border border-jeopardy-blue/50' : 'bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-3 h-3 rounded-full ${
                    p.is_connected ? 'bg-green-500' : 'bg-gray-600'
                  }`}
                />
                <span className="font-semibold">
                  {p.name}
                  {p.id === myPlayer?.id && (
                    <span className="text-gray-500 text-sm ml-2">(you)</span>
                  )}
                  {p.join_order === 1 && (
                    <span className="text-jeopardy-gold text-xs ml-2">HOST</span>
                  )}
                </span>
              </div>
              <span
                className={`text-sm font-semibold ${
                  p.is_ready ? 'text-green-400' : 'text-gray-500'
                }`}
              >
                {p.is_ready ? 'Ready' : 'Not Ready'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 w-full max-w-md">
        <button
          onClick={handleReady}
          className={`py-4 rounded-xl font-bold text-xl transition-all ${
            myPlayer?.is_ready
              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              : 'bg-green-600 text-white hover:brightness-110'
          }`}
        >
          {myPlayer?.is_ready ? 'Cancel Ready' : 'Ready Up'}
        </button>

        {isCreator && (
          <button
            onClick={handleStart}
            disabled={!allReady || starting}
            className="bg-jeopardy-gold text-jeopardy-dark py-4 rounded-xl font-bold text-xl hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {starting
              ? 'Starting...'
              : !allReady
              ? `Waiting for players (${players.filter((p) => p.is_ready).length}/${players.length})`
              : 'Start Game'}
          </button>
        )}
      </div>

      {players.length < 2 && (
        <p className="mt-4 text-gray-500 text-sm">Need at least 2 players to start</p>
      )}
    </div>
  )
}
