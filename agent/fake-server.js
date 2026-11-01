// 자바 없이 에이전트를 시험하기 위한 가짜 서버입니다.
//   node fake-server.js
// 실제 마크 서버 대신 쓰며, 콘솔 명령(list / stop / say)에 반응합니다.

let players = 0

console.log('[12:00:00] Starting minecraft server on *:25565')
console.log('[12:00:00] Loading properties: level-name=world')

setTimeout(() => {
  console.log('Done (1.234s)! For help, type "help"')
}, 400)

setTimeout(() => {
  players = 2
  console.log('Steve joined the game')
  console.log('Alex joined the game')
}, 1800)

setInterval(() => {
  console.log(`[12:00:${String(new Date().getSeconds()).padStart(2, '0')}] Keeping the server alive (${players} online)`)
}, 4000)

process.stdin.on('data', (chunk) => {
  const command = String(chunk).trim()
  if (!command) return
  if (command === 'list') {
    console.log(`There are ${players} of a max of 20 players online`)
  } else if (command === 'stop') {
    console.log('Stopping the server')
    setTimeout(() => process.exit(0), 150)
  } else if (command.startsWith('say ')) {
    console.log(`[Server] ${command.slice(4)}`)
  } else if (command === 'list') {
    console.log('Unknown command')
  } else {
    console.log(`Unknown command: ${command}`)
  }
})
