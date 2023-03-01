# @alloc/html-bundle

Divergent fork of `html-bundle` that I made for simple-as-fuck SPA setups. Unfortunately no JS HMR, but it's not a big deal for me.

<sub>You should probably just use Vite.</sub>

### Features

- ESBuild integration (TypeScript + ESM syntax, code splitting, dynamic imports)
- LightningCSS integration
- Browserslist integration
- HTML entry point scanning
- JS/CSS bundling
- `import.meta.glob` support
- worker bundling with `new URL('./worker.ts', import.meta.url)`
- great for [Web Extension](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions) development
  - dev server for painless extension reloading
  - run multiple browsers at once (or use `--webext=chromium` to only run Chrome)
- `--watch` mode
  - CSS hot reloading
  - HTML rebuild on JS/HTML changes
  - sets `NODE_ENV=development`
- default mode
  - HTML/JS/CSS minification
  - critical CSS extraction (via `isCritical` option or `--critical` flag)
  - sets `NODE_ENV=production`

### Usage

Before running `html-bundle`, you should move your HTML files into the `src/` directory and use relative paths for JS/CSS references inside your HTML files.

```sh
# Run in development mode
pnpm html-bundle --watch

# Run in production mode
pnpm html-bundle
```

If you want TypeScript to recognize `import.meta.glob` calls, you can add the following to your `tsconfig.json` file.

```json
{
  "compilerOptions": {
    "lib": ["esnext"],
    "types": ["@alloc/html-bundle/client.d.ts"]
  }
}
```

### Configuration

The `bundle.config.js` file allows for customization.

```js
export default {
  // Browserslist targets.
  targets: ['defaults', 'not IE 11'],
  // Input and output directories.
  src: './src',
  build: './build',
  // Tool-specific options.
  esbuild: {...},
  lightningcss: {...},
  // If true, will extract critical CSS from the HTML files.
  isCritical: false,
  // If true, will delete the build directory before building.
  deletePrev: false,
}
```
