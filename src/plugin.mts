import { ParentNode } from '@web/parse5-utils'
import { EventEmitter } from 'events'
import http from 'http'
import { UrlWithStringQuery } from 'url'
import ws from 'ws'
import { Config } from '../config.mjs'
import { Flags } from './bundle.mjs'
import { RelativeStyle } from './css.mjs'
import { RelativeScript } from './esbuild.mjs'

export interface Plugin {
  (config: Config, flags: Flags): PluginInstance | Promise<PluginInstance>
}

export interface PluginInstance {
  buildEnd?(wasRebuild: boolean): Promise<void> | void
  hmr?(context: Plugin.HmrContext): Plugin.HmrInstance
  /**
   * Return true to indicate that the request was handled.
   */
  serve?(request: Plugin.Request, response: http.ServerResponse): boolean | void
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
  }
  export interface HmrContext {
    clients: Set<Client>
    on(type: 'connect', handler: (event: ClientEvent) => void): void
    on(type: string, handler: (event: ClientEvent) => void): void
  }
  export interface HmrInstance {
    /**
     * Return true to prevent full reload.
     */
    accept(file: string): boolean | void
    update(files: string[]): Promise<void>
  }
  export interface Client {
    socket: ws.WebSocket
    events: EventEmitter
    evaluate: <T = any>(expr: string) => Promise<T>
    evaluateFile: <T = any>(
      file: string,
      env: Record<string, any>
    ) => Promise<T>
    getURL: () => Promise<string>
    reload: () => void
  }
  export interface ClientEvent extends Record<string, any> {
    type: string
    client: Client
  }
}

export interface ServePlugin {
  serve: Exclude<PluginInstance['serve'], undefined>
}

export interface HmrPlugin {
  hmr: Exclude<PluginInstance['hmr'], undefined>
}
