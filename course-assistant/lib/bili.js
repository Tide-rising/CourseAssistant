/**
 * B 站内容抓取：搜索 → 详情 → 字幕/弹幕/热评。
 * 任何一步失败都尽量降级，最终返回可用的部分。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let cachedBuvid3 = null

async function getBuvid3() {
  if (cachedBuvid3 !== null) return cachedBuvid3
  try {
    const res = await fetchTimeout('https://api.bilibili.com/x/frontend/finger/spi', { headers: { 'User-Agent': UA } }, 8000)
    const json = await res.json()
    cachedBuvid3 = (json && json.data && json.data.b_3) || ''
  } catch {
    cachedBuvid3 = ''
  }
  return cachedBuvid3
}

async function fetchTimeout(url, options, timeoutMs = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function getJson(url, timeoutMs = 10000) {
  const buvid3 = await getBuvid3()
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetchTimeout(url, {
        headers: {
          'User-Agent': UA,
          Referer: 'https://www.bilibili.com/',
          Accept: 'application/json, text/plain, */*',
          ...(buvid3 ? { Cookie: 'buvid3=' + buvid3 } : {}),
        },
      }, timeoutMs)
      if (res.status === 412) throw new Error('HTTP 412')
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    } catch (error) {
      lastError = error
      if (attempt < 2) await sleep(1200 * (attempt + 1))
    }
  }
  throw lastError
}

function stripHtml(text) {
  return String(text || '').replace(/<[^>]+>/g, '').trim()
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function titleSimilar(a, b) {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return 0
  if (na.includes(nb) || nb.includes(na)) return 1
  const grams = (s) => {
    const set = new Set()
    for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2))
    return set
  }
  const A = grams(na)
  const B = grams(nb)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const gram of A) if (B.has(gram)) inter += 1
  return (2 * inter) / (A.size + B.size)
}

export async function searchVideo(title) {
  const url = 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=' + encodeURIComponent(title)
  const data = await getJson(url)
  if (!data || data.code !== 0) return null
  const results = (data.data && data.data.result ? data.data.result : []).filter((item) => item && item.bvid)
  if (results.length === 0) return null
  let best = null
  let bestScore = 0
  for (const item of results.slice(0, 10)) {
    const clean = stripHtml(item.title)
    const score = titleSimilar(title, clean)
    if (score > bestScore) {
      bestScore = score
      best = { ...item, cleanTitle: clean }
    }
  }
  if (!best || bestScore < 0.5) return null
  return {
    bvid: best.bvid,
    aid: best.aid,
    title: best.cleanTitle,
    desc: stripHtml(best.description || ''),
    tags: String(best.tag || '').split(',').map((s) => s.trim()).filter(Boolean),
    author: best.author || '',
    play: Number(best.play) || 0,
  }
}

export async function viewVideo(bvid) {
  const data = await getJson('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(bvid))
  if (!data || data.code !== 0) return null
  const d = data.data || {}
  return {
    aid: d.aid,
    cid: d.cid || (d.pages && d.pages[0] && d.pages[0].cid),
    desc: d.desc || '',
    owner: (d.owner && d.owner.name) || '',
    stat: d.stat || {},
    subtitle: (d.subtitle && d.subtitle.list) || [],
    chapters: Array.isArray(d.pages) ? d.pages.map((page) => String(page && page.part || '').trim()).filter(Boolean).slice(0, 20) : [],
  }
}

export async function fetchDanmaku(cid, limit = 150) {
  if (!cid) return []
  const res = await fetchTimeout('https://comment.bilibili.com/' + cid + '.xml', {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' },
  }, 12000)
  const xml = await res.text()
  const items = []
  const re = /<d[^>]*>([\s\S]*?)<\/d>/g
  let match
  while ((match = re.exec(xml)) !== null) {
    const text = decodeXml(match[1]).trim()
    if (!text) continue
    if (text.startsWith('[') && text.endsWith(']')) continue
    items.push(text)
  }
  const seen = new Set()
  return items.filter((text) => {
    if (seen.has(text)) return false
    seen.add(text)
    return true
  }).slice(0, limit)
}

export async function fetchComments(aid, limit = 20) {
  if (!aid) return []
  const data = await getJson('https://api.bilibili.com/x/v2/reply?type=1&oid=' + aid + '&sort=2&ps=20&pn=1')
  if (!data || data.code !== 0) return []
  const replies = (data.data && data.data.replies) || []
  return replies.map((item) => String(item && item.content ? item.content.message : '').trim()).filter(Boolean).slice(0, limit)
}

async function fetchSubtitle(view) {
  const list = (view && view.subtitle) || []
  if (list.length === 0) return ''
  let url = list[0].subtitle_url || ''
  if (!url) return ''
  if (url.startsWith('//')) url = 'https:' + url
  const data = await getJson(url)
  const body = (data && data.body) || []
  return body.map((item) => String(item && item.content ? item.content : '').trim()).filter(Boolean).join(' ').slice(0, 2000)
}

function decodeXml(text) {
  return String(text || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
}

/** 综合抓取；返回 null 表示没搜到（调用方降级为标题摘要）。 */
export async function fetchVideoBundle(title) {
  const found = await searchVideo(title)
  if (!found) return null
  const view = await viewVideo(found.bvid).catch(() => null)
  const cid = view && view.cid
  const aid = (view && view.aid) || found.aid
  const [danmaku, comments] = await Promise.allSettled([
    fetchDanmaku(cid),
    fetchComments(aid),
  ])
  let transcript = ''
  try {
    transcript = await fetchSubtitle(view)
  } catch {
    transcript = ''
  }
  return {
    bvid: found.bvid,
    aid,
    cid,
    title: found.title,
    desc: String((view && view.desc) || found.desc || '').trim(),
    tags: found.tags || [],
    owner: (view && view.owner) || found.author || '',
    stat: (view && view.stat) || { view: found.play },
    transcript,
    chapters: (view && view.chapters) || [],
    danmaku: danmaku.status === 'fulfilled' ? danmaku.value : [],
    comments: comments.status === 'fulfilled' ? comments.value : [],
  }
}