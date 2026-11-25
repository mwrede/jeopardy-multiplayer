'use client'

import { Fragment, useState } from 'react'
import {
  youtubeEmbedUrl,
  youtubeId,
  youtubeStart,
  youtubeThumb,
  youtubeWatchUrl,
} from '@/lib/youtube'

/**
 * Renders clue text with simple formatting:
 *   **bold**  →  <strong>
 *   *italic*  →  <em>
 *   [big]...[/big]  →  larger text
 *   [img:url]  →  <img>
 *   [yt:link]  →  a YouTube player, click to play
 *
 * A bare YouTube link pasted straight into a clue becomes a player too, so an
 * author who copies the address bar gets a video without learning any markup.
 *
 * Plain strings pass through unchanged.
 *
 * Every surface that shows a clue goes through here — the board preview, the
 * presenter's screen, the TV, the phones. A clue rendered as raw text anywhere
 * leaks `[img:https://…]` markup at the player, so reach for this component
 * rather than printing `clue.question` directly.
 */

/**
 * How big a picture clue is allowed to get. The same clue is read from a
 * phone, a modal and a projector, so the cap belongs to the surface, not to
 * the image: a 192px photo is right in a popup and lost on a TV.
 */
export type ClueTextVariant = 'compact' | 'default' | 'tv'

const IMAGE_SIZE: Record<ClueTextVariant, string> = {
  /** Board tiles and console lines — a thumbnail that can't push the row open. */
  compact: 'max-h-10 my-1',
  /** Modals and phones. */
  default: 'max-h-48 sm:max-h-64 my-3',
  /** Projected: the picture is the clue, so give it most of the screen. */
  tv: 'max-h-[45vh] my-6',
}

const IMAGE_BASE = 'block mx-auto h-auto w-auto max-w-full rounded-lg object-contain'

/**
 * How big a video clue is allowed to get. A 16:9 frame can't be given "most
 * of the screen" the way a photo can — it has to stay inside the height the
 * clue's words leave it, or the question scrolls off the top of the TV.
 */
const VIDEO_SIZE: Record<ClueTextVariant, string> = {
  compact: 'w-32',
  default: 'w-full max-w-md my-3',
  tv: 'w-full max-w-4xl my-5',
}

export function ClueText({
  text,
  className = '',
  variant = 'default',
  revealChars,
}: {
  text: string
  className?: string
  variant?: ClueTextVariant
  /**
   * Typewriter support. Only this many characters of *text* are opaque; the
   * rest is rendered transparent so the line never reflows as it fills in.
   *
   * Images are exempt — they render whole from the first frame. Typing a
   * pasted URL out character by character reads as a bug on the TV, and the
   * clue's reading clock would be spent on the URL instead of the question.
   */
  revealChars?: number
}) {
  const parts = parseClueText(text)
  // Walks the text characters only, so `revealChars` means the same thing
  // whether or not the clue happens to carry a picture.
  let cursor = 0

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.type === 'img') {
          return (
            <img
              key={i}
              src={part.content}
              alt=""
              className={`${IMAGE_BASE} ${IMAGE_SIZE[variant]}`}
            />
          )
        }

        if (part.type === 'yt') {
          return <YouTubeClue key={i} link={part.content} variant={variant} />
        }

        const start = cursor
        cursor += part.content.length
        const body = <Typed content={part.content} start={start} revealChars={revealChars} />

        return (
          <Fragment key={i}>
            {part.type === 'text' && body}
            {part.type === 'bold' && <strong>{body}</strong>}
            {part.type === 'italic' && <em>{body}</em>}
            {part.type === 'big' && <span className="text-[1.3em]">{body}</span>}
          </Fragment>
        )
      })}
    </span>
  )
}

/** The written-so-far half of a run of text, with the rest holding its space. */
function Typed({
  content,
  start,
  revealChars,
}: {
  content: string
  start: number
  revealChars?: number
}) {
  if (revealChars === undefined) return <>{content}</>
  const shown = Math.min(content.length, Math.max(0, revealChars - start))
  return (
    <>
      {content.slice(0, shown)}
      {shown < content.length && (
        <span className="text-transparent select-none" aria-hidden="true">
          {content.slice(shown)}
        </span>
      )}
    </>
  )
}

/**
 * How many characters a reader actually sees — markup and image URLs don't
 * count. Use it with `revealChars` so a clue types out at the speed it reads.
 */
export function clueTextLength(text: string): number {
  return parseClueText(text).reduce(
    (n, part) => (part.type === 'img' || part.type === 'yt' ? n : n + part.content.length),
    0,
  )
}

interface TextPart {
  type: 'text' | 'bold' | 'italic' | 'big' | 'img' | 'yt'
  content: string
}

function parseClueText(text: string): TextPart[] {
  const parts: TextPart[] = []
  // Combined regex for all inline tokens
  // Order matters: the bracketed tokens are tried before the bare link, so a
  // link already wrapped in [yt:…] isn't matched twice.
  const regex =
    /\*\*(.+?)\*\*|\*(.+?)\*|\[big\](.*?)\[\/big\]|\[img:(.*?)\]|\[yt:(.*?)\]|(https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s<]*|embed\/[^\s<]+|shorts\/[^\s<]+|live\/[^\s<]+)|youtu\.be\/[^\s<]+))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Push any text before this match
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }
    if (match[1] !== undefined) {
      parts.push({ type: 'bold', content: match[1] })
    } else if (match[2] !== undefined) {
      parts.push({ type: 'italic', content: match[2] })
    } else if (match[3] !== undefined) {
      parts.push({ type: 'big', content: match[3] })
    } else if (match[4] !== undefined) {
      parts.push({ type: 'img', content: match[4] })
    } else if (match[5] !== undefined) {
      parts.push({ type: 'yt', content: match[5] })
    } else if (match[6] !== undefined) {
      // A bare link only becomes a player if it really names a video —
      // otherwise it stays text, so a channel or playlist URL reads as written.
      parts.push(
        youtubeId(match[6])
          ? { type: 'yt', content: match[6] }
          : { type: 'text', content: match[6] },
      )
    }
    lastIndex = match.index + match[0].length
  }

  // Push remaining text
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) })
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', content: text })
  }

  return parts
}

/**
 * A YouTube clue: a poster frame with a play button that becomes the real
 * player on the first click.
 *
 * Click-to-play rather than an iframe from the start, for three reasons that
 * all show up in a real room. A board of six video clues would otherwise load
 * six players at once on the presenter's machine. Browsers block autoplay
 * without a gesture, so an iframe that loads itself sits there silent and the
 * host taps a tiny YouTube play button in front of everyone. And the poster
 * frame is the thing you want on screen while you read the clue aloud — the
 * video should start when the host says it starts.
 */
function YouTubeClue({ link, variant }: { link: string; variant: ClueTextVariant }) {
  const [playing, setPlaying] = useState(false)
  const id = youtubeId(link)
  const start = youtubeStart(link)

  // Not a video after all — show the link rather than an empty frame.
  if (!id) {
    return (
      <a href={link} target="_blank" rel="noreferrer" className="underline">
        {link}
      </a>
    )
  }

  // Console lines and board tiles: a thumbnail that says "there's a clip
  // here", with no player to blow the row open.
  if (variant === 'compact') {
    return (
      <span className={`relative mx-auto my-1 block overflow-hidden rounded ${VIDEO_SIZE.compact}`}>
        <img src={youtubeThumb(id)} alt="" className="aspect-video w-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-xs text-white">
          ▶
        </span>
      </span>
    )
  }

  return (
    <span className={`relative mx-auto block overflow-hidden rounded-xl bg-black shadow-lg ring-1 ring-white/15 ${VIDEO_SIZE[variant]}`}>
      <span className="relative block aspect-video w-full">
        {playing ? (
          <iframe
            src={youtubeEmbedUrl(id, start)}
            title="Clue video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label="Play the video"
            className="group absolute inset-0 h-full w-full cursor-pointer"
          >
            <img
              src={youtubeThumb(id)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <span className="absolute inset-0 bg-black/30 transition-colors group-hover:bg-black/15" />
            {/* The play target is deliberately huge: this gets clicked from
                standing up, on someone else's laptop, in a dark room. */}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/95 text-3xl leading-none text-black shadow-2xl transition-transform group-hover:scale-110 md:h-24 md:w-24 md:text-4xl">
                ▶
              </span>
            </span>
          </button>
        )}
      </span>
      {/* Some videos refuse to be embedded. When that happens the frame above
          shows YouTube's own refusal, and this is the way out of it. */}
      <a
        href={youtubeWatchUrl(id, start)}
        target="_blank"
        rel="noreferrer"
        className="block bg-black/60 px-3 py-1 text-center text-[10px] uppercase tracking-[0.2em] text-white/50 transition-colors hover:text-white"
      >
        Open on YouTube ↗
      </a>
    </span>
  )
}
