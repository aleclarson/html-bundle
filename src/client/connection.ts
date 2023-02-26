/// <reference lib="dom" />

function connect() {
  const ws = new WebSocket('wss://localhost:' + import.meta.env.HMR_PORT)
  ws.onmessage = async ({ data }) => {
    const { id, src, args } = JSON.parse(data)

    const apply: Function = (await import(src)).default
    const result = await apply(...args)

    ws.send(
      JSON.stringify({
        type: 'result',
        id,
        result,
      })
    )
  }

  let connected = false
  ws.onopen = () => {
    if (!connected) {
      console.log('[HMR] connected')
      connected = true
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
