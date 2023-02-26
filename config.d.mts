import * as esbuild from 'esbuild'
import { EventEmitter } from 'events'
import * as htmlMinifierTerser from 'html-minifier-terser'
import * as lightningCss from 'lightningcss'
import { Merge } from 'type-fest'
import { Plugin, PluginInstance } from './src/plugin.mjs'

export function defineConfig(config: UserConfig): typeof config

export type UserConfig = {
  src?: string
  copy?: (string | Record<string, string>)[]
  build?: string
  /**
   * Compile JS/CSS syntax to be compatible with the browsers that match
   * the given Browserslist query.
   */
  browsers?: string
  server?: ServerConfig
  /** @see https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-run */
  webext?: boolean | WebExtension.Config
  esbuild?: esbuild.BuildOptions
  lightningCss?: lightningCss.BundleAsyncOptions
  htmlMinifierTerser?: htmlMinifierTerser.Options
  isCritical?: boolean
  deletePrev?: boolean
  plugins?: Plugin[]
}

export type ServerConfig = {
  port?: number
  https?: boolean | { cert: string; key: string }
}

export namespace WebExtension {
  type Config = {
    artifactsDir?: string
    /**
     * Copy the `webextension-polyfill` file into your build directory,
     * then inject it into your extension.
     */
    polyfill?: boolean
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

export type Config = Merge<
  Required<UserConfig>,
  {
    plugins: PluginInstance[]
    events: EventEmitter
    virtualFiles: Record<string, Plugin.VirtualFile>
    getBuildPath(file: string): string
    esbuild: esbuild.BuildOptions & {
      define: Record<string, string>
    }
    server: {
      url: string
      port: number
      https?: { cert?: string; key?: string }
    }
    watcher?: import('chokidar').FSWatcher
    webext?: WebExtension.Config
  }
>
