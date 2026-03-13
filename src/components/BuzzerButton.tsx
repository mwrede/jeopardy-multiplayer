'use client'

import { useState, useCallback, useEffect } from 'react'
import { submitBuzz } from '@/lib/game-api'

type BuzzerState = 'disabled' | 'ready' | 'buzzed' | 'lockout' | 'answering'

interface BuzzerButtonProps {
  gameId: string
  clueId: string
  playerId: string
  buzzWindowOpen: boolean
  isBuzzWinner: boolean
  isLockedOut: boolean
  onBuzzed?: () => void
}

export function BuzzerButton({
  gameId,
  clueId,
  playerId,
  buzzWindowOpen,
  isBuzzWinner,
  isLockedOut,
  onBuzzed,
}: BuzzerButtonProps) {
  const [state, setState] = useState<BuzzerState>('disabled')
  const [buzzing, setBuzzing] = useState(false)

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

    setBuzzing(true)
    try {
      await submitBuzz(gameId, clueId, playerId)
      onBuzzed?.()
    } catch (e) {
      console.error('Buzz failed:', e)
    } finally {
      setBuzzing(false)
    }
  }, [state, buzzing, gameId, clueId, playerId, onBuzzed])

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

  const labels: Record<BuzzerState, string> = {
    disabled: 'Wait...',
    ready: 'BUZZ!',
    buzzed: 'You buzzed in!',
    lockout: 'Locked out',
    answering: 'Answer now!',
  }

  const styles: Record<BuzzerState, string> = {
    disabled: 'buzzer-btn buzzer-disabled',
    ready: 'buzzer-btn buzzer-ready',
    buzzed: 'buzzer-btn buzzer-buzzed',
    lockout: 'buzzer-btn buzzer-lockout',
    answering: 'buzzer-btn buzzer-buzzed',
  }

  return (
    <div className="px-4 pb-4">
      <button
        onClick={handleBuzz}
        disabled={state !== 'ready'}
        className={styles[state]}
        aria-label={labels[state]}
      >
        {labels[state]}
      </button>
      {state === 'ready' && (
        <p className="text-center text-gray-500 text-xs mt-2">
          Press spacebar or tap to buzz
        </p>
      )}
    </div>
  )
}
