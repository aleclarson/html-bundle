import { buildEntryScripts, RelativeScript } from '../esbuild.mjs'
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
        script.srcAttr.value = new URL(
          script.srcAttr.value,
          config.server.url
        ).href
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
            try {
              const { outputFiles } = await buildEntryScripts(
                scripts.map(script => script.srcPath),
                config,
                {
                  watch: true,
                  write: false,
                }
              )
              for (const file of outputFiles!) {
                const id = baseRelative(file.path)
                cache[id] = Buffer.from(file.contents)
              }
              clients.forEach(client => client.reload())
            } catch (e) {
              console.error(e)
            }
          }
        },
      }
    },
    serve(req) {
      if (req.pathname) {
        const data = cache[req.pathname]
        if (data) {
          return { data }
        }
      }
    },
  }
}
