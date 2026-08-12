import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages serves project sites from /<repo-name>/, not the domain root.
  // Set this to '/<your-repo-name>/' once the repo is created (leave as '/' if
  // you deploy to a custom domain or a user/org page instead).
  base: '/inventory-app/',
})
