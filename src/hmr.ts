/// <reference lib="dom" />

declare const browser: {
  runtime: {
    id: string
    getURL: (path: string) => URL
    reload: () => Promise<void>
  }
}

function connect() {
  const ws = new WebSocket('ws://localhost:5001')
  ws.onopen = () => {
    console.log('[HMR] connected')
  }
  ws.onclose = () => {
    console.log('[HMR] disconnected')
    setTimeout(connect, 1000)
  }
  ws.onerror = () => {
    setTimeout(connect, 1000)
  }
  ws.onmessage = async ({ data }) => {
    const update = JSON.parse(data)
    if (update.type === 'full-reload') {
      if (typeof browser !== 'undefined') {
        await browser.runtime.reload()
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
}

connect()
