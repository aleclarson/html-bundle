import { Attribute, Element, getAttribute, ParentNode } from '@web/parse5-utils'
import * as esbuild from 'esbuild'
import importGlobPlugin from 'esbuild-plugin-import-glob'
import metaUrlPlugin from 'esbuild-plugin-meta-url'
import { yellow } from 'kleur/colors'
import * as path from 'path'
import { Config } from '../config.mjs'
import { baseRelative, findExternalScripts } from './utils.mjs'

export async function compileClientModule(
  file: string,
  config: Config,
  format?: esbuild.Format
) {
  const filePath = new URL(file, import.meta.url).pathname
  const result = await esbuild.build({
    ...config.esbuild,
    write: false,
    format: format ?? 'iife',
    entryPoints: [filePath],
  })
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
  flags: { watch?: boolean; write?: boolean } = {}
) {
  for (const srcPath of scripts) {
    console.log(yellow('⌁'), baseRelative(srcPath))
  }
  return esbuild.build({
    format: 'esm',
    charset: 'utf8',
    splitting: true,
    sourcemap: flags.watch,
    minify: !flags.watch,
    ...config.esbuild,
    write: flags.write != false,
    bundle: true,
    entryPoints: scripts,
    outdir: config.build,
    outbase: config.src,
    plugins: [
      metaUrlPlugin(),
      importGlobPlugin(),
      ...(config.esbuild.plugins || []),
    ],
  })
}
