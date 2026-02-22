import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'lucide-react',
    ],
  },
  server: {
    watch: {
      ignored: ['**/.firebaserc', '**/firebase.json', '**/firestore.rules'],
    },
  },
})
