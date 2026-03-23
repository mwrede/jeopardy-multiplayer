'use client'

import { useRef, useEffect } from 'react'

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
 * Styled input + submit button for Jeopardy.
 * Uses the native device keyboard on all platforms (mobile + desktop).
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
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus the input when it mounts
  useEffect(() => {
    // Small delay so iOS reliably opens the keyboard
    const t = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !submitDisabled) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="text"
        inputMode={mode === 'numbers' ? 'numeric' : 'text'}
        value={value}
        onChange={(e) => {
          let v = e.target.value
          if (mode === 'numbers') v = v.replace(/[^0-9]/g, '')
          if (maxLength && v.length > maxLength) return
          onChange(v)
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white mb-2 min-h-[48px]
                   placeholder:text-gray-500 focus:outline-none focus:border-jeopardy-gold/60 focus:ring-1 focus:ring-jeopardy-gold/30 transition-colors"
        style={{ fontSize: mode === 'numbers' ? '1.5rem' : '1.125rem' }}
      />
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={submitDisabled}
          className="flex-1 py-3 btn-primary text-base touch-manipulation"
        >
          {submitLabel}
        </button>
        {secondaryAction && (
          <button
            onClick={secondaryAction.onClick}
            disabled={secondaryAction.disabled}
            className="px-6 py-3 rounded-lg bg-white/10 text-gray-400 text-base font-semibold
                       hover:bg-white/20 transition-all disabled:opacity-40"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>
    </div>
  )
}
