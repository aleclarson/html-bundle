import type { Plugin } from '../index.mjs'

export const virtualFilePlugin: Plugin = config => {
  config.esbuild.plugins ||= []
  config.esbuild.plugins.push({
    name: 'virtual-files',
    setup(build) {
      build.onResolve({ filter: /^\// }, async args => {
        if (config.virtualFiles[args.path]) {
          return { path: args.path, namespace: 'virtual' }
        }
      })
      build.onLoad({ namespace: 'virtual', filter: /.*/ }, async args => {
        let virtualFile = config.virtualFiles[args.path]
        if (typeof virtualFile == 'function') {
          const request = new URL(args.path, config.server.url)
          // @ts-ignore
          virtualFile = virtualFile({
            ...request,
            method: 'GET',
            headers: {},
            query: null,
            url: args.path,
          })
        }
        const file = await virtualFile
        if (file) {
          return {
            contents: file.data,
          }
        }
      })
    },
  })

  return {}
}
