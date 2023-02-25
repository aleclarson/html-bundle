import chromeRemote from 'chrome-remote-interface'
import exitHook from 'exit-hook'
import fs from 'fs'
import { cyan } from 'kleur/colors'
import path from 'path'
import { cmd as webExtCmd } from 'web-ext'
import { Config, WebExtension } from '../../config.mjs'
import type { Flags } from '../bundle.mjs'
import { buildEvents, hmrClientEvents } from '../events.mjs'
import { Plugin } from '../plugin.mjs'
import { findFreeTcpPort, resolveHome, toArray } from '../utils.mjs'

export const webextPlugin: Plugin = (config, flags) => {
  return {
    async buildEnd(wasRebuild) {
      if (!wasRebuild) {
        await enableWebExtension(config, flags)
      }
    },
  }
}

function parseContentSecurityPolicy(str: string) {
  const policies = str.split(/ *; */)
  const result: Record<string, Set<string>> = {}
  for (const policy of policies) {
    const [name, ...values] = policy.split(/ +/)
    result[name] = new Set(values)
  }
  Object.defineProperty(result, 'toString', {
    value: () => {
      return Object.entries(result)
        .map(([name, values]) => `${name} ${[...values].join(' ')}`)
        .join('; ')
    },
  })
  return result
}

async function enableWebExtension(config: Config, flags: Flags) {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'))
  if (flags.watch) {
    const originalManifest = structuredClone(manifest)

    // Allow scripts to be loaded from the dev server.
    const csp = parseContentSecurityPolicy(manifest.content_security_policy)
    csp['script-src'].add('http://localhost:' + config.server.port)
    manifest.content_security_policy = csp.toString()

    fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2))
    exitHook(() => {
      fs.writeFileSync(
        'manifest.json',
        JSON.stringify(originalManifest, null, 2)
      )
    })
  }

  const ignoredFiles = new Set(fs.readdirSync(process.cwd()))
  const keepFile = (file: unknown) => {
    if (typeof file == 'string') {
      ignoredFiles.delete(file.split('/')[0])
      if (fs.existsSync(file)) {
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

  keepFile(config.build)
  keepFile('manifest.json')
  keepFile('public')
  keepFile(manifest.browser_action?.default_popup)
  keepFiles(manifest.background?.scripts)
  keepFiles(manifest.browser_action?.default_icon)
  keepFiles(manifest.chrome_url_overrides)
  keepFiles(manifest.content_scripts)
  keepFiles(manifest.icons)

  const webextConfig = config.webext || {}
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

      const runner = await webExtCmd.run({
        ...params,
        target: [target],
        sourceDir: process.cwd(),
        artifactsDir,
        noReload: true,
      })

      await refreshOnRebuild(target, runner, manifest, tabs, port).catch(e => {
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

  console.log(target + ':', { port, extProtocol })
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
  hmrClientEvents.on('webext:uuid', event => {
    if (event.protocol == extProtocol) {
      uuid = event.id
    }
  })

  if (isChromium) {
    // Ensure not all tabs will be closed as a result of the extension
    // being reloaded, since that will cause an unsightly reopening of
    // the browser window.
    buildEvents.on('will-rebuild', async () => {
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

  buildEvents.on('rebuild', async () => {
    const extOrigin = extProtocol + '//' + uuid

    console.log(cyan('↺'), extOrigin)
    console.log(target + ':', { port, extProtocol })

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
      await openTabs(port, missingTabs, manifest, isChromium, true)
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
      console.log('opening:', { url, isChromium })

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
