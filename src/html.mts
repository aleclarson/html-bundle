import {
  appendChild,
  createScript,
  findElement,
  ParentNode,
} from '@web/parse5-utils'
import Critters from 'critters'
import { copyFile, readFile, writeFile } from 'fs/promises'
import glob from 'glob'
import { minify } from 'html-minifier-terser'
import { cyan } from 'kleur/colors'
import { parse, parseFragment, serialize } from 'parse5'
import * as path from 'path'
import { Config } from '../config.mjs'
import { buildRelativeStyles, findRelativeStyles } from './css.mjs'
import {
  buildRelativeScripts,
  compileClientModule,
  findRelativeScripts,
} from './esbuild.mjs'
import { createDir, relative } from './utils.mjs'

export function parseHTML(html: string) {
  return (
    html.includes('<!DOCTYPE html>') || html.includes('<html')
      ? parse(html)
      : parseFragment(html)
  ) as ParentNode
}

let critters: Critters

export async function buildHTML(
  file: string,
  config: Config,
  flags: { watch?: boolean; critical?: boolean }
) {
  let html = await readFile(file, 'utf8')
  if (!html) return

  const outFile = config.getBuildPath(file)

  const document = parseHTML(html)
  const scripts = findRelativeScripts(document, file, config)
  const styles = findRelativeStyles(document, file)

  try {
    await Promise.all([
      buildRelativeScripts(scripts, config, flags),
      buildRelativeStyles(styles, config, flags),
    ])
  } catch (e) {
    console.error(e)
    return
  }

  const meta = { scripts, styles }
  for (const plugin of config.plugins) {
    plugin.document?.(document, file, meta)
  }

  if (flags.watch) {
    const clientConnector = await compileClientModule(
      './client/connection.js',
      config
    )
    const clientConnectorPath = path.resolve(config.build, '_connection.mjs')
    await writeFile(clientConnectorPath, clientConnector)
    const hmrScript = createScript({
      src: relative(outFile, clientConnectorPath),
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
        ...config.htmlMinifierTerser,
      })
    } catch (e) {
      console.error(e)
    }

    if (flags.critical) {
      try {
        const isPartical = !html.startsWith('<!DOCTYPE html>')
        critters ||= new Critters({
          path: config.build,
          logLevel: 'silent',
        })
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

  if (config.copy) {
    let copied = 0
    for (const path of config.copy) {
      if (glob.hasMagic(path)) {
        glob(path, (err, files) => {
          if (err) {
            console.error(err)
          } else {
            files.forEach(async file => {
              const outPath = config.getBuildPath(path)
              await createDir(outPath)
              await copyFile(file, outPath)
              copied++
            })
          }
        })
      } else {
        const outPath = config.getBuildPath(path)
        await createDir(outPath)
        await copyFile(path, outPath)
        copied++
      }
    }
    console.log(cyan('copied %s %s'), copied, copied == 1 ? 'file' : 'files')
  }

  return html
}