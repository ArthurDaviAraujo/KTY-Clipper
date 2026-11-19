import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { cpus } from 'os'
import { dirname, join } from 'path'
import type { Db } from './db'
import type { JobContext, JobQueue } from './jobs'
import type { Logger } from './logs'
import { analyzeAudio } from './audio'
import { findVoiceTriggers, transcribe, type SpeechTools } from './speech'
import { BUCKET_S, classifyMessage, detectMoments, hypeSeries, type Bucket, type ClipSignal } from './detector'
import { clipBelongs, clipWindow, kickClips, twitchClipPeriod, twitchClips } from './platforms/clips'
import { QuotaError } from './ai/gemini'
import { aiJson, type Backup } from './ai/backups'
import { channelModality, gameAt, modalityAt, modalityTimeline } from './games'
import { modalityPreset } from '../shared/settings'
import { buildReviewPrompt, combineScore, REVIEW_SCHEMA, REVIEW_SYSTEM, rubricScore, speechWithTimes, type AiVerdict, type MomentForAi } from './ai/review'
import type { MomentRecord, Settings, TimelinePoint } from '../shared/types'

interface SegRow {
  id: number
  path: string
  start_utc: number
  duration_s: number | null
  audio_done: number
  speech_done: number
}

export interface MomentsDeps {
  db: Db
  log: Logger
  queue: JobQueue
  settings: () => Settings
  ffmpeg: () => string | null
  speech: () => SpeechTools | null
  /** Chave e modelo do Gemini; null = sem IA de texto */
  gemini: () => { key: string; model: string } | null
  /** Reservas da KaTY (Groq, OpenRouter, Mistral, IA local), em ordem */
  backups?: () => Backup[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface LiveRow {
  id: number
  kind: 'live' | 'vod'
  started_at: number
  ended_at: number | null
  title: string | null
  game: string | null
  platform_stream_id: string | null
  broadcast_id: string | null
  platform: 'twitch' | 'kick'
  login: string
  channel: string
}

/**
 * Pipeline de detecção de uma live gravada ou VOD importado:
 * áudio → fala (Whisper) → blocos + comando de voz → detector → miniaturas → revisão por IA.
 * Roda de novo durante a gravação; só o que é novo é processado, e a análise da IA é reaproveitada.
 */
export class MomentsService extends EventEmitter {
  private lastQueued = new Map<number, number>()
  /** Última busca de clipes da comunidade por live (ao vivo, a detecção roda a cada minuto) */
  private clipsFetchedAt = new Map<number, number>()
  private quotaWarnedDay = ''
  private noKeyWarned = false
  private noSpeechWarned = false

  constructor(private d: MomentsDeps) {
    super()
    // Uma detecção por live de cada vez: duas juntas transcreveriam os mesmos pedaços e brigariam pelos momentos no banco
    d.queue.register(
      'detect:live',
      'cpu',
      (p, ctx) => this.run((p as { liveId: number }).liveId, ctx),
      (p) => String((p as { liveId?: number } | null)?.liveId ?? '')
    )
  }

  private get db() {
    return this.d.db
  }

  /** Põe a detecção na fila (não duplica se já houver uma esperando para a mesma live). */
  enqueue(liveId: number, why: string): void {
    const waiting = this.db
      .prepare(`SELECT 1 FROM jobs WHERE type = 'detect:live' AND status = 'queued' AND json_extract(payload, '$.liveId') = ?`)
      .get(liveId)
    if (waiting) return
    const name = (this.db.prepare('SELECT COALESCE(c.display_name, c.login) AS n FROM lives l JOIN channels c ON c.id = l.channel_id WHERE l.id = ?').get(liveId) as
      | { n: string }
      | undefined)?.n
    if (!name) return
    this.lastQueued.set(liveId, Date.now())
    this.d.queue.enqueue('detect:live', `Procurar momentos: ${name} (${why})`, { liveId }, { maxAttempts: 2 })
  }

  /** Durante a gravação: no máximo uma detecção a cada `minutes`. */
  enqueueThrottled(liveId: number, minutes = 5): void {
    const last = this.lastQueued.get(liveId) ?? 0
    if (Date.now() - last >= minutes * 60_000) this.enqueue(liveId, 'gravação em andamento')
  }

  /**
   * Núcleos para o Whisper. No automático, os núcleos livres são divididos entre as detecções que
   * rodam juntas (várias lives ao mesmo tempo): mais threads do que núcleos deixa todas mais lentas.
   */
  private threads(): number {
    const s = this.d.settings()
    if (s.speech.threads) return s.speech.threads
    const n = cpus().length
    if (s.performance.mode === 'eco') return Math.max(2, Math.floor(n / 4))
    return Math.max(2, Math.floor((n - 2) / Math.max(1, this.d.queue.runningBy('cpu'))))
  }

  private async run(liveId: number, ctx: JobContext): Promise<unknown> {
    const ffmpeg = this.d.ffmpeg()
    if (!ffmpeg) throw new Error('FFmpeg não encontrado.')
    const live = this.db
      .prepare(
        `SELECT l.id, l.kind, l.started_at, l.ended_at, l.title, l.game, l.platform_stream_id, l.broadcast_id, c.platform, c.login,
                COALESCE(c.display_name, c.login) AS channel
         FROM lives l JOIN channels c ON c.id = l.channel_id WHERE l.id = ?`
      )
      .get(liveId) as LiveRow | undefined
    if (!live) return null
    const s = this.d.settings()
    const segs = this.db
      .prepare(`SELECT id, path, start_utc, duration_s, audio_done, speech_done FROM segments WHERE live_id = ? AND status != 'deleted' ORDER BY seq`)
      .all(liveId) as unknown as SegRow[]
    if (!segs.length) return { moments: 0 }

    // 1) Áudio (0–35%)
    const pendingAudio = s.detectors.audio.enabled ? segs.filter((x) => !x.audio_done && existsSync(x.path)) : []
    const insA = this.db.prepare('INSERT OR REPLACE INTO audio_levels(live_id, t, rms_db, peak_db) VALUES (?, ?, ?, ?)')
    for (let i = 0; i < pendingAudio.length; i++) {
      if (ctx.signal.aborted) throw ctx.signal.reason
      const seg = pendingAudio[i]
      const levels = await analyzeAudio(ffmpeg, seg.path, ctx.signal)
      const base = Math.floor(seg.start_utc / 1000)
      this.db.exec('BEGIN')
      for (const l of levels) insA.run(liveId, base + l.sec, l.rmsDb, l.peakDb)
      this.db.prepare('UPDATE segments SET audio_done = 1 WHERE id = ?').run(seg.id)
      this.db.exec('COMMIT')
      ctx.progress(((i + 1) / pendingAudio.length) * 0.35)
    }

    // 2) Fala com o Whisper (35–75%): serve para comando de voz, IA e legendas
    const needSpeech = s.detectors.speech.enabled || s.detectors.voiceTrigger.enabled || s.detectors.aiText.enabled
    const speech = needSpeech ? this.d.speech() : null
    if (needSpeech && !speech && !this.noSpeechWarned) this.d.log.warn('fala', 'Whisper ou modelo não encontrado: momentos sem transcrição (veja Ajustes > Fala).')
    this.noSpeechWarned = needSpeech && !speech
    const pendingSpeech = speech ? segs.filter((x) => !x.speech_done && existsSync(x.path)) : []
    for (let i = 0; i < pendingSpeech.length; i++) {
      if (ctx.signal.aborted) throw ctx.signal.reason
      const seg = pendingSpeech[i]
      const tr = await transcribe(speech!, seg.path, s.speech.language, this.threads(), ctx.signal)
      const end = seg.start_utc + (seg.duration_s ?? 0) * 1000
      this.db.exec('BEGIN')
      this.db.prepare('DELETE FROM speech_words WHERE live_id = ? AND t_ms >= ? AND t_ms < ?').run(liveId, seg.start_utc, end)
      const insW = this.db.prepare('INSERT INTO speech_words(live_id, t_ms, end_ms, word) VALUES (?, ?, ?, ?)')
      for (const w of tr.words) insW.run(liveId, seg.start_utc + w.from, seg.start_utc + w.to, w.text)
      this.db.prepare('UPDATE segments SET speech_done = 1, language = ? WHERE id = ?').run(tr.language, seg.id)
      this.db.exec('COMMIT')
      ctx.progress(0.35 + ((i + 1) / pendingSpeech.length) * 0.4)
    }

    // 3) Blocos + comando de voz + clipes da comunidade + detector
    const first = segs[0].start_utc
    const lastSeg = segs[segs.length - 1]
    const end = lastSeg.start_utc + (lastSeg.duration_s ?? 0) * 1000
    const buckets = this.buildBuckets(liveId, first, end)
    const words = this.words(liveId, first, end)
    const voice = s.detectors.voiceTrigger.enabled ? findVoiceTriggers(words, s.detection.voiceTriggers) : []
    const clips = s.detectors.communityClips.enabled ? await this.refreshClips(live, first, end) : []
    // Padrões por modalidade: os pesos de chat e áudio mudam conforme a categoria do instante do lance
    const modalityOfT = modalityTimeline(this.db, liveId)
    const weightAt = s.modalities.enabled
      ? (t: number) => {
          const p = modalityPreset(s, modalityOfT(t))
          return p ? { chat: p.chatWeight, audio: p.audioWeight } : { chat: 1, audio: 1 }
        }
      : undefined
    const found = detectMoments(
      buckets,
      {
        chatWeight: s.detectors.chat.enabled ? s.detectors.chat.weight : 0,
        audioWeight: s.detectors.audio.enabled ? s.detectors.audio.weight : 0,
        voiceWeight: s.detectors.voiceTrigger.enabled ? s.detectors.voiceTrigger.weight : 0,
        clipWeight: s.detectors.communityClips.enabled ? s.detectors.communityClips.weight : 0,
        minScore: s.detection.minScore,
        maxPerHour: s.detection.maxPerHour,
        chatLagS: s.detection.chatLagS,
        weightAt
      },
      voice,
      clips
    )
    ctx.progress(0.8)

    // 4) Troca os momentos não revisados pelos novos, reaproveitando a análise da IA do mesmo lance
    const oldAi = this.db
      .prepare(`SELECT peak_utc, ai FROM moments WHERE live_id = ? AND status = 'new' AND ai IS NOT NULL`)
      .all(liveId) as { peak_utc: number; ai: string }[]
    // Miniaturas do mesmo lance também são reaproveitadas (ao vivo, a detecção roda a cada minuto)
    const oldThumbs = this.db
      .prepare(`SELECT peak_utc, thumb_path FROM moments WHERE live_id = ? AND status = 'new' AND thumb_path IS NOT NULL`)
      .all(liveId) as { peak_utc: number; thumb_path: string }[]
    this.db.exec('BEGIN')
    this.db.prepare(`DELETE FROM moments WHERE live_id = ? AND status = 'new' AND json_extract(signals, '$.manual') IS NULL`).run(liveId)
    const insM = this.db.prepare(
      `INSERT INTO moments(live_id, start_utc, end_utc, peak_utc, score, signals, title, ai, thumb_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    const samplesQ = this.db.prepare('SELECT user, text FROM chat_messages WHERE live_id = ? AND ts_utc BETWEEN ? AND ? ORDER BY ts_utc LIMIT 15')
    const created: { id: number; peak: number; thumb: boolean }[] = []
    const now = Date.now()
    // Momentos que já viraram clipe (ou foram descartados) ficam; o mesmo lance não volta duplicado
    const kept = this.db.prepare(`SELECT peak_utc FROM moments WHERE live_id = ? AND (status != 'new' OR json_extract(signals, '$.manual') IS NOT NULL)`).all(liveId) as { peak_utc: number }[]
    for (const m of found) {
      if (kept.some((k) => Math.abs(k.peak_utc - m.peakUtc) <= 15_000)) continue
      const samples = (samplesQ.all(liveId, m.peakUtc - 5000, m.peakUtc + 30_000) as { user: string; text: string }[]).map((x) => `${x.user}: ${x.text}`)
      const signals = { reasons: m.reasons, chat: m.chat, audio: m.audio, voice: m.voice, clip: m.clip, samples, detectorScore: m.score }
      const prev = oldAi.find((o) => Math.abs(o.peak_utc - m.peakUtc) <= 15_000)
      const verdict = prev ? (JSON.parse(prev.ai) as AiVerdict) : null
      const score = verdict ? combineScore(m.score, verdict, !!(m.clip || m.voice)) : m.score
      const thumb = oldThumbs.find((o) => Math.abs(o.peak_utc - m.peakUtc) <= 2_000 && existsSync(o.thumb_path))?.thumb_path ?? null
      const row = insM.get(liveId, m.startUtc, m.endUtc, m.peakUtc, score, JSON.stringify(signals), verdict?.title_pt ?? null, prev?.ai ?? null, thumb, now) as { id: number }
      created.push({ id: row.id, peak: m.peakUtc, thumb: !!thumb })
    }
    this.db.prepare('UPDATE lives SET detected_at = ? WHERE id = ?').run(now, liveId)
    this.db.exec('COMMIT')
    this.emit('moments', liveId)

    // 5) Miniaturas (80–85%)
    for (let i = 0; i < created.length; i++) {
      if (ctx.signal.aborted) break
      if (created[i].thumb) continue
      const seg = segs.find((x) => created[i].peak >= x.start_utc && created[i].peak < x.start_utc + (x.duration_s ?? 0) * 1000)
      if (!seg || !existsSync(seg.path)) continue
      const out = join(dirname(seg.path), 'miniaturas', `momento_${created[i].id}.jpg`)
      try {
        await thumbnail(ffmpeg, seg.path, (created[i].peak - seg.start_utc) / 1000, out)
        this.db.prepare('UPDATE moments SET thumb_path = ? WHERE id = ?').run(out, created[i].id)
      } catch {
        // sem miniatura não impede o resto
      }
      ctx.progress(0.8 + ((i + 1) / created.length) * 0.05)
    }
    this.emit('moments', liveId)

    // 6) Revisão por IA (85–100%)
    const reviewed = s.detectors.aiText.enabled ? await this.review(live, ctx) : 0
    this.emit('detected', liveId)
    this.d.log.info(
      'momentos',
      `${created.length} momento(s) novo(s)${found.length > created.length ? ` (${found.length - created.length} já tinham clipe)` : ''}${voice.length ? `, ${voice.length} pedido(s) de clipe por voz` : ''}${pendingSpeech.length ? `; fala de ${pendingSpeech.length} pedaço(s) transcrita` : ''}${reviewed ? `; ${reviewed} revisado(s) pela IA` : ''}.`
    )
    return { moments: found.length, voice: voice.length, reviewed }
  }

  /** Manda para a IA os momentos ainda sem análise, em lotes (economiza a cota grátis). */
  private async review(live: { id: number; title: string | null; game: string | null; channel: string }, ctx: JobContext): Promise<number> {
    const s = this.d.settings()
    if (s.ai.provider !== 'gemini') return 0
    const g = this.d.gemini()
    const backups = this.d.backups?.() ?? []
    if (!g && !backups.length) {
      if (!this.noKeyWarned) this.d.log.warn('ia', 'Sem chave do Gemini que funcione: os momentos ficam sem título e sem revisão. Cole a chave em Ajustes > IA e fala (se já tinha colado, cole de novo: a guardada não abre neste Windows).')
      this.noKeyWarned = true
      return 0
    }
    const today = new Date().toISOString().slice(0, 10)
    if (this.quotaWarnedDay === today) return 0
    const rows = this.db
      .prepare(`SELECT id, start_utc, end_utc, peak_utc, signals FROM moments WHERE live_id = ? AND status IN ('new', 'kept') AND ai IS NULL ORDER BY score DESC LIMIT 40`)
      .all(live.id) as { id: number; start_utc: number; end_utc: number; peak_utc: number; signals: string }[]
    let done = 0
    const retried = new Set<number>()
    const BATCH = 8
    for (let b = 0; b < rows.length; b += BATCH) {
      if (ctx.signal.aborted) break
      const batch = rows.slice(b, b + BATCH)
      const items: MomentForAi[] = batch.map((r) => {
        const sig = JSON.parse(r.signals)
        // Janela larga em volta do lance: a IA escolhe onde a história começa e onde termina (o clipe não sai pela metade)
        const win = this.window(r)
        const w = this.words(live.id, win.from, win.to)
        return {
          id: r.id,
          durationS: (r.end_utc - r.start_utc) / 1000,
          windowS: (win.to - win.from) / 1000,
          fromS: (r.start_utc - win.from) / 1000,
          toS: (r.end_utc - win.from) / 1000,
          peakS: (r.peak_utc - win.from) / 1000,
          game: gameAt(this.db, live.id, r.peak_utc),
          modality: channelModality(this.db, live.id),
          reasons: sig.reasons ?? [],
          speech: speechWithTimes(w, win.from),
          chat: sig.samples ?? []
        }
      })
      try {
        let used = g?.model ?? ''
        const res = await aiJson<{ moments: AiVerdict[] }>(
          { gemini: g, backups },
          REVIEW_SYSTEM,
          buildReviewPrompt({ channel: live.channel, liveTitle: live.title ?? '' }, items),
          REVIEW_SCHEMA,
          ctx.signal,
          {
            onFallback: (name, why) => {
              used = name
              this.d.log.info('ia', `Gemini fora (${why.slice(0, 80)}): a KaTY usou a reserva ${name}.`)
            }
          }
        )
        for (const raw of res.moments ?? []) {
          // A nota da IA é a soma das partes (gancho, desfecho, emoção, compartilhável), quando ela mandou
          const v = { ...raw, score: rubricScore(raw) }
          const row = batch.find((r) => r.id === v.id)
          if (!row) continue
          const sig = JSON.parse(row.signals)
          // Começo e fim do corte em hora real (valem só se fazem sentido e contêm o pico)
          const win = this.window(row)
          const a = Number(v.clip_start)
          const b = Number(v.clip_end)
          const cut =
            Number.isFinite(a) && Number.isFinite(b) && b - a >= 8 && win.from + a * 1000 <= row.peak_utc && win.from + b * 1000 >= row.peak_utc
              ? { clip_from_utc: Math.round(win.from + Math.max(0, a) * 1000), clip_to_utc: Math.round(win.from + b * 1000) }
              : {}
          this.db
            .prepare('UPDATE moments SET ai = ?, title = ?, score = ? WHERE id = ?')
            .run(JSON.stringify({ ...v, ...cut, model: used }), v.title_pt, combineScore(sig.detectorScore ?? 50, v, !!(sig.clip || sig.voice)), v.id)
          done++
        }
        // A IA às vezes devolve só parte do lote (visto em 2026-11-18: 5 de 12): os que faltaram voltam uma vez no fim
        const answered = new Set((res.moments ?? []).map((v) => v.id))
        for (const r of batch) if (!answered.has(r.id) && !retried.has(r.id)) {
          retried.add(r.id)
          rows.push(r)
        }
        this.emit('moments', live.id)
      } catch (e) {
        if (e instanceof QuotaError) {
          // Limite por dia: para até amanhã. Limite por minuto: só para esta rodada.
          const daily = /per ?day|perday|daily|RPD/i.test(e.message)
          if (daily) this.quotaWarnedDay = today
          this.d.log.warn(
            'ia',
            daily
              ? 'Cota grátis do dia do Gemini acabou. Os momentos que faltam são revisados amanhã (ou troque o provedor em Ajustes).'
              : 'Limite por minuto do Gemini atingido; os momentos que faltam são revisados na próxima detecção.'
          )
          break
        }
        this.d.log.warn('ia', `Revisão da IA falhou: ${(e as Error).message}`)
        break
      }
      ctx.progress(0.85 + ((b + batch.length) / rows.length) * 0.15)
      // Nível grátis tem limite por minuto: um pedido a cada ~5 s
      if (b + BATCH < rows.length) await sleep(5000)
    }
    return done
  }

  /**
   * Busca os clipes que a comunidade fez desta live e guarda no banco (com a janela em hora real).
   * Se a busca falhar, usa os que já estavam guardados.
   */
  private async refreshClips(live: LiveRow, first: number, end: number): Promise<ClipSignal[]> {
    // Durante a gravação, busca no máximo a cada 5 min (a detecção ao vivo roda a cada minuto)
    const ongoing = live.kind === 'live' && live.ended_at == null
    if (ongoing && Date.now() - (this.clipsFetchedAt.get(live.id) ?? 0) < 5 * 60_000) return this.storedClips(live.id)
    this.clipsFetchedAt.set(live.id, Date.now())
    try {
      const found =
        live.platform === 'twitch' ? await twitchClips(live.login, twitchClipPeriod(live.started_at)) : live.platform === 'kick' ? await kickClips(live.login) : []
      const ref = {
        vodId: live.kind === 'vod' && live.platform === 'twitch' ? live.platform_stream_id : null,
        broadcastId: live.kind === 'live' ? live.platform_stream_id : live.broadcast_id,
        startUtc: first,
        endUtc: live.ended_at ?? end
      }
      const ins = this.db.prepare(
        `INSERT INTO community_clips(live_id, source_id, start_utc, end_utc, views, title, url) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(live_id, source_id) DO UPDATE SET views = excluded.views, title = excluded.title`
      )
      let n = 0
      for (const c of found) {
        if (!clipBelongs(c, ref)) continue
        const w = clipWindow(c, live.started_at)
        ins.run(live.id, c.id, w.startUtc, w.endUtc, c.views, c.title, c.url)
        n++
      }
      if (n) this.d.log.info('clipes', `${n} clipe(s) da comunidade encontrados para ${live.channel}.`)
    } catch (e) {
      this.d.log.warn('clipes', `Não deu para buscar os clipes da comunidade: ${(e as Error).message}`)
    }
    return this.storedClips(live.id)
  }

  private storedClips(liveId: number): ClipSignal[] {
    return (
      this.db.prepare('SELECT start_utc, end_utc, views, title, url FROM community_clips WHERE live_id = ?').all(liveId) as {
        start_utc: number
        end_utc: number
        views: number
        title: string | null
        url: string | null
      }[]
    ).map((c) => ({ startUtc: c.start_utc, endUtc: c.end_utc, views: c.views, title: c.title ?? '', url: c.url ?? '' }))
  }

  /** Fala mostrada à IA: 45 s antes do lance até 45 s depois (o bastante para o começo da história e a reação). */
  private window(r: { start_utc: number; end_utc: number }): { from: number; to: number } {
    return { from: r.start_utc - 45_000, to: r.end_utc + 45_000 }
  }

  private words(liveId: number, from: number, to: number): { t: number; text: string }[] {
    return (this.db.prepare('SELECT t_ms AS t, word AS text FROM speech_words WHERE live_id = ? AND t_ms >= ? AND t_ms < ? ORDER BY t_ms').all(liveId, from, to) as {
      t: number
      text: string
    }[]).map((w) => ({ t: w.t, text: w.text }))
  }

  /** Junta chat (mensagens, pessoas, risadas, hype, emotes) e áudio (volume máximo) em blocos de 5 s. */
  buildBuckets(liveId: number, first: number, end: number): Bucket[] {
    const step = BUCKET_S * 1000
    const n = Math.max(1, Math.ceil((end - first) / step))
    const b: Bucket[] = Array.from({ length: n }, (_, i) => ({ t: first + i * step, msgs: 0, uniq: 0, laughs: 0, hype: 0, emotes: 0, audioDb: null }))
    const users: Set<string>[] = Array.from({ length: n }, () => new Set())
    const msgs = this.db.prepare('SELECT ts_utc, user, text, emotes FROM chat_messages WHERE live_id = ? AND ts_utc >= ? AND ts_utc < ?')
    for (const m of msgs.iterate(liveId, first, end) as Iterable<{ ts_utc: number; user: string; text: string; emotes: number }>) {
      const i = Math.floor((m.ts_utc - first) / step)
      if (i < 0 || i >= n) continue
      const k = classifyMessage(m.text)
      b[i].msgs++
      b[i].emotes += m.emotes
      if (k.laugh) b[i].laughs++
      if (k.hype) b[i].hype++
      users[i].add(m.user)
    }
    for (let i = 0; i < n; i++) b[i].uniq = users[i].size
    const lv = this.db.prepare('SELECT t, rms_db FROM audio_levels WHERE live_id = ? AND t >= ? AND t < ?')
    for (const l of lv.iterate(liveId, Math.floor(first / 1000), Math.ceil(end / 1000)) as Iterable<{ t: number; rms_db: number }>) {
      const i = Math.floor((l.t * 1000 - first) / step)
      if (i < 0 || i >= n) continue
      b[i].audioDb = b[i].audioDb == null ? l.rms_db : Math.max(b[i].audioDb!, l.rms_db)
    }
    return b
  }

  timeline(liveId: number): TimelinePoint[] {
    const live = this.db.prepare('SELECT started_at FROM lives WHERE id = ?').get(liveId) as { started_at: number } | undefined
    const r = this.db
      .prepare(`SELECT MIN(start_utc) AS a, MAX(start_utc + COALESCE(duration_s, 0) * 1000) AS b FROM segments WHERE live_id = ? AND status != 'deleted'`)
      .get(liveId) as { a: number | null; b: number | null }
    if (!live || r.a == null || r.b == null) return []
    return hypeSeries(this.buildBuckets(liveId, r.a, r.b), 30).map((p) => ({ s: Math.round((p.t - live.started_at) / 1000), chat: p.chat, audio: p.audio }))
  }

  /** Momentos de uma live (ou de todas), ou só os ids pedidos (busca). */
  list(liveId?: number, ids?: number[]): MomentRecord[] {
    if (ids && !ids.length) return []
    const where = ids ? `WHERE m.id IN (${ids.map(() => '?').join(',')})` : liveId != null ? 'WHERE m.live_id = ?' : ''
    const rows = this.db
      .prepare(
        `SELECT m.*, l.started_at, l.title AS live_title, l.kind, c.platform, COALESCE(c.display_name, c.login) AS channel_name
         FROM moments m JOIN lives l ON l.id = m.live_id JOIN channels c ON c.id = l.channel_id
         ${where} ORDER BY m.score DESC LIMIT ${ids ? ids.length : 300}`
      )
      .all(...(ids ?? (liveId != null ? [liveId] : []))) as Record<string, any>[]
    return rows.map((m) => {
      const sig = JSON.parse(m.signals || '{}')
      const ai = m.ai ? (JSON.parse(m.ai) as AiVerdict & { model?: string }) : null
      const speech = this.words(m.live_id, m.start_utc, m.end_utc)
        .map((w) => w.text)
        .join(' ')
      return {
        id: m.id,
        liveId: m.live_id,
        channelName: m.channel_name,
        platform: m.platform,
        liveTitle: m.live_title ?? '',
        liveKind: m.kind,
        game: gameAt(this.db, m.live_id, m.peak_utc),
        modality: modalityAt(this.db, m.live_id, m.peak_utc),
        peakS: (m.peak_utc - m.started_at) / 1000,
        startS: (m.start_utc - m.started_at) / 1000,
        endS: (m.end_utc - m.started_at) / 1000,
        score: m.score,
        detectorScore: sig.detectorScore ?? m.score,
        reasons: sig.reasons ?? [],
        chat: sig.chat ? { score: sig.chat.score, ratio: sig.chat.ratio, msgs: sig.chat.msgs, laughs: sig.chat.laughs } : null,
        audio: sig.audio ? { score: sig.audio.score, deltaDb: sig.audio.deltaDb } : null,
        voice: sig.voice ? { phrase: sig.voice.phrase } : null,
        clip: sig.clip ? { title: sig.clip.title, views: sig.clip.views, url: sig.clip.url } : null,
        samples: sig.samples ?? [],
        speech,
        ai: ai
          ? {
              keep: ai.keep,
              score: ai.score,
              category: ai.category,
              titlePt: ai.title_pt,
              titleEn: ai.title_en,
              reason: ai.reason,
              hashtags: ai.hashtags,
              model: ai.model ?? null,
              hook: ai.gancho ?? null,
              analysis: ai.analise ?? null,
              parts: ai.notas ?? null
            }
          : null,
        hasThumb: !!m.thumb_path && existsSync(m.thumb_path),
        status: m.status
      }
    })
  }

  /**
   * Momento criado à mão num instante da live (ex.: um trecho achado na busca pela fala).
   * Fica até virar clipe ou ser descartado; a detecção não o troca.
   */
  createAt(liveId: number, tMs: number, label: string): number {
    const seg = this.db
      .prepare(`SELECT 1 FROM segments WHERE live_id = ? AND status != 'deleted' AND start_utc <= ? AND start_utc + COALESCE(duration_s, 0) * 1000 > ?`)
      .get(liveId, tMs, tMs)
    if (!seg) throw new Error('A gravação deste trecho não existe mais.')
    const near = this.db
      .prepare(`SELECT id FROM moments WHERE live_id = ? AND status != 'dismissed' AND ABS(peak_utc - ?) <= 10000 ORDER BY ABS(peak_utc - ?) LIMIT 1`)
      .get(liveId, tMs, tMs) as { id: number } | undefined
    if (near) return near.id
    const samples = (
      this.db.prepare('SELECT user, text FROM chat_messages WHERE live_id = ? AND ts_utc BETWEEN ? AND ? ORDER BY ts_utc LIMIT 15').all(liveId, tMs - 5000, tMs + 30_000) as {
        user: string
        text: string
      }[]
    ).map((x) => `${x.user}: ${x.text}`)
    const reason = `Achado na busca: ${label.slice(0, 80)}`
    const signals = { reasons: [reason], samples, detectorScore: 50, manual: true }
    const row = this.db
      .prepare(`INSERT INTO moments(live_id, start_utc, end_utc, peak_utc, score, signals, title, created_at) VALUES (?, ?, ?, ?, 50, ?, ?, ?) RETURNING id`)
      .get(liveId, tMs - 15_000, tMs + 15_000, tMs, JSON.stringify(signals), label.slice(0, 120), Date.now()) as { id: number }
    this.emit('moments', liveId)
    return row.id
  }

  /** Tira o momento da lista: não vira clipe e não volta na próxima detecção. */
  dismiss(id: number): void {
    const m = this.db.prepare('SELECT live_id FROM moments WHERE id = ?').get(id) as { live_id: number } | undefined
    if (!m) return
    this.db.prepare(`UPDATE moments SET status = 'dismissed' WHERE id = ? AND status = 'new'`).run(id)
    this.emit('moments', m.live_id)
  }

  thumbPath(id: number): string | null {
    return (this.db.prepare('SELECT thumb_path FROM moments WHERE id = ?').get(id) as { thumb_path: string | null } | undefined)?.thumb_path ?? null
  }

  /** Pedaço que contém o lance (para abrir no player). */
  segmentOf(id: number): string | null {
    const m = this.db.prepare('SELECT live_id, peak_utc FROM moments WHERE id = ?').get(id) as { live_id: number; peak_utc: number } | undefined
    if (!m) return null
    const s = this.db
      .prepare(`SELECT path FROM segments WHERE live_id = ? AND status != 'deleted' AND start_utc <= ? ORDER BY start_utc DESC LIMIT 1`)
      .get(m.live_id, m.peak_utc) as { path: string } | undefined
    return s?.path ?? null
  }
}

function thumbnail(ffmpeg: string, file: string, atS: number, out: string): Promise<void> {
  mkdirSync(dirname(out), { recursive: true })
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-y', '-ss', Math.max(0, atS).toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', out], {
      windowsHide: true
    })
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))))
    p.on('error', reject)
  })
}
