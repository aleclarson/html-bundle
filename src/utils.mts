import { findElements, getAttribute, getTagName, Node } from '@web/parse5-utils'
import { mkdir } from 'fs/promises'
import * as path from 'path'
import { loadConfig } from 'unconfig'
import { Config } from '../config.mjs'

export const bundleConfig = await loadConfig<Config>({
  defaults: {
    build: 'build',
    src: 'src',
    targets: '>=0.25%, not dead',
    esbuild: {},
    lightningCss: {},
    htmlMinifierTerser: {},
    isCritical: false,
    deletePrev: true,
  },
  sources: [
    { files: 'bundle.config' },
    { files: 'package.json', rewrite: (config: any) => config?.bundle },
  ],
}).then(r => {
  return {
    ...r.config,
    webext: r.config.webext == true ? {} : r.config.webext || undefined,
  }
})

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
