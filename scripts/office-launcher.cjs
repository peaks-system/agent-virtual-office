// Local-only development launcher. No credentials, PID files, or global settings.
const net = require('node:net')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')

const ROOT = path.resolve(__dirname, '..')
const PROTOCOL = 'avo-local-launcher-v1'

function windowsUserSid(run = execFileSync) {
  try {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe')
    const output = run(executable, ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 16384,
    })
    const match = output.trim().match(/^"[^"]*","(S-\d+(?:-\d+)+)"$/)
    if (!match) throw new Error('Invalid Windows identity')
    return match[1]
  } catch {
    throw new Error('Windowsの実行ユーザーを確認できません。通常のエクスプローラーから起動し直してください。')
  }
}

function controlAddress(root, port, platform = process.platform, principal) {
  // A sandbox can inherit USERPROFILE from another user. Pipe ACLs follow the
  // actual process token, so namespace by its SID rather than that environment.
  const user = principal ?? (process.platform === 'win32' ? windowsUserSid() : process.getuid())
  const identity = `${user}|${path.resolve(root)}|${port}`
  const suffix = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24)
  return platform === 'win32' ? `\\\\.\\pipe\\avo-${suffix}` : path.join(os.tmpdir(), `avo-${suffix}.sock`)
}

function parseArgs(args) {
  const action = args[0] || 'start'
  if (!['start', 'stop'].includes(action)) throw new Error('操作は start または stop を指定してください。')
  const portIndex = args.indexOf('--port')
  const port = portIndex < 0 ? 5173 : Number(args[portIndex + 1])
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ポート番号が正しくありません。')
  return { action, port, openBrowser: !args.includes('--no-browser') }
}

function requestControl(address, action, root = ROOT) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address)
    let text = ''
    socket.setTimeout(1800)
    socket.on('connect', () => socket.write(JSON.stringify({ protocol: PROTOCOL, root, action }) + '\n'))
    socket.on('timeout', () => socket.destroy(new Error('起動済みオフィスの応答がありません。起動用の画面を確認してください。')))
    socket.on('error', reject)
    socket.on('data', chunk => {
      text += chunk.toString()
      if (text.length > 4096) return socket.destroy(new Error('起動管理の応答が正しくありません。'))
      if (!text.includes('\n')) return
      try {
        const response = JSON.parse(text.slice(0, text.indexOf('\n')))
        if (response.protocol !== PROTOCOL || response.root !== root) throw new Error('起動管理の応答を確認できません。他のプロセスは停止しません。')
        if (!response.ok) throw new Error('オフィスは起動処理中です。少し待ってから、もう一度開いてください。')
        resolve(response)
        socket.end()
      } catch (error) { socket.destroy(error) }
    })
    socket.on('end', () => { if (!text.includes('\n')) reject(new Error('起動管理との接続が終了しました。')) })
  })
}

function createControlServer(root, onStop, isReady = () => true) {
  return net.createServer(socket => {
    let text = ''
    socket.setTimeout(2000, () => socket.destroy())
    socket.on('error', () => {})
    socket.on('data', chunk => {
      text += chunk.toString()
      if (text.length > 4096) return socket.destroy()
      if (!text.includes('\n')) return
      let message
      try { message = JSON.parse(text.slice(0, text.indexOf('\n'))) } catch { return socket.destroy() }
      if (message.protocol !== PROTOCOL || message.root !== root || !['status', 'stop'].includes(message.action)) return socket.destroy()
      socket.removeAllListeners('data')
      const ready = isReady()
      socket.end(JSON.stringify({ protocol: PROTOCOL, root, ok: ready, pid: process.pid }) + '\n', () => {
        if (ready && message.action === 'stop') onStop()
      })
    })
  })
}

function openOffice(url) {
  const child = process.platform === 'win32'
    ? spawn('explorer.exe', [url], { windowsHide: true, detached: true, stdio: 'ignore' })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' })
  child.on('error', () => console.log(`ブラウザーを開けませんでした。次のアドレスを開いてください: ${url}`))
  child.unref()
}

async function run(options) {
  const { action, port, openBrowser } = options
  const address = controlAddress(ROOT, port)
  const url = `http://127.0.0.1:${port}/?lang=ja`
  if (action === 'stop') {
    try {
      await requestControl(address, 'stop')
      console.log('このフォルダーから起動したオフィスに終了を依頼しました。')
    } catch (error) {
      if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) console.log('この起動ボタンで開始したオフィスは動いていません。手動起動した場合は、その画面で Ctrl+C を押してください。')
      else throw error
    }
    return
  }

  try {
    await requestControl(address, 'status')
    console.log(`オフィスはすでに起動しています: ${url}`)
    if (openBrowser) openOffice(url)
    return
  } catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error
  }

  const vitePath = path.join(ROOT, 'node_modules', 'vite', 'dist', 'node', 'index.js')
  if (!fs.existsSync(vitePath)) throw new Error('必要なライブラリが見つかりません。このフォルダーで npm install を実行できる環境を準備してください。自動インストールは行っていません。')
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 以上が必要です。新しい Node.js を準備してください。')

  let vite
  let closing = false
  let ready = false
  let control
  const close = async () => {
    if (closing) return
    closing = true
    if (control?.listening) await new Promise(resolve => control.close(resolve))
    await vite?.close()
    console.log('オフィスを終了しました。ブラウザーのタブは閉じてかまいません。')
  }
  control = createControlServer(ROOT, () => { close().catch(error => { console.error(error.message); process.exitCode = 1 }) }, () => ready && !closing)
  // Reserve the control address first: racing launch buttons cannot start two servers.
  await new Promise((resolve, reject) => { control.once('error', reject); control.listen(address, resolve) })
  try {
    const { createServer } = await import(pathToFileURL(vitePath).href)
    vite = await createServer({ root: ROOT, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
    await vite.listen()
    ready = true
  } catch (error) {
    await close()
    if (/already in use|EADDRINUSE/i.test(error.message)) throw new Error(`ポート ${port} は他のアプリまたは手動起動したオフィスが使用中です。使用中のアプリをご確認ください。他のプロセスは停止していません。`)
    throw new Error(`オフィスを起動できませんでした: ${error.message}`)
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  console.log(`オフィスを起動しました: ${url}\n終了するときは Stop-Office.cmd を開くか、この画面で Ctrl+C を押してください。`)
  if (openBrowser) openOffice(url)
}

if (require.main === module) {
  Promise.resolve().then(() => run(parseArgs(process.argv.slice(2)))).catch(error => {
    console.error(`エラー: ${error.code === 'EPERM' || error.code === 'EACCES'
      ? '起動管理への接続が拒否されました。別の権限で起動したオフィスがある場合は、その起動画面で Ctrl+C を押し、通常のエクスプローラーから開き直してください。'
      : error.message}`)
    process.exitCode = 1
  })
}

module.exports = { controlAddress, windowsUserSid, parseArgs, requestControl, createControlServer, PROTOCOL, ROOT }
