import { findElements, getAttribute, getTagName, Node } from '@web/parse5-utils'
import browserslist from 'browserslist'
import browserslistToEsbuild from 'browserslist-to-esbuild'
import chokidar from 'chokidar'
import { EventEmitter } from 'events'
import { mkdir } from 'fs/promises'
import * as lightningCss from 'lightningcss'
import * as net from 'net'
import * as path from 'path'
import { loadConfig } from 'unconfig'
import { Config, UserConfig } from '../config.mjs'
import { Flags } from './bundle.mjs'
import { Plugin } from './plugin.mjs'

const env = JSON.stringify

export async function loadBundleConfig(flags: Flags) {
  const result = await loadConfig<UserConfig>({
    sources: [
      { files: 'bundle.config' },
      { files: 'package.json', rewrite: (config: any) => config?.bundle },
    ],
  })
  const defaultPlugins: Plugin[] = await Promise.all([
    unwrapDefault(import('./plugins/cssReload.mjs')),
    unwrapDefault(import('./plugins/liveScripts.mjs')),
  ])
  const userConfig = result.config as UserConfig
  if (flags.webext || userConfig.webext) {
    defaultPlugins.push(await unwrapDefault(import('./plugins/webext.mjs')))
  }
  const plugins = defaultPlugins.concat(userConfig.plugins || [])
  const targets = userConfig.targets ?? '>=0.25%, not dead'
  const srcDir = userConfig.src ?? 'src'
  const config: Config = {
    build: 'build',
    deletePrev: true,
    isCritical: false,
    targets,
    ...userConfig,
    src: srcDir,
    plugins: [],
    events: new EventEmitter(),
    watcher: flags.watch
      ? chokidar.watch(srcDir, { ignoreInitial: true })
      : undefined,
    copy: userConfig.copy ?? [],
    webext: userConfig.webext == true ? {} : userConfig.webext || undefined,
    htmlMinifierTerser: userConfig.htmlMinifierTerser ?? {},
    esbuild: {
      ...userConfig.esbuild,
      target: userConfig.esbuild?.target ?? browserslistToEsbuild(targets),
      define: {
        'import.meta.env.DEV': env(flags.watch),
        'process.env.NODE_ENV': env(process.env.NODE_ENV),
        ...userConfig.esbuild?.define,
      },
    } as any,
    lightningCss: {
      ...userConfig.lightningCss,
      targets:
        userConfig.lightningCss?.targets ??
        lightningCss.browserslistToTargets(browserslist(targets)),
      drafts: {
        nesting: true,
        ...userConfig.lightningCss?.drafts,
      },
    },
    server: {
      port: 0,
      ...userConfig.server,
    },
    getBuildPath(file) {
      const wasAbsolute = path.isAbsolute(file)
      if (wasAbsolute) {
        file = path.relative(process.cwd(), file)
      }
      const src = config.src.replace(/^\.\//, '') + '/'
      if (file.startsWith(src)) {
        file = file.replace(src, config.build + '/')
      } else {
        file = path.join(config.build, file)
      }
      if (wasAbsolute) {
        file = path.join(process.cwd(), file)
      }
      return file.replace(/\.([cm]?)(?:jsx|tsx?)$/, '.$1js')
    },
  }
  await Promise.all(
    plugins.map(async setup => {
      config.plugins.push(await setup(config, flags))
    })
  )
  return config
}

function unwrapDefault(m: Promise<any>) {
  return m.then(m => (m.default ? m.default : Object.values(m)[0]))
}

export function createDir(file: string) {
  return mkdir(path.dirname(file), { recursive: true })
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

export function findExternalScripts(rootNode: Node) {
  return findElements(
    rootNode,
    e => getTagName(e) === 'script' && !!getAttribute(e, 'src')
  )
}

export function findFreeTcpPort() {
  return new Promise<number>(resolve => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const freeTcpPort: number = (srv.address() as any).port
      srv.close(() => resolve(freeTcpPort))
    })
  })
}
