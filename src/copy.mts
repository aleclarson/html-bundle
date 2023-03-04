import fs from 'fs'
import glob from 'glob'
import { cyan } from 'kleur/colors'
import path from 'path'
import { promisify } from 'util'
import { Config } from '../config.mjs'
import { createDir } from './utils.mjs'

export async function copyFiles(
  patterns: (string | Record<string, string>)[],
  config: Config
): Promise<void> {
  let copied = 0
  for (let pattern of patterns) {
    if (typeof pattern != 'string') {
      await Promise.all(
        Object.entries(pattern).map(async ([srcPath, outPath]) => {
          if (path.isAbsolute(outPath)) {
            return console.error(
              `Failed to copy "${srcPath}" to "${outPath}": Output path must be relative`
            )
          }
          if (outPath.startsWith('..')) {
            return console.error(
              `Failed to copy "${srcPath}" to "${outPath}": Output path must not be outside build directory`
            )
          }
          outPath = path.resolve(config.build, outPath)
          await createDir(outPath)
          fs.copyFileSync(srcPath, outPath)
          copied++
        })
      )
    } else if (glob.hasMagic(pattern)) {
      const matchedPaths = await promisify(glob)(pattern)
      await Promise.all(
        matchedPaths.map(async srcPath => {
          const outPath = config.getBuildPath(srcPath)
          await createDir(outPath)
          fs.copyFileSync(srcPath, outPath)
          copied++
        })
      )
    } else {
      const srcPath = pattern
      const outPath = config.getBuildPath(srcPath)
      await createDir(outPath)
      fs.copyFileSync(pattern, outPath)
      copied++
    }
  }
  console.log(cyan('copied %s %s'), copied, copied == 1 ? 'file' : 'files')
}
