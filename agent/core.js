// 루빗 서버 구동기 에이전트의 본체입니다.
// Electron 메인 프로세스가 쓰기도 하고, 창 없이 `node core.js`로 돌려
// 서버 없이 로그·명령만 테스트할 수도 있습니다.

const { spawn, execFile } = require('node:child_process')

const files = require('./files')
const pluginStore = require('./plugins')
const worldmap = require('./map')
const java = require('./java')
const { RelayClient } = require('./relay')

// "java -Xmx2G -jar server.jar nogui" → ['java', '-Xmx2G', '-jar', 'server.jar', 'nogui']
// 큰따옴표로 감싼 인자를 한 개로 합칩니다.
function splitCommand(input) {
  const args = []
  let current = ''
  let quoted = false
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && (char === ' ' || char === '\t')) {
      if (current) args.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) args.push(current)
  return args
}

// 자바가 콘솔에 무엇을 쓰든 한글이 깨지지 않도록 출력 글자표를 UTF-8 로 고정합니다.
// (한국어 윈도의 기본 글자표는 CP949 여서 옛 자바는 한글을 깨서 씁니다.)
const JVM_UTF8 = [
  '-Dfile.encoding=UTF-8',
  '-Dsun.stdout.encoding=UTF-8',
  '-Dstdout.encoding=UTF-8',
  '-Dsun.stderr.encoding=UTF-8',
  '-Dstderr.encoding=UTF-8',
]

// 서버 출력 한 줄을 글자로 바꿉니다. 보통은 UTF-8 이고, 옛 자바는 윈도 글자표
// (CP949)로 쓰므로 그 경우에는 euc-kr 로 다시 읽습니다.
function decodeLine(buf) {
  const body = buf.length && buf[buf.length - 1] === 13 ? buf.subarray(0, buf.length - 1) : buf
  const utf8 = body.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    const euc = new TextDecoder('euc-kr').decode(body)
    const bad = (text) => (text.match(/\uFFFD/g) || []).length
    if (bad(euc) < bad(utf8)) return euc
  } catch {
    /* 쓸 수 없는 글자표면 원래대로 둡니다 */
  }
  return utf8
}

class EngineAgent {
  constructor({ base, token, onUpdate }) {
    const origin = String(base || 'https://lubit.kr').replace(/\/+$/, '')
    // 주소에는 루트(https://lubit.kr)만 적으면 되고, API 경로는 여기서 붙입니다.
    this.base = origin.endsWith('/api/engine') ? origin : `${origin}/api/engine`
    this.origin = origin
    this.token = token
    this.onUpdate = onUpdate || (() => {})
    this.processes = new Map() // serverId -> { child, state, players, maxPlayers, buffer, flushTimer }
    this.cursor = 0
    this.timer = null
    this.logQueue = new Map() // serverId -> string[]
    this.running = true
    this.state = { connected: false, message: '시작 전', servers: [] }
    // 중계 서버(포트포워딩 없이 접속) 연결 상태
    this.relay = null
    this.relaySignature = ''
    this.relayCheck = 0
    // 로그를 화면에 알리는 타이머 — 로그가 쏟아져도 한 번에 모아서 보냅니다.
    this.emitTimer = null
  }

  emit(patch) {
    this.state = { ...this.state, ...patch }
    this.onUpdate(this.state)
  }

  // 자바 내려받기처럼 로그가 계속 올라오는 동안에도 창이 같이 움직이게 합니다.
  // 매 줄마다 통신하면 무리니까 400ms 로 모았습니다.
  scheduleEmit() {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      if (this.running) this.emit({})
    }, 400)
  }

  async request(path, options = {}) {
    const response = await fetch(this.base + path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`${response.status} ${text.slice(0, 200)}`)
    }
    const type = response.headers.get('content-type') || ''
    if (!type.includes('application/json')) {
      // API 주소가 아니라 페이지를 받아온 경우입니다.
      throw new Error(`API 응답이 아닙니다 — 주소를 확인하세요 (${this.base})`)
    }
    return response.json()
  }

  async start() {
    this.running = true
    this.tick()
    this.timer = setInterval(() => this.tick(), 1500)
  }

  stop() {
    this.running = false
    if (this.relay) this.relay.stop()
    if (this.timer) clearInterval(this.timer)
    if (this.emitTimer) {
      clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
    for (const [, entry] of this.processes) {
      try {
        entry.child?.stdin?.end()
        entry.child?.kill()
      } catch {
        /* 이미 끝난 프로세스 */
      }
    }
  }

  entry(serverId) {
    if (!this.processes.has(serverId)) {        this.processes.set(serverId, {
          child: null,
          state: 'offline',
          players: null,
          maxPlayers: null,
          names: [],
          pending: [],
          flush: null,
          recent: [],
          // 자원 모니터링 값 — 서버가 돌고 있는 동안만 채웁니다.
          metrics: { cpu: null, memMb: null, tps: null },
          sampling: false,
          sampledAt: 0,
          cpuTime: null,
          cpuAt: 0,
          tpsAt: 0,
          // 출력을 줄 단위로 모읍니다. 한 글자가 두 덩어리에 끊기면 한글이 깨집니다.
          buf: Buffer.alloc(0),
        })
    }
    return this.processes.get(serverId)
  }

  async tick() {
    if (!this.running) return
    try {
      const [{ servers }, { commands }] = await Promise.all([
        this.request('/agent/servers'),
        this.request(`/agent/commands?after=${this.cursor}`),
      ])

      this.emit({ connected: true, message: '연결됨', servers })
      void this.ensureRelay()

      for (const server of servers) {
        const entry = this.entry(server.id)
        if (entry.state === 'offline' && server.state === 'running') {
          // 서버 목록에는 실행 중으로 남아 있지만 우리 쪽엔 프로세스가 없으면 상태를 맞춰줍니다.
          await this.report(server.id, 'offline')
        }

        // 자원 모니터링 — 실행 중일 때만, 주기 통제는 sampleMetrics 안에서 합니다.
        if (entry.state === 'running' || entry.state === 'starting') {
          void this.sampleMetrics(server, entry)
          this.maybeQueryTps(server, entry)
        } else if (entry.metrics.cpu !== null || entry.metrics.memMb !== null) {
          // 프로세스가 끝나면 지난 값을 남기지 않습니다.
          entry.metrics = { cpu: null, memMb: null, tps: null }
          this.scheduleEmit()
        }
      }

      for (const command of commands) {
        this.cursor = Math.max(this.cursor, command.id)
        let ok = true
        let message = ''
        try {
          const result = await this.runLocal(command.serverId, command.type, command.args)
          if (typeof result === 'string' && result) message = result
        } catch (error) {
          ok = false
          message = error instanceof Error ? error.message : String(error)
        }
        await this.request('/agent/ack', {
          method: 'POST',
          body: { commandId: command.id, ok, message },
        }).catch(() => undefined)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const offline = /401|Failed to fetch|ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed/i.test(message)
      this.emit({
        connected: false,
        message: offline ? `서버에 연결되지 않음 — ${message.slice(0, 80)}` : message.slice(0, 120),
      })
    }
  }

  // 중계 서버 연결을 유지합니다. 서버 목록이나 중계 정보가 바뀌면 다시 연결합니다.
  async ensureRelay() {
    if (Date.now() - this.relayCheck < 20_000) return
    this.relayCheck = Date.now()

    let info
    try {
      info = await this.request('/agent/relay')
    } catch {
      return // 잠시 실패해도 다음 틱에서 다시 확인합니다.
    }

    if (!info || !info.enabled || !info.host) {
      if (this.relay) {
        this.relay.stop()
        this.relay = null
        this.relaySignature = ''
      }
      return
    }

    const servers = []
    for (const server of this.state.servers || []) {
      const assigned = (info.servers || []).find((item) => Number(item.id) === server.id)
      if (!assigned) continue
      const localPort = Number(server.port) || (await files.serverPort(server.server_dir)) || 25565
      servers.push({ id: server.id, localPort })
    }
    if (servers.length === 0) return

    const signature = JSON.stringify({ host: info.host, port: info.controlPort, servers })
    if (this.relay && this.relaySignature === signature) return

    if (this.relay) this.relay.stop()
    this.relaySignature = signature
    this.relay = new RelayClient({
      host: info.host,
      port: info.controlPort,
      token: this.token,
      servers,
      log: (message) => {
        this.pushLine(servers[0].id, `[중계] ${message}`)
      },
    })
    this.relay.start()
  }

  // 웹 콘솔에서 온 명령과 앱 안의 버튼이 같은 경로를 씁니다.
  // 결과가 필요한 명령은 문자열을 돌려주면 /agent/ack 에 실려 서버로 갑니다.
  async runLocal(serverId, type, args = {}) {
    const id = Number(serverId)
    const server = (this.state.servers || []).find((item) => item.id === id)
    if (!server) throw new Error('이 기기에 연결된 서버가 없습니다.')
    const dir = server.server_dir

    if (type === 'start') await this.startServer(server)
    else if (type === 'stop') await this.stopServer(server)
    else if (type === 'restart') {
      await this.stopServer(server)
      await this.startServer(server)
    } else if (type === 'command') this.writeLine(server, String(args.line || ''))
    else if (type === 'file_list') {
      this.requireDir(dir)
      return JSON.stringify(await files.list(dir, args.path))
    } else if (type === 'file_read') {
      this.requireDir(dir)
      return JSON.stringify(await files.read(dir, args.path))
    } else if (type === 'file_write') {
      this.requireDir(dir)
      return JSON.stringify(await files.write(dir, args.path, args.content))
    } else if (type === 'plugin_list') {
      this.requireDir(dir)
      return JSON.stringify(await pluginStore.list(dir, server.server_type))
    } else if (type === 'plugin_install') {
      this.requireDir(dir)
      return JSON.stringify(await pluginStore.install(dir, args.versionId, server.server_type))
    } else if (type === 'plugin_remove') {
      this.requireDir(dir)
      return JSON.stringify(await pluginStore.remove(dir, args.file, server.server_type))
    } else if (type === 'world_map') {
      this.requireDir(dir)
      const map = await worldmap.render(dir, args.world)
      await this.pushMap(server.id, map)
      return JSON.stringify({
        world: map.world,
        width: map.width,
        height: map.height,
        blocksPerPixel: map.blocksPerPixel,
        spawn: map.spawn,
      })
    } else throw new Error('알 수 없는 명령입니다.')
    // 창에 보여줄 로컬 상태를 바로 갱신합니다.
    this.emit({})
    return ''
  }

  requireDir(dir) {
    if (!dir) throw new Error('서버 폴더가 지정되지 않았습니다.')
  }

  // 그린 지도를 서버로 보냅니다. PNG 는 base64 로 실립니다.
  async pushMap(serverId, map) {
    await this.request('/agent/worldmap', {
      method: 'POST',
      body: {
        serverId,
        world: map.world,
        width: map.width,
        height: map.height,
        png: map.png,
      },
    })
  }

  // --- 프로세스 ------------------------------------------------------------

  async startServer(server) {
    const entry = this.entry(server.id)
    if (entry.child && entry.child.exitCode === null) throw new Error('이미 실행 중입니다')

    const args = splitCommand(server.java_cmd || '')
    if (args.length === 0) throw new Error('실행 명령이 비어 있습니다')

    // 자바가 없거나 이 서버 버전에 안 맞으면 여기서 받아 둡니다. (java 로 시작하는 명령만)
    // 자바를 받는 동안에도 화면이 멈춰 있지 않도록, 받기 시작하는 순간부터 시작 중으로 표시합니다.
    entry.state = 'starting'
    entry.players = null
    this.report(server.id, 'starting')

    let javaEnv = {}
    try {
      javaEnv = await java.envFor({
        javaCmd: server.java_cmd,
        mcVersion: server.mc_version,
        type: server.server_type,
        onProgress: (line) => this.pushLine(server.id, `[자바] ${line}`),
      })
    } catch (error) {
      this.pushLine(server.id, `[에이전트] 자바 준비 실패: ${error.message}`)
      entry.state = 'crashed'
      void this.report(server.id, 'crashed', null, null, error.message)
      throw error
    }

    this.pushLine(server.id, `$ ${server.java_cmd}`)
    const rest = args.slice(1)
    const child = spawn(args[0], /javaw?(\.exe)?$/i.test(args[0]) ? [...JVM_UTF8, ...rest] : rest, {
      cwd: server.server_dir || undefined,
      windowsHide: true,
      env: { ...process.env, ...javaEnv, JAVA_TOOL_OPTIONS: '' },
    })

    entry.child = child
    entry.state = 'starting'
    entry.players = null
    this.report(server.id, 'starting')

    const onLine = (chunk) => this.onData(server, chunk)
    child.stdout.on('data', onLine)
    child.stderr.on('data', onLine)

    child.on('error', (error) => {
      entry.state = 'crashed'
      this.pushLine(server.id, `[에이전트] 실행 실패: ${error.message}`)
      this.report(server.id, 'crashed', null, null, error.message)
    })

    child.on('exit', (code, signal) => {
      const wasRunning = entry.state === 'running' || entry.state === 'starting'
      entry.child = null
      entry.players = null
      entry.state = wasRunning && code !== 0 && code !== null ? 'crashed' : 'offline'
      this.pushLine(server.id, `[에이전트] 프로세스 종료 (code=${code}${signal ? `, signal=${signal}` : ''})`)
      this.report(server.id, entry.state, null, null, code !== 0 && code !== null ? `종료 코드 ${code}` : null)
      this.flushLogs(server.id)
    })
  }

  async stopServer(server) {
    const entry = this.entry(server.id)
    if (!entry.child || entry.child.exitCode !== null) {
      entry.state = 'offline'
      await this.report(server.id, 'offline')
      return
    }
    entry.state = 'stopping'
    this.report(server.id, 'stopping')
    this.writeLine(server, 'stop')

    const child = entry.child
    const finished = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 20000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve(true)
      })
      // 20초 안에 스스로 내려오지 않으면 강제 종료합니다.
      setTimeout(() => {
        if (child.exitCode === null) {
          this.pushLine(server.id, '[에이전트] 20초 초과 — 강제 종료합니다')
          try {
            child.kill()
          } catch {
            /* 이미 종료 */
          }
        }
      }, 15000)
    })
    if (!finished) this.pushLine(server.id, '[에이전트] 종료 대기 시간이 지났습니다')
    await this.flushLogs(server.id)
  }

  writeLine(server, line) {
    const entry = this.entry(server.id)
    if (!entry.child) throw new Error('서버가 실행되고 있지 않습니다')
    if (entry.child.exitCode !== null) throw new Error('이미 종료된 서버입니다')
    if (!line) return
    entry.child.stdin.write(line + '\n')
    this.pushLine(server.id, `> ${line}`)
  }

  onData(server, chunk) {
    const entry = this.entry(server.id)
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    entry.buf = entry.buf && entry.buf.length ? Buffer.concat([entry.buf, piece]) : piece

    // 0x0A (개행) 앞까지 모아 한 줄로 처리합니다. UTF-8 · CP949 모두 다바이트 중
    // 개행값이 들어갈 수 없으므로 바이터 단위로 쪼개도 안전합니다.
    let index
    while ((index = entry.buf.indexOf(10)) !== -1) {
      const line = decodeLine(entry.buf.subarray(0, index))
      entry.buf = entry.buf.subarray(index + 1)
      if (!line) continue
      // tps 조회 답장은 화면을 흐리지 않도록 지표로만 쓰고 로그에는 남기지 않습니다.
      if (this.consumeTps(server, line)) continue
      this.pushLine(server.id, line)
      this.parse(server, line)
    }
    // 개행이 오지 않는 폭주 입력이 화면을 못 막게 합니다.
    if (entry.buf.length > 65_536) entry.buf = Buffer.alloc(0)
    this.flushLogs(server.id)
  }

  // --- 자원 모니터링 ------------------------------------------------------
  // 돌고 있는 서버 프로세스가 실제로 쓰는 CPU · 메모리를 직접 재어 보여 줍니다.
  // Windows 에선 PowerShell 을 한 줄만 돌려 받고, 다른 환경이거나 권한이 없으면
  // 값을 비워 둡니다 — 모니터링이 서버 구동을 막는 일이 없어야 합니다.
  async sampleMetrics(server, entry) {
    if (!entry.child || entry.child.exitCode !== null) return
    if (entry.sampling) return

    const now = Date.now()
    if (now - entry.sampledAt < 4000) return

    entry.sampling = true
    entry.sampledAt = now
    try {
      const pid = entry.child.pid
      // PSObject 값을 구분자로 합쳐 텍스트로 받습니다.
      const script =
        'Get-Process -Id ' + pid + ' -ErrorAction Stop | ' +
        'ForEach-Object { $_.CPU.ToString() + "|" + $_.WorkingSet64.ToString() }'
      const out = await new Promise((resolve, reject) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { timeout: 4000, windowsHide: true },
          (error, stdout) => (error ? reject(error) : resolve(String(stdout || ''))),
        )
      })

      const [cpuTime, workingSet] = out.trim().split('|')
      const memMb = Number(workingSet) / 1048576
      if (Number.isFinite(memMb) && memMb > 0) entry.metrics.memMb = Math.round(memMb)

      const total = Number(cpuTime)
      if (Number.isFinite(total)) {
        // 두 시점의 누적 CPU 시간을 흐른 시간으로 나눠 그때그때 사용률을 구합니다.
        const deltaMs = now - entry.cpuAt
        const deltaSec = total - entry.cpuTime
        if (entry.cpuTime !== null && deltaMs > 1000 && deltaSec >= 0) {
          const percent = (deltaSec * 1000 * 100) / deltaMs
          if (Number.isFinite(percent)) entry.metrics.cpu = Math.round(Math.min(percent, 999))
        }
        entry.cpuTime = total
        entry.cpuAt = now
      }
      this.scheduleEmit()
    } catch {
      // 읽지 못하면 모니터링 값만 비웁니다.
      entry.metrics.cpu = null
      entry.metrics.memMb = null
    } finally {
      entry.sampling = false
    }
  }

  // tps 는 포지 계열에만 있는 명령이라 그것만 1분에 한 번 묻습니다.
  // 묻는 줄 자체도 화면에 남기지 않습니다.
  maybeQueryTps(server, entry) {
    const type = String(server.server_type || '').toLowerCase()
    if (type !== 'paper' && type !== 'purpur') return
    if (entry.state !== 'running') return
    if (!entry.child || entry.child.exitCode !== null) return

    const now = Date.now()
    if (now - entry.tpsAt < 60_000) return
    entry.tpsAt = now
    try {
      entry.child.stdin.write('tps\n')
    } catch {
      /* 방금 종료된 서버 */
    }
  }

  // "TPS from last1m, 5m, 15m: 20.0, 20.0, 20.0" 같은 답장에서 값을 뽑습니다.
  // 읽었으면 true 를 돌려줘 로그에 올리지 않게 합니다.
  consumeTps(server, line) {
    const match =
      line.match(/\bTPS\b[^\d]*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i) ||
      line.match(/\bTPS\s*[:=]\s*([\d.]+)/i)
    if (!match) return false

    const value = Number(match[1])
    if (!Number.isFinite(value)) return false

    const entry = this.entry(server.id)
    entry.metrics.tps = Math.round(value * 10) / 10
    this.scheduleEmit()
    return true
  }

  // 로그 한 줄에서 실행 상태와 인원을 읽습니다.
  parse(server, line) {
    const entry = this.entry(server.id)

    if (/Done \(/.test(line) || /For help, type "help"/i.test(line)) {
      // 프로세스가 이미 내려간 뒤에 stdout 에 남아 있던 마지막 줄이 도착할 수 있습니다.
      // 그때는 실행 중으로 바꾸지도, stdin 에 명령도 보내지 않습니다.
      if (entry.child && entry.child.exitCode === null && entry.state !== 'running') {
        entry.state = 'running'
        this.report(server.id, 'running')
        try {
          this.writeLine(server, 'list') // 접속 인원을 바로 파악합니다
        } catch {
          /* 방금 종료된 서버 */
        }
      }
    }
    const online = line.match(/There are (\d+) of a max of (\d+) players online: ?([^]*)/i)
    if (online) {
      entry.players = Number(online[1])
      entry.maxPlayers = Number(online[2])
      // "There are 2 of a max of 20 players online: Steve, Alex" 에서 이름을 뽑습니다.
      entry.names = (online[3] || '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => /^[A-Za-z0-9_]{1,16}$/.test(name))
      this.report(server.id, entry.state, entry.players, entry.maxPlayers)
      return
    }
    const joined = line.match(/\b([A-Za-z0-9_]{3,16}) joined the game\b/)
    const left = line.match(/\b([A-Za-z0-9_]{3,16}) (?:left the game|lost connection:|was kicked)/i)
    if (joined) {
      entry.players = (entry.players ?? 0) + 1
      if (!entry.names.includes(joined[1])) entry.names.push(joined[1])
      this.report(server.id, entry.state, entry.players, entry.maxPlayers)
    } else if (left) {
      entry.players = Math.max(0, (entry.players ?? 1) - 1)
      entry.names = entry.names.filter((name) => name !== left[1])
      this.report(server.id, entry.state, entry.players, entry.maxPlayers)
    }
  }

  // --- 통신 ----------------------------------------------------------------

  // 창(UI)에 보여줄 최근 로그. 대시보드에는 별도로 올라갑니다.
  locals() {
    const out = []
    for (const [id, entry] of this.processes) {
      out.push({
        id,
        state: entry.state,
        players: entry.players,
        maxPlayers: entry.maxPlayers,
        // 플레이어 탭에서 바로 이름을 보여 주기 위해 로그에서 읽은 이름도 함께 냅니다.
        names: entry.names ?? [],
        lines: entry.recent.slice(-200),
        // 콘솔 상단에 띄우는 자원 값 — 못 읽으면 빈칸으로 둡니다.
        cpu: entry.metrics?.cpu ?? null,
        memMb: entry.metrics?.memMb ?? null,
        tps: entry.metrics?.tps ?? null,
      })
    }
    return out
  }

  pushLine(serverId, line) {
    const entry = this.entry(serverId)
    entry.recent.push(line)
    if (entry.recent.length > 300) entry.recent.splice(0, entry.recent.length - 300)
    entry.pending.push(line)
    if (entry.pending.length >= 20) this.flushLogs(serverId)
    else if (!entry.flush) entry.flush = setTimeout(() => this.flushLogs(serverId), 600)
    // 창(데스크톱 앱)의 로그도 같이 갱신합니다.
    this.scheduleEmit()
  }

  async flushLogs(serverId) {
    const entry = this.entry(serverId)
    if (entry.flush) {
      clearTimeout(entry.flush)
      entry.flush = null
    }
    if (entry.pending.length === 0) return
    const lines = entry.pending.splice(0, entry.pending.length)
    await this.request('/agent/logs', { method: 'POST', body: { serverId, lines } }).catch(() => {
      // 실패한 로그는 다시 넣어두지 않습니다 — 대시보드가 놓치는 편이 폭주보다 낫습니다.
    })
  }

  async report(serverId, state, players, maxPlayers, error) {
    const entry = this.entry(serverId)
    entry.state = state
    if (players !== undefined && players !== null) entry.players = players
    if (maxPlayers !== undefined && maxPlayers !== null) entry.maxPlayers = maxPlayers
    await this.request('/agent/status', {
      method: 'POST',
      body: {
        serverId,
        state,
        players: entry.players,
        maxPlayers: entry.maxPlayers,
        names: (entry.names ?? []).slice(0, 100),
        error: error ?? null,
      },
    }).catch(() => undefined)
  }

  async ping() {
    await this.request('/agent/ping', { method: 'POST' }).catch(() => undefined)
  }
}

module.exports = { EngineAgent, splitCommand }

// `node core.js --base http://localhost:5173 --token <기기토큰>` 로 창 없이 돌릴 수 있습니다.
if (require.main === module) {
  const args = process.argv.slice(2)
  const value = (flag) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : ''
  }
  const base = value('--base') || process.env.LUBIT_BASE || 'https://lubit.kr'
  const token = value('--token') || process.env.LUBIT_TOKEN
  if (!token) {
    console.error('기기 토큰이 필요합니다: node core.js --base <주소> --token <토큰>')
    process.exit(1)
  }
  const agent = new EngineAgent({
    base,
    token,
    onUpdate: (state) => {
      if (state.message) console.log(`[agent] ${state.message}`)
    },
  })
  console.log(`[agent] ${base} 에 연결합니다`)
  void agent.start()
  void agent.ping()
  setInterval(() => void agent.ping(), 30000)
  process.on('SIGINT', () => {
    agent.stop()
    process.exit(0)
  })
}
