'use client'

import { useParams } from 'next/navigation'
import { useGameChannel } from '@/hooks/useGameChannel'
import { GameBoard } from '@/components/GameBoard'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  advanceFromRoundEnd,
  advanceFromClueResult,
  advanceToFinalWager,
  advanceToFinalClue,
  advanceToFinalAnswering,
  startFinalReveal,
  advanceToGameOver,
  skipClue,
  passAfterBuzz,
} from '@/lib/game-api'
import type { Player } from '@/types/game'

/**
 * TV/DISPLAY VIEW
 *
 * This is the "Jackbox-style" display meant to be shown on a TV or large monitor.
 * It shows:
 * - The room code for players to join
 * - The game board (6 categories per round)
 * - Clue text (full screen)
 * - Round transitions (Jeopardy! → Double Jeopardy! → Final Jeopardy!)
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

  // Buzz window countdown timer + auto-skip on timeout
  const [buzzCountdown, setBuzzCountdown] = useState<number | null>(null)
  const buzzTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const buzzIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'buzz_window') {
      setBuzzCountdown(null)
      if (buzzTimeoutRef.current) clearTimeout(buzzTimeoutRef.current)
      if (buzzIntervalRef.current) clearInterval(buzzIntervalRef.current)
      buzzTimeoutRef.current = null
      buzzIntervalRef.current = null
      return
    }

    const totalMs = game.settings?.buzz_window_ms ?? 15000
    const totalSec = Math.ceil(totalMs / 1000)
    setBuzzCountdown(totalSec)

    // Tick down every second
    buzzIntervalRef.current = setInterval(() => {
      setBuzzCountdown((prev) => (prev !== null && prev > 0 ? prev - 1 : 0))
    }, 1000)

    // Auto-skip when time runs out
    buzzTimeoutRef.current = setTimeout(async () => {
      if (game.current_clue_id) {
        await skipClue(game.id, game.current_clue_id)
      }
    }, totalMs)

    return () => {
      if (buzzTimeoutRef.current) clearTimeout(buzzTimeoutRef.current)
      if (buzzIntervalRef.current) clearInterval(buzzIntervalRef.current)
    }
  }, [game?.phase, game?.id])

  // Answer countdown timer + auto-skip on timeout
  const [answerCountdown, setAnswerCountdown] = useState<number | null>(null)
  const answerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const answerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'player_answering') {
      setAnswerCountdown(null)
      if (answerTimeoutRef.current) clearTimeout(answerTimeoutRef.current)
      if (answerIntervalRef.current) clearInterval(answerIntervalRef.current)
      answerTimeoutRef.current = null
      answerIntervalRef.current = null
      return
    }

    const totalMs = game.settings?.answer_time_ms ?? 15000
    const totalSec = Math.ceil(totalMs / 1000)
    setAnswerCountdown(totalSec)

    answerIntervalRef.current = setInterval(() => {
      setAnswerCountdown((prev) => (prev !== null && prev > 0 ? prev - 1 : 0))
    }, 1000)

    // Auto-pass when time runs out
    answerTimeoutRef.current = setTimeout(async () => {
      if (game.current_clue_id && game.current_player_id) {
        await passAfterBuzz(game.id, game.current_clue_id, game.current_player_id)
      }
    }, totalMs)

    return () => {
      if (answerTimeoutRef.current) clearTimeout(answerTimeoutRef.current)
      if (answerIntervalRef.current) clearInterval(answerIntervalRef.current)
    }
  }, [game?.phase, game?.id])

  // Auto-transition: round_end → board_selection after 4 seconds
  const roundEndRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'round_end') {
      if (roundEndRef.current) {
        clearTimeout(roundEndRef.current)
        roundEndRef.current = null
      }
      return
    }

    roundEndRef.current = setTimeout(async () => {
      await advanceFromRoundEnd(game.id)
    }, 4000)

    return () => {
      if (roundEndRef.current) clearTimeout(roundEndRef.current)
    }
  }, [game?.phase, game?.id])

  // Auto-transition: final_category → final_wager after 5 seconds
  const finalCatRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'final_category') {
      if (finalCatRef.current) {
        clearTimeout(finalCatRef.current)
        finalCatRef.current = null
      }
      return
    }

    finalCatRef.current = setTimeout(async () => {
      await advanceToFinalWager(game.id)
    }, 5000)

    return () => {
      if (finalCatRef.current) clearTimeout(finalCatRef.current)
    }
  }, [game?.phase, game?.id])

  // Auto-transition: final_reveal → game_over after showing reveals (8 seconds)
  const revealRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'final_reveal') {
      if (revealRef.current) {
        clearTimeout(revealRef.current)
        revealRef.current = null
      }
      return
    }

    revealRef.current = setTimeout(async () => {
      await advanceToGameOver(game.id)
    }, 8000)

    return () => {
      if (revealRef.current) clearTimeout(revealRef.current)
    }
  }, [game?.phase, game?.id])

  // Auto-transition: clue_result → board_selection (or round_end) after 4 seconds
  const clueResultRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'clue_result') {
      if (clueResultRef.current) {
        clearTimeout(clueResultRef.current)
        clueResultRef.current = null
      }
      return
    }

    clueResultRef.current = setTimeout(async () => {
      await advanceFromClueResult(game.id)
    }, 4000)

    return () => {
      if (clueResultRef.current) clearTimeout(clueResultRef.current)
    }
  }, [game?.phase, game?.id])

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

  // ROUND END: Dramatic transition splash
  if (game.phase === 'round_end') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark">
        <div className="animate-pulse">
          <h1 className="text-6xl md:text-8xl font-bold text-jeopardy-gold text-center mb-6">
            {game.current_round === 2 ? 'Double Jeopardy!' : 'Final Jeopardy!'}
          </h1>
          <p className="text-2xl text-blue-300 text-center">
            Get ready...
          </p>
        </div>

        {/* Show scores during transition */}
        <div className="flex gap-4 mt-12">
          {players
            .sort((a, b) => b.score - a.score)
            .map((p) => (
              <div key={p.id} className="px-6 py-3 rounded-xl bg-white/5 text-center">
                <p className="text-sm text-gray-400">{p.name}</p>
                <p className={`text-2xl font-bold ${p.score < 0 ? 'text-red-400' : 'text-jeopardy-gold'}`}>
                  ${p.score.toLocaleString()}
                </p>
              </div>
            ))}
        </div>
      </div>
    )
  }

  // FINAL JEOPARDY: Category reveal
  if (game.phase === 'final_category') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark">
        <h1 className="text-5xl md:text-7xl font-bold text-jeopardy-gold mb-12">
          Final Jeopardy!
        </h1>
        <p className="text-gray-400 text-xl mb-4">The category is...</p>
        <div className="bg-jeopardy-blue rounded-2xl px-12 py-8 border-2 border-jeopardy-gold">
          <p className="text-4xl md:text-6xl font-bold text-white text-center uppercase">
            {game.final_category_name}
          </p>
        </div>
      </div>
    )
  }

  // FINAL JEOPARDY: Wager phase (waiting for players to wager)
  if (game.phase === 'final_wager') {
    const wagered = players.filter((p) => p.final_wager != null)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark">
        <h1 className="text-5xl font-bold text-jeopardy-gold mb-4">Final Jeopardy!</h1>
        <div className="bg-jeopardy-blue rounded-2xl px-8 py-4 mb-8">
          <p className="text-2xl font-bold text-white uppercase">{game.final_category_name}</p>
        </div>
        <p className="text-xl text-gray-400 mb-8">Place your wagers on your phones...</p>

        <div className="flex gap-4">
          {players.map((p) => (
            <div key={p.id} className={`px-6 py-4 rounded-xl text-center min-w-[120px] ${
              p.final_wager != null
                ? 'bg-green-600/20 border border-green-500'
                : 'bg-white/5 border border-white/10'
            }`}>
              <p className="text-sm text-gray-400">{p.name}</p>
              <p className="text-lg font-bold mt-1">
                {p.final_wager != null ? (
                  <span className="text-green-400">Locked In</span>
                ) : (
                  <span className="text-gray-500">Wagering...</span>
                )}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-6 text-gray-500">
          {wagered.length}/{players.length} wagers placed
        </p>
      </div>
    )
  }

  // FINAL JEOPARDY: Clue display (read the clue)
  if (game.phase === 'final_clue') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark px-12">
        <p className="text-jeopardy-gold text-2xl font-bold mb-4 uppercase">
          {game.final_category_name}
        </p>
        <p className="text-4xl md:text-6xl text-white text-center leading-relaxed font-serif max-w-5xl">
          {game.final_clue_text}
        </p>
        <p className="text-gray-500 text-xl mt-12 animate-pulse">
          Answer on your phones...
        </p>
      </div>
    )
  }

  // FINAL JEOPARDY: Answering phase (waiting for answers)
  if (game.phase === 'final_answering') {
    const answered = players.filter((p) => p.final_answer != null && p.final_answer !== '')
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark px-12">
        <p className="text-jeopardy-gold text-2xl font-bold mb-4 uppercase">
          {game.final_category_name}
        </p>
        <p className="text-3xl md:text-5xl text-white text-center leading-relaxed font-serif max-w-5xl mb-12">
          {game.final_clue_text}
        </p>

        <div className="flex gap-4">
          {players.map((p) => (
            <div key={p.id} className={`px-6 py-4 rounded-xl text-center min-w-[120px] ${
              p.final_answer
                ? 'bg-green-600/20 border border-green-500'
                : 'bg-white/5 border border-white/10'
            }`}>
              <p className="text-sm text-gray-400">{p.name}</p>
              <p className="text-lg font-bold mt-1">
                {p.final_answer ? (
                  <span className="text-green-400">Answered</span>
                ) : (
                  <span className="text-gray-500 animate-pulse">Thinking...</span>
                )}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-6 text-gray-500">
          {answered.length}/{players.length} answers submitted
        </p>
      </div>
    )
  }

  // FINAL JEOPARDY: Reveal
  if (game.phase === 'final_reveal') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark px-8">
        <h1 className="text-4xl font-bold text-jeopardy-gold mb-4">Final Jeopardy!</h1>
        <p className="text-gray-400 text-lg mb-2 uppercase">{game.final_category_name}</p>
        <p className="text-xl text-blue-300 mb-8">
          Correct answer: <span className="text-white font-bold">{game.final_answer}</span>
        </p>

        <div className="w-full max-w-3xl space-y-4">
          {players
            .sort((a, b) => b.score - a.score)
            .map((p) => (
              <div
                key={p.id}
                className={`flex items-center justify-between px-8 py-5 rounded-2xl ${
                  p.final_correct
                    ? 'bg-green-600/10 border border-green-500/50'
                    : 'bg-red-600/10 border border-red-500/50'
                }`}
              >
                <div>
                  <p className="text-xl font-bold text-white">{p.name}</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Answered: <span className="text-white">{p.final_answer || '(no answer)'}</span>
                    {' · '}Wagered: <span className="text-white">${(p.final_wager ?? 0).toLocaleString()}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-2xl font-bold ${p.score < 0 ? 'text-red-400' : 'text-jeopardy-gold'}`}>
                    ${p.score.toLocaleString()}
                  </p>
                  <p className={`text-sm font-semibold ${p.final_correct ? 'text-green-400' : 'text-red-400'}`}>
                    {p.final_correct ? '✓ Correct' : '✗ Wrong'}
                  </p>
                </div>
              </div>
            ))}
        </div>
      </div>
    )
  }

  // CLUE RESULT: Show answer result animation
  if (game.phase === 'clue_result') {
    const resultClue = game.current_clue_id
      ? clues.find((c) => c.id === game.current_clue_id)
      : null
    const answerer = game.current_player_id
      ? players.find((p) => p.id === game.current_player_id)
      : null
    const wasCorrect = resultClue?.answered_by != null
    const noOneAnswered = !game.current_player_id
    const clueCategory = resultClue
      ? categories.find((c) => c.id === resultClue.category_id)
      : null

    return (
      <div className="min-h-screen flex flex-col bg-jeopardy-dark">
        {/* Scoreboard bar */}
        <div className="flex gap-3 px-4 py-3 bg-black/50 overflow-x-auto">
          {players
            .sort((a, b) => b.score - a.score)
            .map((p) => (
              <div
                key={p.id}
                className={`flex-shrink-0 px-5 py-2 rounded-xl text-center min-w-[120px] transition-all border-b-4 ${
                  p.id === game.current_player_id
                    ? wasCorrect
                      ? 'bg-green-900/30 border-green-500 scale-105'
                      : 'bg-red-900/30 border-red-500 scale-105'
                    : 'bg-jeopardy-blue-dark/30 border-transparent'
                }`}
              >
                <p className="text-sm text-white/60 truncate font-semibold uppercase tracking-wide">{p.name}</p>
                <p
                  className={`text-2xl font-bold ${p.score < 0 ? 'text-red-400' : 'text-jeopardy-gold-light'}`}
                  style={{ textShadow: '1px 1px 3px rgba(0,0,0,0.5)' }}
                >
                  ${p.score.toLocaleString()}
                </p>
              </div>
            ))}
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-12">
          {/* Category + Value */}
          {clueCategory && (
            <p className="text-blue-300 text-xl font-bold uppercase tracking-wide mb-2">
              {clueCategory.name}
            </p>
          )}
          {resultClue && (
            <p className="text-jeopardy-gold text-2xl font-bold mb-6">
              ${resultClue.value.toLocaleString()}
            </p>
          )}

          {/* Result indicator */}
          <div className={`px-16 py-10 rounded-3xl mb-8 ${
            noOneAnswered
              ? 'bg-gray-600/15 border-2 border-gray-500'
              : wasCorrect
                ? 'bg-green-600/15 border-2 border-green-500'
                : 'bg-red-600/15 border-2 border-red-500'
          }`}>
            <p className={`text-6xl md:text-8xl font-bold text-center mb-4 ${
              noOneAnswered ? 'text-gray-400' : wasCorrect ? 'text-green-400' : 'text-red-400'
            }`}>
              {noOneAnswered ? 'Time\'s Up!' : wasCorrect ? '✓ Correct!' : '✗ Incorrect'}
            </p>
            {!noOneAnswered && (
              <p className="text-3xl text-white text-center font-semibold">
                {answerer?.name || 'Unknown'}
              </p>
            )}
            {resultClue && !noOneAnswered && (
              <p className={`text-4xl font-bold text-center mt-4 ${
                wasCorrect ? 'text-green-300' : 'text-red-300'
              }`}>
                {wasCorrect ? '+' : '-'}${resultClue.value.toLocaleString()}
              </p>
            )}
          </div>

          {/* Correct answer */}
          {resultClue && (
            <div className="text-center">
              <p className="text-gray-400 text-lg mb-2">The correct answer:</p>
              <p className="text-3xl md:text-4xl text-white font-bold">
                {resultClue.answer}
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ACTIVE GAME (board + clue display)
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

      {/* Scoreboard bar - podium style */}
      <div className="flex gap-3 px-4 py-3 bg-black/50 overflow-x-auto">
        {players
          .sort((a, b) => b.score - a.score)
          .map((p) => (
            <div
              key={p.id}
              className={`flex-shrink-0 px-5 py-2 rounded-xl text-center min-w-[120px] transition-all border-b-4 ${
                p.id === game.current_player_id
                  ? 'bg-jeopardy-blue-cell/50 border-jeopardy-gold scale-105'
                  : 'bg-jeopardy-blue-dark/30 border-transparent'
              }`}
            >
              <p className="text-sm text-white/60 truncate font-semibold uppercase tracking-wide">{p.name}</p>
              <p
                className={`text-2xl font-bold ${p.score < 0 ? 'text-red-400' : 'text-jeopardy-gold-light'}`}
                style={{ textShadow: '1px 1px 3px rgba(0,0,0,0.5)' }}
              >
                ${p.score.toLocaleString()}
              </p>
            </div>
          ))}
      </div>

      {/* Round header */}
      <div className="text-center py-2 bg-black/20">
        <span
          className="text-lg text-jeopardy-gold font-bold uppercase tracking-wide"
          style={{ textShadow: '1px 1px 3px rgba(0,0,0,0.5)' }}
        >
          {game.current_round === 1
            ? 'Jeopardy!'
            : game.current_round === 2
            ? 'Double Jeopardy!'
            : 'Final Jeopardy!'}
        </span>
        {currentPlayer && !showClue && (
          <span className="text-white/40 ml-4">
            {currentPlayer.name}&apos;s pick
          </span>
        )}
      </div>

      {/* Board or Clue display */}
      {showClue && currentClue ? (
        <div className="flex-1 flex flex-col items-center justify-center px-12">
          {/* Category name */}
          {(() => {
            const clueCategory = categories.find((c) => c.id === currentClue.category_id)
            return clueCategory ? (
              <p className="text-blue-300 text-2xl font-bold uppercase tracking-wide mb-4">
                {clueCategory.name}
              </p>
            ) : null
          })()}

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
              <div className="flex flex-col items-center gap-3">
                <p className="text-blue-400 text-2xl font-bold animate-buzz-pulse">
                  BUZZ IN NOW!
                </p>
                {buzzCountdown !== null && (
                  <p className={`text-5xl font-bold font-mono ${
                    buzzCountdown <= 5 ? 'text-red-400' : 'text-white'
                  }`}>
                    {buzzCountdown}
                  </p>
                )}
              </div>
            )}
            {game.phase === 'player_answering' && (
              <div className="flex flex-col items-center gap-4">
                <p className="text-green-400 text-2xl font-bold">
                  {players.find((p) => p.id === game.current_player_id)?.name} is answering...
                </p>
                {answerCountdown !== null && (
                  <p className={`text-6xl font-bold ${answerCountdown <= 5 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                    {answerCountdown}
                  </p>
                )}
              </div>
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
                      {i === 0 ? '\u{1F3C6}' : i === 1 ? '\u{1F948}' : i === 2 ? '\u{1F949}' : `${i + 1}.`}
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
