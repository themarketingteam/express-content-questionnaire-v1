import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { productionBuildGuard } from './scripts/production-build-guard.mjs'

const deployment = JSON.parse(readFileSync(new URL('./.base44-deployment-source.json', import.meta.url), 'utf8'))
process.env.VITE_BASE44_APP_ID = deployment.base44AppId

// https://vite.dev/config/
export default defineConfig({
  define: {
    'import.meta.env.VITE_LOCAL_PREVIEW': 'false',
    'import.meta.env.VITE_BASE44_APP_ID': JSON.stringify(deployment.base44AppId),
    'import.meta.env.VITE_BASE44_BACKEND_URL': JSON.stringify('https://base44.app'),
  },
  build: { outDir: 'dist', emptyOutDir: true },
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true'
    }),
    react(),
    productionBuildGuard({ appId: deployment.base44AppId }),
  ]
});
