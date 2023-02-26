import { createScript, findElement, insertBefore } from '@web/parse5-utils'
import chromeRemote from 'chrome-remote-interface'
import exitHook from 'exit-hook'
import fs from 'fs'
import { cyan, yellow } from 'kleur/colors'
import path from 'path'
import { cmd as webExtCmd } from 'web-ext'
import { Config, WebExtension } from '../../config.mjs'
import type { Flags } from '../bundle.mjs'
import { Plugin } from '../plugin.mjs'
import { findFreeTcpPort, resolveHome, toArray } from '../utils.mjs'

const polyfillPath = path.resolve(
  import.meta.url.replace(/^file:/, ''),
  '../../../node_modules/webextension-polyfill/dist/browser-polyfill.min.js'
)

export const webextPlugin: Plugin = (config, flags) => {
  const webextConfig = config.webext!

  if (webextConfig.polyfill) {
    config.copy.push({
      [polyfillPath]: 'browser-polyfill.min.js',
      [polyfillPath + '.map']: 'browser-polyfill.min.js.map',
    })
  }

  return {
    async buildEnd() {
      if (!flags.watch) {
        // Pack the web extension for distribution.
        await enableWebExtension(webextConfig, config, flags)
      }
    },
    document(root) {
      if (webextConfig.polyfill) {
        const head = findElement(root, e => e.tagName == 'head')!
        const polyfillScript = createScript({
          src: path.join('/', config.build, 'browser-polyfill.min.js'),
        })
        insertBefore(head, polyfillScript, head.childNodes[0])
      }
    },
    hmr(clients) {
      enableWebExtension(webextConfig, config, flags, clients)
      clients.on('connect', ({ client }) => {
        client
          .evaluate('[location.protocol, location.host]')
          .then(([protocol, host]) => {
            console.log({ protocol, host })
            client.emit('webext:uuid', { protocol, host })
          })
      })
    },
  }
}

function parseContentSecurityPolicy(str: string) {
  const policies = str.split(/ *; */)
  const result: Record<string, Set<string>> = {}
  for (const policy of policies) {
    if (!policy) continue
    const [name, ...values] = policy.split(/ +/)
    result[name] = new Set(values)
  }
  Object.defineProperty(result, 'toString', {
    value: () => {
      return (
        Object.entries(result)
          .map(([name, values]) => `${name} ${[...values].join(' ')}`)
          .join('; ') + ';'
      )
    },
  })
  return result
}

async function enableWebExtension(
  webextConfig: WebExtension.Config,
  config: Config,
  flags: Flags,
  clients?: Plugin.ClientSet
) {
  let isManifestChanged = false
  const rawManifest = fs.readFileSync('manifest.json', 'utf8')
  const manifest = JSON.parse(rawManifest)

  if (flags.watch) {
    const httpServerUrl = config.server.url.href
    const wsServerUrl = httpServerUrl.replace('http', 'ws')

    // The content security policy needs to be lax for HMR to work.
    const csp = parseContentSecurityPolicy(
      manifest.content_security_policy || ''
    )
    csp['default-src'] ||= new Set(["'self'"])
    csp['default-src'].add(httpServerUrl)
    csp['connect-src'] ||= new Set(csp['default-src'])
    csp['connect-src'].add(httpServerUrl)
    csp['connect-src'].add(wsServerUrl)
    csp['script-src'] ||= new Set(csp['default-src'] || ["'self'"])
    csp['script-src'].add(httpServerUrl)
    csp['style-src'] ||= new Set(csp['default-src'] || ["'self'"])
    csp['style-src'].add(httpServerUrl)
    csp['style-src'].add("'unsafe-inline'")

    manifest.content_security_policy = csp.toString()
    isManifestChanged = true
  }

  if (webextConfig.polyfill) {
    const polyfillPath = path.join(config.build, 'browser-polyfill.min.js')
    const injectPolyfillIfNeeded = (scripts: string[] | undefined) => {
      if (!scripts) return
      const needsBrowserPolyfill = scripts.some(file => {
        const code = fs.readFileSync(file, 'utf8')
        return /\bbrowser\./.test(code)
      })
      if (needsBrowserPolyfill) {
        scripts.unshift(polyfillPath)
        isManifestChanged = true
      }
    }
    injectPolyfillIfNeeded(manifest.background?.scripts)
    manifest.content_scripts?.forEach((script: { js?: string[] }) => {
      injectPolyfillIfNeeded(script.js)
    })
  }

  for (const plugin of config.plugins) {
    if (!plugin.webext) continue
    isManifestChanged =
      (await plugin.webext(manifest, webextConfig)) || isManifestChanged
  }

  if (isManifestChanged) {
    // Save our changes…
    fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2))
    // …but revert them once we exit.
    exitHook(() => {
      fs.writeFileSync('manifest.json', rawManifest)
    })
  }

  const ignoredFiles = new Set(fs.readdirSync(process.cwd()))
  const keepFile = (
    file: string | undefined,
    watch = !!file && !file.startsWith(config.build + '/')
  ) => {
    if (typeof file == 'string') {
      ignoredFiles.delete(file.split('/')[0])
      if (watch && fs.existsSync(file)) {
        config.watcher?.add(file)
      }
    }
  }
  const keepFiles = (arg: any) =>
    typeof arg == 'string'
      ? keepFile(arg)
      : Array.isArray(arg)
      ? arg.forEach(keepFiles)
      : arg && Object.values(arg).forEach(keepFiles)

  keepFile('manifest.json')
  keepFile(config.build, false)
  keepFile(config.assets)
  keepFile(manifest.browser_action?.default_popup)
  keepFiles(manifest.background?.scripts)
  keepFiles(manifest.browser_action?.default_icon)
  keepFiles(manifest.chrome_url_overrides)
  keepFiles(manifest.content_scripts)
  keepFiles(manifest.icons)

  const artifactsDir =
    webextConfig.artifactsDir || path.join(process.cwd(), 'web-ext-artifacts')

  if (flags.watch) {
    const runConfig = webextConfig.run || {}
    const firefoxConfig = runConfig.firefox || {}
    const chromiumConfig = runConfig.chromium || {}

    let targets = toArray(runConfig.target || 'chromium')
    if (flags.webext) {
      const filter = toArray(flags.webext)
      targets = targets.filter(target =>
        filter.some(prefix => target.startsWith(prefix))
      )
    }

    const tabs = toArray(runConfig.startUrl || 'about:newtab')

    // Always run chromium first, as it's faster to launch.
    for (const target of targets.sort()) {
      let port: number | undefined

      const params = {} as import('web-ext').CmdRunParams
      if (target == 'chromium') {
        params.chromiumBinary = resolveHome(chromiumConfig.binary)
        params.chromiumProfile = resolveHome(chromiumConfig.profile)
        params.args = chromiumConfig.args
        if (chromiumConfig.keepProfileChanges) {
          params.keepProfileChanges = true
        }
      } else if (target == 'firefox-desktop') {
        params.firefox = resolveHome(firefoxConfig.binary || 'firefox')
        params.firefoxProfile = resolveHome(firefoxConfig.profile)
        params.firefoxPreview = []
        params.preInstall = !!firefoxConfig.preInstall
        params.devtools = !!firefoxConfig.devtools
        params.browserConsole = !!firefoxConfig.browserConsole
        if (firefoxConfig.keepProfileChanges) {
          params.keepProfileChanges = true
        }

        const args = (params.args = firefoxConfig.args || [])
        port = await findFreeTcpPort()
        args.push('--remote-debugging-port', port.toString())
      }

      params.keepProfileChanges ??= runConfig.keepProfileChanges ?? false
      if (params.chromiumProfile || params.firefoxProfile) {
        params.profileCreateIfMissing = true
      }

      const runner = await webExtCmd.run({
        ...params,
        target: [target],
        sourceDir: process.cwd(),
        artifactsDir,
        noReload: true,
      })

      await refreshOnRebuild(
        target,
        runner,
        config,
        clients!,
        manifest,
        tabs,
        port
      ).catch(e => {
        console.error(
          '[%s] Error during setup:',
          target,
          e.message.includes('404 Not Found')
            ? 'Unsupported CDP command'
            : e.message
        )
      })
    }
  } else {
    await webExtCmd.build({
      sourceDir: process.cwd(),
      artifactsDir,
      ignoreFiles: [...ignoredFiles],
      overwriteDest: true,
    })
  }
}

async function refreshOnRebuild(
  target: WebExtension.RunTarget,
  runner: import('web-ext').MultiExtensionRunner,
  config: Config,
  clients: Plugin.ClientSet,
  manifest: any,
  tabs: string[],
  firefoxPort?: number
) {
  let port: number
  let extProtocol: string

  const isChromium = target == 'chromium'
  if (isChromium) {
    const instance = runner.extensionRunners[0].chromiumInstance!
    port = instance.port!
    extProtocol = 'chrome-extension:'

    // For some reason, the Chrome process may stay alive if we don't
    // kill it explicitly.
    exitHook(() => {
      instance.process.kill()
    })
  } else if (firefoxPort) {
    port = firefoxPort
    extProtocol = 'moz-extension:'
  } else {
    return
  }

  if (tabs.length) {
    let resolvedTabs = tabs
    if (target == 'firefox-desktop') {
      resolvedTabs = resolveFirefoxTabs(tabs, manifest, runner)
    } else {
      resolvedTabs = tabs.map(url =>
        url == 'about:newtab' ? 'chrome://newtab/' : url
      )
    }
    await openTabs(port, resolvedTabs, manifest, isChromium)
  }

  let uuid: string
  clients.on('webext:uuid', event => {
    if (event.protocol == extProtocol) {
      uuid = event.id
    }
  })

  if (isChromium) {
    // Ensure not all tabs will be closed as a result of the extension
    // being reloaded, since that will cause an unsightly reopening of
    // the browser window.
    config.events.on('will-rebuild', async () => {
      const extOrigin = extProtocol + '//' + uuid
      const pages = (await chromeRemote.List({ port })).filter(
        tab => tab.type == 'page'
      )
      if (
        pages.length > 0 &&
        pages.every(tab => tab.url.startsWith(extOrigin))
      ) {
        console.log('Preserving the first tab!')
        const firstPage = await chromeRemote({
          port,
          target: pages[0].id,
        })
        await firstPage.send('Page.navigate', {
          url: 'chrome://newtab/',
        })
      }
    })
  }

  config.events.on('rebuild', async () => {
    const extOrigin = extProtocol + '//' + uuid

    if (!uuid) {
      console.warn('[%s] ' + yellow('⚠'), target, 'Extension UUID not found')
      return
    }

    console.log(cyan('↺'), extOrigin)

    // Chromium reloads automatically, and we can't stop it.
    if (!isChromium) {
      await runner.reloadAllExtensions()
    }

    const newTabPage = manifest.chrome_url_overrides?.newtab
    const newTabUrl = newTabPage
      ? `${extOrigin}/${newTabPage}`
      : isChromium
      ? 'chrome://newtab/'
      : 'about:newtab'

    const currentTabs = await chromeRemote.List({ port })
    const missingTabs = tabs
      .map(url => (newTabPage && url == 'about:newtab' ? newTabUrl : url))
      .filter(url => {
        const matchingTab = currentTabs.find(tab => tab.url == url)
        return !matchingTab || url == newTabUrl
      })

    if (missingTabs.length) {
      try {
        await openTabs(port, missingTabs, manifest, isChromium, true)
      } catch (e: any) {
        console.error(e.message)
      }
    }
  })
}

function resolveFirefoxTabs(
  tabs: string[],
  manifest: any,
  runner: import('web-ext').MultiExtensionRunner
) {
  return tabs.map((url: string) => {
    if (url != 'about:newtab') {
      return url
    }
    const newTabPage = manifest.chrome_url_overrides?.newtab
    if (newTabPage) {
      const profilePath = runner.extensionRunners[0].profile?.path()
      if (profilePath) {
        const uuid = extractFirefoxExtensionUUID(profilePath, manifest)
        if (uuid) {
          return `moz-extension://${uuid}/${newTabPage}`
        }
      }
    }
    return url
  })
}

function extractFirefoxExtensionUUID(
  profile: string,
  manifest: Record<string, any>
) {
  try {
    const rawPrefs = fs.readFileSync(path.join(profile, 'prefs.js'), 'utf8')
    const uuids = JSON.parse(
      (
        rawPrefs.match(
          /user_pref\("extensions\.webextensions\.uuids",\s*"(.*?)"\);/
        )?.[1] || '{}'
      ).replace(/\\(\\)?/g, '$1')
    )
    const geckoId = manifest.browser_specific_settings?.gecko?.id
    if (geckoId) {
      return uuids[geckoId]
    }
  } catch (e) {
    console.error(e)
  }

  return null
}

async function openTabs(
  port: number,
  tabs: string[],
  manifest: any,
  isChromium: boolean,
  isRefresh?: boolean
) {
  const targets = await retryForever(() => chromeRemote.List({ port }))
  const firstTab = targets.find(t => t.type == 'page')

  const browser = await chromeRemote({
    port,
    target: targets[0],
  })

  await Promise.all(
    tabs.map(async (url, i) => {
      let target: chromeRemote.Client
      let targetId: string
      let needsNavigate = false

      if (i == 0 && firstTab) {
        targetId = firstTab.id
        needsNavigate = true
      } else {
        let params: { url: string } | undefined
        if (isChromium) {
          params = { url }
        } else {
          // Firefox doesn't support creating a new tab with a specific
          // URL => https://bugzilla.mozilla.org/show_bug.cgi?id=1817258
          needsNavigate = true
        }
        targetId = (await browser.send('Target.createTarget', params)).targetId
      }

      target = await chromeRemote({
        port,
        target: targetId,
      })

      if (needsNavigate) {
        await target.send('Page.navigate', { url })
      }

      if (!isRefresh) {
        return
      }

      const newTabPage = manifest.chrome_url_overrides?.newtab
      const isNewTab = !!newTabPage && url.endsWith('/' + newTabPage)
      if (!isNewTab) {
        return
      }

      let retries = 0
      while (true) {
        const { result } = await target.send('Runtime.evaluate', {
          expression: 'location.href',
        })

        if (url == result.value) {
          break
        }

        const delay = 100 ** (1 + 0.1 * retries++)
        console.log(
          'Expected "%s" to be "%s". Retrying in %s secs...',
          result.value,
          url,
          (delay / 1000).toFixed(1)
        )

        await new Promise(resolve => setTimeout(resolve, delay))
        await target.send('Page.navigate', {
          url: isChromium ? 'chrome://newtab/' : url,
        })
      }
    })
  )
}

async function retryForever<T>(task: () => Promise<T>) {
  const start = Date.now()
  while (true) {
    try {
      return await task()
    } catch (err: any) {
      // console.error(
      //   err.message.includes('404 Not Found') ? 'Browser not ready' : err
      // )
      if (Date.now() - start > 3000) {
        throw err
      }
    }
  }
}
