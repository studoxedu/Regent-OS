import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  // Relative asset paths so the build works under Electron's file:// protocol
  base: './',
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.svg', 'icons.svg'],
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
      cleanupOutdatedCaches: true,
      skipWaiting: true,
      clientsClaim: true,
      // Don't let the service worker cache Supabase API calls —
      // our fetch interceptor handles that at the application layer
      navigateFallback: 'index.html',
      navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//, /^\/storage\//],
    },
    manifest: {
      name: 'Regent OS',
      short_name: 'Regent OS',
      description: 'Institutional Management Platform',
      theme_color: '#0f172a',
      background_color: '#ffffff',
      display: 'standalone',
      orientation: 'any',
      scope: '/',
      start_url: '/',
      icons: [
        {
          src: 'favicon.svg',
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any',
        },
      ],
    },
  }), cloudflare()],
})