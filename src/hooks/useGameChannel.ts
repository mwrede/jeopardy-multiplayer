'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { Game, Player, Category, Clue } from '@/types/game'

interface GameState {
  game: Game | null
  players: Player[]
  categories: Category[]
  clues: Clue[]
  myPlayerId: string | null
}

/**
 * Full game state snapshot broadcast to all clients.
 * This is the SINGLE source of truth for UI updates.
 * After any mutation, the acting client fetches state and broadcasts this.
 */
interface FullSync {
  type: 'full_sync'
  game: Game
  players: Player[]
  categories: Category[]
  clues: Clue[]
}

/**
 * Fetch the full game state from Supabase by game ID.
 */
async function fetchFullState(gameId: string) {
  const [gameRes, playersRes, categoriesRes, catIdsRes] = await Promise.all([
    supabase.from('games').select('*').eq('id', gameId).single(),
    supabase.from('players').select('*').eq('game_id', gameId).order('join_order'),
    supabase.from('categories').select('*').eq('game_id', gameId).order('position'),
    supabase.from('categories').select('id').eq('game_id', gameId),
  ])

  const catIds = catIdsRes.data?.map((c) => c.id) || []
  let cluesData: Clue[] = []
  if (catIds.length > 0) {
    const { data } = await supabase
      .from('clues')
      .select('id, category_id, value, question, answer, is_daily_double, is_answered, answered_by')
      .in('category_id', catIds)
    cluesData = (data as Clue[]) || []
  }

  return {
    game: gameRes.data as Game,
    players: (playersRes.data as Player[]) || [],
    categories: (categoriesRes.data as Category[]) || [],
    clues: cluesData,
  }
}

export function useGameChannel(roomCode: string) {
  const [state, setState] = useState<GameState>({
    game: null,
    players: [],
    categories: [],
    clues: [],
    myPlayerId: null,
  })
  const [connected, setConnected] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const gameIdRef = useRef<string | null>(null)

  // Load initial state + find the game ID from room code
  useEffect(() => {
    const playerId = localStorage.getItem('playerId')
    setState((s) => ({ ...s, myPlayerId: playerId }))

    async function loadState() {
      // Find game by room code
      const { data: game } = await supabase
        .from('games')
        .select('*')
        .eq('room_code', roomCode)
        .single()

      if (!game) return

      gameIdRef.current = game.id

      const fullState = await fetchFullState(game.id)
      setState((s) => ({
        ...s,
        ...fullState,
      }))
    }

    loadState()
  }, [roomCode])

  // Subscribe to the broadcast channel
  useEffect(() => {
    if (!state.game?.id) return

    const gameId = state.game.id

    const channel = supabase.channel(`game:${gameId}`, {
      config: { broadcast: { self: true } },
    })

    // PRIMARY: Listen for full_sync broadcasts — this is how ALL clients stay in sync
    channel.on('broadcast', { event: 'full_sync' }, ({ payload }) => {
      const sync = payload as FullSync
      setState((s) => ({
        ...s,
        game: sync.game,
        players: sync.players,
        categories: sync.categories,
        clues: sync.clues,
      }))
    })

    channel.subscribe((status) => {
      setConnected(status === 'SUBSCRIBED')
    })

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
    }
  }, [state.game?.id])

  /**
   * Fetch latest state from DB and broadcast to ALL clients.
   * Call this after any game mutation (ready up, start game, select clue, buzz, answer, etc.)
   */
  const syncAndBroadcast = useCallback(async () => {
    const gameId = gameIdRef.current
    if (!gameId || !channelRef.current) return

    const fullState = await fetchFullState(gameId)

    // Broadcast to everyone (including self, since self: true is set)
    channelRef.current.send({
      type: 'broadcast',
      event: 'full_sync',
      payload: {
        type: 'full_sync',
        game: fullState.game,
        players: fullState.players,
        categories: fullState.categories,
        clues: fullState.clues,
      } satisfies FullSync,
    })
  }, [])

  const myPlayer = state.players.find((p) => p.id === state.myPlayerId) || null
  const isMyTurn = state.game?.current_player_id === state.myPlayerId

  return {
    ...state,
    myPlayer,
    isMyTurn,
    connected,
    syncAndBroadcast,
  }
}
