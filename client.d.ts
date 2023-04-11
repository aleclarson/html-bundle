interface ImportMeta {
  env: ImportMetaEnv
  glob: ImportGlobFunction
}

interface ImportMetaEnv {
  HMR_PORT: number
  DEV_URL: string
  DEV: boolean
}

declare const process: {
  env: {
    NODE_ENV: string
  }
}

type ImportGlobOptions<TEager extends boolean> = {
  eager?: TEager
  import?: string
}

interface ImportGlobFunction {
  <TEager extends boolean = false>(
    pattern: string | string[],
    options?: ImportGlobOptions<TEager>
  ): TEager extends true
    ? Record<string, unknown>
    : Record<string, () => Promise<any>>
}
