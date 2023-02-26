import { existsSync } from 'fs'
import md5Hex from 'md5-hex'
import { buildCSSFile } from '../css.mjs'
import { Plugin } from '../plugin.mjs'
import { baseRelative } from '../utils.mjs'

export const cssReloadPlugin: Plugin = config => {
  const cssEntries = new Map<string, string>()
  const updateCssEntry = (file: string, code: string) => {
    const prevHash = cssEntries.get(file)
    const hash = md5Hex(code)
    cssEntries.set(file, hash)
    return hash != prevHash
  }

  return {
    document(_root, _file, { styles }) {
      const buildPrefix = '/' + config.build + '/'
      styles.forEach(style => {
        const srcAttr = style.srcAttr.value
        if (srcAttr.startsWith(buildPrefix)) {
          style.srcAttr.value = new URL(srcAttr, config.server.url).href

          // TODO: get file hash
          cssEntries.set(style.srcPath, '')
        }
      })
    },
    hmr(clients) {
      return {
        accept: file => file.endsWith('.css'),
        async update() {
          const updates: [uri: string][] = []
          await Promise.all(
            Array.from(cssEntries.keys(), async (file, i) => {
              if (existsSync(file)) {
                const { outFile, code } = await buildCSSFile(file, config, {
                  watch: true,
                })
                const cssText = code.toString('utf8')
                if (updateCssEntry(file, cssText)) {
                  const uri = baseRelative(outFile)
                  config.virtualFiles[uri] = { data: cssText }
                  updates[i] = [uri]
                }
              } else {
                cssEntries.delete(file)
              }
            })
          )
          for (const update of updates) {
            await Promise.all(
              Array.from(clients, client =>
                client.evaluateModule('./client/cssReload.js', update)
              )
            )
          }
        },
      }
    },
  }
}
