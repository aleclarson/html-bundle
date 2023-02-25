import { Element, getAttribute, ParentNode } from '@web/parse5-utils'
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
    define: {
      'process.env.HMR_PORT': `"${config.server.hmrPort}"`,
      ...config.esbuild.define,
    },
  })
  return result.outputFiles[0].text
}

export interface RelativeScript {
  node: Element
  srcPath: string
  outPath: string
  isModule: boolean
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
      console.log(yellow('⌁'), baseRelative(srcPath))
      const outPath = config.getBuildPath(srcPath)
      srcAttr.value = baseRelative(outPath)
      results.push({
        node: scriptNode,
        srcPath,
        outPath,
        isModule: getAttribute(scriptNode, 'type') === 'module',
      })
    }
  }
  return results
}

export function buildRelativeScripts(
  scripts: RelativeScript[],
  config: Config,
  flags: { watch?: boolean; write?: boolean } = {}
) {
  return esbuild.build({
    format: 'esm',
    charset: 'utf8',
    splitting: true,
    sourcemap: flags.watch,
    minify: !flags.watch,
    ...config.esbuild,
    write: flags.write != false,
    bundle: true,
    entryPoints: scripts.map(script => script.srcPath),
    outdir: config.build,
    outbase: config.src,
    plugins: [
      metaUrlPlugin(),
      importGlobPlugin(),
      ...(config.esbuild.plugins || []),
    ],
    define: {
      'process.env.NODE_ENV': `"${process.env.NODE_ENV}"`,
      'process.env.HMR_PORT': `"${config.server.hmrPort}"`,
      ...config.esbuild.define,
    },
  })
}
