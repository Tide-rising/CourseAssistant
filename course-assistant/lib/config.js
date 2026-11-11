import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 默认输出目录跟着用户走，不写死某一台机器的路径。 */
export const DEFAULT_NOTES_DIR = join(homedir(), 'Documents', '课程笔记')

export const DEFAULTS = {
  enabled: true,
  intervalMs: 15000,
  notesDir: DEFAULT_NOTES_DIR,
  autoOpenBrowser: true,
  llm: { enabled: false, baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '' },
}

export const INTERVAL_MIN = 3000
export const INTERVAL_MAX = 300000

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 校验 LLM 配置，返回错误文案（空串=通过）。
 * 重点拦截两类常见误填：把控制台网页当 Base URL、把产品名当模型名。
 */
// DSH 界面显示的是模型「名称」，API 需要模型「id」。这里做一层别名映射。
const MODEL_ALIASES = {
  'deepseek-v4.1-flash': 'deepseek-flash',
  'deepseek v4.1 flash': 'deepseek-flash',
  'deepseek-v4-1-flash': 'deepseek-flash',
  'deepseek-flash': 'deepseek-flash',
  'deepseek-v4-pro': 'deepseek-v4-pro',
  'deepseek v4 pro': 'deepseek-v4-pro',
  'deepseek-chat': 'deepseek-chat',
  'deepseek-reasoner': 'deepseek-reasoner',
}

export function normalizeModel(model) {
  const raw = String(model || '').trim()
  const key = raw.toLowerCase().replace(/[._]/g, '-').replace(/\s+/g, ' ')
  return MODEL_ALIASES[key] || raw
}

export function validateLlm(llm) {
  if (!llm) return ''
  const baseURL = String(llm.baseURL || '').trim()
  const model = normalizeModel(llm.model)
  let parsed = null
  try { parsed = new URL(baseURL) } catch { return 'Base URL 不是合法网址' }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Base URL 必须是 http(s) 地址'
  if (parsed.hostname === 'platform.deepseek.com' || /\/api_keys\b/i.test(parsed.pathname)) {
    return 'Base URL 要填 API 根地址（DeepSeek 官方：https://api.deepseek.com），不是控制台网页地址'
  }
  if (parsed.search || parsed.hash) return 'Base URL 不能带查询参数或锚点'
  if (/\/chat\/completions$/i.test(parsed.pathname)) {
    return 'Base URL 填到根地址即可（不要带 /chat/completions）'
  }
  if (model === '') return '请填写模型名'
  if (/\s/.test(model)) return '模型名不能包含空格，请填服务商文档里的模型 id（DeepSeek 官方为 deepseek-chat）'
  if (model.length > 80) return '模型名过长'
  return ''
}

export function maskKey(key) {
  const text = String(key || '')
  if (!text) return ''
  if (text.length <= 8) return '****'
  return text.slice(0, 3) + '****' + text.slice(-4)
}

/** 读取配置；文件缺失或损坏时回退默认值。 */
export function loadConfig(file) {
  try {
    // 记事本另存可能带 BOM，JSON.parse 会直接失败，这里先剥掉
    const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    const raw = JSON.parse(text)
    const normalized = updateConfig(clone(DEFAULTS), raw)
    return normalized.config
  } catch {
    return clone(DEFAULTS)
  }
}

export function saveConfig(file, config) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp.' + process.pid
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

/**
 * 用补丁更新配置并校验；apiKey 传空串表示保持原值，传 null 表示清空。
 * @returns {{config: object, errors: string[]}}
 */
export function updateConfig(previous, patch) {
  const config = clone(previous)
  const errors = []
  if (!patch || typeof patch !== 'object') return { config, errors: ['配置必须是对象'] }

  if (patch.enabled !== undefined) {
    if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled
    else errors.push('enabled 必须是布尔值')
  }
  if (patch.intervalMs !== undefined) {
    const value = Number(patch.intervalMs)
    if (!Number.isFinite(value)) errors.push('轮询间隔必须是数字')
    else config.intervalMs = Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, Math.round(value)))
  }
  if (patch.notesDir !== undefined) {
    const value = String(patch.notesDir || '').trim()
    if (!value) errors.push('输出目录不能为空')
    else {
      try {
        mkdirSync(value, { recursive: true })
        config.notesDir = value
      } catch (error) {
        errors.push('输出目录不可写：' + (error && error.message ? error.message : error))
      }
    }
  }
  if (patch.autoOpenBrowser !== undefined) {
    if (typeof patch.autoOpenBrowser === 'boolean') config.autoOpenBrowser = patch.autoOpenBrowser
    else errors.push('autoOpenBrowser 必须是布尔值')
  }
  if (patch.llm !== undefined && patch.llm !== null) {
    const next = { ...config.llm }
    const input = patch.llm
    if (input.enabled !== undefined) {
      if (typeof input.enabled === 'boolean') next.enabled = input.enabled
      else errors.push('llm.enabled 必须是布尔值')
    }
    if (input.baseURL !== undefined) {
      const value = String(input.baseURL || '').trim().replace(/\/+$/, '')
      if (!value) next.baseURL = DEFAULTS.llm.baseURL
      else if (!isHttpUrl(value)) errors.push('llm.baseURL 必须是 http(s) 地址')
      else next.baseURL = value
    }
    if (input.model !== undefined) {
      const value = String(input.model || '').trim()
      if (!value) errors.push('llm.model 不能为空')
      else next.model = normalizeModel(value)
    }
    if (input.apiKey !== undefined) {
      if (input.apiKey === null) next.apiKey = ''
      else if (typeof input.apiKey === 'string' && input.apiKey.trim() !== '') next.apiKey = input.apiKey.trim()
    }
    const llmError = validateLlm(next)
    if (llmError) errors.push(llmError)
    if (next.enabled && (!next.baseURL || !next.model || !next.apiKey)) {
      errors.push('启用 LLM 前请填写 Base URL、模型和 API Key')
    }
    config.llm = next
  }
  return { config, errors }
}

/** 返回给前端的配置（API Key 脱敏）。 */
export function publicConfig(config) {
  return {
    enabled: config.enabled,
    intervalMs: config.intervalMs,
    notesDir: config.notesDir,
    autoOpenBrowser: config.autoOpenBrowser,
    llm: {
      enabled: config.llm.enabled,
      baseURL: config.llm.baseURL,
      model: config.llm.model,
      apiKey: maskKey(config.llm.apiKey),
      hasKey: Boolean(config.llm.apiKey),
    },
  }
}

export function ensureNotesDir(config) {
  if (!existsSync(config.notesDir)) mkdirSync(config.notesDir, { recursive: true })
  return config.notesDir
}