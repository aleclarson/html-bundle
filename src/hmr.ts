/// <reference lib="dom" />

const ws = new WebSocket('ws://localhost:5001')
ws.onopen = () => {
  console.log('[HMR] connected')
}
ws.onmessage = async ({ data }) => {
  const { file, type } = JSON.parse(data)
  if (type === 'css') {
    const prevStyle = document.querySelector(
      `link[href="${file}"], style[data-href="${file}"]`
    )
    console.log('[HMR] css changed:', file, prevStyle)
    if (prevStyle) {
      fetch(file, { cache: 'no-store' })
        .then(resp => resp.text())
        .then(css => {
          const style = document.createElement('style')
          style.setAttribute('data-href', file)
          style.innerHTML = css
          prevStyle.after(style)
          prevStyle.remove()
        })
    }
  }
}
