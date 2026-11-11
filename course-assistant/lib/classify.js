/**
 * 课程判定 + 学科归类（纯规则，无 LLM 也能用）。
 */

export const BROWSER_PROCESSES = new Set([
  'chrome', 'msedge', 'edge', 'firefox', 'iexplore', 'opera', 'brave', 'chromium',
  'vivaldi', 'yandex', 'librewolf', 'waterfox',
  '360chrome', '360se', '360browser', 'qqbrowser', 'sogouexplorer', 'maxthon', 'ucbrowser', 'quark', '夸克',
  'bilibili', '哔哩哔哩',
  'douyin', '抖音', 'aweme',
  'kuaishou', '快手',
  'xigua', '西瓜视频',
  'youku', '优酷', 'iqiyi', '爱奇艺', 'pps',
  'qqlive', 'tencentvideo', '腾讯视频',
  'mgtv', '芒果tv', '芒果TV',
  'migu', '咪咕视频',
  'weishi', '微视',
  'sohuvideo', '搜狐视频', 'letv', '乐视',
  'potplayer', 'vlc', 'mpv', 'kmplayer', 'mpc-hc', 'mpc-be',
])

const TITLE_SUFFIXES = [
  ' - Google Chrome', ' - Microsoft Edge', ' - Mozilla Firefox',
  ' - Chromium', ' - Opera', ' - Brave', ' - Internet Explorer',
  ' - 谷歌浏览器', ' - 微软 Edge', ' - 火狐浏览器', ' - 360极速浏览器',
  '_哔哩哔哩_bilibili', '_哔哩哔哩', ' - 哔哩哔哩', ' - bilibili', '-bilibili', ' - Bilibili',
  ' - YouTube', ' - 优酷', ' - 爱奇艺', ' - 腾讯视频', ' - 芒果TV', ' - 抖音', ' - 快手', ' - 夸克', ' - Quark',
]

/** 零宽字符：Edge 的多标签标题里混着 U+200B，会让 endsWith 匹配全部失效。 */
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g

/** 浏览器窗口标题尾部：" - Microsoft Edge"（允许零宽字符与多余空格）。 */
const BROWSER_TAIL = /\s*[-–—]\s*(google\s*chrome|microsoft\s*edge|mozilla\s*firefox|firefox|chromium|opera|brave|internet explorer|微软\s*edge|谷歌浏览器|火狐浏览器|360极速浏览器)\s*$/i

/** Edge 多标签窗口："… 和另外 4 个页面 - 个人"。 */
const EDGE_TABS = /\s*和另外\s*\d+\s*个页面(\s*[-–—]\s*(个人|工作|其他|学校|家庭))?\s*$/i

/** Edge 账户名尾缀：" - 个人"。 */
const PROFILE_TAIL = /\s*[-–—]\s*(个人|工作|其他|学校|家庭)\s*$/i

/** 站点首页标题（整串匹配才判定，避免误伤真实视频标题）。 */
const HOME_PATTERNS = [
  /^哔哩哔哩[\s\S]{0,30}bilibili$/i,
  /^哔哩哔哩\s*\(゜-゜\)/,
  /^bilibili[\s\S]{0,30}哔哩哔哩$/i,
]

/** 纯功能页（整串或首段等于这些名字才算）。 */
const SECTION_NAMES = new Set([
  '搜索', '热搜', '首页', '发现', '动态', '消息', '个人中心', '创作中心',
  '稍后再看', '历史记录', '我的', '账号', '设置', '推荐', '排行榜', '番剧', '直播',
  '课程助手',
])

const COURSE_HINTS = [
  '教程', '课程', '入门', '精通', '零基础', '从零', '全套', '全集', '完整版', '系统', '精讲', '详解',
  '讲解', '教学', '课堂', '第\d+[讲章节集课]', '实战', '进阶', '基础', '速成', '训练营', '公开课',
  '考研', '高考', '期末', '面试', '认证', '真题', '笔记', '原理', '解析', '科普', '纪录片', '测评',
]

const SUBJECT_RULES = [
  { subject: 'Python', words: ['python', 'pandas', 'numpy', 'django', 'flask', '爬虫', 'pygame'] },
  { subject: 'Java', words: ['java', 'spring', 'springboot', 'mybatis', 'jvm', 'maven'] },
  { subject: '前端开发', words: ['前端', 'javascript', 'typescript', 'vue', 'react', 'css', 'html', 'webpack', 'vite', '小程序', 'node.js', 'nodejs'] },
  { subject: '算法与数据结构', words: ['算法', '数据结构', 'leetcode', '刷题', '排序', '动态规划', '二叉树', '图论'] },
  { subject: '数据库', words: ['数据库', 'mysql', 'redis', 'sql', 'mongodb', 'oracle', 'postgresql'] },
  { subject: '计算机网络', words: ['计算机网络', 'tcp', 'http', '网络协议', 'socket', 'dns'] },
  { subject: '操作系统', words: ['操作系统', 'linux', '内核', '进程', '线程', '运维'] },
  { subject: '数学', words: ['数学', '高等数学', '线性代数', '概率论', '微积分', '离散数学', '高数', '数学分析', '考研数学'] },
  { subject: '英语', words: ['英语', '四级', '六级', '雅思', '托福', '语法', '单词', '口语', '考研英语'] },
  { subject: '机器学习', words: ['机器学习', '深度学习', '神经网络', '人工智能', 'ai', 'pytorch', 'tensorflow', '大模型', 'llm', 'transformer'] },
  { subject: '产品与设计', words: ['产品经理', 'ui', 'ux', '交互设计', '平面设计', 'ps教程', 'ppt', 'figma', '原型'] },
  { subject: '摄影与剪辑', words: ['摄影', '剪辑', 'pr教程', 'ae教程', '调色', '运镜', '短视频'] },
  { subject: '职场与考试', words: ['公考', '公务员', '教师资格', '复试', '简历', '面试技巧', '职业规划'] },
  { subject: '物理', words: ['物理', '力学', '电磁学', '量子', '热力学'] },
  { subject: '化学', words: ['化学', '有机化学', '无机化学', '反应机理'] },
]

export function isBrowserProc(proc) {
  const name = String(proc || '').toLowerCase().replace(/\.exe$/i, '').trim()
  return BROWSER_PROCESSES.has(name)
}

export function cleanTitle(raw) {
  let text = String(raw || '').replace(INVISIBLE, '').trim()
  for (let round = 0; round < 8; round += 1) {
    const before = text
    text = text.replace(EDGE_TABS, '').trim()
    text = text.replace(BROWSER_TAIL, '').trim()
    text = text.replace(PROFILE_TAIL, '').trim()
    for (const suffix of TITLE_SUFFIXES) {
      if (text.endsWith(suffix)) {
        text = text.slice(0, -suffix.length).trim()
        break
      }
    }
    text = text.replace(INVISIBLE, '').trim()
    if (text === before) break
  }
  return text
}

/** 标题是否带浏览器/客户端的痕迹（含 Edge 多标签、零宽字符）。 */
export function looksLikeBrowserTitle(title) {
  const text = String(title || '').replace(INVISIBLE, '')
  return BROWSER_TAIL.test(text)
}

/** 明显不是视频页的标题（首页/搜索/列表/本应用自己的页面）。 */
export function isIgnoredPage(title) {
  const text = cleanTitle(String(title || '')).trim()
  if (!text) return true
  if (text.length <= 40 && HOME_PATTERNS.some((re) => re.test(text))) return true
  if (/的个人空间|的个人主页|投稿视频|合集和视频列表|关注的|收藏夹|稍后再看/.test(text)) return true
  if (/^(microsoft\s*edge|google\s*chrome|mozilla\s*firefox|chromium|新标签页|new tab|untitled|无标题)$/i.test(text)) return true
  if (text.length <= 24) {
    const parts = text.split(/\s*[|·•\-–—]\s*/).map((part) => part.trim()).filter(Boolean)
    if (parts.length > 0 && (SECTION_NAMES.has(parts[0]) || SECTION_NAMES.has(parts[parts.length - 1]))) return true
  }
  if (/^(百度|谷歌|必应|知乎|微博|小红书)/.test(text)) return true
  return false
}

function looksLikeCourse(title, tags) {
  const text = (title + ' ' + (tags || []).join(' ')).toLowerCase()
  return COURSE_HINTS.some((hint) => new RegExp(hint, 'i').test(text))
}

/** 依据关键词猜学科；known 为历史里出现过的学科名（优先复用）。 */
export function guessSubject(text, known = []) {
  const haystack = String(text || '').toLowerCase()
  for (const rule of SUBJECT_RULES) {
    if (rule.words.some((word) => haystack.includes(word))) {
      const reused = known.find((name) => name.toLowerCase() === rule.subject.toLowerCase())
      return reused || rule.subject
    }
  }
  return ''
}

export function classify(title, options = {}) {
  const tags = Array.isArray(options.tags) ? options.tags : []
  const known = Array.isArray(options.knownSubjects) ? options.knownSubjects : []
  const cleaned = cleanTitle(title)
  if (cleaned.length < 4) {
    return { isCourse: false, reason: '标题过短', subject: '', keywords: [] }
  }
  if (isIgnoredPage(cleaned)) {
    return { isCourse: false, reason: '不是视频页', subject: '', keywords: [] }
  }
  // 已经在 B 站视频页上（标题带 _哔哩哔哩_bilibili）时不再用关键词卡：用户正在看的视频就该出笔记
  const course = options.isVideoPage === true || looksLikeCourse(cleaned, tags)
  if (!course) {
    return { isCourse: false, reason: '不像课程内容', subject: '', keywords: [] }
  }
  const subject = guessSubject(cleaned + ' ' + tags.join(' '), known) || '其他'
  const keywords = extractKeywords(cleaned)
  return { isCourse: true, reason: '命中课程关键词', subject, keywords }
}

const STOP_WORDS = new Set(['视频', '教程', '课程', '全集', '全套', '完整版', '最新', '最新版', '合集', '讲解', '教学', '入门', '基础', '进阶', '实战', '免费', '高清', '中文', '第', '集', '课', '讲', 'p', '合集'])

export function extractKeywords(title) {
  const text = String(title || '')
  const parts = text.split(/[\s，。！？、;；:：|【】\[\]（）()<>《》"“”'‘’~\-—_+*/\\]+/)
  const out = []
  for (const part of parts) {
    const token = part.trim()
    if (token.length < 2 || token.length > 20) continue
    if (STOP_WORDS.has(token)) continue
    if (out.includes(token)) continue
    out.push(token)
    if (out.length >= 8) break
  }
  return out
}

export function subjectKeywordTable() {
  return SUBJECT_RULES.map((rule) => rule.subject)
}