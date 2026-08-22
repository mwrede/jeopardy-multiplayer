/**
 * Jeopardy sound effects using Web Audio API.
 * Synthesized in-browser — no external audio files needed.
 */

let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  // Resume if suspended (browsers require user interaction first)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  return audioCtx
}

/**
 * Correct answer sound — ascending major chord arpeggio (like the Jeopardy "ding")
 * Quick bright tones: C5 → E5 → G5
 */
export function playCorrectSound() {
  try {
    const ctx = getAudioContext()
    const now = ctx.currentTime

    const frequencies = [523.25, 659.25, 783.99] // C5, E5, G5
    const durations = [0.12, 0.12, 0.25]

    let time = now
    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, time)

      gain.gain.setValueAtTime(0, time)
      gain.gain.linearRampToValueAtTime(0.3, time + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, time + durations[i])

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(time)
      osc.stop(time + durations[i])
      time += durations[i] * 0.7 // slight overlap
    })
  } catch (e) {
    console.warn('Could not play correct sound:', e)
  }
}

/**
 * Wrong answer sound — the classic Jeopardy "bzzzt" buzzer
 * Low harsh tone with quick decay
 */
export function playWrongSound() {
  try {
    const ctx = getAudioContext()
    const now = ctx.currentTime

    // Main buzzer tone — low sawtooth
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sawtooth'
    osc1.frequency.setValueAtTime(110, now) // A2
    gain1.gain.setValueAtTime(0.25, now)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.6)

    // Second detuned tone for harshness
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sawtooth'
    osc2.frequency.setValueAtTime(116.54, now) // slightly detuned
    gain2.gain.setValueAtTime(0.15, now)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now)
    osc2.stop(now + 0.55)

    // Sub bass hit
    const osc3 = ctx.createOscillator()
    const gain3 = ctx.createGain()
    osc3.type = 'sine'
    osc3.frequency.setValueAtTime(55, now) // A1
    gain3.gain.setValueAtTime(0.2, now)
    gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.4)
    osc3.connect(gain3)
    gain3.connect(ctx.destination)
    osc3.start(now)
    osc3.stop(now + 0.4)
  } catch (e) {
    console.warn('Could not play wrong sound:', e)
  }
}

/**
 * Times up sound — descending "wah wah" like a timeout
 */
export function playTimeUpSound() {
  try {
    const ctx = getAudioContext()
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(440, now)
    osc.frequency.linearRampToValueAtTime(220, now + 0.5)
    gain.gain.setValueAtTime(0.2, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.5)
  } catch (e) {
    console.warn('Could not play time up sound:', e)
  }
}

/**
 * Daily Double sound — dramatic rising sweep
 */
export function playDailyDoubleSound() {
  try {
    const ctx = getAudioContext()
    const now = ctx.currentTime

    // Rising sweep
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(200, now)
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.3)
    gain.gain.setValueAtTime(0.15, now)
    gain.gain.setValueAtTime(0.15, now + 0.25)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.5)

    // Accent tone
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(880, now + 0.3)
    gain2.gain.setValueAtTime(0, now)
    gain2.gain.setValueAtTime(0.25, now + 0.3)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.3)
    osc2.stop(now + 0.7)
  } catch (e) {
    console.warn('Could not play daily double sound:', e)
  }
}

/**
 * Buzz-in sound — quick electronic "click"
 */
export function playBuzzSound() {
  try {
    const ctx = getAudioContext()
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(1200, now)
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.05)
    gain.gain.setValueAtTime(0.15, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.08)
  } catch (e) {
    console.warn('Could not play buzz sound:', e)
  }
}

/**
 * Timer tick sound — soft click for each second during countdown
 */
export function playTickSound(urgent: boolean = false) {
  try {
    const ctx = getAudioContext()
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(urgent ? 880 : 660, now)
    gain.gain.setValueAtTime(urgent ? 0.12 : 0.06, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.06)
  } catch (e) {
    console.warn('Could not play tick sound:', e)
  }
}

/**
 * Board select sound — quick "boop" when a clue is selected
 */
export function playSelectSound() {
  try {
    const ctx = getAudioContext()
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(440, now)
    osc.frequency.setValueAtTime(660, now + 0.04)
    gain.gain.setValueAtTime(0.12, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.1)
  } catch (e) {
    console.warn('Could not play select sound:', e)
  }
}
