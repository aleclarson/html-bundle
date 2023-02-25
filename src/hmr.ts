/// <reference lib="dom" />

type Browser = {
  runtime: { reload: () => Promise<void> }
}

declare const browser: Browser | undefined
declare const chrome: Browser | undefined

function connect() {
  const ws = new WebSocket('ws://localhost:5001')
  ws.onmessage = async ({ data }) => {
    const update = JSON.parse(data)
    if (update.type === 'full-reload') {
      if (typeof browser !== 'undefined') {
        await browser.runtime.reload()
      } else if (typeof chrome !== 'undefined') {
        await chrome.runtime.reload()
      } else {
        location.reload()
      }
    } else if (update.type === 'css') {
      const { file, code: cssText } = update
      const prevStyle = document.querySelector(
        `link[href="${file}"], style[data-href="${file}"]`
      )
      if (prevStyle) {
        const url = new URL(file, location.origin)
        console.log('[HMR] css changed:', url.href)
        const style = document.createElement('style')
        style.setAttribute('data-href', file)
        style.innerHTML = cssText
        prevStyle.after(style)
        prevStyle.remove()
      }
    }
  }

  let connected = false
  ws.onopen = () => {
    if (!connected) {
      console.log('[HMR] connected')
      connected = true

      if (/extension/.test(location.protocol)) {
        ws.send(
          JSON.stringify({
            type: 'webext:uuid',
            protocol: location.protocol,
            id: location.hostname,
          })
        )
      }
    }
  }
  ws.onclose = () => {
    if (connected) {
      console.log('[HMR] disconnected')
      connected = false
    }
    setTimeout(connect, 1000)
  }
  ws.onerror = () => {
    setTimeout(connect, 1000)
  }
}

connect()
