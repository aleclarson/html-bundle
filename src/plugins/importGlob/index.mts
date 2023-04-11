import type { Plugin } from 'esbuild'
import { transformGlob } from './transformGlob.mjs'

const createPlugin = (): Plugin => {
  return {
    name: 'esbuild-plugin-import-glob',
    setup(build) {
      build.onTransform({ loaders: ['js', 'jsx'] }, async args => {
        return transformGlob(args.code, {
          path: args.path,
          jsx: args.loader === 'jsx',
        })
      })
    },
  }
}

export default createPlugin
