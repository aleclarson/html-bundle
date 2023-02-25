import { getAttribute } from '@web/parse5-utils'
import fs from 'fs'
import { buildRelativeScripts, RelativeScript } from '../esbuild.mjs'
import { Plugin } from '../plugin.mjs'
import { baseRelative } from '../utils.mjs'

export const liveScriptsPlugin: Plugin = config => {
  const cache: Record<string, Buffer> = {}
  const extRegex = /\.js(\.map)?$/
  const documents: Record<string, RelativeScript[]> = {}

  return {
    document(_root, file, { scripts }) {
      documents[file] = scripts

      for (const script of scripts) {
        if (!script.isModule) {
          continue // Only module scripts can be refreshed.
        }
        const outFile = config.getBuildPath(script.srcPath)
        const id = baseRelative(outFile)
        cache[id] = fs.readFileSync(outFile)
        fs.writeFileSync(
          outFile,
          `await import("http://localhost:${config.server.port}${id}")`
        )
      }
    },
    hmr({ clients }) {
      return {
        accept: file => extRegex.test(file),
        async update() {
          for (const scripts of Object.values(documents)) {
            const { outputFiles } = await buildRelativeScripts(
              scripts,
              config,
              { watch: true, write: false }
            )
            for (const file of outputFiles!) {
              const id = baseRelative(file.path)
              cache[id] = Buffer.from(file.contents)
            }
            clients.forEach(client => client.reload())
          }
        },
      }
    },
    serve(req, res) {
      const uri = req.pathname
      if (uri && extRegex.test(uri)) {
        res.setHeader(
          'Content-Type',
          uri.endsWith('.js') ? 'application/javascript' : 'application/json'
        )
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.write(cache[uri])
        return true
      }
    },
  }
}
