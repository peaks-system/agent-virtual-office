'use strict'
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function resolveCodexExecutable({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return 'codex'
  for (const directory of (env.PATH || env.Path || '').split(';').filter(Boolean)) {
    const candidate = path.join(directory.replace(/^"|"$/g, ''), 'codex.exe')
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  // Desktop installations keep versioned CLI binaries outside Explorer's PATH.
  const bin = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
  if (bin && fs.existsSync(bin)) {
    const candidates = fs.readdirSync(bin, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
      .map(entry => path.join(bin, entry.name, 'codex.exe'))
      .filter(file => fs.existsSync(file) && fs.statSync(file).isFile())
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    if (candidates.length) return candidates[0]
  }
  return 'codex.exe'
}

function buildCodexArgs({ instructions, cwd }) {
  return ['exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
    '-s', 'read-only', '-C', cwd, '--json', '--color', 'never',
    '--disable', 'shell_tool', '--disable', 'apps', '--disable', 'multi_agent',
    '-c', 'web_search="disabled"', '-c', 'features.unified_exec=false',
    '-c', 'project_doc_max_bytes=0',
    '-c', 'developer_instructions=' + JSON.stringify(instructions), '-']
}

function createCodexProvider({ executable, spawnImpl = spawn, timeoutMs = 120000 } = {}) {
  return ({ instructions, input, cwd, signal }) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('実行を中止しました。'))
    let child, timer, settled = false, buffer = '', final = '', bytes = 0
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) { child?.kill(); reject(error) } else resolve(final)
    }
    const abort = () => finish(new Error('実行を中止しました。'))
    const parseLine = line => {
      if (!line.trim()) return
      let event
      try { event = JSON.parse(line) } catch { return finish(new Error('AIからの応答形式を確認できませんでした。')) }
      if (event.type === 'error' || event.type === 'turn.failed') return finish(new Error('AI実行に失敗しました。Codexの接続状態を確認してください。'))
      if (event.item && !['agent_message', 'reasoning'].includes(event.item.type)) {
        return finish(new Error('許可されていないツール実行を検出したため停止しました。'))
      }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        if (typeof event.item.text !== 'string' || Buffer.byteLength(event.item.text) > 1048576) return finish(new Error('AIの出力が上限を超えました。'))
        final = event.item.text
      }
    }
    try {
      child = spawnImpl(executable || resolveCodexExecutable(), buildCodexArgs({ instructions, cwd }), { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      timer = setTimeout(() => finish(new Error('AI実行が制限時間を超えました。')), Math.min(timeoutMs, 120000))
      signal?.addEventListener('abort', abort, { once: true })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', data => {
        if (settled) return
        bytes += Buffer.byteLength(data)
        if (bytes > 2097152) return finish(new Error('AIの出力が上限を超えました。'))
        buffer += data
        let newline
        while (!settled && (newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          parseLine(line)
        }
      })
      // Never retain raw stderr, which can contain provider/account diagnostics.
      child.stderr.resume()
      child.on('error', () => finish(new Error('Codexを起動できません。インストール状態を確認してください。')))
      child.on('close', code => {
        if (settled) return
        if (buffer) parseLine(buffer)
        if (settled) return
        if (code !== 0 || !final.trim()) return finish(new Error('AIの結果を取得できませんでした。Codexの接続状態を確認してください。'))
        finish()
      })
      child.stdin.on('error', () => finish(new Error('AIへの入力を送信できませんでした。')))
      child.stdin.end(input)
    } catch { finish(new Error('Codexを起動できません。インストール状態を確認してください。')) }
  })
}
module.exports = { createCodexProvider, buildCodexArgs, resolveCodexExecutable }
