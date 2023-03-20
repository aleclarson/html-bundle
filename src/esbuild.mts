import { Attribute, Element, getAttribute, ParentNode } from '@web/parse5-utils'
import * as esbuild from 'esbuild'
import { wrapPlugins } from 'esbuild-extra'
import { yellow } from 'kleur/colors'
import * as path from 'path'
import { Config } from '../config.mjs'
import importGlobPlugin from './plugins/importGlob/index.mjs'
import metaUrlPlugin from './plugins/importMetaUrl.mjs'
import { baseRelative, findExternalScripts } from './utils.mjs'

export async function compileSeparateEntry(
  file: string,
  config: Config,
  format?: esbuild.Format
) {
  const filePath = decodeURIComponent(new URL(file, import.meta.url).pathname)

  const result = await esbuild.build(
    wrapPlugins({
      ...config.esbuild,
      bundle: true,
      write: false,
      format: format ?? 'iife',
      entryPoints: [filePath],
      sourcemap: config.mode == 'development' ? 'inline' : false,
    })
  )

  return result.outputFiles[0].text
}

export interface RelativeScript {
  readonly node: Element
  readonly srcAttr: Attribute
  readonly srcPath: string
  readonly outPath: string
  readonly isModule: boolean
}

export function findRelativeScripts(
  document: ParentNode,
  file: string,
  config: Config
) {
  const results: RelativeScript[] = []
  for (const scriptNode of findExternalScripts(document)) {
    const srcAttr = scriptNode.attrs.find(a => a.name === 'src')
    if (srcAttr?.value.startsWith('./')) {
      const srcPath = path.join(path.dirname(file), srcAttr.value)
      const outPath = config.getBuildPath(srcPath)
      srcAttr.value = baseRelative(outPath)
      results.push({
        node: scriptNode,
        srcAttr,
        srcPath,
        outPath,
        isModule: getAttribute(scriptNode, 'type') === 'module',
      })
    }
  }
  return results
}

export function buildEntryScripts(
  scripts: string[],
  config: Config,
  flags: { watch?: boolean; write?: boolean; minify?: boolean } = {}
) {
  for (const srcPath of scripts) {
    console.log(yellow('⌁'), baseRelative(srcPath))
  }
  return esbuild.build(
    wrapPlugins({
      format: 'esm',
      charset: 'utf8',
      sourcemap: flags.watch,
      minify: !flags.watch && flags.minify != false,
      ...config.esbuild,
      entryPoints: scripts,
      outbase: config.src,
      outdir: config.build,
      metafile: true,
      write: flags.write != false,
      bundle: true,
      splitting: true,
      treeShaking: true,
      plugins: [
        ...(config.esbuild.plugins || []),
        metaUrlPlugin(),
        importGlobPlugin(),
      ],
    })
  )
}
