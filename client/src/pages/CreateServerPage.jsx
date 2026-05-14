import React from 'react'
import { apiFetch, C } from '../lib/yamsShared'

const ENGINE_OPTIONS = [
  { id: 'vanilla', label: 'Vanilla', desc: 'Official Mojang server', logo: 'https://github.com/Mojang.png', color: '#3fb950' },
  { id: 'paper', label: 'Paper', desc: 'High-performance fork', logo: 'https://github.com/PaperMC.png', color: '#388bfd' },
  { id: 'fabric', label: 'Fabric', desc: 'Lightweight mod loader', logo: 'https://github.com/FabricMC.png', color: '#d29922' },
  { id: 'purpur', label: 'Purpur', desc: 'Fork of Paper with extras', logo: 'https://github.com/PurpurMC.png', color: '#f778ba' },
  { id: 'forge', label: 'Forge', desc: 'Popular mod platform', logo: 'https://github.com/MinecraftForge.png', color: '#f0883e', manualOnly: true },
  { id: 'spigot', label: 'Spigot', desc: 'Bukkit-compatible plugins', logo: 'https://github.com/SpigotMC.png', color: '#bc8cff', manualOnly: true },
]

const MC_VERSIONS = [
  '1.21.4', '1.21.3', '1.21.1', '1.21',
  '1.20.6', '1.20.4', '1.20.2', '1.20.1',
  '1.19.4', '1.19.2', '1.18.2', '1.17.1',
]

const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator']

export default function CreateServerPage({ onCreated, onCancel }) {
  const [step, setStep] = React.useState(0)
  const [engine, setEngine] = React.useState('')
  const [version, setVersion] = React.useState('')
  const [settings, setSettings] = React.useState({
    name: '', memory: '', port: '25565',
    maxPlayers: '20', gamemode: 'survival',
    motd: 'A YAMS Minecraft Server',
    onlineMode: true, pvp: true,
  })
  const [creating, setCreating] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [error, setError] = React.useState(null)

  const STEPS = ['Engine', 'Version', 'Settings', 'Review']

  function canAdvance() {
    if (step === 0) return !!engine
    if (step === 1) return !!version
    if (step === 2) return settings.name.trim().length >= 3 && /^[A-Za-z][A-Za-z0-9-]{2,31}$/.test(settings.name.trim())
    return true
  }

  function handleNext() { if (canAdvance()) setStep(s => s + 1) }
  function handleBack() { setStep(s => s - 1); setError(null) }

  async function handleCreate() {
    setCreating(true)
    setProgress(0)
    setError(null)

    // Animate through the first two steps quickly, then hold at "Downloading…"
    // while the actual network request (which includes the JAR download) runs.
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 2) { clearInterval(interval); return 2 }
        return p + 1
      })
    }, 900)

    try {
      const res = await apiFetch('/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: settings.name.trim(),
          port: parseInt(settings.port, 10),
          ram: settings.memory ? `${settings.memory}M` : '1024M',
          engine: engine,
          version: version,
          maxPlayers: parseInt(settings.maxPlayers, 10),
          motd: settings.motd,
          gamemode: settings.gamemode,
          pvp: settings.pvp,
          onlineMode: settings.onlineMode,
        }),
      })
      clearInterval(interval)
      setProgress(5)
      setTimeout(() => onCreated && onCreated(res), 600)
    } catch (err) {
      clearInterval(interval)
      setCreating(false)
      setError(err.message || 'Failed to create server.')
    }
  }

  if (creating) return <CreatingAnimation progress={progress} name={settings.name} />

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, flexShrink: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>New Server</h1>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 36, flexShrink: 0 }}>
        {STEPS.map((label, i) => (
          <React.Fragment key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                background: i < step ? C.green : i === step ? C.blue : C.surface2,
                color: i < step ? '#0d1117' : i === step ? '#fff' : C.dim,
                border: `2px solid ${i < step ? C.green : i === step ? C.blue : C.border}`,
                transition: 'all 200ms',
              }}>{i < step ? '✓' : i + 1}</div>
              <span style={{ fontSize: 12, fontWeight: i === step ? 600 : 400, color: i === step ? C.text : C.muted }}>{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, margin: '0 10px', background: i < step ? C.green : C.surface2, transition: 'background 200ms' }} />
            )}
          </React.Fragment>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {step === 0 && <StepEngine engine={engine} setEngine={setEngine} />}
        {step === 1 && <StepVersion version={version} setVersion={setVersion} />}
        {step === 2 && <StepSettings settings={settings} setSettings={setSettings} />}
        {step === 3 && <StepReview engine={engine} version={version} settings={settings} />}

        {error && (
          <div style={{ marginTop: 20, background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '10px 14px', fontSize: 12, color: C.red }}>{error}</div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 20, marginTop: 16, borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
        <button onClick={step === 0 ? onCancel : handleBack} style={{
          padding: '9px 22px', borderRadius: 7, border: `1px solid ${C.border}`,
          background: 'none', color: C.muted, fontSize: 13, cursor: 'pointer',
        }}>{step === 0 ? 'Cancel' : '← Back'}</button>

        {step < 3
          ? <button onClick={handleNext} disabled={!canAdvance()} style={{
            padding: '9px 28px', borderRadius: 7, border: 'none',
            background: canAdvance() ? C.blue : C.surface2,
            color: canAdvance() ? '#fff' : C.dim,
            fontSize: 13, fontWeight: 600, cursor: canAdvance() ? 'pointer' : 'default',
            transition: 'background 150ms',
          }}>Next →</button>
          : <button onClick={handleCreate} style={{
            padding: '9px 28px', borderRadius: 7, border: 'none',
            background: C.green, color: '#0d1117',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>Create server</button>
        }
      </div>
    </div>
  )
}

function StepEngine({ engine, setEngine }) {
  return (
    <div>
      <div style={{ fontSize: 14, color: C.muted, marginBottom: 20 }}>Choose the server software that powers your world.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {ENGINE_OPTIONS.map(opt => (
          <button key={opt.id} onClick={() => setEngine(opt.id)} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
            padding: '16px 18px', borderRadius: 10, cursor: 'pointer',
            background: engine === opt.id ? `${opt.color}18` : C.surface2,
            border: `2px solid ${engine === opt.id ? opt.color : C.border}`,
            transition: 'border-color 150ms, background 150ms', textAlign: 'left',
            position: 'relative',
          }}>
            <img src={opt.logo} alt={opt.label} style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'contain' }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{opt.label}</div>
            <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>{opt.desc}</div>
            {opt.manualOnly && (
              <div style={{ fontSize: 10, color: C.amber, fontWeight: 600, marginTop: 2 }}>Manual JAR required</div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function StepVersion({ version, setVersion }) {
  return (
    <div>
      <div style={{ fontSize: 14, color: C.muted, marginBottom: 20 }}>Select the Minecraft version to run.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
        {MC_VERSIONS.map(v => (
          <button key={v} onClick={() => setVersion(v)} style={{
            padding: '14px 10px', borderRadius: 8, cursor: 'pointer',
            background: version === v ? `${C.blue}18` : C.surface2,
            border: `2px solid ${version === v ? C.blue : C.border}`,
            color: version === v ? C.text : C.muted,
            fontSize: 13, fontWeight: version === v ? 700 : 400,
            fontFamily: 'JetBrains Mono, monospace',
            transition: 'all 150ms',
          }}>
            {v}
            {v === MC_VERSIONS[0] && <div style={{ fontSize: 10, color: C.green, marginTop: 3 }}>Latest</div>}
          </button>
        ))}
      </div>
    </div>
  )
}

const settingsInp = {
  width: '100%', background: C.surface2, border: `1px solid ${C.border}`,
  borderRadius: 7, padding: '9px 13px', fontSize: 14, color: C.text,
  outline: 'none', boxSizing: 'border-box',
}
function SettingsLabel({ children }) {
  return <label style={{ fontSize: 12, fontWeight: 500, color: C.muted, display: 'block', marginBottom: 6 }}>{children}</label>
}
function SettingsRow({ children, cols = 'repeat(2, 1fr)' }) {
  return <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 16 }}>{children}</div>
}

function StepSettings({ settings, setSettings }) {
  function set(key, val) { setSettings(s => ({ ...s, [key]: val })) }

  const isValidName = /^[A-Za-z][A-Za-z0-9-]{2,31}$/.test(settings.name.trim())
  const nameError = settings.name.length > 0 && !isValidName
    ? 'Name must start with a letter, use only letters, numbers, hyphens (3–32 chars).'
    : null

  const inp = settingsInp
  const Label = SettingsLabel
  const Row = SettingsRow

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <Label>Server name *</Label>
        <input value={settings.name} onChange={e => set('name', e.target.value)} style={{ ...inp, borderColor: nameError ? C.red : C.border }}
          onFocus={e => { e.target.style.borderColor = nameError ? C.red : C.blue }}
          onBlur={e => { e.target.style.borderColor = nameError ? C.red : C.border }}
          placeholder="my-survival-server" />
        {nameError && <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{nameError}</div>}
      </div>

      <Row>
        <div>
          <Label>Memory (MB)</Label>
          <input type="number" min="512" value={settings.memory} onChange={e => set('memory', e.target.value)}
            placeholder="e.g. 1024" style={inp}
            onFocus={e => { e.target.style.borderColor = C.blue }}
            onBlur={e => { e.target.style.borderColor = C.border }} />
        </div>
        <div>
          <Label>Port</Label>
          <input type="number" min="1024" max="65535" value={settings.port} onChange={e => set('port', e.target.value)} style={inp}
            onFocus={e => { e.target.style.borderColor = C.blue }}
            onBlur={e => { e.target.style.borderColor = C.border }} />
        </div>
      </Row>

      <Row>
        <div>
          <Label>Max players</Label>
          <input type="number" min="1" max="500" value={settings.maxPlayers} onChange={e => set('maxPlayers', e.target.value)} style={inp}
            onFocus={e => { e.target.style.borderColor = C.blue }}
            onBlur={e => { e.target.style.borderColor = C.border }} />
        </div>
        <div>
          <Label>Game mode</Label>
          <select value={settings.gamemode} onChange={e => set('gamemode', e.target.value)} style={{ ...inp }}>
            {GAMEMODES.map(g => <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>)}
          </select>
        </div>
      </Row>

      <div>
        <Label>MOTD</Label>
        <input value={settings.motd} onChange={e => set('motd', e.target.value)} style={inp}
          onFocus={e => { e.target.style.borderColor = C.blue }}
          onBlur={e => { e.target.style.borderColor = C.border }}
          placeholder="A Minecraft Server" />
      </div>

      <Row>
        <ToggleField label="Online mode (auth)" value={settings.onlineMode} onChange={v => set('onlineMode', v)} />
        <ToggleField label="PvP enabled" value={settings.pvp} onChange={v => set('pvp', v)} />
      </Row>
    </div>
  )
}

function ToggleField({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px' }}>
      <span style={{ fontSize: 13, color: C.text }}>{label}</span>
      <button type="button" onClick={() => onChange(!value)} style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
        background: value ? C.green : C.border, position: 'relative', transition: 'background 200ms',
      }}>
        <div style={{
          position: 'absolute', top: 3, left: value ? 21 : 3,
          width: 16, height: 16, borderRadius: '50%', background: '#fff',
          transition: 'left 200ms',
        }} />
      </button>
    </div>
  )
}

function StepReview({ engine, version, settings }) {
  const engineOpt = ENGINE_OPTIONS.find(e => e.id === engine) || {}
  const rows = [
    ['Engine', engineOpt.label || engine],
    ['Version', version],
    ['Name', settings.name],
    ['Memory', settings.memory ? `${settings.memory} MB` : '1024 MB'],
    ['Port', settings.port],
    ['Max Players', settings.maxPlayers],
    ['Game mode', settings.gamemode],
    ['Online mode', settings.onlineMode ? 'Yes' : 'No'],
    ['PvP', settings.pvp ? 'Enabled' : 'Disabled'],
    ['MOTD', settings.motd],
  ]

  return (
    <div>
      <div style={{ fontSize: 14, color: C.muted, marginBottom: 20 }}>Review your configuration before creating.</div>
      <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        {rows.map(([label, value], i) => (
          <div key={label} style={{
            display: 'flex', padding: '11px 18px',
            background: i % 2 === 0 ? 'transparent' : `${C.bg}66`,
            borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : 'none',
          }}>
            <span style={{ width: 140, flexShrink: 0, fontSize: 12, color: C.muted, fontWeight: 500 }}>{label}</span>
            <span style={{ fontSize: 13, color: C.text }}>{value}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, padding: '12px 16px', background: `${C.green}10`, border: `1px solid ${C.green}44`, borderRadius: 8, fontSize: 12, color: C.green, lineHeight: 1.5 }}>
        The server JAR will be downloaded automatically. The EULA is accepted on your behalf.
      </div>
    </div>
  )
}

const CREATE_STEPS = [
  'Validating configuration…',
  'Creating server directory…',
  'Downloading server.jar…',
  'Writing server.properties…',
  'Accepting EULA…',
  'Server created!',
]

function CreatingAnimation({ progress, name }) {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '80px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{name || 'Creating server…'}</div>

      <div style={{ width: '100%', background: C.surface2, borderRadius: 4, height: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 4, background: C.green,
          width: `${(progress / 5) * 100}%`,
          transition: 'width 600ms ease',
        }} />
      </div>

      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {CREATE_STEPS.map((label, i) => {
          const done = i < progress
          const active = i === progress
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: done ? C.green : active ? `${C.blue}22` : C.surface2,
                border: `2px solid ${done ? C.green : active ? C.blue : C.border}`,
                fontSize: 10, color: done ? '#0d1117' : C.dim,
                transition: 'all 400ms',
              }}>{done ? '✓' : active ? '…' : ''}</div>
              <span style={{ fontSize: 13, color: done ? C.text : active ? C.text : C.dim, transition: 'color 400ms' }}>{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
