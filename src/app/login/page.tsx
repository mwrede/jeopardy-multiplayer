'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { signIn, signUp } from '@/lib/auth'

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-jeopardy-dark" />}>
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
    <main className="min-h-screen bg-jeopardy-dark flex flex-col items-center justify-center p-6">
      <img src="/jeopardy-logo.png" alt="JEOPARDY!" className="h-28 md:h-36 w-auto mb-8" />

      <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-2xl p-6">
        <div className="flex gap-2 mb-6 bg-white/5 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => { setMode('signin'); setError(''); setInfo('') }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              mode === 'signin' ? 'bg-jeopardy-blue text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => { setMode('signup'); setError(''); setInfo('') }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              mode === 'signup' ? 'bg-jeopardy-blue text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && (
            <input
              type="text"
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={30}
              required
              className="input-base text-base w-full"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete={mode === 'signin' ? 'email' : 'email'}
            className="input-base text-base w-full"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            className="input-base text-base w-full"
          />
          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full py-3 text-base disabled:opacity-50"
          >
            {busy ? '...' : (mode === 'signin' ? 'Sign in' : 'Create account')}
          </button>
        </form>

        {error && <p className="text-red-400 text-sm text-center mt-3">{error}</p>}
        {info && <p className="text-green-400 text-sm text-center mt-3">{info}</p>}

        <p className="text-gray-500 text-xs text-center mt-6">
          You can play games and join parties without an account — accounts unlock
          saving custom boards and tracking your stats.
        </p>
        <a href="/" className="block text-center text-gray-400 hover:text-white text-sm mt-3">
          ← Back to home
        </a>
      </div>
    </main>
  )
}
