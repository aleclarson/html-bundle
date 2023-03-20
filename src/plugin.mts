import { ParentNode } from '@web/parse5-utils'
import * as esbuild from 'esbuild'
import * as http from 'http'
import * as lightningCss from 'lightningcss'
import { Emitter } from 'mitt'
import { Promisable } from 'type-fest'
import { UrlWithStringQuery } from 'url'
import { Config, WebExtension } from '../config.mjs'
import { Flags } from './cli.mjs'
import { RelativeStyle } from './css.mjs'
import { RelativeScript } from './esbuild.mjs'

export interface Plugin {
  (config: Config, flags: Flags): Promisable<PluginInstance>
}

export interface PluginInstance {
  cssPlugins?: CssPlugin[]
  buildEnd?(wasRebuild: boolean): Promisable<void>
  hmr?(clients: Plugin.ClientSet): Plugin.HmrInstance | void
  /**
   * Must return `true` if changes are made to the `manifest` object.
   */
  webext?(manifest: any, webextConfig: WebExtension.Config): Promisable<boolean>
  serve?(
    request: Plugin.Request,
    response: http.ServerResponse
  ): Promisable<Plugin.VirtualFileData | void>
  document?(
    root: ParentNode,
    file: string,
    meta: {
      scripts: RelativeScript[]
      styles: RelativeStyle[]
    }
  ): void
  /**
   * Called after esbuild has finished bundling the entry scripts found
   * within all of your HTML files.
   */
  bundles?(bundle: Record<string, Plugin.Bundle>): void
}

export namespace Plugin {
  export interface Request extends http.IncomingMessage, UrlWithStringQuery {
    url: string
    path: string
    pathname: string
    searchParams: URLSearchParams
  }

  export interface HmrInstance {
    /**
     * Return true to prevent full reload.
     */
    accept(file: string): boolean | void
    update(files: string[]): Promise<void>
  }

  export interface ClientSet extends ReadonlySet<Client> {
    on(type: 'connect', handler: (event: ClientEvent) => void): void
    on(type: string, handler: (event: ClientEvent) => void): void
  }

  export interface Client extends Emitter<ClientEvents> {
    evaluate: <T = any>(expr: string) => Promise<T>
    evaluateModule: <T = any>(file: string, args: any[]) => Promise<T>
    getURL: () => Promise<string>
    reload: () => void
  }

  /**
   * Plugins can extend this via "interface declaration merging" with
   * `declare module` syntax, so they can emit custom events on HMR
   * clients.
   */
  export interface ClientEvents extends Record<string | symbol, unknown> {
    'webext:uuid': { protocol: string; host: string }
  }

  export interface ClientEvent extends Record<string, any> {
    type: string
    client: Client
  }

  export type VirtualFileData = {
    path?: string
    mtime?: number
    headers?: Record<string, number | string | readonly string[]>
    data: string | Buffer
  }

  export type VirtualFile =
    | ((request: Plugin.Request) => Promisable<VirtualFileData | null>)
    | Promisable<VirtualFileData | null>

  export interface Bundle extends esbuild.Metafile {
    id: string
    entries: Set<string>
    /**
     * Set this to false in the `bundles` plugin hook if you want to
     * force full reloads when an input file in this bundle is changed.
     */
    hmr?: boolean
  }
}

export interface ServePlugin {
  serve: Exclude<PluginInstance['serve'], undefined>
}

export interface HmrPlugin {
  hmr: Exclude<PluginInstance['hmr'], undefined>
}

export interface CssPlugin {
  visitor: (importer: URL) => lightningCss.Visitor<any> | null
}
