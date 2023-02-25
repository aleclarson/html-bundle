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
  const wasAbsolute = path.isAbsolute(file)
  if (wasAbsolute) {
    file = path.relative(process.cwd(), file)
  }
  const src = bundleConfig.src.replace(/^\.\//, '') + '/'
  if (file.startsWith(src)) {
    file = file.replace(src, bundleConfig.build + '/')
  } else {
    file = path.join(bundleConfig.build, file)
  }
  if (wasAbsolute) {
    file = path.join(process.cwd(), file)
  }
  return file
}

export function toArray<T>(value: T | T[]) {
  return Array.isArray(value) ? value : [value]
}

export function resolveHome(file: string): string
export function resolveHome(file: string | undefined): string | undefined
export function resolveHome(file: string | undefined) {
  if (file?.startsWith('~')) {
    file = path.join(process.env.HOME || '', file.slice(1))
  }
  return file
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
