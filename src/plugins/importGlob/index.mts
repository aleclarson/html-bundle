import type { Plugin } from 'esbuild'
import { transformGlob } from './transformGlob.mjs'

const createPlugin = (): Plugin => {
  return {
    name: 'esbuild-plugin-import-glob',
    setup(build) {
      build.onTransform({ loaders: ['js', 'ts', 'jsx', 'tsx'] }, async args => {
        return transformGlob(args.code, {
          path: args.path,
          ts: args.loader === 'ts' || args.loader === 'tsx',
          jsx: args.loader === 'jsx' || args.loader === 'tsx',
        })
      })
    },
  }
}

export default createPlugin
