#!/usr/bin/env node

import { Attribute } from '@web/parse5-utils'
import browserslist from 'browserslist'
import browserslistToEsbuild from 'browserslist-to-esbuild'
import * as chokidar from 'chokidar'
import Critters from 'critters'
import esbuild from 'esbuild'
import { lstat, readdir, readFile, rm, writeFile } from 'fs/promises'
import glob from 'glob'
import { minify } from 'html-minifier-terser'
import * as lightningcss from 'lightningcss'
import { parse, parseFragment, serialize } from 'parse5'
import path from 'path'
import { performance } from 'perf_hooks'
import {
  bundleConfig,
  createDir,
  fileCopy,
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

let timer = performance.now()
const inlineFiles = new Set<string>()
const SUPPORTED_FILES = /\.(html|css|jsx?|tsx?)$/

if (bundleConfig.deletePrev) {
  await rm(bundleConfig.build, { force: true, recursive: true })
}

glob(`${bundleConfig.src}/**/*.html`, build)

async function build(err: any, files: string[], firstRun = true) {
  if (err) {
    console.error(err)
    process.exit(1)
  }

  for (const file of files) {
    await createDir(file)
    if (file.endsWith('.html')) {
      await minifyHTML(file, getBuildPath(file))
    } else if (!SUPPORTED_FILES.test(file)) {
      if ((await lstat(file)).isDirectory()) {
        continue
      }
      await fileCopy(file)
    }
  }

  console.log(
    `🚀 Build finished in ${(performance.now() - timer).toFixed(2)}ms ✨`
  )

  if (firstRun) {
    console.log(`⌛ Waiting for file changes ...`)

    const watcher = chokidar.watch(bundleConfig.src)
    watcher.on('add', async file => {
      file = String.raw`${file}`.replace(/\\/g, '/') // glob and chokidar diff
      if (files.includes(file)) {
        return
      }

      await rebuild(file)

      console.log(`⚡ added ${file} to the build`)
    })
    watcher.on('change', async file => {
      file = String.raw`${file}`.replace(/\\/g, '/')

      await rebuild(file)

      console.log(`⚡ modified ${file} on the build`)
    })
    watcher.on('unlink', async file => {
      file = String.raw`${file}`.replace(/\\/g, '/')

      inlineFiles.delete(file)
      const buildFile = getBuildPath(file)
        .replace('.ts', '.js')
        .replace('.jsx', '.js')
      await rm(buildFile)

      const bfDir = buildFile.split('/').slice(0, -1).join('/')
      const stats = await readdir(bfDir)
      if (!stats.length) {
        await rm(bfDir)
      }

      console.log(`⚡ deleted ${file} from the build`)
    })

    async function rebuild(file: string) {
      await minifyHTML(file, getBuildPath(file))
    }
  }
}

async function minifyHTML(file: string, buildFile: string) {
  let fileText = await readFile(file, { encoding: 'utf-8' })
  if (!fileText) {
    return
  }

  let DOM: any =
    fileText.includes('<!DOCTYPE html>') || fileText.includes('<html')
      ? parse(fileText)
      : parseFragment(fileText)

  const entryScripts: { srcAttr: Attribute; srcPath: string }[] = []
  for (const scriptNode of findExternalScripts(DOM)) {
    const srcAttr = scriptNode.attrs.find(a => a.name === 'src')
    if (srcAttr?.value.startsWith('./')) {
      entryScripts.push({
        srcAttr,
        srcPath: path.join(path.dirname(file), srcAttr.value),
      })
    }
  }

  const entryStyles: { srcAttr: Attribute; srcPath: string }[] = []
  for (const styleNode of findStyleSheets(DOM)) {
    const srcAttr = styleNode.attrs.find(a => a.name === 'href')
    if (srcAttr?.value.startsWith('./')) {
      entryStyles.push({
        srcAttr,
        srcPath: path.join(path.dirname(file), srcAttr.value),
      })
    }
  }

  const esTargets = browserslistToEsbuild(bundleConfig.targets)
  const cssTargets = lightningcss.browserslistToTargets(
    browserslist(bundleConfig.targets)
  )

  await Promise.all([
    ...entryScripts.map(script =>
      esbuild
        .build({
          entryPoints: [script.srcPath],
          charset: 'utf8',
          format: 'esm',
          target: esTargets,
          sourcemap: process.env.NODE_ENV != 'production' ? 'inline' : false,
          define: {
            'process.env.NODE_ENV': `"${process.env.NODE_ENV}"`,
          },
          splitting: true,
          bundle: true,
          minify: true,
          outdir: bundleConfig.build,
          outbase: bundleConfig.src,
          ...bundleConfig.esbuild,
        })
        .then(() => {
          const outPath = getBuildPath(script.srcPath)
          script.srcAttr.value =
            './' + path.relative(path.dirname(buildFile), outPath)
        })
    ),
    ...entryStyles.map(style =>
      lightningcss
        .bundleAsync({
          filename: style.srcPath,
          drafts: { nesting: true },
          targets: cssTargets,
          minify: true,
          ...bundleConfig.lightningcss,
        })
        .then(async result => {
          const outPath = getBuildPath(style.srcPath)
          style.srcAttr.value =
            './' + path.relative(path.dirname(buildFile), outPath)
          await writeFile(outPath, result.code)
        })
    ),
  ])

  fileText = serialize(DOM)

  // Minify HTML
  try {
    fileText = await minify(fileText, {
      collapseWhitespace: true,
      removeComments: true,
      ...bundleConfig['html-minifier-terser'],
    })
  } catch (e) {
    console.error(e)
  }

  if (isCritical) {
    try {
      const isPartical = !fileText.startsWith('<!DOCTYPE html>')
      fileText = await critters.process(fileText)
      // fix critters jsdom
      if (isPartical) {
        fileText = fileText.replace(/<\/?(html|head|body)>/g, '')
      }
    } catch (err) {
      console.error(err)
    }
  }

  await writeFile(buildFile, fileText)
  return fileText
}
