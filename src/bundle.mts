#!/usr/bin/env node

import cac from 'cac'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import glob from 'glob'
import { cyan, red, yellow } from 'kleur/colors'
import md5Hex from 'md5-hex'
import * as mime from 'mrmime'
import * as path from 'path'
import { performance } from 'perf_hooks'
import { debounce } from 'ts-debounce'
import { parse as parseURL } from 'url'
import * as uuid from 'uuid'
import * as ws from 'ws'
import { Config, WebExtension } from '../config.mjs'
import { compileClientModule } from './esbuild.mjs'
import { buildHTML } from './html.mjs'
import { HmrPlugin, Plugin, ServePlugin } from './plugin.mjs'
import { findFreeTcpPort, loadBundleConfig, lowercaseKeys } from './utils.mjs'

const cli = cac('html-bundle')

cli
  .command('')
  .option('--watch', `[boolean]`)
  .option('--critical', `[boolean]`)
  .option('--webext <target>', 'Override webext config')
  .action(async flags => {
    process.env.NODE_ENV ||= flags.watch ? 'development' : 'production'
    const config = await loadBundleConfig(flags)
    glob(`${config.src}/**/*.html`, (err, files) => {
      if (err) {
        console.error(err)
        process.exit(1)
      }
      build(files, config, flags)
    })
  })

cli.parse()

export interface Flags {
  watch?: boolean
  critical?: boolean
  webext?: WebExtension.RunTarget | WebExtension.RunTarget[]
}

async function build(files: string[], config: Config, flags: Flags) {
  if (config.deletePrev) {
    fs.rmSync(config.build, { force: true, recursive: true })
  }

  let server: import('http').Server | undefined
  if (flags.watch) {
    const servePlugins = config.plugins.filter(p => p.serve) as ServePlugin[]
    server = await installHttpServer(config, servePlugins)
  }

  // At this point, the dev server URL and port are known.
  config.esbuild.define['import.meta.env.DEV_URL'] = JSON.stringify(
    config.server.url
  )
  config.esbuild.define['import.meta.env.HMR_PORT'] = JSON.stringify(
    config.server.port
  )

  const timer = performance.now()
  files = files.map(file => path.resolve(file))
  await Promise.all(files.map(file => buildHTML(file, config, flags)))
  console.log(
    cyan('build complete in %sms'),
    (performance.now() - timer).toFixed(2)
  )

  for (const plugin of config.plugins) {
    if (!plugin.buildEnd) continue
    await plugin.buildEnd(false)
  }

  if (server) {
    const hmrInstances: Plugin.HmrInstance[] = []

    const hmrPlugins = config.plugins.filter(p => p.hmr) as HmrPlugin[]
    if (hmrPlugins.length) {
      await installWebSocketServer(server, config, hmrPlugins, hmrInstances)
    }

    const watcher = config.watcher!
    const changedFiles = new Set<string>()

    watcher.on('add', async file => {
      await rebuild()
      console.log(cyan('+'), file)
    })

    watcher.on('change', async file => {
      changedFiles.add(file)
      await rebuild()
    })

    watcher.on('unlink', async file => {
      const outPath = config.getBuildPath(file).replace(/\.[jt]sx?$/, '.js')
      try {
        fs.rmSync(outPath)
        let outDir = path.dirname(outPath)
        while (outDir !== config.build) {
          const stats = fs.readdirSync(outDir)
          if (stats.length) break
          fs.rmSync(outDir)
          outDir = path.dirname(outDir)
        }
      } catch {}
      console.log(red('–'), file)
    })

    const rebuild = debounce(async () => {
      console.clear()

      let needRebuild = false

      const acceptedFiles = new Map<Plugin.HmrInstance, string[]>()
      accept: for (const file of changedFiles) {
        console.log(cyan('↺'), file)
        for (const hmr of hmrInstances) {
          if (hmr.accept(file)) {
            let files = acceptedFiles.get(hmr)
            if (!files) {
              acceptedFiles.set(hmr, (files = []))
            }
            files.push(file)
            continue accept
          }
        }
        needRebuild = true
        break
      }
      changedFiles.clear()

      if (needRebuild) {
        config.events.emit('will-rebuild')
        const timer = performance.now()
        await Promise.all(files.map(file => buildHTML(file, config, flags)))
        config.events.emit('rebuild')

        for (const plugin of config.plugins) {
          if (!plugin.buildEnd) continue
          await plugin.buildEnd(true)
        }

        console.log(
          cyan('build complete in %sms'),
          (performance.now() - timer).toFixed(2)
        )
      } else {
        await Promise.all(
          Array.from(acceptedFiles, ([hmr, files]) => hmr.update(files))
        )
      }
      console.log(yellow('watching files...'))
    }, 200)

    console.log(yellow('watching files...'))
  }
}

async function installHttpServer(config: Config, servePlugins: ServePlugin[]) {
  let createServer: typeof import('http').createServer
  let serverOptions: import('https').ServerOptions | undefined
  if (config.server.https) {
    createServer = (await import('https')).createServer
    serverOptions = config.server.https
    if (!serverOptions.cert) {
      const cert = await getCertificate('node_modules/.html-bundle/self-signed')
      serverOptions.cert = cert
      serverOptions.key = cert
    }
  } else {
    createServer = (await import('http')).createServer
    serverOptions = {}
  }

  // The dev server allows access to files within these directories.
  const fsAllow = new RegExp(`^/(${[config.build, config.assets].join('|')})/`)

  const server = createServer(serverOptions, async (req, response) => {
    const request = Object.assign(req, parseURL(req.url!)) as Plugin.Request
    request.searchParams = new URLSearchParams(request.search || '')

    let file: Plugin.VirtualFileData | null = null
    for (const plugin of servePlugins) {
      file = (await plugin.serve(request, response)) || null
      if (response.headersSent) return
      if (file) break
    }

    // If no plugin handled the request, check the virtual filesystem.
    if (!file) {
      const uri = request.pathname

      let virtualFile = config.virtualFiles[uri]
      if (virtualFile) {
        if (typeof virtualFile == 'function') {
          virtualFile = virtualFile(request)
        }
        file = await virtualFile
      }

      // If no virtual file exists, check the local filesystem.
      if (!file && fsAllow.test(uri)) {
        try {
          file = {
            data: fs.readFileSync('.' + uri),
          }
        } catch {}
      }
    }

    if (file) {
      const headers = (file.headers && lowercaseKeys(file.headers)) || {}
      headers['access-control-allow-origin'] ||= '*'
      headers['cache-control'] ||= 'no-store'
      headers['content-type'] ||=
        mime.lookup(file.path || request.pathname) || 'application/octet-stream'

      response.statusCode = 200
      for (const [name, value] of Object.entries(headers)) {
        response.setHeader(name, value)
      }
      response.end(file.data)
      return
    }

    console.log(red('404: %s'), req.url)
    response.statusCode = 404
    response.end()
  })

  const protocol = config.server.https ? 'https' : 'http'
  const port =
    config.server.port == 0
      ? (config.server.port = await findFreeTcpPort())
      : config.server.port

  config.server.url = `${protocol}://localhost:${port}`
  server.listen(port, () => {
    console.log(cyan('%s server listening on port %s'), protocol, port)
  })

  return server
}

async function installWebSocketServer(
  server: import('http').Server,
  config: Config,
  hmrPlugins: HmrPlugin[],
  hmrInstances: Plugin.HmrInstance[]
) {
  const events = new EventEmitter()
  const clients = new Set<Plugin.Client>()
  const requests: Record<string, Function> = {}

  const context: Plugin.ClientSet = clients as any
  context.on = events.on.bind(events)

  hmrPlugins.forEach(plugin => {
    const instance = plugin.hmr(context)
    if (instance) {
      hmrInstances.push(instance)
    }
  })

  const evaluate = (client: Client, src: string, args: any[] = []) => {
    return new Promise<any>(resolve => {
      const id = uuid.v4()
      requests[id] = resolve
      client.pendingRequests.add(id)
      client.socket.send(
        JSON.stringify({
          id,
          src: new URL(src, config.server.url).href,
          args,
        })
      )
    })
  }

  const compiledModules = new Map<string, Plugin.VirtualFileData>()
  const runningModules = new Map<string, number>()

  class Client extends EventEmitter {
    readonly pendingRequests = new Set<string>()
    constructor(readonly socket: ws.WebSocket) {
      super()
    }
    evaluate(expr: string) {
      const path = `/${md5Hex(expr)}.js`
      config.virtualFiles[path] ||= {
        data: `export default () => ${expr}`,
      }
      return evaluate(this, path)
    }
    async evaluateModule(file: string, args?: any[]) {
      const moduleUrl = new URL(file, import.meta.url)
      const mtime = fs.statSync(moduleUrl).mtimeMs

      const path = `/${md5Hex(moduleUrl.href)}.${mtime}.js`
      if (config.virtualFiles[path] == null) {
        let compiled = compiledModules.get(moduleUrl.href)
        if (compiled?.mtime != mtime) {
          const data = await compileClientModule(file, config, 'esm')
          compiledModules.set(
            moduleUrl.href,
            (compiled = {
              path: moduleUrl.pathname,
              mtime,
              data,
            })
          )
        }
        config.virtualFiles[path] = compiled
      }

      let parallelCount = runningModules.get(path) || 0
      runningModules.set(path, parallelCount + 1)

      const result = await evaluate(this, path, args)

      parallelCount = runningModules.get(path)!
      runningModules.set(path, --parallelCount)
      if (parallelCount == 0) {
        delete config.virtualFiles[path]
      }

      return result
    }
    getURL() {
      return this.evaluate('location.href')
    }
    reload() {
      return this.evaluate('location.reload()')
    }
  }

  const wss = new ws.WebSocketServer({ server })
  wss.on('connection', socket => {
    const client = new Client(socket)
    clients.add(client)
    socket.on('close', () => {
      for (const id of client.pendingRequests) {
        requests[id](null)
        delete requests[id]
      }
      clients.delete(client)
    })
    socket.on('message', data => {
      const event = JSON.parse(data.toString())
      if (event.type == 'result') {
        client.pendingRequests.delete(event.id)
        requests[event.id](event.result)
        delete requests[event.id]
      } else {
        event.client = client
        client.emit(event.type, event)
        events.emit(event.type, event)
      }
    })
    events.emit('connect', {
      type: 'connect',
      client,
    })
  })
}

async function getCertificate(cacheDir: string) {
  const cachePath = path.join(cacheDir, '_cert.pem')
  try {
    const stat = fs.statSync(cachePath)
    const content = fs.readFileSync(cachePath, 'utf8')
    if (Date.now() - stat.ctime.valueOf() > 30 * 24 * 60 * 60 * 1000) {
      throw 'Certificate is too old'
    }
    return content
  } catch {
    const content = (
      await import('./https/createCertificate.mjs')
    ).createCertificate()
    try {
      fs.mkdirSync(cacheDir, { recursive: true })
      fs.writeFileSync(cachePath, content)
    } catch {}
    return content
  }
}
