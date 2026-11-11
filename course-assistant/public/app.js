(function () {
  'use strict'

  var state = { data: null, viewing: null, busy: false }
  var el = function (id) { return document.getElementById(id) }

  var VERDICT = {
    new: '新视频',
    duplicate: '已处理',
    'not-course': '非课程',
    'not-browser': '非浏览器',
    'too-short': '标题过短',
    error: '错误',
  }

  function pad(n) { return n < 10 ? '0' + n : String(n) }
  function fmtTime(ts) {
    if (!ts) return '—'
    var d = new Date(ts)
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
  }
  function fmtDateTime(ts) {
    if (!ts) return '—'
    var d = new Date(ts)
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  }
  function fmtNum(n) {
    if (typeof n !== 'number') return '—'
    return n.toLocaleString('zh-CN')
  }

  function toast(message, isError) {
    var node = el('toast')
    node.textContent = message
    node.className = 'toast' + (isError ? ' err' : '')
    node.hidden = false
    clearTimeout(toast._timer)
    toast._timer = setTimeout(function () { node.hidden = true }, 3200)
  }

  function api(path, body, method) {
    return fetch(path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: 'HTTP ' + res.status } })
    })
  }

  function renderAll() {
    if (!state.data) return
    renderControls()
    renderWindow()
    renderObservations()
    renderStats()
    renderSummary()
    renderHistory()
    renderTick()
  }

  function renderControls() {
    var cfg = state.data.config
    var runtime = state.data.runtime
    el('toggle').checked = Boolean(cfg.enabled)
    if (document.activeElement !== el('interval')) {
      el('interval').value = Math.round(cfg.intervalMs / 1000)
    }
    var pill = el('statusPill')
    if (state.busy) {
      pill.textContent = '总结中…'
      pill.className = 'pill pill-busy'
    } else if (cfg.enabled) {
      pill.textContent = '运行中'
      pill.className = 'pill pill-running'
    } else {
      pill.textContent = '已暂停'
      pill.className = 'pill pill-paused'
    }
    var hint = el('pausedHint')
    if (hint) hint.hidden = Boolean(cfg.enabled)
    var presets = el('presets').querySelectorAll('button')
    for (var i = 0; i < presets.length; i += 1) {
      var sec = Number(presets[i].getAttribute('data-sec'))
      presets[i].className = Math.round(cfg.intervalMs / 1000) === sec ? 'active' : ''
    }
  }

  function renderWindow() {
    var obs = state.data.observations && state.data.observations[0]
    var current = state.data.current
    if (!obs && !current) {
      el('windowTitle').textContent = '等待第一次检测…'
      el('windowProc').textContent = '—'
      el('windowTime').textContent = '—'
      el('windowVerdict').textContent = '—'
      el('windowVerdict').className = 'badge'
      return
    }
    var source = obs || { title: current.title, proc: '—', time: current.generatedAt, verdict: 'new' }
    el('windowTitle').textContent = source.title || '（无标题）'
    el('windowProc').textContent = source.proc || '—'
    el('windowTime').textContent = fmtTime(source.time)
    var badge = el('windowVerdict')
    badge.textContent = VERDICT[source.verdict] || source.verdict || '—'
    badge.className = 'badge badge-' + (source.verdict || 'idle')
  }

  function renderObservations() {
    var list = el('observations')
    list.innerHTML = ''
    var items = state.data.observations || []
    el('obsCount').textContent = items.length + ' 条'
    if (items.length === 0) {
      var empty = document.createElement('li')
      empty.className = 'empty-row'
      empty.textContent = '暂无记录'
      list.appendChild(empty)
      return
    }
    items.forEach(function (obs, index) {
      var li = document.createElement('li')
      if (index === 0) li.className = 'flash'
      var time = document.createElement('span')
      time.className = 'obs-time'
      time.textContent = fmtTime(obs.time)
      var body = document.createElement('div')
      var title = document.createElement('div')
      title.className = 'obs-title'
      title.textContent = obs.title || '（无标题）'
      var proc = document.createElement('div')
      proc.className = 'obs-proc'
      proc.textContent = (obs.proc || '—') + (obs.detail ? ' · ' + obs.detail : '')
      body.appendChild(title)
      body.appendChild(proc)
      var badge = document.createElement('span')
      badge.className = 'badge badge-' + (obs.verdict || 'idle')
      badge.textContent = VERDICT[obs.verdict] || obs.verdict || '—'
      li.appendChild(time)
      li.appendChild(body)
      li.appendChild(badge)
      list.appendChild(li)
    })
  }

  function renderStats() {
    var st = state.data.stats || {}
    el('stats').textContent = '本次运行：检测 ' + (st.checks || 0) + ' 次 · 新视频 ' + (st.videos || 0) + ' 个'
  }

  function renderTick() {
    if (!state.data || !state.data.runtime) return
    var runtime = state.data.runtime
    var node = el('nextTick')
    if (state.busy) { node.textContent = '正在总结…'; return }
    if (!runtime.running) { node.textContent = '已暂停'; return }
    if (!runtime.nextTickAt) { node.textContent = '待下次检测'; return }
    var left = Math.max(0, Math.round((runtime.nextTickAt - Date.now()) / 1000))
    if (left > 0) node.textContent = left + ' 秒后检测'
    else if (Date.now() - runtime.nextTickAt > 5000) node.textContent = '等待下次检测…'
    else node.textContent = '即将检测…'
  }

  function renderSummary() {
    var video = state.viewing || state.data.current
    var empty = el('summaryEmpty')
    var content = el('summaryContent')
    if (!video) {
      empty.hidden = false
      content.hidden = true
      return
    }
    empty.hidden = true
    content.hidden = false
    el('videoTitle').textContent = video.title || '—'
    el('subjectChip').textContent = video.subject || '未分类'
    el('engineChip').textContent = video.engine === 'llm'
      ? 'AI 总结'
      : (video.engine === 'offline' ? '离线摘要' : (video.engine === 'imported' ? '目录导入' : '本地总结'))
    var link = el('bvidLink')
    if (video.bvid) {
      link.hidden = false
      link.textContent = video.bvid
      link.href = 'https://www.bilibili.com/video/' + video.bvid
    } else {
      link.hidden = true
    }

    var stats = []
    if (video.stat) {
      if (typeof video.stat.view === 'number') stats.push('播放 ' + fmtNum(video.stat.view))
      if (typeof video.stat.danmaku === 'number') stats.push('弹幕 ' + fmtNum(video.stat.danmaku))
      if (typeof video.stat.reply === 'number') stats.push('评论 ' + fmtNum(video.stat.reply))
    }
    if (video.generatedAt) stats.push('生成于 ' + fmtDateTime(video.generatedAt))
    el('videoStats').textContent = stats.join(' · ')

    el('overview').textContent = video.overview || '（无概览）'

    var points = el('points')
    points.innerHTML = ''
    ;(video.points || []).forEach(function (group) {
      var wrap = document.createElement('div')
      wrap.className = 'point-group'
      var title = document.createElement('div')
      title.className = 'point-title'
      title.textContent = group.title
      var ul = document.createElement('ul')
      ;(group.items || []).forEach(function (item) {
        var li = document.createElement('li')
        li.textContent = item
        ul.appendChild(li)
      })
      wrap.appendChild(title)
      wrap.appendChild(ul)
      points.appendChild(wrap)
    })
    if (!video.points || video.points.length === 0) {
      points.textContent = video.engine === 'imported'
        ? '（这条是从笔记目录导入的，点「重新总结」可重新抓取 B 站内容）'
        : '（暂无知识点）'
    }

    var focus = el('focus')
    focus.innerHTML = ''
    ;(video.focus || []).forEach(function (group) {
      var wrap = document.createElement('div')
      wrap.className = 'focus-group'
      var topic = document.createElement('div')
      topic.className = 'focus-topic'
      topic.textContent = group.topic
      wrap.appendChild(topic)
      ;(group.quotes || []).forEach(function (quote) {
        var block = document.createElement('blockquote')
        block.textContent = quote
        wrap.appendChild(block)
      })
      focus.appendChild(wrap)
    })
    if (!video.focus || video.focus.length === 0) focus.textContent = '（暂无讨论）'

    var kws = el('keywordList')
    kws.innerHTML = ''
    ;(video.keywords || []).forEach(function (word) {
      var span = document.createElement('span')
      span.textContent = word
      kws.appendChild(span)
    })
    if (!video.keywords || video.keywords.length === 0) kws.textContent = '（无）'

    el('openDocBtn').disabled = !video.docx
    el('warningText').textContent = video.warning || ''

    var filter = el('subjectFilter')
    var subjects = []
    ;(state.data.history || []).forEach(function (item) {
      if (item.subject && subjects.indexOf(item.subject) < 0) subjects.push(item.subject)
    })
    var currentValue = filter.value
    filter.innerHTML = '<option value="">全部学科</option>'
    subjects.forEach(function (subject) {
      var option = document.createElement('option')
      option.value = subject
      option.textContent = subject
      filter.appendChild(option)
    })
    filter.value = currentValue
  }

  function renderHistory() {
    var body = el('historyBody')
    body.innerHTML = ''
    var filter = el('subjectFilter').value
    var items = (state.data.history || []).filter(function (item) {
      return !filter || item.subject === filter
    })
    if (items.length === 0) {
      var row = document.createElement('tr')
      var cell = document.createElement('td')
      cell.colSpan = 5
      cell.className = 'empty-row'
      cell.textContent = '还没有笔记，检测到新课程后会自动生成'
      row.appendChild(cell)
      body.appendChild(row)
      return
    }
    items.forEach(function (item) {
      var tr = document.createElement('tr')
      var time = document.createElement('td')
      time.textContent = fmtDateTime(item.generatedAt)
      var subject = document.createElement('td')
      subject.textContent = item.subject || '—'
      var title = document.createElement('td')
      title.className = 'title'
      var link = document.createElement('a')
      link.className = 'link'
      link.textContent = item.title
      link.addEventListener('click', function () {
        state.viewing = item
        renderSummary()
        window.scrollTo({ top: 0, behavior: 'smooth' })
      })
      title.appendChild(link)
      var engine = document.createElement('td')
      engine.textContent = item.engine === 'llm' ? 'AI' : '本地'
      var actions = document.createElement('td')
      if (item.docx) {
        var open = document.createElement('a')
        open.className = 'link'
        open.textContent = '打开'
        open.href = '/api/doc?key=' + encodeURIComponent(item.key)
        open.target = '_blank'
        actions.appendChild(open)
      }
      tr.appendChild(time)
      tr.appendChild(subject)
      tr.appendChild(title)
      tr.appendChild(engine)
      tr.appendChild(actions)
      body.appendChild(tr)
    })
  }

  function load() {
    return api('/api/state').then(function (data) {
      if (data && data.ok) {
        state.data = data
        state.viewing = null
        renderAll()
      }
    }).catch(function () { /* 忽略 */ })
  }

  function connect() {
    var source = new EventSource('/api/events')
    source.addEventListener('hello', function (event) {
      try { state.data = JSON.parse(event.data); renderAll() } catch (e) { /* 忽略 */ }
    })
    source.addEventListener('state', function (event) {
      try { state.data = JSON.parse(event.data); renderAll() } catch (e) { /* 忽略 */ }
    })
    source.addEventListener('config', function (event) {
      try { state.data.config = JSON.parse(event.data); renderControls() } catch (e) { /* 忽略 */ }
    })
    source.addEventListener('observation', function (event) {
      try {
        var obs = JSON.parse(event.data)
        if (state.data) {
          var first = state.data.observations[0]
          var same = first && first.verdict === obs.verdict && first.title === obs.title && first.detail === obs.detail
          if (same) {
            first.time = obs.time
          } else {
            state.data.observations.unshift(obs)
            if (state.data.observations.length > 50) state.data.observations.length = 50
          }
          renderWindow()
          renderObservations()
        }
      } catch (e) { /* 忽略 */ }
    })
    source.addEventListener('tick', function (event) {
      try {
        var info = JSON.parse(event.data)
        if (!state.data || !state.data.runtime) return
        state.data.runtime.lastTickAt = info.lastTickAt
        state.data.runtime.nextTickAt = info.nextTickAt
        state.data.runtime.running = info.running
        state.busy = false
        renderTick()
        renderControls()
      } catch (e) { /* 忽略 */ }
    })
    source.addEventListener('summary-start', function (event) {
      state.busy = true
      renderControls()
      renderTick()
      try { toast('正在总结：' + JSON.parse(event.data).title) } catch (e) { /* 忽略 */ }
    })
    source.addEventListener('summary', function (event) {
      state.busy = false
      try {
        state.data.current = JSON.parse(event.data)
        state.viewing = null
        renderAll()
        toast('笔记已生成')
        load()
      } catch (e) { /* 忽略 */ }
    })
    source.addEventListener('error', function (event) {
      state.busy = false
      renderControls()
      var message = '连接异常，正在重连…'
      try { if (event.data) message = JSON.parse(event.data).message || message } catch (e) { /* 忽略 */ }
      toast(message, true)
    })
    source.onerror = function () {
      var pill = el('statusPill')
      pill.textContent = '重连中…'
      pill.className = 'pill pill-error'
    }
  }

  function saveConfig(patch, done) {
    return api('/api/config', patch).then(function (result) {
      if (!result.ok) {
        toast(result.error || '保存失败', true)
        if (done) done(result)
        return
      }
      state.data.config = result.config
      renderControls()
      if (done) done(result)
    }).catch(function (error) {
      toast('保存失败：' + error.message, true)
      if (done) done({ ok: false, error: error.message })
    })
  }

  function bind() {
    el('toggle').addEventListener('change', function (event) {
      var enabled = event.target.checked
      saveConfig({ enabled: enabled }).then(function () {
        toast(enabled ? '已启动轮询' : '已暂停轮询')
      })
    })

    el('interval').addEventListener('change', function (event) {
      var sec = Math.min(300, Math.max(3, Number(event.target.value) || 15))
      event.target.value = sec
      saveConfig({ intervalMs: sec * 1000 })
    })

    el('presets').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-sec]')
      if (!button) return
      var sec = Number(button.getAttribute('data-sec'))
      el('interval').value = sec
      saveConfig({ intervalMs: sec * 1000 })
    })

    el('scanBtn').addEventListener('click', function () {
      var button = el('scanBtn')
      button.disabled = true
      button.textContent = '检测中…'
      var title = (el('manualTitle').value || '').trim()
      api('/api/scan', title ? { title: title } : {}).then(function (result) {
        if (!result.ok) toast(result.error || '检测失败', true)
        else if (result.verdict === 'new') toast('已生成笔记')
        else toast('检测完成：' + (VERDICT[result.verdict] || result.verdict))
      }).catch(function (error) {
        toast('检测失败：' + error.message, true)
      }).finally(function () {
        button.disabled = false
        button.textContent = '立即检测'
      })
    })

    el('manualScanBtn').addEventListener('click', function () { el('scanBtn').click() })
    el('manualTitle').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') el('scanBtn').click()
    })

    el('refreshBtn').addEventListener('click', function () {
      var button = el('refreshBtn')
      button.disabled = true
      button.textContent = '刷新中…'
      api('/api/rescan', {}).then(function (result) {
        if (!result || !result.ok) {
          toast((result && result.error) || '刷新失败', true)
          return null
        }
        toast(result.added > 0
          ? '已刷新：新增 ' + result.added + ' 条笔记（共 ' + result.total + ' 条）'
          : '已刷新：共 ' + result.total + ' 条笔记')
        return load()
      }).catch(function (error) {
        toast('刷新失败：' + error.message, true)
      }).finally(function () {
        button.disabled = false
        button.textContent = '刷新'
      })
    })

    el('subjectFilter').addEventListener('change', renderHistory)

    el('reprocessBtn').addEventListener('click', function () {
      var video = state.viewing || state.data.current
      if (!video || !video.key) return
      if (!window.confirm('重新抓取并总结「' + video.title + '」？')) return
      var button = el('reprocessBtn')
      button.disabled = true
      api('/api/reprocess', { key: video.key }).then(function (result) {
        if (!result.ok) toast(result.error || '重新总结失败', true)
        else toast('已重新生成')
      }).finally(function () { button.disabled = false })
    })

    el('openDocBtn').addEventListener('click', function () {
      var video = state.viewing || state.data.current
      if (video && video.key) window.open('/api/doc?key=' + encodeURIComponent(video.key), '_blank')
    })

    el('openFolderBtn').addEventListener('click', function () {
      var video = state.viewing || state.data.current
      api('/api/open-folder', video && video.key ? { key: video.key } : {}).then(function (result) {
        if (result.ok) return
        // 资源管理器起不来时（沙箱/受限环境），退回到内置目录视图
        window.open((result && result.url) || '/folder', '_blank')
        toast((result && result.error) || '已改用内置目录视图打开', true)
      }).catch(function (error) {
        window.open('/folder', '_blank')
        toast('打开失败：' + error.message, true)
      })
    })

    el('settingsBtn').addEventListener('click', openSettings)
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !el('settingsModal').hidden) el('settingsModal').hidden = true
    })
    el('closeSettings').addEventListener('click', function () { el('settingsModal').hidden = true })
    el('settingsModal').addEventListener('click', function (event) {
      if (event.target === el('settingsModal')) el('settingsModal').hidden = true
    })

    el('saveSettings').addEventListener('click', function () {
      var key = el('cfgLlmKey').value
      var patch = {
        notesDir: el('cfgNotesDir').value,
        autoOpenBrowser: el('cfgAutoOpen').checked,
        llm: {
          enabled: el('cfgLlmEnabled').checked,
          baseURL: el('cfgLlmBase').value,
          model: el('cfgLlmModel').value,
        },
      }
      if (key) patch.llm.apiKey = key
      saveConfig(patch, function (result) {
        var msg = el('settingsMsg')
        if (result.ok) {
          msg.className = 'settings-msg ok'
          msg.textContent = '已保存'
          el('settingsModal').hidden = true
          toast('设置已保存')
        } else {
          msg.className = 'settings-msg err'
          msg.textContent = result.error || '保存失败'
        }
      })
    })

    el('fillDeepseekBtn').addEventListener('click', function () {
      el('cfgLlmBase').value = 'https://api.deepseek.com'
      el('cfgLlmModel').value = 'deepseek-chat'
      var msg = el('settingsMsg')
      msg.className = 'settings-msg ok'
      msg.textContent = '已填入 DeepSeek 官方地址与模型，再粘贴你的 API Key 即可。'
    })

    el('testLlmBtn').addEventListener('click', function () {
      var msg = el('settingsMsg')
      msg.className = 'settings-msg'
      msg.textContent = '测试中…'
      var key = el('cfgLlmKey').value
      var payload = { llm: { baseURL: el('cfgLlmBase').value, model: el('cfgLlmModel').value } }
      if (key) payload.llm.apiKey = key
      api('/api/llm-test', payload).then(function (result) {
        msg.className = 'settings-msg ' + (result.ok ? 'ok' : 'err')
        msg.textContent = result.message
      }).catch(function (error) {
        msg.className = 'settings-msg err'
        msg.textContent = '连接失败：' + error.message
      })
    })

    el('quitBtn').addEventListener('click', function () {
      if (!window.confirm('退出课程助手？页面将停止工作，之后可再次双击桌面快捷方式启动。')) return
      api('/api/quit', {}).then(function () {
        document.body.innerHTML = '<div style="padding:60px;text-align:center;font-family:sans-serif;color:#475569">课程助手已退出，可以关闭此页面。</div>'
      })
    })
  }

  function openSettings() {
    var cfg = state.data.config
    el('cfgNotesDir').value = cfg.notesDir
    el('cfgAutoOpen').checked = cfg.autoOpenBrowser
    el('cfgLlmEnabled').checked = cfg.llm.enabled
    el('cfgLlmBase').value = cfg.llm.baseURL
    el('cfgLlmModel').value = cfg.llm.model
    el('cfgLlmKey').value = ''
    el('cfgLlmKey').placeholder = cfg.llm.hasKey ? '已保存 ' + cfg.llm.apiKey + '（留空保持不变）' : '粘贴 API Key（可留空）'
    el('settingsMsg').textContent = ''
    el('settingsMsg').className = 'settings-msg'
    el('settingsModal').hidden = false
  }

  bind()
  load().then(connect, connect)
  setInterval(renderTick, 1000)
})()