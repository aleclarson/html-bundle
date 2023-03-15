import { findElements, getAttribute, getTagName, Node } from '@web/parse5-utils'
import browserslist from 'browserslist'
import browserslistToEsbuild from 'browserslist-to-esbuild'
import chokidar from 'chokidar'
import { EventEmitter } from 'events'
import { mkdir } from 'fs/promises'
import glob from 'glob'
import * as lightningCss from 'lightningcss'
import * as net from 'net'
import * as path from 'path'
import { loadConfig } from 'unconfig'
import { promisify } from 'util'
import { Config, ConfigAPI, ServerConfig, UserConfig } from '../config.mjs'
import { Flags } from './cli.mjs'
import { Plugin } from './plugin.mjs'

const env = JSON.stringify

export async function loadBundleConfig(flags: Flags) {
  const nodeEnv = (process.env.NODE_ENV ||= 'development')
  const result = await loadConfig<UserConfig>({
    sources: [
      { files: 'bundle.config' },
      { files: 'package.json', rewrite: (config: any) => config?.bundle },
    ],
  })

  const userConfig = result.config as UserConfig
  const defaultPlugins: Plugin[] = [
    await loadPlugin(import('./plugins/cssCodeSplit.mjs')),
  ]
  if (flags.watch) {
    defaultPlugins.push(
      await loadPlugin(import('./plugins/cssReload.mjs')),
      await loadPlugin(import('./plugins/liveScripts.mjs'))
    )
  }
  if (flags.webext || userConfig.webext) {
    defaultPlugins.push(
      await loadPlugin(import('./plugins/webext.mjs')) //
    )
  }

  const srcDir = userConfig.src ?? 'src'
  const entries = (await promisify(glob)(srcDir + '/**/*.html')).map(file => ({
    file,
  }))

  let scripts: string[] | undefined
  if (userConfig.scripts) {
    const matches = await Promise.all(
      userConfig.scripts.map(p => promisify(glob)(p))
    )
    scripts = Array.from(new Set(matches.flat()), p => path.resolve(p))
  }

  const plugins = defaultPlugins.concat(userConfig.plugins || [])
  const browsers = userConfig.browsers ?? '>=0.25%, not dead'
  const server = await loadServerConfig(userConfig.server || {})

  const api: ConfigAPI = {
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
    resolveDevUrl(id, importer) {
      let url = config.resolve(id, importer)
      if (url.protocol == 'file:') {
        url = new URL(baseRelative(url.pathname), config.server.url)
      }
      return url
    },
    resolve(id, importer = config.server.url) {
      if (typeof importer == 'string') {
        importer = new URL(importer, 'file:')
      }
      if (id[0] == '/' && importer.protocol == 'file:') {
        return new URL('file://' + process.cwd() + id)
      }
      return new URL(id, importer)
    },
  }

  const config: Config = {
    build: 'build',
    assets: 'public',
    deletePrev: false,
    isCritical: false,
    ...userConfig,
    mode: nodeEnv,
    src: srcDir,
    entries,
    plugins: [],
    events: new EventEmitter(),
    virtualFiles: {},
    browsers,
    watcher: flags.watch
      ? chokidar.watch(srcDir, { ignoreInitial: true })
      : undefined,
    copy: userConfig.copy ?? [],
    scripts: scripts || [],
    webext: userConfig.webext == true ? {} : userConfig.webext || undefined,
    htmlMinifierTerser: userConfig.htmlMinifierTerser ?? {},
    esbuild: {
      ...userConfig.esbuild,
      target: userConfig.esbuild?.target ?? browserslistToEsbuild(browsers),
      define: {
        ...userConfig.esbuild?.define,
        'process.env.NODE_ENV': env(nodeEnv),
        'import.meta.env.DEV': env(nodeEnv == 'development'),
        'import.meta.env.DEV_URL': env(server.url),
        'import.meta.env.HMR_PORT': env(server.port),
      },
    } as any,
    lightningCss: {
      ...userConfig.lightningCss,
      targets:
        userConfig.lightningCss?.targets ??
        lightningCss.browserslistToTargets(browserslist(browsers)),
      drafts: {
        nesting: true,
        ...userConfig.lightningCss?.drafts,
      },
    },
    server: flags.watch ? server : ({} as any),
    ...api,
  }

  await Promise.all(
    plugins.map(async setup => {
      config.plugins.push(await setup(config, flags))
    })
  )

  return config
}

async function loadServerConfig(config: ServerConfig) {
  const https = config.https != true ? config.https || undefined : {}
  const protocol = https ? 'https' : 'http'

  let port = config.port || 0
  if (port == 0) {
    port = await findFreeTcpPort()
  }

  return {
    ...config,
    https,
    port,
    url: new URL(`${protocol}://localhost:${port}`),
  }
}

async function loadPlugin(plugin: Promise<any>) {
  const module = await plugin
  return module.default ? module.default : Object.values(module)[0]
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

export function lowercaseKeys<T extends object>(obj: T): T {
  const result: any = {}
  for (const [key, value] of Object.entries(obj)) {
    result[key.toLowerCase()] = value
  }
  return result
}
