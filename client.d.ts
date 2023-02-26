/// <reference path="node_modules/esbuild-plugin-import-glob/client.d.ts" />

interface ImportMeta {
  env: ImportMetaEnv
}

interface ImportMetaEnv {
  HMR_PORT: number
  DEV: boolean
}

declare const process: {
  env: {
    NODE_ENV: string
  }
}
