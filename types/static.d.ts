declare module 'critical'

declare module 'fx-runner' {
  export default function runFirefox(options?: {
    'binary-args-first'?: boolean
    'binary-args'?: string | string[]
    'new-instance'?: boolean
    'no-remote'?: boolean
    binary?: string
    foreground?: boolean
    listen?: number
    profile?: string
  }): Promise<void>
}

declare module 'foxdriver' {
  export function attach(
    host: string,
    port: number
  ): Promise<{ tabs: Tab[]; browser: Browser }>

  interface Tab {}

  interface Browser {}
}

declare module 'web-ext' {
  export const cmd: {
    run: (params: CmdRunParams) => Promise<MultiExtensionRunner>
    build: (params: CmdBuildParams, options?: CmdBuildOptions) => Promise<any>
  }

  interface MultiExtensionRunner {
    reloadAllExtensions(): Promise<any[]>
    extensionRunners: ExtensionRunner[]
  }

  type ExtensionRunner = {
    chromiumInstance?: import('chrome-launcher').Launcher & {
      process: import('child_process').ChildProcess
    }
    profile?: {
      path(): string
    }
    runningInfo?: {
      firefox: import('child_process').ChildProcess
      debuggerPort: number
    }
  }

  type CmdRunParams = {
    artifactsDir: string
    browserConsole: boolean
    devtools: boolean
    pref?: FirefoxPreferences
    firefox: string
    firefoxProfile?: string
    profileCreateIfMissing?: boolean
    ignoreFiles?: Array<string>
    keepProfileChanges: boolean
    noInput?: boolean
    noReload: boolean
    preInstall: boolean
    sourceDir: string
    watchFile?: Array<string>
    watchIgnored?: Array<string>
    startUrl?: Array<string>
    target?: Array<string>
    args?: Array<string>
    firefoxPreview: Array<string>

    // Android CLI options.
    adbBin?: string
    adbHost?: string
    adbPort?: string
    adbDevice?: string
    adbDiscoveryTimeout?: number
    adbRemoveOldArtifacts?: boolean
    firefoxApk?: string
    firefoxApkComponent?: string

    // Chromium Desktop CLI options.
    chromiumBinary?: string
    chromiumProfile?: string
  }

  type CmdBuildParams = {
    sourceDir: string
    artifactsDir: string
    asNeeded?: boolean
    overwriteDest?: boolean
    ignoreFiles?: Array<string>
    filename?: string
  }

  type CmdBuildOptions = {
    manifestData?: any
    showReadyMessage?: boolean
    shouldExitProgram?: boolean
  }
}
