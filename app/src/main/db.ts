import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

/**
 * Banco local (SQLite embutido no Node, sem módulo nativo para compilar).
 * Cada migração roda uma vez; a versão fica em PRAGMA user_version.
 */
const MIGRATIONS: string[] = [
  // 1 — fundação: ajustes, fila de tarefas e logs
  `
  CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type         TEXT    NOT NULL,
    label        TEXT    NOT NULL,
    resource     TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'queued',
    priority     INTEGER NOT NULL DEFAULT 0,
    progress     REAL    NOT NULL DEFAULT 0,
    attempts     INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    payload      TEXT    NOT NULL DEFAULT 'null',
    result       TEXT,
    error        TEXT,
    created_at   INTEGER NOT NULL,
    started_at   INTEGER,
    finished_at  INTEGER
  );
  CREATE INDEX jobs_status ON jobs(status, priority DESC, id);
  CREATE TABLE logs (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    time    INTEGER NOT NULL,
    level   TEXT    NOT NULL,
    source  TEXT    NOT NULL,
    message TEXT    NOT NULL
  );
  CREATE INDEX logs_time ON logs(time);
  `,
  // 2 — canais, lives e segmentos (usados a partir da fase 1)
  `
  CREATE TABLE channels (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    platform     TEXT    NOT NULL CHECK (platform IN ('twitch', 'kick')),
    login        TEXT    NOT NULL,
    display_name TEXT,
    avatar_url   TEXT,
    language     TEXT,
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL,
    UNIQUE (platform, login)
  );
  CREATE TABLE lives (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    title       TEXT,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    status      TEXT    NOT NULL DEFAULT 'recording'
  );
  CREATE TABLE segments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    live_id     INTEGER NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,
    path        TEXT    NOT NULL,
    start_utc   INTEGER NOT NULL,
    duration_s  REAL,
    status      TEXT    NOT NULL DEFAULT 'recorded',
    UNIQUE (live_id, seq)
  );
  `,
  // 3 — gravador: dados extras da live, tamanho dos segmentos e mensagens do chat
  `
  ALTER TABLE channels ADD COLUMN last_checked_at INTEGER;
  ALTER TABLE channels ADD COLUMN last_error TEXT;
  ALTER TABLE lives ADD COLUMN platform_stream_id TEXT;
  ALTER TABLE lives ADD COLUMN game TEXT;
  ALTER TABLE lives ADD COLUMN dir TEXT;
  ALTER TABLE lives ADD COLUMN recorder_restarts INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX lives_stream ON lives(channel_id, platform_stream_id);
  ALTER TABLE segments ADD COLUMN bytes INTEGER;
  CREATE TABLE chat_messages (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    live_id INTEGER NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
    ts_utc  INTEGER NOT NULL,
    user    TEXT    NOT NULL,
    text    TEXT    NOT NULL,
    emotes  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX chat_live_ts ON chat_messages(live_id, ts_utc);
  `,
  // 4 — VODs importados por link (mesmo formato das lives gravadas: pedaços + chat)
  `
  ALTER TABLE channels ADD COLUMN origin TEXT NOT NULL DEFAULT 'watch';
  ALTER TABLE lives ADD COLUMN kind TEXT NOT NULL DEFAULT 'live';
  ALTER TABLE lives ADD COLUMN source_url TEXT;
  ALTER TABLE lives ADD COLUMN duration_s REAL;
  ALTER TABLE lives ADD COLUMN range_start_s REAL;
  ALTER TABLE lives ADD COLUMN range_end_s REAL;
  ALTER TABLE lives ADD COLUMN error TEXT;
  ALTER TABLE lives ADD COLUMN chat_status TEXT;
  CREATE INDEX lives_kind ON lives(kind, status);
  `,
  // 5 — detectores: volume por segundo, momentos encontrados
  `
  ALTER TABLE segments ADD COLUMN audio_done INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE lives ADD COLUMN detected_at INTEGER;
  CREATE TABLE audio_levels (
    live_id INTEGER NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
    t       INTEGER NOT NULL,
    rms_db  REAL    NOT NULL,
    peak_db REAL    NOT NULL,
    PRIMARY KEY (live_id, t)
  ) WITHOUT ROWID;
  CREATE TABLE moments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    live_id      INTEGER NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
    start_utc    INTEGER NOT NULL,
    end_utc      INTEGER NOT NULL,
    peak_utc     INTEGER NOT NULL,
    score        INTEGER NOT NULL,
    signals      TEXT    NOT NULL DEFAULT '{}',
    title        TEXT,
    thumb_path   TEXT,
    status       TEXT    NOT NULL DEFAULT 'new',
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX moments_live ON moments(live_id, score DESC);
  `,
  // 6 — fala: palavras com horário (Whisper) e análise da IA por momento
  `
  ALTER TABLE segments ADD COLUMN speech_done INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE segments ADD COLUMN language TEXT;
  CREATE TABLE speech_words (
    live_id INTEGER NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
    t_ms    INTEGER NOT NULL,
    end_ms  INTEGER NOT NULL,
    word    TEXT    NOT NULL
  );
  CREATE INDEX speech_live_t ON speech_words(live_id, t_ms);
  ALTER TABLE moments ADD COLUMN ai TEXT;
  `,
  // 7 — clipes da comunidade (feitos pelos espectadores) como sinal de momento
  `
  ALTER TABLE lives ADD COLUMN broadcast_id TEXT;
  CREATE TABLE community_clips (
    live_id   INTEGER NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
    source_id TEXT    NOT NULL,
    start_utc INTEGER NOT NULL,
    end_utc   INTEGER NOT NULL,
    views     INTEGER NOT NULL DEFAULT 0,
    title     TEXT,
    url       TEXT,
    PRIMARY KEY (live_id, source_id)
  ) WITHOUT ROWID;
  `,
  // 8 — clipes prontos (verticais com legenda) e facecam marcada por canal.
  // O clipe guarda canal e títulos: continua listado mesmo se a gravação de origem for apagada.
  `
  ALTER TABLE channels ADD COLUMN facecam TEXT;
  CREATE TABLE clips (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    moment_id   INTEGER REFERENCES moments(id) ON DELETE SET NULL,
    live_id     INTEGER REFERENCES lives(id) ON DELETE SET NULL,
    channel     TEXT    NOT NULL,
    title       TEXT    NOT NULL DEFAULT '',
    title_en    TEXT    NOT NULL DEFAULT '',
    hashtags    TEXT    NOT NULL DEFAULT '[]',
    options     TEXT    NOT NULL,
    layout      TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'queued',
    error       TEXT,
    path        TEXT,
    duration_s  REAL    NOT NULL DEFAULT 0,
    width       INTEGER,
    height      INTEGER,
    size_bytes  INTEGER,
    auto        INTEGER NOT NULL DEFAULT 0,
    job_id      INTEGER,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX clips_live ON clips(live_id);
  CREATE INDEX clips_moment ON clips(moment_id);
  `,
  // 9 — revisão do clipe: para revisar, aprovado ou descartado
  `
  ALTER TABLE clips ADD COLUMN review TEXT NOT NULL DEFAULT 'pending';
  `,
  // 10 — perfis deste PC: cada um com seus ajustes e predefinições
  `
  CREATE TABLE profiles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    color      TEXT    NOT NULL DEFAULT '#3d7bf6',
    photo      TEXT,
    settings   TEXT,
    created_at INTEGER NOT NULL
  );
  `,
  // 11 — categoria (jogo) ao longo da live: o streamer pode trocar de Just Chatting para um jogo no meio
  `
  CREATE TABLE live_games (
    live_id  INTEGER NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
    from_utc INTEGER NOT NULL,
    game     TEXT,
    PRIMARY KEY (live_id, from_utc)
  );
  INSERT INTO live_games(live_id, from_utc, game) SELECT id, started_at, game FROM lives WHERE started_at IS NOT NULL;
  `,
  // 12 — modalidade fixada por canal (null = automática pela categoria da live)
  `
  ALTER TABLE channels ADD COLUMN modality TEXT;
  `,
  // 13 — posição do recorte lembrada por canal (onde fica o rosto do streamer no layout de recorte)
  `
  ALTER TABLE channels ADD COLUMN crop_x REAL;
  `,
  // 14 — postar à mão: cópia na pasta "para postar" e quando foi postado em cada rede
  `
  ALTER TABLE clips ADD COLUMN exported_path TEXT;
  ALTER TABLE clips ADD COLUMN posted TEXT;
  `,
  // 15 — textos de postagem editados à mão (título, descrição, legenda) por cima dos gerados
  `
  ALTER TABLE clips ADD COLUMN post_custom TEXT;
  `,
  // 16 — "vigiar" (saber quando entra ao vivo) separado de "gravar"; os canais que já existiam continuam gravando
  `
  ALTER TABLE channels ADD COLUMN record INTEGER NOT NULL DEFAULT 1;
  `,
  // 17 — YouTube como fonte: a tabela de canais é refeita sem a trava "só twitch e kick"
  // (SEM_FK: roda com as chaves estrangeiras desligadas, senão apagar a tabela velha apagaria as lives em cascata)
  `-- SEM_FK
  CREATE TABLE channels_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    platform        TEXT    NOT NULL CHECK (platform IN ('twitch', 'kick', 'youtube')),
    login           TEXT    NOT NULL,
    display_name    TEXT,
    avatar_url      TEXT,
    language        TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    last_checked_at INTEGER,
    last_error      TEXT,
    origin          TEXT    NOT NULL DEFAULT 'watch',
    facecam         TEXT,
    modality        TEXT,
    crop_x          REAL,
    record          INTEGER NOT NULL DEFAULT 1,
    UNIQUE (platform, login)
  );
  INSERT INTO channels_new(id, platform, login, display_name, avatar_url, language, enabled, created_at, last_checked_at, last_error, origin, facecam, modality, crop_x, record)
    SELECT id, platform, login, display_name, avatar_url, language, enabled, created_at, last_checked_at, last_error, origin, facecam, modality, crop_x, record FROM channels;
  DROP TABLE channels;
  ALTER TABLE channels_new RENAME TO channels;
  `,
  // 18 — quando o clipe foi aprovado ou descartado (para apagar os descartados depois de um prazo)
  `
  ALTER TABLE clips ADD COLUMN reviewed_at INTEGER;
  `
]

export type Db = DatabaseSync

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  migrate(db)
  return db
}

export function migrate(db: Db): number {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (let v = current; v < MIGRATIONS.length; v++) {
    // Refazer uma tabela pede as chaves estrangeiras desligadas (só pode mudar fora da transação)
    const noFk = MIGRATIONS[v].trimStart().startsWith('-- SEM_FK')
    if (noFk) db.exec('PRAGMA foreign_keys = OFF')
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      if (noFk) {
        const broken = db.prepare('PRAGMA foreign_key_check').all()
        if (broken.length) throw new Error(`${broken.length} ligação(ões) quebrada(s) entre tabelas`)
      }
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw new Error(`Falha na migração ${v + 1} do banco: ${(e as Error).message}`)
    } finally {
      if (noFk) db.exec('PRAGMA foreign_keys = ON')
    }
  }
  return MIGRATIONS.length
}

export function kvGet<T>(db: Db, key: string): T | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return undefined
  try {
    return JSON.parse(row.value) as T
  } catch {
    return undefined
  }
}

export function kvSet(db: Db, key: string, value: unknown): void {
  db.prepare('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
}
