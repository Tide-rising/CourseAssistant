/**
 * 摘要引擎：本地规则（默认，零依赖）+ 可选 LLM（OpenAI 兼容接口）。
 * 输出结构固定：{ overview, points:[{title, items[]}], focus:[{topic, quotes[]}], keywords[] }
 */

const AD_PATTERNS = [
  /https?:\/\/\S+/g,
  /\S+@\S+\.\S+/g,
  /一键三连|点赞|投币|收藏|转发|关注|订阅|公众号|QQ群|微信群|商务合作|加V|私信|评论区|置顶/,
  /^\(?广告\)?$/,
]

const STOP_CHARS = new Set('的了是我你他她它们这那就都也很还和与及或在有为对把被让给到从以于之其而且但啊哦呀哈嘿嗯诶唉哇啦吧吗呢嘛噢喔'.split(''))
const STOP_TERMS = new Set([
  '这个', '那个', '什么', '怎么', '可以', '就是', '不是', '没有', '我们', '你们', '他们',
  '老师', '同学', '大家', '一下', '一个', '现在', '然后', '因为', '所以', '但是', '如果',
  '真的', '感觉', '已经', '还是', '这样', '那样', '知道', '觉得', '开始', '时候', '视频',
  '弹幕', '前排', '打卡', '来了', '哈哈', '哈哈哈哈哈', '笑死', '牛逼', '厉害', '加油',
  '确实', '意思', '非常', '好好', '喜欢', '好听', '声音', '可爱', '真的', '感觉', '三连', '兔兔',
  '感谢', '谢谢', '支持', '收藏', '关注', '投币', '沙发', '第一', '第二', '小时', '分钟',
  '好听', '好好听', '爱了', '声音', '好听啊', '绝了', '舒服', '棒', '赞', '泪目', '破防', '服了', '卧槽',
])

export function cleanDescription(desc) {
  let text = String(desc || '')
  for (const pattern of AD_PATTERNS) text = text.replace(pattern, ' ')
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function splitSentences(text) {
  return String(text || '')
    .split(/[\n。！？!?；;]+/)
    .map((line) => line.replace(/^[\s\-*•·\d.、)）]+/, '').trim())
    .filter(Boolean)
}

function isUsefulSentence(sentence) {
  if (sentence.length < 8 || sentence.length > 90) return false
  if (AD_PATTERNS.some((pattern) => pattern.test(sentence))) return false
  return true
}

/** 2–4 字 n-gram 词频，挑出高频主题词。 */
export function topTerms(lines, limit = 6) {
  const counts = new Map()
  for (const line of lines) {
    const text = String(line || '').replace(/[\s\p{P}\p{S}\d]+/gu, '')
    if (text.length < 2) continue
    for (let size = 2; size <= 4; size += 1) {
      for (let i = 0; i + size <= text.length; i += 1) {
        const gram = text.slice(i, i + size)
        if (STOP_TERMS.has(gram)) continue
        if (!/^[\u4e00-\u9fa5]{2,4}$/.test(gram)) continue
        let stop = false
        for (const ch of gram) if (STOP_CHARS.has(ch)) { stop = true; break }
        if (stop) continue
        counts.set(gram, (counts.get(gram) || 0) + 1)
      }
    }
  }
  const scored = [...counts.entries()]
    .filter(([term, count]) => count >= 3 && term.length >= 2)
    .map(([term, count]) => ({ term, score: count * Math.min(term.length, 4) }))
    .sort((a, b) => b.score - a.score)
  // 去掉被更长高频词包含的短词
  const chosen = []
  for (const item of scored) {
    if (chosen.some((picked) => picked.term.includes(item.term) || item.term.includes(picked.term))) continue
    chosen.push(item)
    if (chosen.length >= limit) break
  }
  return chosen.map((item) => item.term)
}

function groupPoints(desc) {
  const cleaned = cleanDescription(desc)
  const groups = []
  const lines = cleaned.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  let current = null
  for (const line of lines) {
    const marker = line.match(/^[【\[](.{2,18})[】\]]\s*[:：]?\s*(.*)$/)
    if (marker) {
      current = { title: marker[1].trim(), items: [] }
      groups.push(current)
      if (marker[2] && isUsefulSentence(marker[2])) current.items.push(marker[2].trim())
      continue
    }
    const numbered = line.match(/^(\d{1,2})[.、)）]\s*(.+)$/)
    if (numbered && isUsefulSentence(numbered[2])) {
      if (!current) { current = { title: '课程内容', items: [] }; groups.push(current) }
      current.items.push(numbered[2].trim())
      continue
    }
    if (isUsefulSentence(line)) {
      if (!current || current.items.length >= 8) {
        current = { title: groups.length === 0 ? '课程内容' : '延伸内容', items: [] }
        groups.push(current)
      }
      current.items.push(line)
    }
  }
  return groups.filter((group) => group.items.length > 0).slice(0, 6)
}

export function summarizeLocal(input) {
  const title = String(input.title || '').trim()
  const chapters = Array.isArray(input.chapters) ? input.chapters.filter(Boolean) : []
  const tags = Array.isArray(input.tags) ? input.tags.filter(Boolean) : []
  const desc = cleanDescription(input.desc || '')
  const danmaku = Array.isArray(input.danmaku) ? input.danmaku : []
  const comments = Array.isArray(input.comments) ? input.comments : []

  let overview = ''
  const sentences = splitSentences(desc).filter(isUsefulSentence)
  if (sentences.length > 0) overview = sentences.slice(0, 2).join('。').slice(0, 160) + '。'
  else overview = title + (tags.length ? '（' + tags.slice(0, 4).join('、') + '）' : '')

  let points = groupPoints(desc)
  if (chapters.length > 1) {
    points = points.concat([{ title: '课程目录（共 ' + chapters.length + ' 节）', items: chapters.slice(0, 10) }])
  }
  if (points.length === 0) {
    points = [{ title: '课程主题', items: [title + (tags.length ? '：' + tags.slice(0, 5).join('、') : '')] }]
  }

  const terms = topTerms(danmaku.concat(comments), 6)
  const focus = []
  for (const term of terms.slice(0, 3)) {
    const quotes = danmaku.filter((line) => line.includes(term) && line.length >= 6).slice(0, 2)
    const commentQuotes = comments.filter((line) => line.includes(term)).slice(0, 1)
    const merged = quotes.concat(commentQuotes)
    if (merged.length > 0) focus.push({ topic: term, quotes: merged })
  }
  if (focus.length === 0 && comments.length > 0) {
    focus.push({ topic: '评论区声音', quotes: comments.slice(0, 3) })
  }

  const keywords = []
  for (const tag of tags.slice(0, 8)) if (!keywords.includes(tag)) keywords.push(tag)
  // 标签足够时只用标签（B 站标签比 n-gram 更准），不足才用弹幕主题补
  if (keywords.length < 4) {
    for (const term of terms) if (!keywords.includes(term)) keywords.push(term)
  }
  if (keywords.length === 0) keywords.push(...String(title).split(/[\s，。！？、|【】\[\]]+/).filter((x) => x.length >= 2).slice(0, 6))

  return {
    overview,
    points,
    focus,
    keywords: keywords.slice(0, 10),
    source: sentences.length > 0 ? 'local' : 'offline',
  }
}

function buildContentBlock(input) {
  const parts = []
  if (input.desc) parts.push('【视频简介】\n' + String(input.desc).slice(0, 900))
  if (input.tags && input.tags.length) parts.push('【视频标签】\n' + input.tags.join('、'))
  if (input.transcript) parts.push('【字幕节选】\n' + String(input.transcript).slice(0, 1500))
  if (input.danmaku && input.danmaku.length) parts.push('【弹幕节选 ' + input.danmaku.length + ' 条】\n' + input.danmaku.slice(0, 100).join('\n'))
  if (input.comments && input.comments.length) parts.push('【热评节选】\n' + input.comments.slice(0, 15).join('\n'))
  return parts.join('\n\n')
}

async function callChat(llm, messages, maxTokens = 2000, timeoutMs = 60000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('LLM 超时')), timeoutMs)
  let baseURL = String(llm.baseURL || '').trim().replace(/\/+$/, '')
  try {
    const parsed = new URL(baseURL)
    if (parsed.hostname === 'platform.deepseek.com') baseURL = 'https://api.deepseek.com'
    else if (/\/api_keys\b/i.test(parsed.pathname)) baseURL = parsed.origin
  } catch { /* 交给 fetch 报错 */ }
  const apiKey = String(llm.apiKey || '').trim()
  const model = String(llm.model || '').trim()
    .replace(/^DeepSeek[- ]?V4\.1[- ]?Flash$/i, 'deepseek-flash')
    .replace(/^DeepSeek[- ]?V4[- ]?Pro$/i, 'deepseek-v4-pro')
  try {
    const res = await fetch(baseURL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: maxTokens }),
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      let detail = text.slice(0, 200)
      try {
        const parsed = JSON.parse(text)
        detail = (parsed && parsed.error && parsed.error.message) || detail
      } catch { /* 保留原文 */ }
      if (res.status === 401 || res.status === 403) {
        throw new Error('API Key 被拒绝（HTTP ' + res.status + '）：' + detail + '。请确认 Key 来自该 Base URL 对应的服务商，且没有过期/被删。')
      }
      if (res.status === 405) {
        throw new Error('接口路径不对（HTTP 405）：Base URL 应填 API 根地址，例如 https://api.deepseek.com，不要填控制台网页地址。')
      }
      if (res.status === 404) {
        throw new Error('接口或模型不存在（HTTP 404）：' + detail + '。请检查 Base URL（DeepSeek 官方为 https://api.deepseek.com）与模型名。')
      }
      throw new Error('LLM 请求失败（HTTP ' + res.status + '）：' + detail)
    }
    const data = JSON.parse(text)
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    if (!content) throw new Error('LLM 返回为空')
    return String(content)
  } finally {
    clearTimeout(timer)
  }
}

export function parseJsonLoose(text) {
  if (!text) return null
  const raw = String(text).trim()
  try { return JSON.parse(raw) } catch { /* 继续 */ }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) { try { return JSON.parse(fence[1].trim()) } catch { /* 继续 */ } }
  const brace = raw.match(/\{[\s\S]*\}/)
  if (brace) { try { return JSON.parse(brace[0]) } catch { /* 继续 */ } }
  return null
}

export async function classifyWithLLM(llm, title, knownSubjects) {
  const content = await callChat(llm, [
    { role: 'system', content: '你是课程分类助手，只输出 JSON。' },
    {
      role: 'user',
      content: '浏览器当前标题：' + JSON.stringify(title) + '\n已有学科：' + JSON.stringify(knownSubjects) +
        '\n判断是否值得整理成课程笔记，并给出学科名（中文，≤8 字）。' +
        '只返回：{"isCourse":true,"subject":"学科","keywords":["关键词1","关键词2","关键词3"]}',
    },
  ], 400)
  const parsed = parseJsonLoose(content)
  if (!parsed || typeof parsed.isCourse !== 'boolean') return null
  return {
    isCourse: parsed.isCourse,
    subject: String(parsed.subject || '').trim().slice(0, 12) || '其他',
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 8) : [],
  }
}

export async function summarizeWithLLM(llm, input) {
  const content = buildContentBlock(input)
  const prompt = '视频标题：' + input.title + '\n' +
    (content ? '已抓取到以下真实内容，请基于它们总结，不要编造：\n\n' + content + '\n\n' : '') +
    '请输出 JSON（不要 markdown 代码块、不要解释）：\n' +
    '{"overview":"一句话简介","points":[{"title":"主题","items":["要点1","要点2"]}],"focus":[{"topic":"弹幕/评论焦点","quotes":["原话1","原话2"]}]}\n' +
    '要求：中文；points 4~6 组、每组 2~4 条；focus 2~3 组；overview ≤100 字。'
  const raw = await callChat(llm, [
    { role: 'system', content: '你是学习笔记整理专家，只输出合法 JSON。' },
    { role: 'user', content: prompt },
  ], 2500)
  const parsed = parseJsonLoose(raw)
  if (!parsed) throw new Error('LLM 输出无法解析为 JSON')
  const points = Array.isArray(parsed.points)
    ? parsed.points.map((group) => ({
      title: String(group && group.title || '要点').slice(0, 30),
      items: Array.isArray(group && group.items) ? group.items.map(String).filter(Boolean).slice(0, 5) : [],
    })).filter((group) => group.items.length > 0).slice(0, 6)
    : []
  const focus = Array.isArray(parsed.focus)
    ? parsed.focus.map((group) => ({
      topic: String(group && group.topic || '讨论焦点').slice(0, 30),
      quotes: Array.isArray(group && group.quotes) ? group.quotes.map(String).filter(Boolean).slice(0, 3) : [],
    })).filter((group) => group.quotes.length > 0).slice(0, 4)
    : []
  if (points.length === 0) throw new Error('LLM 未返回知识点')
  const keywords = Array.isArray(input.tags) ? input.tags.slice(0, 8) : []
  return {
    overview: String(parsed.overview || '').slice(0, 200) || input.title,
    points,
    focus,
    keywords,
    source: 'llm',
  }
}

/** 设置页“测试连接”：发一个极短请求验证 Key/Base URL/模型。 */
export async function testLLM(llm) {
  if (!llm || !llm.apiKey) return { ok: false, message: '还没有填写 API Key' }
  const started = Date.now()
  const reply = await callChat(llm, [
    { role: 'system', content: '你是连接测试助手。' },
    { role: 'user', content: '只回复两个字：可用' },
  ], 16, 20000)
  return { ok: true, message: '连接成功（' + (Date.now() - started) + 'ms）：' + String(reply).trim().slice(0, 40) }
}

export async function summarize(llm, input) {
  if (llm && llm.enabled && llm.apiKey) {
    try {
      return await summarizeWithLLM(llm, input)
    } catch (error) {
      const local = summarizeLocal(input)
      return { ...local, source: 'local', warning: 'LLM 失败，已降级：' + (error.message || error) }
    }
  }
  return summarizeLocal(input)
}