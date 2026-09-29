"use client";

// 채점 흐름의 상태. 단계별 페이지(/grading/*)가 이 컨텍스트를 공유한다.
// 이름이 적힌 원본 사진과 명부는 여기(브라우저 메모리)에만 있고, 새로고침하면 사라진다.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnswerKeyError, loadAnswerKey, ocrSpec, pageCount, type Item } from "../lib/assessment/answerKey";
import { addUsage, DEFAULT_PRICING, ZERO_USAGE, type Pricing, type Usage } from "../lib/assessment/cost";
import { toCsv } from "../lib/assessment/csv";
import { blobToBase64, demoPage, loadPages, processPage, TEMPLATES, type ProcessedPage } from "../lib/assessment/images";
import { createRoster, maskNames, parseRoster, present, sha256Hex, type Student } from "../lib/assessment/privacy";
import { buildRows, LONG_COLUMNS, reviewKey, type BuildResult, type EssayReview, type Reading, type Readings, type ReadReview } from "../lib/assessment/records";
import { SAMPLE_KEY_CSV, SAMPLE_KEY_NAME } from "../lib/assessment/sampleKey";
import { demoNames, syntheticReadings } from "../lib/assessment/synthetic";

export type Health = { ready: boolean; missing: string[]; model: string; pricing?: Pricing } | null;
export type Progress = { done: number; total: number; errors: string[] };

const ACCESS_KEY = "statetistic:accessKey";

type GradingState = {
  accessKey: string; updateAccessKey: (v: string) => void; health: Health; pricing: Pricing;
  namesText: string; setNamesText: (v: string) => void; roster: Student[]; rosterError: string;
  makeRoster: () => boolean; loadRosterFile: (f?: File) => Promise<boolean>; toggleAbsent: (code: string) => void;
  keyName: string; items: Item[]; keyError: string; applyKey: (text: string, name: string) => boolean;
  assessmentId: string; setAssessmentId: (v: string) => void; source: string; setSource: (v: string) => void;
  templateId: string; setTemplateId: (v: string) => void; pagesPerStudent: number; setPagesPerStudent: (v: number) => void;
  students: Student[]; names: string[];
  pages: ProcessedPage[]; pagesByCode: Map<string, ProcessedPage[]>; identity: Record<string, string>; pageError: string; processing: boolean;
  checked: boolean; setChecked: (v: boolean) => void; approved: boolean;
  handlePhotos: (files: FileList | null) => Promise<void>; approve: () => void;
  demo: boolean; startDemo: () => Promise<boolean>;
  readings: Readings; failedCodes: string[]; progress: Progress | null; runOcr: () => Promise<void>; ocrUsage: Usage;
  reviewAll: boolean; setReviewAll: (v: boolean) => void;
  readReview: Record<string, ReadReview>; setReadReview: (f: (r: Record<string, ReadReview>) => Record<string, ReadReview>) => void;
  essayReview: Record<string, EssayReview>; setEssayReview: (f: (r: Record<string, EssayReview>) => Record<string, EssayReview>) => void;
  essayBusy: string; essayError: string; suggestEssay: (code: string, it: Item, answer: string, recheck?: boolean) => Promise<void>;
  suggestAllEssays: (it: Item) => Promise<void>; essayUsage: Usage;
  result: BuildResult | null; resultCsv: () => string;
};

const Ctx = createContext<GradingState | null>(null);

export function useGrading() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGrading은 /grading 아래에서만 쓸 수 있습니다");
  return ctx;
}

export function GradingProvider({ children }: { children: ReactNode }) {
  // 접속 코드는 탭을 닫으면 사라지게 둔다. 공용 PC에 남으면 다음 사람이 요금을 쓸 수 있다.
  const [accessKey, setAccessKey] = useState(() => (typeof window === "undefined" ? "" : sessionStorage.getItem(ACCESS_KEY) ?? ""));
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
  const [pagesPerStudent, setPagesPerStudentState] = useState(1);

  const [pages, setPages] = useState<ProcessedPage[]>([]);
  const [identity, setIdentity] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [checked, setChecked] = useState(false);
  const [approvedHashes, setApprovedHashes] = useState<Record<string, string> | null>(null);

  const [readings, setReadings] = useState<Readings>({});
  const [failedCodes, setFailedCodes] = useState<string[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [ocrUsage, setOcrUsage] = useState<Usage>(ZERO_USAGE);
  const [demo, setDemo] = useState(false);
  const [reviewAll, setReviewAll] = useState(false);
  const [readReview, setReadReview] = useState<Record<string, ReadReview>>({});
  const [essayReview, setEssayReview] = useState<Record<string, EssayReview>>({});
  const [essayBusy, setEssayBusy] = useState("");
  const [essayError, setEssayError] = useState("");
  const [essayUsage, setEssayUsage] = useState<Usage>(ZERO_USAGE);
  const urls = useRef<string[]>([]);
  // 같은 이미지·같은 문항이면 다시 돈 내지 않는다 (학생 쪽 해시 묶음 → 판독 결과)
  const ocrCache = useRef(new Map<string, Record<string, Reading>>());

  useEffect(() => {
    localStorage.removeItem(ACCESS_KEY); // 예전 버전이 남긴 코드를 지운다
    fetch("/api/assessment/health", { cache: "no-store" }).then(r => r.json()).then(setHealth).catch(() => setHealth({ ready: false, missing: ["서버 연결"], model: "" }));
    const held = urls.current;
    return () => held.forEach(u => URL.revokeObjectURL(u));
  }, []);

  const hasWork = pages.length > 0 || Object.keys(readings).length > 0;
  useEffect(() => {
    if (!hasWork) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasWork]);

  const template = TEMPLATES.find(t => t.id === templateId) ?? TEMPLATES[0];
  const students = useMemo(() => present(roster), [roster]);
  const names = useMemo(() => roster.map(s => s.name), [roster]);
  const pagesByCode = useMemo(() => {
    const m = new Map<string, ProcessedPage[]>();
    pages.forEach(p => m.set(p.code, [...(m.get(p.code) ?? []), p]));
    return m;
  }, [pages]);
  const readCodes = useMemo(() => Object.keys(readings).concat(failedCodes), [readings, failedCodes]);
  const result = useMemo(
    () => (items.length && readCodes.length
      ? buildRows(items, readings, { assessmentId: assessmentId || "평가", source, codes: readCodes, readReview, essayReview, reviewAll })
      : null),
    [items, readings, readCodes, assessmentId, source, readReview, essayReview, reviewAll],
  );

  function updateAccessKey(value: string) {
    setAccessKey(value);
    sessionStorage.setItem(ACCESS_KEY, value);
  }

  /** 사진·판독·교사 확인을 지우기 전에 묻는다 */
  function confirmReset(reason: string) {
    return !hasWork || confirm(`${reason}\n\n지금까지 넣은 사진, 판독 결과, 교사 확인이 모두 지워집니다. 계속할까요?`);
  }

  function resetPages() {
    urls.current.forEach(u => URL.revokeObjectURL(u));
    urls.current = [];
    setPages([]);
    setIdentity({});
    setApprovedHashes(null);
    setChecked(false);
    setReadings({});
    setFailedCodes([]);
    setProgress(null);
    setReadReview({});
    setEssayReview({});
  }

  // ---- 1. 명부 -------------------------------------------------------------
  function makeRoster() {
    if (!confirmReset("명부를 다시 만듭니다.")) return false;
    try {
      setRoster(createRoster(namesText.split(/\r?\n/), roster));
      setRosterError("");
      resetPages();
      setDemo(false);
      return true;
    } catch (e) {
      setRosterError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  async function loadRosterFile(file?: File) {
    if (!file || !confirmReset("명부를 새로 불러옵니다.")) return false;
    try {
      const loaded = parseRoster(await file.text());
      setRoster(loaded);
      setNamesText(loaded.map(s => s.name).join("\n"));
      setRosterError("");
      resetPages();
      setDemo(false);
      return true;
    } catch (e) {
      setRosterError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  function toggleAbsent(code: string) {
    if (!confirmReset("결시 여부를 바꾸면 사진 순서가 달라집니다.")) return;
    setRoster(rs => rs.map(s => (s.code === code ? { ...s, absent: !s.absent } : s)));
    resetPages();
  }

  // ---- 2. 정답표 -----------------------------------------------------------
  function applyKey(text: string, name: string) {
    try {
      const loaded = loadAnswerKey(text, name);
      if (!confirmReset("정답표를 바꿉니다.")) return false;
      setItems(loaded);
      setKeyName(name);
      setKeyError("");
      setPagesPerStudentState(Math.max(1, pageCount(loaded)));
      if (!assessmentId) setAssessmentId(name.replace(/\.csv$/i, ""));
      resetPages();
      return true;
    } catch (e) {
      setKeyError(e instanceof AnswerKeyError || e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  function setTemplateId(v: string) {
    if (!confirmReset("이름 칸 양식을 바꿉니다.")) return;
    setTemplateIdState(v);
    resetPages();
  }

  function setPagesPerStudent(v: number) {
    if (!confirmReset("학생 1명 쪽수를 바꿉니다.")) return;
    setPagesPerStudentState(Math.max(1, Math.min(8, v || 1)));
    resetPages();
  }

  // ---- 3. 사진 → 가림 ------------------------------------------------------
  async function handlePhotos(files: FileList | null) {
    if (!files?.length || !confirmReset("사진을 새로 넣습니다.")) return;
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
    const hasInput = roster.length > 0 || items.length > 0;
    if ((hasWork || hasInput) && !confirm("가상 반으로 바꿉니다. 지금 넣은 명부·정답표·사진·판독 결과가 모두 지워집니다. 계속할까요?")) return false;
    const demoRoster = createRoster(demoNames(25));
    demoRoster[3].absent = true;
    const loaded = loadAnswerKey(SAMPLE_KEY_CSV, SAMPLE_KEY_NAME);
    resetPages();
    setRoster(demoRoster);
    setNamesText(demoRoster.map(s => s.name).join("\n"));
    setRosterError("");
    setItems(loaded);
    setKeyName(SAMPLE_KEY_NAME);
    setKeyError("");
    setAssessmentId("demo-6과-2-2");
    setSource("예시(가상)");
    setTemplateIdState("iscream-unit");
    const n = Math.max(1, pageCount(loaded));
    setPagesPerStudentState(n);
    setPageError("");
    setDemo(true);
    setProcessing(true);
    const act = present(demoRoster);
    const canvases = act.flatMap(s => Array.from({ length: n }, (_, p) => demoPage(s.number, s.name, p + 1, "과학 6-2  2. 물질의 연소")));
    await processAll(canvases, canvases.map((_, i) => `가상_${i + 1}.jpg`), act, n, TEMPLATES[0]);
    setProcessing(false);
    return true;
  }

  // ---- 4. 판독 -------------------------------------------------------------
  /** 학생 1명당 요청 1번. 이미 읽은 학생은 건너뛰고, 실패한 학생만 다시 보낸다. */
  async function runOcr() {
    if (!approvedHashes) return;
    const specs = items.map(ocrSpec);
    const specKey = JSON.stringify(specs);
    if (demo) {
      // 데모는 서버로 아무것도 보내지 않는다
      setReadings(syntheticReadings(items, students.map(s => s.code), names, 7).readings);
      setFailedCodes([]);
      setProgress({ done: students.length, total: students.length, errors: [] });
      return;
    }
    const todo = students.filter(s => !readings[s.code]);
    const next: Readings = { ...readings };
    const failed: string[] = [];
    const errors: string[] = [];
    setProgress({ done: 0, total: todo.length, errors: [] });
    for (let i = 0; i < todo.length; i++) {
      const s = todo[i];
      try {
        const studentPages = pagesByCode.get(s.code) ?? [];
        // 승인한 뒤 바뀐 파일은 보내지 않는다
        for (const p of studentPages) {
          if (approvedHashes[p.file] !== p.sha256 || (await sha256Hex(await p.blob.arrayBuffer())) !== p.sha256) {
            throw new Error("승인 이후 파일이 바뀌었습니다. 다시 승인해 주세요.");
          }
        }
        const cacheKey = `${studentPages.map(p => p.sha256).join(",")}|${specKey}`;
        let got = ocrCache.current.get(cacheKey);
        if (!got) {
          const response = await fetch("/api/assessment/ocr", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-STATEtistic-Access-Key": accessKey },
            body: JSON.stringify({ images: await Promise.all(studentPages.map(p => blobToBase64(p.blob))), items: specs }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? "판독에 실패했습니다.");
          setOcrUsage(u => addUsage(u, payload.usage));
          got = {};
          for (const a of payload.answers as Array<{ no: string; answer: string; confidence: number }>) {
            const masked = maskNames(a.answer, names); // 이름은 브라우저 안에서만 대조한다
            got[a.no] = { answer: masked.text.trim(), confidence: a.confidence, nameHits: masked.hits.length };
          }
          ocrCache.current.set(cacheKey, got);
        }
        next[s.code] = got;
      } catch (e) {
        failed.push(s.code);
        const message = e instanceof Error ? e.message : String(e);
        errors.push(`${s.code}: ${message}`);
        if (message.includes("접속 코드") || message.includes("설정해 주세요") || message.includes("GEMINI_API_KEY") || message.includes("GEMINI_MODEL")) {
          // 설정 문제는 남은 학생도 모두 실패하므로 멈춘다
          failed.push(...todo.slice(i + 1).map(t => t.code));
          break;
        }
      } finally {
        setProgress({ done: i + 1, total: todo.length, errors: [...errors] });
      }
    }
    setReadings(next);
    setFailedCodes(failed);
    setProgress({ done: todo.length, total: todo.length, errors });
  }

  // ---- 5. 교사 확인 ----------------------------------------------------------
  /** 서술형 AI 제안. 호출은 한 번. recheck이면 한 번 더 받아 앞의 점수와 다르면 표시한다. */
  async function suggestEssay(code: string, it: Item, answer: string, recheck = false) {
    const key = reviewKey(code, it.no);
    setEssayBusy(key);
    setEssayError("");
    try {
      if (demo) throw new Error("데모에서는 AI 제안을 쓰지 않습니다. 확정점수를 직접 입력해 보세요.");
      const response = await fetch("/api/assessment/essay", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-STATEtistic-Access-Key": accessKey },
        body: JSON.stringify({ no: it.no, points: it.points, rubric: it.rubric, answer }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "AI 제안에 실패했습니다.");
      setEssayUsage(u => addUsage(u, payload.usage));
      setEssayReview(r => {
        const prev = r[key] ?? {};
        return {
          ...r,
          [key]: recheck
            ? { ...prev, aiUnstable: prev.aiScore != null && prev.aiScore !== payload.score }
            : { ...prev, aiScore: payload.score, aiEvidence: payload.evidence, aiUnstable: undefined },
        };
      });
    } catch (e) {
      setEssayError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setEssayBusy("");
    }
  }

  async function suggestAllEssays(it: Item) {
    for (const q of result?.essayQueue.filter(q => q.no === it.no && essayReview[reviewKey(q.code, q.no)]?.aiScore == null) ?? []) {
      try {
        await suggestEssay(q.code, it, q.answer);
      } catch {
        return; // 오류는 essayError로 보여 주고 멈춘다
      }
    }
  }

  const resultCsv = () => toCsv([...LONG_COLUMNS], result?.rows ?? []);

  const value: GradingState = {
    accessKey, updateAccessKey, health, pricing: health?.pricing ?? DEFAULT_PRICING,
    namesText, setNamesText, roster, rosterError, makeRoster, loadRosterFile, toggleAbsent,
    keyName, items, keyError, applyKey, assessmentId, setAssessmentId, source, setSource,
    templateId, setTemplateId, pagesPerStudent, setPagesPerStudent, students, names,
    pages, pagesByCode, identity, pageError, processing, checked, setChecked, approved: approvedHashes != null,
    handlePhotos, approve, demo, startDemo, readings, failedCodes, progress, runOcr, ocrUsage,
    reviewAll, setReviewAll, readReview, setReadReview, essayReview, setEssayReview,
    essayBusy, essayError, suggestEssay, suggestAllEssays, essayUsage, result, resultCsv,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
