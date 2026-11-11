import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

const MAX_LOG_BYTES = 5 * 1024 * 1024

export class Logger {
  constructor(file) {
    this.file = file
    mkdirSync(dirname(file), { recursive: true })
  }

  write(message) {
    const line = '[' + new Date().toISOString() + '] ' + message + '\n'
    try {
      if (existsSync(this.file) && statSync(this.file).size > MAX_LOG_BYTES) {
        renameSync(this.file, this.file + '.1')
      }
      appendFileSync(this.file, line, 'utf8')
    } catch {
      /* 日志失败不影响主流程 */
    }
  }

  info(message) { this.write('INFO ' + message) }
  error(message) { this.write('ERROR ' + message) }
}
