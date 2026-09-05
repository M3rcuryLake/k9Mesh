/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'IBM Plex Mono', 'monospace'],
      },
      colors: {
        ink: {
          900: '#06080c',
          800: '#0a0e16',
          700: '#0f1420',
          600: '#161c2c',
          500: '#1e2640',
          400: '#2a3554',
          300: '#3b4868',
        },
        cyan: {
          glow: '#22d3ee',
        },
        amber: {
          glow: '#fbbf24',
        },
      },
      boxShadow: {
        glow: '0 0 20px rgba(34, 211, 238, 0.15)',
        'glow-amber': '0 0 20px rgba(251, 191, 36, 0.2)',
        'glow-red': '0 0 20px rgba(239, 68, 68, 0.2)',
        'inner-glow': 'inset 0 0 30px rgba(34, 211, 238, 0.05)',
      },
    },
  },
  plugins: [],
};
