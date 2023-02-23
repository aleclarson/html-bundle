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
import { execa } from 'execa'
import { existsSync } from 'fs'
import { readdir, readFile, rm, writeFile } from 'fs/promises'
import glob from 'glob'
import { minify } from 'html-minifier-terser'
import { cyan, gray, green, red, yellow } from 'kleur/colors'
import * as lightningCss from 'lightningcss'
import md5Hex from 'md5-hex'
import { parse, parseFragment, serialize } from 'parse5'
import * as path from 'path'
import { performance } from 'perf_hooks'
import { debounce } from 'ts-debounce'
import * as ws from 'ws'
import {
  baseRelative,
  bundleConfig,
  createDir,
  findExternalScripts,
  findStyleSheets,
  getBuildPath,
  relative,
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

  if (bundleConfig.type == 'web-extension') {
    await packWebExtension()
  }

  if (isWatchMode) {
    const wss = new ws.WebSocketServer({ port: 5001 })
    wss.on('connection', ws => {
      hmrClients.add(ws)
      ws.on('close', () => hmrClients.delete(ws))
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
        const timer = performance.now()
        await Promise.all(files.map(buildHTML))
        const fullReload = JSON.stringify({ type: 'full-reload' })
        hmrClients.forEach(client => client.send(fullReload))
        console.log(
          gray('build complete in %sms'),
          (performance.now() - timer).toFixed(2)
        )
      } else if (isHotUpdate && hmrClients.size) {
        const hmrUpdates: string[] = []
        await Promise.all(
          Array.from(cssEntries.keys(), async (file, i) => {
            if (existsSync(file)) {
              const { changed, outFile, code } = await buildCSSFile(file)
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

async function buildHTML(file: string) {
  let html = await readFile(file, 'utf8')
  if (!html) return

  const outFile = getBuildPath(file)

  const document = parseHTML(html)
  await Promise.all([
    buildLocalScripts(document, file),
    buildLocalStyles(document, file),
  ])

  if (isWatchMode) {
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

    if (isCritical) {
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
  return html
}

async function buildLocalScripts(document: Node, file: string) {
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
      const esbuildOpts = bundleConfig.esbuild
      return esbuild
        .build({
          format: 'esm',
          charset: 'utf8',
          sourcemap: isWatchMode ? 'inline' : false,
          splitting: true,
          minify: !isWatchMode,
          ...esbuildOpts,
          bundle: true,
          entryPoints: [script.srcPath],
          outdir: bundleConfig.build,
          outbase: bundleConfig.src,
          target: esTargets,
          plugins: [importGlobPlugin(), ...(esbuildOpts.plugins || [])],
          define: {
            'process.env.NODE_ENV': `"${process.env.NODE_ENV}"`,
            ...esbuildOpts.define,
          },
        })
        .then(() => {
          const outPath = getBuildPath(script.srcPath).replace(
            /\.[tj]sx?$/,
            '.js'
          )
          script.srcAttr.value = baseRelative(outPath)
        })
    })
  )
}

function getCSSTargets() {
  return lightningCss.browserslistToTargets(browserslist(bundleConfig.targets))
}

async function buildCSSFile(file: string, cssTargets = getCSSTargets()) {
  console.log(green(path.relative(process.cwd(), file)))
  const result = await lightningCss.bundleAsync({
    filename: file,
    drafts: { nesting: true },
    targets: cssTargets,
    minify: !isWatchMode,
    sourceMap: isWatchMode,
    errorRecovery: true,
    ...bundleConfig.lightningcss,
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
        style.srcAttr.value = baseRelative(result.outFile)
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

async function packWebExtension() {
  const ignoredFiles = new Set(await readdir(process.cwd()))
  const keepFile = (file: unknown) =>
    typeof file == 'string' && ignoredFiles.delete(file.split('/')[0])

  keepFile(bundleConfig.build)
  keepFile('manifest.json')
  keepFile('public')

  const manifest = JSON.parse(await readFile('manifest.json', 'utf8'))
  keepFile(manifest.browser_action?.default_icon)
  keepFile(manifest.browser_action?.default_popup)
  manifest.chrome_url_overrides &&
    Object.values(manifest.chrome_url_overrides).forEach(keepFile)
  manifest.icons && Object.values(manifest.icons).forEach(keepFile)
  manifest.background?.scripts?.forEach(keepFile)
  manifest.content_scripts?.forEach(
    ({ css, js }: { css?: string[]; js?: string[] }) => {
      css?.forEach(keepFile)
      js?.forEach(keepFile)
    }
  )

  const argv = []
  if (isWatchMode) {
    argv.push('--as-needed')
  }
  argv.push('-o', '--ignore-files', ...ignoredFiles)
  const packing = execa('web-ext', ['build', ...argv], {
    stdio: isWatchMode ? 'ignore' : 'inherit',
  })
  if (!isWatchMode) {
    await packing
  }
}
