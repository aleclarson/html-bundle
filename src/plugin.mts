import { ParentNode } from '@web/parse5-utils'
import { EventEmitter } from 'events'
import http from 'http'
import { Promisable } from 'type-fest'
import { UrlWithStringQuery } from 'url'
import { Config, WebExtension } from '../config.mjs'
import { Flags } from './bundle.mjs'
import { RelativeStyle } from './css.mjs'
import { RelativeScript } from './esbuild.mjs'

export interface Plugin {
  (config: Config, flags: Flags): Promisable<PluginInstance>
}

export interface PluginInstance {
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

  export interface Client extends EventEmitter {
    evaluate: <T = any>(expr: string) => Promise<T>
    evaluateModule: <T = any>(file: string, args: any[]) => Promise<T>
    getURL: () => Promise<string>
    reload: () => void
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
}

export interface ServePlugin {
  serve: Exclude<PluginInstance['serve'], undefined>
}

export interface HmrPlugin {
  hmr: Exclude<PluginInstance['hmr'], undefined>
}
