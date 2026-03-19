'use client'

import { useState, useCallback, useEffect } from 'react'

type BuzzerState = 'disabled' | 'ready' | 'buzzed' | 'lockout' | 'answering'

interface BuzzerButtonProps {
  gameId: string
  clueId: string
  playerId: string
  buzzWindowOpen: boolean
  isBuzzWinner: boolean
  isLockedOut: boolean
  onBuzz: () => Promise<void>
}

export function BuzzerButton({
  gameId,
  clueId,
  playerId,
  buzzWindowOpen,
  isBuzzWinner,
  isLockedOut,
  onBuzz,
}: BuzzerButtonProps) {
  const [state, setState] = useState<BuzzerState>('disabled')
  const [buzzing, setBuzzing] = useState(false)
  const [pressed, setPressed] = useState(false)

  useEffect(() => {
    if (isBuzzWinner) {
      setState('buzzed')
    } else if (isLockedOut) {
      setState('lockout')
    } else if (buzzWindowOpen) {
      setState('ready')
    } else {
      setState('disabled')
    }
  }, [buzzWindowOpen, isBuzzWinner, isLockedOut])

  const handleBuzz = useCallback(async () => {
    if (state !== 'ready' || buzzing) return

    setPressed(true)
    setTimeout(() => setPressed(false), 150)

    setBuzzing(true)
    try {
      await onBuzz()
    } catch (e) {
      console.error('Buzz failed:', e)
    } finally {
      setBuzzing(false)
    }
  }, [state, buzzing, onBuzz])

  // Keyboard support: spacebar to buzz
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && state === 'ready') {
        e.preventDefault()
        handleBuzz()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleBuzz, state])

  const isReady = state === 'ready'
  const isBuzzed = state === 'buzzed'
  const isLocked = state === 'lockout'

  // Button top color based on state
  const buttonColor = isBuzzed
    ? '#22C55E'  // green when buzzed
    : isLocked
      ? '#666'   // gray when locked
      : isReady
        ? '#DC2626' // red when ready
        : '#555'    // dark gray when disabled

  const glowColor = isReady
    ? 'rgba(220, 38, 38, 0.6)'
    : isBuzzed
      ? 'rgba(34, 197, 94, 0.6)'
      : 'transparent'

  return (
    <div className="flex flex-col items-center px-4 pb-4">
      {/* The buzzer device */}
      <button
        onClick={handleBuzz}
        onTouchStart={() => state === 'ready' && setPressed(true)}
        onTouchEnd={() => setPressed(false)}
        disabled={state !== 'ready'}
        className="relative select-none touch-manipulation focus:outline-none"
        aria-label={
          state === 'ready' ? 'Buzz in' :
          state === 'buzzed' ? 'You buzzed in' :
          state === 'lockout' ? 'Locked out' :
          'Wait for the clue'
        }
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        {/* Glow effect behind buzzer when ready */}
        {isReady && (
          <div
            className="absolute inset-0 rounded-full animate-buzz-pulse"
            style={{
              background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)`,
              transform: 'scale(1.8)',
              filter: 'blur(20px)',
            }}
          />
        )}

        {/* Cord coming from bottom */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-[6px] h-24"
          style={{
            background: 'linear-gradient(to bottom, #222 0%, #111 100%)',
            borderRadius: '0 0 3px 3px',
            boxShadow: '1px 0 2px rgba(0,0,0,0.5)',
          }}
        />
        {/* Cord strain relief */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[2px] w-[14px] h-[10px]"
          style={{
            background: 'linear-gradient(to bottom, #333, #1a1a1a)',
            borderRadius: '0 0 4px 4px',
          }}
        />

        {/* Main cylinder body */}
        <div
          className="relative w-24 h-32 mx-auto transition-transform"
          style={{
            transform: pressed ? 'scale(0.95)' : 'scale(1)',
          }}
        >
          {/* Cylinder body */}
          <div
            className="absolute inset-0 rounded-xl"
            style={{
              background: 'linear-gradient(135deg, #3a3a3a 0%, #1a1a1a 30%, #0d0d0d 70%, #1a1a1a 100%)',
              boxShadow: `
                inset 2px 2px 6px rgba(255,255,255,0.08),
                inset -2px -2px 6px rgba(0,0,0,0.5),
                4px 6px 16px rgba(0,0,0,0.7),
                0 0 30px ${glowColor}
              `,
              borderRadius: '14px',
            }}
          />

          {/* Subtle grip texture lines */}
          <div className="absolute inset-x-3 top-14 bottom-4 flex flex-col justify-evenly opacity-10">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-[1px] bg-white/40 rounded" />
            ))}
          </div>

          {/* Button on top */}
          <div
            className="absolute -top-2 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full transition-all"
            style={{
              background: `radial-gradient(circle at 35% 35%, ${
                isReady ? '#ff4444' : buttonColor
              } 0%, ${buttonColor} 60%, ${
                isReady ? '#991111' : '#333'
              } 100%)`,
              boxShadow: `
                inset 0 2px 4px rgba(255,255,255,0.3),
                inset 0 -3px 6px rgba(0,0,0,0.4),
                0 4px 12px rgba(0,0,0,0.6)
                ${isReady ? `, 0 0 20px ${glowColor}` : ''}
              `,
              transform: pressed ? 'translate(-50%, 3px) scale(0.95)' : 'translate(-50%, 0)',
              border: '2px solid rgba(0,0,0,0.3)',
            }}
          />

          {/* Metal ring around button */}
          <div
            className="absolute -top-3 left-1/2 -translate-x-1/2 w-[70px] h-[70px] rounded-full pointer-events-none"
            style={{
              border: '2px solid rgba(80,80,80,0.4)',
              background: 'transparent',
            }}
          />
        </div>
      </button>

      {/* Status text below cord */}
      <div className="mt-28 text-center">
        {state === 'ready' && (
          <p className="text-red-400 font-bold text-lg uppercase tracking-widest animate-pulse">
            Buzz In!
          </p>
        )}
        {state === 'buzzed' && (
          <p className="text-green-400 font-bold text-lg uppercase tracking-widest">
            Buzzed In!
          </p>
        )}
        {state === 'lockout' && (
          <p className="text-red-400/60 font-semibold text-base uppercase tracking-wide">
            Locked Out
          </p>
        )}
        {state === 'disabled' && (
          <p className="text-gray-600 font-medium text-base uppercase tracking-wide">
            Wait...
          </p>
        )}
        {state === 'ready' && (
          <p className="text-gray-600 text-xs mt-1">
            Tap buzzer or press spacebar
          </p>
        )}
      </div>
    </div>
  )
}
