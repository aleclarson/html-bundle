import type { Plugin } from '@alloc/html-bundle'
import type { UserConfig } from '@unocss/core'
import {
  createElement,
  findElement,
  getTagName,
  prepend,
  setTextContent,
} from '@web/parse5-utils'
import md5Hex from 'md5-hex'
import path from 'path'
import { createContext } from './context.mjs'

const VIRTUAL_PREFIX = '/@unocss/'
// const SCOPE_IMPORT_RE = / from (['"])(@unocss\/scope)\1/

export const unocssPlugin =
  <Theme extends {} = {}>(options?: UserConfig<Theme>): Plugin =>
  config => {
    const moduleMap = new Map<string, [string, string]>()
    const { uno, filter } = createContext(options)

    let cache: Record<string, string | null> | undefined
    if (config.watcher) {
      cache = {}
      config.watcher.on('change', file => {
        file = path.resolve(file)
        delete cache![file]
      })
    }

    config.esbuild.plugins ||= []
    config.esbuild.plugins.push({
      name: 'unocss:esbuild',
      setup(build) {
        build.onTransform({ loaders: ['tsx', 'jsx'] }, async args => {
          if (!filter(args.code, args.path)) {
            return null
          }

          const id = args.path

          let css = cache?.[id]
          if (css == null) {
            const unoResult = await uno.generate(args.code, {
              id,
              preflights: false,
            })
            css = unoResult.matched.size > 0 ? unoResult.css : null
            if (cache) {
              cache[id] = css
            }
            if (css == null) {
              return null
            }
          }

          const hash = md5Hex(id)
          const cssPath = `${VIRTUAL_PREFIX}${hash}.css`

          config.virtualFiles[cssPath] = {
            data: `\n/* unocss ${path.relative(process.cwd(), id)} */\n${css}`,
          }

          // TODO: use this for HMR updates
          moduleMap.set(id, [md5Hex(css), cssPath])

          return {
            code: `import "${cssPath}";${args.code}`,
            map: null,
          }
        })
      },
    })

    return {
      async document(root, file) {
        const headTag = findElement(root, node => getTagName(node) === 'head')
        if (!headTag) {
          throw Error('No <head> tag found in document: ' + file)
        }
        const { css: preflights } = await uno.generate('')
        const styleTag = createElement('style', { type: 'text/css' })
        setTextContent(styleTag, preflights)
        prepend(headTag, styleTag)
      },
    }
  }
