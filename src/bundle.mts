#!/usr/bin/env node

import {
  appendChild,
  Attribute,
  createScript,
  findElement,
  Node,
  ParentNode,
} from '@web/parse5-utils'
import browserslist from 'browserslist'
import browserslistToEsbuild from 'browserslist-to-esbuild'
import * as chokidar from 'chokidar'
import Critters from 'critters'
import * as esbuild from 'esbuild'
import importGlobPlugin from 'esbuild-plugin-import-glob'
import { existsSync } from 'fs'
import { readdir, readFile, rm, writeFile } from 'fs/promises'
import glob from 'glob'
import { minify } from 'html-minifier-terser'
import { cyan, gray, green, red, yellow } from 'kleur/colors'
import * as lightningcss from 'lightningcss'
import md5Hex from 'md5-hex'
import { parse, parseFragment, serialize } from 'parse5'
import * as path from 'path'
import { performance } from 'perf_hooks'
import { debounce } from 'ts-debounce'
import * as ws from 'ws'
import {
  bundleConfig,
  createDir,
  findExternalScripts,
  findStyleSheets,
  getBuildPath,
} from './utils.mjs'

const isCritical =
  process.argv.includes('--isCritical') || bundleConfig.isCritical
const critters = new Critters({
  path: bundleConfig.build,
  logLevel: 'silent',
})

const isWatchMode = process.argv.includes('--watch')
const hmrClients = new Set<ws.WebSocket>()
const cssEntries = new Map<string, string>()

process.env.NODE_ENV = isWatchMode ? 'development' : 'production'

glob(`${bundleConfig.src}/**/*.html`, build)

async function build(err: any, files: string[]) {
  if (err) {
    console.error(err)
    process.exit(1)
  }

  if (bundleConfig.deletePrev) {
    await rm(bundleConfig.build, { force: true, recursive: true })
  }

  const timer = performance.now()
  files = files.map(file => path.resolve(file))
  await Promise.all(files.map(buildHTML))
  console.log(
    cyan('build complete in %sms'),
    (performance.now() - timer).toFixed(2)
  )

  if (isWatchMode) {
    const wss = new ws.WebSocketServer({ port: 5001 })
    wss.on('connection', ws => {
      hmrClients.add(ws)
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

    const rebuild = debounce(() => {
      let isHtmlUpdate = false
      let isHmrUpdate = false
      changedFiles.forEach(file => {
        console.log(cyan('update'), file)
        if (file.endsWith('.css')) {
          isHmrUpdate = true
        } else {
          isHtmlUpdate = true
        }
      })
      changedFiles.clear()
      if (isHmrUpdate && hmrClients.size) {
        const hmrUpdates: object[] = []
        cssEntries.forEach((_hash, file) => {
          if (!existsSync(file)) {
            cssEntries.delete(file)
            return
          }
          buildCSSFile(file).then(result => {
            if (result.changed) {
              hmrUpdates.push({
                file: '/' + path.relative(process.cwd(), result.outFile),
                type: 'css',
              })
            }
          })
        })
        hmrClients.forEach(client => {
          for (const update of hmrUpdates) {
            client.send(JSON.stringify(update))
          }
        })
      }
      if (isHtmlUpdate) {
        const timer = performance.now()
        Promise.all(files.map(buildHTML)).then(() => {
          console.log(
            gray('build complete in %sms'),
            (performance.now() - timer).toFixed(2)
          )
        })
      }
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

async function buildHTML(file: string) {
  let html = await readFile(file, 'utf8')
  if (!html) {
    return
  }

  const document = parseHTML(html)
  await Promise.all([
    buildLocalScripts(document, file),
    buildLocalStyles(document, file),
  ])

  if (isWatchMode) {
    const hmrScript = createScript({}, await getHMRScript())
    const head = findElement(document, e => e.tagName === 'head')!
    appendChild(head, hmrScript)
  }

  html = serialize(document)

  if (!isWatchMode) {
    try {
      html = await minify(html, {
        collapseWhitespace: true,
        removeComments: true,
        ...bundleConfig['html-minifier-terser'],
      })
    } catch (e) {
      console.error(e)
    }
  }

  if (!isWatchMode && isCritical) {
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

  const outFile = getBuildPath(file)
  await createDir(outFile)
  await writeFile(outFile, html)
  return html
}

async function buildLocalScripts(document: Node, file: string) {
  const outDir = path.dirname(getBuildPath(file))
  const entryScripts: { srcAttr: Attribute; srcPath: string }[] = []
  for (const scriptNode of findExternalScripts(document)) {
    const srcAttr = scriptNode.attrs.find(a => a.name === 'src')
    if (srcAttr?.value.startsWith('./')) {
      entryScripts.push({
        srcAttr,
        srcPath: path.join(path.dirname(file), srcAttr.value),
      })
    }
  }
  const esTargets = browserslistToEsbuild(bundleConfig.targets)
  await Promise.all(
    entryScripts.map(script => {
      console.log(green(path.relative(process.cwd(), script.srcPath)))
      return esbuild
        .build({
          entryPoints: [script.srcPath],
          plugins: [importGlobPlugin.default()],
          charset: 'utf8',
          format: 'esm',
          target: esTargets,
          sourcemap: isWatchMode ? 'inline' : false,
          define: {
            'process.env.NODE_ENV': `"${process.env.NODE_ENV}"`,
          },
          splitting: true,
          bundle: true,
          minify: !isWatchMode,
          outdir: bundleConfig.build,
          outbase: bundleConfig.src,
          ...bundleConfig.esbuild,
        })
        .then(() => {
          const outPath = getBuildPath(script.srcPath).replace(
            /\.[tj]sx?$/,
            '.js'
          )
          script.srcAttr.value = './' + path.relative(outDir, outPath)
        })
    })
  )
}

function getCSSTargets() {
  return lightningcss.browserslistToTargets(browserslist(bundleConfig.targets))
}

async function buildCSSFile(file: string, cssTargets = getCSSTargets()) {
  console.log(green(path.relative(process.cwd(), file)))
  const result = await lightningcss.bundleAsync({
    filename: file,
    drafts: { nesting: true },
    targets: cssTargets,
    minify: !isWatchMode,
    sourceMap: isWatchMode,
    ...bundleConfig.lightningcss,
  })

  const prevHash = cssEntries.get(file)
  const hash = md5Hex(result.code)
  cssEntries.set(file, hash)

  const outFile = getBuildPath(file)
  await createDir(outFile)
  await writeFile(outFile, result.code)
  if (result.map) {
    await writeFile(outFile + '.map', result.map)
  }

  return { ...result, changed: hash != prevHash, outFile }
}

async function buildLocalStyles(document: Node, file: string) {
  const outDir = path.dirname(getBuildPath(file))
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
      buildCSSFile(style.srcPath, cssTargets).then(async result => {
        style.srcAttr.value = './' + path.relative(outDir, result.outFile)
      })
    )
  )
}

let hmrScriptPromise: Promise<string>

function getHMRScript() {
  return (hmrScriptPromise ||= (async () => {
    const hmrScriptPath = new URL('./hmr.js', import.meta.url).pathname
    return esbuild
      .build({
        entryPoints: [hmrScriptPath],
        minify: true,
        write: false,
      })
      .then(result => {
        return result.outputFiles[0].text
      })
  })())
}
