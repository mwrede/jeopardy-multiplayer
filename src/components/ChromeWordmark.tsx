import type { CSSProperties } from 'react'

type Props = {
  className?: string
  style?: CSSProperties
  /** Text to render — defaults to the full "JEOPARDY!" wordmark. */
  text?: string
}

/**
 * Chrome-styled Jeopardy! wordmark rendered in SVG so the metallic look
 * (silver→white→dark gradient, beveled stroke, hard shadow + blue bloom)
 * is pixel-perfect regardless of the machine's installed fonts.
 *
 * The `Impact` / condensed-black font stack is a safety net; the SVG can
 * still render even if none is present.
 */
export function ChromeWordmark({ className, style, text = 'JEOPARDY!' }: Props) {
  // Give each rendered wordmark unique gradient/filter ids so multiple
  // instances on the same page don't collide.
  const uid = `cw-${text.replace(/[^A-Z0-9]/gi, '').toLowerCase()}`
  return (
    <svg
      viewBox="0 0 720 170"
      className={className}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={text}
    >
      <defs>
        <linearGradient id={`${uid}-fill`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#F6F9FF" />
          <stop offset="35%" stopColor="#FFFFFF" />
          <stop offset="52%" stopColor="#B7C0D6" />
          <stop offset="70%" stopColor="#E4E9F4" />
          <stop offset="100%" stopColor="#7A88A8" />
        </linearGradient>
        <linearGradient id={`${uid}-stroke`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#2E3F63" />
        </linearGradient>
        <filter id={`${uid}-shadow`} x="-8%" y="-20%" width="116%" height="140%">
          <feDropShadow dx="0" dy="6" stdDeviation="0" floodColor="#050E4E" floodOpacity="0.85" />
          <feDropShadow dx="0" dy="10" stdDeviation="14" floodColor="#3A6BFF" floodOpacity="0.55" />
        </filter>
      </defs>
      <g filter={`url(#${uid}-shadow)`}>
        <text
          x="360"
          y="120"
          textAnchor="middle"
          fontFamily="'Impact','Helvetica Neue Condensed Black','Arial Narrow','Arial Black',sans-serif"
          fontSize="130"
          letterSpacing="4"
          fill={`url(#${uid}-fill)`}
          stroke={`url(#${uid}-stroke)`}
          strokeWidth={2}
          paintOrder="stroke fill"
        >
          {text}
        </text>
      </g>
    </svg>
  )
}
