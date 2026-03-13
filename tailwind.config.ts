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
        'jeopardy-blue': '#060CE9',
        'jeopardy-dark': '#000033',
        'jeopardy-gold': '#D4AF37',
        'jeopardy-correct': '#22C55E',
        'jeopardy-incorrect': '#EF4444',
      },
      fontFamily: {
        display: ['var(--font-display)', 'serif'],
      },
      animation: {
        'buzz-pulse': 'buzz-pulse 1s ease-in-out infinite',
        'score-pop': 'score-pop 0.5s ease-out',
      },
      keyframes: {
        'buzz-pulse': {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.05)', opacity: '0.8' },
        },
        'score-pop': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.3)' },
          '100%': { transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
}
export default config
