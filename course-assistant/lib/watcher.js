import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ForegroundReader } from './win.js'
import { classify, cleanTitle, isBrowserProc, looksLikeBrowserTitle } from './classify.js'
import { fetchVideoBundle } from './bili.js'
import { classifyWithLLM, summarize } from './summarize.js'
import { buildDocx, noteToMarkdown } from './docx.js'
import { normalizeTitle } from './store.js'

export function sanitizeName(input, maxLen = 80) {
  let text = String(input == null ? '' : input).trim()
  text = text.replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
  text = text.replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '')
  if (text.length > maxLen) text = text.slice(0, maxLen).trim()
  return text || '未命名'
}

export class Watcher {
  constructor(options) {
    this.config = JSON.parse(JSON.stringify(options.config))
    this.store = options.store
    this.logger = options.logger
    this.onEvent = options.onEvent || (() => {})
    this.reader = new ForegroundReader(options.dataDir)
    this.timer = null
    this.running = false
    this.lastTickAt = 0
    this.nextTickAt = 0
  }

  start() {
    this.stop()
    this.schedule(2000)
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.nextTickAt = 0
  }

  schedule(delay) {
    if (this.timer) clearTimeout(this.timer)
    const wait = Math.max(0, delay)
    this.nextTickAt = Date.now() + wait
    this.timer = setTimeout(async () => {
      await this.tick().catch((error) => this.logger.error('tick: ' + (error.message || error)))
      if (this.config.enabled) this.schedule(this.config.intervalMs)
      else this.nextTickAt = 0
      this.emit('tick', {
        lastTickAt: this.lastTickAt,
        nextTickAt: this.nextTickAt,
        running: Boolean(this.config.enabled),
        busy: this.running,
      })
    }, wait)
  }

  applyConfig(config) {
    const next = JSON.parse(JSON.stringify(config))
    const intervalChanged = next.intervalMs !== this.config.intervalMs
    const enabledChanged = next.enabled !== this.config.enabled
    this.config = next
    if (config.enabled && (intervalChanged || enabledChanged)) this.schedule(0)
    if (!config.enabled) this.stop()
  }

  emit(type, payload) {
    this.onEvent(type, payload)
  }

  observe(observation) {
    this.store.addObservation(observation)
    this.emit('observation', observation)
  }

  async tick(overrideTitle, options = {}) {
    const force = options.force === true
    if (this.running) return { ok: false, error: '上一次检测还未结束' }
    if (!this.config.enabled && !overrideTitle) return { ok: false, error: '应用已暂停' }
    this.running = true
    this.lastTickAt = Date.now()
    try {
      let foreground = null
      if (overrideTitle && String(overrideTitle).trim()) {
        foreground = { title: String(overrideTitle).trim(), proc: 'manual' }
      } else {
        foreground = this.reader.read()
      }
      if (!foreground) {
        const reason = this.reader.lastError || '无法读取前台窗口'
        this.observe({ time: Date.now(), proc: '', title: '', verdict: 'error', detail: reason })
        return { ok: false, error: reason }
      }
      const rawTitle = String(foreground.title || '')
      const isVideoPage = Boolean(overrideTitle) || /_哔哩哔哩_bilibili|_哔哩哔哩$/i.test(rawTitle)
      const cleaned = cleanTitle(rawTitle)
      const titleLooksBrowser = looksLikeBrowserTitle(rawTitle) || isVideoPage
      if (!overrideTitle && !isBrowserProc(foreground.proc) && !titleLooksBrowser) {
        this.observe({ time: Date.now(), proc: foreground.proc, title: cleaned || foreground.title, verdict: 'not-browser', detail: '前台不是浏览器/视频客户端' })
        return { ok: true, verdict: 'not-browser' }
      }
      if (cleaned.length < 4) {
        this.observe({ time: Date.now(), proc: foreground.proc, title: cleaned || foreground.title, verdict: 'too-short', detail: '标题过短' })
        return { ok: true, verdict: 'too-short' }
      }
      if (!force && this.store.hasSeen(cleaned)) {
        this.observe({ time: Date.now(), proc: foreground.proc, title: cleaned, verdict: 'duplicate', detail: '已处理过，静默' })
        return { ok: true, verdict: 'duplicate' }
      }
      const result = await this.processTitle(cleaned, foreground.proc, force, isVideoPage)
      return { ok: true, verdict: result.verdict, title: cleaned }
    } catch (error) {
      this.logger.error('tick failed: ' + (error.stack || error))
      this.emit('error', { message: '检测失败：' + (error.message || error) })
      return { ok: false, error: String(error.message || error) }
    } finally {
      this.running = false
    }
  }

  async processTitle(cleaned, proc, force = false, isVideoPage = false) {
    const knownSubjects = [...new Set(this.store.state.history.map((item) => item.subject).filter(Boolean))]
    let verdict = classify(cleaned, { knownSubjects, isVideoPage })
    if (this.config.llm.enabled && this.config.llm.apiKey) {
      try {
        const llmResult = await classifyWithLLM(this.config.llm, cleaned, knownSubjects)
        if (llmResult) verdict = { ...verdict, ...llmResult }
      } catch (error) {
        this.logger.info('LLM 分类失败，使用本地规则：' + (error.message || error))
      }
    }
    if (!verdict.isCourse) {
      // 不写 seen：被判「非课程」的标题要保留重新判定的机会（比如标题还没加载完整）
      this.observe({ time: Date.now(), proc, title: cleaned, verdict: 'not-course', detail: verdict.reason || '不像课程' })
      return { verdict: 'not-course' }
    }

    this.emit('summary-start', { title: cleaned, subject: verdict.subject })
    let bundle = null
    try {
      bundle = await fetchVideoBundle(cleaned)
    } catch (error) {
      this.logger.info('B站抓取失败：' + (error.message || error))
    }

    const generatedAt = Date.now()
    const summary = await summarize(this.config.llm, {
      title: (bundle && bundle.title) || cleaned,
      desc: (bundle && bundle.desc) || '',
      tags: (bundle && bundle.tags) || verdict.keywords || [],
      transcript: (bundle && bundle.transcript) || '',
      chapters: (bundle && bundle.chapters) || [],
      danmaku: (bundle && bundle.danmaku) || [],
      comments: (bundle && bundle.comments) || [],
    })

    const subject = sanitizeName(verdict.subject || '其他', 30)
    const fileBase = sanitizeName(cleaned)
    const dir = join(this.config.notesDir, subject)
    mkdirSync(dir, { recursive: true })
    const docxPath = join(dir, fileBase + '.docx')
    const mdPath = join(dir, fileBase + '.md')
    const key = normalizeTitle(cleaned)

    if (force || !existsSync(docxPath)) {
      try {
        const buffer = buildDocx({
          title: (bundle && bundle.title) || cleaned,
          subject,
          engine: summary.source,
          generatedAt,
          bvid: (bundle && bundle.bvid) || '',
          owner: (bundle && bundle.owner) || '',
          stat: (bundle && bundle.stat) || null,
          keywords: summary.keywords,
          overview: summary.overview,
          points: summary.points,
          focus: summary.focus,
        })
        writeFileSync(docxPath, buffer)
      } catch (error) {
        this.logger.error('生成 Word 失败：' + (error.stack || error))
      }
      try {
        writeFileSync(mdPath, noteToMarkdown({
          title: (bundle && bundle.title) || cleaned,
          subject,
          engine: summary.source,
          generatedAt,
          bvid: (bundle && bundle.bvid) || '',
          owner: (bundle && bundle.owner) || '',
          stat: (bundle && bundle.stat) || null,
          keywords: summary.keywords,
          overview: summary.overview,
          points: summary.points,
          focus: summary.focus,
        }), 'utf8')
      } catch {
        /* Markdown 失败不影响主流程 */
      }
    }

    const video = {
      key,
      title: (bundle && bundle.title) || cleaned,
      subject,
      bvid: (bundle && bundle.bvid) || '',
      owner: (bundle && bundle.owner) || '',
      stat: (bundle && bundle.stat) || null,
      docx: existsSync(docxPath) ? docxPath : '',
      md: existsSync(mdPath) ? mdPath : '',
      engine: summary.source,
      warning: summary.warning || '',
      keywords: summary.keywords,
      overview: summary.overview,
      points: summary.points,
      focus: summary.focus,
      generatedAt,
      danmakuCount: (bundle && bundle.danmaku ? bundle.danmaku.length : 0),
      commentCount: (bundle && bundle.comments ? bundle.comments.length : 0),
    }

    this.store.markSeen(cleaned)
    this.store.setCurrent(video)
    this.store.addHistory({
      key,
      title: video.title,
      subject,
      docx: video.docx,
      engine: summary.source,
      generatedAt,
      overview: summary.overview,
      points: summary.points,
      focus: summary.focus,
      keywords: summary.keywords,
      bvid: video.bvid,
    })
    this.observe({ time: Date.now(), proc, title: cleaned, verdict: 'new', detail: '已生成「' + subject + '」笔记' })
    this.emit('summary', video)
    this.logger.info('新视频：' + cleaned + ' → ' + subject + ' / ' + (video.docx || '(未生成 Word)'))
    return { verdict: 'new', video }
  }

  async reprocess(key) {
    const entry = this.store.findHistory(key)
    if (!entry) return { ok: false, error: '历史里没有这条笔记' }
    const result = await this.tick(entry.title, { force: true })
    return result
  }
}