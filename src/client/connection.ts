/// <reference lib="dom" />

function connect() {
  const port = process.env.HMR_PORT
  const ws = new WebSocket('ws://localhost:' + port)
  ws.onmessage = async ({ data }) => {
    const { id, body, env } = JSON.parse(data)
    const module = { exports: undefined }
    const evaluate = new Function('module', ...Object.keys(env), body)
    evaluate(module, ...Object.values(env))
    ws.send(
      JSON.stringify({
        type: 'result',
        id,
        result: module.exports,
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
