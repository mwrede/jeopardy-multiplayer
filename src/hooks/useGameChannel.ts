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
 * Fetch the complete game state from the DB.
 * This is the single source of truth.
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

/**
 * Core game state hook.
 *
 * Sync strategy (mirrors Jackbox's server-push model):
 * 1. DB is the source of truth (like Jackbox's central server)
 * 2. postgres_changes pushes DB updates to all subscribers automatically
 * 3. Polling every 2s as a fallback to catch anything missed
 * 4. Any client action = just write to DB, the push handles the rest
 */
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Full refresh from DB
  const refreshState = useCallback(async () => {
    const gameId = gameIdRef.current
    if (!gameId) return

    const fullState = await fetchFullState(gameId)
    setState((s) => ({
      ...s,
      ...fullState,
    }))
  }, [])

  // 1. Initial load: find the game by room code
  useEffect(() => {
    const playerId = localStorage.getItem('playerId')
    setState((s) => ({ ...s, myPlayerId: playerId }))

    async function loadState() {
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

  // 2. Subscribe to postgres_changes (server-push, like Jackbox's WebSocket)
  useEffect(() => {
    if (!state.game?.id) return

    const gameId = state.game.id

    const channel = supabase.channel(`game:${gameId}`)

    // Game row changes → refresh game state
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'games',
        filter: `id=eq.${gameId}`,
      },
      (payload) => {
        setState((s) => ({
          ...s,
          game: s.game ? { ...s.game, ...payload.new } : null,
        }))
      }
    )

    // Player changes (join, ready up, score updates)
    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'players',
        filter: `game_id=eq.${gameId}`,
      },
      (payload) => {
        setState((s) => ({
          ...s,
          players: [...s.players.filter((p) => p.id !== (payload.new as Player).id), payload.new as Player],
        }))
      }
    )

    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'players',
        filter: `game_id=eq.${gameId}`,
      },
      (payload) => {
        setState((s) => ({
          ...s,
          players: s.players.map((p) =>
            p.id === (payload.new as Player).id ? { ...p, ...payload.new } : p
          ),
        }))
      }
    )

    // Clue changes (answered, etc.)
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'clues',
      },
      () => {
        // For clue changes, do a full refresh since we need to filter by game
        refreshState()
      }
    )

    channel.subscribe((status) => {
      setConnected(status === 'SUBSCRIBED')
    })

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
    }
  }, [state.game?.id, refreshState])

  // 3. Polling fallback: refresh every 2 seconds to catch anything missed
  useEffect(() => {
    if (!state.game?.id) return

    pollRef.current = setInterval(() => {
      refreshState()
    }, 2000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [state.game?.id, refreshState])

  const myPlayer = state.players.find((p) => p.id === state.myPlayerId) || null
  const isMyTurn = state.game?.current_player_id === state.myPlayerId

  return {
    ...state,
    myPlayer,
    isMyTurn,
    connected,
    refreshState,
  }
}
