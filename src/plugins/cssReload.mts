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
    hmr({ clients }) {
      return {
        accept: file => file.endsWith('.css'),
        async update() {
          const updates: { file: string; cssText: string }[] = []
          await Promise.all(
            Array.from(cssEntries.keys(), async (file, i) => {
              if (existsSync(file)) {
                const { outFile, code } = await buildCSSFile(file, config, {
                  watch: true,
                })
                const cssText = code.toString('utf8')
                if (updateCssEntry(file, cssText)) {
                  updates[i] = {
                    file: baseRelative(outFile),
                    cssText,
                  }
                }
              } else {
                cssEntries.delete(file)
              }
            })
          )
          for (const update of updates) {
            await Promise.all(
              Array.from(clients, client =>
                client.evaluateFile('./client/cssReload.js', update)
              )
            )
          }
        },
      }
    },
  }
}
