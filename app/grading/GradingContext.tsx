"use client";

// 채점 흐름의 상태. 단계별 페이지(/grading/*)가 이 컨텍스트를 공유한다.
// 이름이 적힌 원본 사진과 명부는 여기(브라우저 메모리)에만 있고, 페이지를 새로고침하면 사라진다.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnswerKeyError, itemsOnPage, loadAnswerKey, ocrSpec, pageCount, type Item } from "../lib/assessment/answerKey";
import { toCsv } from "../lib/assessment/csv";
import { blobToBase64, demoPage, loadPages, processPage, TEMPLATES, type ProcessedPage } from "../lib/assessment/images";
import { createRoster, maskNames, parseRoster, present, sha256Hex, type Student } from "../lib/assessment/privacy";
import { buildRows, LONG_COLUMNS, mergePages, reviewKey, type BuildResult, type EssayReview, type Readings, type ReadReview } from "../lib/assessment/records";
import { SAMPLE_KEY_CSV, SAMPLE_KEY_NAME } from "../lib/assessment/sampleKey";
import { demoNames, syntheticReadings } from "../lib/assessment/synthetic";

export type Health = { ready: boolean; missing: string[]; model: string } | null;
export type Progress = { done: number; total: number; errors: string[] };

type GradingState = {
  accessKey: string; updateAccessKey: (v: string) => void; health: Health;
  namesText: string; setNamesText: (v: string) => void; roster: Student[]; rosterError: string;
  makeRoster: () => boolean; loadRosterFile: (f?: File) => Promise<boolean>; toggleAbsent: (code: string) => void;
  keyName: string; items: Item[]; keyError: string; applyKey: (text: string, name: string) => boolean;
  assessmentId: string; setAssessmentId: (v: string) => void; source: string; setSource: (v: string) => void;
  templateId: string; setTemplateId: (v: string) => void; pagesPerStudent: number; setPagesPerStudent: (v: number) => void;
  students: Student[]; names: string[];
  pages: ProcessedPage[]; identity: Record<string, string>; pageError: string; processing: boolean;
  checked: boolean; setChecked: (v: boolean) => void; approved: boolean;
  handlePhotos: (files: FileList | null) => Promise<void>; approve: () => void;
  demo: boolean; startDemo: () => Promise<void>;
  readings: Readings; progress: Progress | null; runOcr: () => Promise<void>;
  readReview: Record<string, ReadReview>; setReadReview: (f: (r: Record<string, ReadReview>) => Record<string, ReadReview>) => void;
  essayReview: Record<string, EssayReview>; setEssayReview: (f: (r: Record<string, EssayReview>) => Record<string, EssayReview>) => void;
  essayBusy: string; suggestEssay: (code: string, it: Item, answer: string) => Promise<void>;
  result: BuildResult | null; resultCsv: () => string;
};

const Ctx = createContext<GradingState | null>(null);

export function useGrading() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGrading은 /grading 아래에서만 쓸 수 있습니다");
  return ctx;
}

export function GradingProvider({ children }: { children: ReactNode }) {
  const [accessKey, setAccessKey] = useState(() => (typeof window === "undefined" ? "" : localStorage.getItem("statetistic:accessKey") ?? ""));
  const [health, setHealth] = useState<Health>(null);

  const [namesText, setNamesText] = useState("");
  const [roster, setRoster] = useState<Student[]>([]);
  const [rosterError, setRosterError] = useState("");

  const [keyName, setKeyName] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [keyError, setKeyError] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [source, setSource] = useState("");
  const [templateId, setTemplateIdState] = useState(TEMPLATES[0].id);
  const [pagesPerStudent, setPagesPerStudentState] = useState(0);

  const [pages, setPages] = useState<ProcessedPage[]>([]);
  const [identity, setIdentity] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [checked, setChecked] = useState(false);
  const [approvedHashes, setApprovedHashes] = useState<Record<string, string> | null>(null);

  const [readings, setReadings] = useState<Readings>({});
  const [progress, setProgress] = useState<Progress | null>(null);
  const [demo, setDemo] = useState(false);
  const [readReview, setReadReview] = useState<Record<string, ReadReview>>({});
  const [essayReview, setEssayReview] = useState<Record<string, EssayReview>>({});
  const [essayBusy, setEssayBusy] = useState("");
  const urls = useRef<string[]>([]);

  useEffect(() => {
    fetch("/api/assessment/health", { cache: "no-store" }).then(r => r.json()).then(setHealth).catch(() => setHealth({ ready: false, missing: ["서버 연결"], model: "" }));
    const held = urls.current;
    return () => held.forEach(u => URL.revokeObjectURL(u));
  }, []);

  const template = TEMPLATES.find(t => t.id === templateId) ?? TEMPLATES[0];
  const students = useMemo(() => present(roster), [roster]);
  const names = useMemo(() => roster.map(s => s.name), [roster]);
  const result = useMemo(
    () => (items.length && Object.keys(readings).length
      ? buildRows(items, readings, { assessmentId: assessmentId || "평가", source, readReview, essayReview })
      : null),
    [items, readings, assessmentId, source, readReview, essayReview],
  );

  function updateAccessKey(value: string) {
    setAccessKey(value);
    localStorage.setItem("statetistic:accessKey", value);
  }

  function resetPages() {
    urls.current.forEach(u => URL.revokeObjectURL(u));
    urls.current = [];
    setPages([]);
    setIdentity({});
    setApprovedHashes(null);
    setChecked(false);
    setReadings({});
    setProgress(null);
    setReadReview({});
    setEssayReview({});
  }

  // ---- 1. 명부 -------------------------------------------------------------
  function makeRoster() {
    try {
      setRoster(createRoster(namesText.split(/\r?\n/), roster));
      setRosterError("");
      resetPages();
      return true;
    } catch (e) {
      setRosterError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function loadRosterFile(file?: File) {
    if (!file) return false;
    try {
      const loaded = parseRoster(await file.text());
      setRoster(loaded);
      setNamesText(loaded.map(s => s.name).join("\n"));
      setRosterError("");
      resetPages();
      return true;
    } catch (e) {
      setRosterError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  function toggleAbsent(code: string) {
    setRoster(rs => rs.map(s => (s.code === code ? { ...s, absent: !s.absent } : s)));
    resetPages();
  }

  // ---- 2. 정답표 -----------------------------------------------------------
  function applyKey(text: string, name: string) {
    try {
      const loaded = loadAnswerKey(text, name);
      setItems(loaded);
      setKeyName(name);
      setKeyError("");
      setPagesPerStudentState(pageCount(loaded));
      if (!assessmentId) setAssessmentId(name.replace(/\.csv$/i, ""));
      resetPages();
      return true;
    } catch (e) {
      setItems([]);
      setKeyError(e instanceof AnswerKeyError || e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  function setTemplateId(v: string) {
    setTemplateIdState(v);
    resetPages();
  }

  function setPagesPerStudent(v: number) {
    setPagesPerStudentState(v);
    resetPages();
  }

  // ---- 3. 사진 → 가림 ------------------------------------------------------
  async function handlePhotos(files: FileList | null) {
    if (!files?.length) return;
    resetPages();
    setDemo(false);
    setProcessing(true);
    setPageError("");
    try {
      const raw = await loadPages([...files]);
      const need = students.length * pagesPerStudent;
      if (raw.length !== need) {
        throw new Error(`페이지 수가 맞지 않습니다: 사진 ${raw.length}쪽, 응시 학생 ${students.length}명 × ${pagesPerStudent}쪽 = ${need}쪽. 결시생은 명부에서 결시로 표시하고, 사진은 번호 순서대로 한 학생의 쪽을 연달아 넣어 주세요.`);
      }
      await processAll(raw.map(r => r.image), raw.map(r => r.source), students, pagesPerStudent, template);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  async function processAll(images: Array<ImageBitmap | HTMLCanvasElement>, sources: string[], act: Student[], perStudent: number, tpl: typeof template) {
    const out: ProcessedPage[] = [];
    const ids: Record<string, string> = {};
    for (let si = 0; si < act.length; si++) {
      for (let pj = 0; pj < perStudent; pj++) {
        const k = si * perStudent + pj;
        const { processed, identityUrl } = await processPage({ source: sources[k], index: 0, image: images[k] }, act[si].code, pj + 1, tpl);
        out.push(processed);
        urls.current.push(processed.url);
        if (identityUrl) {
          ids[act[si].code] = identityUrl;
          urls.current.push(identityUrl);
        }
      }
    }
    setPages(out);
    setIdentity(ids);
  }

  function approve() {
    setApprovedHashes(Object.fromEntries(pages.map(p => [p.file, p.sha256])));
  }

  // ---- 데모 ----------------------------------------------------------------
  async function startDemo() {
    const demoRoster = createRoster(demoNames(25));
    demoRoster[3].absent = true;
    const loaded = loadAnswerKey(SAMPLE_KEY_CSV, SAMPLE_KEY_NAME);
    setRoster(demoRoster);
    setNamesText(demoRoster.map(s => s.name).join("\n"));
    setRosterError("");
    setItems(loaded);
    setKeyName(SAMPLE_KEY_NAME);
    setKeyError("");
    setAssessmentId("demo-6과-2-2");
    setSource("예시(가상)");
    setTemplateIdState("iscream-unit");
    setPagesPerStudentState(pageCount(loaded));
    resetPages();
    setPageError("");
    setDemo(true);
    setProcessing(true);
    const act = present(demoRoster);
    const n = pageCount(loaded);
    const canvases = act.flatMap(s => Array.from({ length: n }, (_, p) => demoPage(s.number, s.name, p + 1, "과학 6-2  2. 물질의 연소")));
    await processAll(canvases, canvases.map((_, i) => `가상_${i + 1}.jpg`), act, n, TEMPLATES[0]);
    setProcessing(false);
  }

  // ---- 4. 판독 -------------------------------------------------------------
  async function runOcr() {
    if (!approvedHashes) return;
    setProgress({ done: 0, total: pages.length, errors: [] });
    if (demo) {
      // 데모는 서버로 아무것도 보내지 않는다
      setReadings(syntheticReadings(items, students.map(s => s.code), names, 7).readings);
      setProgress({ done: pages.length, total: pages.length, errors: [] });
      return;
    }
    const next: Readings = {};
    const errors: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const pageItems = itemsOnPage(items, p.page);
      try {
        if (!pageItems.length) continue;
        // 승인한 뒤 바뀐 파일은 보내지 않는다
        if (approvedHashes[p.file] !== p.sha256 || (await sha256Hex(await p.blob.arrayBuffer())) !== p.sha256) {
          throw new Error("승인 이후 파일이 바뀌었습니다. 다시 승인해 주세요.");
        }
        const response = await fetch("/api/assessment/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-STATEtistic-Access-Key": accessKey },
          body: JSON.stringify({ image: await blobToBase64(p.blob), items: pageItems.map(ocrSpec) }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "판독에 실패했습니다.");
        for (const a of payload.answers as Array<{ no: string; answer: string; confidence: number }>) {
          const masked = maskNames(a.answer, names); // 이름은 브라우저 안에서만 대조한다
          next[p.code] ??= {};
          next[p.code][a.no] = mergePages(next[p.code][a.no], { answer: masked.text.trim(), confidence: a.confidence, nameHits: masked.hits.length });
        }
      } catch (e) {
        errors.push(`${p.file}: ${e instanceof Error ? e.message : String(e)}`);
        if (String(e).includes("접속 코드") || String(e).includes("설정해 주세요")) {
          setProgress({ done: i + 1, total: pages.length, errors });
          return;
        }
      }
      setProgress({ done: i + 1, total: pages.length, errors: [...errors] });
    }
    setReadings(next);
  }

  // ---- 5. 교사 확인 ----------------------------------------------------------
  async function suggestEssay(code: string, it: Item, answer: string) {
    const key = reviewKey(code, it.no);
    setEssayBusy(key);
    try {
      if (demo) throw new Error("데모에서는 AI 제안을 쓰지 않습니다. 확정점수를 직접 입력해 보세요.");
      const response = await fetch("/api/assessment/essay", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-STATEtistic-Access-Key": accessKey },
        body: JSON.stringify({ no: it.no, points: it.points, rubric: it.rubric, answer }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "AI 제안에 실패했습니다.");
      setEssayReview(r => ({ ...r, [key]: { ...r[key], aiScore: payload.score, aiEvidence: payload.evidence, aiUnstable: payload.unstable } }));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setEssayBusy("");
    }
  }

  const resultCsv = () => toCsv([...LONG_COLUMNS], result?.rows ?? []);

  const value: GradingState = {
    accessKey, updateAccessKey, health,
    namesText, setNamesText, roster, rosterError, makeRoster, loadRosterFile, toggleAbsent,
    keyName, items, keyError, applyKey, assessmentId, setAssessmentId, source, setSource,
    templateId, setTemplateId, pagesPerStudent, setPagesPerStudent, students, names,
    pages, identity, pageError, processing, checked, setChecked, approved: approvedHashes != null,
    handlePhotos, approve, demo, startDemo, readings, progress, runOcr,
    readReview, setReadReview, essayReview, setEssayReview, essayBusy, suggestEssay, result, resultCsv,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
