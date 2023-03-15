import {
  appendChild,
  createScript,
  findElement,
  ParentNode,
} from '@web/parse5-utils'
import * as fs from 'fs'
import * as path from 'path'
import { Config } from '../config.mjs'
import { compileSeparateEntry } from './esbuild.mjs'
import { relative } from './utils.mjs'

const getConnectionFile = (config: Config) =>
  path.resolve(config.build, '_connection.mjs')

export async function buildClientConnection(config: Config) {
  fs.writeFileSync(
    getConnectionFile(config),
    await compileSeparateEntry('./client/connection.js', config)
  )
}

export function injectClientConnection(
  document: ParentNode,
  outFile: string,
  config: Config
) {
  const connectionFile = getConnectionFile(config)
  const hmrScript = createScript({
    src: relative(outFile, connectionFile),
  })
  const head = findElement(document, e => e.tagName === 'head')!
  appendChild(head, hmrScript)
}
