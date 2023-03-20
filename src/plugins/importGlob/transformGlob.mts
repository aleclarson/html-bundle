import {
  ConfigAPI,
  ParserOptions,
  PluginObj,
  transformAsync,
  types,
} from '@babel/core'
import { OnTransformResult } from 'esbuild-extra'
import glob, { type FileSystemAdapter } from 'fast-glob'
import { dirname } from 'path'
import { CodeError } from './CodeError.mjs'
import { extractGlobArguments } from './extractGlobArguments.mjs'
import { normalizeFiles } from './normalizeFiles.mjs'
import { replaceImportGlobNode } from './replaceImportGlobNode.mjs'

export type TransformConfig = {
  path: string
  ts?: boolean
  jsx?: boolean
  fs?: FileSystemAdapter
}

type BabelPluginState = {
  counter: number
  opts: TransformConfig
}

function babelPluginGlobTransformation(
  api: ConfigAPI
): PluginObj<BabelPluginState> {
  api.assertVersion(7)

  return {
    pre() {
      this.counter = 0
    },
    visitor: {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      CallExpression: (nodePath, state) => {
        if (
          types.isMemberExpression(nodePath.node.callee) &&
          types.isMetaProperty(nodePath.node.callee.object) &&
          types.isIdentifier(nodePath.node.callee.property, { name: 'glob' })
        ) {
          const { patterns, options } = extractGlobArguments(nodePath)

          const files = normalizeFiles(
            glob.sync(patterns, {
              cwd: dirname(state.opts.path),
              fs: state.opts.fs,
            }),
            state.opts.path
          )

          replaceImportGlobNode(nodePath, state.counter, files, options)
          ++state.counter
        }
      },
    },
  }
}

const getLine = (source: string, line: number) => source.split('\n')[line - 1]

export const transformGlob = async (
  code: string,
  config: TransformConfig
): Promise<OnTransformResult | undefined> => {
  if (!/import\.meta\.glob\(/.test(code)) {
    return
  }

  const plugins: ParserOptions['plugins'] = []

  if (config.ts) {
    plugins.push('typescript')
  }

  if (config.jsx) {
    plugins.push('jsx')
  }

  try {
    const babelOutput = await transformAsync(code, {
      parserOpts: {
        sourceType: 'module',
        plugins,
      },
      plugins: [[babelPluginGlobTransformation, config]],
    })

    if (!babelOutput?.code) {
      throw new Error('Failed to transform file via babel.')
    }

    return {
      code: babelOutput.code,
    }
  } catch (error) {
    if (error instanceof CodeError && error.nodePath.node.loc) {
      const location = error.nodePath.node.loc
      Reflect.set(error, 'location', {
        column: location.start.column,
        line: location.start.line,
        lineText: getLine(code, location.start.line),
        file: config.path,
        length:
          location.end.line === location.start.line
            ? location.end.column - location.start.column
            : 1,
      })
    }
    throw error
  }
}
