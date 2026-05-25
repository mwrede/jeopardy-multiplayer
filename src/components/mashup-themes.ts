/**
 * Mashup themes + per-theme styling for the GameBrowser tiles.
 *
 * Each theme has:
 *  - icons: 3 emoji floated in the top-right corner of the tile
 *  - cardStyle: gradient + border for the default state
 *  - cardSelectedStyle: same but more saturated when the card is selected
 *  - accentClass: tailwind text class for the "Mashup" label
 *  - playBtnClass: tailwind class for the Party play button
 *  - multiplayerBtnClass: tailwind class for the Multiplayer play button
 */

import type { CSSProperties } from 'react'

export type Mashup = {
  id: string
  label: string
  description: string
  /** category_type value passed to startGame. Omitted = random (any clue). */
  theme?: string
}

export type ThemeStyle = {
  icons: string[]
  cardStyle: CSSProperties
  cardSelectedStyle: CSSProperties
  accentClass: string
  playBtnClass: string
  multiplayerBtnClass: string
}

const gradient = (from: string, to: string, deg = 135) =>
  `linear-gradient(${deg}deg, ${from}, ${to})`

export const THEME_STYLES: Record<string, ThemeStyle> = {
  random: {
    icons: ['🎲', '🎯', '✨'],
    cardStyle: {
      background: gradient('rgba(139,92,246,0.15)', 'rgba(34,211,238,0.15)'),
      borderColor: 'rgba(139,92,246,0.45)',
    },
    cardSelectedStyle: {
      background: gradient('rgba(139,92,246,0.32)', 'rgba(34,211,238,0.32)'),
      borderColor: 'rgba(167,139,250,0.9)',
    },
    accentClass: 'text-violet-300',
    playBtnClass: 'bg-violet-500 hover:bg-violet-400 text-white',
    multiplayerBtnClass: 'bg-cyan-500 hover:bg-cyan-400 text-black',
  },
  geography: {
    icons: ['🌍', '🗺️', '🧭'],
    cardStyle: {
      background: gradient('rgba(16,185,129,0.15)', 'rgba(14,165,233,0.15)'),
      borderColor: 'rgba(16,185,129,0.45)',
    },
    cardSelectedStyle: {
      background: gradient('rgba(16,185,129,0.32)', 'rgba(14,165,233,0.32)'),
      borderColor: 'rgba(52,211,153,0.9)',
    },
    accentClass: 'text-emerald-300',
    playBtnClass: 'bg-emerald-500 hover:bg-emerald-400 text-black',
    multiplayerBtnClass: 'bg-sky-500 hover:bg-sky-400 text-black',
  },
  history: {
    icons: ['📜', '🏛️', '⏳'],
    cardStyle: {
      background: gradient('rgba(180,83,9,0.18)', 'rgba(120,53,15,0.20)'),
      borderColor: 'rgba(217,119,6,0.5)',
    },
    cardSelectedStyle: {
      background: gradient('rgba(180,83,9,0.35)', 'rgba(120,53,15,0.4)'),
      borderColor: 'rgba(251,191,36,0.9)',
    },
    accentClass: 'text-amber-300',
    playBtnClass: 'bg-amber-500 hover:bg-amber-400 text-black',
    multiplayerBtnClass: 'bg-orange-700 hover:bg-orange-600 text-white',
  },
  science: {
    icons: ['🔬', '🧪', '🚀'],
    cardStyle: {
      background: gradient('rgba(6,182,212,0.15)', 'rgba(124,58,237,0.15)'),
      borderColor: 'rgba(6,182,212,0.45)',
    },
    cardSelectedStyle: {
      background: gradient('rgba(6,182,212,0.32)', 'rgba(124,58,237,0.32)'),
      borderColor: 'rgba(34,211,238,0.9)',
    },
    accentClass: 'text-cyan-300',
    playBtnClass: 'bg-cyan-500 hover:bg-cyan-400 text-black',
    multiplayerBtnClass: 'bg-violet-600 hover:bg-violet-500 text-white',
  },
  sports: {
    icons: ['⚽', '🏆', '🏀'],
    cardStyle: {
      background: gradient('rgba(234,88,12,0.18)', 'rgba(202,138,4,0.18)'),
      borderColor: 'rgba(234,88,12,0.5)',
    },
    cardSelectedStyle: {
      background: gradient('rgba(234,88,12,0.35)', 'rgba(202,138,4,0.35)'),
      borderColor: 'rgba(251,146,60,0.9)',
    },
    accentClass: 'text-orange-300',
    playBtnClass: 'bg-orange-500 hover:bg-orange-400 text-black',
    multiplayerBtnClass: 'bg-yellow-500 hover:bg-yellow-400 text-black',
  },
  pop_culture: {
    icons: ['🎬', '🎤', '📺'],
    cardStyle: {
      background: gradient('rgba(236,72,153,0.18)', 'rgba(168,85,247,0.18)'),
      borderColor: 'rgba(236,72,153,0.5)',
    },
    cardSelectedStyle: {
      background: gradient('rgba(236,72,153,0.35)', 'rgba(168,85,247,0.35)'),
      borderColor: 'rgba(244,114,182,0.9)',
    },
    accentClass: 'text-pink-300',
    playBtnClass: 'bg-pink-500 hover:bg-pink-400 text-white',
    multiplayerBtnClass: 'bg-purple-600 hover:bg-purple-500 text-white',
  },
  food: {
    icons: ['🍕', '🍷', '🍳'],
    cardStyle: {
      background: gradient('rgba(234,88,12,0.18)', 'rgba(220,38,38,0.18)'),
      borderColor: 'rgba(234,88,12,0.5)',
    },
    cardSelectedStyle: {
      background: gradient('rgba(234,88,12,0.35)', 'rgba(220,38,38,0.35)'),
      borderColor: 'rgba(251,146,60,0.9)',
    },
    accentClass: 'text-orange-300',
    playBtnClass: 'bg-rose-500 hover:bg-rose-400 text-white',
    multiplayerBtnClass: 'bg-orange-600 hover:bg-orange-500 text-white',
  },
  literature: {
    icons: ['📚', '✒️', '🪶'],
    cardStyle: {
      background: gradient('rgba(71,85,105,0.20)', 'rgba(13,148,136,0.18)'),
      borderColor: 'rgba(148,163,184,0.5)',
    },
    cardSelectedStyle: {
      background: gradient('rgba(71,85,105,0.35)', 'rgba(13,148,136,0.35)'),
      borderColor: 'rgba(203,213,225,0.9)',
    },
    accentClass: 'text-slate-200',
    playBtnClass: 'bg-slate-300 hover:bg-slate-200 text-black',
    multiplayerBtnClass: 'bg-teal-600 hover:bg-teal-500 text-white',
  },
  music: {
    icons: ['🎵', '🎸', '🎹'],
    cardStyle: {
      background: gradient('rgba(236,72,153,0.18)', 'rgba(79,70,229,0.18)'),
      borderColor: 'rgba(236,72,153,0.5)',
    },
    cardSelectedStyle: {
      background: gradient('rgba(236,72,153,0.35)', 'rgba(79,70,229,0.35)'),
      borderColor: 'rgba(244,114,182,0.9)',
    },
    accentClass: 'text-pink-300',
    playBtnClass: 'bg-pink-500 hover:bg-pink-400 text-white',
    multiplayerBtnClass: 'bg-indigo-600 hover:bg-indigo-500 text-white',
  },
  corporate: {
    icons: ['💼', '📊', '🏢'],
    cardStyle: {
      background: gradient('rgba(71,85,105,0.20)', 'rgba(37,99,235,0.15)'),
      borderColor: 'rgba(148,163,184,0.5)',
    },
    cardSelectedStyle: {
      background: gradient('rgba(71,85,105,0.35)', 'rgba(37,99,235,0.3)'),
      borderColor: 'rgba(203,213,225,0.9)',
    },
    accentClass: 'text-slate-200',
    playBtnClass: 'bg-slate-300 hover:bg-slate-200 text-black',
    multiplayerBtnClass: 'bg-blue-600 hover:bg-blue-500 text-white',
  },
  politics: {
    icons: ['🏛️', '🗳️', '🦅'],
    cardStyle: {
      background: gradient('rgba(220,38,38,0.20)', 'rgba(37,99,235,0.22)', 110),
      borderColor: 'rgba(255,255,255,0.35)',
    },
    cardSelectedStyle: {
      background: gradient('rgba(220,38,38,0.42)', 'rgba(37,99,235,0.45)', 110),
      borderColor: 'rgba(255,255,255,0.85)',
    },
    accentClass: 'text-white',
    playBtnClass: 'bg-red-600 hover:bg-red-500 text-white',
    multiplayerBtnClass: 'bg-blue-600 hover:bg-blue-500 text-white',
  },
  // Free-text topic search — orange/yellow so it reads as "search/find".
  topic: {
    icons: ['🔍', '✨', '💡'],
    cardStyle: {
      background: gradient('rgba(234,179,8,0.18)', 'rgba(234,88,12,0.18)'),
      borderColor: 'rgba(250,204,21,0.5)',
    },
    cardSelectedStyle: {
      background: gradient('rgba(234,179,8,0.35)', 'rgba(234,88,12,0.35)'),
      borderColor: 'rgba(253,224,71,0.9)',
    },
    accentClass: 'text-yellow-300',
    playBtnClass: 'bg-yellow-400 hover:bg-yellow-300 text-black',
    multiplayerBtnClass: 'bg-orange-600 hover:bg-orange-500 text-white',
  },
  // Custom multi-theme mix — rainbow gradient so it stands out.
  mix: {
    icons: ['🎨', '✨', '🔀'],
    cardStyle: {
      background:
        'linear-gradient(135deg, rgba(220,38,38,0.18), rgba(234,179,8,0.18), rgba(34,197,94,0.18), rgba(59,130,246,0.18), rgba(168,85,247,0.18))',
      borderColor: 'rgba(255,255,255,0.45)',
    },
    cardSelectedStyle: {
      background:
        'linear-gradient(135deg, rgba(220,38,38,0.4), rgba(234,179,8,0.4), rgba(34,197,94,0.4), rgba(59,130,246,0.4), rgba(168,85,247,0.4))',
      borderColor: 'rgba(255,255,255,0.9)',
    },
    accentClass: 'text-white',
    playBtnClass: 'bg-white hover:bg-gray-100 text-jeopardy-dark',
    multiplayerBtnClass: 'bg-jeopardy-dark hover:bg-black text-white border border-white/40',
  },
}

export const MASHUPS: Mashup[] = [
  { id: 'random', label: 'Random Mashup', description: '6 random categories from the full clue pool' },
  { id: 'geography', label: 'Geography Mashup', description: 'Continents, capitals, rivers, mountains', theme: 'geography' },
  { id: 'history', label: 'History Mashup', description: 'Wars, dynasties, revolutions, ancient empires', theme: 'history' },
  { id: 'science', label: 'Science Mashup', description: 'Chemistry, biology, physics, the cosmos', theme: 'science' },
  { id: 'sports', label: 'Sports Mashup', description: 'Football, basketball, baseball, olympics', theme: 'sports' },
  { id: 'pop_culture', label: 'Pop Culture Mashup', description: 'TV, movies, celebrities, awards shows', theme: 'pop_culture' },
  { id: 'food', label: 'Food & Drink Mashup', description: 'Cuisine, cocktails, chefs, restaurants', theme: 'food' },
  { id: 'literature', label: 'Literature Mashup', description: 'Novels, poets, playwrights, classics', theme: 'literature' },
  { id: 'music', label: 'Music Mashup', description: 'Rock, jazz, classical, hip hop', theme: 'music' },
  { id: 'corporate', label: 'Corporate Mashup', description: 'Brands, CEOs, business, finance', theme: 'corporate' },
  { id: 'politics', label: 'Politics Mashup', description: 'Presidents, elections, world leaders, government', theme: 'politics' },
]

/** Themes available for the Mix builder (excludes Random + Mix itself). */
export const MIXABLE_THEMES: Mashup[] = MASHUPS.filter((m) => !!m.theme)
