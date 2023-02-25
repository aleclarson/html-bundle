import * as esbuild from 'esbuild'
import * as htmlMinifierTerser from 'html-minifier-terser'

export namespace WebExtension {
  type Config = {
    artifactsDir?: string
    run?: RunOptions
  }

  type RunTarget = 'firefox-desktop' | 'firefox-android' | 'chromium'

  type RunOptions = {
    target?: RunTarget | RunTarget[]
    startUrl?: string | string[]
    firefox?: FirefoxRunOptions
    chromium?: ChromiumRunOptions
    reload?: boolean
    keepProfileChanges?: boolean
  }

  type FirefoxRunOptions = {
    binary?: 'firefox' | 'beta' | 'nightly' | 'deved' | (string & {})
    profile?: string
    keepProfileChanges?: boolean
    devtools?: boolean
    browserConsole?: boolean
    preInstall?: boolean
    args?: string[]
  }

  type ChromiumRunOptions = {
    binary?: string
    profile?: string
    keepProfileChanges?: boolean
    args?: string[]
  }
}

export type Config = {
  src: string
  copy?: string[]
  build: string
  targets: string
  /** @see https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-run */
  webext?: boolean | WebExtension.Config
  esbuild: esbuild.BuildOptions
  lightningCss: any
  htmlMinifierTerser: htmlMinifierTerser.Options
  isCritical: boolean
  deletePrev: boolean
}

export function defineConfig(config: Partial<Config>): typeof config
