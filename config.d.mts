import * as esbuild from 'esbuild'
import * as htmlMinifierTerser from 'html-minifier-terser'

export type WebExtensionOptions = {
  /** @default true */
  reload?: boolean
  preInstall?: boolean
  devtools?: boolean
  browserConsole?: boolean
  run?: {
    target?: 'firefox-desktop' | 'firefox-android' | 'chromium'
    firefoxBinary?: 'firefox' | 'beta' | 'nightly' | 'deved' | (string & {})
    chromiumBinary?: string
    startUrl?: string | string[]
  }
}

export type Config = {
  src: string
  build: string
  targets: string
  /** @see https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-run */
  webext?: boolean | WebExtensionOptions
  esbuild: esbuild.BuildOptions
  lightningCss: any
  htmlMinifierTerser: htmlMinifierTerser.Options
  isCritical: boolean
  deletePrev: boolean
}

export function defineConfig(config: Partial<Config>): typeof config
