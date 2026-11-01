import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// Several data-integrity tests read thousands of files. On a cold disk they can pass 5 s,
// so give every test room instead of failing at random on a slow machine.
export default mergeConfig(viteConfig, defineConfig({ test: { testTimeout: 30000 } }))
