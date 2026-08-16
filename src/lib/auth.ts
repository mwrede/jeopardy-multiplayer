'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Profile = { user_id: string; display_name: string }

/**
 * Google is the only way in. Email/password was a second identity to remember
 * for an app that otherwise needs no account at all — signing in exists here
 * only so your boards follow you between devices.
 *
 * Requires the Google provider to be enabled in Supabase
 * (Authentication → Providers → Google) with a Google Cloud OAuth client.
 */
export async function signInWithGoogle(next?: string) {
  const redirectTo =
    typeof window !== 'undefined'
      ? `${window.location.origin}${next && next.startsWith('/') ? next : '/'}`
      : undefined

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error) throw error
}

/** Wipe Supabase's stored session directly. No network, cannot fail. */
function purgeLocalSession() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('sb-') || key.includes('supabase.auth')) localStorage.removeItem(key)
    }
    // App-side identity that shouldn't outlive the account.
    localStorage.removeItem('communitySeat')
  } catch {}
}

export async function signOut() {
  // Race the server call — a stale refresh token makes it hang rather than
  // error, and an awaited hang never reaches the fallbacks below. That's what
  // made the button do nothing.
  const attempt = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  try {
    await Promise.race([
      attempt(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('sign-out timed out')), 4000)),
    ])
  } catch (e) {
    console.warn('[signOut] server sign-out did not complete, clearing locally:', e)
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: 'local' }),
        new Promise((r) => setTimeout(r, 2000)),
      ])
    } catch {}
  }

  // Always, regardless of what happened above.
  purgeLocalSession()
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('user_id, display_name')
    .eq('user_id', userId)
    .maybeSingle()
  return (data as Profile | null) ?? null
}

export async function upsertProfile(userId: string, displayName: string) {
  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, display_name: displayName, updated_at: new Date().toISOString() })
  if (error) {
    // Non-fatal — the auth metadata still has the display name so the app
    // works even if the profiles row can't be written (RLS race on first
    // sign-in, missing table, etc.).
    console.warn('[upsertProfile] failed (non-fatal):', error.message)
  }
}

/**
 * Hook: current Supabase user + cached profile. Re-renders on auth changes.
 * `loading` is true while the initial session is being resolved.
 */
export function useUser() {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    // .catch is essential: without it a rejected getSession leaves `loading`
    // true forever, and the profile menu renders as a dead grey circle with no
    // way to sign in or out.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      const u = data.session?.user ?? null
      setUser(u)
      if (u) {
        getProfile(u.id).then((p) => {
          if (cancelled) return
          // If profile row is missing (e.g. created before profiles table), seed it from auth metadata.
          if (!p) {
            const meta = u.user_metadata ?? {}
            const name =
              (meta.display_name as string) ||
              (meta.full_name as string) ||
              (meta.name as string) ||
              u.email?.split('@')[0] ||
              'Player'
            upsertProfile(u.id, name).then(() => getProfile(u.id).then(setProfile)).catch(() => {})
          } else {
            setProfile(p)
          }
        })
      }
      setLoading(false)
    }).catch((e) => {
      console.warn('[useUser] getSession failed:', e)
      if (!cancelled) { setUser(null); setLoading(false) }
    })

    // The callback MUST stay synchronous and MUST NOT await other Supabase
    // calls. auth-js awaits subscriber callbacks while holding its session
    // lock, and every PostgREST query needs that same lock to attach the
    // access token — so an awaited query in here is a circular wait. The
    // lock never releases, and from then on EVERY database call in the tab
    // silently queues behind it forever, with no error.
    //
    // Verified against auth-js 2.99.1 (pinned in package-lock.json). The
    // events that await subscribers are TOKEN_REFRESHED and the recovery
    // SIGNED_IN, both emitted from _recoverAndRefresh inside the initialize
    // lock — so it fires on page load for any returning user whose access
    // token needs refreshing, and otherwise at the next hourly refresh or
    // tab refocus. INITIAL_SESSION and the OAuth-redirect SIGNED_IN are
    // emitted without await in this version and are safe.
    //
    // Signed-out users never enter that branch, which is why the app worked
    // logged out and failed only when signed in: dead profile circle,
    // sign-out hanging, community votes never saving, and "Opening a new
    // game timed out" (the first call whose timeout is actually surfaced —
    // the seat check and lobby list swallow theirs).
    //
    // setTimeout, not queueMicrotask: a macrotask is guaranteed to run after
    // the lock's microtask drain releases it.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null
      setUser(u)
      setLoading(false)
      if (u) {
        setTimeout(() => {
          getProfile(u.id).then((p) => { if (!cancelled) setProfile(p) }).catch(() => {})
        }, 0)
      } else {
        setProfile(null)
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return { user, profile, loading }
}
