/**
 * 纯 JS 生成 .docx（ZIP + OOXML），不依赖 python / office 库。
 * 支持：标题、正文、加粗、项目符号（1~3 级）、引用、代码块。
 */
import { deflateRawSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function dosTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff
  return { time, date: day }
}

/** 最小 ZIP 打包器（deflate 压缩，失败回退 store）。 */
export function zip(files) {
  const now = new Date()
  const stamp = dosTime(now)
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8')
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8')
    const crc = crc32(data)
    let compressed = data
    let method = 0
    try {
      const deflated = deflateRawSync(data, { level: 9 })
      if (deflated.length < data.length) {
        compressed = deflated
        method = 8
      }
    } catch {
      method = 0
    }

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuf, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(stamp.time, 12)
    central.writeUInt16LE(stamp.date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuf)

    offset += local.length + nameBuf.length + compressed.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, ...centralParts, end])
}

function escapeXml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function runs(text, extra = '') {
  const parts = String(text == null ? '' : text).split(/(\*\*[^*]+\*\*)/)
  return parts.filter(Boolean).map((part) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return '<w:r><w:rPr>' + extra + '<w:b/></w:rPr><w:t xml:space="preserve">' + escapeXml(part.slice(2, -2)) + '</w:t></w:r>'
    }
    return '<w:r><w:rPr>' + extra + '</w:rPr><w:t xml:space="preserve">' + escapeXml(part) + '</w:t></w:r>'
  }).join('')
}

function paragraph(text, options = {}) {
  const pPr = []
  if (options.style) pPr.push('<w:pStyle w:val="' + options.style + '"/>')
  if (options.num) pPr.push('<w:numPr><w:ilvl w:val="' + (options.level || 0) + '"/><w:numId w:val="1"/></w:numPr>')
  if (options.spaceAfter !== undefined) pPr.push('<w:spacing w:after="' + options.spaceAfter + '"/>')
  const runPr = []
  if (options.bold) runPr.push('<w:b/>')
  if (options.italic) runPr.push('<w:i/>')
  if (options.color) runPr.push('<w:color w:val="' + options.color + '"/>')
  if (options.size) runPr.push('<w:sz w:val="' + options.size + '"/>')
  return '<w:p>' + (pPr.length ? '<w:pPr>' + pPr.join('') + '</w:pPr>' : '') + runs(text, runPr.join('')) + '</w:p>'
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
  '</Types>'

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>'

const DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
  '</Relationships>'

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults>' +
  '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
  '</w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="1F2937"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="2563EB"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/><w:color w:val="4B5563"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr></w:style>' +
  '</w:styles>'

const NUMBERING = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:abstractNum w:abstractNumId="0">' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
  '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="◦"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>' +
  '<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="▪"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>' +
  '</w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '</w:numbering>'

function bodyXml(note) {
  const blocks = []
  blocks.push(paragraph(note.title, { style: 'Heading1' }))
  const metaBits = [note.subject || '未分类']
  if (note.engine) metaBits.push(note.engine === 'llm' ? 'AI 总结' : '本地总结')
  if (note.generatedAt) metaBits.push(new Date(note.generatedAt).toLocaleString('zh-CN', { hour12: false }))
  blocks.push(paragraph(metaBits.join(' · '), { color: '6B7280', size: 18, spaceAfter: 160 }))

  const info = []
  if (note.bvid) info.push('视频链接：https://www.bilibili.com/video/' + note.bvid)
  if (note.owner) info.push('UP 主：' + note.owner)
  if (note.stat) {
    const bits = []
    if (typeof note.stat.view === 'number') bits.push('播放 ' + note.stat.view.toLocaleString('zh-CN'))
    if (typeof note.stat.danmaku === 'number') bits.push('弹幕 ' + note.stat.danmaku.toLocaleString('zh-CN'))
    if (typeof note.stat.reply === 'number') bits.push('评论 ' + note.stat.reply.toLocaleString('zh-CN'))
    if (bits.length) info.push('视频数据：' + bits.join(' · '))
  }
  if (note.keywords && note.keywords.length) info.push('关键词：' + note.keywords.join('、'))
  for (const line of info) blocks.push(paragraph(line, { num: true, level: 0 }))

  if (note.overview) {
    blocks.push(paragraph('课程概览', { style: 'Heading2' }))
    blocks.push(paragraph(note.overview, { style: 'Quote' }))
  }

  if (note.points && note.points.length) {
    blocks.push(paragraph('核心知识点', { style: 'Heading2' }))
    for (const group of note.points) {
      blocks.push(paragraph('**' + group.title + '**', { spaceAfter: 60 }))
      for (const item of group.items) blocks.push(paragraph(item, { num: true, level: 1 }))
    }
  }

  if (note.focus && note.focus.length) {
    blocks.push(paragraph('弹幕与评论焦点', { style: 'Heading2' }))
    for (const group of note.focus) {
      blocks.push(paragraph('**' + group.topic + '**', { spaceAfter: 60 }))
      for (const quote of group.quotes) blocks.push(paragraph('“' + quote + '”', { style: 'Quote' }))
    }
  }

  blocks.push(paragraph('由「课程助手」自动生成：知识点来自视频简介/字幕，观众反馈来自弹幕与热评。', { color: '9CA3AF', size: 16, spaceAfter: 0 }))

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' + blocks.join('') +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>'
}

/** 生成 .docx Buffer。 */
export function buildDocx(note) {
  return zip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'word/document.xml', data: bodyXml(note) },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/numbering.xml', data: NUMBERING },
    { name: 'word/_rels/document.xml.rels', data: DOC_RELS },
  ])
}

/** 生成配套 Markdown（便于检索/二次编辑）。 */
export function noteToMarkdown(note) {
  const lines = []
  lines.push('# ' + note.title, '')
  const meta = [note.subject || '未分类']
  if (note.engine) meta.push(note.engine === 'llm' ? 'AI 总结' : '本地总结')
  if (note.generatedAt) meta.push(new Date(note.generatedAt).toLocaleString('zh-CN', { hour12: false }))
  lines.push('> ' + meta.join(' · '), '')
  lines.push('## 视频信息', '')
  if (note.bvid) lines.push('- 视频链接：https://www.bilibili.com/video/' + note.bvid)
  if (note.owner) lines.push('- UP 主：' + note.owner)
  if (note.stat && typeof note.stat.view === 'number') lines.push('- 播放：' + note.stat.view.toLocaleString('zh-CN'))
  if (note.keywords && note.keywords.length) lines.push('- 关键词：' + note.keywords.join('、'))
  lines.push('')
  if (note.overview) lines.push('## 课程概览', '', '> ' + note.overview, '')
  if (note.points && note.points.length) {
    lines.push('## 核心知识点', '')
    for (const group of note.points) {
      lines.push('- **' + group.title + '**')
      for (const item of group.items) lines.push('  - ' + item)
    }
    lines.push('')
  }
  if (note.focus && note.focus.length) {
    lines.push('## 弹幕与评论焦点', '')
    for (const group of note.focus) {
      lines.push('- **' + group.topic + '**')
      for (const quote of group.quotes) lines.push('  - “' + quote + '”')
    }
    lines.push('')
  }
  lines.push('---', '', '> 由「课程助手」自动生成。')
  return lines.join('\n')
}
