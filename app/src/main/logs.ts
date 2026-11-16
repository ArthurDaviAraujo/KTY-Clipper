import { EventEmitter } from 'events'
import type { Db } from './db'
import type { LogEntry, LogLevel } from '../shared/types'

/** Guarda os registros no banco (últimos 30 dias) e avisa as telas. */
export class Logger extends EventEmitter {
  constructor(private db: Db) {
    super()
    this.db.prepare('DELETE FROM logs WHERE time < ?').run(Date.now() - 30 * 24 * 3600 * 1000)
  }

  log(level: LogLevel, source: string, message: string): void {
    const time = Date.now()
    const r = this.db.prepare('INSERT INTO logs(time, level, source, message) VALUES (?, ?, ?, ?) RETURNING id').get(time, level, source, message) as { id: number }
    const entry: LogEntry = { id: r.id, time, level, source, message }
    const line = `[${source}] ${message}`
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
    this.emit('log', entry)
  }

  info = (source: string, message: string) => this.log('info', source, message)
  warn = (source: string, message: string) => this.log('warn', source, message)
  error = (source: string, message: string) => this.log('error', source, message)

  list(limit = 300): LogEntry[] {
    return (this.db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(limit) as unknown as LogEntry[]).reverse()
  }
}
