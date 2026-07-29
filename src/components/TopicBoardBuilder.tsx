'use client'

import { useState } from 'react'
import { MIXABLE_THEMES, THEME_STYLES } from './mashup-themes'
import { MAX_TOPICS, type BoardTopic } from '@/lib/topic-board'
import { GAME_LENGTH_CONFIG, type GameLength } from '@/types/game'

export type PlayMode = 'party' | 'multiplayer'

/**
 * Board sizes, keyed to the real GameLength union. Do NOT hand-write these
 * strings elsewhere — an invalid key makes GAME_LENGTH_CONFIG[key] undefined
 * and crashes the render.
 */
const SIZES: { key: GameLength; label: string }[] = [
  { key: 'rapid', label: 'Rapid' },
  { key: 'half', label: 'Half' },
  { key: 'full', label: 'Full' },
]

/**
 * Build-your-own board. The user picks any mix of curated themes and typed
 * headers (up to MAX_TOPICS total); the board splits its category slots as
 * evenly as possible across whatever they chose.
 *
 * Curated themes pull from the pre-tagged category_type column. Typed headers
 * search the category name, the clue text, AND the answer — so a header like
 * "mechanical engineering" pulls in any clue that mentions it, even though no
 * J-Archive category carries that name.
 */
export function TopicBoardBuilder({
  onPlay,
  creating,
  error,
}: {
  onPlay: (topics: BoardTopic[], mode: PlayMode, size: GameLength) => void
  creating?: boolean
  error?: string | null
}) {
  const [themes, setThemes] = useState<Set<string>>(new Set())
  const [custom, setCustom] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [size, setSize] = useState<GameLength>('full')

  const total = themes.size + custom.length
  const atCap = total >= MAX_TOPICS

  const topics: BoardTopic[] = [
    ...MIXABLE_THEMES.filter((t) => themes.has(t.theme!)).map((t) => ({
      kind: 'theme' as const,
      value: t.theme!,
      label: t.label.replace(/ Mashup$/, ''),
    })),
    ...custom.map((c) => ({ kind: 'term' as const, value: c, label: c })),
  ]

  function addCustom() {
    const v = draft.trim()
    if (!v || atCap) return
    if (custom.some((c) => c.toLowerCase() === v.toLowerCase())) { setDraft(''); return }
    setCustom((prev) => [...prev, v])
    setDraft('')
  }

  const slotsPerRound = GAME_LENGTH_CONFIG[size].categories
  const perTopic = topics.length > 0 ? Math.floor(slotsPerRound / topics.length) : 0

  return (
    <div className="rounded-2xl border-2 p-5 md:p-6" style={THEME_STYLES.mix.cardStyle}>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="text-white font-bold text-xl">Build Your Board</h3>
        <span className={`text-xs font-bold ${atCap ? 'text-jeopardy-gold' : 'text-gray-400'}`}>
          {total}/{MAX_TOPICS}
        </span>
      </div>
      <p className="text-gray-300 text-sm mb-5">
        Pick categories or type your own. The board splits evenly across everything you choose.
      </p>

      {/* Curated themes */}
      <p className="text-gray-400 text-[11px] uppercase tracking-[0.2em] font-bold mb-2">
        Popular categories
      </p>
      <div className="flex flex-wrap gap-2 mb-5">
        {MIXABLE_THEMES.map((t) => {
          const key = t.theme!
          const active = themes.has(key)
          const style = THEME_STYLES[key] ?? THEME_STYLES.mix
          const disabled = !active && atCap
          return (
            <button
              key={key}
              disabled={disabled}
              onClick={() => {
                setThemes((prev) => {
                  const next = new Set(prev)
                  if (next.has(key)) next.delete(key)
                  else next.add(key)
                  return next
                })
              }}
              className={`px-3 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                active ? 'text-white scale-[1.03]' : 'text-gray-300 hover:text-white'
              } ${disabled ? 'opacity-35 cursor-not-allowed' : ''}`}
              style={active ? style.cardSelectedStyle : style.cardStyle}
            >
              <span className="mr-1.5">{style.icons[0]}</span>
              {t.label.replace(/ Mashup$/, '')}
            </button>
          )
        })}
      </div>

      {/* Custom headers */}
      <p className="text-gray-400 text-[11px] uppercase tracking-[0.2em] font-bold mb-2">
        Your own categories
      </p>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
          placeholder={atCap ? 'Category limit reached' : 'e.g. mechanical engineering, the Beatles'}
          disabled={atCap}
          maxLength={40}
          className="input-base flex-1 text-sm disabled:opacity-40"
        />
        <button
          onClick={addCustom}
          disabled={!draft.trim() || atCap}
          className="btn-secondary px-5 text-sm disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <p className="text-gray-500 text-xs mb-3">
        Typed categories pull any clue mentioning the term — in the category name, the clue, or the answer.
      </p>

      {custom.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {custom.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold border-2 text-white"
              style={THEME_STYLES.topic.cardSelectedStyle}
            >
              🔍 {c}
              <button
                onClick={() => setCustom((prev) => prev.filter((x) => x !== c))}
                className="text-white/60 hover:text-white text-base leading-none"
                aria-label={`Remove ${c}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Board size */}
      <p className="text-gray-400 text-[11px] uppercase tracking-[0.2em] font-bold mb-2">
        Board size
      </p>
      <div className="flex gap-2 mb-5">
        {SIZES.map(({ key, label }) => {
          const cfg = GAME_LENGTH_CONFIG[key]
          return (
            <button
              key={key}
              onClick={() => setSize(key)}
              className={`flex-1 px-3 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                size === key
                  ? 'bg-jeopardy-gold/25 border-jeopardy-gold text-white'
                  : 'bg-white/5 border-white/15 text-gray-400 hover:text-white'
              }`}
            >
              <span>{label}</span>
              <span className="block text-[10px] opacity-70">
                {cfg.categories}×{cfg.cluesPerCat}
              </span>
            </button>
          )
        })}
      </div>

      {/* Split preview */}
      {topics.length > 0 && (
        <p className="text-jeopardy-gold-light text-xs mb-4">
          {topics.length >= slotsPerRound
            ? `${slotsPerRound} categories per round — your ${topics.length} topics spread across both rounds.`
            : `About ${perTopic} column${perTopic === 1 ? '' : 's'} each per round.`}
        </p>
      )}

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => onPlay(topics, 'party', size)}
          disabled={topics.length === 0 || !!creating}
          className="btn-primary flex-1 py-3 disabled:opacity-40"
        >
          {creating ? 'Building…' : 'Play Party Mode'}
        </button>
        <button
          onClick={() => onPlay(topics, 'multiplayer', size)}
          disabled={topics.length === 0 || !!creating}
          className="btn-secondary flex-1 py-3 disabled:opacity-40"
        >
          Multiplayer
        </button>
      </div>
    </div>
  )
}
