import { findElements, getAttribute, getTagName, Node } from '@web/parse5-utils'
import { mkdir } from 'fs/promises'
import * as path from 'path'
import { loadConfig } from 'unconfig'

type Config = {
  type?: 'web-extension'
  src: string
  build: string
  targets: string
  esbuild: any
  lightningcss: any
  'html-minifier-terser': any
  isCritical: boolean
  deletePrev: boolean
}

export const bundleConfig = await loadConfig<Config>({
  defaults: {
    build: 'build',
    src: 'src',
    targets: '>=0.25%, not dead',
    esbuild: {},
    lightningcss: {},
    'html-minifier-terser': {},
    isCritical: false,
    deletePrev: true,
  },
  sources: [
    { files: 'bundle.config' },
    { files: 'package.json', rewrite: (config: any) => config?.bundle },
  ],
}).then(r => r.config)

export function createDir(file: string) {
  return mkdir(path.dirname(file), { recursive: true })
}

export function getBuildPath(file: string) {
  return file.replace(`${bundleConfig.src}/`, `${bundleConfig.build}/`)
}

export function baseRelative(file: string) {
  return '/' + path.relative(process.cwd(), file)
}

export function relative(from: string, to: string) {
  let result = path.relative(path.dirname(from), to)
  if (!result.startsWith('.')) {
    result = './' + result
  }
  return result
}

export function findStyleSheets(rootNode: Node) {
  return findElements(
    rootNode,
    e => getTagName(e) === 'link' && getAttribute(e, 'rel') === 'stylesheet'
  )
}

export function findExternalScripts(rootNode: Node) {
  return findElements(
    rootNode,
    e => getTagName(e) === 'script' && !!getAttribute(e, 'src')
  )
}
