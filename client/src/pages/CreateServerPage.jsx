import React from 'react'
import { apiFetch, C, NumberInput } from '../lib/yamsShared'
import ModpackBrowser from '../components/ModpackBrowser'

const ENGINE_OPTIONS = [
  { id: 'vanilla',  label: 'Vanilla',  desc: 'Official Mojang server',       logo: 'https://github.com/Mojang.png',    color: '#3fb950' },
  { id: 'paper',    label: 'Paper',    desc: 'High-performance fork',         logo: 'https://github.com/PaperMC.png',   color: '#388bfd' },
  { id: 'fabric',   label: 'Fabric',   desc: 'Lightweight mod loader',        logo: 'https://github.com/FabricMC.png',  color: '#d29922' },
  { id: 'purpur',   label: 'Purpur',   desc: 'Fork of Paper with extras',     logo: 'https://github.com/PurpurMC.png',  color: '#f778ba' },
  { id: 'neoforge', label: 'NeoForge', desc: 'Modern Forge fork',             logo: 'https://github.com/neoforged.png', color: '#f0883e' },
  { id: 'spigot',   label: 'Spigot',   desc: 'Bukkit-compatible plugins',     logo: 'https://github.com/SpigotMC.png',  color: '#bc8cff', manualOnly: true },
]

const MC_VERSIONS = [
  '1.21.4', '1.21.3', '1.21.1', '1.21',
  '1.20.6', '1.20.4', '1.20.2', '1.20.1',
  '1.19.4', '1.19.2', '1.18.2', '1.17.1',
]

const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator']

// ── Shared settings fields ────────────────────────────────────────────────────

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

// ── WS URL helper (same as ConsolePage) ──────────────────────────────────────
function wsBaseUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

// ── Wizard stepper ────────────────────────────────────────────────────────────
function Stepper({ steps, step }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 36, flexShrink: 0 }}>
      {steps.map((label, i) => (
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
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: 2, margin: '0 10px', background: i < step ? C.green : C.surface2, transition: 'background 200ms' }} />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CreateServerPage({ onCreated, onCancel }) {
  const [mode, setMode] = React.useState(null) // null = mode picker | 'manual' | 'modpack'
  const [platforms, setPlatforms] = React.useState(['modrinth'])

  // Fetch available platforms on mount
  React.useEffect(() => {
    apiFetch('/modpacks/platforms')
      .then(res => setPlatforms(res.data ?? ['modrinth']))
      .catch(() => {})
  }, [])

  if (!mode) {
    return <ModePicker onPick={setMode} onCancel={onCancel} />
  }

  if (mode === 'manual') {
    return <ManualWizard onCreated={onCreated} onCancel={() => setMode(null)} />
  }

  return <ModpackWizard onCreated={onCreated} onCancel={() => setMode(null)} platforms={platforms} />
}

// ── Mode picker ───────────────────────────────────────────────────────────────

function ModePicker({ onPick, onCancel }) {
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '48px 24px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 40, flexShrink: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>New Server</h1>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
      </div>

      <div style={{ fontSize: 14, color: C.muted, marginBottom: 24 }}>How do you want to create this server?</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <button onClick={() => onPick('manual')} style={{
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10,
          padding: '22px 20px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
          background: C.surface2, border: `2px solid ${C.border}`,
          transition: 'border-color 150ms',
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
          onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
        >
          <div style={{ fontSize: 24 }}>⚙️</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Manual Setup</div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>Pick an engine (Vanilla, Paper, Fabric…) and Minecraft version.</div>
        </button>

        <button onClick={() => onPick('modpack')} style={{
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10,
          padding: '22px 20px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
          background: C.surface2, border: `2px solid ${C.border}`,
          transition: 'border-color 150ms',
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = C.purple}
          onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
        >
          <div style={{ fontSize: 24 }}>📦</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>From Modpack</div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>Search Modrinth (or CurseForge) and import a full modpack automatically.</div>
        </button>
      </div>
    </div>
  )
}

// ── Manual wizard (original flow, unchanged) ──────────────────────────────────

function ManualWizard({ onCreated, onCancel }) {
  const [step, setStep]         = React.useState(0)
  const [engine, setEngine]     = React.useState('')
  const [version, setVersion]   = React.useState('')
  const [settings, setSettings] = React.useState({
    name: '', memory: '', port: '25565',
    maxPlayers: '20', gamemode: 'survival',
    motd: 'A YAMS Minecraft Server',
    onlineMode: true, pvp: true,
  })
  const [creating, setCreating] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [error, setError]       = React.useState(null)

  const STEPS = ['Engine', 'Version', 'Settings', 'Review']

  function canAdvance() {
    if (step === 0) return !!engine
    if (step === 1) return !!version
    if (step === 2) return /^[A-Za-z][A-Za-z0-9-]{2,31}$/.test(settings.name.trim())
    return true
  }

  function handleNext() { if (canAdvance()) setStep(s => s + 1) }
  function handleBack() { setStep(s => s - 1); setError(null) }

  async function handleCreate() {
    setCreating(true)
    setProgress(0)
    setError(null)

    const interval = setInterval(() => {
      setProgress(p => { if (p >= 2) { clearInterval(interval); return 2 } return p + 1 })
    }, 900)

    try {
      const res = await apiFetch('/servers', {
        method: 'POST',
        body: JSON.stringify({
          name: settings.name.trim(),
          port: parseInt(settings.port, 10),
          ram: settings.memory ? `${settings.memory}M` : '1024M',
          engine, version,
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
        <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>New Server — Manual</h1>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
      </div>

      <Stepper steps={STEPS} step={step} />

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
        }}>{step === 0 ? '← Back' : '← Back'}</button>

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

// ── Modpack wizard ────────────────────────────────────────────────────────────

function ModpackWizard({ onCreated, onCancel, platforms }) {
  const [step, setStep]                   = React.useState(0)
  const [selectedPack, setSelectedPack]   = React.useState(null)
  const [selectedVersion, setSelectedVersion] = React.useState(null)
  const [settings, setSettings]           = React.useState({
    name: '', memory: '', port: '25565',
    motd: 'A YAMS Minecraft Server',
    onlineMode: true, pvp: true,
  })
  const [error, setError]   = React.useState(null)
  const [serverId, setServerId] = React.useState(null)
  const [installing, setInstalling] = React.useState(false)

  const STEPS = ['Search', 'Version', 'Settings', 'Review']

  function canAdvance() {
    if (step === 0) return !!selectedPack
    if (step === 1) return !!selectedVersion?.fileUrl
    if (step === 2) return /^[A-Za-z][A-Za-z0-9-]{2,31}$/.test(settings.name.trim())
    return true
  }

  function handleNext() { if (canAdvance()) { setStep(s => s + 1); setError(null) } }
  function handleBack() { setStep(s => s - 1); setError(null) }

  async function handleCreate() {
    setError(null)
    try {
      const res = await apiFetch('/servers', {
        method: 'POST',
        body: JSON.stringify({
          name:                 settings.name.trim(),
          port:                 parseInt(settings.port, 10),
          ram:                  settings.memory ? `${settings.memory}M` : '1024M',
          motd:                 settings.motd,
          pvp:                  settings.pvp,
          onlineMode:           settings.onlineMode,
          modpackPlatform:      selectedPack.platform,
          modpackProjectId:     selectedPack.projectId,
          modpackVersionId:     selectedVersion.id,
          modpackVersionFileUrl: selectedVersion.fileUrl,
          modpackVersionName:   selectedVersion.name,
        }),
      })
      setServerId(res.data.id)
      setInstalling(true)
    } catch (err) {
      setError(err.message || 'Failed to start installation.')
    }
  }

  if (installing && serverId) {
    return <ModpackInstallProgress serverId={serverId} serverName={settings.name} packName={selectedPack?.title} onDone={onCreated} />
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, flexShrink: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>New Server — From Modpack</h1>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
      </div>

      <Stepper steps={STEPS} step={step} />

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {step === 0 && (
          <ModpackBrowser
            selectedPack={selectedPack}
            onSelectPack={pack => { setSelectedPack(pack); setSelectedVersion(null) }}
            platforms={platforms}
          />
        )}
        {step === 1 && (
          <ModpackVersionStep
            selectedPack={selectedPack}
            selectedVersion={selectedVersion}
            onSelectVersion={setSelectedVersion}
          />
        )}
        {step === 2 && <ModpackSettings settings={settings} setSettings={setSettings} />}
        {step === 3 && <ModpackReview pack={selectedPack} version={selectedVersion} settings={settings} />}
        {error && (
          <div style={{ marginTop: 20, background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 6, padding: '10px 14px', fontSize: 12, color: C.red }}>{error}</div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 20, marginTop: 16, borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
        <button onClick={step === 0 ? onCancel : handleBack} style={{
          padding: '9px 22px', borderRadius: 7, border: `1px solid ${C.border}`,
          background: 'none', color: C.muted, fontSize: 13, cursor: 'pointer',
        }}>← Back</button>

        {step < 3
          ? <button onClick={handleNext} disabled={!canAdvance()} style={{
              padding: '9px 28px', borderRadius: 7, border: 'none',
              background: canAdvance() ? C.blue : C.surface2,
              color: canAdvance() ? '#fff' : C.dim,
              fontSize: 13, fontWeight: 600, cursor: canAdvance() ? 'pointer' : 'default',
            }}>Next →</button>
          : <button onClick={handleCreate} style={{
              padding: '9px 28px', borderRadius: 7, border: 'none',
              background: C.purple, color: '#fff',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>Install Modpack</button>
        }
      </div>
    </div>
  )
}

// ── Modpack version step ──────────────────────────────────────────────────────

const LOADER_COLORS = { fabric: C.amber, forge: '#f0883e', neoforge: '#f0883e', quilt: '#bc8cff' }
function loaderColor(l) { return LOADER_COLORS[l?.toLowerCase()] ?? C.muted }

function normaliseVersion(v, platform) {
  if (platform === 'modrinth') {
    const file = v.files?.[0]
    return { id: v.id, name: v.name || v.version_number, mcVersions: v.game_versions ?? [], loaders: v.loaders ?? [], fileUrl: file?.url, fileName: file?.filename }
  }
  const loaderStr = v.sortableGameVersions?.find(g => g.gameVersionTypeId === 68441)?.gameVersionName ?? ''
  return {
    id: String(v.id), name: v.displayName || v.fileName,
    mcVersions: [v.gameVersions?.find(g => !g.includes('-'))].filter(Boolean),
    loaders: loaderStr ? [loaderStr.split('-')[0].toLowerCase()] : [],
    fileUrl: v.downloadUrl, fileName: v.fileName,
  }
}

function ModpackVersionStep({ selectedPack, selectedVersion, onSelectVersion }) {
  const [versions, setVersions] = React.useState([])
  const [loading, setLoading]   = React.useState(true)
  const [error, setError]       = React.useState(null)

  React.useEffect(() => {
    if (!selectedPack) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setVersions([])

    apiFetch(`/modpacks/${selectedPack.platform}/${selectedPack.projectId}/versions`)
      .then(res => {
        if (cancelled) return
        const normed = (res.data ?? []).map(v => normaliseVersion(v, selectedPack.platform))
        setVersions(normed)
        setLoading(false)
        if (normed.length > 0 && !selectedVersion) onSelectVersion(normed[0])
      })
      .catch(err => {
        if (!cancelled) { setLoading(false); setError(err.message ?? 'Failed to load versions') }
      })

    return () => { cancelled = true }
  }, [selectedPack?.projectId])

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', padding: '48px 0', color: C.muted, fontSize: 13 }}>
        Loading versions for {selectedPack?.title}…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '12px 14px', background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 8, color: C.red, fontSize: 13 }}>
        {error}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>
        Select a version of <strong style={{ color: C.text }}>{selectedPack?.title}</strong> to install.
      </div>

      {versions.map(v => {
        const isSelected = selectedVersion?.id === v.id
        const restricted = !v.fileUrl
        return (
          <button key={v.id} onClick={() => !restricted && onSelectVersion(v)} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
            borderRadius: 8, textAlign: 'left',
            cursor: restricted ? 'not-allowed' : 'pointer',
            opacity: restricted ? 0.5 : 1,
            background: isSelected ? `${C.green}18` : C.surface2,
            border: `2px solid ${isSelected ? C.green : C.border}`,
            boxShadow: isSelected ? `inset 3px 0 0 ${C.green}` : 'none',
            transition: 'all 150ms',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: isSelected ? C.green : C.text }}>{v.name}</div>
              {restricted && <div style={{ fontSize: 10, color: C.amber, marginTop: 2 }}>Distribution restricted — cannot auto-install</div>}
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {v.mcVersions.slice(0, 1).map(mc => (
                <span key={mc} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: `${C.blue}18`, color: C.blue, border: `1px solid ${C.blue}44`, fontWeight: 500 }}>MC {mc}</span>
              ))}
              {v.loaders.slice(0, 1).map(l => (
                <span key={l} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: `${loaderColor(l)}18`, color: loaderColor(l), border: `1px solid ${loaderColor(l)}44`, fontWeight: 500 }}>
                  {l.charAt(0).toUpperCase() + l.slice(1)}
                </span>
              ))}
            </div>
            {isSelected && (
              <div style={{ flexShrink: 0, width: 20, height: 20, borderRadius: '50%', background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#0d1117', fontWeight: 700 }}>✓</div>
            )}
          </button>
        )
      })}

      {versions.length === 0 && (
        <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', padding: 32 }}>No versions available.</div>
      )}
    </div>
  )
}

// ── Modpack settings step (name/port/RAM only) ────────────────────────────────

function ModpackSettings({ settings, setSettings }) {
  function set(key, val) { setSettings(s => ({ ...s, [key]: val })) }
  const isValidName = /^[A-Za-z][A-Za-z0-9-]{2,31}$/.test(settings.name.trim())
  const nameError = settings.name.length > 0 && !isValidName
    ? 'Name must start with a letter, use only letters, numbers, hyphens (3–32 chars).' : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ fontSize: 13, color: C.muted, padding: '10px 14px', background: `${C.blue}0d`, border: `1px solid ${C.blue}33`, borderRadius: 6 }}>
        The mod loader and Minecraft version will be set automatically from the modpack.
      </div>

      <div>
        <SettingsLabel>Server name *</SettingsLabel>
        <input value={settings.name} onChange={e => set('name', e.target.value)}
          style={{ ...settingsInp, borderColor: nameError ? C.red : C.border }}
          onFocus={e => { e.target.style.borderColor = nameError ? C.red : C.blue }}
          onBlur={e => { e.target.style.borderColor = nameError ? C.red : C.border }}
          placeholder="my-modpack-server" />
        {nameError && <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{nameError}</div>}
      </div>

      <SettingsRow>
        <div>
          <SettingsLabel>Memory (MB)</SettingsLabel>
          <NumberInput min={512} value={settings.memory} onChange={e => set('memory', e.target.value)} placeholder="e.g. 4096" step={512} />
        </div>
        <div>
          <SettingsLabel>Port</SettingsLabel>
          <NumberInput min={1024} max={65535} value={settings.port} onChange={e => set('port', e.target.value)} />
        </div>
      </SettingsRow>

      <div>
        <SettingsLabel>MOTD</SettingsLabel>
        <input value={settings.motd} onChange={e => set('motd', e.target.value)} style={settingsInp}
          onFocus={e => { e.target.style.borderColor = C.blue }}
          onBlur={e => { e.target.style.borderColor = C.border }}
          placeholder="A Minecraft Server" />
      </div>

      <SettingsRow>
        <ToggleField label="Online mode (auth)" value={settings.onlineMode} onChange={v => set('onlineMode', v)} />
        <ToggleField label="PvP enabled" value={settings.pvp} onChange={v => set('pvp', v)} />
      </SettingsRow>
    </div>
  )
}

// ── Modpack review step ───────────────────────────────────────────────────────

function ModpackReview({ pack, version, settings }) {
  const rows = [
    ['Modpack',  pack?.title ?? '—'],
    ['Version',  version?.name ?? '—'],
    ['Platform', pack?.platform ?? '—'],
    ['Name',     settings.name],
    ['Memory',   settings.memory ? `${settings.memory} MB` : '1024 MB'],
    ['Port',     settings.port],
    ['MOTD',     settings.motd],
    ['Online mode', settings.onlineMode ? 'Yes' : 'No'],
    ['PvP',      settings.pvp ? 'Enabled' : 'Disabled'],
  ]

  return (
    <div>
      <div style={{ fontSize: 14, color: C.muted, marginBottom: 20 }}>Review before installing. The modpack will download in the background.</div>
      <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        {rows.map(([label, value], i) => (
          <div key={label} style={{
            display: 'flex', padding: '11px 18px',
            background: i % 2 === 0 ? 'transparent' : `${C.bg}66`,
            borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : 'none',
          }}>
            <span style={{ width: 140, flexShrink: 0, fontSize: 12, color: C.muted, fontWeight: 500 }}>{label}</span>
            <span style={{ fontSize: 13, color: C.text, textTransform: label === 'Platform' ? 'capitalize' : 'none' }}>{value}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, padding: '12px 16px', background: `${C.purple}10`, border: `1px solid ${C.purple}44`, borderRadius: 8, fontSize: 12, color: C.purple, lineHeight: 1.5 }}>
        Mods will be downloaded from {pack?.platform === 'modrinth' ? 'Modrinth' : 'CurseForge'}. Install progress is shown in real time.
      </div>
    </div>
  )
}

// ── Real-time modpack install progress ────────────────────────────────────────

function fmtSpeed(bytesPerSec) {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(2)} MB/s`
  if (bytesPerSec >= 1024)        return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${bytesPerSec.toFixed(0)} B/s`
}

function ModpackInstallProgress({ serverId, serverName, packName, onDone }) {
  const [step, setStep]           = React.useState('connecting')
  const [message, setMessage]     = React.useState('Connecting…')
  const [current, setCurrent]     = React.useState(0)
  const [total, setTotal]         = React.useState(0)
  const [speed, setSpeed]         = React.useState(null)   // bytes/sec or null
  const [activeMod, setActiveMod] = React.useState(null)
  const [modLog, setModLog]       = React.useState([])
  const [error, setError]         = React.useState(null)
  const [done, setDone]           = React.useState(false)
  const [skipped, setSkipped]     = React.useState([])
  const [manualPhase, setManualPhase] = React.useState(false)
  const wsRef      = React.useRef(null)
  const logRef     = React.useRef(null)
  // Rolling speed samples: [{time, bytes}] — keep last 5 samples for smoothing
  const speedBuf   = React.useRef([])

  React.useEffect(() => {
    const token = sessionStorage.getItem('yams_token') ?? ''
    const url = `${wsBaseUrl()}${token ? `?token=${token}` : ''}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => ws.send(JSON.stringify({ action: 'subscribe', serverId }))

    ws.onmessage = e => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }

      if (msg.type === 'status' && msg.data === 'installing') {
        setStep('installing'); setMessage('Preparing installation…')
      }
      if (msg.type === 'install_progress') {
        setStep(msg.step)
        if (msg.step === 'downloading_mods') {
          const n = msg.current ?? 0
          const t = msg.total ?? 0
          setCurrent(n); setTotal(t)
          // Rolling speed calculation from cumulative bytes
          if (msg.totalBytes != null) {
            const now = Date.now()
            const buf = speedBuf.current
            buf.push({ time: now, bytes: msg.totalBytes })
            if (buf.length > 6) buf.shift()
            if (buf.length >= 2) {
              const oldest = buf[0]
              const elapsed = (now - oldest.time) / 1000
              if (elapsed > 0) setSpeed((msg.totalBytes - oldest.bytes) / elapsed)
            }
          }
          if (msg.name) {
            setActiveMod(msg.name)
            if (n > 0) setModLog(prev => [...prev, msg.name])
          }
          setMessage(null)
        } else {
          setActiveMod(null); setSpeed(null)
          setMessage(msg.message ?? msg.step)
        }
      }
      if (msg.type === 'install_complete') {
        setStep('complete'); setActiveMod(null); setSpeed(null); setDone(true)
        setSkipped(msg.skippedMods ?? [])
        ws.close()
      }
      if (msg.type === 'install_error') { setError(msg.message); ws.close() }
      if (msg.type === 'install_cancelled') { setError('Installation was cancelled.'); ws.close() }
    }

    ws.onclose = () => {}
    ws.onerror = () => setError('WebSocket connection failed.')
    return () => ws.close()
  }, [serverId])

  // Auto-scroll log to bottom as new entries arrive
  React.useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [modLog])

  async function handleCancel() {
    wsRef.current?.close()
    try { await apiFetch(`/servers/${serverId}/cancel-install`, { method: 'POST' }) } catch {}
    onDone && onDone()
  }

  function openDownloadTabs() {
    for (const mod of skipped.filter(m => m.reason !== 'client_only')) {
      const url = mod.pageUrl ?? `https://www.curseforge.com/projects/${mod.projectId}`
      window.open(url, '_blank')
    }
    setManualPhase(true)
  }

  const pct = total > 0 ? Math.round((current / total) * 100) : (done ? 100 : 0)
  const isDownloadingMods = step === 'downloading_mods'

  if (manualPhase) {
    return <ModUploadZone serverId={serverId} mods={skipped.filter(m => m.reason !== 'client_only')} onDone={onDone} />
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text, textAlign: 'center' }}>
        {error ? 'Installation Failed' : done ? 'Installed!' : `Installing ${packName ?? 'modpack'}…`}
      </div>

      {!error && (
        <>
          {/* Progress bar */}
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: C.muted }}>
                {isDownloadingMods ? `Downloading mods` : (message ?? 'Working…')}
              </span>
              {isDownloadingMods && total > 0 && (
                <span style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontVariantNumeric: 'tabular-nums' }}>
                  {speed != null && (
                    <span style={{ fontSize: 11, color: C.blue, fontWeight: 600 }}>{fmtSpeed(speed)}</span>
                  )}
                  <span style={{ fontSize: 11, color: C.muted }}>
                    {current} / {total} <span style={{ color: C.dim }}>({pct}%)</span>
                  </span>
                </span>
              )}
            </div>
            <div style={{ width: '100%', background: C.surface2, borderRadius: 4, height: 6, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 4, background: done ? C.green : C.blue, width: `${pct}%`, transition: 'width 300ms ease' }} />
            </div>
          </div>

          {/* Mod download log — only shown during mod download phase */}
          {(isDownloadingMods || modLog.length > 0) && (
            <div style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
              {/* Scrollable log of completed mods */}
              <div
                ref={logRef}
                style={{ maxHeight: 180, overflowY: 'auto', padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 1 }}
              >
                {modLog.map((name, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px' }}>
                    <span style={{ fontSize: 11, color: C.green, flexShrink: 0 }}>✓</span>
                    <span style={{ fontSize: 11, color: C.dim, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  </div>
                ))}
                {modLog.length === 0 && !activeMod && (
                  <div style={{ padding: '8px 12px', fontSize: 11, color: C.dim }}>Starting download…</div>
                )}
              </div>
              {/* Currently downloading — pinned at bottom */}
              {activeMod && (
                <div style={{ borderTop: `1px solid ${C.border}`, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, background: `${C.blue}0a` }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${C.blue}`, borderTopColor: 'transparent', flexShrink: 0, animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
                  <span style={{ fontSize: 11, color: C.blue, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeMod}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <div style={{ width: '100%', background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 8, padding: '14px 16px', fontSize: 12, color: C.red, textAlign: 'center' }}>
          {error}
        </div>
      )}

      {done && skipped.some(m => m.reason === 'client_only') && (
        <div style={{ width: '100%', background: `${C.blue}0e`, border: `1px solid ${C.blue}33`, borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.blue, marginBottom: 4 }}>
            {skipped.filter(m => m.reason === 'client_only').length} client-side mod{skipped.filter(m => m.reason === 'client_only').length > 1 ? 's' : ''} skipped
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 8 }}>
            These mods are not needed on the server and were not installed.
          </div>
          <ul style={{ margin: 0, padding: '0 0 0 16px', maxHeight: 120, overflowY: 'auto' }}>
            {skipped.filter(m => m.reason === 'client_only').map((m, i) => (
              <li key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: C.dim, lineHeight: 1.8 }}>{m.name}</li>
            ))}
          </ul>
        </div>
      )}

      {done && skipped.some(m => m.reason !== 'client_only') && (
        <div style={{ width: '100%', background: `${C.amber}12`, border: `1px solid ${C.amber}44`, borderRadius: 8, padding: '16px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.amber, marginBottom: 6 }}>
            {skipped.filter(m => m.reason !== 'client_only').length} mod{skipped.filter(m => m.reason !== 'client_only').length > 1 ? 's' : ''} need manual installation
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>
            These mods are distribution-restricted — CurseForge requires you to download them directly.
            Click below to open each mod's page, then drop the downloaded <code>.jar</code> files here.
          </div>
          <ul style={{ margin: '0 0 14px 0', padding: '0 0 0 16px', maxHeight: 160, overflowY: 'auto' }}>
            {skipped.filter(m => m.reason !== 'client_only').map((m, i) => (
              <li key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: C.muted, lineHeight: 1.8 }}>{m.name}</li>
            ))}
          </ul>
          <button onClick={openDownloadTabs} style={{
            width: '100%', padding: '9px 0', borderRadius: 7, border: 'none',
            background: C.amber, color: '#0d1117', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
            Open {skipped.filter(m => m.reason !== 'client_only').length} download tab{skipped.filter(m => m.reason !== 'client_only').length > 1 ? 's' : ''} + upload mods →
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12 }}>
        {done && !skipped.some(m => m.reason !== 'client_only') && (
          <button onClick={() => onDone && onDone()} style={{
            padding: '9px 28px', borderRadius: 7, border: 'none',
            background: C.green, color: '#0d1117', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>Go to server →</button>
        )}
        {done && skipped.some(m => m.reason !== 'client_only') && (
          <button onClick={() => onDone && onDone()} style={{
            padding: '9px 22px', borderRadius: 7, border: `1px solid ${C.border}`,
            background: 'none', color: C.muted, fontSize: 13, cursor: 'pointer',
          }}>Skip — go to server</button>
        )}
        {error && (
          <button onClick={() => onDone && onDone()} style={{
            padding: '9px 22px', borderRadius: 7, border: `1px solid ${C.border}`,
            background: 'none', color: C.muted, fontSize: 13, cursor: 'pointer',
          }}>Back to dashboard</button>
        )}
        {!done && !error && (
          <button onClick={handleCancel} style={{
            padding: '9px 20px', borderRadius: 7, border: `1px solid ${C.red}44`,
            background: `${C.red}0d`, color: C.red, fontSize: 12, cursor: 'pointer',
          }}>Cancel installation</button>
        )}
      </div>
    </div>
  )
}

// ── Drag-and-drop mod uploader ────────────────────────────────────────────────

function ModUploadZone({ serverId, mods, onDone }) {
  const [uploads, setUploads] = React.useState(
    () => mods.map(m => ({ ...m, status: 'pending' }))   // pending | uploading | done | error
  )
  const [dragging, setDragging] = React.useState(false)

  const allDone = uploads.every(u => u.status === 'done')

  async function uploadFile(file) {
    const form = new FormData()
    form.append('file', file)
    const token = sessionStorage.getItem('yams_token') ?? ''
    const res = await fetch(`/api/servers/${serverId}/mods/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
    if (!res.ok) throw new Error(`Upload failed (${res.status})`)
  }

  async function handleFiles(files) {
    for (const file of files) {
      if (!file.name.endsWith('.jar')) continue
      const modName = file.name
      setUploads(prev => prev.map(u =>
        u.name === modName ? { ...u, status: 'uploading' } : u
      ))
      try {
        await uploadFile(file)
        setUploads(prev => prev.map(u =>
          u.name === modName ? { ...u, status: 'done' } : u
        ))
      } catch (err) {
        setUploads(prev => prev.map(u =>
          u.name === modName ? { ...u, status: 'error', errorMsg: err.message } : u
        ))
      }
    }
  }

  function onDrop(e) {
    e.preventDefault(); setDragging(false)
    handleFiles(Array.from(e.dataTransfer.files))
  }

  const statusIcon  = { pending: '○', uploading: '↑', done: '✓', error: '✕' }
  const statusColor = { pending: C.dim, uploading: C.blue, done: C.green, error: C.red }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 20, height: 'calc(100vh - 48px)', boxSizing: 'border-box' }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>Upload missing mods</div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
          Download each mod from the browser tabs that just opened, then drag the <code>.jar</code> files into the zone below.
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragging ? C.blue : C.border}`,
          borderRadius: 10, padding: '40px 24px', textAlign: 'center',
          background: dragging ? `${C.blue}0a` : C.surface2,
          transition: 'all 150ms', cursor: 'pointer', flexShrink: 0,
        }}
        onClick={() => document.getElementById('mod-file-input').click()}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }}>📦</div>
        <div style={{ fontSize: 13, color: dragging ? C.blue : C.muted, fontWeight: 500 }}>
          {dragging ? 'Drop .jar files here' : 'Drag & drop .jar files here, or click to browse'}
        </div>
        <input
          id="mod-file-input" type="file" accept=".jar" multiple
          style={{ display: 'none' }}
          onChange={e => { handleFiles(Array.from(e.target.files)); e.target.value = '' }}
        />
      </div>

      {/* Mod checklist */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {uploads.map((u, i) => {
          const pageUrl = u.pageUrl ?? (u.projectId ? `https://www.curseforge.com/projects/${u.projectId}` : null)
          return (
            <div
              key={i}
              onClick={() => pageUrl && window.open(pageUrl, '_blank')}
              title={pageUrl ? 'Click to open download page' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                borderRadius: 7, background: C.surface2,
                border: `1px solid ${u.status === 'done' ? `${C.green}44` : C.border}`,
                cursor: pageUrl ? 'pointer' : 'default',
                transition: 'background 150ms',
              }}
              onMouseEnter={e => { if (pageUrl) e.currentTarget.style.background = C.surface }}
              onMouseLeave={e => { e.currentTarget.style.background = C.surface2 }}
            >
              <span style={{ fontSize: 14, color: statusColor[u.status], flexShrink: 0, fontWeight: 700 }}>
                {statusIcon[u.status]}
              </span>
              <span style={{ flex: 1, fontSize: 12, fontFamily: 'monospace', color: u.status === 'done' ? C.text : C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.name}
              </span>
              {u.status === 'uploading' && <span style={{ fontSize: 11, color: C.blue, flexShrink: 0 }}>Uploading…</span>}
              {u.status === 'error'     && <span style={{ fontSize: 11, color: C.red, flexShrink: 0 }}>{u.errorMsg}</span>}
              {u.status === 'done'      && <span style={{ fontSize: 11, color: C.green, flexShrink: 0 }}>Uploaded</span>}
              {u.status === 'pending' && pageUrl && (
                <span style={{ fontSize: 10, color: C.dim, flexShrink: 0 }}>↗</span>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
        <button onClick={() => onDone && onDone()} style={{
          padding: '9px 22px', borderRadius: 7, border: `1px solid ${C.border}`,
          background: 'none', color: C.muted, fontSize: 13, cursor: 'pointer',
        }}>Skip remaining</button>
        {allDone && (
          <button onClick={() => onDone && onDone()} style={{
            padding: '9px 28px', borderRadius: 7, border: 'none',
            background: C.green, color: '#0d1117', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>Go to server →</button>
        )}
      </div>
    </div>
  )
}

// ── Manual wizard steps (unchanged from original) ─────────────────────────────

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

function StepSettings({ settings, setSettings }) {
  function set(key, val) { setSettings(s => ({ ...s, [key]: val })) }
  const isValidName = /^[A-Za-z][A-Za-z0-9-]{2,31}$/.test(settings.name.trim())
  const nameError = settings.name.length > 0 && !isValidName
    ? 'Name must start with a letter, use only letters, numbers, hyphens (3–32 chars).' : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <SettingsLabel>Server name *</SettingsLabel>
        <input value={settings.name} onChange={e => set('name', e.target.value)}
          style={{ ...settingsInp, borderColor: nameError ? C.red : C.border }}
          onFocus={e => { e.target.style.borderColor = nameError ? C.red : C.blue }}
          onBlur={e => { e.target.style.borderColor = nameError ? C.red : C.border }}
          placeholder="my-survival-server" />
        {nameError && <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{nameError}</div>}
      </div>
      <SettingsRow>
        <div>
          <SettingsLabel>Memory (MB)</SettingsLabel>
          <NumberInput min={512} value={settings.memory} onChange={e => set('memory', e.target.value)} placeholder="e.g. 1024" step={512} />
        </div>
        <div>
          <SettingsLabel>Port</SettingsLabel>
          <NumberInput min={1024} max={65535} value={settings.port} onChange={e => set('port', e.target.value)} />
        </div>
      </SettingsRow>
      <SettingsRow>
        <div>
          <SettingsLabel>Max players</SettingsLabel>
          <NumberInput min={1} max={500} value={settings.maxPlayers} onChange={e => set('maxPlayers', e.target.value)} />
        </div>
        <div>
          <SettingsLabel>Game mode</SettingsLabel>
          <select value={settings.gamemode} onChange={e => set('gamemode', e.target.value)} style={{ ...settingsInp }}>
            {GAMEMODES.map(g => <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>)}
          </select>
        </div>
      </SettingsRow>
      <div>
        <SettingsLabel>MOTD</SettingsLabel>
        <input value={settings.motd} onChange={e => set('motd', e.target.value)} style={settingsInp}
          onFocus={e => { e.target.style.borderColor = C.blue }}
          onBlur={e => { e.target.style.borderColor = C.border }}
          placeholder="A Minecraft Server" />
      </div>
      <SettingsRow>
        <ToggleField label="Online mode (auth)" value={settings.onlineMode} onChange={v => set('onlineMode', v)} />
        <ToggleField label="PvP enabled" value={settings.pvp} onChange={v => set('pvp', v)} />
      </SettingsRow>
    </div>
  )
}

function StepReview({ engine, version, settings }) {
  const engineOpt = ENGINE_OPTIONS.find(e => e.id === engine) || {}
  const rows = [
    ['Engine',      engineOpt.label || engine],
    ['Version',     version],
    ['Name',        settings.name],
    ['Memory',      settings.memory ? `${settings.memory} MB` : '1024 MB'],
    ['Port',        settings.port],
    ['Max Players', settings.maxPlayers],
    ['Game mode',   settings.gamemode],
    ['Online mode', settings.onlineMode ? 'Yes' : 'No'],
    ['PvP',         settings.pvp ? 'Enabled' : 'Disabled'],
    ['MOTD',        settings.motd],
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
