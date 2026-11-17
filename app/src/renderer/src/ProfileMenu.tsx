import { useEffect, useRef, useState } from 'react'
import { Check, Download, Plus, Settings2, Upload } from 'lucide-react'
import type { Go } from './App'
import type { AppState } from './state'
import { ProfileAvatar, cx } from './ui'

const clean = (e: unknown) => ((e as Error).message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Foto do perfil no canto: trocar de perfil, criar, exportar e importar predefinições. */
export default function ProfileMenu({ state, go }: { state: AppState; go: Go }) {
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const info = state.profiles
  const active = info?.profiles.find((p) => p.id === info.activeId) ?? null
  const others = info?.profiles.filter((p) => p.id !== info.activeId) ?? []

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setMsg('')
    try {
      const r = await fn()
      if (r && typeof r === 'object' && 'profiles' in r) state.setProfiles(r as never)
      if (done) setMsg(done)
    } catch (e) {
      setMsg(clean(e))
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(!open)
          setNaming(false)
          setMsg('')
        }}
        title={active ? `Perfil: ${active.name}` : 'Perfil'}
        className={cx('rounded-full transition', open ? 'ring-2 ring-accent' : 'hover:ring-2 hover:ring-white/20')}
      >
        <ProfileAvatar profile={active} size={30} />
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-40 w-72 overflow-hidden rounded-2xl border border-white/10 bg-panel-2/95 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-3 border-b border-white/[0.07] p-4">
            <ProfileAvatar profile={active} size={44} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{active?.name ?? '…'}</p>
              <p className="text-xs text-muted">Perfil deste PC · seus ajustes salvos</p>
            </div>
          </div>

          {others.length > 0 && (
            <div className="border-b border-white/[0.07] py-1.5">
              <p className="px-4 pb-1 text-[11px] text-muted">Trocar de perfil</p>
              {others.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void run(() => window.api.switchProfile(p.id)).then(() => setOpen(false))}
                  className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-[13px] hover:bg-white/[0.07]"
                >
                  <ProfileAvatar profile={p} size={22} />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="py-1.5">
            {naming ? (
              <div className="flex items-center gap-2 px-4 py-1.5">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim()) void run(() => window.api.createProfile(name)).then(() => setOpen(false))
                  }}
                  placeholder="Nome do perfil"
                  className="min-w-0 flex-1 rounded-full border border-white/15 bg-black/20 px-3 py-1 text-[13px] outline-none focus:border-accent"
                />
                <button
                  type="button"
                  disabled={!name.trim()}
                  onClick={() => void run(() => window.api.createProfile(name)).then(() => setOpen(false))}
                  className="grid size-7 place-items-center rounded-full bg-accent text-white disabled:opacity-40"
                  aria-label="Criar perfil"
                >
                  <Check size={14} />
                </button>
              </div>
            ) : (
              <Item icon={Plus} label="Novo perfil" onClick={() => setNaming(true)} />
            )}
            <Item
              icon={Settings2}
              label="Gerenciar perfil"
              onClick={() => {
                go('settings', { settings: 'perfil' })
                setOpen(false)
              }}
            />
            <Item icon={Upload} label="Exportar predefinições" onClick={() => void run(() => window.api.exportProfile().then((p) => (p ? 'ok' : null)), 'Predefinições salvas.')} />
            <Item icon={Download} label="Importar predefinições" onClick={() => void run(() => window.api.importProfile())} />
          </div>
          {msg && <p className="border-t border-white/[0.07] px-4 py-2 text-xs text-muted">{msg}</p>}
        </div>
      )}
    </div>
  )
}

function Item({ icon: Icon, label, onClick }: { icon: typeof Plus; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-[13px] text-text/90 hover:bg-white/[0.07]">
      <Icon size={14} className="text-muted" /> {label}
    </button>
  )
}
