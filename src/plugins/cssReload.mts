import fs from 'fs'
import md5Hex from 'md5-hex'
import svgToDataUri from 'mini-svg-data-uri'
import path from 'path'
import { Config } from '../../config.mjs'
import { buildCSSFile } from '../css.mjs'
import { CssPlugin, Plugin } from '../plugin.mjs'
import { baseRelative } from '../utils.mjs'

export const cssReloadPlugin: Plugin = (config, flags) => {
  const cssEntries = new Map<string, string>()
  const updateCssEntry = (file: string, code: string) => {
    const prevHash = cssEntries.get(file)
    const hash = md5Hex(code)
    cssEntries.set(file, hash)
    return hash != prevHash
  }

  config.registerCssEntry = (file, code) => {
    if (path.isAbsolute(file)) {
      file = path.relative(process.cwd(), file)
    }
    if (!cssEntries.has(file)) {
      cssEntries.set(file, code != null ? md5Hex(code) : '')
    }
  }

  return {
    cssPlugins: [inlineSvgUrls(config)],
    document(_root, _file, { styles }) {
      const buildPrefix = '/' + config.build + '/'
      styles.forEach(style => {
        const srcAttr = style.srcAttr.value
        if (srcAttr.startsWith(buildPrefix)) {
          const devUrl = config.resolveDevUrl(srcAttr)
          style.srcAttr.value = devUrl.href

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
              if (fs.existsSync(file)) {
                const { outFile, code } = await buildCSSFile(
                  file,
                  config,
                  flags
                )
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
            if (!update) continue
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

function inlineSvgUrls(config: Config): CssPlugin {
  return {
    visitor: importer => ({
      Url(node) {
        if (!/^[./]/.test(node.url)) {
          return // Ignore external URLs.
        }
        if (node.url.endsWith('.svg')) {
          const svgFile = config.resolve(node.url, importer)
          const svgText = fs.readFileSync(svgFile, 'utf8')
          return {
            url: svgToDataUri(svgText),
            loc: node.loc,
          }
        }
      },
    }),
  }
}
