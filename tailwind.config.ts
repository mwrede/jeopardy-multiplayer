import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Existing gameplay palette — untouched (the in-game board / buzzer / display)
        'jeopardy-blue': '#060CE9',
        'jeopardy-blue-dark': '#0A0A6B',
        'jeopardy-blue-cell': '#0A14C8',
        'jeopardy-dark': '#000428',
        'jeopardy-gold': '#CC8A25',
        'jeopardy-gold-light': '#E8A832',
        'jeopardy-correct': '#22C55E',
        'jeopardy-incorrect': '#EF4444',

        // Stage-set palette — used everywhere OUTSIDE gameplay
        // (home, /find, /login, /create chrome, preview modals, profile menu).
        // The "stage" is deep royal blue behind the wood board frame.
        stage:      '#0F2AB8',
        'stage-2':  '#0B1F8E',
        'stage-3':  '#08155A',
        'stage-hi': '#2547E0',

        // Walnut / cherry wood picture-frame around content
        wood:       '#5B2A16',
        'wood-hi':  '#8B4A28',
        'wood-mid': '#6A3218',
        'wood-lo':  '#3D1B0E',

        // Copper LED lights + primary CTA
        copper:          '#FF9B44',
        'copper-bright': '#FFB864',
        'copper-glow':   '#FFD59A',
        'copper-deep':   '#C86A20',

        // Chrome / silver text on brand + secondary CTAs
        'chrome-hi':  '#FFFFFF',
        chrome:       '#E4E9F4',
        'chrome-mid': '#A5B0C8',
        'chrome-lo':  '#6D7B99',

        // Text on stage
        'ink-stage':    '#EAF0FF',
        'ink-stage-2':  '#A9B4D8',
        'ink-stage-3':  '#6C77A0',
      },
      fontFamily: {
        display: ['var(--font-display)', 'serif'],
      },
      animation: {
        'buzz-pulse': 'buzz-pulse 0.8s ease-in-out infinite',
        'score-pop': 'score-pop 0.5s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
      },
      keyframes: {
        'buzz-pulse': {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.08)', opacity: '0.85' },
        },
        'score-pop': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.3)' },
          '100%': { transform: 'scale(1)' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
export default config
