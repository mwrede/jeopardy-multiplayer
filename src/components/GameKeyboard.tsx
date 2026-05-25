'use client'

import { useRef, useEffect, useState } from 'react'

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
  /** Show a mic button that uses the Web Speech API to dictate the answer.
   *  Defaults to true in 'letters' mode (and false in 'numbers'). */
  enableVoice?: boolean
}

/**
 * Styled input + submit button for Jeopardy.
 * Uses the native device keyboard, plus an optional voice-input button
 * (Web Speech API) so players can say their answer instead of typing.
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
  enableVoice,
}: GameKeyboardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)
  const [recording, setRecording] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const [voiceError, setVoiceError] = useState('')

  const showVoice = (enableVoice ?? mode === 'letters') && speechSupported

  // Auto-focus the input when it mounts
  useEffect(() => {
    // Small delay so iOS reliably opens the keyboard
    const t = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  // Detect Web Speech support once on mount
  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setSpeechSupported(!!SR)
  }, [])

  // Clean up an active recognition if the component unmounts mid-utterance
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop() } catch {}
        recognitionRef.current = null
      }
    }
  }, [])

  function startRecording() {
    setVoiceError('')
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setVoiceError('Voice input not supported on this browser.')
      return
    }
    try {
      const recognition = new SR()
      recognition.continuous = false
      recognition.interimResults = true
      recognition.lang = 'en-US'

      // Snapshot whatever the user had typed so we append rather than replace.
      const prefix = value.trim() ? value.trim() + ' ' : ''

      recognition.onresult = (event: any) => {
        let transcript = ''
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript
        }
        let next = prefix + transcript
        if (maxLength && next.length > maxLength) next = next.slice(0, maxLength)
        onChange(next)
      }
      recognition.onend = () => {
        setRecording(false)
        recognitionRef.current = null
      }
      recognition.onerror = (e: any) => {
        setRecording(false)
        recognitionRef.current = null
        const code = e?.error || 'unknown'
        // not-allowed = user denied mic; service-not-allowed on iOS = same idea
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          setVoiceError('Microphone permission denied. Allow mic access in your browser settings.')
        } else if (code === 'no-speech') {
          setVoiceError('Didn\'t catch anything — try again.')
        } else if (code !== 'aborted') {
          setVoiceError(`Voice error: ${code}`)
        }
      }

      recognition.start()
      recognitionRef.current = recognition
      setRecording(true)
    } catch (e: any) {
      setVoiceError(e?.message || 'Could not start voice input.')
    }
  }

  function stopRecording() {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }
    setRecording(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !submitDisabled) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="w-full">
      <div className="relative mb-2">
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
          placeholder={recording ? 'Listening…' : placeholder}
          maxLength={maxLength}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className={`w-full bg-white/10 border rounded-xl px-4 py-3 text-white min-h-[48px]
                     placeholder:text-gray-500 focus:outline-none focus:ring-1 transition-colors ${
                       recording
                         ? 'border-red-500 ring-1 ring-red-500/40 pr-14'
                         : 'border-white/20 focus:border-jeopardy-gold/60 focus:ring-jeopardy-gold/30'
                     } ${showVoice ? 'pr-14' : ''}`}
          style={{ fontSize: mode === 'numbers' ? '1.5rem' : '1.125rem' }}
        />
        {showVoice && (
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            aria-label={recording ? 'Stop recording' : 'Speak answer'}
            className={`absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center transition-all touch-manipulation ${
              recording
                ? 'bg-red-500 text-white animate-pulse'
                : 'bg-white/15 text-gray-200 hover:bg-white/25'
            }`}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <span className="text-lg leading-none">{recording ? '⏹' : '🎤'}</span>
          </button>
        )}
      </div>
      {voiceError && (
        <p className="text-red-400 text-xs mb-2">{voiceError}</p>
      )}
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
