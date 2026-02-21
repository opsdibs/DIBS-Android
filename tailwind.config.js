/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        retro: ['Chunko', 'sans-serif'], 
      },
      colors: {
        'dibs-black': '#050505',
        'dibs-gray': '#121212',
        'dibs-neon': '#ccff00',
      }
    },
  },
  plugins: [],
}