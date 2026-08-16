/**
 * Community Play — drop-in games with strangers.
 *
 * Three players to a game; it starts the moment the third joins, so nobody
 * waits on a host.
 *
 * Lobbies are made on demand rather than kept open in a pool. Holding five
 * empty rooms sounds tidier but goes wrong quickly: every visitor would have
 * to top the pool up, so ten simultaneous visitors each creating five leaves
 * fifty rooms, and nothing ever cleans up the ones no one joined. Creating a
 * lobby only when someone actually needs a seat means the list only ever shows
 * real people waiting, and there's nothing to reap.
 *
 * Lobbies are ordinary games flagged with settings.community, so a private
 * game can never surface here.
 *
 * Signing in is optional. An account carries your record between devices and
 * puts you on the leaderboard; a guest plays exactly the same game, identified
 * only by the player id kept in their own browser. Guests can't be ranked —
 * there'd be no way to tell two of them apart across games — so the standings
 * simply skip them.
 */

import { supabase } from './supabase'
import { joinGame } from './game-api'
import { DEFAULT_CASUAL_SETTINGS } from '@/types/game'

export const LOBBY_SEATS = 3

/**
 * A hung Supabase call leaves the UI spinning with nothing to show for it —
 * no result, no error. Everything here races a timeout so a stall surfaces as
 * a message instead of a button stuck on "Finding a game…".
 */
const TIMEOUT_MS = 8_000

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out. Check your connection and try again.`)), TIMEOUT_MS),
    ),
  ])
}

/**
 * Ignore lobbies untouched for this long — the people in them are long gone.
 * Staleness is measured on updated_at, not created_at: the waiting page
 * heartbeats the row (touchLobby), so a lobby with someone actually sitting in
 * it stays listed no matter how long they've waited, while an abandoned one
 * ages out.
 */
const STALE_MINUTES = 45

function staleCutoff(): string {
  return new Date(Date.now() - STALE_MINUTES * 60_000).toISOString()
}

export type CommunityLobby = {
  id: string
  roomCode: string
  playerCount: number
  createdAt: string
}

export type Seat = { roomCode: string; playerId: string; gameId: string }

/** Where a guest is sitting. The browser is the only record of it. */
const GUEST_SEAT_KEY = 'communitySeat'

function readGuestSeat(): { roomCode: string; playerId: string } | null {
  try {
    const raw = localStorage.getItem(GUEST_SEAT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.roomCode === 'string' && typeof parsed?.playerId === 'string') return parsed
  } catch {}
  return null
}

export function rememberGuestSeat(seat: { roomCode: string; playerId: string } | null) {
  try {
    if (seat) localStorage.setItem(GUEST_SEAT_KEY, JSON.stringify(seat))
    else localStorage.removeItem(GUEST_SEAT_KEY)
  } catch {}
}

/**
 * The seat a guest left in their browser, but only if it's still real —
 * verified against the database the same way an account's seat is. A
 * remembered seat in a finished, stale, or vanished game is forgotten rather
 * than returned, so a guest can never be trapped at a dead table.
 */
async function resolveGuestSeat(): Promise<Seat | null> {
  const saved = readGuestSeat()
  if (!saved) return null

  const { data: game } = await supabase
    .from('games')
    .select('id, status, phase, settings, created_at, updated_at')
    .eq('room_code', saved.roomCode)
    .maybeSingle()

  const settings = typeof (game as any)?.settings === 'string'
    ? JSON.parse((game as any).settings)
    : (game as any)?.settings
  const lastTouch = Date.parse((game as any)?.updated_at ?? (game as any)?.created_at ?? '')

  const dead =
    !game ||
    settings?.community !== true ||
    (game as any).status === 'finished' ||
    (game as any).phase === 'game_over' ||
    (!isNaN(lastTouch) && lastTouch < Date.now() - STALE_MINUTES * 60_000)

  if (dead) {
    rememberGuestSeat(null)
    return null
  }

  // The row still has to exist — the seat may have been cleared when someone
  // else left and the table rewound.
  const { data: player } = await supabase
    .from('players')
    .select('id')
    .eq('id', saved.playerId)
    .eq('game_id', (game as any).id)
    .maybeSingle()

  if (!player) {
    rememberGuestSeat(null)
    return null
  }

  return { roomCode: saved.roomCode, playerId: saved.playerId, gameId: (game as any).id }
}

/**
 * Names are how three strangers tell each other apart, so two "mike"s in one
 * lobby get numbered. Only cosmetic — identity is the player id — but a
 * scoreboard with two identical rows is unreadable.
 */
async function uniqueNameInLobby(gameId: string, wanted: string): Promise<string> {
  const { data: taken } = await supabase
    .from('players')
    .select('name')
    .eq('game_id', gameId)

  const names = new Set((taken ?? []).map((p: any) => (p.name ?? '').trim().toLowerCase()))
  if (!names.has(wanted.trim().toLowerCase())) return wanted

  for (let n = 2; n < 20; n++) {
    const candidate = `${wanted} ${n}`
    if (!names.has(candidate.toLowerCase())) return candidate
  }
  return wanted
}

/**
 * Games with someone waiting, fullest first — a lobby needing one more player
 * should fill before an empty one.
 */
export async function listCommunityLobbies(): Promise<CommunityLobby[]> {
  const { data: games, error } = await supabase
    .from('games')
    .select('id, room_code, created_at, settings')
    .eq('status', 'lobby')
    .gte('updated_at', staleCutoff())
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) throw error

  const community = (games ?? []).filter((g: any) => (g.settings as any)?.community === true)
  if (community.length === 0) return []

  // One query for all the counts rather than one per lobby.
  const { data: players } = await supabase
    .from('players')
    .select('game_id')
    .in('game_id', community.map((g: any) => g.id))

  const counts = new Map<string, number>()
  for (const p of players ?? []) {
    counts.set((p as any).game_id, (counts.get((p as any).game_id) ?? 0) + 1)
  }

  return community
    .map((g: any) => ({
      id: g.id,
      roomCode: g.room_code,
      playerCount: counts.get(g.id) ?? 0,
      createdAt: g.created_at,
    }))
    .filter((l) => l.playerCount > 0 && l.playerCount < LOBBY_SEATS)
    .sort((a, b) => b.playerCount - a.playerCount)
}

/**
 * Open a fresh community lobby and return its room code.
 *
 * Generates the room code here and inserts without reading the row back. The
 * caller only needs the code, and `.select().single()` after an insert is an
 * extra round-trip that can fail on its own — it's what broke saving private
 * boards. Fewer moving parts on the one step that has to work.
 */
async function createCommunityLobby(): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let roomCode = ''
  for (let i = 0; i < 6; i++) roomCode += chars[Math.floor(Math.random() * chars.length)]

  const settings: any = {
    ...DEFAULT_CASUAL_SETTINGS,
    gameMode: 'multiplayer',
    gameLength: 'half',
    community: true,
  }

  const { error } = await supabase.from('games').insert({
    room_code: roomCode,
    status: 'lobby',
    current_round: 1,
    phase: 'lobby',
    settings,
    is_public: true,
  })
  if (error) throw error

  return roomCode
}

/**
 * Take a seat in a specific lobby. Returns whether this join filled it and
 * started the game.
 *
 * The seat check isn't atomic — two people can clear it in the same instant
 * and make a table of four. The cost is a roomier game rather than a broken
 * one; making it airtight would need a Postgres function like resolve_buzz.
 */
export async function joinCommunityLobby(
  roomCode: string,
  playerName: string,
  userId?: string | null,
): Promise<{ roomCode: string; started: boolean; playerId: string }> {
  // Guests are welcome. They just can't be ranked — see the note up top.
  const isGuest = !userId

  // Look the game up first so the name can be checked against the table it's
  // actually joining.
  const { data: lobby } = await supabase
    .from('games').select('id').eq('room_code', roomCode.toUpperCase()).maybeSingle()

  const name = lobby
    ? await uniqueNameInLobby((lobby as any).id, playerName)
    : playerName

  // Guests never reconnect by name: two strangers both called "mike" would
  // otherwise become one player, and the table could never fill.
  const { player, game } = await joinGame(roomCode, name, userId ?? undefined, {
    allowNameReconnect: false,
  })

  localStorage.setItem('playerId', player.id)
  localStorage.setItem('playerName', player.name)
  if (isGuest) rememberGuestSeat({ roomCode, playerId: player.id })

  // Taking a seat resets the lobby's staleness clock — it clearly isn't
  // abandoned if people are still arriving.
  await touchLobby(game.id)

  const { count } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', game.id)

  if ((count ?? 0) >= LOBBY_SEATS) {
    // Full: open the vote rather than starting. Three strangers should agree
    // on what they're playing before a board appears.
    await supabase
      .from('games')
      .update({ phase: 'game_voting', updated_at: new Date().toISOString() })
      .eq('id', game.id)
      .eq('phase', 'lobby')
    return { roomCode, started: true, playerId: player.id }
  }

  return { roomCode, started: false, playerId: player.id }
}

/**
 * Get up from a table, from the waiting page or mid-vote or mid-game.
 *
 * Three-handed is the format, so losing a player means the others can't carry
 * on — the game rewinds to waiting and everyone left keeps their seat while a
 * replacement is found. Votes are cleared so the next round starts clean.
 */
export async function leaveCommunityLobby(playerId: string, gameId?: string): Promise<void> {
  await supabase.from('players').delete().eq('id', playerId)
  // Standing up clears the browser's record of the seat too, or a guest would
  // keep being sent back to a table they just left.
  if (readGuestSeat()?.playerId === playerId) rememberGuestSeat(null)
  if (!gameId) return

  const { data: game } = await supabase
    .from('games').select('phase, status, settings').eq('id', gameId).maybeSingle()
  if (!game || (game.settings as any)?.community !== true) return
  // A finished game keeps its result — the leaderboard needs it.
  if (game.status === 'finished') return

  const { count } = await supabase
    .from('players').select('id', { count: 'exact', head: true }).eq('game_id', gameId)

  if ((count ?? 0) < LOBBY_SEATS) {
    // Clear votes so the next full table decides fresh, and drop any board
    // that was already dealt.
    await supabase
      .from('players')
      .update({ vote_size: null, vote_difficulty: null, vote_decade: null, score: 0 })
      .eq('game_id', gameId)

    await supabase
      .from('games')
      .update({
        phase: 'lobby',
        status: 'lobby',
        current_clue_id: null,
        current_player_id: null,
        buzz_window_open: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', gameId)
  }
}

/**
 * Keep a lobby's staleness clock wound while someone is actually sitting in
 * it. The waiting page calls this periodically; without it, a lobby someone
 * has patiently watched for 45 minutes would silently drop off the list.
 */
export async function touchLobby(gameId: string): Promise<void> {
  await supabase
    .from('games')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', gameId)
    .eq('status', 'lobby')
}

/**
 * Current state of one lobby — used to watch a seat fill in real time.
 *
 * Returns null ONLY when the game row genuinely doesn't exist; a failed query
 * throws instead. Callers rely on the difference — null means "this table is
 * gone, stand up", while an error is a network blip to ride out.
 */
export async function getLobbyState(roomCode: string): Promise<{
  gameId: string
  phase: string
  players: { id: string; name: string }[]
} | null> {
  const { data: game, error } = await supabase
    .from('games').select('id, phase').eq('room_code', roomCode).maybeSingle()
  if (error) throw error
  if (!game) return null

  const { data: players, error: playersError } = await supabase
    .from('players').select('id, name').eq('game_id', game.id).order('join_order')
  if (playersError) throw playersError

  return { gameId: game.id, phase: (game as any).phase, players: (players ?? []) as any }
}

/**
 * The community game this account is already sitting in, if any.
 *
 * Without this, "Play now" looks broken: joinGame correctly recognises you as
 * already present and reconnects you, so the seat count doesn't move and
 * nothing appears to happen. You can also end up listed in two games at once.
 * Checking first means the button returns you to your table instead.
 *
 * Seats in DEAD games are vacated here rather than returned. A lobby past the
 * staleness cutoff is invisible to everyone else (listCommunityLobbies hides
 * it), so a seat in one is a trap: "Play now" would forever return you to a
 * table nobody can ever join. Standing up and moving on is the only exit.
 */
export async function findMySeat(userId: string): Promise<{
  roomCode: string
  playerId: string
  gameId: string
} | null> {
  if (!userId) return null

  // Two plain queries, not an embedded join. players and games have TWO
  // foreign keys between them (players.game_id → games.id, and
  // games.current_player_id → players.id), so `games!inner(...)` is ambiguous
  // and PostgREST rejects it outright with PGRST201 — this lookup failed every
  // time it ran.
  const { data: rows, error } = await supabase
    .from('players')
    .select('id, game_id')
    .eq('user_id', userId)
    .limit(20)
  if (error || !rows?.length) return null

  const { data: games } = await supabase
    .from('games')
    .select('id, room_code, status, phase, settings, created_at, updated_at')
    .in('id', rows.map((r: any) => r.game_id))
  if (!games?.length) return null

  const cutoffMs = Date.now() - STALE_MINUTES * 60_000
  const byId = new Map(games.map((g: any) => [g.id, g]))
  for (const r of rows as any[]) {
    const g: any = byId.get(r.game_id)
    if (!g) continue
    const settings = typeof g.settings === 'string' ? JSON.parse(g.settings) : g.settings
    if (settings?.community !== true) continue
    if (g.status === 'finished' || g.phase === 'game_over') continue

    const lastTouch = Date.parse(g.updated_at ?? g.created_at ?? '')
    if (!isNaN(lastTouch) && lastTouch < cutoffMs) {
      // Dead table. Give up the seat so it stops holding this account hostage.
      await leaveCommunityLobby(r.id, r.game_id).catch((e) =>
        console.warn('[community] could not vacate stale seat:', e),
      )
      continue
    }

    return { roomCode: g.room_code, playerId: r.id, gameId: r.game_id }
  }
  return null
}

/** Get up from every community table this account is sitting at. */
export async function leaveAllSeats(userId: string): Promise<void> {
  const seat = await findMySeat(userId)
  if (seat) await leaveCommunityLobby(seat.playerId, seat.gameId)
}

/**
 * Where you're currently sitting, however you're identified: by account if
 * you're signed in, by what your browser remembers if you're a guest. Either
 * way the answer is checked against the database, and a seat at a dead table
 * is given up rather than returned.
 */
export async function findAnySeat(userId?: string | null): Promise<Seat | null> {
  return userId ? findMySeat(userId) : resolveGuestSeat()
}

/**
 * One button: sit down wherever there's room, opening a lobby only if every
 * existing one is full or stale. Tries the fullest first so games start soon.
 */
export async function findOrCreateGame(
  playerName: string,
  userId?: string | null,
): Promise<{ roomCode: string; started: boolean; playerId: string }> {
  return findOrCreateGameInner(playerName, userId)
}

async function findOrCreateGameInner(
  playerName: string,
  userId?: string | null,
): Promise<{ roomCode: string; started: boolean; playerId: string }> {
  // Already seated somewhere? Go back there. Joining a second table would
  // reconnect you to the first anyway, which is what made this look broken.
  const seat = await withTimeout(findAnySeat(userId), 'Checking your seat').catch((e) => {
    console.warn('[community] seat check failed:', e)
    return null
  })
  if (seat) {
    return { roomCode: seat.roomCode, started: false, playerId: seat.playerId }
  }

  const open = await withTimeout(listCommunityLobbies(), 'Listing games').catch((e) => {
    console.warn('[community] lobby list failed:', e)
    return [] as CommunityLobby[]
  })

  for (const lobby of open) {
    try {
      return await withTimeout(
        joinCommunityLobby(lobby.roomCode, playerName, userId),
        `Joining ${lobby.roomCode}`,
      )
    } catch (e) {
      // Someone took the last seat between listing and joining — try the next.
      console.warn('[community] lobby full, trying another:', e)
    }
  }

  const roomCode = await withTimeout(createCommunityLobby(), 'Opening a new game')
  return withTimeout(joinCommunityLobby(roomCode, playerName, userId), 'Taking a seat')
}
