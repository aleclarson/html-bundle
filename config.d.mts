import * as esbuild from 'esbuild'
import { EventEmitter } from 'events'
import * as htmlMinifierTerser from 'html-minifier-terser'
import * as lightningCss from 'lightningcss'
import { Merge } from 'type-fest'
import { Plugin, PluginInstance } from './src/plugin.mjs'

export function defineConfig(config: UserConfig): typeof config

export type UserConfig = {
  /**
   * The directory to crawl for HTML files.
   * @default "src"
   */
  src?: string
  /**
   * Where the build artifacts are saved.
   * @default "build"
   */
  build?: string
  /**
   * Where the assets directory is located.
   * @default "public"
   */
  assets?: string
  /**
   * Files to copy to the build directory. Globs are supported.
   */
  copy?: (string | Record<string, string>)[]
  /**
   * Globs to use as entry points for dynamically inserted `<script>` tags.
   */
  scripts?: string[]
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
  ConfigAPI & {
    mode: string
    entries: Entry[]
    plugins: PluginInstance[]
    events: EventEmitter
    virtualFiles: Record<string, Plugin.VirtualFile>
    esbuild: esbuild.BuildOptions & {
      define: Record<string, string>
    }
    server: {
      url: URL
      port: number
      https?: { cert?: string; key?: string }
    }
    watcher?: import('chokidar').FSWatcher
    webext?: WebExtension.Config
  }
>

export interface ConfigAPI {
  getBuildPath(file: string): string
  resolve(id: string, importer?: string | URL): URL
  resolveDevUrl(id: string, importer?: string | URL): URL
  /**
   * If a `.css` file isn't imported by an HTML file (eg: imported by
   * JS), it needs to be explicitly registered, or else the `cssReload`
   * plugin won't rebundle it when it or one of its dependencies is
   * changed.
   *
   * Only exists in watch mode.
   */
  registerCssEntry?(file: string, code?: string): void
}

export type Entry = {
  file: string
  /**
   * If a plugin sets this, this file will be bundled separately from
   * the default bundle. This applies to JS only, but an HTML entry with
   * this property will apply it to all of its scripts.
   */
  bundleId?: string
  /**
   * Set to false to disable HMR for the bundle this entry is part of.
   */
  hmr?: boolean
}
