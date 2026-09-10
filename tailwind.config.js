export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        crestly: {
          purple:        '#5B2D8E',
          orange:        '#FF5F1F',
          lime:          '#A8FF3E',
          charcoal:      '#1C1C1E',
          'purple-light':'#F3ECF9',
          'orange-light':'#FFF0EA',
        }
      },
      fontFamily: {
        display: ['"Fredoka One"', 'cursive'],
        body:    ['"Baloo 2"', 'cursive'],
      },
      borderRadius: {
        badge: '12px',
      },
      boxShadow: {
        badge: '0 4px 14px 0 rgba(91, 45, 142, 0.25)',
      }
    }
  },
  plugins: [],
}
