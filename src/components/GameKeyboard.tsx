'use client'

import { useState } from 'react'

interface GameKeyboardProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  mode: 'letters' | 'numbers'
  placeholder?: string
  submitLabel?: string
  submitDisabled?: boolean
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean }
  maxLength?: number
}

/**
 * Custom on-screen keyboard for Jeopardy.
 * Prevents native mobile keyboard from popping up and disrupting the UI.
 * Two modes: letters (QWERTY) for answers, numbers for wagers.
 */
export function GameKeyboard({
  value,
  onChange,
  onSubmit,
  mode,
  placeholder = '',
  submitLabel = 'Submit',
  submitDisabled = false,
  secondaryAction,
  maxLength,
}: GameKeyboardProps) {
  const [shift, setShift] = useState(false)

  const letterRows = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
  ]

  const numberKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '00']

  function handleKey(key: string) {
    const newChar = mode === 'letters' ? (shift ? key.toUpperCase() : key.toLowerCase()) : key
    if (maxLength && (value + newChar).length > maxLength) return
    onChange(value + newChar)
    if (mode === 'letters' && shift) setShift(false)
  }

  function handleBackspace() {
    onChange(value.slice(0, -1))
  }

  function handleSpace() {
    if (maxLength && value.length >= maxLength) return
    onChange(value + ' ')
  }

  return (
    <div className="w-full">
      {/* Display field (read-only, no native keyboard) */}
      <div
        className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-white mb-1.5 min-h-[40px] flex items-center"
        style={{ fontSize: mode === 'numbers' ? '1.5rem' : '1rem' }}
      >
        {value || <span className="text-gray-500">{placeholder}</span>}
        <span className="animate-pulse text-jeopardy-gold ml-0.5">|</span>
      </div>

      {mode === 'letters' ? (
        /* QWERTY keyboard */
        <div className="space-y-[3px]">
          {letterRows.map((row, rowIdx) => (
            <div key={rowIdx} className="flex justify-center gap-[3px]">
              {rowIdx === 2 && (
                <button
                  onClick={() => setShift(!shift)}
                  className={`px-2 py-2.5 rounded-lg text-xs font-bold transition-all touch-manipulation ${
                    shift ? 'bg-jeopardy-gold/30 text-jeopardy-gold' : 'bg-white/10 text-gray-400'
                  }`}
                >
                  ⇧
                </button>
              )}
              {row.map((key) => (
                <button
                  key={key}
                  onClick={() => handleKey(key)}
                  className="flex-1 max-w-[36px] py-2.5 rounded-lg bg-white/10 text-white text-sm font-semibold
                             active:bg-white/25 active:scale-95 transition-all touch-manipulation"
                >
                  {shift ? key : key.toLowerCase()}
                </button>
              ))}
              {rowIdx === 2 && (
                <button
                  onClick={handleBackspace}
                  className="px-2 py-2.5 rounded-lg bg-white/10 text-gray-400 text-xs font-bold
                             active:bg-red-500/30 active:text-red-300 transition-all touch-manipulation"
                >
                  ⌫
                </button>
              )}
            </div>
          ))}
          {/* Bottom row: space + submit (+ optional secondary action) */}
          <div className="flex gap-[3px]">
            <button
              onClick={handleSpace}
              className="flex-1 py-2.5 rounded-lg bg-white/10 text-gray-400 text-sm
                         active:bg-white/25 transition-all touch-manipulation"
            >
              space
            </button>
            <button
              onClick={onSubmit}
              disabled={submitDisabled}
              className="px-6 py-2.5 btn-primary text-sm touch-manipulation"
            >
              {submitLabel}
            </button>
            {secondaryAction && (
              <button
                onClick={secondaryAction.onClick}
                disabled={secondaryAction.disabled}
                className="px-4 py-2.5 rounded-lg bg-white/10 text-gray-400 text-sm font-semibold
                           active:bg-white/25 transition-all touch-manipulation disabled:opacity-40"
              >
                {secondaryAction.label}
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Number pad */
        <div className="space-y-[3px]">
          <div className="grid grid-cols-3 gap-[3px]">
            {numberKeys.slice(0, 9).map((key) => (
              <button
                key={key}
                onClick={() => handleKey(key)}
                className="py-3 rounded-lg bg-white/10 text-white text-xl font-bold
                           active:bg-white/25 active:scale-95 transition-all touch-manipulation"
              >
                {key}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-[3px]">
            <button
              onClick={() => handleKey('0')}
              className="py-3 rounded-lg bg-white/10 text-white text-xl font-bold
                         active:bg-white/25 active:scale-95 transition-all touch-manipulation"
            >
              0
            </button>
            <button
              onClick={() => handleKey('00')}
              className="py-3 rounded-lg bg-white/10 text-white text-xl font-bold
                         active:bg-white/25 active:scale-95 transition-all touch-manipulation"
            >
              00
            </button>
            <button
              onClick={handleBackspace}
              className="py-3 rounded-lg bg-white/10 text-gray-400 text-xl font-bold
                         active:bg-red-500/30 active:text-red-300 transition-all touch-manipulation"
            >
              ⌫
            </button>
          </div>
          <button
            onClick={onSubmit}
            disabled={submitDisabled}
            className="w-full py-3 btn-primary text-lg touch-manipulation"
          >
            {submitLabel}
          </button>
        </div>
      )}
    </div>
  )
}
