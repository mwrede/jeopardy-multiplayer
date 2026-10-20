'use client'

import { Fragment } from 'react'

/**
 * Renders clue text with simple formatting:
 *   **bold**  →  <strong>
 *   *italic*  →  <em>
 *   [big]...[/big]  →  larger text
 *   [img:url]  →  <img>
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
    (n, part) => (part.type === 'img' ? n : n + part.content.length),
    0,
  )
}

interface TextPart {
  type: 'text' | 'bold' | 'italic' | 'big' | 'img'
  content: string
}

function parseClueText(text: string): TextPart[] {
  const parts: TextPart[] = []
  // Combined regex for all inline tokens
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|\[big\](.*?)\[\/big\]|\[img:(.*?)\]/g
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
