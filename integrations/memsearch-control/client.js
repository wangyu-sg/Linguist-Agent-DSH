window.__ModuleLoader__.load({
  id: '@local/memsearch-control',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const CSS = `
      .msc-page{max-width:780px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
      .msc-page h2{font-size:20px;margin:0 0 6px;font-weight:600}
      .msc-page h3{font-size:14px;margin:22px 0 8px;font-weight:600}
      .msc-page p{margin:4px 0;color:var(--dsw-alias-label-secondary)}
      .msc-card{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,8px);background:var(--dsw-alias-bg-layer-1);overflow:hidden}
      .msc-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 16px;flex-wrap:wrap}
      .msc-row+.msc-row{border-top:1px solid var(--dsw-alias-border-l1)}
      .msc-copy{flex:1 1 190px;min-width:0}.msc-title{font-weight:600}
      .msc-fields{display:flex;gap:8px;flex-wrap:wrap;width:100%}
      .msc-fields label{display:flex;flex:1 1 145px;flex-direction:column;gap:5px;color:var(--dsw-alias-label-secondary)}
      .msc-fields input,.msc-fields select{min-width:0;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit}
      .msc-button{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
      .msc-button:disabled{opacity:.55;cursor:default}.msc-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
      .msc-toggle{width:40px;height:23px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:99px;background:var(--dsw-alias-bg-layer-2);cursor:pointer}
      .msc-toggle::after{content:'';display:block;width:17px;height:17px;border-radius:50%;background:var(--dsw-alias-label-secondary)}
      .msc-toggle[aria-checked=true]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
      .msc-toggle[aria-checked=true]::after{transform:translateX(16px);background:white}
      .msc-status{min-height:22px;margin:10px 0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.msc-status[data-error=true]{color:var(--dsw-alias-state-error-primary)}
      .msc-value{overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
      .msr-root{box-sizing:border-box;container-type:inline-size;width:calc(100% - var(--dsh-composer-side-clearance,16px) * 2);min-width:0;max-width:var(--dsh-composer-card-max-width,920px);margin-inline:auto}
      .msr-root .msr-capsule{gap:7px;min-height:30px;padding:4px 9px;border-color:var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500}
      .msr-root .msr-capsule:hover{background:var(--dsw-alias-bg-layer-2)}
      .msr-root .msr-capsule>.msr-badge{gap:6px;color:var(--dsw-alias-label-primary);font-size:0}
      .msr-root .msr-capsule>.msr-badge::before{content:'';width:6px;height:6px;flex:none;border-radius:50%;background:var(--dsw-alias-brand-primary)}
      .msr-root .msr-capsule>.msr-badge::after{content:'MemSearch' / '';font-size:12px}
      .msr-root .msr-capsule-dot{min-width:18px;height:18px;box-sizing:border-box;background:var(--dsw-alias-brand-primary)}
      .msr-root .msr-capsule-dot.zero{border:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
      .msr-root .msr-capsule-chev{color:var(--dsw-alias-label-secondary)}
      .msr-root .msr-toast{overflow-wrap:anywhere}
      .msr-root:has(>.msr-bar){overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
      .msr-root .msr-bar{display:grid;grid-template-columns:auto minmax(0,1fr) repeat(3,auto);gap:6px 8px;padding:7px 10px;border:0;border-radius:0;background:transparent}
      .msr-root .msr-bar>.msr-badge{gap:6px;padding:3px 7px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px}
      .msr-root .msr-bar>.msr-badge::before{content:'';width:6px;height:6px;flex:none;border-radius:50%;background:var(--dsw-alias-brand-primary)}
      .msr-root .msr-bar>span:nth-child(2){min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}
      .msr-root .msr-count{color:var(--dsw-alias-brand-primary);font-weight:600}
      .msr-root .msr-bar>.msr-spacer{display:none}
      .msr-root .msr-btn{min-height:28px;padding:3px 8px;border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px}
      .msr-root .msr-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:transparent;color:var(--dsw-alias-label-primary)}
      .msr-root .msr-btn.primary{background:var(--dsw-alias-brand-primary);color:#fff}
      .msr-root .msr-btn.primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);color:#fff;filter:brightness(1.08)}
      .msr-root .msr-btn.danger:hover:not(:disabled){color:var(--msr-error)}
      .msr-root .msr-panel{max-height:min(42vh,360px);overflow:auto;margin:0;border:0;border-top:1px solid var(--msr-border);border-radius:0;background:transparent}
      .msr-root .msr-panel-head{flex-wrap:wrap;gap:3px 12px;padding:9px 12px}
      .msr-root .msr-panel-head>span:last-child{min-width:0;font-size:11px;overflow-wrap:anywhere}
      .msr-root .msr-panel-title{font-size:12px;font-weight:600}
      .msr-root .msr-list{max-height:min(25vh,220px);overflow:auto;padding:4px 6px}
      .msr-root .msr-item{flex-wrap:wrap;gap:6px 12px;min-width:0;padding:9px 12px}
      .msr-root .msr-item-main{flex:1 1 230px;min-width:0;overflow-wrap:anywhere}
      .msr-root .msr-item-name{flex-wrap:wrap;overflow-wrap:anywhere}
      .msr-root .msr-tag{flex:none;white-space:nowrap}
      .msr-root .msr-item-actions{flex-wrap:wrap;gap:4px}
      .msr-root .msr-item-meta,.msr-root .msr-item-desc,.msr-root .msr-note{overflow-wrap:anywhere}
      .msr-root .msr-fs{margin:0;border:0;border-top:1px solid var(--msr-border);border-radius:0;background:transparent}
      .msr-root .msr-fs-head{min-width:0;gap:6px;padding:9px 12px;border:0}
      .msr-root .msr-fs-head>span:not(:last-child){flex:none;white-space:nowrap}
      .msr-root .msr-fs-head>.msr-spacer{display:none}
      .msr-root .msr-fs-head>span:last-child{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
      .msr-root .msr-fs-body{display:flex;flex-wrap:wrap;max-height:min(35vh,280px);border-top:1px solid var(--msr-border)}
      .msr-root .msr-fs-tree{flex:1 1 200px;min-width:0;box-sizing:border-box}
      .msr-root .msr-fs-name{min-width:0}
      .msr-root .msr-preview{flex:1.4 1 240px;min-width:0;box-sizing:border-box;overflow-wrap:anywhere}
      .msr-root .msr-note{padding:8px 12px;font-size:11px;line-height:1.45}
      @container (max-width:560px){
        .msr-root .msr-bar>span:nth-child(2){grid-column:2/-1}
        .msr-root .msr-bar>button:nth-of-type(1){grid-column:3;grid-row:2}
        .msr-root .msr-bar>button:nth-of-type(2){grid-column:4;grid-row:2}
        .msr-root .msr-bar>button:nth-of-type(3){grid-column:5;grid-row:2}
        .msr-root .msr-panel-head>.msr-spacer{display:none}
        .msr-root .msr-panel-head>span:last-child{flex-basis:100%}
        .msr-root .msr-fs-tree{border-right:0;border-bottom:1px solid var(--msr-border)}
      }
      @container (max-width:340px){
        .msr-root .msr-bar{grid-template-columns:auto minmax(0,1fr) auto}
        .msr-root .msr-bar>span:nth-child(2){grid-column:2/-1}
        .msr-root .msr-bar>button:nth-of-type(1){grid-column:1}
        .msr-root .msr-bar>button:nth-of-type(2){grid-column:2}
        .msr-root .msr-bar>button:nth-of-type(3){grid-column:3}
      }
    `
    async function request(body) {
      const result = await fetch('/memsearch-control/settings', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)
      const data = await result.json()
      if (!result.ok) throw new Error(data.error || '设置读取失败')
      return data
    }
    function Icon({ size = 20 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true }, h('path', { d: 'M12 4a4 4 0 0 0-7 3.2A4 4 0 0 0 4 14a4 4 0 0 0 7.9 1M12 4a4 4 0 0 1 7 3.2A4 4 0 0 1 20 14a4 4 0 0 1-7.9 1M12 4v16M7 9c2 0 3 1 3 3M17 9c-2 0-3 1-3 3', strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }
    function Settings() {
      const [data, setData] = React.useState(null)
      const [model, setModel] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState('')
      const [error, setError] = React.useState(false)
      const [catalog, setCatalog] = React.useState({ providers: [], models: [], efforts: [] })
      const [catalogError, setCatalogError] = React.useState('')
      async function load() {
        setBusy(true); setMessage(''); setError(false)
        try { const next = await request(); setData(next); setModel({ ...next.model, reasoningEffort: next.model.reasoningEffort ?? '' }) }
        catch (err) { setError(true); setMessage(err.message) }
        finally { setBusy(false) }
      }
      React.useEffect(() => { void load() }, [])
      React.useEffect(() => {
        if (!model?.provider) return
        const controller = new AbortController()
        const query = new URLSearchParams({ provider: model.provider })
        if (model.model) query.set('model', model.model)
        setCatalogError('')
        fetch(`/memsearch-control/catalog?${query}`, { signal: controller.signal })
          .then(async result => { const value = await result.json(); if (!result.ok) throw new Error(value.error || '读取模型列表失败'); return value })
          .then(value => { setCatalog(value); setCatalogError(value.catalogError ?? '') })
          .catch(err => { if (err.name !== 'AbortError') setCatalogError(err.message) })
        return () => controller.abort()
      }, [model?.provider, model?.model])
      async function saveModel() {
        setBusy(true); setMessage(''); setError(false)
        try {
          const result = await request({ action: 'model', model, revision: data.revision })
          setData({ ...data, model: result.model, revision: result.revision }); setModel({ ...result.model, reasoningEffort: result.model.reasoningEffort ?? '' }); setMessage('已保存 DSH 后台默认模型。')
        } catch (err) { setError(true); setMessage(err.message) }
        finally { setBusy(false) }
      }
      async function toggle(key) {
        setBusy(true); setMessage(''); setError(false)
        try {
          const result = await request({ action: 'maintenance', key, enabled: !data.maintenance[key] })
          setData({ ...data, maintenance: { ...data.maintenance, [key]: result.enabled } }); setMessage('设置已保存。')
        } catch (err) { setError(true); setMessage(err.message) }
        finally { setBusy(false) }
      }
      const row = (title, help, control) => h('div', { className: 'msc-row' }, h('div', { className: 'msc-copy' }, h('div', { className: 'msc-title' }, title), h('p', null, help)), control)
      const options = (items, current) => current && !items.some(item => item.id === current) ? [{ id: current, name: `${current}（当前，未出现在列表）` }, ...items] : items
      const select = (label, value, items, onChange, placeholder) => h('label', null, label, h('select', { value: value ?? '', disabled: busy || !model, onChange }, h('option', { value: '' }, placeholder), ...options(items, value).map(item => h('option', { key: item.id, value: item.id }, item.name || item.id))))
      const toggleRow = (key, title, help) => row(title, help, h('button', { type: 'button', className: 'msc-toggle', role: 'switch', 'aria-label': title, 'aria-checked': data?.maintenance[key] ?? false, disabled: busy || !data, onClick: () => void toggle(key) }))
      return h('section', { className: 'msc-page', 'aria-label': 'MemSearch 设置' }, h('style', null, CSS),
        h('h2', null, 'MemSearch'), h('p', null, '查看记忆配置并管理后台整理。'),
        h('h3', null, '后台摘要模型'),
        h('div', { className: 'msc-card' }, h('div', { className: 'msc-row' },
          h('p', null, '当 MemSearch 使用 DSH 后台方式时，摘要使用这里的模型。它也是其他 headless 任务的默认模型；不会改变前台会话的模型。'),
          h('div', { className: 'msc-fields' },
            select('模型提供方', model?.provider, catalog.providers, event => { setCatalog({ ...catalog, models: [], efforts: [] }); setModel({ ...model, provider: event.target.value, model: '', reasoningEffort: '' }) }, '请选择提供方'),
            select('模型', model?.model, catalog.models, event => { setCatalog({ ...catalog, efforts: [] }); setModel({ ...model, model: event.target.value, reasoningEffort: '' }) }, '请选择模型'),
            select('思考强度', model?.reasoningEffort, catalog.efforts, event => setModel({ ...model, reasoningEffort: event.target.value }), '使用默认')),
          h('p', null, '列表来自当前 DSH 提供方；后台配置是否具备相同模型仍需验证。若 MemSearch 使用自定义 API 模式，则不使用此设置。'),
          catalogError && h('p', { role: 'alert' }, `模型列表读取失败：${catalogError}`),
          h('button', { className: 'msc-button', type: 'button', disabled: busy || !data || !model?.provider || !model?.model, onClick: () => void saveModel() }, '保存模型'))),
        h('h3', null, '记忆检索'),
        h('div', { className: 'msc-card' }, row('检索模型', '用于寻找相关记忆。', h('span', { className: 'msc-value' }, data ? `${data.embedding.provider} · ${data.embedding.model}` : '—')), row('索引位置', '相对路径以当前工作区为准。', h('span', { className: 'msc-value' }, data?.embedding.uri ?? '—'))),
        h('h3', null, '后台整理'), h('p', null, '开启后可能产生额外的后台模型调用。'),
        h('div', { className: 'msc-card' }, toggleRow('project_review', '项目摘要', '整理项目的长期约定。'), toggleRow('memory_to_skill', '技能候选', '从重复经验中提炼待审核的技能。'), toggleRow('user_profile', '用户偏好', '整理跨会话的用户偏好。')),
        h('div', { className: 'msc-status', role: error ? 'alert' : 'status', 'data-error': error }, busy ? '读取或保存中…' : message),
        h('button', { type: 'button', className: 'msc-button', disabled: busy, onClick: () => void load() }, '刷新状态'),
        h('p', null, '记录与召回由官方 MemSearch 插件控制，可在 DSH 插件管理中启用或停用。'))
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'memsearch-control', order: 71, label: () => 'MemSearch' }, Settings))
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', id: 'memsearch-control' }, Icon))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'memsearch-control.styles' }, () => h('style', { 'data-memsearch-control': '' }, CSS)))
      },
    }
  },
})
