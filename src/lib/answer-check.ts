/**
 * Jeopardy answer checking.
 *
 * Runs in three widening passes:
 *   1. Normalized exact / alias / number-word equality
 *   2. Word-aware containment (the player named the distinctive words)
 *   3. Fuzzy: per-word edit distance + phonetic keys, for typos and for
 *      speech-to-text mangling ("Neechee" → "Nietzsche")
 *
 * What it deliberately does NOT do is judge meaning. "Graduation" for
 * "commencement" is a synonym, not a spelling variant, and no string
 * algorithm gets there. That case is handled by the optional AI judge —
 * see judgeAnswerWithAI() and the notes in checkAnswerDetailed().
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or',
  'is', 'are', 'was', 'were', 'his', 'her', 'its', 'their',
])

/** Strip "What is", "Who's", "Where are", etc. — repeatedly. */
export function stripPrefix(s: string): string {
  let prev: string
  let out = s.trim()
  do {
    prev = out
    out = out
      .replace(/^(what|who|where|when|how)['']?s\s+/i, '')
      .replace(/^(what|who|where|when|how)\s+(is|are|was|were)\s+/i, '')
      .replace(/^[,;]\s*/, '')
      .trim()
  } while (out !== prev)
  return out
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/\(.*?\)/g, '')
    .replace(/^(a|an|the)\s+/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function expandAbbreviations(s: string): string {
  return s
    .replace(/\bst\b/g, 'saint')
    .replace(/\bmt\b/g, 'mount')
    .replace(/\bdr\b/g, 'doctor')
    .replace(/\bmr\b/g, 'mister')
    .replace(/\bmrs\b/g, 'missus')
    .replace(/\bft\b/g, 'fort')
    .replace(/\bnyc\b/g, 'new york city')
    .replace(/\bla\b/g, 'los angeles')
    .replace(/\bdc\b/g, 'district of columbia')
    .replace(/\buk\b/g, 'united kingdom')
    .replace(/\bus\b/g, 'united states')
    .replace(/\busa\b/g, 'united states of america')
}

const NUMBER_WORDS: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
  '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen',
  '14': 'fourteen', '15': 'fifteen', '16': 'sixteen', '17': 'seventeen',
  '18': 'eighteen', '19': 'nineteen', '20': 'twenty',
}
function replaceNumbers(s: string): string {
  return s.replace(/\d+/g, (m) => NUMBER_WORDS[m] || m)
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = curr
  }
  return prev[b.length]
}

/**
 * Simplified Metaphone: collapses a word to how it sounds, so phonetic
 * misspellings and speech-to-text output still match. Handles the English
 * cases that actually bite in gameplay — silent letters, ph/f, soft c/g,
 * doubled consonants, and interior vowels.
 */
export function phoneticKey(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return ''

  // Silent leading clusters
  w = w.replace(/^(kn|gn|pn|ae|wr)/, (m) => m[1])
  if (w.startsWith('x')) w = 's' + w.slice(1)
  if (w.startsWith('wh')) w = 'w' + w.slice(2)

  // Keep the first letter's vowel-ness; interior vowels get dropped later.
  const first = w[0]

  w = w
    .replace(/mb$/, 'm')
    .replace(/ough$/, 'f')
    .replace(/tch/g, 'ch')
    .replace(/[csz]h/g, 'x')   // sh, ch, zh → one sound
    .replace(/c(?=[iey])/g, 's')
    .replace(/c/g, 'k')
    .replace(/q/g, 'k')
    .replace(/ck/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/g(?=[iey])/g, 'j')
    .replace(/gh/g, 'g')
    .replace(/dg/g, 'j')
    .replace(/th/g, '0')
    .replace(/v/g, 'f')
    .replace(/z/g, 's')
    .replace(/[wy](?![aeiou])/g, '')

  // Drop interior/trailing vowels, keep a leading one
  w = w[0] + w.slice(1).replace(/[aeiou]/g, '')
  if (/[aeiou]/.test(first)) w = first + w.slice(1)

  // Collapse doubled letters
  w = w.replace(/(.)\1+/g, '$1')
  return w
}

function words(s: string): string[] {
  return s.split(' ').filter(Boolean)
}

/** Distinctive words only — drops articles/prepositions. */
function keyWords(s: string): string[] {
  const w = words(s).filter((x) => !STOPWORDS.has(x))
  return w.length > 0 ? w : words(s)
}

/** Typo-tolerant single-word compare: edit distance scaled to length, then phonetics. */
function wordMatches(a: string, b: string): boolean {
  if (a === b) return true
  const minLen = Math.min(a.length, b.length)
  const maxLen = Math.max(a.length, b.length)

  // Too short to fuzz safely — "eat" and "cat" are one edit apart but unrelated.
  if (minLen < 4) return false
  // A big length gap means different words, not a typo ("gat" vs "gatsby").
  if (maxLen - minLen > 2) return false

  const budget = maxLen <= 5 ? 1 : maxLen <= 9 ? 2 : 3
  if (levenshtein(a, b) <= budget) return true

  const pa = phoneticKey(a)
  const pb = phoneticKey(b)
  if (pa && pa === pb) return true
  // Allow one slip in the phonetic key for longer words
  if (pa.length >= 4 && pb.length >= 4 && levenshtein(pa, pb) <= 1) return true
  return false
}

/**
 * Word-aware containment: true when every distinctive word of the SHORTER
 * side appears (fuzzily) in the longer side. Lets "Lincoln" match
 * "Abraham Lincoln" without letting "eat" match "great gatsby".
 */
function containsAllWords(shorter: string, longer: string): boolean {
  const sw = keyWords(shorter)
  const lw = keyWords(longer)
  if (sw.length === 0 || sw.length > lw.length) return false
  return sw.every((s) => lw.some((l) => wordMatches(s, l)))
}

export type CheckResult = {
  correct: boolean
  /** How the verdict was reached — useful for logging and for the AI judge. */
  method: 'exact' | 'alias' | 'contains' | 'fuzzy' | 'phonetic' | 'none'
  /** True when the strings are close enough that a human might disagree. */
  borderline: boolean
}

/**
 * Full check with provenance. `correct: false` here does NOT mean the answer
 * is wrong — it means no string rule matched. Synonyms and paraphrases land
 * here and are what the AI judge is for.
 */
export function checkAnswerDetailed(playerAnswer: string, correctAnswer: string): CheckResult {
  const player = normalize(stripPrefix(playerAnswer))
  const correct = normalize(correctAnswer)

  if (!player) return { correct: false, method: 'none', borderline: false }
  if (player === correct) return { correct: true, method: 'exact', borderline: false }

  const playerExp = expandAbbreviations(player)
  const correctExp = expandAbbreviations(correct)
  if (playerExp === correctExp) return { correct: true, method: 'alias', borderline: false }

  if (replaceNumbers(player) === replaceNumbers(correct)) {
    return { correct: true, method: 'alias', borderline: false }
  }

  // Slash / ampersand alternatives: "dogs/canines"
  const alternatives = correctAnswer
    .split(/[\/&]|\bor\b/)
    .map((a) => normalize(a.trim()))
    .filter((a) => a.length >= 2)
  if (alternatives.some((alt) => alt === player)) {
    return { correct: true, method: 'alias', borderline: false }
  }

  // Word-aware containment, both directions (and on the expanded forms)
  if (
    containsAllWords(player, correct) ||
    containsAllWords(correct, player) ||
    containsAllWords(playerExp, correctExp) ||
    containsAllWords(correctExp, playerExp) ||
    alternatives.some((alt) => containsAllWords(player, alt) || containsAllWords(alt, player))
  ) {
    return { correct: true, method: 'contains', borderline: false }
  }

  // Whole-string fuzzy for single-token answers and light typos
  const maxLen = Math.max(player.length, correct.length)
  if (maxLen >= 4) {
    const budget = Math.max(1, Math.floor(maxLen * 0.25))
    if (levenshtein(player, correct) <= budget) {
      return { correct: true, method: 'fuzzy', borderline: true }
    }
  }

  // Phonetic whole-answer match — catches voice transcription drift
  const pPlayer = keyWords(player).map(phoneticKey).join(' ')
  const pCorrect = keyWords(correct).map(phoneticKey).join(' ')
  if (pPlayer && pPlayer === pCorrect) {
    return { correct: true, method: 'phonetic', borderline: true }
  }

  return { correct: false, method: 'none', borderline: false }
}

/** Back-compat boolean wrapper. */
export function checkAnswer(playerAnswer: string, correctAnswer: string): boolean {
  return checkAnswerDetailed(playerAnswer, correctAnswer).correct
}
