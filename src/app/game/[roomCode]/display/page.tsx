'use client'

import { useParams } from 'next/navigation'
import { useGameChannel } from '@/hooks/useGameChannel'
import { GameBoard } from '@/components/GameBoard'
import { ClueText } from '@/components/ClueText'
import { BuzzOrder } from '@/components/BuzzOrder'
import { useState, useEffect, useRef, useMemo } from 'react'
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
  skipToRound,
} from '@/lib/game-api'
import { CLUE_INTRO_MS } from '@/lib/clue-timing'
import { AnimatedClueReveal } from '@/components/AnimatedClueReveal'
import type { Player } from '@/types/game'
import { playCorrectSound, playWrongSound, playTimeUpSound, playDailyDoubleSound, playBuzzSound, playTickSound, playSelectSound } from '@/lib/sounds'

function QRCode({ roomCode }: { roomCode: string }) {
  const [origin, setOrigin] = useState('')
  useEffect(() => { setOrigin(window.location.origin) }, [])
  if (!origin) return null
  const url = `${origin}/game/${roomCode}/play`
  return (
    <div className="flex flex-col items-center">
      <img
        src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`}
        alt="Scan to join"
        className="w-48 h-48 rounded-xl bg-white p-2"
      />
      <p className="text-gray-500 text-sm mt-2">Scan to join</p>
    </div>
  )
}

/**
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

  // Fetch the player's typed answer when we enter clue_result phase
  const [playerAnswer, setPlayerAnswer] = useState<string | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'clue_result' || !game.current_clue_id) {
      setPlayerAnswer(null)
      return
    }
    // Get the winning buzz's answer text
    supabase
      .from('buzzes')
      .select('answer')
      .eq('game_id', game.id)
      .eq('clue_id', game.current_clue_id)
      .eq('is_winner', true)
      .limit(1)
      .single()
      .then(({ data }) => {
        setPlayerAnswer(data?.answer ?? null)
      })
  }, [game?.phase, game?.id, game?.current_clue_id])

  // Load source game info (date, title) from clue_pool if this is a J-Archive game
  const [sourceGameInfo, setSourceGameInfo] = useState<{ title: string; airDate: string | null } | null>(null)
  useEffect(() => {
    if (!game?.id) return
    const sourceId = (game.settings as any)?.sourceGameId
    if (!sourceId) return

    supabase
      .from('clue_pool')
      .select('game_title, air_date')
      .eq('game_id_source', sourceId)
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]) {
          setSourceGameInfo({ title: data[0].game_title, airDate: data[0].air_date })
        }
      })
  }, [game?.id, game?.settings])


  // === SOUND EFFECTS ===
  const prevPhaseRef = useRef<string | null>(null)
  useEffect(() => {
    if (!game) return
    const prev = prevPhaseRef.current
    const curr = game.phase

    // Play sounds on phase transitions
    if (prev !== curr) {
      if (curr === 'clue_reading') playSelectSound()
      if (curr === 'player_answering') playBuzzSound()
      if (curr === 'daily_double_wager') playDailyDoubleSound()
      if (curr === 'clue_result') {
        // Check if the clue was answered correctly
        const resultClue = game.current_clue_id
          ? clues.find((c) => c.id === game.current_clue_id)
          : null
        if (resultClue?.answered_correct === true) {
          playCorrectSound()
        } else if (resultClue?.answered_by && resultClue?.answered_correct === false) {
          playWrongSound()
        } else {
          // No one answered (timeout)
          playTimeUpSound()
        }
      }
    }

    prevPhaseRef.current = curr
  }, [game?.phase, game?.current_clue_id, clues])

  // Reveal writer: display fires the buzz_window transition on its own local
  // clock once the intro + reveal have finished playing. The animation itself
  // is rendered by <AnimatedClueReveal>, which is anchored to server time so
  // display + phone stay perfectly in sync.
  useEffect(() => {
    if (!game || game.phase !== 'clue_reading') return
    const currentClue = game.current_clue_id ? clues.find((c) => c.id === game.current_clue_id) : null
    if (!currentClue?.question) return

    const gameId = game.id
    const totalChars = currentClue.question.length
    const settingsDelay = game.settings?.reading_period_ms
    const revealDurationMs =
      typeof settingsDelay === 'number' && settingsDelay > 0
        ? settingsDelay
        : Math.max(3000, Math.min(15000, totalChars * 55))
    const phaseStartedAt = game.updated_at ? new Date(game.updated_at).getTime() : Date.now()
    // Wait for intro + reveal + 600ms buffer, measured from the server phase
    // start (converted to local clock). Clamp to reasonable local delay in case
    // the client clock is way off.
    const targetAt = phaseStartedAt + CLUE_INTRO_MS + revealDurationMs + 600
    const delay = Math.max(500, Math.min(30000, targetAt - Date.now()))

    const openBuzz = setTimeout(async () => {
      await supabase
        .from('games')
        .update({
          phase: 'buzz_window',
          buzz_window_open: true,
          // 700ms lead so every phone can arm together via buzz_window_start.
          buzz_window_start: new Date(Date.now() + 700).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', gameId)
        .eq('phase', 'clue_reading') // only flip if still reading
    }, delay)

    return () => clearTimeout(openBuzz)
  }, [game?.phase, game?.id, game?.current_clue_id, game?.updated_at, clues, game?.settings?.reading_period_ms])

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
    // buzz_window_start is a scheduled-future timestamp (writer added ~700ms lead).
    // Wait for that moment locally so all clients open together. Clamp the delay
    // to [0, 1200ms] so a badly-skewed device clock still opens promptly.
    const scheduledMs = game.buzz_window_start
      ? new Date(game.buzz_window_start).getTime()
      : Date.now()
    const openDelay = Math.max(0, Math.min(1200, scheduledMs - Date.now()))
    const armAt = Date.now() + openDelay
    setBuzzCountdown(Math.ceil(totalMs / 1000))

    buzzIntervalRef.current = setInterval(() => {
      const remaining = Math.max(0, totalMs - (Date.now() - armAt))
      setBuzzCountdown(Math.ceil(remaining / 1000))
    }, 250)

    buzzTimeoutRef.current = setTimeout(async () => {
      if (game.current_clue_id) {
        await skipClue(game.id, game.current_clue_id)
      }
    }, openDelay + totalMs)

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

    // Auto-pass when time runs out — capture the specific player answering
    // right now so a subsequent rebound (current_player_id changes) can't
    // let this stale timer double-deduct the original player.
    const stuckClueId = game.current_clue_id
    const stuckPlayerId = game.current_player_id
    answerTimeoutRef.current = setTimeout(async () => {
      if (stuckClueId && stuckPlayerId) {
        await passAfterBuzz(game.id, stuckClueId, stuckPlayerId)
      }
    }, totalMs)

    return () => {
      if (answerTimeoutRef.current) clearTimeout(answerTimeoutRef.current)
      if (answerIntervalRef.current) clearInterval(answerIntervalRef.current)
    }
  }, [game?.phase, game?.id, game?.current_player_id, game?.current_clue_id])

  // Play tick sounds during buzz countdown
  const prevBuzzCountRef = useRef<number | null>(null)
  useEffect(() => {
    if (buzzCountdown !== null && prevBuzzCountRef.current !== null && buzzCountdown !== prevBuzzCountRef.current && buzzCountdown > 0) {
      playTickSound(buzzCountdown <= 5)
    }
    prevBuzzCountRef.current = buzzCountdown
  }, [buzzCountdown])

  // Play tick sounds during answer countdown
  const prevAnswerCountRef = useRef<number | null>(null)
  useEffect(() => {
    if (answerCountdown !== null && prevAnswerCountRef.current !== null && answerCountdown !== prevAnswerCountRef.current && answerCountdown > 0) {
      playTickSound(answerCountdown <= 5)
    }
    prevAnswerCountRef.current = answerCountdown
  }, [answerCountdown])

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

  // Auto-transition: final_clue → final_answering after 5 seconds
  const finalClueRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!game || game.phase !== 'final_clue') {
      if (finalClueRef.current) {
        clearTimeout(finalClueRef.current)
        finalClueRef.current = null
      }
      return
    }

    finalClueRef.current = setTimeout(async () => {
      await advanceToFinalAnswering(game.id)
    }, 5000)

    return () => {
      if (finalClueRef.current) clearTimeout(finalClueRef.current)
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
        <img
          src="/jeopardy-logo.png"
          alt="JEOPARDY!"
          className="h-44 md:h-64 w-auto mb-6"
        />

        <p className="text-2xl text-blue-300 mb-12">Join on your phone</p>

        {/* Room code + QR */}
        <div className="flex items-center gap-8 mb-8">
          <div className="bg-white/5 rounded-3xl px-12 py-8 border border-white/10">
            <p className="text-gray-400 text-lg mb-2 text-center">Room Code</p>
            <p className="text-8xl md:text-9xl font-mono font-bold tracking-[0.4em] text-white text-center">
              {game.room_code}
            </p>
          </div>
          <QRCode roomCode={game.room_code} />
        </div>

        {/* Players who have joined */}
        <div className="flex flex-wrap gap-4 justify-center max-w-4xl">
          {players.map((p) => (
            <div
              key={p.id}
              className="px-6 py-3 rounded-2xl text-xl font-semibold bg-white/5 border border-white/10 text-gray-100 flex items-center gap-2"
            >
              {p.name}
              {p.is_creator && (
                <span className="text-[10px] uppercase tracking-widest text-jeopardy-gold font-bold">Host</span>
              )}
            </div>
          ))}
          {players.length === 0 && (
            <p className="text-gray-500 text-xl">Waiting for players...</p>
          )}
        </div>

        <p className="mt-8 text-gray-500">
          {players.length}/15 players
          {players.length >= 1 && (
            <span className="text-jeopardy-gold ml-4">Waiting for host to start...</span>
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
    const wasCorrect = resultClue?.answered_correct === true
    const noOneAnswered = !resultClue?.answered_by
    const answerer = resultClue?.answered_by
      ? players.find((p) => p.id === resultClue.answered_by)
      : null
    const clueCategory = resultClue
      ? categories.find((c) => c.id === resultClue.category_id)
      : null
    const isDailyDouble = resultClue?.is_daily_double === true
    // For DDs the score change uses the wager, not the clue's face value.
    const swing = isDailyDouble ? (answerer?.final_wager ?? 0) : (resultClue?.value ?? 0)

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
                  p.id === resultClue?.answered_by
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
          {/* Buzz order — surfaced first when 2+ people raced for the buzz */}
          {resultClue && (
            <div className="mb-6 w-full max-w-md">
              <BuzzOrder gameId={game.id} clueId={resultClue.id} players={players} />
            </div>
          )}

          {/* Category + Value */}
          {clueCategory && (
            <p className="text-blue-300 text-xl font-bold uppercase tracking-wide mb-2">
              {clueCategory.name}
            </p>
          )}
          {resultClue && (
            <p className="text-jeopardy-gold text-2xl font-bold mb-1">
              ${resultClue.value.toLocaleString()}
            </p>
          )}
          {isDailyDouble && answerer && (
            <p className="text-jeopardy-gold-light text-lg font-bold uppercase tracking-widest mb-6">
              ⭐ Daily Double — wagered ${swing.toLocaleString()}
            </p>
          )}
          {!isDailyDouble && resultClue && (
            <div className="mb-4" />
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
            {!noOneAnswered && playerAnswer && (
              <p className="text-2xl text-white/70 text-center mt-3 italic">
                &ldquo;{playerAnswer}&rdquo;
              </p>
            )}
            {resultClue && !noOneAnswered && (
              <p className={`text-4xl font-bold text-center mt-4 ${
                wasCorrect ? 'text-green-300' : 'text-red-300'
              }`}>
                {wasCorrect ? '+' : '-'}${swing.toLocaleString()}
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
      game.phase === 'daily_double_answering')

  const currentPlayer = players.find((p) => p.id === game.current_player_id)

  // DAILY DOUBLE WAGER: Show category but NOT the clue
  if (game.phase === 'daily_double_wager' && currentClue) {
    const ddCategory = categories.find((c) => c.id === currentClue.category_id)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-jeopardy-dark">
        <h1 className="text-6xl md:text-8xl font-bold text-jeopardy-gold mb-8 animate-pulse">Daily Double!</h1>
        {ddCategory && (
          <div className="bg-jeopardy-blue rounded-2xl px-12 py-6 border-2 border-jeopardy-gold mb-8">
            <p className="text-3xl md:text-5xl font-bold text-white text-center uppercase">{ddCategory.name}</p>
          </div>
        )}
        <p className="text-2xl text-white mb-2">{currentPlayer?.name}</p>
        <p className="text-xl text-gray-400">is making their wager...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-jeopardy-dark">
      {/* Connection indicator + debug skip buttons */}
      <div className="fixed top-3 right-3 z-50 flex items-center gap-2">
        {game.phase === 'board_selection' && game.current_round === 1 && (
          <button
            onClick={() => skipToRound(game.id, 2)}
            className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 rounded text-gray-400 transition-colors"
          >
            Skip → DJ
          </button>
        )}
        {game.phase === 'board_selection' && game.current_round <= 2 && (
          <button
            onClick={() => skipToRound(game.id, 3)}
            className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 rounded text-gray-400 transition-colors"
          >
            Skip → FJ
          </button>
        )}
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

      {/* Round header with game info */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/20">
        <div className="flex items-center gap-3">
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
            <span className="text-white/40">
              {currentPlayer.name}&apos;s pick
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm">
          {sourceGameInfo?.airDate && (
            <span className="text-white/30">
              {new Date(sourceGameInfo.airDate + 'T00:00:00').toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          )}
          <span className="text-white/20 font-mono tracking-wider">{roomCode}</span>
        </div>
      </div>

      {/* Board or Clue display */}
      {showClue && currentClue ? (
        // key forces a fresh remount when clue changes so no stale render lingers
        <div key={currentClue.id} className="flex-1 flex flex-col items-center justify-center px-12">
          <AnimatedClueReveal
            key={currentClue.id}
            variant="tv"
            category={categories.find((c) => c.id === currentClue.category_id)?.name ?? null}
            value={currentClue.value}
            question={currentClue.question}
            revealDurationMs={
              (game.settings?.reading_period_ms && game.settings.reading_period_ms > 0)
                ? game.settings.reading_period_ms
                : Math.max(3000, Math.min(15000, currentClue.question.length * 55))
            }
          />

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
                {game.current_clue_id && (
                  <BuzzOrder gameId={game.id} clueId={game.current_clue_id} players={players} />
                )}
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
        <div className="fixed inset-0 bg-jeopardy-dark z-50 flex flex-col items-center justify-center p-8">
          <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-20 md:h-32 w-auto mb-6" />
          <h1 className="text-5xl md:text-7xl font-bold text-jeopardy-gold mb-2">
            {players.sort((a, b) => b.score - a.score)[0]?.name || 'Winner'}
          </h1>
          <p className="text-2xl text-white/60 mb-10">is our champion!</p>

          <div className="w-full max-w-2xl space-y-4 mb-12">
            {players
              .sort((a, b) => b.score - a.score)
              .map((p, i) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between px-8 py-6 rounded-2xl transition-all ${
                    i === 0
                      ? 'bg-jeopardy-gold/20 border-2 border-jeopardy-gold scale-105'
                      : i === 1
                        ? 'bg-white/5 border border-gray-600'
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

          <a
            href="/host"
            className="btn-primary px-12 py-5 text-xl"
          >
            New Game
          </a>
        </div>
      )}
    </div>
  )
}
