'use client'

import { useParams } from 'next/navigation'
import { useGameChannel } from '@/hooks/useGameChannel'
import { GameBoard } from '@/components/GameBoard'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { Player } from '@/types/game'

/**
 * TV/DISPLAY VIEW
 *
 * This is the "Jackbox-style" display meant to be shown on a TV or large monitor.
 * It shows:
 * - The room code for players to join
 * - The game board
 * - Clue text (full screen)
 * - Scores
 * - Dramatic reveals
 *
 * NO interactive controls - all input comes from phones.
 */
export default function DisplayPage() {
  const params = useParams()
  const roomCode = params.roomCode as string
  const {
    game,
    players,
    categories,
    clues,
    connected,
  } = useGameChannel(roomCode)

  // Auto-transition: clue_reading → buzz_window after reading period
  const transitionRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'clue_reading') {
      if (transitionRef.current) {
        clearTimeout(transitionRef.current)
        transitionRef.current = null
      }
      return
    }

    const delay = game.settings?.reading_period_ms ?? 0
    transitionRef.current = setTimeout(async () => {
      await supabase
        .from('games')
        .update({
          phase: 'buzz_window',
          buzz_window_open: true,
          buzz_window_start: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', game.id)
    }, delay)

    return () => {
      if (transitionRef.current) clearTimeout(transitionRef.current)
    }
  }, [game?.phase, game?.id, game?.settings?.reading_period_ms])

  if (!game) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-jeopardy-dark">
        <div className="w-8 h-8 border-2 border-jeopardy-gold border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // LOBBY: Show room code prominently
  if (game.status === 'lobby' || game.phase === 'lobby') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark p-8">
        <h1 className="text-7xl md:text-9xl font-bold text-jeopardy-gold mb-4 tracking-tight">
          JEOPARDY!
        </h1>

        <p className="text-2xl text-blue-300 mb-12">Join on your phone</p>

        {/* Room code */}
        <div className="bg-white/5 rounded-3xl px-12 py-8 mb-8 border border-white/10">
          <p className="text-gray-400 text-lg mb-2 text-center">Room Code</p>
          <p className="text-8xl md:text-9xl font-mono font-bold tracking-[0.4em] text-white text-center">
            {game.room_code}
          </p>
        </div>

        {/* Players who have joined */}
        <div className="flex flex-wrap gap-4 justify-center max-w-4xl">
          {players.map((p) => (
            <div
              key={p.id}
              className={`px-6 py-3 rounded-2xl text-xl font-semibold transition-all ${
                p.is_ready
                  ? 'bg-green-600/20 border border-green-500 text-green-400'
                  : 'bg-white/5 border border-white/10 text-gray-300'
              }`}
            >
              {p.name}
              {p.is_ready && <span className="ml-2 text-green-500">&#10003;</span>}
            </div>
          ))}
          {players.length === 0 && (
            <p className="text-gray-500 text-xl">Waiting for players...</p>
          )}
        </div>

        <p className="mt-8 text-gray-500">
          {players.length}/8 players
          {players.length >= 1 && players.every((p) => p.is_ready) && (
            <span className="text-jeopardy-gold ml-4">Ready to start!</span>
          )}
        </p>
      </div>
    )
  }

  // ACTIVE GAME
  const currentClue = game.current_clue_id
    ? clues.find((c) => c.id === game.current_clue_id)
    : null

  const showClue =
    currentClue &&
    (game.phase === 'clue_reading' ||
      game.phase === 'buzz_window' ||
      game.phase === 'player_answering' ||
      game.phase === 'daily_double_wager' ||
      game.phase === 'daily_double_answering')

  const currentPlayer = players.find((p) => p.id === game.current_player_id)

  return (
    <div className="min-h-screen flex flex-col bg-jeopardy-dark">
      {/* Connection indicator */}
      <div className="fixed top-3 right-3 z-50">
        <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
      </div>

      {/* Scoreboard bar */}
      <div className="flex gap-3 px-4 py-3 bg-black/30 overflow-x-auto">
        {players
          .sort((a, b) => b.score - a.score)
          .map((p) => (
            <div
              key={p.id}
              className={`flex-shrink-0 px-5 py-2 rounded-xl text-center min-w-[120px] transition-all ${
                p.id === game.current_player_id
                  ? 'bg-jeopardy-blue border-2 border-jeopardy-gold scale-105'
                  : 'bg-white/5'
              }`}
            >
              <p className="text-sm text-gray-400 truncate">{p.name}</p>
              <p className={`text-2xl font-bold ${p.score < 0 ? 'text-red-400' : 'text-jeopardy-gold'}`}>
                ${p.score.toLocaleString()}
              </p>
            </div>
          ))}
      </div>

      {/* Round header */}
      <div className="text-center py-2">
        <span className="text-lg text-gray-300 font-semibold">
          {game.current_round === 1
            ? 'Jeopardy!'
            : game.current_round === 2
            ? 'Double Jeopardy!'
            : 'Final Jeopardy!'}
        </span>
        {currentPlayer && !showClue && (
          <span className="text-gray-500 ml-4">
            {currentPlayer.name}&apos;s pick
          </span>
        )}
      </div>

      {/* Board or Clue display */}
      {showClue && currentClue ? (
        <div className="flex-1 flex flex-col items-center justify-center px-12">
          {/* Clue value */}
          <p className="text-jeopardy-gold text-4xl font-bold mb-8">
            ${currentClue.value.toLocaleString()}
          </p>

          {/* Clue text */}
          <p className="text-4xl md:text-6xl text-white text-center leading-relaxed font-serif max-w-5xl">
            {currentClue.question}
          </p>

          {/* Phase indicator */}
          <div className="mt-12">
            {game.phase === 'clue_reading' && (
              <p className="text-gray-500 text-xl animate-pulse">Reading...</p>
            )}
            {game.phase === 'buzz_window' && (
              <p className="text-blue-400 text-2xl font-bold animate-buzz-pulse">
                BUZZ IN NOW!
              </p>
            )}
            {game.phase === 'player_answering' && (
              <p className="text-green-400 text-2xl font-bold">
                {players.find((p) => p.id === game.current_player_id)?.name} is answering...
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1">
          <GameBoard
            game={game}
            categories={categories}
            clues={clues}
            players={players}
            myPlayerId={null}
            isMyTurn={false}
          />
        </div>
      )}

      {/* Game over overlay */}
      {game.phase === 'game_over' && (
        <div className="fixed inset-0 bg-jeopardy-dark z-50 flex flex-col items-center justify-center">
          <h1 className="text-6xl font-bold text-jeopardy-gold mb-12">Final Scores</h1>
          <div className="w-full max-w-2xl space-y-4">
            {players
              .sort((a, b) => b.score - a.score)
              .map((p, i) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between px-8 py-6 rounded-2xl transition-all ${
                    i === 0
                      ? 'bg-jeopardy-gold/20 border-2 border-jeopardy-gold scale-105'
                      : 'bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <span className="text-4xl">
                      {i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
                    </span>
                    <span className="font-bold text-3xl">{p.name}</span>
                  </div>
                  <span className={`text-3xl font-bold ${p.score < 0 ? 'text-red-400' : 'text-jeopardy-gold'}`}>
                    ${p.score.toLocaleString()}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
