import { findElements, getAttribute, getTagName, Node } from '@web/parse5-utils'
import { copyFile, mkdir } from 'fs/promises'
import * as path from 'path'

export const bundleConfig = await getBundleConfig()

export function fileCopy(file: string) {
  return copyFile(file, getBuildPath(file))
}

export function createDir(file: string) {
  return mkdir(path.dirname(file), { recursive: true })
}

export function getBuildPath(file: string) {
  return file.replace(`${bundleConfig.src}/`, `${bundleConfig.build}/`)
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

async function getBundleConfig() {
  const base = {
    build: 'build',
    src: 'src',
    port: 5000,
    targets: '>=0.25%, not dead',
    esbuild: {},
    lightningcss: {},
    'html-minifier-terser': {},
    critical: {},
    deletePrev: true,
  }

  try {
    const cfgPath = path.resolve(process.cwd(), 'bundle.config.js')
    const config = await import(`file://${cfgPath}`)
    return { ...base, ...config.default }
  } catch {
    return base
  }
}
