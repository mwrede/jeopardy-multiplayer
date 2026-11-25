'use client'

import { useEffect, useState } from 'react'
import QRCode from 'react-qr-code'

/**
 * THE JOIN CODE — a QR nobody has to type a URL for.
 *
 * Drawn in the page rather than fetched as an image from a QR web service,
 * which is how this used to work. The service version failed in exactly the
 * situation that matters: a room on hotel wifi, a laptop that can reach the
 * game but not a third-party image host, and a blank white square where the
 * way in should be. It also meant handing the room's join link to someone
 * else's server. An SVG drawn locally can't fail separately from the page.
 *
 * Sized in two places: a strip for the host's console, and a full-screen
 * panel for putting on the TV while people file in.
 */
export function JoinQr({
  roomCode,
  size = 'md',
  className = '',
  suffix = '',
  label,
}: {
  roomCode: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Appended to /game/<code> — '/play' for everyone-on-their-own-device. */
  suffix?: string
  /** Overrides the copy button's wording. */
  label?: string
}) {
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => { setOrigin(window.location.origin) }, [])

  const joinUrl = origin ? `${origin}/game/${roomCode}${suffix}` : ''
  const px = size === 'lg' ? 320 : size === 'sm' ? 112 : 180

  async function copy() {
    try { await navigator.clipboard.writeText(joinUrl) }
    catch { window.prompt('Copy this link:', joinUrl) }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className="rounded-lg bg-white p-2" style={{ width: px + 16, height: px + 16 }}>
        {/* Nothing to encode until the origin is known — render the white
            card anyway so the layout doesn't jump when it arrives. */}
        {joinUrl && <QRCode value={joinUrl} size={px} level="M" />}
      </div>
      <p
        className={`font-mono font-bold tracking-[0.3em] text-white ${
          size === 'lg' ? 'text-5xl' : size === 'sm' ? 'text-lg' : 'text-2xl'
        }`}
      >
        {roomCode}
      </p>
      {size !== 'sm' && (
        <button
          onClick={copy}
          className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
        >
          {copied ? '✓ Copied' : label ?? 'Copy join link'}
        </button>
      )}
    </div>
  )
}

/**
 * The join code over the whole screen, for the moment before a game when the
 * room is filling up — and for the middle of one, when somebody arrives late
 * and the host needs the code back without leaving the board.
 */
export function JoinQrOverlay({
  roomCode,
  joined,
  onClose,
}: {
  roomCode: string
  joined: number
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 bg-jeopardy-dark/97 p-6"
      onClick={onClose}
    >
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-jeopardy-gold-light">
        Scan to join
      </p>
      <JoinQr roomCode={roomCode} size="lg" />
      <p className="text-lg text-gray-300">
        {joined === 0
          ? 'Nobody has joined yet'
          : `${joined} ${joined === 1 ? 'player' : 'players'} in`}
      </p>
      <p className="text-sm text-gray-500">Anyone can join mid-game. Tap anywhere to close.</p>
    </div>
  )
}
