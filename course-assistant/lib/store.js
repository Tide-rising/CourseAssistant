import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export const MAX_OBSERVATIONS = 50
export const MAX_HISTORY = 200
export const MAX_SEEN = 500

/** 标题归一化：去空白、标点、符号并转小写，用于去重。 */
export function normalizeTitle(title) {
  return String(title || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function emptyState() {
  return {
    version: 1,
    current: null,
    observations: [],
    history: [],
    seen: {},
    stats: { checks: 0, videos: 0, startedAt: Date.now() },
  }
}

/**
 * 扫描笔记目录下的 .docx（<notesDir>/<学科>/<标题>.docx），用于把外部生成的笔记并入历史。
 * @returns {{title:string, subject:string, docx:string, md:string, generatedAt:number}[]}
 */
export function scanNotesDir(dir) {
  const found = []
  const walk = (current, depth) => {
    let entries = []
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (depth < 2) walk(full, depth + 1)
        continue
      }
      const name = String(entry.name || '')
      if (!/\.docx$/i.test(name)) continue
      if (name.startsWith('~$')) continue
      const title = name.replace(/\.docx$/i, '').trim()
      if (!title) continue
      let generatedAt = Date.now()
      try { generatedAt = statSync(full).mtimeMs } catch { /* 保持当前时间 */ }
      const mdPath = full.replace(/\.docx$/i, '.md')
      found.push({
        title,
        subject: depth === 0 ? '其他' : basename(current),
        docx: full,
        md: existsSync(mdPath) ? mdPath : '',
        generatedAt,
      })
    }
  }
  if (!dir) return found
  walk(dir, 0)
  found.sort((a, b) => b.generatedAt - a.generatedAt)
  return found
}

export class Store {
  constructor(file) {
    this.file = file
    this.state = emptyState()
    this.load()
  }

  load() {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''))
      if (!raw || typeof raw !== 'object') return
      this.state = {
        ...emptyState(),
        ...raw,
        observations: Array.isArray(raw.observations) ? raw.observations.slice(0, MAX_OBSERVATIONS) : [],
        history: Array.isArray(raw.history) ? raw.history.slice(0, MAX_HISTORY) : [],
        seen: raw.seen && typeof raw.seen === 'object' ? raw.seen : {},
        stats: { ...emptyState().stats, ...(raw.stats || {}) },
      }
    } catch {
      /* 首次运行或文件损坏：保持空状态 */
    }
  }

  save() {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp.' + process.pid
    writeFileSync(tmp, JSON.stringify(this.state, null, 2) + '\n', 'utf8')
    renameSync(tmp, this.file)
  }

  /** 连续同标题同结论的观察只更新时间，避免列表被同一行刷屏。 */
  addObservation(observation) {
    const prev = this.state.observations[0]
    const same = prev
      && prev.verdict === observation.verdict
      && prev.title === observation.title
      && prev.detail === observation.detail
    if (same) {
      prev.time = observation.time
    } else {
      this.state.observations.unshift(observation)
      if (this.state.observations.length > MAX_OBSERVATIONS) {
        this.state.observations.length = MAX_OBSERVATIONS
      }
    }
    this.state.stats.checks = (this.state.stats.checks || 0) + 1
    this.save()
    return !same
  }

  markSeen(title, time = Date.now()) {
    const key = normalizeTitle(title)
    if (!key) return
    this.state.seen[key] = time
    const keys = Object.keys(this.state.seen)
    if (keys.length > MAX_SEEN) {
      keys.sort((a, b) => (this.state.seen[a] || 0) - (this.state.seen[b] || 0))
      for (const old of keys.slice(0, keys.length - MAX_SEEN)) delete this.state.seen[old]
    }
  }

  /** 只保留「已生成笔记」的去重键，其余（被误判/临时页面）清掉，给它们重新判定的机会。 */
  pruneSeen() {
    const keep = new Set(this.state.history.map((item) => item.key))
    const before = Object.keys(this.state.seen).length
    const next = {}
    for (const [key, time] of Object.entries(this.state.seen)) {
      if (keep.has(key)) next[key] = time
    }
    this.state.seen = next
    const removed = before - Object.keys(next).length
    if (removed > 0) this.save()
    return removed
  }

  hasSeen(title) {
    const key = normalizeTitle(title)
    return Boolean(key && Object.prototype.hasOwnProperty.call(this.state.seen, key))
  }

  setCurrent(video) {
    this.state.current = video
    this.save()
  }

  addHistory(entry) {
    const key = entry.key || normalizeTitle(entry.title)
    const isNew = !this.state.history.some((item) => item.key === key)
    this.state.history = this.state.history.filter((item) => item.key !== key)
    this.state.history.unshift({ ...entry, key })
    if (this.state.history.length > MAX_HISTORY) this.state.history.length = MAX_HISTORY
    if (isNew) this.state.stats.videos = (this.state.stats.videos || 0) + 1
    this.save()
  }

  /** 把笔记目录里已有的 .docx 并入历史（已存在的不重复添加），返回新增条数。 */
  importNotes(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return 0
    const byKey = new Map(this.state.history.map((item) => [item.key, item]))
    let added = 0
    for (const entry of entries) {
      const key = normalizeTitle(entry.title)
      if (!key || byKey.has(key)) continue
      const record = {
        key,
        title: entry.title,
        subject: entry.subject || '其他',
        docx: entry.docx || '',
        md: entry.md || '',
        engine: 'imported',
        generatedAt: entry.generatedAt || Date.now(),
        overview: '',
        points: [],
        focus: [],
        keywords: [],
        bvid: '',
        imported: true,
      }
      byKey.set(key, record)
      this.state.history.push(record)
      added += 1
    }
    if (added > 0) {
      this.state.history.sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0))
      if (this.state.history.length > MAX_HISTORY) this.state.history.length = MAX_HISTORY
      this.save()
    }
    return added
  }

  findHistory(key) {
    return this.state.history.find((item) => item.key === key) || null
  }

  snapshot() {
    return {
      current: this.state.current,
      observations: this.state.observations,
      history: this.state.history,
      stats: this.state.stats,
    }
  }
}