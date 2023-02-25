#!/usr/bin/env node

import cac from 'cac'
import { EventEmitter } from 'events'
import { readdir, rm } from 'fs/promises'
import glob from 'glob'
import { cyan, red, yellow } from 'kleur/colors'
import * as path from 'path'
import { performance } from 'perf_hooks'
import { debounce } from 'ts-debounce'
import { parse as parseURL } from 'url'
import * as uuid from 'uuid'
import * as ws from 'ws'
import { Config, WebExtension } from '../config.mjs'
import { compileClientModule } from './esbuild.mjs'
import { buildEvents } from './events.mjs'
import { buildHTML } from './html.mjs'
import { HmrPlugin, Plugin, ServePlugin } from './plugin.mjs'
import { findFreeTcpPort, loadBundleConfig } from './utils.mjs'

const cli = cac('html-bundle')

cli
  .command('')
  .option('--watch', `[boolean]`)
  .option('--critical', `[boolean]`)
  .option('--webext <target>', 'Override webext config')
  .action(async flags => {
    const config = await loadBundleConfig(flags)
    glob(`${config.src}/**/*.html`, (err, files) => {
      if (err) {
        console.error(err)
        process.exit(1)
      }
      process.env.NODE_ENV = flags.watch ? 'development' : 'production'
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
    await rm(config.build, { force: true, recursive: true })
  }

  if (flags.watch) {
    const servePlugins = config.plugins.filter(p => p.serve) as ServePlugin[]
    if (servePlugins.length) {
      const http = await import('http')
      const server = http.createServer((req, response) => {
        const request = Object.assign(req, parseURL(req.url!)) as Plugin.Request
        const handled = servePlugins.some(p => p.serve(request, response))
        if (!handled) {
          response.statusCode = 404
          response.end()
        }
      })
      let port = config.server.port
      if (port == 0) {
        port = config.server.port = await findFreeTcpPort()
      }
      server.listen(port, () => {
        console.log(cyan('http server listening on port %s'), port)
      })
    }
  }

  const timer = performance.now()
  files = files.map(file => path.resolve(file))
  await Promise.all(files.map(file => buildHTML(file, config, flags)))
  console.log(
    cyan('build complete in %sms'),
    (performance.now() - timer).toFixed(2)
  )

  for (const plugin of config.plugins) {
    if (!plugin.buildEnd) continue
    await plugin.buildEnd?.(false)
  }

  if (flags.watch) {
    const hmrPlugins = config.plugins.filter(p => p.hmr) as HmrPlugin[]
    const hmrInstances: Plugin.HmrInstance[] = []

    if (hmrPlugins.length) {
      const events = new EventEmitter()
      const clients = new Set<Plugin.Client>()
      const context: Plugin.HmrContext = {
        clients,
        on: events.on.bind(events),
      }
      hmrPlugins.forEach(plugin => {
        hmrInstances.push(plugin.hmr(context))
      })
      const wss = new ws.WebSocketServer({
        port: config.server?.hmrPort ?? 5001,
      })
      const requests: Record<string, Function> = {}
      wss.on('connection', socket => {
        const pendingRequests = new Set<string>()
        const evaluate = (body: string, env: Record<string, any> = {}) => {
          const id = uuid.v4()
          return new Promise<any>(resolve => {
            requests[id] = resolve
            pendingRequests.add(id)
            socket.send(JSON.stringify({ id, body, env }))
          })
        }
        const client: Plugin.Client = {
          socket,
          events: new EventEmitter(),
          evaluate(expr) {
            return evaluate('module.exports = ' + expr)
          },
          async evaluateFile(file, env) {
            const code = await compileClientModule(file, config, 'cjs')
            return evaluate(code, env)
          },
          getURL() {
            return evaluate('location.href')
          },
          reload() {
            return evaluate('location.reload()')
          },
        }
        clients.add(client)
        socket.on('close', () => {
          for (const id of pendingRequests) {
            requests[id](null)
            delete requests[id]
          }
          clients.delete(client)
        })
        socket.on('message', data => {
          const event = JSON.parse(data.toString())
          if (event.type == 'result') {
            pendingRequests.delete(event.id)
            requests[event.id](event.result)
            delete requests[event.id]
          } else {
            event.client = client
            client.events.emit(event.type, event)
            events.emit(event.type, event)
          }
        })
        events.emit('connect', {
          type: 'connect',
          client,
        })
      })
    }

    const watcher = config.watcher!
    const changedFiles = new Set<string>()

    watcher.on('add', async file => {
      await rebuild()
      console.log(cyan('add'), file)
    })

    watcher.on('change', async file => {
      changedFiles.add(file)
      await rebuild()
    })

    watcher.on('unlink', async file => {
      const outPath = config.getBuildPath(file).replace(/\.[jt]sx?$/, '.js')
      try {
        await rm(outPath)
        let outDir = path.dirname(outPath)
        while (outDir !== config.build) {
          const stats = await readdir(outDir)
          if (stats.length) break
          await rm(outDir)
          outDir = path.dirname(outDir)
        }
      } catch {}
      console.log(red('delete'), file)
    })

    const rebuild = debounce(async () => {
      console.clear()

      let needRebuild = false

      const acceptedFiles = new Map<Plugin.HmrInstance, string[]>()
      accept: for (const file of changedFiles) {
        console.log(cyan('update'), file)
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
        buildEvents.emit('will-rebuild')
        const timer = performance.now()
        await Promise.all(files.map(file => buildHTML(file, config, flags)))
        buildEvents.emit('rebuild')
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
