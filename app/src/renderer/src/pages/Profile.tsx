import { useEffect, useState } from 'react'
import { Camera, Download, Upload } from 'lucide-react'
import type { AppState } from '../state'
import { Button, Card, MoreMenu, ProfileAvatar, Row, RowList, Section, cx } from '../ui'

const COLORS = ['#3b7cf6', '#ff3d8b', '#8b5cf6', '#22c55e', '#f5a524', '#06b6d4', '#ef4444']
const clean = (e: unknown) => ((e as Error).message ?? String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Ajustes > Perfil: nome, cor e foto; exportar e importar predefinições; perfis deste PC. */
export function ProfilePanel({ state }: { state: AppState }) {
  const info = state.profiles
  const active = info?.profiles.find((p) => p.id === info.activeId) ?? null
  const [name, setName] = useState(active?.name ?? '')
  const [newName, setNewName] = useState('')
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null)
  useEffect(() => setName(active?.name ?? ''), [active?.id, active?.name])

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null)
    try {
      const r = await fn()
      if (r && typeof r === 'object' && 'profiles' in r) state.setProfiles(r as never)
      if (ok) setMsg({ text: ok })
    } catch (e) {
      setMsg({ text: clean(e), err: true })
    }
  }
  if (!info || !active) return null

  return (
    <div className="space-y-7">
      <Card className="flex flex-wrap items-center gap-5 p-5">
        <div className="relative">
          <ProfileAvatar profile={active} size={72} />
          <button
            type="button"
            title="Trocar a foto"
            onClick={() => void run(() => window.api.pickProfilePhoto(active.id))}
            className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full bg-accent text-white shadow ring-2 ring-[#1e1a2a]"
          >
            <Camera size={13} />
          </button>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== active.name && void run(() => window.api.updateProfile(active.id, { name }))}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full max-w-sm rounded-full border border-white/15 bg-black/20 px-4 py-1.5 text-[15px] font-semibold outline-none focus:border-accent"
            aria-label="Nome do perfil"
          />
          <div className="flex items-center gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Cor ${c}`}
                onClick={() => void run(() => window.api.updateProfile(active.id, { color: c }))}
                className={cx('size-6 rounded-full ring-offset-2 ring-offset-[#1e1a2a] transition', active.color === c ? 'ring-2 ring-white' : 'hover:scale-110')}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </Card>

      <Section title="Predefinições">
        <Card className="space-y-3">
          <p className="text-[13px] text-muted">
            Este perfil guarda detecção, IA, layout e legenda dos clipes e gravação. Pastas e programas são do PC e não mudam entre perfis. Para levar suas
            predefinições a outro PC (ou passar para um amigo), exporte o arquivo e importe lá.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => void run(() => window.api.exportProfile().then((p) => (p ? true : null)), 'Predefinições salvas no arquivo.')}>
              <Upload size={13} /> Exportar
            </Button>
            <Button variant="ghost" onClick={() => void run(() => window.api.importProfile(), 'Perfil importado e ativo.')}>
              <Download size={13} /> Importar
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="Perfis deste PC">
        <RowList>
          {info.profiles.map((p) => (
            <Row key={p.id}>
              <ProfileAvatar profile={p} size={30} />
              <span className="flex-1 text-[13px] font-medium">{p.name}</span>
              {p.id === info.activeId ? (
                <span className="text-xs text-ok">Em uso</span>
              ) : (
                <Button variant="ghost" onClick={() => void run(() => window.api.switchProfile(p.id))}>
                  Entrar
                </Button>
              )}
              <MoreMenu
                items={[
                  {
                    label: 'Apagar perfil',
                    danger: true,
                    hidden: p.id === info.activeId,
                    onClick: () => confirm(`Apagar o perfil ${p.name}? Os ajustes dele somem; clipes e gravações ficam.`) && void run(() => window.api.deleteProfile(p.id))
                  }
                ]}
              />
            </Row>
          ))}
          <Row>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newName.trim() && void run(() => window.api.createProfile(newName)).then(() => setNewName(''))}
              placeholder="Nome de um novo perfil"
              className="min-w-0 flex-1 rounded-full border border-white/15 bg-black/20 px-3 py-1 text-[13px] outline-none placeholder:text-muted focus:border-accent"
            />
            <Button disabled={!newName.trim()} onClick={() => void run(() => window.api.createProfile(newName)).then(() => setNewName(''))}>
              Criar e entrar
            </Button>
          </Row>
        </RowList>
        <p className="text-xs text-muted">Perfil novo começa com os ajustes padrão. Os perfis ficam só neste PC, sem senha.</p>
      </Section>

      {msg && <p className={msg.err ? 'text-[13px] text-err' : 'text-[13px] text-ok'}>{msg.text}</p>}
    </div>
  )
}
