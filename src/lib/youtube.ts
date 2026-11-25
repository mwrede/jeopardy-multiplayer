/**
 * YOUTUBE CLUES.
 *
 * A clue can carry a video the same way it carries a picture: paste the link
 * into the question and the board plays it. Authors paste whatever YouTube
 * handed them — a watch URL, a share link, a Short, an embed, a timestamped
 * link — so everything funnels through one id extractor rather than asking
 * anyone to find the eleven characters themselves.
 */

/** Every YouTube link shape that carries a video id. */
const PATTERNS: RegExp[] = [
  /youtube\.com\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{6,})/i,
  /youtube\.com\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{6,})/i,
  /youtu\.be\/([A-Za-z0-9_-]{6,})/i,
  /youtube\.com\/attribution_link\?.*v%3D([A-Za-z0-9_-]{6,})/i,
]

/**
 * The video id inside anything an author might paste, or null.
 *
 * A bare id passes through, so `[yt:dQw4w9WgXcQ]` and
 * `[yt:https://youtu.be/dQw4w9WgXcQ?t=42]` mean the same thing.
 */
export function youtubeId(input: string): string | null {
  const raw = (input || '').trim()
  if (!raw) return null
  for (const re of PATTERNS) {
    const m = raw.match(re)
    if (m) return m[1]
  }
  // A bare id: 11 characters of the YouTube alphabet, optionally followed by
  // the start time this module writes into its own tokens (`abc123?t=43`).
  const bare = raw.match(/^([A-Za-z0-9_-]{11})(?:[?#].*)?$/)
  if (bare) return bare[1]
  return null
}

/** Start offset in seconds from a `?t=90` / `#t=1m30s` link, or 0. */
export function youtubeStart(input: string): number {
  const raw = (input || '').trim()
  const plain = raw.match(/[?&#](?:t|start)=(\d+)(?:s)?\b/i)
  if (plain) return parseInt(plain[1], 10)
  const clock = raw.match(/[?&#]t=(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i)
  if (clock && (clock[1] || clock[2] || clock[3])) {
    return (
      parseInt(clock[1] || '0', 10) * 3600 +
      parseInt(clock[2] || '0', 10) * 60 +
      parseInt(clock[3] || '0', 10)
    )
  }
  return 0
}

/** True if this text contains a YouTube link anywhere in it. */
export function hasYouTube(text: string): boolean {
  return /\[yt:/i.test(text) || /youtube\.com|youtu\.be/i.test(text)
}

/** The clue markup for a pasted link — what the editor writes into the cell. */
export function youtubeToken(input: string): string | null {
  const id = youtubeId(input)
  if (!id) return null
  const start = youtubeStart(input)
  return start > 0 ? `[yt:${id}?t=${start}]` : `[yt:${id}]`
}

/** Watch page, for the "open on YouTube" escape hatch. */
export function youtubeWatchUrl(id: string, start = 0): string {
  return `https://www.youtube.com/watch?v=${id}${start > 0 ? `&t=${start}` : ''}`
}

/** Poster frame. hqdefault exists for every video; maxres does not. */
export function youtubeThumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}

/** Embed URL. `autoplay` only works off a real click, which is how we use it. */
export function youtubeEmbedUrl(id: string, start = 0, autoplay = true): string {
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  })
  if (autoplay) params.set('autoplay', '1')
  if (start > 0) params.set('start', String(start))
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`
}
