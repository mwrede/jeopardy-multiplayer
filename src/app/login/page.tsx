'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { signIn, signUp } from '@/lib/auth'

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="stage-page" />}>
      <LoginContent />
    </Suspense>
  )
}

function LoginContent() {
  const router = useRouter()
  const params = useSearchParams()
  const redirectTo = params.get('next') || '/'

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    try {
      if (mode === 'signup') {
        if (!displayName.trim()) throw new Error('Pick a display name')
        const result = await signUp(email.trim(), password, displayName.trim())
        if (result.session) {
          router.push(redirectTo)
        } else {
          setInfo('Check your email to confirm your account, then sign in.')
          setMode('signin')
        }
      } else {
        await signIn(email.trim(), password)
        router.push(redirectTo)
      }
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="stage-page flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="plate">
          <div className="plate-surface p-8 md:p-10 text-center">
            <div className="text-copper uppercase text-[11px] tracking-[0.36em] mb-3" style={{ fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: '0 0 8px rgba(255,155,68,0.5)' }}>
              ▸ Account ◂
            </div>
            <h2 className="display-chrome text-4xl md:text-[42px] leading-none">
              {mode === 'signin' ? 'Welcome Back' : 'Create Account'}
            </h2>
            <p className="mt-3 text-ink-stage text-sm max-w-[34ch] mx-auto">
              Signing in saves your custom boards and stats. You can play without an account.
            </p>

            <div className="mt-6 grid grid-cols-2 p-1 rounded-md border border-white/20 bg-black/40 mb-6">
              <button
                type="button"
                onClick={() => { setMode('signin'); setError(''); setInfo('') }}
                className={`h-10 rounded uppercase tracking-[0.2em] text-xs cursor-pointer transition-all ${
                  mode === 'signin' ? 'text-[#2B0D00]' : 'text-ink-stage-2 hover:text-ink-stage'
                }`}
                style={{
                  fontFamily: 'Impact, "Arial Black", sans-serif',
                  background: mode === 'signin' ? 'linear-gradient(180deg, #FFC57A, #F58A2C)' : 'transparent',
                  boxShadow: mode === 'signin' ? '0 0 12px rgba(255,155,68,0.5)' : 'none',
                  textShadow: mode === 'signin' ? '0 1px 0 rgba(255,255,255,0.4)' : 'none',
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => { setMode('signup'); setError(''); setInfo('') }}
                className={`h-10 rounded uppercase tracking-[0.2em] text-xs cursor-pointer transition-all ${
                  mode === 'signup' ? 'text-[#2B0D00]' : 'text-ink-stage-2 hover:text-ink-stage'
                }`}
                style={{
                  fontFamily: 'Impact, "Arial Black", sans-serif',
                  background: mode === 'signup' ? 'linear-gradient(180deg, #FFC57A, #F58A2C)' : 'transparent',
                  boxShadow: mode === 'signup' ? '0 0 12px rgba(255,155,68,0.5)' : 'none',
                  textShadow: mode === 'signup' ? '0 1px 0 rgba(255,255,255,0.4)' : 'none',
                }}
              >
                Create account
              </button>
            </div>

            <form onSubmit={handleSubmit} className="text-left space-y-3.5">
              {mode === 'signup' && (
                <div>
                  <label className="block mb-1.5 text-copper uppercase text-[10px] tracking-[0.22em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                    Display name
                  </label>
                  <input
                    type="text"
                    placeholder="Sean"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={30}
                    required
                    className="field-stage"
                  />
                </div>
              )}
              <div>
                <label className="block mb-1.5 text-copper uppercase text-[10px] tracking-[0.22em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                  Email
                </label>
                <input
                  type="email"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="field-stage"
                />
              </div>
              <div>
                <label className="block mb-1.5 text-copper uppercase text-[10px] tracking-[0.22em]" style={{ fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                  Password
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  className="field-stage"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="btn-stage btn-copper btn-stage-lg w-full mt-2"
              >
                {busy ? '…' : (mode === 'signin' ? 'Sign In' : 'Create Account')}
              </button>
            </form>

            {error && <p className="text-copper-glow text-sm text-center mt-4">{error}</p>}
            {info && <p className="text-copper text-sm text-center mt-4">{info}</p>}

            <div className="mt-6 pt-5 border-t border-white/10 text-ink-stage-2 text-sm">
              You can play without an account.<br />
              <a href="/" className="text-copper hover:text-copper-glow underline underline-offset-4">
                ← Back to home
              </a>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
