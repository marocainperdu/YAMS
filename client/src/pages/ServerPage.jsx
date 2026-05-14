import React from 'react'
import { apiFetch, apiUrl, C, EmptyState, StatusDot, statusColor, formatBytes, formatRelTime } from '../lib/yamsShared'

// yams-server.js — Server detail page: all management tabs wired to real APIs

const TABS = [
  { id: 'worlds',     label: 'Worlds'          },
  { id: 'files',      label: 'File Manager'    },
  { id: 'backups',    label: 'Backup Manager'  },
  { id: 'metrics',    label: 'Server Metrics'  },
  { id: 'scheduler',  label: 'Task Scheduler'  },
  { id: 'reorder',    label: 'Server Re-ordering' },
  { id: 'webhooks',   label: 'Webhooks'        },
  { id: 'prometheus', label: 'Open-Metrics'    },
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

// ─── TabFiles ─────────────────────────────────────────────────────────────────
function TabFiles({ serverId }) {
  const [entries, setEntries] = React.useState(null);
  const [curPath, setCurPath] = React.useState('');
  const [hov, setHov]         = React.useState(null);
  const [errMsg, setErrMsg]   = React.useState(null);

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

  const icon = t => t === 'directory' ? '📁' : '📄';

  const breadcrumbs = ['root', ...curPath.split('/').filter(Boolean)];

  return (
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
              onClick={() => navigate(f)}
              style={{
                display: 'flex', alignItems: 'center', padding: '10px 16px',
                borderBottom: i < entries.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                background: hov === i ? C.surface2 : 'transparent',
                transition: 'background 150ms', cursor: f.type === 'directory' ? 'pointer' : 'default',
              }}
            >
              <span style={{ fontSize: 14, marginRight: 10, opacity: 0.7 }}>{icon(f.type)}</span>
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
function TabMetrics({ serverId }) {
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

  function Gauge({ label, value, max, unit, color }) {
    if (value == null) return null;
    const pct = Math.min(100, Math.round((value / max) * 100));
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>{label}</span>
          <span style={{ fontSize: 18, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}{unit}</span>
        </div>
        <div style={{ height: 4, background: C.surface2, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 600ms ease' }} />
        </div>
        <div style={{ fontSize: 11, color: C.dim }}>{pct}% of {max}{unit}</div>
      </div>
    );
  }

  const tpsVal = tps?.available ? tps.m1?.toFixed(1) : null;
  const ramMB  = proc?.ram != null ? Math.round(proc.ram / 1024 / 1024) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <Gauge label="TPS"     value={tpsVal}           max={20}   unit=""   color={tpsVal >= 18 ? C.green : C.amber} />
        <Gauge label="CPU"     value={proc?.cpu?.toFixed(1)} max={100} unit="%" color={(proc?.cpu || 0) < 60 ? C.green : (proc?.cpu || 0) < 80 ? C.amber : C.red} />
        <Gauge label="Memory"  value={ramMB}             max={4096} unit="MB" color={C.blue} />
        <Gauge label="Players" value={players?.online}   max={players?.max || 20} unit="" color={C.purple} />
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
    </div>
  );
}

// ─── ScheduleModal ────────────────────────────────────────────────────────────
function ScheduleModal({ schedule, onClose, onSave }) {
  const [name,    setName]    = React.useState(schedule?.name    ?? '');
  const [cron,    setCron]    = React.useState(schedule?.cron    ?? '');
  const [command, setCommand] = React.useState(schedule?.command ?? '');
  const [enabled, setEnabled] = React.useState(schedule ? !!schedule.enabled : true);
  const [loading, setLoading] = React.useState(false);
  const [error,   setError]   = React.useState(null);

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setError(null);
    const err = await onSave(
      { name: name.trim(), cron: cron.trim(), command: command.trim(), enabled },
      schedule?.id ?? null,
    );
    if (err) { setError(err); setLoading(false); }
  }

  const inp = { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', fontSize: 13, color: C.text, outline: 'none', width: '100%' };
  const mono = { ...inp, fontFamily: "'JetBrains Mono', monospace" };
  const disabled = loading || !name.trim() || !cron.trim() || !command.trim();

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: '#00000077', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 440, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 48px #00000066' }}>
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
            <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Cron expression</label>
            <input value={cron} onChange={e => setCron(e.target.value)} placeholder="minute hour dom month dow" style={mono}
              onFocus={e => { e.target.style.borderColor = C.blue; }} onBlur={e => { e.target.style.borderColor = C.border; }} />
            <div style={{ fontSize: 11, color: C.dim }}>
              e.g. <span style={{ fontFamily: 'monospace' }}>0 4 * * *</span> (4am daily) · <span style={{ fontFamily: 'monospace' }}>*/30 * * * *</span> (every 30min) · <span style={{ fontFamily: 'monospace' }}>0 * * * *</span> (hourly)
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>Command</label>
            <input value={command} onChange={e => setCommand(e.target.value)} placeholder="say Server restarting in 5 minutes" style={mono}
              onFocus={e => { e.target.style.borderColor = C.blue; }} onBlur={e => { e.target.style.borderColor = C.border; }} />
            <div style={{ fontSize: 11, color: C.dim }}>Minecraft console command (no leading /)</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle value={enabled} onChange={setEnabled} />
            <span style={{ fontSize: 12, color: C.muted }}>Enabled</span>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <button type="button" onClick={onClose} style={{ fontSize: 13, padding: '7px 14px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={disabled} style={{ fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 6, border: `1px solid ${C.green}55`, background: `${C.green}18`, color: C.green, cursor: disabled ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}>
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
  const [schedules, setSchedules] = React.useState([]);
  const [loading,   setLoading]   = React.useState(true);
  const [apiError,  setApiError]  = React.useState(null);
  const [modal,     setModal]     = React.useState(null); // null | 'new' | schedule object

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {modal !== null && (
        <ScheduleModal
          schedule={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {apiError && (
        <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '8px 14px', fontSize: 12, color: C.red }}>
          {apiError}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => setModal('new')} style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface2, color: C.text, cursor: 'pointer' }}>+ New Task</button>
      </div>

      {loading
        ? <EmptyState message="Loading schedules…" />
        : schedules.length === 0
          ? <EmptyState message="No scheduled tasks yet." />
          : (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
              {schedules.map((s, i) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderBottom: i < schedules.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                  <Toggle value={!!s.enabled} onChange={() => handleToggle(s)} />
                  <div style={{ flex: 1, cursor: 'pointer', minWidth: 0 }} onClick={() => setModal(s)}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: s.enabled ? C.text : C.muted }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: C.dim, fontFamily: "'JetBrains Mono', monospace", marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.cron} — {s.command}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: C.dim, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {s.last_run_at ? formatRelTime(s.last_run_at) : 'Never run'}
                  </div>
                  <button onClick={() => handleDelete(s.id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: `1px solid ${C.red}44`, background: 'transparent', color: C.red, cursor: 'pointer', flexShrink: 0 }}>Delete</button>
                </div>
              ))}
            </div>
          )
      }
    </div>
  );
}

// ─── TabReorder ───────────────────────────────────────────────────────────────
function TabReorder() {
  const [servers,  setServers]  = React.useState(null);
  const [drag,     setDrag]     = React.useState(null);
  const [over,     setOver]     = React.useState(null);
  const [saveState, setSaveState] = React.useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'

  React.useEffect(() => {
    apiFetch('/servers')
      .then(res => setServers((res.data || []).map((s, i) => ({ ...s, priority: i + 1 }))))
      .catch(() => setServers([]));
  }, []);

  async function handleDrop(idx) {
    if (drag === null || drag === idx) { setDrag(null); setOver(null); return; }
    const reordered = [...servers];
    const [moved] = reordered.splice(drag, 1);
    reordered.splice(idx, 0, moved);
    const withPriority = reordered.map((s, i) => ({ ...s, priority: i + 1 }));
    setServers(withPriority);
    setDrag(null); setOver(null);

    setSaveState('saving');
    try {
      await apiFetch('/servers/reorder', {
        method: 'POST',
        body: JSON.stringify({ order: withPriority.map(s => s.id) }),
      });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  }

  if (!servers) return <EmptyState message="Loading…" />;

  const saveColors = { saving: C.muted, saved: C.green, error: C.red };
  const saveLabels = { saving: 'Saving…', saved: 'Saved', error: 'Failed to save' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: C.muted }}>Drag to set the display and startup order. Changes are saved automatically.</span>
        <div style={{ flex: 1 }} />
        {saveState !== 'idle' && (
          <span style={{ fontSize: 12, color: saveColors[saveState], transition: 'color 200ms' }}>
            {saveLabels[saveState]}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {servers.map((s, i) => (
          <div
            key={s.id}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={e => { e.preventDefault(); setOver(i); }}
            onDrop={() => handleDrop(i)}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
              background: over === i ? C.surface2 : C.surface,
              border: `1px solid ${over === i ? C.blue : C.border}`,
              borderRadius: 7, cursor: 'grab', transition: 'all 150ms',
              opacity: drag === i ? 0.4 : 1,
            }}
          >
            <span style={{ color: C.dim, fontSize: 13, userSelect: 'none' }}>⠿</span>
            <span style={{ width: 22, height: 22, borderRadius: 4, background: C.surface2, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.muted }}>
              {s.priority}
            </span>
            <span style={{ fontSize: 13, fontWeight: 500, color: C.text, flex: 1 }}>{s.name}</span>
            <StatusDot status={s.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── WebhookModal ─────────────────────────────────────────────────────────────
const ALL_EVENTS = ['server.start', 'server.stop', 'server.crash'];

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

// ─── TabWebhooks ──────────────────────────────────────────────────────────────
function TabWebhooks({ serverId }) {
  const [hooks,    setHooks]   = React.useState([]);
  const [loading,  setLoading] = React.useState(true);
  const [apiError, setApiError]= React.useState(null);
  const [modal,    setModal]   = React.useState(null); // null | 'new' | hook object

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
                <button onClick={() => setModal(h)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer', flexShrink: 0 }}>Edit</button>
                <button onClick={() => handleDelete(h.id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: `1px solid ${C.red}44`, background: 'transparent', color: C.red, cursor: 'pointer', flexShrink: 0 }}>Delete</button>
              </div>
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

// ─── TabPrometheus ────────────────────────────────────────────────────────────
function TabPrometheus({ serverId }) {
  const endpoint = `/api/metrics/${serverId}`;
  const [copied, setCopied] = React.useState(false);
  function copy() {
    navigator.clipboard.writeText(window.location.origin + endpoint).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Prometheus Scrape Endpoint</div>
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
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
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

// ─── ServerPage ───────────────────────────────────────────────────────────────
function ServerPage({ serverId, navigate }) {
  const [server, setServer] = React.useState(null);
  const [notFound, setNotFound] = React.useState(false);
  const [tab, setTab] = React.useState(() => {
    return sessionStorage.getItem(`yams-server-tab-${serverId}`) || 'worlds';
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
    worlds:     <TabWorlds    serverId={serverId} />,
    files:      <TabFiles     serverId={serverId} />,
    backups:    <TabBackups   serverId={serverId} />,
    metrics:    <TabMetrics   serverId={serverId} />,
    scheduler:  <TabScheduler serverId={serverId} />,
    reorder:    <TabReorder   serverId={serverId} />,
    webhooks:   <TabWebhooks  serverId={serverId} />,
    prometheus: <TabPrometheus serverId={serverId} />,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 48px)' }}>
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
            <button
              onClick={() => navigate(`#/console/${serverId}`)}
              style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 5, border: `1px solid ${C.blue}55`, background: `${C.blue}18`, color: C.blue, cursor: 'pointer' }}
            >Open Console</button>
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
      <div style={{ flex: 1, padding: '24px', maxWidth: 960, width: '100%', margin: '0 auto' }}>
        {tabContent[tab] || <EmptyState message="Coming soon" />}
      </div>
    </div>
  );
}

export default ServerPage;
