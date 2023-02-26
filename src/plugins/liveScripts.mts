import fs from 'fs'
import { buildRelativeScripts, RelativeScript } from '../esbuild.mjs'
import { Plugin } from '../plugin.mjs'
import { baseRelative } from '../utils.mjs'

export const liveScriptsPlugin: Plugin = config => {
  const cache: Record<string, Buffer> = {}
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
          `await import("https://localhost:${config.server.port}${id}?t=" + Date.now())`
        )
      }
    },
    hmr(clients) {
      return {
        // FIXME: We should only accept files that we know are used in
        // bundled entry scripts with the type="module" attribute, as
        // those are the only scripts we can update without reloading
        // the extension.
        accept: file => /\.m?[tj]sx?$/.test(file),
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
      if (uri && /\.m?js(\.map)?$/.test(uri)) {
        let buffer = cache[uri]
        if (!buffer && uri.startsWith('/' + config.build)) {
          try {
            // When code splitting is performed on each entry script,
            // the resulting "chunks" aren't stored in our cache until
            // the first HMR update.
            buffer = cache[uri] = fs.readFileSync('.' + uri)
          } catch {}
        }
        if (!buffer) {
          return
        }
        res.setHeader(
          'Content-Type',
          uri.endsWith('.js') ? 'application/javascript' : 'application/json'
        )
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.write(buffer)
        res.end()
        return true
      }
    },
  }
}
