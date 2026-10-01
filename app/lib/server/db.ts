// 서버 데이터베이스. Railway에서는 DATABASE_URL(Postgres), 로컬에서는 DATABASE_URL이 없으면 PGlite(파일)로 대신한다.
// 저장하는 것: 선생님 계정(구글), 선생님이 넣은 API 키(암호화), 채점 기록(이름 없음: 반·평가·월·학생 번호·점수).

type Row = Record<string, unknown>;
type Db = { query: <T extends Row = Row>(text: string, params?: unknown[]) => Promise<T[]> };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS teachers (
     id SERIAL PRIMARY KEY,
     google_sub TEXT UNIQUE NOT NULL,
     email TEXT NOT NULL,
     name TEXT NOT NULL DEFAULT '',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     last_login TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS teacher_keys (
     teacher_id INTEGER PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
     gemini_enc TEXT,
     gemini_paid BOOLEAN NOT NULL DEFAULT false,
     anthropic_enc TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS records (
     id SERIAL PRIMARY KEY,
     teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
     class_name TEXT NOT NULL,
     assessment TEXT NOT NULL,
     month TEXT NOT NULL,
     summary JSONB NOT NULL,
     rows JSONB NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS records_teacher_class ON records (teacher_id, class_name, month)`,
  // 선생님이 고른 Gemini 판독 모델 (비우면 기본 모델)
  `ALTER TABLE teacher_keys ADD COLUMN IF NOT EXISTS gemini_model TEXT`,
];

let ready: Promise<Db> | null = null;

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  let db: Db;
  if (url) {
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, { max: 5, idle_timeout: 30, onnotice: () => {} });
    db = { query: async <T extends Row>(text: string, params: unknown[] = []) => (await sql.unsafe(text, params as never[])) as unknown as T[] };
  } else {
    // 로컬 개발: 프로젝트 안 .data/pglite 폴더에 Postgres 호환 데이터베이스
    const { PGlite } = await import("@electric-sql/pglite");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = process.env.PGLITE_DIR || ".data/pglite";
    fs.mkdirSync(dir, { recursive: true });
    // 서버 번들에 묶이면 PGlite가 옆의 wasm·data 파일을 못 찾는다 → node_modules에서 직접 읽어 넘긴다
    const dist = path.join(process.cwd(), "node_modules/@electric-sql/pglite/dist");
    const lite = await PGlite.create(dir, {
      pgliteWasmModule: await WebAssembly.compile(fs.readFileSync(path.join(dist, "pglite.wasm"))),
      initdbWasmModule: await WebAssembly.compile(fs.readFileSync(path.join(dist, "initdb.wasm"))),
      fsBundle: new Blob([fs.readFileSync(path.join(dist, "pglite.data"))]),
    });
    db = { query: async <T extends Row>(text: string, params: unknown[] = []) => (await lite.query<T>(text, params)).rows };
  }
  for (const stmt of SCHEMA) await db.query(stmt);
  return db;
}

export function getDb() {
  if (!ready) ready = open().catch(e => { ready = null; throw e; });
  return ready;
}
