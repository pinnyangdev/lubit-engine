// main.js 를 창 없이 모듈 수준만 평가합니다.
//
//   node smoke-main.cjs
//
// electron 을 스텁으로 갈아 끼워 require('./main.js') 를 돌리면,
// require 행이나 ipcMain.handle(...) 같은 최상위 코드에서
// "정의되지 않은 식별자"(예: ipcMain) 로 죽는 실수를 설치 전에 잡아냅니다.
// (main.js 상단에서 electron import 를 실수로 줄이면 바로 이 오류가 납니다.)
const Module = require('node:module')

const noop = () => {}
const electron = {
  app: {
    setAppUserModelId: noop,
    getPath: () => process.cwd(),
    whenReady: () => new Promise(() => {}), // 이후 초기화는 돌리지 않습니다
    on: noop,
    quit: noop,
    isReady: () => false,
  },
  BrowserWindow: class {
    static fromWebContents() {
      return null
    }
  },
  Menu: { buildFromTemplate: () => ({}) },
  MenuItem: class {},
  Tray: class {
    on() {}
    setToolTip() {}
    setImage() {}
  },
  Notification: class {
    static isSupported() {
      return false
    }
  },
  ipcMain: { handle: noop, on: noop },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  shell: { openPath: async () => '', openExternal: async () => {} },
}

const original = Module._load
Module._load = function (request) {
  if (request === 'electron') return electron
  return original.apply(this, arguments)
}

try {
  require('./main.js')
  console.log('main.js 로드 통과 — 최상위 참조 오류 없음')
} catch (error) {
  console.error('main.js 로드 실패:', error && error.stack ? error.stack : error)
  process.exitCode = 1
}
