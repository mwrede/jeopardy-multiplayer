/**
 * Your boards — the ones you made and the ones you saved.
 *
 * Kept in localStorage rather than a table because none of this app requires
 * an account: boards can be created signed-out, and a library that only worked
 * once you'd logged in would miss most of them. Signed-in users get their
 * authored boards from the database as well, and the two lists are merged.
 *
 * The trade-off is honest: this library is per-device. Sign in and your
 * authored boards follow you anywhere; boards you merely saved don't.
 */

import { supabase } from './supabase'
import type { BoardSummary } from './profile-api'

const KEY = 'boardLibrary'

export type LibraryBoard = BoardSummary & {
  /** True when this device authored it — only those can be edited. */
  mine: boolean
}

function readIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    const ids = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeIds(ids: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)) } catch {}
}

/** Add a board to this device's library. Idempotent. */
export function rememberBoard(id: string) {
  const ids = readIds()
  if (!ids.includes(id)) writeIds([id, ...ids])
}

export function forgetBoard(id: string) {
  writeIds(readIds().filter((x) => x !== id))
}

export function isRemembered(id: string): boolean {
  return readIds().includes(id)
}

/** Board ids this device authored, tracked separately so Edit can be gated. */
const AUTHORED_KEY = 'authoredBoards'

export function markAuthored(id: string) {
  try {
    const raw = localStorage.getItem(AUTHORED_KEY)
    const ids: string[] = raw ? JSON.parse(raw) : []
    if (!ids.includes(id)) localStorage.setItem(AUTHORED_KEY, JSON.stringify([id, ...ids]))
  } catch {}
  rememberBoard(id)
}

function readAuthored(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(AUTHORED_KEY)
    const ids = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) ? ids : []
  } catch {
    return []
  }
}

/**
 * Everything in the library: boards this device saved or authored, plus the
 * signed-in user's authored boards from the database. Rows that no longer
 * exist are pruned from local storage on the way through, so a deleted board
 * stops haunting the list.
 */
export async function getLibrary(userId?: string): Promise<LibraryBoard[]> {
  const localIds = readIds()
  const authored = new Set(readAuthored())

  const [localRes, mineRes] = await Promise.all([
    localIds.length
      ? supabase.from('custom_boards')
          .select('id, title, is_public, created_at, creator_user_id')
          .in('id', localIds)
      : Promise.resolve({ data: [], error: null } as any),
    userId
      ? supabase.from('custom_boards')
          .select('id, title, is_public, created_at, creator_user_id')
          .eq('creator_user_id', userId)
      : Promise.resolve({ data: [], error: null } as any),
  ])

  const found = new Map<string, any>()
  for (const row of (localRes.data ?? []) as any[]) found.set(row.id, row)
  for (const row of (mineRes.data ?? []) as any[]) found.set(row.id, row)

  // Anything saved locally that no longer exists has been deleted — drop it.
  const missing = localIds.filter((id) => !found.has(id))
  if (missing.length) writeIds(localIds.filter((id) => !missing.includes(id)))

  return [...found.values()]
    .map((row) => ({
      id: row.id,
      title: row.title,
      is_public: row.is_public,
      created_at: row.created_at,
      mine: authored.has(row.id) || (!!userId && row.creator_user_id === userId),
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}
