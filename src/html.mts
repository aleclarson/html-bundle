import {
  appendChild,
  createElement,
  findElement,
  ParentNode,
} from '@web/parse5-utils'
import Critters from 'critters'
import { writeFile } from 'fs/promises'
import { minify } from 'html-minifier-terser'
import { yellow } from 'kleur/colors'
import { parse, parseFragment, serialize } from 'parse5'
import { Config, Entry } from '../config.mjs'
import { injectClientConnection } from './clientUtils.mjs'
import { buildRelativeStyles, findRelativeStyles } from './css.mjs'
import { RelativeScript } from './esbuild.mjs'
import { baseRelative, createDir } from './utils.mjs'

export function parseHTML(html: string) {
  const document = (
    html.includes('<!DOCTYPE html>') || html.includes('<html')
      ? parse(html)
      : parseFragment(html)
  ) as ParentNode

  if (!findElement(document, e => e.tagName == 'head')) {
    const head = createElement('head')
    appendChild(document, head)
  }
  if (!findElement(document, e => e.tagName == 'body')) {
    const body = createElement('body')
    appendChild(document, body)
  }

  return document
}

let critters: Critters

export async function buildHTML(
  entry: Entry,
  document: ParentNode,
  scripts: RelativeScript[],
  config: Config,
  flags: { watch?: boolean; critical?: boolean }
) {
  console.log(yellow('⌁'), baseRelative(entry.file))

  const outFile = config.getBuildPath(entry.file)
  const styles = findRelativeStyles(document, entry.file)
  try {
    await buildRelativeStyles(styles, config, flags)
  } catch (e) {
    console.error(e)
    return
  }

  const meta = { scripts, styles }
  for (const plugin of config.plugins) {
    plugin.document?.(document, entry.file, meta)
  }

  if (flags.watch && entry.hmr != false) {
    injectClientConnection(document, outFile, config)
  }

  let html = serialize(document)

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

  return html
}
