import * as esbuild from 'esbuild'
import * as htmlMinifierTerser from 'html-minifier-terser'

export namespace WebExtension {
  type CommonRunOptions = {
    startUrl?: string | string[]
  }

  type FirefoxRunOptions = CommonRunOptions & {
    target: 'firefox-desktop' | 'firefox-android'
    binary?: 'firefox' | 'beta' | 'nightly' | 'deved' | (string & {})
  }

  type ChromiumRunOptions = CommonRunOptions & {
    target: 'chromium'
    binary?: string
  }

  type RunOption =
    | 'firefox-desktop'
    | 'firefox-android'
    | 'chromium'
    | FirefoxRunOptions
    | ChromiumRunOptions

  export type Options = {
    /** @default true */
    reload?: boolean
    preInstall?: boolean
    devtools?: boolean
    browserConsole?: boolean
    run?: RunOption[]
  }
}

export type Config = {
  src: string
  copy?: string[]
  build: string
  targets: string
  /** @see https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-run */
  webext?: boolean | WebExtension.Options
  esbuild: esbuild.BuildOptions
  lightningCss: any
  htmlMinifierTerser: htmlMinifierTerser.Options
  isCritical: boolean
  deletePrev: boolean
}

export function defineConfig(config: Partial<Config>): typeof config
