/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}'
  ],
  theme: {
    extend: {
      colors: {
        terminal: {
          bg: '#0a0a0a',
          text: '#00ff00',
          error: '#ff4444',
          warn: '#ffff00',
          success: '#00ff00'
        }
      },
      fontFamily: {
        mono: ['Fira Code', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
}
