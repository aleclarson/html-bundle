import cssnano from 'cssnano'
import { copyFile, mkdir } from 'fs/promises'
import path from 'path'
import postcssrc from 'postcss-load-config'

export const bundleConfig = await getBundleConfig()

export function fileCopy(file: string) {
  return copyFile(file, getBuildPath(file))
}

export function createDir(file: string) {
  const buildPath = getBuildPath(file)
  const dir = buildPath.split('/').slice(0, -1).join('/')
  return mkdir(dir, { recursive: true })
}

export function getBuildPath(file: string) {
  return file.replace(`${bundleConfig.src}/`, `${bundleConfig.build}/`)
}

export async function getPostCSSConfig() {
  try {
    return await postcssrc({})
  } catch {
    return { plugins: [cssnano], options: {}, file: '' }
  }
}

async function getBundleConfig() {
  const base = {
    build: 'build',
    src: 'src',
    port: 5000,
    esbuild: {},
    'html-minifier-terser': {},
    critical: {},
    deletePrev: true,
  }

  try {
    const cfgPath = path.resolve(process.cwd(), 'bundle.config.js')
    const config = await import(`file://${cfgPath}`)
    return { ...base, ...config.default }
  } catch {
    return base
  }
}
