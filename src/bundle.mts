#!/usr/bin/env node

import {
  appendChild,
  Attribute,
  createScript,
  findElement,
  getAttribute,
  Node,
  ParentNode,
} from '@web/parse5-utils'
import browserslist from 'browserslist'
import browserslistToEsbuild from 'browserslist-to-esbuild'
import cac from 'cac'
import * as chokidar from 'chokidar'
import Critters from 'critters'
import * as esbuild from 'esbuild'
import importGlobPlugin from 'esbuild-plugin-import-glob'
import metaUrlPlugin from 'esbuild-plugin-meta-url'
import { existsSync } from 'fs'
import { copyFile, readdir, readFile, rm, writeFile } from 'fs/promises'
import glob from 'glob'
import { minify } from 'html-minifier-terser'
import { cyan, gray, red, yellow } from 'kleur/colors'
import * as lightningCss from 'lightningcss'
import md5Hex from 'md5-hex'
import { parse, parseFragment, serialize } from 'parse5'
import * as path from 'path'
import { performance } from 'perf_hooks'
import { debounce } from 'ts-debounce'
import * as ws from 'ws'
import { WebExtension } from '../config.mjs'
import { buildEvents, hmrClientEvents } from './events.mjs'
import {
  baseRelative,
  bundleConfig,
  createDir,
  findExternalScripts,
  findStyleSheets,
  getBuildPath,
  relative,
} from './utils.mjs'
import { enableWebExtension } from './webext.mjs'

const critters = new Critters({
  path: bundleConfig.build,
  logLevel: 'silent',
})

const hmrClients = new Set<ws.WebSocket>()
const cssEntries = new Map<string, string>()

const cli = cac('html-bundle')

cli
  .command('')
  .option('--watch', `[boolean]`)
  .option('--critical', `[boolean]`, { default: bundleConfig.isCritical })
  .option('--webext <target>', 'Override webext config')
  .action(async options => {
    glob(`${bundleConfig.src}/**/*.html`, (err, files) => {
      if (err) {
        console.error(err)
        process.exit(1)
      }
      process.env.NODE_ENV = options.watch ? 'development' : 'production'
      build(files, options)
    })
  })

cli.parse()

export interface Flags {
  watch?: boolean
  critical?: boolean
  webext?: WebExtension.RunTarget | WebExtension.RunTarget[]
}

async function build(files: string[], flags: Flags) {
  if (bundleConfig.deletePrev) {
    await rm(bundleConfig.build, { force: true, recursive: true })
  }

  const timer = performance.now()
  files = files.map(file => path.resolve(file))
  await Promise.all(files.map(file => buildHTML(file, flags)))
  console.log(
    cyan('build complete in %sms'),
    (performance.now() - timer).toFixed(2)
  )

  if (flags.webext || bundleConfig.webext) {
    await enableWebExtension(flags)
  }

  if (flags.watch) {
    const wss = new ws.WebSocketServer({ port: 5001 })
    wss.on('connection', ws => {
      hmrClients.add(ws)
      ws.on('close', () => hmrClients.delete(ws))
      ws.on('message', data => {
        const { type, ...event } = JSON.parse(data.toString())
        hmrClientEvents.emit(type, event)
      })
    })

    const watcher = chokidar.watch(bundleConfig.src, { ignoreInitial: true })
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
      const outPath = getBuildPath(file).replace(/\.[jt]sx?$/, '.js')
      try {
        await rm(outPath)
        let outDir = path.dirname(outPath)
        while (outDir !== bundleConfig.build) {
          const stats = await readdir(outDir)
          if (stats.length) break
          await rm(outDir)
          outDir = path.dirname(outDir)
        }
      } catch {}
      console.log(red('delete'), file)
    })

    const rebuild = debounce(async () => {
      let isHtmlUpdate = false
      let isHotUpdate = false
      console.clear()
      changedFiles.forEach(file => {
        console.log(cyan('update'), file)
        if (file.endsWith('.css')) {
          isHotUpdate = true
        } else {
          isHtmlUpdate = true
        }
      })
      changedFiles.clear()
      if (isHtmlUpdate) {
        buildEvents.emit('will-rebuild')
        const timer = performance.now()
        await Promise.all(files.map(file => buildHTML(file, flags)))
        const fullReload = JSON.stringify({ type: 'full-reload' })
        hmrClients.forEach(client => client.send(fullReload))
        buildEvents.emit('rebuild')
        console.log(
          cyan('build complete in %sms'),
          (performance.now() - timer).toFixed(2)
        )
      } else if (isHotUpdate && hmrClients.size) {
        const hmrUpdates: string[] = []
        await Promise.all(
          Array.from(cssEntries.keys(), async (file, i) => {
            if (existsSync(file)) {
              const { changed, outFile, code } = await buildCSSFile(file, flags)
              if (changed) {
                hmrUpdates[i] = JSON.stringify({
                  type: 'css',
                  file: baseRelative(outFile),
                  code: code.toString('utf8'),
                })
              }
            } else {
              cssEntries.delete(file)
            }
          })
        )
        if (hmrUpdates.length) {
          hmrClients.forEach(client => {
            hmrUpdates.forEach(update => client.send(update))
          })
        }
      }
      console.log(yellow('watching files...'))
    }, 200)

    console.log(yellow('watching files...'))
  }
}

function parseHTML(html: string) {
  return (
    html.includes('<!DOCTYPE html>') || html.includes('<html')
      ? parse(html)
      : parseFragment(html)
  ) as ParentNode
}

async function buildHTML(file: string, flags: Flags) {
  let html = await readFile(file, 'utf8')
  if (!html) return

  const outFile = getBuildPath(file)

  const document = parseHTML(html)
  await Promise.all([
    buildLocalScripts(document, file, flags),
    buildLocalStyles(document, file, flags),
  ])

  if (flags.watch) {
    const hmrClientCode = await getHMRClient()
    const hmrClientPath = path.resolve(bundleConfig.build, 'hmr.mjs')
    await writeFile(hmrClientPath, hmrClientCode)
    const hmrScript = createScript({
      type: 'module',
      src: relative(outFile, hmrClientPath),
    })
    const head = findElement(document, e => e.tagName === 'head')!
    appendChild(head, hmrScript)
  }

  html = serialize(document)

  if (!flags.watch) {
    try {
      html = await minify(html, {
        collapseWhitespace: true,
        removeComments: true,
        ...bundleConfig.htmlMinifierTerser,
      })
    } catch (e) {
      console.error(e)
    }

    if (flags.critical) {
      try {
        const isPartical = !html.startsWith('<!DOCTYPE html>')
        html = await critters.process(html)
        // fix critters jsdom
        if (isPartical) {
          html = html.replace(/<\/?(html|head|body)>/g, '')
        }
      } catch (err) {
        console.error(err)
      }
    }
  }

  await createDir(outFile)
  await writeFile(outFile, html)

  if (bundleConfig.copy) {
    let copied = 0
    for (const path of bundleConfig.copy) {
      if (glob.hasMagic(path)) {
        glob(path, (err, files) => {
          if (err) {
            console.error(err)
          } else {
            files.forEach(async file => {
              const outPath = getBuildPath(path)
              await createDir(outPath)
              await copyFile(file, outPath)
              copied++
            })
          }
        })
      } else {
        const outPath = getBuildPath(path)
        await createDir(outPath)
        await copyFile(path, outPath)
        copied++
      }
    }
    console.log(cyan('copied %s %s'), copied, copied == 1 ? 'file' : 'files')
  }

  return html
}

async function buildLocalScripts(document: Node, file: string, flags: Flags) {
  const entryScriptsByOutPath: Record<string, any> = {}
  const entryScripts: {
    srcPath: string
    outPath: string
    isModule: boolean
  }[] = []

  for (const scriptNode of findExternalScripts(document)) {
    const srcAttr = scriptNode.attrs.find(a => a.name === 'src')
    if (srcAttr?.value.startsWith('./')) {
      const srcPath = path.join(path.dirname(file), srcAttr.value)
      console.log(yellow('⌁'), baseRelative(srcPath))
      const outPath = getBuildPath(srcPath).replace(/\.[tj]sx?$/, '.js')
      srcAttr.value = baseRelative(outPath)
      entryScripts.push(
        (entryScriptsByOutPath[outPath] = {
          srcPath,
          outPath,
          isModule: getAttribute(scriptNode, 'type') === 'module',
        })
      )
    }
  }

  const targets = browserslistToEsbuild(bundleConfig.targets)
  const esbuildOpts = bundleConfig.esbuild

  try {
    await esbuild.build({
      format: 'esm',
      charset: 'utf8',
      splitting: true,
      sourcemap: flags.watch,
      minify: !flags.watch,
      ...esbuildOpts,
      bundle: true,
      entryPoints: entryScripts.map(script => script.srcPath),
      outdir: bundleConfig.build,
      outbase: bundleConfig.src,
      target: targets,
      plugins: [
        metaUrlPlugin(),
        importGlobPlugin(),
        ...(esbuildOpts.plugins || []),
      ],
      define: {
        'process.env.NODE_ENV': `"${process.env.NODE_ENV}"`,
        ...esbuildOpts.define,
      },
    })
  } catch (e) {
    console.error(e)
  }
}

function getCSSTargets() {
  return lightningCss.browserslistToTargets(browserslist(bundleConfig.targets))
}

async function buildCSSFile(
  srcPath: string,
  flags: Flags,
  cssTargets = getCSSTargets()
) {
  console.log(yellow('⌁'), baseRelative(srcPath))
  const result = await lightningCss.bundleAsync({
    targets: cssTargets,
    minify: !flags.watch,
    sourceMap: flags.watch,
    errorRecovery: true,
    resolver: {
      resolve(specifier, originatingFile) {
        if (/^\.\.?(\/|$)/.test(specifier)) {
          return path.resolve(path.dirname(originatingFile), specifier)
        }
        // Assume bare imports are found in root node_modules.
        return path.resolve('node_modules', specifier)
      },
    },
    ...bundleConfig.lightningCss,
    filename: srcPath,
    drafts: {
      nesting: true,
      ...bundleConfig.lightningCss?.drafts,
    },
  })

  if (result.warnings.length) {
    console.warn('')
    result.warnings.forEach(w => {
      console.warn(red(w.type), w.message)
      console.warn(
        ' ',
        gray(
          baseRelative(w.loc.filename).slice(1) +
            ':' +
            w.loc.line +
            ':' +
            w.loc.column
        )
      )
    })
    console.warn('')
  }

  const prevHash = cssEntries.get(srcPath)
  const hash = md5Hex(result.code)
  cssEntries.set(srcPath, hash)

  const outFile = getBuildPath(srcPath)
  await createDir(outFile)
  await writeFile(outFile, result.code)
  if (result.map) {
    await writeFile(outFile + '.map', result.map)
  }

  return { ...result, changed: hash != prevHash, outFile }
}

async function buildLocalStyles(document: Node, file: string, flags: Flags) {
  const entryStyles: { srcAttr: Attribute; srcPath: string }[] = []
  for (const styleNode of findStyleSheets(document)) {
    const srcAttr = styleNode.attrs.find(a => a.name === 'href')
    if (srcAttr?.value.startsWith('./')) {
      entryStyles.push({
        srcAttr,
        srcPath: path.join(path.dirname(file), srcAttr.value),
      })
    }
  }
  const cssTargets = getCSSTargets()
  await Promise.all(
    entryStyles.map(style =>
      buildCSSFile(style.srcPath, flags, cssTargets)
        .then(async result => {
          style.srcAttr.value = baseRelative(result.outFile)
        })
        .catch(e => {
          console.error(
            'Failed to compile "%s":',
            baseRelative(style.srcPath),
            e
          )
        })
    )
  )
}

let hmrClientPromise: Promise<string>

function getHMRClient() {
  return (hmrClientPromise ||= (async () => {
    const hmrScriptPath = new URL('./hmr.js', import.meta.url).pathname
    return esbuild
      .build({
        entryPoints: [hmrScriptPath],
        // minify: true,
        write: false,
      })
      .then(result => {
        return result.outputFiles[0].text
      })
  })())
}
