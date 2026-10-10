// Screenshot the running app (after loading the demo signal) via headless Chrome + DevTools protocol.
// usage: CHROME=/usr/bin/google-chrome node scripts/shot.mjs URL OUT.png [width] [height] [dark] [script]
// INIT_STATE='{"spec":{...}}' preloads the app's saved settings (localStorage) before the page starts.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const PORT = 9314
const [url, out, w = '1440', h = '1000', dark, script] = process.argv.slice(2)
const chrome = spawn(process.env.CHROME ?? 'chromium', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  let target
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200)
    target = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null)
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) pending.get(m.id)(m.result ?? m.error)
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
  }
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })) })
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.value
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 600 })
  if (dark) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  if (process.env.INIT_STATE) await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('dsp-filter-lab:v1', ${JSON.stringify(process.env.INIT_STATE)})` })
  await send('Page.navigate', { url })
  let ready = false
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(250)
    ready = await evaluate("document.querySelectorAll('.plots canvas').length >= 5")
  }
  // Load the demo signal and wait for both spectrograms.
  await evaluate("[...document.querySelectorAll('button')].find((b) => /demo signal|Демо-сигнал/.test(b.textContent))?.click()")
  let spec = false
  for (let i = 0; i < 80 && !spec; i++) {
    await sleep(250)
    spec = await evaluate("document.querySelectorAll('.specs canvas').length === 2 && !document.body.textContent.includes('Computing') && !document.body.textContent.includes('Обчислення')")
  }
  if (process.env.DEBUG_LS) console.log(await evaluate("localStorage.getItem('dsp-filter-lab:v1')"))
  if (script) await evaluate(script)
  await sleep(1000)
  // Capture the full page height.
  const height = await evaluate('document.documentElement.scrollHeight')
  await send('Emulation.setDeviceMetricsOverride', { width: +w, height: Math.min(height, 2600), deviceScaleFactor: 1, mobile: +w < 600 })
  await sleep(500)
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(ready ? 'plots ready' : 'TIMED OUT waiting for plots', spec ? '+ spectrograms' : '(no spectrograms)', '→', out)
  if (errors.length) console.log('page errors:\n' + errors.join('\n'))
  ws.close()
} finally {
  chrome.kill()
}
