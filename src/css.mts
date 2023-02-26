import { Attribute, findElements, getAttribute, Node } from '@web/parse5-utils'
import { writeFile } from 'fs/promises'
import { gray, red, yellow } from 'kleur/colors'
import * as lightningCss from 'lightningcss'
import path from 'path'
import { Config } from '../config.mjs'
import { baseRelative, createDir } from './utils.mjs'

export async function buildCSSFile(
  file: string,
  config: Config,
  flags: { watch?: boolean } = { watch: true }
) {
  console.log(yellow('⌁'), baseRelative(file))
  const bundle = await lightningCss.bundleAsync({
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
    ...config.lightningCss,
    filename: file,
  })

  if (bundle.warnings.length) {
    console.warn('')
    bundle.warnings.forEach(w => {
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

  return {
    ...bundle,
    outFile: config.getBuildPath(file),
  }
}

export interface RelativeStyle {
  readonly srcAttr: Attribute
  readonly srcPath: string
}

export function findRelativeStyles(document: Node, file: string) {
  const results: RelativeStyle[] = []
  for (const styleNode of findStyleSheets(document)) {
    const srcAttr = styleNode.attrs.find(a => a.name === 'href')
    if (srcAttr?.value.startsWith('./')) {
      results.push({
        srcAttr,
        srcPath: path.join(path.dirname(file), srcAttr.value),
      })
    }
  }
  return results
}

export async function buildRelativeStyles(
  styles: RelativeStyle[],
  config: Config,
  flags?: { watch?: boolean }
) {
  await Promise.all(
    styles.map(style =>
      buildCSSFile(style.srcPath, config, flags)
        .then(async result => {
          style.srcAttr.value = baseRelative(result.outFile)
          await createDir(result.outFile)
          await writeFile(result.outFile, result.code)
          if (result.map) {
            await writeFile(result.outFile + '.map', result.map)
          }
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

function findStyleSheets(rootNode: Node) {
  return findElements(
    rootNode,
    e => e.tagName == 'link' && getAttribute(e, 'rel') == 'stylesheet'
  )
}
