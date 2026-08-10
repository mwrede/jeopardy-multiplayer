'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { signInWithGoogle } from '@/lib/auth'

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="stage-page-deep" />}>
      <LoginContent />
    </Suspense>
  )
}

/**
 * One button. The app works signed-out — boards, hosting and play all do —
 * so an account exists for exactly one reason: carrying your boards between
 * devices. That doesn't justify a password to remember.
 */
function LoginContent() {
  const params = useSearchParams()
  const next = params.get('next') || '/'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleGoogle() {
    setBusy(true)
    setError('')
    try {
      await signInWithGoogle(next)
      // The browser leaves for Google here; nothing after this runs on success.
    } catch (e: any) {
      setError(e?.message || 'Could not reach Google. Try again.')
      setBusy(false)
    }
  }

  return (
    <main className="stage-page-deep flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="plate">
          <div className="plate-surface p-8 text-center md:p-10">
            <div
              className="mb-3 text-[11px] uppercase tracking-[0.36em] text-copper"
              style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '0 0 8px rgba(255,155,68,0.5)' }}
            >
              ▸ Account ◂
            </div>
            <h2 className="display-chrome text-4xl leading-none md:text-[42px]">Sign In</h2>
            <p className="mx-auto mt-3 max-w-[34ch] text-sm text-ink-stage">
              Only so your boards follow you between devices. Everything else works
              without an account.
            </p>

            <button
              onClick={handleGoogle}
              disabled={busy}
              className="mt-7 flex w-full items-center justify-center gap-3 rounded-lg bg-white px-5 py-3.5 font-semibold text-[#1f1f1f] transition-colors hover:bg-gray-100 disabled:opacity-60"
            >
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              {busy ? 'Opening Google…' : 'Continue with Google'}
            </button>

            {error && <p className="mt-4 text-sm text-copper-glow">{error}</p>}

            <div className="mt-7 border-t border-white/10 pt-5 text-sm text-ink-stage-2">
              <a href="/" className="text-copper underline underline-offset-4 hover:text-copper-glow">
                ← Back to home
              </a>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
