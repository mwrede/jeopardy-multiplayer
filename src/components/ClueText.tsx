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
 */
export function ClueText({ text, className = '' }: { text: string; className?: string }) {
  const parts = parseClueText(text)

  return (
    <span className={className}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part.type === 'text' && part.content}
          {part.type === 'bold' && <strong>{part.content}</strong>}
          {part.type === 'italic' && <em>{part.content}</em>}
          {part.type === 'big' && <span className="text-[1.3em]">{part.content}</span>}
          {part.type === 'img' && (
            <img src={part.content} alt="" className="inline-block max-h-48 rounded my-2" />
          )}
        </Fragment>
      ))}
    </span>
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
