import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

/**
 * Writes sw.js (from sw/sw.js) with the list of this version's app files to store for offline use.
 * Large export-only libraries (PDF, Word) are left out and stored the first time they are used.
 */
function serviceWorker(): Plugin {
  return {
    name: 'carter-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const skip = /pdfmake|vfs_fonts|jszip|docx|dist-/
      const files = Object.values(bundle)
        .map((f) => f.fileName)
        .filter((n) => n !== 'sw.js' && !skip.test(n))
        .filter((n) => (/\.(js|css)$/.test(n) ? true : /\.woff2$/.test(n) ? /(inter|literata)-latin-wght|noto-serif-hebrew-hebrew-(400|600)/.test(n) : false))
        .map((n) => '/' + n)
        .sort()
      const precache = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/data/kjv/index.json', '/data/translations/index.json', ...files]
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12)
      const source = fs
        .readFileSync('sw/sw.js', 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify(precache, null, 1))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

/** The same security headers as production (vercel.json), so local previews and tests run under them. */
function productionHeaders(): Record<string, string> {
  const cfg = JSON.parse(fs.readFileSync('vercel.json', 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] }
  const all = cfg.headers.find((h) => h.source === '/(.*)')?.headers ?? []
  // over plain http on this machine, "upgrade to https" would break every request
  return Object.fromEntries(all.filter((h) => h.key !== 'Strict-Transport-Security').map((h) => [h.key, h.value.replace(/; upgrade-insecure-requests/, '')]))
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorker()],
  // short commit id so error reports say which version had the problem
  define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7)) },
  preview: { headers: productionHeaders() },
})
