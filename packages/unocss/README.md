# @htmelt/unocss

[UnoCSS](https://github.com/antfu/unocss) plugin for [HTMelt](https://github.com/alloc/htmelt).

## How It Works

1. It loads your `unocss.config.js` file.
2. It scans your JSX and TSX files for tokens identified by UnoCSS
   plugins/presets.
3. For each JSX and TSX module, it generates a separate CSS file and
   adds it to the document with JavaScript.

## Roadmap

- [ ] Use lightningcss to remove duplicate CSS rules on a per-chunk basis.

## Install

```sh
pnpm install -D @htmelt/unocss
yarn add -D @htmelt/unocss
npm install --save-dev @htmelt/unocss
```
