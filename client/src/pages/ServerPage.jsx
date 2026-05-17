import React from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { apiFetch, apiUrl, C, EmptyState, StatusDot, statusColor, formatBytes, formatRelTime, NumberInput } from '../lib/yamsShared'

// yams-server.js — Server detail page: all management tabs wired to real APIs

const TABS = [
  { id: 'console',    label: 'Console'         },
  { id: 'worlds',     label: 'Worlds'          },
  { id: 'files',      label: 'File Manager'    },
  { id: 'backups',    label: 'Backup Manager'  },
  { id: 'metrics',    label: 'Server Metrics'  },
  { id: 'scheduler',  label: 'Task Scheduler'  },
  { id: 'webhooks',   label: 'Webhooks'        },
  { id: 'mods',       label: 'Mods'            },
  { id: 'players',    label: 'Players'         },
  { id: 'settings',   label: 'Settings'        },
];

// ─── Shared small components ──────────────────────────────────────────────────

function Select({ value, onChange, options, style }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: C.surface2, border: `1px solid ${C.border}`,
        color: C.text, borderRadius: 6, padding: '7px 10px',
        fontSize: 13, outline: 'none', cursor: 'pointer',
        appearance: 'none',
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238b949e' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
        paddingRight: 28, ...(style || {}),
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Toggle({ value, onChange }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        width: 36, height: 20, borderRadius: 10, cursor: 'pointer',
        background: value ? C.green : C.surface2,
        border: `1px solid ${value ? C.green : C.border}`,
        position: 'relative', transition: 'background 150ms, border-color 150ms',
        flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: value ? 17 : 2,
        width: 14, height: 14, borderRadius: '50%',
        background: value ? '#fff' : C.muted, transition: 'left 150ms',
      }} />
    </div>
  );
}

function FieldRow({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function SectionPlaceholder({ icon, title, description, cta, onCta }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 24px', gap: 12, textAlign: 'center' }}>
      <div style={{ width: 52, height: 52, borderRadius: 12, background: C.surface2, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{title}</div>
      <div style={{ fontSize: 13, color: C.muted, maxWidth: 360, lineHeight: 1.6 }}>{description}</div>
      {cta && (
        <button
          onClick={onCta}
          style={{ marginTop: 8, fontSize: 12, fontWeight: 600, padding: '8px 20px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface2, color: C.text, cursor: 'pointer' }}
        >{cta}</button>
      )}
    </div>
  );
}

// ─── UploadZone ───────────────────────────────────────────────────────────────
function UploadZone({ onFile }) {
  const [drag, setDrag]         = React.useState(false);
  const [filename, setFilename] = React.useState(null);
  const inputRef = React.useRef(null);

  function handleDrop(e) {
    e.preventDefault(); setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) { setFilename(file.name); onFile(file); }
  }
  function handleChange(e) {
    const file = e.target.files[0];
    if (file) { setFilename(file.name); onFile(file); }
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `1.5px dashed ${drag ? C.blue : C.border}`,
        borderRadius: 8, padding: '28px 24px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        cursor: 'pointer', transition: 'border-color 150ms, background 150ms',
        background: drag ? `${C.blue}0a` : 'transparent',
      }}
    >
      <input ref={inputRef} type="file" accept=".zip,.tar,.tar.gz,.gz" onChange={handleChange} style={{ display: 'none' }} />
      <div style={{ width: 38, height: 38, borderRadius: 8, background: C.surface2, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: C.muted }}>↑</div>
      {filename
        ? <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{filename}</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Click to change</div>
          </div>
        : <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Drop world archive here</div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>.zip · .tar.gz accepted</div>
          </div>
      }
    </div>
  );
}

function UploadProgress({ filename, onDone, serverId }) {
  const [pct, setPct]     = React.useState(0);
  const [phase, setPhase] = React.useState('uploading');
  const [errMsg, setErr]  = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setPhase('uploading'); setPct(0); setErr(null);
    const formData = new FormData();
    formData.append('world', filename.file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl(`/servers/${serverId}/worlds/import`));
    const _token = sessionStorage.getItem('yams_token');
    if (_token) xhr.setRequestHeader('Authorization', `Bearer ${_token}`);
    xhr.upload.onprogress = (ev) => {
      if (cancelled) return;
      if (ev.lengthComputable) setPct(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (cancelled) return;
      if (xhr.status === 201) {
        setPhase('done'); setTimeout(onDone, 1000);
      } else {
        const body = JSON.parse(xhr.responseText || '{}');
        setErr(body.error || `Upload failed (${xhr.status})`);
        setPhase('error');
      }
    };
    xhr.onerror = () => { if (!cancelled) { setErr('Network error'); setPhase('error'); } };
    xhr.send(formData);

    return () => { cancelled = true; xhr.abort(); };
  }, []);

  if (phase === 'error') {
    return (
      <div style={{ background: `${C.red}10`, border: `1px solid ${C.red}44`, borderRadius: 8, padding: '14px 18px', color: C.red, fontSize: 13 }}>
        Upload failed: {errMsg}
      </div>
    );
  }

  const label = phase === 'uploading' ? `Uploading… ${pct}%` : phase === 'done' ? '✓ World installed' : 'Processing…';
  const color = phase === 'done' ? C.green : C.blue;

  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{filename.name}</span>
        <span style={{ fontSize: 12, color, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 200ms ease, background 300ms' }} />
      </div>
    </div>
  );
}

// ─── WorldRow ─────────────────────────────────────────────────────────────────
function WorldRow({ world, last, serverId, onAction }) {
  const [hov, setHov] = React.useState(false);
  const icon = world.active ? '◼' : '◈';

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', padding: '11px 16px',
        borderBottom: last ? 'none' : `1px solid ${C.borderLight}`,
        background: hov ? C.surface2 : 'transparent', transition: 'background 150ms',
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 6, flexShrink: 0, marginRight: 12,
        background: world.active ? `${C.green}18` : C.surface2,
        border: `1px solid ${world.active ? C.green + '44' : C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: world.active ? C.green : C.dim,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          {world.name}
          {world.active && (
            <span style={{ fontSize: 9, fontWeight: 600, color: C.green, background: `${C.green}18`, border: `1px solid ${C.green}44`, borderRadius: 3, padding: '1px 5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              active
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
          {formatBytes(world.size)} · Modified {formatRelTime(world.updatedAt)}
        </div>
      </div>
      {hov && (
        <div style={{ display: 'flex', gap: 8 }}>
          {!world.active && (
            <button
              onClick={() => onAction('activate', world)}
              style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.green}55`, background: `${C.green}18`, color: C.green, cursor: 'pointer' }}
            >Activate</button>
          )}
          <a
            href={apiUrl(`/servers/${serverId}/worlds/${world.name}/export`)}
            download
            style={{ fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer', textDecoration: 'none' }}
          >Download</a>
          {!world.active && (
            <button
              onClick={() => onAction('delete', world)}
              style={{ fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.red}44`, background: 'transparent', color: C.red, cursor: 'pointer' }}
            >Delete</button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TabWorlds ────────────────────────────────────────────────────────────────
function TabWorlds({ serverId }) {
  const [worlds, setWorlds]         = React.useState(null);
  const [uploadFile, setUploadFile] = React.useState(null);
  const [uploading, setUploading]   = React.useState(false);
  const [successMsg, setSuccessMsg] = React.useState(null);
  const [errorMsg, setErrorMsg]     = React.useState(null);

  function load() {
    apiFetch(`/servers/${serverId}/worlds`)
      .then(data => setWorlds(Array.isArray(data.data) ? data.data : []))
      .catch(e => setErrorMsg(e.message));
  }

  React.useEffect(() => { load(); }, [serverId]);

  function flash(msg) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  }

  function startUpload(file) { setUploadFile({ file, name: file.name }); setUploading(true); }

  function uploadDone() {
    setUploading(false); setUploadFile(null);
    flash('World installed successfully');
    load();
  }

  async function handleWorldAction(action, world) {
    try {
      if (action === 'activate') {
        await apiFetch(`/servers/${serverId}/worlds/active`, {
          method: 'POST',
          body: JSON.stringify({ name: world.name }),
        });
        flash(`"${world.name}" set as active world`);
        load();
      } else if (action === 'delete') {
        if (!confirm(`Delete world "${world.name}"? This cannot be undone.`)) return;
        await apiFetch(`/servers/${serverId}/worlds/${world.name}`, { method: 'DELETE' });
        flash(`"${world.name}" deleted`);
        load();
      }
    } catch (e) {
      setErrorMsg(e.message);
      setTimeout(() => setErrorMsg(null), 5000);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {successMsg && (
        <div style={{ background: `${C.green}10`, border: `1px solid ${C.green}44`, borderRadius: 6, padding: '10px 14px', fontSize: 13, color: C.green, fontWeight: 500 }}>
          ✓ {successMsg}
        </div>
      )}
      {errorMsg && (
        <div style={{ background: `${C.red}10`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '10px 14px', fontSize: 13, color: C.red, fontWeight: 500 }}>
          {errorMsg}
        </div>
      )}

      {/* Upload world section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Import World
        </div>
        {uploading ? (
          <UploadProgress filename={uploadFile} onDone={uploadDone} serverId={serverId} />
        ) : (
          <UploadZone onFile={startUpload} />
        )}
      </div>

      {/* Installed worlds */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Installed Worlds</div>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
          {worlds === null
            ? <EmptyState message="Loading…" />
            : worlds.length === 0
              ? <EmptyState message="No worlds found" />
              : worlds.map((w, i) => (
                  <WorldRow
                    key={w.name}
                    world={w}
                    last={i === worlds.length - 1}
                    serverId={serverId}
                    onAction={handleWorldAction}
                  />
                ))
          }
        </div>
      </div>
    </div>
  );
}

// ─── File icons ───────────────────────────────────────────────────────────────
function FileIcon({ name, type, size = 16 }) {
  const s = { width: size, height: size, flexShrink: 0 };
  if (type === 'directory') {
    return (
      <svg viewBox="0 0 16 16" style={{ ...s, color: '#d29922' }} fill="currentColor">
        <path d="M1.75 3h3.5l1.5 1.5h6a.75.75 0 0 1 .75.75v7a.75.75 0 0 1-.75.75H1.75A.75.75 0 0 1 1 12.25v-8.5A.75.75 0 0 1 1.75 3z"/>
      </svg>
    );
  }
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  if (ext === '.jar') return (
    <svg viewBox="0 0 16 16" style={{ ...s, color: '#f0883e' }} fill="currentColor">
      <path d="M8 1a2 2 0 0 1 2 2v1h1.5A1.5 1.5 0 0 1 13 5.5v8A1.5 1.5 0 0 1 11.5 15h-7A1.5 1.5 0 0 1 3 13.5v-8A1.5 1.5 0 0 1 4.5 4H6V3a2 2 0 0 1 2-2zm0 1.5a.5.5 0 0 0-.5.5v1h1V3a.5.5 0 0 0-.5-.5zM8 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>
    </svg>
  );
  if (ext === '.json') return (
    <svg viewBox="0 0 16 16" style={{ ...s, color: '#79c0ff' }} fill="currentColor">
      <path d="M3.75 2A1.75 1.75 0 0 0 2 3.75v2.5a.75.75 0 0 1-.75.75H.75a.75.75 0 0 0 0 1.5H1.25a.75.75 0 0 1 .75.75v2.5A1.75 1.75 0 0 0 3.75 13.5h.5a.75.75 0 0 0 0-1.5h-.5a.25.25 0 0 1-.25-.25V9.25A1.75 1.75 0 0 0 2.25 7.5 1.75 1.75 0 0 0 3.5 5.75V3.75A.25.25 0 0 1 3.75 3.5h.5a.75.75 0 0 0 0-1.5zm8.5 0h-.5a.75.75 0 0 0 0 1.5h.5a.25.25 0 0 1 .25.25v2a1.75 1.75 0 0 0 1.25 1.678 1.75 1.75 0 0 0-1.25 1.679v2a.25.25 0 0 1-.25.25h-.5a.75.75 0 0 0 0 1.5h.5A1.75 1.75 0 0 0 14 11.75v-2a.25.25 0 0 1 .25-.25h.25a.75.75 0 0 0 0-1.5h-.25A.25.25 0 0 1 14 7.75v-2A1.75 1.75 0 0 0 12.25 4z"/>
    </svg>
  );
  if (ext === '.yml' || ext === '.yaml' || ext === '.properties' || ext === '.toml') return (
    <svg viewBox="0 0 16 16" style={{ ...s, color: '#56d364' }} fill="currentColor">
      <path d="M1 2.75A.75.75 0 0 1 1.75 2h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75zm0 5A.75.75 0 0 1 1.75 7h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.75zM1.75 12h12.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5z"/>
    </svg>
  );
  if (ext === '.log' || ext === '.txt') return (
    <svg viewBox="0 0 16 16" style={{ ...s, color: '#8b949e' }} fill="currentColor">
      <path d="M2 1.75A1.75 1.75 0 0 1 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5zm6.75.96V4.25c0 .138.112.25.25.25H13z"/>
    </svg>
  );
  if (ext === '.zip' || ext === '.gz' || ext === '.tar') return (
    <svg viewBox="0 0 16 16" style={{ ...s, color: '#bc8cff' }} fill="currentColor">
      <path d="M3.5 1.75v.75h-1a.75.75 0 0 0 0 1.5h1v.75a.75.75 0 0 0 1.5 0V4h1a.75.75 0 0 0 0-1.5H5v-.75a.75.75 0 0 0-1.5 0zM2 6.25A1.75 1.75 0 0 1 3.75 4.5h8.5A1.75 1.75 0 0 1 14 6.25v7A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25zM8 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>
    </svg>
  );
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.webp') return (
    <svg viewBox="0 0 16 16" style={{ ...s, color: '#39c5cf' }} fill="currentColor">
      <path d="M16 13.25A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75A1.75 1.75 0 0 1 1.75 1h12.5A1.75 1.75 0 0 1 16 2.75zM1.75 2.5a.25.25 0 0 0-.25.25v7.94l2.22-2.22a.75.75 0 0 1 1.06 0l1.97 1.97 2.97-3.715a.75.75 0 0 1 1.17 0l2.36 2.95V2.75a.25.25 0 0 0-.25-.25zm-.25 10.75c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-.875l-2.914-3.64-2.965 3.706a.75.75 0 0 1-1.144.042L5.5 10.34l-4 4z"/>
    </svg>
  );
  return (
    <svg viewBox="0 0 16 16" style={{ ...s, color: '#8b949e' }} fill="currentColor">
      <path d="M2 1.75A1.75 1.75 0 0 1 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5zm6.75.96V4.25c0 .138.112.25.25.25H13z"/>
    </svg>
  );
}

// ─── TabFiles ─────────────────────────────────────────────────────────────────
const EDITABLE_EXT = new Set(['.properties', '.yml', '.yaml', '.json', '.txt', '.toml', '.cfg', '.conf', '.md', '.xml', '.ini', '.log', '.sh'])
const READONLY_EXT = new Set(['.log'])

function fileIsEditable(name) {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : ''
  return EDITABLE_EXT.has(ext)
}

function TabFiles({ serverId }) {
  const [entries, setEntries] = React.useState(null);
  const [curPath, setCurPath] = React.useState('');
  const [hov, setHov]         = React.useState(null);
  const [errMsg, setErrMsg]   = React.useState(null);
  const [editor, setEditor]   = React.useState(null); // { path, name, content, saving, readonly }

  function load(dir) {
    setEntries(null); setErrMsg(null);
    apiFetch(`/servers/${serverId}/files?path=${encodeURIComponent(dir)}`)
      .then(res => { setEntries(res.data || []); setCurPath(dir); })
      .catch(e => setErrMsg(e.message));
  }

  React.useEffect(() => { load(''); }, [serverId]);

  function navigate(entry) {
    if (entry.type === 'directory') load(`${curPath ? curPath + '/' : ''}${entry.name}`);
  }

  async function openEditor(f) {
    const fullPath = curPath ? `${curPath}/${f.name}` : f.name
    const ext = f.name.includes('.') ? f.name.slice(f.name.lastIndexOf('.')).toLowerCase() : ''
    try {
      const res = await apiFetch(`/servers/${serverId}/files/content?path=${encodeURIComponent(fullPath)}`)
      setEditor({ path: fullPath, name: f.name, content: res.data.content, saving: false, readonly: READONLY_EXT.has(ext) })
    } catch (err) { setErrMsg(err.message) }
  }

  async function saveEditor() {
    if (!editor || editor.readonly) return
    setEditor(e => ({ ...e, saving: true }))
    try {
      await apiFetch(`/servers/${serverId}/files/content`, {
        method: 'PUT',
        body: JSON.stringify({ path: editor.path, content: editor.content }),
      })
      setEditor(null)
      load(curPath)
    } catch (err) {
      setErrMsg(err.message)
      setEditor(e => ({ ...e, saving: false }))
    }
  }

  const breadcrumbs = ['root', ...curPath.split('/').filter(Boolean)];

  return (
    <>
    {editor && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: '#000000aa', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        onClick={e => { if (e.target === e.currentTarget) setEditor(null) }}>
        <div style={{ width: '100%', maxWidth: 860, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 80px)' }}>
          {/* Modal header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: C.surface2, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <FileIcon name={editor.name} type="file" size={14} />
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text, fontFamily: "'JetBrains Mono', monospace" }}>{editor.name}</span>
              {editor.readonly && <span style={{ fontSize: 10, color: C.amber, background: `${C.amber}18`, border: `1px solid ${C.amber}44`, borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>READ-ONLY</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {!editor.readonly && (
                <button onClick={saveEditor} disabled={editor.saving}
                  style={{ fontSize: 12, fontWeight: 600, padding: '5px 14px', borderRadius: 5, border: `1px solid ${C.green}55`, background: `${C.green}18`, color: C.green, cursor: editor.saving ? 'default' : 'pointer', opacity: editor.saving ? 0.6 : 1 }}>
                  {editor.saving ? 'Saving…' : 'Save'}
                </button>
              )}
              <button onClick={() => setEditor(null)}
                style={{ fontSize: 12, padding: '5px 12px', borderRadius: 5, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
          {/* Editor area */}
          <textarea
            value={editor.content}
            readOnly={editor.readonly}
            onChange={e => setEditor(ed => ({ ...ed, content: e.target.value }))}
            onKeyDown={e => { if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEditor() } }}
            spellCheck={false}
            style={{
              flex: 1, resize: 'none', border: 'none', outline: 'none', padding: '16px',
              background: '#0d1117', color: C.text,
              fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace", fontSize: 13, lineHeight: 1.6,
              minHeight: 400,
            }}
          />
          <div style={{ padding: '6px 16px', borderTop: `1px solid ${C.border}`, background: C.surface2, fontSize: 11, color: C.dim, display: 'flex', justifyContent: 'space-between' }}>
            <span>{editor.path}</span>
            {!editor.readonly && <span>Ctrl+S to save</span>}
          </div>
        </div>
      </div>
    )}
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', background: C.surface2, borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {breadcrumbs.map((seg, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: C.dim, fontSize: 11 }}>/</span>}
            <button
              onClick={() => {
                if (i === 0) load('');
                else load(breadcrumbs.slice(1, i + 1).join('/'));
              }}
              style={{ background: 'none', border: 'none', color: i === breadcrumbs.length - 1 ? C.text : C.blue, fontSize: 12, cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace", padding: 0 }}
            >{seg}</button>
          </React.Fragment>
        ))}
        <div style={{ flex: 1 }} />
        <label style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>
          Upload File
          <input
            type="file"
            style={{ display: 'none' }}
            onChange={async e => {
              const file = e.target.files[0];
              if (!file) return;
              const formData = new FormData();
              formData.append('file', file);
              try {
                const _tok  = sessionStorage.getItem('yams_token');
                const _hdrs = _tok ? { Authorization: `Bearer ${_tok}` } : {};
                const _res  = await fetch(apiUrl(`/servers/${serverId}/files/upload?path=${encodeURIComponent(curPath)}`), { method: 'POST', body: formData, headers: _hdrs });
                if (!_res.ok) { const b = await _res.json().catch(() => ({})); setErrMsg(b.error || `Upload failed (${_res.status})`); e.target.value = ''; return; }
                load(curPath);
              } catch (err) {
                setErrMsg(err.message);
              }
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {errMsg && <div style={{ padding: '10px 16px', color: C.red, fontSize: 12 }}>{errMsg}</div>}
      {entries === null
        ? <EmptyState message="Loading…" />
        : entries.length === 0
          ? <EmptyState message="Empty directory" />
          : entries.map((f, i) => (
            <div
              key={f.name}
              onMouseEnter={() => setHov(i)}
              onMouseLeave={() => setHov(null)}
              onClick={() => f.type === 'directory' ? navigate(f) : fileIsEditable(f.name) ? openEditor(f) : null}
              style={{
                display: 'flex', alignItems: 'center', padding: '10px 16px',
                borderBottom: i < entries.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                background: hov === i ? C.surface2 : 'transparent',
                transition: 'background 150ms', cursor: (f.type === 'directory' || fileIsEditable(f.name)) ? 'pointer' : 'default',
              }}
            >
              <div style={{ marginRight: 10, opacity: 0.85, display: 'flex', alignItems: 'center' }}><FileIcon name={f.name} type={f.type} size={15} /></div>
              <span style={{ flex: 1, fontSize: 13, color: C.text, fontFamily: "'JetBrains Mono', monospace" }}>{f.name}</span>
              <span style={{ fontSize: 11, color: C.dim, width: 80, textAlign: 'right' }}>{formatBytes(f.size)}</span>
              <span style={{ fontSize: 11, color: C.dim, width: 130, textAlign: 'right' }}>{formatRelTime(f.modified)}</span>
              {hov === i && f.type !== 'directory' && (
                <div style={{ display: 'flex', gap: 6, marginLeft: 12 }} onClick={e => e.stopPropagation()}>
                  <a
                    href={apiUrl(`/servers/${serverId}/files/download?path=${encodeURIComponent(curPath ? curPath + '/' + f.name : f.name)}`)}
                    download
                    style={{ fontSize: 11, padding: '2px 8px', borderRadius: 3, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer', textDecoration: 'none' }}
                  >Download</a>
                </div>
              )}
            </div>
          ))
      }
    </div>
    </>
  );
}

// ─── TabBackups ───────────────────────────────────────────────────────────────
function TabBackups({ serverId }) {
  const [backups, setBackups] = React.useState(null);
  const [hov, setHov]         = React.useState(null);
  const [running, setRunning] = React.useState(false);
  const [errMsg, setErrMsg]   = React.useState(null);
  const [okMsg, setOkMsg]     = React.useState(null);

  function load() {
    apiFetch(`/servers/${serverId}/backups`)
      .then(res => setBackups(res.data || []))
      .catch(e => setErrMsg(e.message));
  }

  React.useEffect(() => { load(); }, [serverId]);

  async function runBackup() {
    setRunning(true); setErrMsg(null);
    try {
      await apiFetch(`/servers/${serverId}/backups`, { method: 'POST' });
      setOkMsg('Backup created'); setTimeout(() => setOkMsg(null), 4000);
      load();
    } catch (e) { setErrMsg(e.message); }
    finally { setRunning(false); }
  }

  async function deleteBackup(id) {
    if (!confirm('Delete this backup?')) return;
    try {
      await apiFetch(`/servers/${serverId}/backups/${id}`, { method: 'DELETE' });
      load();
    } catch (e) { setErrMsg(e.message); }
  }

  async function restoreBackup(id) {
    if (!confirm('Restore this backup? The server must be stopped.')) return;
    try {
      await apiFetch(`/servers/${serverId}/backups/${id}/restore`, { method: 'POST' });
      setOkMsg('Restore completed'); setTimeout(() => setOkMsg(null), 4000);
    } catch (e) { setErrMsg(e.message); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {okMsg  && <div style={{ background: `${C.green}10`, border: `1px solid ${C.green}44`, borderRadius: 6, padding: '10px 14px', fontSize: 13, color: C.green }}>✓ {okMsg}</div>}
      {errMsg && <div style={{ background: `${C.red}10`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '10px 14px', fontSize: 13, color: C.red }}>{errMsg}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: C.muted }}>Backups are stored in the server's <code style={{ fontSize: 12, color: C.blue, fontFamily: 'monospace' }}>backups/</code> directory.</div>
        <button
          onClick={runBackup} disabled={running}
          style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, border: `1px solid ${C.blue}55`, background: `${C.blue}18`, color: C.blue, cursor: running ? 'default' : 'pointer', opacity: running ? 0.6 : 1 }}
        >{running ? 'Running…' : 'Run Backup Now'}</button>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {backups === null
          ? <EmptyState message="Loading…" />
          : backups.length === 0
            ? <EmptyState message="No backups yet" />
            : backups.map((b, i) => (
              <div
                key={b.id}
                onMouseEnter={() => setHov(i)}
                onMouseLeave={() => setHov(null)}
                style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: i < backups.length - 1 ? `1px solid ${C.borderLight}` : 'none', background: hov === i ? C.surface2 : 'transparent', transition: 'background 150ms' }}
              >
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, marginRight: 12, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: C.text, fontFamily: "'JetBrains Mono', monospace" }}>{b.name}</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{formatBytes(b.size)} · {formatRelTime(b.createdAt)}</div>
                </div>
                {hov === i && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => restoreBackup(b.id)}
                      style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.amber}55`, background: `${C.amber}12`, color: C.amber, cursor: 'pointer' }}
                    >Restore</button>
                    <a
                      href={apiUrl(`/servers/${serverId}/backups/${b.id}/download`)}
                      download
                      style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer', textDecoration: 'none' }}
                    >Download</a>
                    <button
                      onClick={() => deleteBackup(b.id)}
                      style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.red}44`, background: 'transparent', color: C.red, cursor: 'pointer' }}
                    >Delete</button>
                  </div>
                )}
              </div>
            ))
        }
      </div>
    </div>
  );
}

// ─── TabMetrics ───────────────────────────────────────────────────────────────
function parseRamMB(ramStr) {
  if (!ramStr) return null;
  const m = ramStr.match(/^(\d+(?:\.\d+)?)\s*([GMgm]?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2].toUpperCase() === 'G' ? Math.round(n * 1024) : Math.round(n);
}

function TabMetrics({ serverId, server }) {
  const [snapshot, setSnapshot] = React.useState(null);

  React.useEffect(() => {
    function load() {
      apiFetch(`/metrics/${serverId}`)
        .then(res => setSnapshot(res.data))
        .catch(() => {});
    }
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [serverId]);

  if (!snapshot) return <EmptyState message="Loading metrics…" />;

  const tps     = snapshot.minecraft?.tps;
  const proc    = snapshot.process;
  const players = snapshot.minecraft?.players;
  const disk    = snapshot.disk;

  function Gauge({ label, value, max, unit, color, sub }) {
    const pct = (value != null && max) ? Math.min(100, Math.round((value / max) * 100)) : 0;
    const displayVal = value != null ? `${value}${unit}` : '—';
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>{label}</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: value != null ? color : C.dim, fontVariantNumeric: 'tabular-nums' }}>{displayVal}</span>
        </div>
        <div style={{ height: 4, background: C.surface2, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: value != null ? color : C.surface2, borderRadius: 2, transition: 'width 600ms ease' }} />
        </div>
        {sub && <div style={{ fontSize: 11, color: C.dim }}>{sub}</div>}
      </div>
    );
  }

  const tpsVal   = tps?.available ? tps.m1?.toFixed(1) : null;
  const ramMB    = proc?.ram != null ? Math.round(proc.ram / 1024 / 1024) : null;
  const allocMB  = parseRamMB(server?.ram);
  const ramMax   = allocMB ?? 4096;
  const ramSub   = ramMB != null && allocMB != null
    ? `${ramMB} MB / ${allocMB} MB allocated`
    : allocMB != null ? `${allocMB} MB allocated` : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <Gauge label="TPS"     value={tpsVal}                 max={20}    unit=""   color={tpsVal >= 18 ? C.green : C.amber} />
        <Gauge label="CPU"     value={proc?.cpu?.toFixed(1)}  max={100}   unit="%" color={(proc?.cpu || 0) < 60 ? C.green : (proc?.cpu || 0) < 80 ? C.amber : C.red} />
        <Gauge label="RAM"     value={ramMB ?? (allocMB != null ? 0 : null)} max={ramMax} unit="MB" color={C.blue} sub={ramSub} />
        <Gauge label="Players" value={players?.online}        max={players?.max || 20} unit="" color={C.purple} sub={players ? `${players.online} / ${players.max || 20} players` : null} />
      </div>
      {disk && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', display: 'flex', gap: 24 }}>
          <div>
            <div style={{ fontSize: 11, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Total Size</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{formatBytes(disk.root)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Backups</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{formatBytes(disk.backups)}</div>
          </div>
          {Object.entries(disk.worlds || {}).map(([name, size]) => (
            <div key={name}>
              <div style={{ fontSize: 11, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{name}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{formatBytes(size)}</div>
            </div>
          ))}
        </div>
      )}

      <PrometheusSection serverId={serverId} />
    </div>
  );
}

function PrometheusSection({ serverId }) {
  const endpoint = `/api/metrics/${serverId}`;
  const [copied, setCopied] = React.useState(false);
  function copy() {
    navigator.clipboard.writeText(window.location.origin + endpoint).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Prometheus / Open-Metrics</div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Scrape Endpoint</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <code style={{ flex: 1, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 5, padding: '8px 12px', fontSize: 12, color: C.blue, fontFamily: "'JetBrains Mono', monospace" }}>
            {window.location.origin}{endpoint}
          </code>
          <button
            onClick={copy}
            style={{ fontSize: 11, fontWeight: 600, padding: '7px 12px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.surface2, color: copied ? C.green : C.muted, cursor: 'pointer', flexShrink: 0, transition: 'color 150ms' }}
          >{copied ? 'Copied!' : 'Copy'}</button>
        </div>
        <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
          Add this endpoint to your <code style={{ fontFamily: 'monospace', color: C.muted }}>prometheus.yml</code> scrape_configs. Metrics are updated every 15 seconds.
        </div>
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Exported Metrics</div>
        {[
          ['yams_server_tps',             'gauge',   'Ticks per second (1m avg)'],
          ['yams_server_players',         'gauge',   'Connected players'],
          ['yams_server_memory_bytes',    'gauge',   'JVM heap usage in bytes'],
          ['yams_server_cpu_percent',     'gauge',   'CPU usage percentage'],
          ['yams_server_uptime_seconds',  'counter', 'Server uptime in seconds'],
          ['yams_server_chunks_loaded',   'gauge',   'Loaded chunk count'],
        ].map(([name, type, desc]) => (
          <div key={name} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '5px 0', borderBottom: `1px solid ${C.borderLight}` }}>
            <code style={{ fontSize: 11, color: C.blue, fontFamily: "'JetBrains Mono', monospace", minWidth: 240 }}>{name}</code>
            <span style={{ fontSize: 10, color: C.purple, fontFamily: "'JetBrains Mono', monospace", minWidth: 60 }}>{type}</span>
            <span style={{ fontSize: 11, color: C.dim }}>{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Scheduler task metadata ─────────────────────────────────────────────────
const TASK_TYPES = [
  { val: 'command', label: 'Console Command', color: () => C.blue },
  { val: 'backup',  label: 'Backup Server',   color: () => C.amber },
  { val: 'restart', label: 'Auto-Restart',    color: () => C.red },
  { val: 'alert',   label: 'Metric Alert',    color: () => C.purple },
];
function taskColor(type) {
  return TASK_TYPES.find(t => t.val === type)?.color() ?? C.blue;
}
function taskLabel(type) {
  return TASK_TYPES.find(t => t.val === type)?.label ?? 'Command';
}

// ─── Template picker ─────────────────────────────────────────────────────────
const TEMPLATES = [
  { category: 'Maintenance', name: 'Daily Backup (keep 7)',  type: 'backup',  cron: '0 3 * * *',   command: '', config: { keep_last: 7 } },
  { category: 'Maintenance', name: 'Weekly Backup (keep 4)', type: 'backup',  cron: '0 3 * * 0',   command: '', config: { keep_last: 4 } },
  { category: 'Maintenance', name: 'Nightly Restart',        type: 'restart', cron: '0 4 * * *',   command: '', config: { warn_minutes: 5 } },
  { category: 'Maintenance', name: 'Save World',             type: 'command', cron: '*/30 * * * *', command: 'save-all', config: {} },
  { category: 'World',       name: 'Clear Weather',          type: 'command', cron: '0 */6 * * *',  command: 'weather clear', config: {} },
  { category: 'World',       name: 'Set Daytime',            type: 'command', cron: '0 8 * * *',    command: 'time set 6000', config: {} },
  { category: 'World',       name: 'Kill Ground Items',      type: 'command', cron: '0 */2 * * *',  command: 'kill @e[type=item]', config: {} },
  { category: 'Players',     name: 'Hourly Announcement',    type: 'command', cron: '0 * * * *',    command: 'say Welcome! Check the rules.', config: {} },
  { category: 'Monitoring',  name: 'TPS Alert (< 17)',       type: 'alert',   cron: '*/5 * * * *',  command: '', config: { metric: 'tps', threshold: 17, operator: 'lt' } },
  { category: 'Monitoring',  name: 'RAM Alert (> 80%)',      type: 'alert',   cron: '*/5 * * * *',  command: '', config: { metric: 'ram', threshold: 80, operator: 'gt' } },
];

function TemplatePickerModal({ onClose, onPick }) {
  const categories = [...new Set(TEMPLATES.map(t => t.category))];
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 510, background: '#00000077', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 480, maxHeight: '80vh', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px #00000066', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Choose a template</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {categories.map(cat => (
            <div key={cat}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{cat}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {TEMPLATES.filter(t => t.category === cat).map((t, i) => (
                  <button key={i} type="button" onClick={() => onPick(t)} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 7,
                    border: `1px solid ${C.border}`, background: C.surface2, cursor: 'pointer', textAlign: 'left',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = taskColor(t.type); e.currentTarget.style.background = `${taskColor(t.type)}0d`; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.surface2; }}
                  >
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, flexShrink: 0,
                      background: `${taskColor(t.type)}18`, color: taskColor(t.type),
                      border: `1px solid ${taskColor(t.type)}33`, textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}>{taskLabel(t.type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: C.dim, fontFamily: "'JetBrains Mono', monospace", marginTop: 1 }}>{t.cron}{t.command ? ` — ${t.command}` : ''}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ScheduleModal ────────────────────────────────────────────────────────────
function ScheduleModal({ schedule, onClose, onSave, serverId }) {
  const initConfig = schedule?.config ?? {};
  const [name,         setName]        = React.useState(schedule?.name    ?? '');
  const [type,         setType]        = React.useState(schedule?.type    ?? 'command');
  const [cron,         setCron]        = React.useState(schedule?.cron    ?? '');
  const [command,      setCommand]     = React.useState(schedule?.command ?? '');
  const [keepLast,     setKeepLast]    = React.useState(initConfig.keep_last   ?? '');
  const [warnMin,      setWarnMin]     = React.useState(initConfig.warn_minutes ?? 0);
  const [alertMetric,  setAlertMetric] = React.useState(initConfig.metric      ?? 'tps');
  const [alertOp,      setAlertOp]     = React.useState(initConfig.operator    ?? 'lt');
  const [alertThr,     setAlertThr]    = React.useState(initConfig.threshold   ?? 17);
  const [webhookIds,   setWebhookIds]  = React.useState(initConfig.webhook_ids ?? []);
  const [allWebhooks,  setAllWebhooks] = React.useState(null); // null = not loaded yet
  const [enabled,      setEnabled]     = React.useState(schedule ? !!schedule.enabled : true);
  const [loading,      setLoading]     = React.useState(false);
  const [error,        setError]       = React.useState(null);

  // Fetch webhooks once when alert type is active
  React.useEffect(() => {
    if (type !== 'alert' || allWebhooks !== null) return;
    apiFetch(`/servers/${serverId}/webhooks`)
      .then(r => setAllWebhooks(r.data || []))
      .catch(() => setAllWebhooks([]));
  }, [type, serverId, allWebhooks]);

  function toggleWebhookId(id) {
    setWebhookIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  }

  function buildConfig() {
    if (type === 'backup')  return keepLast !== '' ? { keep_last: Number(keepLast) } : {};
    if (type === 'restart') return { warn_minutes: Number(warnMin) };
    if (type === 'alert') {
      const cfg = { metric: alertMetric, operator: alertOp, threshold: Number(alertThr) };
      if (webhookIds.length > 0) cfg.webhook_ids = webhookIds;
      return cfg;
    }
    return {};
  }

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setError(null);
    const err = await onSave(
      { name: name.trim(), type, cron: cron.trim(), command: command.trim(), config: buildConfig(), enabled },
      schedule?.id ?? null,
    );
    if (err) { setError(err); setLoading(false); }
  }

  const noCmd = new Set(['backup', 'restart', 'alert']);
  const inp  = { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontSize: 13, color: C.text, outline: 'none', width: '100%' };
  const mono = { ...inp, fontFamily: "'JetBrains Mono', monospace" };
  const sel  = { ...inp, cursor: 'pointer', appearance: 'auto' };
  const disabled = loading || !name.trim() || !cron.trim() || (type === 'command' && !command.trim());
  const activeColor = taskColor(type);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: '#00000077', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 480, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px #00000066' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{schedule ? 'Edit Task' : 'New Scheduled Task'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <form onSubmit={submit} style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: C.red }}>{error}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Task name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Daily Restart" autoFocus style={inp}
              onFocus={e => { e.target.style.borderColor = C.blue; }} onBlur={e => { e.target.style.borderColor = C.border; }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Task type</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {TASK_TYPES.map(({ val, label, color }) => (
                <button key={val} type="button" onClick={() => setType(val)} style={{
                  padding: '8px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  border: `1px solid ${type === val ? color() : C.border}`,
                  background: type === val ? `${color()}15` : 'transparent',
                  color: type === val ? color() : C.muted,
                  transition: 'all 120ms', textAlign: 'center',
                }}>{label}</button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Cron expression</label>
            <input value={cron} onChange={e => setCron(e.target.value)} placeholder="minute hour dom month dow" style={mono}
              onFocus={e => { e.target.style.borderColor = C.blue; }} onBlur={e => { e.target.style.borderColor = C.border; }} />
            <div style={{ fontSize: 11, color: C.dim }}>
              e.g. <span style={{ fontFamily: 'monospace' }}>0 4 * * *</span> (4am daily) · <span style={{ fontFamily: 'monospace' }}>*/30 * * * *</span> (every 30min) · <span style={{ fontFamily: 'monospace' }}>0 * * * *</span> (hourly)
            </div>
          </div>

          {type === 'command' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Command</label>
              <input value={command} onChange={e => setCommand(e.target.value)} placeholder="save-all" style={mono}
                onFocus={e => { e.target.style.borderColor = C.blue; }} onBlur={e => { e.target.style.borderColor = C.border; }} />
              <div style={{ fontSize: 11, color: C.dim }}>Minecraft console command (no leading /)</div>
            </div>
          )}

          {type === 'backup' && (
            <div style={{ background: `${activeColor}0d`, border: `1px solid ${activeColor}33`, borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: activeColor, lineHeight: 1.5 }}>
                Creates a full zip backup of the server folder. The server can be running — the backup runs in the background.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>Keep last</label>
                <NumberInput min={1} value={keepLast} onChange={e => setKeepLast(e.target.value)} placeholder="all" style={{ width: 72 }} />
                <span style={{ fontSize: 12, color: C.muted }}>backups (blank = keep all)</span>
              </div>
            </div>
          )}

          {type === 'restart' && (
            <div style={{ background: `${activeColor}0d`, border: `1px solid ${activeColor}33`, borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: activeColor, lineHeight: 1.5 }}>
                Sends a warning to players, then stops and restarts the server.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>Warn players</label>
                <NumberInput min={0} value={warnMin} onChange={e => setWarnMin(e.target.value)} style={{ width: 60 }} />
                <span style={{ fontSize: 12, color: C.muted }}>minutes before restart (0 = no warning)</span>
              </div>
            </div>
          )}

          {type === 'alert' && (
            <div style={{ background: `${activeColor}0d`, border: `1px solid ${activeColor}33`, borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: C.muted }}>If</span>
                <select value={alertMetric} onChange={e => setAlertMetric(e.target.value)} style={{ ...sel, width: 70 }}>
                  <option value="tps">TPS</option>
                  <option value="ram">RAM</option>
                </select>
                <span style={{ fontSize: 12, color: C.muted }}>is</span>
                <select value={alertOp} onChange={e => setAlertOp(e.target.value)} style={{ ...sel, width: 80 }}>
                  <option value="lt">Below</option>
                  <option value="gt">Above</option>
                </select>
                <NumberInput value={alertThr} onChange={e => setAlertThr(e.target.value)} style={{ width: 70 }} />
                <span style={{ fontSize: 12, color: C.muted }}>{alertMetric === 'ram' ? 'MB' : ''}</span>
              </div>
              <div style={{ borderTop: `1px solid ${activeColor}22`, paddingTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Fire webhooks
                </div>
                {allWebhooks === null ? (
                  <div style={{ fontSize: 12, color: C.dim }}>Loading webhooks…</div>
                ) : allWebhooks.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.dim }}>No webhooks configured for this server.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {allWebhooks.map(wh => (
                      <label key={wh.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={webhookIds.includes(wh.id)} onChange={() => toggleWebhookId(wh.id)}
                          style={{ accentColor: activeColor, width: 14, height: 14, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: wh.enabled ? C.text : C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {wh.url}
                        </span>
                        {!wh.enabled && <span style={{ fontSize: 10, color: C.dim, flexShrink: 0 }}>disabled</span>}
                      </label>
                    ))}
                    <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                      {webhookIds.length === 0 ? 'No selection — all webhooks subscribed to server.alert will fire.' : `${webhookIds.length} webhook(s) selected.`}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle value={enabled} onChange={setEnabled} />
            <span style={{ fontSize: 12, color: C.muted }}>Enabled</span>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button type="button" onClick={onClose} style={{ fontSize: 13, padding: '7px 14px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={disabled} style={{ fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 6, border: `1px solid ${activeColor}55`, background: `${activeColor}18`, color: activeColor, cursor: disabled ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Saving…' : (schedule ? 'Save changes' : 'Create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── TabScheduler ─────────────────────────────────────────────────────────────
function TabScheduler({ serverId }) {
  const [schedules,  setSchedules]  = React.useState([]);
  const [loading,    setLoading]    = React.useState(true);
  const [apiError,   setApiError]   = React.useState(null);
  const [modal,      setModal]      = React.useState(null);    // null | 'new' | schedule object
  const [showTpls,   setShowTpls]   = React.useState(false);  // template picker visible

  React.useEffect(() => {
    apiFetch(`/servers/${serverId}/schedules`)
      .then(r => { setSchedules(r.data || []); setLoading(false); })
      .catch(e => { setApiError(e.message); setLoading(false); });
  }, [serverId]);

  async function handleToggle(s) {
    const prev = s.enabled;
    setSchedules(list => list.map(x => x.id === s.id ? { ...x, enabled: prev ? 0 : 1 } : x));
    try {
      const res = await apiFetch(`/servers/${serverId}/schedules/${s.id}`, {
        method: 'PATCH', body: JSON.stringify({ enabled: !prev }),
      });
      setSchedules(list => list.map(x => x.id === s.id ? res.data : x));
    } catch (err) {
      setSchedules(list => list.map(x => x.id === s.id ? { ...x, enabled: prev } : x));
      setApiError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this scheduled task?')) return;
    try {
      await apiFetch(`/servers/${serverId}/schedules/${id}`, { method: 'DELETE' });
      setSchedules(list => list.filter(x => x.id !== id));
    } catch (err) {
      setApiError(err.message);
    }
  }

  async function handleSave(fields, scheduleId) {
    try {
      if (scheduleId) {
        const res = await apiFetch(`/servers/${serverId}/schedules/${scheduleId}`, {
          method: 'PATCH', body: JSON.stringify(fields),
        });
        setSchedules(list => list.map(x => x.id === scheduleId ? res.data : x));
      } else {
        const res = await apiFetch(`/servers/${serverId}/schedules`, {
          method: 'POST', body: JSON.stringify(fields),
        });
        setSchedules(list => [...list, res.data]);
      }
      setModal(null);
    } catch (err) {
      return err.message;
    }
  }

  function pickTemplate(tpl) {
    setShowTpls(false);
    setModal({ ...tpl, id: null }); // open task modal pre-filled, no id = create
  }

  const btnBase = { fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface2, color: C.text, cursor: 'pointer' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {modal !== null && (
        <ScheduleModal
          schedule={modal === 'new' || modal?.id === null ? (modal === 'new' ? null : modal) : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
          serverId={serverId}
        />
      )}
      {showTpls && (
        <TemplatePickerModal onClose={() => setShowTpls(false)} onPick={pickTemplate} />
      )}

      {apiError && (
        <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '8px 14px', fontSize: 12, color: C.red }}>
          {apiError}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={() => setShowTpls(true)} style={{ ...btnBase, color: C.muted }}>From template</button>
        <button onClick={() => setModal('new')} style={{ ...btnBase, borderColor: C.blue, color: C.blue, background: `${C.blue}10` }}>+ New Task</button>
      </div>

      {loading
        ? <EmptyState message="Loading schedules…" />
        : schedules.length === 0
          ? <EmptyState message="No scheduled tasks yet. Use a template or create a new task." />
          : (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
              {schedules.map((s, i) => {
                const type = s.type || 'command';
                const color = taskColor(type);
                const cfg = s.config || {};
                let subtitle = s.cron;
                if (type === 'command' && s.command) subtitle += ` — ${s.command}`;
                if (type === 'backup' && cfg.keep_last) subtitle += ` — keep last ${cfg.keep_last}`;
                if (type === 'restart' && cfg.warn_minutes) subtitle += ` — warn ${cfg.warn_minutes}min`;
                if (type === 'alert') subtitle += ` — ${cfg.metric} ${cfg.operator === 'lt' ? '<' : '>'} ${cfg.threshold}`;
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderBottom: i < schedules.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                    <Toggle value={!!s.enabled} onChange={() => handleToggle(s)} />
                    <div style={{ flex: 1, cursor: 'pointer', minWidth: 0 }} onClick={() => setModal(s)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: s.enabled ? C.text : C.muted }}>{s.name}</span>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                          background: `${color}18`, color, border: `1px solid ${color}33`,
                          textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0,
                        }}>{taskLabel(type)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: C.dim, fontFamily: "'JetBrains Mono', monospace", marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {subtitle}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: C.dim, whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {s.last_run_at ? formatRelTime(s.last_run_at) : 'Never run'}
                    </div>
                    <button onClick={() => handleDelete(s.id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: `1px solid ${C.red}44`, background: 'transparent', color: C.red, cursor: 'pointer', flexShrink: 0 }}>Delete</button>
                  </div>
                );
              })}
            </div>
          )
      }
    </div>
  );
}

// ─── WebhookModal ─────────────────────────────────────────────────────────────
const ALL_EVENTS = ['server.start', 'server.stop', 'server.crash', 'server.alert'];

function WebhookModal({ hook, onClose, onSave }) {
  const [url,     setUrl]     = React.useState(hook?.url     ?? '');
  const [events,  setEvents]  = React.useState(hook?.events  ?? [...ALL_EVENTS]);
  const [secret,  setSecret]  = React.useState(hook?.secret  ?? '');
  const [enabled, setEnabled] = React.useState(hook ? !!hook.enabled : true);
  const [loading, setLoading] = React.useState(false);
  const [error,   setError]   = React.useState(null);

  function toggleEvent(ev) {
    setEvents(prev => prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]);
  }

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setError(null);
    const err = await onSave(
      { url: url.trim(), events, secret: secret.trim() || null, enabled },
      hook?.id ?? null,
    );
    if (err) { setError(err); setLoading(false); }
  }

  const inp = { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontSize: 13, color: C.text, outline: 'none', width: '100%' };
  const disabled = loading || !url.trim() || events.length === 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: '#00000077', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 440, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px #00000066' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{hook ? 'Edit Webhook' : 'Add Webhook'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <form onSubmit={submit} style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: C.red }}>{error}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>URL</label>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" autoFocus style={inp}
              onFocus={e => { e.target.style.borderColor = C.blue; }} onBlur={e => { e.target.style.borderColor = C.border; }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Events</label>
            {ALL_EVENTS.map(ev => (
              <label key={ev} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={events.includes(ev)} onChange={() => toggleEvent(ev)}
                  style={{ accentColor: C.blue, width: 14, height: 14 }} />
                <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: C.text }}>{ev}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Secret <span style={{ color: C.dim, fontWeight: 400 }}>(optional)</span></label>
            <input value={secret} onChange={e => setSecret(e.target.value)} placeholder="Used to sign requests with X-YAMS-Signature" style={inp}
              onFocus={e => { e.target.style.borderColor = C.blue; }} onBlur={e => { e.target.style.borderColor = C.border; }} />
            <div style={{ fontSize: 11, color: C.dim }}>If set, each request includes <span style={{ fontFamily: 'monospace' }}>X-YAMS-Signature: sha256=…</span></div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle value={enabled} onChange={setEnabled} />
            <span style={{ fontSize: 12, color: C.muted }}>Enabled</span>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button type="button" onClick={onClose} style={{ fontSize: 13, padding: '7px 14px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={disabled} style={{ fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 6, border: `1px solid ${C.green}55`, background: `${C.green}18`, color: C.green, cursor: disabled ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Saving…' : (hook ? 'Save changes' : 'Add Webhook')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── TabMods ──────────────────────────────────────────────────────────────────
const ENV_BADGE = {
  required:    { label: 'Server ✓', color: C.green  },
  optional:    { label: 'Optional',  color: C.amber  },
  unsupported: { label: 'Client only', color: C.red  },
};

function TabMods({ serverId, server }) {
  const [mods,        setMods]        = React.useState(null);
  const [scanData,    setScanData]    = React.useState(null);
  const [scanning,    setScanning]    = React.useState(false);
  const [pruning,     setPruning]     = React.useState(false);
  const [busyFiles,   setBusyFiles]   = React.useState(new Set());
  const [searchQuery, setSearchQuery] = React.useState('');
  const [results,     setResults]     = React.useState(null);
  const [searching,   setSearching]   = React.useState(false);
  const [expanded,    setExpanded]    = React.useState(null);   // projectId with open version list
  const [versions,    setVersions]    = React.useState({});     // projectId → []
  const [versLoading, setVersLoading] = React.useState(new Set());
  const [installing,  setInstalling]  = React.useState(new Set());
  const [uploading,   setUploading]   = React.useState(false);
  const [error,       setError]       = React.useState(null);
  const [success,     setSuccess]     = React.useState(null);
  const fileRef = React.useRef(null);

  React.useEffect(() => { loadMods(); }, [serverId]);

  async function loadMods() {
    try { const r = await apiFetch(`/servers/${serverId}/mods`); setMods(r.data || []); }
    catch (e) { setError(e.message); }
  }

  function flash(msg) { setSuccess(msg); setTimeout(() => setSuccess(null), 4000); }

  async function scan() {
    setScanning(true); setError(null);
    try { const r = await apiFetch(`/servers/${serverId}/mods/scan`, { method: 'POST' }); setScanData(r.data); }
    catch (e) { setError(e.message); }
    finally { setScanning(false); }
  }

  const clientOnlyNames = scanData
    ? Object.entries(scanData).filter(([, v]) => v.identified && v.serverSide === 'unsupported').map(([n]) => n)
    : [];

  async function prune() {
    if (!clientOnlyNames.length) return;
    setPruning(true); setError(null);
    try {
      await apiFetch(`/servers/${serverId}/mods/prune`, { method: 'POST', body: JSON.stringify({ filenames: clientOnlyNames }) });
      flash(`Removed ${clientOnlyNames.length} client-only mod(s)`);
      setScanData(null); await loadMods();
    } catch (e) { setError(e.message); }
    finally { setPruning(false); }
  }

  async function toggleMod(filename, enabled) {
    setBusyFiles(s => new Set([...s, filename]));
    try {
      const r = await apiFetch(`/servers/${serverId}/mods/${encodeURIComponent(filename)}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
      setMods(prev => prev.map(m => m.filename === filename ? r.data : m));
      if (scanData && scanData[filename]) {
        const next = { ...scanData }; delete next[filename]; next[r.data.filename] = scanData[filename]; setScanData(next);
      }
    } catch (e) { setError(e.message); }
    finally { setBusyFiles(s => { const n = new Set(s); n.delete(filename); return n; }); }
  }

  async function deleteMod(filename) {
    setBusyFiles(s => new Set([...s, filename]));
    try {
      await apiFetch(`/servers/${serverId}/mods/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      setMods(prev => prev.filter(m => m.filename !== filename));
      if (scanData) { const next = { ...scanData }; delete next[filename]; setScanData(next); }
    } catch (e) { setError(e.message); }
    finally { setBusyFiles(s => { const n = new Set(s); n.delete(filename); return n; }); }
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true); setResults(null); setExpanded(null); setError(null);
    try { const r = await apiFetch(`/servers/${serverId}/mods/search?q=${encodeURIComponent(searchQuery.trim())}`); setResults(r.data || []); }
    catch (e) { setError(e.message); }
    finally { setSearching(false); }
  }

  async function loadVersions(projectId) {
    if (expanded === projectId) { setExpanded(null); return; }
    setExpanded(projectId);
    if (versions[projectId]) return;
    setVersLoading(s => new Set([...s, projectId]));
    try {
      const r = await apiFetch(`/servers/${serverId}/mods/${encodeURIComponent(projectId)}/versions`);
      setVersions(v => ({ ...v, [projectId]: r.data || [] }));
    } catch (e) { setError(e.message); }
    finally { setVersLoading(s => { const n = new Set(s); n.delete(projectId); return n; }); }
  }

  async function installVersion(versionId, versionNumber) {
    setInstalling(s => new Set([...s, versionId])); setError(null);
    try {
      const r = await apiFetch(`/servers/${serverId}/mods/install`, { method: 'POST', body: JSON.stringify({ versionId }) });
      flash(`Installed ${r.data.filename}`); setExpanded(null); await loadMods();
    } catch (e) { setError(e.message); }
    finally { setInstalling(s => { const n = new Set(s); n.delete(versionId); return n; }); }
  }

  async function handleUpload(file) {
    if (!file) return;
    if (!file.name.endsWith('.jar')) { setError('Only .jar files can be uploaded'); return; }
    setUploading(true); setError(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const body = await apiFetch(`/servers/${serverId}/mods/upload`, { method: 'POST', body: fd });
      flash(`Uploaded ${body.data?.filename}`); await loadMods();
    } catch (e) { setError(e.message); }
    finally { setUploading(false); }
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  const card   = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16 };
  const secLbl = { fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 };
  const inp    = { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, fontSize: 13, padding: '6px 10px', outline: 'none' };
  const btn    = (bg, fg = '#fff') => ({ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 5, border: 'none', background: bg, color: fg, cursor: 'pointer' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {error   && <div style={{ background:`${C.red}14`, border:`1px solid ${C.red}44`, borderRadius:6, padding:'8px 14px', fontSize:13, color:C.red }}>{error}</div>}
      {success && <div style={{ background:`${C.green}14`, border:`1px solid ${C.green}44`, borderRadius:6, padding:'8px 14px', fontSize:13, color:C.green }}>{success}</div>}

      {/* ── Installed mods ── */}
      <div style={card}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
          <div style={secLbl}>Installed Mods{mods ? ` (${mods.length})` : ''}</div>
          <div style={{ display:'flex', gap:8 }}>
            <button style={btn(C.surface2, C.muted)} onClick={scan} disabled={scanning}>
              {scanning ? 'Scanning…' : 'Scan'}
            </button>
            <button style={btn(C.surface2, C.muted)} onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : '↑ Upload'}
            </button>
            <input ref={fileRef} type="file" accept=".jar" style={{ display:'none' }} onChange={e => { handleUpload(e.target.files[0]); e.target.value=''; }} />
          </div>
        </div>

        {clientOnlyNames.length > 0 && (
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', background:`${C.red}12`, border:`1px solid ${C.red}33`, borderRadius:6, padding:'9px 12px', marginBottom:10 }}>
            <span style={{ fontSize:13, color:C.red, fontWeight:500 }}>
              {clientOnlyNames.length} client-only mod{clientOnlyNames.length > 1 ? 's' : ''} detected — may prevent server from starting
            </span>
            <button style={btn(C.red)} onClick={prune} disabled={pruning}>
              {pruning ? 'Removing…' : `Remove ${clientOnlyNames.length}`}
            </button>
          </div>
        )}

        {mods === null && <div style={{ color:C.muted, fontSize:13 }}>Loading…</div>}
        {mods?.length === 0 && <div style={{ color:C.muted, fontSize:13 }}>No mods installed</div>}
        {mods?.map(mod => {
          const info = scanData?.[mod.filename];
          const envBadge = info?.identified && info.serverSide ? ENV_BADGE[info.serverSide] : null;
          const busy = busyFiles.has(mod.filename);
          return (
            <div key={mod.filename} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 0', borderBottom:`1px solid ${C.borderLight}` }}>
              <div style={{ width:8, height:8, borderRadius:'50%', background: mod.enabled ? C.green : C.dim, flexShrink:0 }} />
              <span style={{ flex:1, fontSize:12, color: mod.enabled ? C.text : C.dim, fontFamily:'monospace', wordBreak:'break-all' }}>{mod.filename}</span>
              {info && !info.identified && <span style={{ fontSize:10, color:C.dim, flexShrink:0 }}>Unknown</span>}
              {envBadge && <span style={{ fontSize:10, fontWeight:600, color:envBadge.color, flexShrink:0, padding:'2px 6px', border:`1px solid ${envBadge.color}44`, borderRadius:4 }}>{envBadge.label}</span>}
              <button style={{ ...btn(C.surface2, C.muted), flexShrink:0 }} disabled={busy} onClick={() => toggleMod(mod.filename, !mod.enabled)}>
                {mod.enabled ? 'Disable' : 'Enable'}
              </button>
              <button style={{ ...btn(`${C.red}22`, C.red), flexShrink:0 }} disabled={busy} onClick={() => deleteMod(mod.filename)}>Delete</button>
            </div>
          );
        })}
      </div>

      {/* ── Search & Install ── */}
      <div style={card}>
        <div style={secLbl}>Search & Install{server?.engine ? ` · ${server.engine} ${server.version ?? ''}` : ''}</div>
        <form onSubmit={handleSearch} style={{ display:'flex', gap:8, marginBottom:12 }}>
          <input style={{ ...inp, flex:1 }} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search Modrinth for mods…" />
          <button type="submit" style={btn(C.blue)} disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
        </form>

        {results?.length === 0 && <div style={{ color:C.muted, fontSize:13 }}>No results found</div>}

        {results?.map(mod => (
          <div key={mod.projectId} style={{ marginBottom:4, border:`1px solid ${C.border}`, borderRadius:7, overflow:'hidden' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', cursor:'pointer', background: expanded === mod.projectId ? C.surface2 : 'transparent' }}
              onClick={() => loadVersions(mod.projectId)}>
              {mod.iconUrl && <img src={mod.iconUrl} alt="" style={{ width:32, height:32, borderRadius:4, objectFit:'cover', flexShrink:0 }} />}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:C.text }}>{mod.title}</div>
                <div style={{ fontSize:11, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{mod.description}</div>
              </div>
              {mod.serverSide && ENV_BADGE[mod.serverSide] && (
                <span style={{ fontSize:10, fontWeight:600, color:ENV_BADGE[mod.serverSide].color, flexShrink:0 }}>{ENV_BADGE[mod.serverSide].label}</span>
              )}
              <span style={{ color:C.muted, fontSize:12, flexShrink:0 }}>{expanded === mod.projectId ? '▲' : '▼'}</span>
            </div>

            {expanded === mod.projectId && (
              <div style={{ borderTop:`1px solid ${C.border}`, background:`${C.surface2}88`, padding:'8px 12px' }}>
                {versLoading.has(mod.projectId) && <div style={{ color:C.muted, fontSize:12 }}>Loading versions…</div>}
                {versions[mod.projectId]?.length === 0 && (
                  <div style={{ color:C.muted, fontSize:12 }}>No compatible versions found for {server?.engine} {server?.version}</div>
                )}
                {versions[mod.projectId]?.map(v => (
                  <div key={v.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderBottom:`1px solid ${C.borderLight}` }}>
                    <span style={{ fontSize:12, color:C.text, fontWeight:500 }}>{v.versionNumber}</span>
                    <span style={{ fontSize:11, color:C.dim, flex:1 }}>{v.gameVersions.slice(0,3).join(', ')}{v.gameVersions.length > 3 ? '…' : ''}</span>
                    <span style={{ fontSize:10, color:C.muted }}>{v.primaryFile?.filename}</span>
                    <button style={btn(C.blue)} disabled={installing.has(v.id)} onClick={() => installVersion(v.id, v.versionNumber)}>
                      {installing.has(v.id) ? '…' : 'Install'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Upload zone ── */}
      <div style={card}>
        <div style={secLbl}>Upload .jar</div>
        <div
          style={{ border:`2px dashed ${C.border}`, borderRadius:7, padding:'28px 0', textAlign:'center', cursor:'pointer', color:C.muted, fontSize:13 }}
          onClick={() => fileRef.current?.click()}
          onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files[0]); }}
          onDragOver={e => e.preventDefault()}
          onDragEnter={e => { e.preventDefault(); e.currentTarget.style.borderColor = C.blue; }}
          onDragLeave={e => { e.currentTarget.style.borderColor = C.border; }}
        >
          {uploading ? 'Uploading…' : 'Drop a .jar file here or click to browse'}
        </div>
      </div>
    </div>
  );
}

// ─── TabPlayers ───────────────────────────────────────────────────────────────
function TabPlayers({ serverId }) {
  const [players,    setPlayers]    = React.useState(null);
  const [selected,   setSelected]   = React.useState(null);
  const [form,       setForm]       = React.useState(null);
  const [saving,     setSaving]     = React.useState(false);
  const [listErr,    setListErr]    = React.useState(null);
  const [dataErr,    setDataErr]    = React.useState(null);
  const [successMsg, setSuccessMsg] = React.useState(null);

  React.useEffect(() => {
    apiFetch(`/servers/${serverId}/players`)
      .then(r => setPlayers(r.data || []))
      .catch(e => setListErr(e.message));
  }, [serverId]);

  async function selectPlayer(player) {
    setSelected(player);
    setForm(null);
    setDataErr(null);
    setSuccessMsg(null);
    try {
      const r = await apiFetch(`/servers/${serverId}/players/${player.uuid}/data`);
      setForm({ ...r.data });
    } catch (e) { setDataErr(e.message); }
  }

  async function handleSave() {
    if (!selected || !form) return;
    setSaving(true);
    setDataErr(null);
    setSuccessMsg(null);
    try {
      const patch = {
        gamemode:   form.gamemode,
        health:     form.health,
        food:       form.food,
        xpLevel:    form.xpLevel,
        xpProgress: form.xpProgress,
        score:      form.score,
        pos:        form.pos,
      };
      if (form.dimensionEditable && form.dimension != null)
        patch.dimension = form.dimension;
      if (form.spawnX != null && form.spawnY != null && form.spawnZ != null)
        Object.assign(patch, { spawnX: form.spawnX, spawnY: form.spawnY, spawnZ: form.spawnZ });
      const r = await apiFetch(`/servers/${serverId}/players/${selected.uuid}/data`, {
        method: 'PATCH', body: JSON.stringify(patch),
      });
      setForm({ ...r.data });
      setSuccessMsg('Player data saved');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (e) { setDataErr(e.message); }
    finally { setSaving(false); }
  }

  function setField(key, val) { setForm(f => ({ ...f, [key]: val })); }
  function setPosField(key, val) { setForm(f => ({ ...f, pos: { ...f.pos, [key]: val } })); }

  const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 };
  const sectionLabel = { fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 };
  const fieldRow = { display: 'flex', flexDirection: 'column', gap: 4 };
  const fieldLabel = { fontSize: 12, color: C.muted };
  const input = { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, fontSize: 13, padding: '5px 10px', width: '100%', boxSizing: 'border-box' };
  const selectStyle = { ...input, cursor: 'pointer' };

  const displayName = p => p.name ?? `${p.uuid.slice(0, 8)}…`;

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      {/* Left sidebar — player list */}
      <div style={{ width: 220, flexShrink: 0, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.borderLight}`, ...sectionLabel }}>
          Players {players !== null ? `(${players.length})` : ''}
        </div>
        {listErr && (
          <div style={{ padding: '10px 12px', fontSize: 12, color: C.red }}>{listErr}</div>
        )}
        {players === null && !listErr && (
          <div style={{ padding: '10px 12px', fontSize: 12, color: C.muted }}>Loading…</div>
        )}
        {players !== null && players.length === 0 && (
          <div style={{ padding: '10px 12px', fontSize: 12, color: C.muted }}>No player data found</div>
        )}
        {players !== null && players.map(p => (
          <div key={p.uuid}
            onClick={() => selectPlayer(p)}
            style={{
              padding: '9px 12px',
              fontSize: 13,
              cursor: 'pointer',
              borderLeft: selected?.uuid === p.uuid ? `3px solid ${C.blue}` : '3px solid transparent',
              background: selected?.uuid === p.uuid ? C.surface2 : 'transparent',
              color: C.text,
              borderBottom: `1px solid ${C.borderLight}`,
              userSelect: 'none',
            }}
          >
            {displayName(p)}
            {!p.name && <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{p.uuid}</div>}
          </div>
        ))}
      </div>

      {/* Right panel — editor */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Reconnect warning — always shown when a player is selected */}
        {selected && (
          <div style={{ background: `${C.amber}14`, border: `1px solid ${C.amber}44`, borderRadius: 6, padding: '10px 14px', fontSize: 13, color: C.amber, fontWeight: 500 }}>
            Changes take effect after the player reconnects to the server.
          </div>
        )}

        {successMsg && (
          <div style={{ background: `${C.green}14`, border: `1px solid ${C.green}44`, borderRadius: 6, padding: '8px 14px', fontSize: 13, color: C.green }}>
            {successMsg}
          </div>
        )}
        {dataErr && (
          <div style={{ background: `${C.red}14`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '8px 14px', fontSize: 13, color: C.red }}>
            {dataErr}
          </div>
        )}

        {!selected && (
          <div style={{ color: C.muted, fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
            Select a player from the list to edit their data
          </div>
        )}

        {selected && !form && !dataErr && (
          <div style={{ color: C.muted, fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Loading…</div>
        )}

        {form && (
          <>
            {/* Game Stats */}
            <div style={card}>
              <div style={sectionLabel}>Game Stats</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={fieldRow}>
                  <label style={fieldLabel}>Gamemode</label>
                  <select style={selectStyle} value={form.gamemode} onChange={e => setField('gamemode', Number(e.target.value))}>
                    <option value={0}>Survival</option>
                    <option value={1}>Creative</option>
                    <option value={2}>Adventure</option>
                    <option value={3}>Spectator</option>
                  </select>
                </div>
                <div style={fieldRow}>
                  <label style={fieldLabel}>Health (0–20)</label>
                  <NumberInput style={{ width: '100%' }} min={0} max={20} step={0.5} value={form.health ?? ''} onChange={e => setField('health', parseFloat(e.target.value))} />
                </div>
                <div style={fieldRow}>
                  <label style={fieldLabel}>Food Level (0–20)</label>
                  <NumberInput style={{ width: '100%' }} min={0} max={20} step={1} value={form.food ?? ''} onChange={e => setField('food', parseInt(e.target.value, 10))} />
                </div>
                <div style={fieldRow}>
                  <label style={fieldLabel}>XP Level</label>
                  <NumberInput style={{ width: '100%' }} min={0} step={1} value={form.xpLevel ?? ''} onChange={e => setField('xpLevel', parseInt(e.target.value, 10))} />
                </div>
                <div style={fieldRow}>
                  <label style={fieldLabel}>XP Progress (0–1)</label>
                  <NumberInput style={{ width: '100%' }} min={0} max={1} step={0.01} value={form.xpProgress ?? ''} onChange={e => setField('xpProgress', parseFloat(e.target.value))} />
                </div>
                <div style={fieldRow}>
                  <label style={fieldLabel}>Score</label>
                  <NumberInput style={{ width: '100%' }} step={1} value={form.score ?? ''} onChange={e => setField('score', parseInt(e.target.value, 10))} />
                </div>
              </div>
            </div>

            {/* Location */}
            <div style={card}>
              <div style={sectionLabel}>Location</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['x', 'y', 'z'].map(axis => (
                  <div key={axis} style={{ ...fieldRow, flex: 1 }}>
                    <label style={fieldLabel}>{axis.toUpperCase()}</label>
                    <NumberInput style={{ width: '100%' }} step={0.01} value={form.pos?.[axis] ?? ''} onChange={e => setPosField(axis, parseFloat(e.target.value))} />
                  </div>
                ))}
              </div>
              <div style={fieldRow}>
                <label style={fieldLabel}>Dimension{!form.dimensionEditable ? ' (read-only)' : ''}</label>
                {form.dimensionEditable ? (
                  <input style={input} type="text" value={form.dimension ?? ''} onChange={e => setField('dimension', e.target.value)} />
                ) : (
                  <div style={{ ...input, color: C.muted, cursor: 'default' }}>{form.dimension ?? '—'}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                {['spawnX', 'spawnY', 'spawnZ'].map(key => (
                  <div key={key} style={{ ...fieldRow, flex: 1 }}>
                    <label style={fieldLabel}>Spawn {key.slice(-1).toUpperCase()}</label>
                    <NumberInput style={{ width: '100%' }} step={1}
                      value={form[key] ?? ''}
                      placeholder="not set"
                      onChange={e => {
                        const val = e.target.value === '' ? null : parseInt(e.target.value, 10);
                        setField(key, val);
                      }}
                    />
                  </div>
                ))}
              </div>
              {form.spawnX == null && <div style={{ fontSize: 11, color: C.dim }}>No spawn point set (player uses world spawn). Fill all three to set one.</div>}
            </div>

            {/* Inventory — read-only */}
            <div style={card}>
              <div style={sectionLabel}>Inventory (read-only)</div>
              {form.inventory.length === 0 ? (
                <div style={{ fontSize: 13, color: C.muted }}>Empty inventory</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 56px', gap: '4px 12px', fontSize: 11, fontWeight: 700, color: C.muted, padding: '0 4px', marginBottom: 4 }}>
                    <span>Slot</span><span>Item ID</span><span>Count</span>
                  </div>
                  {form.inventory.sort((a, b) => (a.slot ?? 999) - (b.slot ?? 999)).map((item, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 56px', gap: '4px 12px', fontSize: 12, padding: '3px 4px', background: i % 2 === 0 ? 'transparent' : `${C.surface2}88` }}>
                      <span style={{ color: C.dim, fontVariantNumeric: 'tabular-nums' }}>{item.slot ?? '—'}</span>
                      <span style={{ color: C.text, fontFamily: 'monospace', fontSize: 11 }}>{item.id ?? '—'}</span>
                      <span style={{ color: C.muted }}>{item.count ?? '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Save button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ fontSize: 13, fontWeight: 600, padding: '8px 20px', borderRadius: 6, border: 'none', background: saving ? C.dim : C.blue, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer' }}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── TabWebhooks ──────────────────────────────────────────────────────────────
function TabWebhooks({ serverId }) {
  const [hooks,    setHooks]   = React.useState([]);
  const [loading,  setLoading] = React.useState(true);
  const [apiError, setApiError]= React.useState(null);
  const [modal,    setModal]   = React.useState(null); // null | 'new' | hook object
  const [testing,  setTesting] = React.useState(null); // webhookId being tested
  const [testMsg,  setTestMsg] = React.useState(null); // { id, ok, text }

  React.useEffect(() => {
    apiFetch(`/servers/${serverId}/webhooks`)
      .then(r => { setHooks(r.data || []); setLoading(false); })
      .catch(e => { setApiError(e.message); setLoading(false); });
  }, [serverId]);

  async function handleToggle(h) {
    const prev = h.enabled;
    setHooks(list => list.map(x => x.id === h.id ? { ...x, enabled: !prev } : x));
    try {
      const res = await apiFetch(`/servers/${serverId}/webhooks/${h.id}`, {
        method: 'PATCH', body: JSON.stringify({ enabled: !prev }),
      });
      setHooks(list => list.map(x => x.id === h.id ? res.data : x));
    } catch (err) {
      setHooks(list => list.map(x => x.id === h.id ? { ...x, enabled: prev } : x));
      setApiError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this webhook?')) return;
    try {
      await apiFetch(`/servers/${serverId}/webhooks/${id}`, { method: 'DELETE' });
      setHooks(list => list.filter(x => x.id !== id));
    } catch (err) { setApiError(err.message); }
  }

  async function handleSave(fields, hookId) {
    try {
      if (hookId) {
        const res = await apiFetch(`/servers/${serverId}/webhooks/${hookId}`, {
          method: 'PATCH', body: JSON.stringify(fields),
        });
        setHooks(list => list.map(x => x.id === hookId ? res.data : x));
      } else {
        const res = await apiFetch(`/servers/${serverId}/webhooks`, {
          method: 'POST', body: JSON.stringify(fields),
        });
        setHooks(list => [...list, res.data]);
      }
      setModal(null);
    } catch (err) { return err.message; }
  }

  async function handleTest(id) {
    setTesting(id);
    setTestMsg(null);
    try {
      await apiFetch(`/servers/${serverId}/webhooks/${id}/test`, { method: 'POST' });
      setTestMsg({ id, ok: true, text: 'Test payload delivered' });
    } catch (e) {
      setTestMsg({ id, ok: false, text: e.message });
    } finally {
      setTesting(null);
      setTimeout(() => setTestMsg(null), 5000);
    }
  }

  const eventColor = { 'server.start': C.green, 'server.stop': C.muted, 'server.crash': C.red };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {modal !== null && (
        <WebhookModal
          hook={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {apiError && (
        <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '8px 14px', fontSize: 12, color: C.red }}>{apiError}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => setModal('new')} style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface2, color: C.text, cursor: 'pointer' }}>+ Add Webhook</button>
      </div>

      {loading
        ? <EmptyState message="Loading webhooks…" />
        : hooks.length === 0
          ? <EmptyState message="No webhooks configured. Add one to get notified on server events." />
          : hooks.map(h => (
            <div key={h.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Toggle value={!!h.enabled} onChange={() => handleToggle(h)} />
                <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.url}</span>
                <button onClick={() => handleTest(h.id)} disabled={testing === h.id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: `1px solid ${C.blue}44`, background: 'transparent', color: C.blue, cursor: 'pointer', flexShrink: 0, opacity: testing === h.id ? 0.5 : 1 }}>{testing === h.id ? 'Sending…' : 'Test'}</button>
                <button onClick={() => setModal(h)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer', flexShrink: 0 }}>Edit</button>
                <button onClick={() => handleDelete(h.id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: `1px solid ${C.red}44`, background: 'transparent', color: C.red, cursor: 'pointer', flexShrink: 0 }}>Delete</button>
              </div>
              {testMsg?.id === h.id && (
                <div style={{ fontSize: 11, color: testMsg.ok ? C.green : C.red, marginTop: 2 }}>{testMsg.text}</div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {h.events.map(ev => (
                  <span key={ev} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, background: C.surface2, border: `1px solid ${(eventColor[ev] ?? C.muted) + '44'}`, color: eventColor[ev] ?? C.muted, fontFamily: "'JetBrains Mono', monospace" }}>{ev}</span>
                ))}
              </div>
            </div>
          ))
      }
    </div>
  );
}

// ─── TabConsole ───────────────────────────────────────────────────────────────
const ANSI_CONSOLE = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  white: '\x1b[37m', gray: '\x1b[90m', green: '\x1b[32m',
  yellow: '\x1b[33m', red: '\x1b[91m', cyan: '\x1b[36m',
}

function formatConsoleLine({ type, data, timestamp }) {
  const ts = new Date(timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const prefix = `${ANSI_CONSOLE.gray}${ts}${ANSI_CONSOLE.reset} `
  if (type === 'stderr') return `${prefix}${ANSI_CONSOLE.red}${data}${ANSI_CONSOLE.reset}`
  if (type === 'system') return `${prefix}${ANSI_CONSOLE.cyan}${ANSI_CONSOLE.dim}${data}${ANSI_CONSOLE.reset}`
  // stdout: Minecraft already includes its own [HH:MM:SS] timestamp — no prefix needed
  const colored = (data || '')
    .replace(/(\[.*?\/INFO\]:)/g,  `${ANSI_CONSOLE.green}$1${ANSI_CONSOLE.reset}`)
    .replace(/(\[.*?\/WARN\]:)/g,  `${ANSI_CONSOLE.yellow}$1${ANSI_CONSOLE.reset}`)
    .replace(/(\[.*?\/ERROR\]:)/g, `${ANSI_CONSOLE.red}$1${ANSI_CONSOLE.reset}`)
  return `${ANSI_CONSOLE.white}${colored}${ANSI_CONSOLE.reset}`
}

function wsBaseUrlConsole() {
  const token = sessionStorage.getItem('yams_token') ?? ''
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL + query
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws${query}`
}

function TabConsole({ serverId, onStatusChange }) {
  const termRef    = React.useRef(null)
  const xtermRef   = React.useRef(null)
  const fitRef     = React.useRef(null)
  const wsRef      = React.useRef(null)
  const mountedRef = React.useRef(true)

  const [cmdInput,  setCmdInput]  = React.useState('')
  const [history,   setHistory]   = React.useState([])
  const [histIdx,   setHistIdx]   = React.useState(-1)
  const [wsStatus,  setWsStatus]  = React.useState('connecting')
  const inputRef = React.useRef(null)

  React.useEffect(() => {
    if (!termRef.current) return
    const term = new Terminal({
      theme: {
        background: '#0d1117', foreground: '#e6edf3', cursor: '#e6edf3',
        black: '#161b22', brightBlack: '#484f58',
        white: '#e6edf3', brightWhite: '#ffffff',
        red: '#f85149', brightRed: '#f85149',
        green: '#3fb950', brightGreen: '#56d364',
        yellow: '#d29922', brightYellow: '#e3b341',
        blue: '#388bfd', brightBlue: '#79c0ff',
        cyan: '#39c5cf', brightCyan: '#56d4dd',
      },
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      fontSize: 13, lineHeight: 1.5, cursorStyle: 'bar',
      cursorBlink: false, scrollback: 2000, convertEol: true, disableStdin: true,
    })
    term.open(termRef.current)
    xtermRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    fitRef.current = fit
    setTimeout(() => fit.fit(), 50)
    const ro = new ResizeObserver(() => fitRef.current?.fit())
    ro.observe(termRef.current)
    return () => { mountedRef.current = false; ro.disconnect(); term.dispose(); xtermRef.current = null }
  }, [serverId])

  React.useEffect(() => {
    mountedRef.current = true
    let ws = null, reconnectTimer = null, backoff = 1000
    let historyShown = false

    function writeLine(entry) { xtermRef.current?.writeln(formatConsoleLine(entry)) }

    // ── Pre-fetch ring buffer immediately via REST (no WS handshake delay) ──
    apiFetch(`/servers/${serverId}/logs`).then(res => {
      if (!mountedRef.current) return
      const lines = res.data || []
      if (lines.length > 0) {
        lines.forEach(e => writeLine(e))
        historyShown = true
      }
    }).catch(() => {})

    function connect() {
      if (!mountedRef.current) return
      setWsStatus('connecting')
      ws = new WebSocket(wsBaseUrlConsole())
      wsRef.current = ws
      ws.onopen = () => {
        if (!mountedRef.current) return ws.close()
        backoff = 1000
        ws.send(JSON.stringify({ action: 'subscribe', serverId }))
      }
      ws.onmessage = event => {
        if (!mountedRef.current) return
        let msg; try { msg = JSON.parse(event.data) } catch { return }
        if (msg.type === 'status') {
          if (msg.data === 'subscribed') { setWsStatus('connected'); writeLine({ type: 'system', data: `── YAMS Console · ${msg.server || serverId} ──`, timestamp: Date.now() }) }
          else if (msg.data === 'pending') { setWsStatus('connecting'); writeLine({ type: 'system', data: 'Server is stopped — waiting for it to start…', timestamp: Date.now() }) }
          else if (msg.data === 'started') { setWsStatus('connected'); writeLine({ type: 'system', data: '── Server started ──', timestamp: Date.now() }); onStatusChange?.('running') }
          else if (msg.data === 'stopped') { setWsStatus('lost'); writeLine({ type: 'system', data: '── Server stopped ──', timestamp: Date.now() }); onStatusChange?.('stopped') }
          else if (msg.data === 'crashed') { setWsStatus('lost'); writeLine({ type: 'system', data: '── Server crashed ──', timestamp: Date.now() }); onStatusChange?.('stopped') }
        } else if (msg.type === 'history') {
          // Skip WS history replay if REST pre-fetch already populated the terminal
          if (!historyShown) (msg.data || []).forEach(e => writeLine(e))
          historyShown = true
        } else if (msg.type === 'stdout' || msg.type === 'stderr') {
          writeLine(msg)
        } else if (msg.type === 'error') {
          writeLine({ type: 'system', data: `[error] ${msg.data}`, timestamp: Date.now() })
        }
      }
      ws.onclose = () => {
        if (!mountedRef.current) return
        setWsStatus('lost')
        reconnectTimer = setTimeout(connect, Math.min(backoff, 10000))
        backoff = Math.min(backoff * 2, 10000)
      }
      ws.onerror = () => ws.close()
    }

    connect()
    return () => { mountedRef.current = false; clearTimeout(reconnectTimer); ws?.close() }
  }, [serverId])

  function sendCommand(cmd) {
    const trimmed = cmd.trim(); if (!trimmed) return
    setHistory(h => [trimmed, ...h].slice(0, 100)); setHistIdx(-1); setCmdInput('')
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'command', serverId, command: trimmed }))
    }
    xtermRef.current?.writeln(formatConsoleLine({ type: 'system', data: `> ${trimmed}`, timestamp: Date.now() }))
  }

  function handleInputKey(e) {
    if (e.key === 'Enter') { sendCommand(cmdInput) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHistIdx(i => { const n = Math.min(i + 1, history.length - 1); setCmdInput(history[n] || ''); return n }) }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHistIdx(i => { const n = Math.max(i - 1, -1); setCmdInput(n === -1 ? '' : history[n]); return n }) }
  }

  const wsColor = wsStatus === 'connected' ? C.green : wsStatus === 'lost' ? C.red : C.amber
  const wsLabel = wsStatus === 'lost' ? 'Disconnected' : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: C.bg, overflow: 'hidden' }}>
      {/* Status bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '6px 14px', borderBottom: `1px solid ${C.border}`, background: C.surface, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: wsColor, fontWeight: 500 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: wsColor, boxShadow: wsStatus === 'connected' ? `0 0 6px ${C.green}88` : 'none', display: 'inline-block' }} />
          {wsLabel}
        </div>
      </div>
      {/* Terminal */}
      <div ref={termRef} style={{ flex: 1, overflow: 'hidden', padding: '4px 4px 0 4px', background: '#0d1117' }} />
      {/* Input */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}`, background: C.surface, display: 'flex', alignItems: 'center', opacity: wsStatus === 'connected' ? 1 : 0.5, transition: 'opacity 150ms' }}>
        <span style={{ padding: '0 12px 0 16px', color: C.green, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, userSelect: 'none', flexShrink: 0 }}>&gt;</span>
        <input
          ref={inputRef}
          type="text" value={cmdInput}
          onChange={e => setCmdInput(e.target.value)}
          onKeyDown={handleInputKey}
          placeholder="Enter command…"
          disabled={wsStatus !== 'connected'}
          autoComplete="off" spellCheck={false}
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: C.text, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, padding: '11px 0', caretColor: C.green }}
        />
        <button
          onClick={() => sendCommand(cmdInput)}
          disabled={wsStatus !== 'connected' || !cmdInput.trim()}
          style={{ background: 'none', border: 'none', borderLeft: `1px solid ${C.border}`, color: cmdInput.trim() && wsStatus === 'connected' ? C.blue : C.dim, padding: '0 16px', height: '100%', cursor: cmdInput.trim() && wsStatus === 'connected' ? 'pointer' : 'default', fontSize: 12, fontWeight: 600, transition: 'color 150ms', flexShrink: 0, minHeight: 43 }}
        >Send</button>
      </div>
    </div>
  )
}

// ─── TabSettings ─────────────────────────────────────────────────────────────
function DeleteServerModal({ serverName, serverId, onClose, onDeleted }) {
  const [confirm, setConfirm] = React.useState('')
  const [deleting, setDeleting] = React.useState(false)
  const [errMsg, setErrMsg] = React.useState(null)
  const match = confirm === serverName

  async function handleDelete() {
    if (!match) return
    setDeleting(true); setErrMsg(null)
    try {
      await apiFetch(`/servers/${serverId}`, { method: 'DELETE' })
      onDeleted()
    } catch (err) {
      setErrMsg(err.message); setDeleting(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ width: 440, background: C.surface, border: `1px solid ${C.red}55`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px #00000066' }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.red }}>Delete Server</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {errMsg && (
            <div style={{ background: `${C.red}10`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '10px 14px', fontSize: 13, color: C.red }}>{errMsg}</div>
          )}
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>
            This will permanently delete <strong style={{ color: C.text }}>{serverName}</strong> and all its files. This action <strong style={{ color: C.red }}>cannot be undone</strong>.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: C.muted }}>
              To confirm, type <span style={{ fontFamily: 'monospace', color: C.text, fontWeight: 600 }}>{serverName}</span> below:
            </label>
            <input
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoFocus
              placeholder={serverName}
              style={{
                background: C.surface2, border: `1px solid ${match ? C.red + '88' : C.border}`,
                borderRadius: 6, padding: '8px 12px', fontSize: 13, color: C.text,
                outline: 'none', width: '100%', boxSizing: 'border-box',
                transition: 'border-color 150ms',
              }}
              onKeyDown={e => { if (e.key === 'Enter' && match) handleDelete() }}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ fontSize: 13, padding: '7px 14px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>Cancel</button>
            <button
              onClick={handleDelete}
              disabled={!match || deleting}
              style={{
                fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 6,
                border: `1px solid ${C.red}55`, background: match ? `${C.red}22` : C.surface2,
                color: match ? C.red : C.dim,
                cursor: (!match || deleting) ? 'default' : 'pointer',
                opacity: deleting ? 0.6 : 1, transition: 'all 150ms',
              }}
            >{deleting ? 'Deleting…' : 'Delete Server'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TabSettings({ serverId, server, onUpdated, onDeleted, navigate }) {
  const [name,        setName]        = React.useState(server.name ?? '')
  const [port,        setPort]        = React.useState(String(server.port ?? ''))
  const [ram,         setRam]         = React.useState(server.ram ?? '1G')
  const [javaVersion, setJavaVersion] = React.useState(server.java_version ?? 'auto')
  const [motd,        setMotd]        = React.useState(server.motd ?? '')
  const [maxPlayers,  setMaxPlayers]  = React.useState(String(server.maxPlayers ?? 20))
  const [gamemode,    setGamemode]    = React.useState(server.gamemode ?? 'survival')
  const [pvp,         setPvp]         = React.useState(server.pvp !== false)
  const [onlineMode,  setOnlineMode]  = React.useState(server.onlineMode !== false)

  const [saving,      setSaving]      = React.useState(false)
  const [showDelete,  setShowDelete]  = React.useState(false)
  const [okMsg,   setOkMsg]   = React.useState(null)
  const [errMsg,  setErrMsg]  = React.useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true); setErrMsg(null); setOkMsg(null)
    try {
      const res = await apiFetch(`/servers/${serverId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          name, port: Number(port), ram, javaVersion,
          motd: motd || undefined,
          maxPlayers: Number(maxPlayers),
          gamemode, pvp, onlineMode,
        }),
      })
      setOkMsg('Settings saved')
      setTimeout(() => setOkMsg(null), 4000)
      onUpdated(res.data)
    } catch (err) {
      setErrMsg(err.message)
    } finally {
      setSaving(false)
    }
  }

  const inp = {
    background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6,
    padding: '8px 12px', fontSize: 13, color: C.text, outline: 'none', width: '100%', boxSizing: 'border-box',
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 600, margin: '0 auto', width: '100%' }}>
      {okMsg  && <div style={{ background: `${C.green}10`, border: `1px solid ${C.green}44`, borderRadius: 6, padding: '10px 14px', fontSize: 13, color: C.green }}>✓ {okMsg}</div>}
      {errMsg && <div style={{ background: `${C.red}10`,   border: `1px solid ${C.red}44`,   borderRadius: 6, padding: '10px 14px', fontSize: 13, color: C.red }}>{errMsg}</div>}

      {/* General */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>General</div>
        <FieldRow label="Server Name" hint="Must be 3–32 chars, start with a letter, letters/digits/hyphens only.">
          <input value={name} onChange={e => setName(e.target.value)} style={inp}
            onFocus={e => { e.target.style.borderColor = C.blue }} onBlur={e => { e.target.style.borderColor = C.border }} />
        </FieldRow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <FieldRow label="Port" hint="1024–65535">
            <NumberInput value={port} onChange={e => setPort(e.target.value)} min={1024} max={65535} style={{ width: '100%' }} />
          </FieldRow>
          <FieldRow label="RAM" hint="e.g. 1G, 2G, 512M">
            <input value={ram} onChange={e => setRam(e.target.value)} placeholder="1G" style={inp}
              onFocus={e => { e.target.style.borderColor = C.blue }} onBlur={e => { e.target.style.borderColor = C.border }} />
          </FieldRow>
          <FieldRow label="Java Version" hint="JVM used to start this server">
            <Select value={javaVersion} onChange={setJavaVersion} options={[
              { value: 'auto', label: 'Auto (Java 25)' },
              { value: '8',    label: 'Java 8'         },
              { value: '11',   label: 'Java 11'        },
              { value: '17',   label: 'Java 17'        },
              { value: '21',   label: 'Java 21'        },
              { value: '25',   label: 'Java 25'        },
            ]} />
          </FieldRow>
        </div>
      </div>

      {/* Gameplay */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Gameplay</div>
        <FieldRow label="MOTD" hint="Message shown in the server list.">
          <input value={motd} onChange={e => setMotd(e.target.value)} placeholder={`A YAMS Server - ${server.name}`} style={inp}
            onFocus={e => { e.target.style.borderColor = C.blue }} onBlur={e => { e.target.style.borderColor = C.border }} />
        </FieldRow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FieldRow label="Max Players">
            <NumberInput value={maxPlayers} onChange={e => setMaxPlayers(e.target.value)} min={1} max={1000} style={{ width: '100%' }} />
          </FieldRow>
          <FieldRow label="Gamemode">
            <Select value={gamemode} onChange={setGamemode} options={[
              { value: 'survival',  label: 'Survival'  },
              { value: 'creative',  label: 'Creative'  },
              { value: 'adventure', label: 'Adventure' },
              { value: 'spectator', label: 'Spectator' },
            ]} />
          </FieldRow>
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <Toggle value={pvp} onChange={setPvp} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>PvP</div>
              <div style={{ fontSize: 11, color: C.dim }}>Allow players to attack each other</div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <Toggle value={onlineMode} onChange={setOnlineMode} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Online Mode</div>
              <div style={{ fontSize: 11, color: C.dim }}>Authenticate players with Mojang</div>
            </div>
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
        <button type="submit" disabled={saving} style={{
          fontSize: 13, fontWeight: 600, padding: '8px 20px', borderRadius: 6,
          border: `1px solid ${C.blue}55`, background: `${C.blue}18`, color: C.blue,
          cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
        }}>{saving ? 'Saving…' : 'Save Settings'}</button>
      </div>

      {/* Danger zone */}
      <div style={{ borderTop: `1px solid ${C.red}33`, paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.red, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Danger Zone</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: `${C.red}08`, border: `1px solid ${C.red}33`, borderRadius: 8, padding: '14px 18px' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Delete this server</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>Permanently removes the server and all its files.</div>
          </div>
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, border: `1px solid ${C.red}55`, background: 'transparent', color: C.red, cursor: 'pointer', flexShrink: 0 }}
          >Delete Server</button>
        </div>
      </div>

      {showDelete && (
        <DeleteServerModal
          serverName={server.name}
          serverId={serverId}
          onClose={() => setShowDelete(false)}
          onDeleted={onDeleted}
        />
      )}
    </form>
  )
}

// ─── ServerPage ───────────────────────────────────────────────────────────────
function ServerPage({ serverId, navigate }) {
  const [server, setServer]         = React.useState(null);
  const [notFound, setNotFound]     = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [tab, setTab] = React.useState(() => {
    return sessionStorage.getItem(`yams-server-tab-${serverId}`) || 'console';
  });

  React.useEffect(() => {
    apiFetch(`/servers/${serverId}`)
      .then(res => setServer(res.data))
      .catch(() => setNotFound(true));
  }, [serverId]);

  function switchTab(t) { setTab(t); sessionStorage.setItem(`yams-server-tab-${serverId}`, t); }

  if (notFound) {
    return (
      <div style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ color: C.red, fontSize: 14, fontWeight: 600 }}>Server not found: {serverId}</div>
        <button onClick={() => navigate('#/')} style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer', width: 'fit-content' }}>← Dashboard</button>
      </div>
    );
  }

  if (!server) {
    return <EmptyState message="Loading…" />;
  }

  const infoItems = [
    { label: 'Port', value: server.port },
    { label: 'RAM',  value: server.ram  },
  ];

  const tabContent = {
    console:    <TabConsole   serverId={serverId} onStatusChange={status => setServer(s => ({ ...s, status }))} />,
    worlds:     <TabWorlds    serverId={serverId} />,
    files:      <TabFiles     serverId={serverId} />,
    backups:    <TabBackups   serverId={serverId} />,
    metrics:    <TabMetrics   serverId={serverId} server={server} />,
    scheduler:  <TabScheduler serverId={serverId} />,
    webhooks:   <TabWebhooks  serverId={serverId} />,
    mods:       <TabMods      serverId={serverId} server={server} />,
    players:    <TabPlayers   serverId={serverId} />,
    settings:   <TabSettings  serverId={serverId} server={server} onUpdated={setServer} onDeleted={() => navigate('#/')} navigate={navigate} />,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      {/* Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '16px 24px 0', flexShrink: 0 }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <button
            onClick={() => navigate('#/')}
            style={{ background: 'none', border: 'none', color: C.muted, fontSize: 12, cursor: 'pointer', padding: 0, transition: 'color 150ms' }}
            onMouseEnter={e => e.currentTarget.style.color = C.text}
            onMouseLeave={e => e.currentTarget.style.color = C.muted}
          >Dashboard</button>
          <span style={{ color: C.dim, fontSize: 12 }}>/</span>
          <span style={{ fontSize: 12, color: C.muted }}>{server.name}</span>
        </div>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
          <StatusDot status={server.status} />
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{server.name}</span>
          <span style={{ fontSize: 12, color: statusColor(server.status), fontWeight: 500, textTransform: 'capitalize' }}>{server.status}</span>
          <div style={{ display: 'flex', gap: 12, marginLeft: 16 }}>
            {infoItems.filter(it => it.value != null).map(item => (
              <div key={item.label} style={{ display: 'flex', gap: 5, alignItems: 'baseline' }}>
                <span style={{ fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{item.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>{item.value}</span>
              </div>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {(server.status === 'stopped' || server.status === 'running' || server.status === 'crashed') && (
              <button
                disabled={actionLoading}
                onClick={async () => {
                  const action = server.status === 'running' ? 'stop' : 'start';
                  setActionLoading(true);
                  try {
                    const res = await apiFetch(`/servers/${serverId}/${action}`, { method: 'POST' });
                    setServer(res.data);
                  } catch {}
                  setActionLoading(false);
                }}
                style={{
                  fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 5,
                  border: `1px solid ${server.status === 'running' ? C.red + '55' : C.green + '55'}`,
                  background: server.status === 'running' ? `${C.red}18` : `${C.green}18`,
                  color: server.status === 'running' ? C.red : C.green,
                  cursor: actionLoading ? 'default' : 'pointer', opacity: actionLoading ? 0.6 : 1,
                  transition: 'opacity 150ms',
                }}
              >{actionLoading ? '…' : server.status === 'running' ? 'Stop' : 'Start'}</button>
            )}
          </div>
        </div>
        {/* Sub-nav tabs */}
        <div style={{ display: 'flex', gap: 0, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px 16px', fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
                color: tab === t.id ? C.text : C.muted,
                borderBottom: `2px solid ${tab === t.id ? C.blue : 'transparent'}`,
                transition: 'color 150ms, border-color 150ms',
                whiteSpace: 'nowrap',
              }}
            >{t.label}</button>
          ))}
        </div>
      </div>
      {/* Tab content */}
      {tab === 'console' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {tabContent['console']}
        </div>
      ) : (
        <div style={{ flex: 1, padding: '24px', maxWidth: 960, width: '100%', margin: '0 auto', overflowY: 'auto' }}>
          {tabContent[tab] || <EmptyState message="Coming soon" />}
        </div>
      )}
    </div>
  );
}

export default ServerPage;
