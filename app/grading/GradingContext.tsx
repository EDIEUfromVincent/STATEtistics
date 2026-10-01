"use client";

// 채점 흐름의 상태. 단계별 페이지(/grading/*)가 이 컨텍스트를 공유한다.
// 이름이 적힌 원본 사진과 명부는 여기(브라우저 메모리)에만 있고, 새로고침하면 사라진다.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnswerKeyError, loadAnswerKey, ocrSpec, pageCount, type Item } from "../lib/assessment/answerKey";
import { addUsage, DEFAULT_PRICING, ZERO_USAGE, type Pricing, type Usage } from "../lib/assessment/cost";
import { toCsv } from "../lib/assessment/csv";
import { estimateShifts } from "../lib/assessment/align";
import { blankLike, cellPair, cropByRegistration, FAINT, grayFromImage, headerNumberBox, register, toPx, strokesOnly, fitForReading, grayFromBlob, grayToPng, ink, matchQuality, pickByInk, preparePage, regionPair, renderBlankPage, type Gray, type PreparedPage } from "../lib/assessment/cells";
import { decide, SURE, UNSURE } from "../lib/assessment/decide";
import { gradeItem } from "../lib/assessment/grade";
import { FormError, parseForm, type FormLayout } from "../lib/assessment/form";
import { formFromPdf, readPdfPages } from "../lib/assessment/pdfForm";
import { applyLayout, blobToBase64, demoPage, LAYOUTS, openPages, processPage, processStaged, stagePage, TEMPLATES, type ProcessedPage, type Template } from "../lib/assessment/images";
import { createRoster, maskNames, matchGroups, numberRoster, parseNumberList, parseRoster, present, sha256Hex, studentLabel, type Student } from "../lib/assessment/privacy";
import { buildRows, LONG_COLUMNS, reviewKey, type BuildResult, type EssayReview, type Reading, type Readings, type ReadReview } from "../lib/assessment/records";
import { SAMPLE_KEY_CSV, SAMPLE_KEY_NAME } from "../lib/assessment/sampleKey";
import { demoNames, syntheticReadings } from "../lib/assessment/synthetic";

export type Health = {
  ready: boolean; missing: string[]; model: string; pricing?: Pricing;
  // 양식 기반 칸 판독: a = Claude, b = 로컬 모델 (없으면 손글씨 칸은 모두 교사 확인)
  cells?: { ready: boolean; missing: string[]; a: string; b: string | null; verify?: string | null };
} | null;
// where: 이 칸이 학생 시험지(가린 쪽)의 어디에 있는지 — 쪽 번호와 쪽 크기에 대한 비율 [왼, 위, 오른, 아래]
// 빈 시험지 PDF로 만든 정답표 초안. 교사가 표에서 고치고 확정해야 채점에 쓴다
export type DraftRow = { 문항: string; 유형: string; 정답: string; 배점: number; 보기수?: number; 채점기준?: string; 행동영역?: string; 성취기준: string; 판독안내: string; 확신: string; 근거: string };
export type Draft = { fileName: string; layout: FormLayout; rows: DraftRow[]; usd: number };
export const DRAFT_COLUMNS = ["문항", "유형", "정답", "배점", "보기수", "채점기준", "행동영역", "난이도", "성취기준", "평가내용", "매핑상태", "판독안내"];

export const AUTO_LAYOUT = "auto";
const SETUP_KEY = "statetistic:setup";
const BLANK_KEY = "statetistic:blankPdf";
const BLANK_NAME_KEY = "statetistic:blankPdfName";
type SavedSetup = {
  className: string; studentCount: string; absentText: string; roster: Array<{ number: number; code: string; absent: boolean }>;
  keyCsv: string; keyName: string; formJson: string; formName: string; assessmentId: string; source: string; pagesPerStudent: number; templateId: string;
};

export type ScanGroup = { group: number; crop: string; read: number | null; code: string; problem: string; auto: boolean };

export type CellInfo = { crop: string; a: string | null; b: string | null; note: string; where?: { page: number; box: [number, number, number, number] } };
export type Progress = { done: number; total: number; errors: string[] };

const ACCESS_KEY = "statetistic:accessKey";

type GradingState = {
  accessKey: string; updateAccessKey: (v: string) => void; health: Health; pricing: Pricing;
  namesText: string; setNamesText: (v: string) => void; roster: Student[]; rosterError: string;
  className: string; setClassName: (v: string) => void; studentCount: string; setStudentCount: (v: string) => void;
  absentText: string; setAbsentText: (v: string) => void; label: (code: string) => string;
  makeRoster: () => boolean; loadRosterFile: (f?: File) => Promise<boolean>; toggleAbsent: (code: string) => void;
  keyName: string; items: Item[]; keyError: string; applyKey: (text: string, name: string) => boolean;
  assessmentId: string; setAssessmentId: (v: string) => void; source: string; setSource: (v: string) => void;
  templateId: string; setTemplateId: (v: string) => void; pagesPerStudent: number; setPagesPerStudent: (v: number) => void;
  layoutId: string; setLayoutId: (v: string) => void; detectedLayout: string; processed: { done: number; total: number } | null;
  students: Student[]; names: string[];
  pages: ProcessedPage[]; pagesByCode: Map<string, ProcessedPage[]>; identity: Record<string, string>; pageError: string; processing: boolean;
  checked: boolean; setChecked: (v: boolean) => void; approved: boolean;
  handlePhotos: (files: FileList | null) => Promise<void>; approve: () => void;
  groups: ScanGroup[]; assignGroup: (group: number, code: string) => void;
  demo: boolean; startDemo: () => Promise<boolean>;
  readings: Readings; failedCodes: string[]; progress: Progress | null; runOcr: () => Promise<void>; ocrUsage: Usage;
  reviewAll: boolean; setReviewAll: (v: boolean) => void;
  readReview: Record<string, ReadReview>; setReadReview: (f: (r: Record<string, ReadReview>) => Record<string, ReadReview>) => void;
  essayReview: Record<string, EssayReview>; setEssayReview: (f: (r: Record<string, EssayReview>) => Record<string, EssayReview>) => void;
  essayBusy: string; essayError: string; suggestEssay: (code: string, it: Item, answer: string, recheck?: boolean) => Promise<void>;
  suggestAllEssays: (it: Item) => Promise<void>; essayUsage: Usage;
  result: BuildResult | null; resultCsv: () => string;
  form: FormLayout | null; formName: string; blankPdf: File | null; formError: string;
  applyForm: (text: string, name: string) => boolean; setBlank: (f: File | null) => void; useCells: boolean;
  cellInfo: Record<string, CellInfo>; cellUsd: number;
  draft: Draft | null; draftBusy: string; draftError: string; learnFromPdf: (f: File) => Promise<void>;
  setDraftRows: (f: (rows: DraftRow[]) => DraftRow[]) => void; adoptDraft: () => boolean; discardDraft: () => void;
};

const Ctx = createContext<GradingState | null>(null);

export function useGrading() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGrading은 GradingProvider(앱 루트) 안에서만 쓸 수 있습니다");
  return ctx;
}

export function GradingProvider({ children }: { children: ReactNode }) {
  // 접속 코드는 탭을 닫으면 사라지게 둔다. 공용 PC에 남으면 다음 사람이 요금을 쓸 수 있다.
  const [accessKey, setAccessKey] = useState(() => (typeof window === "undefined" ? "" : sessionStorage.getItem(ACCESS_KEY) ?? ""));
  const [health, setHealth] = useState<Health>(null);

  // 이름 목록은 선택: 답에 쓴 이름을 가릴 때만 쓰고 화면·결과에는 내보내지 않는다
  const [namesText, setNamesText] = useState("");
  const [className, setClassName] = useState("");
  const [studentCount, setStudentCount] = useState("");
  const [absentText, setAbsentText] = useState("");
  const [roster, setRoster] = useState<Student[]>([]);
  const [rosterError, setRosterError] = useState("");

  const [keyName, setKeyName] = useState("");
  const [keyCsv, setKeyCsv] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [keyError, setKeyError] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [source, setSource] = useState("");
  const [templateId, setTemplateIdState] = useState(TEMPLATES[0].id);
  const [pagesPerStudent, setPagesPerStudentState] = useState(1);
  // 스캔 방식: 기본은 자동(빈 시험지와 가장 잘 겹치는 방식). 직접 고르면 그 방식
  const [layoutId, setLayoutIdState] = useState(AUTO_LAYOUT);
  const [detectedLayout, setDetectedLayout] = useState("");
  const lastScans = useRef<File[]>([]);
  const [processed, setProcessed] = useState<{ done: number; total: number } | null>(null);

  const [pages, setPages] = useState<ProcessedPage[]>([]);
  // 스캔 묶음(학생 한 명분)마다: 반·번호 조각, 읽은 번호, 맞춘 학생 코드(못 맞추면 "미정n"), 확인할 점
  const [groups, setGroups] = useState<ScanGroup[]>([]);
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
  const [form, setForm] = useState<FormLayout | null>(null);
  const [formName, setFormName] = useState("");
  const [blankPdf, setBlankPdf] = useState<File | null>(null);
  const [formError, setFormError] = useState("");
  const [cellInfo, setCellInfo] = useState<Record<string, CellInfo>>({});
  const [cellUsd, setCellUsd] = useState(0);
  const blankCache = useRef(new Map<string, Gray>());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftBusy, setDraftBusy] = useState("");
  const [draftError, setDraftError] = useState("");
  const draftFile = useRef<File | null>(null);
  const urls = useRef<string[]>([]);
  // 같은 이미지·같은 문항이면 다시 돈 내지 않는다 (학생 쪽 해시 묶음 → 판독 결과)
  const ocrCache = useRef(new Map<string, Record<string, Reading>>());

  useEffect(() => {
    localStorage.removeItem(ACCESS_KEY); // 예전 버전이 남긴 코드를 지운다
    fetch("/api/assessment/health", { cache: "no-store" }).then(r => r.json()).then(setHealth).catch(() => setHealth({ ready: false, missing: ["서버 연결"], model: "" }));
    const held = urls.current;
    return () => held.forEach(u => URL.revokeObjectURL(u));
  }, []);

  // ---- 준비한 것 유지: 새로고침해도 학생 번호·시험지(정답표·칸 양식·빈 시험지)가 남는다 ----
  // 이 탭의 sessionStorage에만 두고 탭을 닫으면 지워진다. 이름은 저장하지 않는다.
  const restored = useRef(false);
  function restoreSetup() {
    try {
      const raw = sessionStorage.getItem(SETUP_KEY);
      if (raw) {
        const v = JSON.parse(raw) as SavedSetup;
        setClassName(v.className ?? ""); setStudentCount(v.studentCount ?? ""); setAbsentText(v.absentText ?? "");
        setRoster((v.roster ?? []).map(r => ({ ...r, name: "" })));
        setAssessmentId(v.assessmentId ?? ""); setSource(v.source ?? "");
        if (v.templateId) setTemplateIdState(v.templateId);
        if (v.pagesPerStudent) setPagesPerStudentState(v.pagesPerStudent);
        if (v.keyCsv) {
          const loaded = loadAnswerKey(v.keyCsv, v.keyName ?? "정답표");
          setItems(loaded); setKeyCsv(v.keyCsv); setKeyName(v.keyName ?? "");
          if (v.formJson) { setForm(parseForm(v.formJson, loaded.map(i => i.no))); setFormName(v.formName ?? ""); }
        }
      }
      const pdf = sessionStorage.getItem(BLANK_KEY);
      const pdfName = sessionStorage.getItem(BLANK_NAME_KEY);
      if (pdf && pdfName) setBlankPdf(new File([Uint8Array.from(atob(pdf), c => c.charCodeAt(0))], pdfName, { type: "application/pdf" }));
    } catch {
      // 깨진 저장값은 버린다
      sessionStorage.removeItem(SETUP_KEY);
    }
    restored.current = true;
  }
  // 브라우저 저장소(외부)에서 되살리는 일이라 첫 그리기 뒤에 한 번만 한다. 처음부터 상태에 넣으면 서버가 그린 화면과 어긋난다
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => restoreSetup(), []);
  useEffect(() => {
    if (!restored.current || demo) return;
    const v: SavedSetup = {
      className, studentCount, absentText, roster: roster.map(({ number, code, absent }) => ({ number, code, absent })),
      keyCsv, keyName, formJson: form ? JSON.stringify(form) : "", formName, assessmentId, source, pagesPerStudent, templateId,
    };
    try { sessionStorage.setItem(SETUP_KEY, JSON.stringify(v)); } catch { /* 저장 공간이 부족하면 유지만 포기한다 */ }
  }, [className, studentCount, absentText, roster, keyCsv, keyName, form, formName, assessmentId, source, pagesPerStudent, templateId, demo]);
  useEffect(() => {
    if (!restored.current) return;
    if (!blankPdf) { sessionStorage.removeItem(BLANK_KEY); sessionStorage.removeItem(BLANK_NAME_KEY); return; }
    void blankPdf.arrayBuffer().then(buf => {
      try {
        const bytes = new Uint8Array(buf);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        sessionStorage.setItem(BLANK_KEY, btoa(bin));
        sessionStorage.setItem(BLANK_NAME_KEY, blankPdf.name);
      } catch { /* 큰 PDF는 저장하지 못할 수 있다 — 새로고침하면 다시 넣어야 한다 */ }
    });
  }, [blankPdf]);

  const hasWork = pages.length > 0 || Object.keys(readings).length > 0;
  useEffect(() => {
    if (!hasWork) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasWork]);

  const students = useMemo(() => present(roster), [roster]);
  const names = useMemo(() => [...new Set([...roster.map(s => s.name), ...namesText.split(/\r?\n/)].map(n => n.trim()).filter(Boolean))], [roster, namesText]);
  const label = (code: string) => {
    const st = roster.find(s => s.code === code);
    return st ? studentLabel(st) : code;
  };
  const pagesByCode = useMemo(() => {
    const m = new Map<string, ProcessedPage[]>();
    pages.forEach(p => m.set(p.code, [...(m.get(p.code) ?? []), p]));
    return m;
  }, [pages]);
  const readCodes = useMemo(() => Object.keys(readings).concat(failedCodes), [readings, failedCodes]);
  const numbers = useMemo(() => Object.fromEntries(roster.map(s => [s.code, s.number])), [roster]);
  const result = useMemo(
    () => (items.length && readCodes.length
      ? buildRows(items, readings, { assessmentId: assessmentId || "평가", source, codes: readCodes, readReview, essayReview, reviewAll, numbers })
      : null),
    [items, readings, readCodes, assessmentId, source, readReview, essayReview, reviewAll, numbers],
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
    setGroups([]);
    setApprovedHashes(null);
    setChecked(false);
    setReadings({});
    setFailedCodes([]);
    setProgress(null);
    setReadReview({});
    setEssayReview({});
    setCellInfo({});
  }

  // ---- 1. 학생 번호 ---------------------------------------------------------
  function makeRoster() {
    if (!confirmReset("학생 목록을 다시 만듭니다.")) return false;
    try {
      setRoster(numberRoster(Number(studentCount), parseNumberList(absentText), roster));
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
    if (!file || !confirmReset("학생 번호·코드를 새로 불러옵니다.")) return false;
    try {
      const loaded = parseRoster(await file.text());
      setRoster(loaded);
      setStudentCount(String(loaded.length));
      setAbsentText(loaded.filter(s => s.absent).map(s => s.number).join(", "));
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
    const next = roster.map(s => (s.code === code ? { ...s, absent: !s.absent } : s));
    setRoster(next);
    setAbsentText(next.filter(s => s.absent).map(s => s.number).join(", "));
    resetPages();
  }

  // ---- 2. 정답표 -----------------------------------------------------------
  function applyKey(text: string, name: string) {
    try {
      const loaded = loadAnswerKey(text, name);
      if (!confirmReset("정답표를 바꿉니다.")) return false;
      setItems(loaded);
      setKeyCsv(text);
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

  /** 양식 파일(칸 위치)과 빈 시험지 PDF. 둘 다 있으면 쪽 전체 대신 답 칸 조각만 판독한다 */
  function applyForm(text: string, name: string) {
    try {
      const loaded = parseForm(text, items.map(i => i.no));
      if (!confirmReset("양식 파일을 바꿉니다.")) return false;
      setForm(loaded);
      setFormName(name);
      setFormError("");
      if (!pageCount(items)) setPagesPerStudentState(loaded.pages);
      resetPages();
      return true;
    } catch (e) {
      setFormError(e instanceof FormError || e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  function setBlank(file: File | null) {
    if (file && !/\.pdf$/i.test(file.name)) {
      setFormError("빈 시험지는 PDF여야 합니다.");
      return;
    }
    blankCache.current.clear();
    setBlankPdf(file);
    setFormError("");
  }

  const useCells = Boolean(form && blankPdf);

  /** 빈 시험지 PDF → 칸 위치(AI 없음) → 정답·해설 글로 정답표 초안(Gemini 한 번). 학생 자료는 쓰지 않는다 */
  async function learnFromPdf(file: File) {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { setDraftError("PDF 파일을 넣어 주세요."); return; }
    setDraftError("");
    setDraft(null);
    draftFile.current = file;
    try {
      setDraftBusy("시험지에서 답 칸을 찾는 중…");
      const found = formFromPdf(await readPdfPages(file), file.name.replace(/\.pdf$/i, ""));
      const ids = Object.keys(found.layout.cells);
      if (!ids.length) throw new Error("답 칸을 찾지 못했습니다. 한글·워드에서 만든 PDF인지 확인해 주세요 (종이를 스캔한 PDF는 글자 정보가 없어 칸을 찾을 수 없습니다).");
      if (!accessKey) throw new Error("정답표 초안을 만들려면 위에 접속 코드를 넣어 주세요.");
      setDraftBusy(`답 칸 ${ids.length}개를 찾았습니다. 정답·해설 쪽으로 정답표 초안을 만드는 중…`);
      const response = await fetch("/api/assessment/draft-key", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-STATEtistic-Access-Key": accessKey },
        body: JSON.stringify({
          questionText: found.questionText, answerText: found.answerText,
          cells: ids.map(id => {
            const c = found.layout.cells[id];
            return { id, kind: c.kind, line: found.lineOf[id] ?? "", options: c.kind === "pick" ? Object.keys(c.options ?? {}) : undefined, count: c.kind === "number" ? Object.keys(c.options ?? {}).length : undefined };
          }),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "정답표 초안을 만들지 못했습니다.");
      const got = new Map((data.rows as DraftRow[]).map(r => [r.문항, r]));
      // 칸마다 한 줄. 모델이 빠뜨린 칸도 비워서 남긴다 (교사가 채운다)
      const rows = ids.map(id => got.get(id) ?? { 문항: id, 유형: found.layout.cells[id].kind === "number" ? "선택형" : "단답", 정답: "", 배점: 1, 성취기준: "", 판독안내: found.lineOf[id] ?? "", 확신: "확인필요", 근거: "초안에 없음" });
      setDraft({ fileName: file.name, layout: found.layout, rows, usd: Number(data.usd) || 0 });
      if (!found.answerText) setDraftError("이 PDF에서 정답·해설 쪽을 찾지 못해 정답을 비워 두었습니다. 표에 정답을 적어 주세요.");
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftBusy("");
    }
  }

  const setDraftRows = (f: (rows: DraftRow[]) => DraftRow[]) => setDraft(d => (d ? { ...d, rows: f(d.rows) } : d));
  const discardDraft = () => { setDraft(null); setDraftError(""); };

  /** 교사가 확인한 초안을 정답표·칸 양식·빈 시험지로 한꺼번에 적용한다 */
  function adoptDraft() {
    if (!draft || !draftFile.current) return false;
    const csv = toCsv(DRAFT_COLUMNS, draft.rows.map(r => ({
      // "="로 함께 인정하는 표기는 단답만 받는다. 기호·OX·선택형은 표기 차이(③/3, (다)/다)를 채점 규칙이 이미 같게 본다
      문항: r.문항, 유형: r.유형, 정답: r.유형 === "단답" ? r.정답 : r.정답.split("=")[0].trim(), 배점: r.배점, 보기수: r.유형 === "선택형" ? r.보기수 ?? Object.keys(draft.layout.cells[r.문항]?.options ?? {}).length : "",
      채점기준: r.채점기준 ?? "", 행동영역: r.행동영역 ?? "", 난이도: "", 성취기준: r.성취기준, 평가내용: "", 매핑상태: r.확신 === "확인" ? "확인" : "확인필요", 판독안내: r.판독안내,
    })));
    try {
      const loaded = loadAnswerKey(csv, draft.fileName);
      const layout = parseForm(JSON.stringify(draft.layout), loaded.map(i => i.no));
      if (!confirmReset("이 정답표로 확정합니다.")) return false;
      setItems(loaded);
      setKeyCsv(csv);
      setKeyName(`${draft.fileName} (PDF에서 만듦)`);
      setKeyError("");
      setForm(layout);
      setFormName(draft.fileName);
      setFormError("");
      blankCache.current.clear();
      setBlankPdf(draftFile.current);
      setPagesPerStudentState(layout.pages);
      setTemplateIdState("top-band"); // 1쪽 맨 위 머리글 띠 + 모든 쪽 위 여백을 가린다
      if (!assessmentId) setAssessmentId(draft.fileName.replace(/\.pdf$/i, ""));
      resetPages();
      setDraftError("");
      setDraft(null); // 확정했으니 초안 표 대신 "채점 준비 완료"를 보여 준다
      return true;
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  function setTemplateId(v: string) {
    if (Object.keys(readings).length && !confirm("이름 칸 가리기를 바꾸면 판독 결과와 교사 확인이 지워집니다. 계속할까요?")) return;
    setTemplateIdState(v);
    if (lastScans.current.length) void handlePhotos(lastScans.current, { template: v, again: true });
    else resetPages();
  }

  /** 스캔 방식을 바꾸면 이미 넣은 스캔 파일로 바로 다시 처리한다 (학생 번호·시험지는 그대로) */
  function setLayoutId(v: string) {
    if (Object.keys(readings).length && !confirm("스캔 방식을 바꾸면 판독 결과와 교사 확인이 지워집니다. 계속할까요?")) return;
    setLayoutIdState(v);
    if (lastScans.current.length) void handlePhotos(lastScans.current, { layout: v, again: true });
    else resetPages();
  }

  /** 첫 스캔 장을 방식마다 돌리고 나눠 빈 시험지 1쪽과 가장 잘 겹치는 방식을 고른다. 빈 시험지가 없으면 가로·세로로 짐작 */
  async function detectLayout(list: File[]) {
    const opened = await openPages(list, 2);
    try {
      const first = opened.pages[0];
      if (!first) return LAYOUTS[0].id;
      const image = await first.load();
      try {
        if (!blankPdf) return image.width > image.height ? "2up-landscape" : "single";
        let best = { id: LAYOUTS[0].id, score: -1 };
        for (const l of LAYOUTS) {
          const part = applyLayout(image, l)[0];
          const g = grayFromImage(part, 800);
          part.width = part.height = 0;
          const blank = await renderBlankPage(blankPdf, 0, g.w, g.h);
          const score = register(g, blank).score;
          if (score > best.score) best = { id: l.id, score };
        }
        return best.id;
      } finally {
        if ("close" in image) image.close();
        else image.width = image.height = 0;
      }
    } finally {
      await opened.close();
    }
  }

  function setPagesPerStudent(v: number) {
    if (Object.keys(readings).length && !confirm("쪽수를 바꾸면 판독 결과와 교사 확인이 지워집니다. 계속할까요?")) return;
    const n = Math.max(1, Math.min(8, v || 1));
    setPagesPerStudentState(n);
    if (lastScans.current.length) void handlePhotos(lastScans.current, { pages: n, again: true });
    else resetPages();
  }


  // ---- 3. 사진 → 가림 ------------------------------------------------------
  async function handlePhotos(files: FileList | File[] | null, opts: { layout?: string; again?: boolean; template?: string; pages?: number } = {}) {
    if (!files?.length) return;
    if (!opts.again && !confirmReset("사진을 새로 넣습니다.")) return;
    const list = [...files];
    // 설정을 바꾸며 다시 처리할 때는 바뀐 값을 바로 쓴다 (상태는 다음 그리기에서야 바뀐다)
    const tpl = TEMPLATES.find(t => t.id === (opts.template ?? templateId)) ?? TEMPLATES[0];
    const pps = opts.pages ?? pagesPerStudent;
    lastScans.current = list;
    resetPages();
    setDemo(false);
    setProcessing(true);
    setPageError("");
    let close = async () => {};
    try {
      let chosen = opts.layout ?? layoutId;
      if (chosen === AUTO_LAYOUT) {
        setProcessed(null);
        chosen = await detectLayout(list);
      }
      setDetectedLayout(chosen);
      const layout = LAYOUTS.find(l => l.id === chosen) ?? LAYOUTS[0];
      const opened = await openPages(list, layout.split);
      close = opened.close;
      const have = opened.pages.length * layout.split;
      if (have % pps) throw new Error(`쪽 수가 맞지 않습니다: 스캔 ${opened.pages.length}장${layout.split === 2 ? " × 2쪽(모아 찍기)" : ""} = ${have}쪽은 학생 1명 ${pps}쪽으로 나누어떨어지지 않습니다. 스캔 방식과 학생 1명 쪽수를 확인하세요.`);
      const groupCount = have / pps;
      // 빈 시험지와 접속 코드가 있으면 1쪽 머리글의 "반·번호"를 읽어 학생을 맞춘다 (스캔 순서와 상관없음)
      const numberBox = blankPdf ? await headerNumberBox(blankPdf).catch(() => null) : null;
      const byNumber = Boolean(numberBox && accessKey && !demo);
      if (!byNumber && groupCount !== students.length) {
        throw new Error(`스캔은 ${groupCount}명분인데 응시 학생은 ${students.length}명입니다. 결시생을 학생 번호 단계에서 표시하거나, 시험지 단계에서 빈 시험지 PDF를 넣고 접속 코드를 넣으면 반·번호를 읽어 자동으로 맞춥니다.`);
      }
      if (byNumber && groupCount > roster.length) throw new Error(`스캔은 ${groupCount}명분인데 학생 수는 ${roster.length}명입니다. 학생 번호 단계의 학생 수를 확인하세요.`);
      // 한 장씩 읽고 → 돌리고·나누고 → 작은 JPEG로 잠시 모아 둔다 (원본 스캔은 바로 버린다).
      const staged: Array<{ group: number; page: number; source: string; blob: Blob; profile: number[] }> = [];
      let k = 0;
      setProcessed({ done: 0, total: have });
      for (const src of opened.pages) {
        const image = await src.load();
        for (const part of applyLayout(image, layout)) {
          staged.push({ group: Math.floor(k / pps), page: (k % pps) + 1, source: src.source, ...(await stagePage({ source: src.source, index: src.index, image: part })) });
          k++;
          part.width = part.height = 0; // 캔버스 메모리를 바로 돌려준다
        }
        if ("close" in image) image.close();
        else image.width = image.height = 0;
        setProcessed({ done: k, total: have });
      }
      // "반·번호" 조각: 1쪽 머리글에서 가장 오른쪽 "이름" 글자 앞까지만 (이름 글씨는 들어가지 않는다)
      const crops: Array<{ url: string; png: Blob } | null> = Array(groupCount).fill(null);
      if (numberBox && blankPdf) {
        for (const st of staged.filter(x => x.page === 1)) {
          const scan = await grayFromBlob(st.blob);
          const key = `0:${scan.w}x${scan.h}`;
          let blank = blankCache.current.get(key);
          if (!blank) {
            blank = await renderBlankPage(blankPdf, 0, scan.w, scan.h);
            blankCache.current.set(key, blank);
          }
          const png = await grayToPng(cropByRegistration(scan, register(scan, blank), numberBox));
          const url = URL.createObjectURL(png);
          urls.current.push(url);
          crops[st.group] = { url, png };
        }
      }
      // 묶음 → 학생
      let codes: Array<string | null> = students.map(s => s.code);
      let reads: Array<number | null> = Array(groupCount).fill(null);
      let problems: string[] = Array(groupCount).fill("");
      if (byNumber) {
        const response = await fetch("/api/assessment/numbers", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-STATEtistic-Access-Key": accessKey },
          body: JSON.stringify({ crops: await Promise.all(crops.map(async (c, g) => ({ id: `G${g}`, image: c ? await blobToBase64(c.png) : "" }))) }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "반·번호를 읽지 못했습니다.");
        setCellUsd(v => v + (Number(data.usd) || 0));
        const got = new Map((data.rows as Array<{ id: string; number: number | null; sure: boolean }>).map(r => [r.id, r]));
        reads = crops.map((_, g) => got.get(`G${g}`)?.number ?? null);
        const { matches, unscanned } = matchGroups(reads.map((number, group) => ({ group, number, sure: got.get(`G${group}`)?.sure })), roster);
        codes = matches.map(m => m.code);
        problems = matches.map(m => m.problem);
        // 스캔이 없는 번호는 결시로 바꾸고, 스캔이 있는 번호는 응시로 둔다
        setRoster(rs => rs.map(s => ({ ...s, absent: unscanned.includes(s.number) })));
        setAbsentText(unscanned.join(", "));
      }
      const groupCode = (g: number) => codes[g] ?? `미정${g + 1}`;
      // 쪽 번호마다 반 전체와 비교해 밀린 만큼 가림 띠를 늘린다 (줄이지는 않는다)
      const out: ProcessedPage[] = [];
      for (let pageNo = 1; pageNo <= pps; pageNo++) {
        const group = staged.filter(st => st.page === pageNo);
        const shifts = estimateShifts(group.map(st => st.profile));
        for (let i = 0; i < group.length; i++) {
          const st = group[i];
          const result = await processStaged(st.blob, st.source, groupCode(st.group), pageNo, tpl, shifts[i]);
          out.push(result.processed);
          urls.current.push(result.processed.url);
        }
      }
      const numberOf = new Map(roster.map(s => [s.code, s.number]));
      out.sort((a, b) => ((numberOf.get(a.code) ?? 999) - (numberOf.get(b.code) ?? 999)) || a.code.localeCompare(b.code) || a.page - b.page);
      setPages(out);
      setIdentity(Object.fromEntries(crops.flatMap((c, g) => (c ? [[groupCode(g), c.url]] : []))));
      setGroups(crops.map((c, g) => ({ group: g, crop: c?.url ?? "", read: reads[g], code: groupCode(g), problem: problems[g], auto: byNumber })));
    } catch (e) {
      setPageError(e instanceof Error ? e.message : String(e));
    } finally {
      await close();
      setProcessing(false);
    }
  }

  /** 교사가 스캔 묶음을 다른 학생에게 옮긴다 (번호를 잘못 읽었거나 못 읽었을 때). 그 학생에게 있던 묶음은 "미정"이 된다 */
  function assignGroup(group: number, code: string) {
    const target = groups.find(x => x.group === group);
    if (!target || target.code === code) return;
    const holder = groups.find(x => x.code === code);
    const rename = new Map<string, string>([[target.code, code]]);
    if (holder) rename.set(code, `미정${holder.group + 1}`);
    setPages(ps => ps.map(p => {
      const next = rename.get(p.code);
      return next ? { ...p, code: next, file: `${next}_p${p.page}.jpg` } : p;
    }));
    setIdentity(ids => Object.fromEntries(Object.entries(ids).map(([c, url]) => [rename.get(c) ?? c, url])));
    const nextGroups = groups.map(x => (x.group === group ? { ...x, code, problem: "교사가 맞춤" } : holder && x.group === holder.group ? { ...x, code: `미정${x.group + 1}`, problem: "다른 묶음에 번호를 넘겨줌" } : x));
    setGroups(nextGroups);
    const scanned = new Set(nextGroups.map(x => x.code));
    setRoster(rs => rs.map(s => ({ ...s, absent: !scanned.has(s.code) })));
    setAbsentText(roster.filter(s => !scanned.has(s.code)).map(s => s.number).join(", "));
    setApprovedHashes(null);
    setChecked(false);
  }

  async function processAll(images: Array<ImageBitmap | HTMLCanvasElement>, sources: string[], act: Student[], perStudent: number, tpl: Template) {
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
    if (groups.some(x => x.code.startsWith("미정"))) {
      setPageError("학생을 정하지 못한 스캔 묶음이 있습니다. 아래 표에서 학생을 골라 주세요.");
      return;
    }
    setPageError("");
    setApprovedHashes(Object.fromEntries(pages.map(p => [p.file, p.sha256])));
  }

  // ---- 데모 ----------------------------------------------------------------
  async function startDemo() {
    const hasInput = roster.length > 0 || items.length > 0;
    if ((hasWork || hasInput) && !confirm("가상 반으로 바꿉니다. 지금 넣은 학생 번호·정답표·사진·판독 결과가 모두 지워집니다. 계속할까요?")) return false;
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
    if (useCells && !demo) return runCells();
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
          // 문항과 하나도 맞지 않으면 판독 성공이 아니다 (모두 빈칸으로 처리되면 안 된다)
          if (!payload.matched) {
            throw new Error(`판독 결과가 정답표 문항과 맞지 않습니다${payload.unmatched?.length ? ` (받은 번호: ${payload.unmatched.slice(0, 5).join(", ")})` : ""}`);
          }
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

  /**
   * 양식 기반 칸 판독. 학생마다: 가린 쪽 위에 빈 양식을 겹친다 → 칸마다 더해진 잉크를 센다 →
   *  빈칸·확실히 고른 보기는 여기서 끝 (AI 없음) → 나머지 칸만 "빈 양식 칸 | 학생 칸" 조각으로 두 판독기에 보낸다
   *  → 두 판독이 같고 확실할 때만 자동 확정, 나머지는 교사 확인.
   */
  async function runCells() {
    if (!approvedHashes || !form || !blankPdf) return;
    const todo = students.filter(s => !readings[s.code]);
    const next: Readings = { ...readings };
    const info: Record<string, CellInfo> = { ...cellInfo };
    const failed: string[] = [];
    const errors: string[] = [];
    let usd = 0;
    setProgress({ done: 0, total: todo.length, errors: [] });
    for (let i = 0; i < todo.length; i++) {
      const s = todo[i];
      try {
        const studentPages = pagesByCode.get(s.code) ?? [];
        for (const p of studentPages) {
          if (approvedHashes[p.file] !== p.sha256 || (await sha256Hex(await p.blob.arrayBuffer())) !== p.sha256) {
            throw new Error("승인 이후 파일이 바뀌었습니다. 다시 승인해 주세요.");
          }
        }
        const prepared = new Map<number, { page: PreparedPage; quality: number }>();
        for (const p of studentPages) {
          const index = p.page - 1;
          if (index >= form.pages) continue;
          const scan = await grayFromBlob(p.blob);
          const key = `${index}:${scan.w}x${scan.h}`;
          let blank = blankCache.current.get(key);
          if (!blank) {
            blank = await renderBlankPage(blankPdf, index, scan.w, scan.h);
            blankCache.current.set(key, blank);
          }
          const page = preparePage(scan, blank);
          prepared.set(index, { page, quality: matchQuality(page) });
        }
        const got: Record<string, Reading> = {};
        const noMarkOnOptions = new Map<string, { blank: Gray; student: Gray }>();
        const ask: Array<{ no: string; hint: string; blank: Gray; student: Gray }> = [];
        const teacher = (no: string, note: string) => (got[no] = { answer: "", confidence: UNSURE, nameHits: 0, note });
        // AI 없이 잉크로 정한 칸도 사진을 남겨 교사가 "모든 판독 대조"에서 보고 고칠 수 있게 한다
        const inkOnly: Array<{ no: string; student: Gray }> = [];
        const byInk = (no: string, answer: string, pair: () => { student: Gray }) => {
          got[no] = { answer, confidence: SURE, nameHits: 0, note: "잉크로 판정 (AI 안 씀)" };
          inkOnly.push({ no, student: pair().student });
        };
        for (const it of items) {
          const cell = form.cells[it.no];
          const pp = cell && prepared.get(cell.page);
          if (!cell || !pp) { teacher(it.no, "양식에 칸이 없거나 그 쪽이 없음"); continue; }
          // 흐린 연필까지 잡는 기준으로 잰다. 이 기준에서도 잉크가 없어야 확실한 빈칸
          const amount = ink(pp.page, cell.region, FAINT);
          const pair = () => (cell.kind === "number" ? regionPair(pp.page, cell.region) : cellPair(pp.page, cell.region));
          if (pp.quality < 0.6) {
            // 빈 양식과 잘 겹치지 않는 쪽: 잉크 판정을 믿을 수 없다
            ask.push({ no: it.no, hint: cell.hint ?? "", ...pair() });
            info[reviewKey(s.code, it.no)] = { crop: "", a: null, b: null, note: "이 쪽이 빈 양식과 잘 겹치지 않음" };
            continue;
          }
          if (cell.kind === "pick") {
            const r = pickByInk(pp.page, cell);
            if (r.pick === "" && amount < 40) { byInk(it.no, "", pair); continue; }
            if (r.pick) { byInk(it.no, r.pick, pair); continue; }
            ask.push({ no: it.no, hint: cell.hint ?? "( 가 / 나 ) 중 ○표 한 낱말", ...pair() });
            continue;
          }
          if (amount < (cell.kind === "number" ? 80 : 40)) { byInk(it.no, "", pair); continue; }
          if (cell.kind === "number" && pickByInk(pp.page, cell).pick === "") {
            // 보기에 표시가 없다 → 답은 문제 옆에 쓴 번호뿐이어야 한다. 확인 판독 때 인쇄를 지운 조각을 쓴다
            const only = strokesOnly(pp.page, cell.region);
            noMarkOnOptions.set(it.no, { blank: blankLike(only), student: only });
          }
          ask.push({ no: it.no, hint: cell.hint ?? "", ...pair() });
        }
        // 교사가 원래 시험지에서 바로 찾을 수 있게 칸 위치를 남긴다
        const whereOf: Record<string, CellInfo["where"]> = {};
        for (const it of items) {
          const cell = form.cells[it.no];
          const pp = cell && prepared.get(cell.page);
          if (!cell || !pp) continue;
          const [x0, y0, x1, y1] = toPx(pp.page, cell.region);
          const { w, h } = pp.page.scan;
          whereOf[it.no] = { page: cell.page + 1, box: [Math.max(0, x0 / w), Math.max(0, y0 / h), Math.min(1, x1 / w), Math.min(1, y1 / h)] };
        }
        for (const q of inkOnly) {
          const crop = URL.createObjectURL(await grayToPng(fitForReading(q.student)));
          urls.current.push(crop);
          info[reviewKey(s.code, q.no)] = { crop, a: got[q.no].answer, b: null, note: got[q.no].note ?? "", where: whereOf[q.no] };
        }
        if (ask.length) {
          const payload = await Promise.all(ask.map(async q => {
            const blankPng = await grayToPng(fitForReading(q.blank));
            const studentPng = await grayToPng(fitForReading(q.student));
            const crop = URL.createObjectURL(studentPng);
            urls.current.push(crop);
            const key = reviewKey(s.code, q.no);
            info[key] = { crop, a: null, b: null, note: info[key]?.note ?? "", where: whereOf[q.no] };
            return { id: q.no, hint: q.hint, blank: await blobToBase64(blankPng), student: await blobToBase64(studentPng) };
          }));
          const response = await fetch("/api/assessment/cells", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-STATEtistic-Access-Key": accessKey },
            body: JSON.stringify({ cells: payload }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "칸 판독에 실패했습니다.");
          usd += Number(data.usd) || 0;
          if (data.errors?.length) errors.push(...(data.errors as string[]).map(e => `${s.code}: ${e}`));
          for (const c of data.cells as Array<{ id: string; a: { answer: string; formDiffers: boolean; multipleMarks: boolean } | null; b: { answer: string; formDiffers: boolean; multipleMarks: boolean } | null }>) {
            const it = items.find(x => x.no === c.id)!;
            const key = reviewKey(s.code, c.id);
            // 이름은 브라우저 안에서만 대조한다
            const a = c.a ? maskNames(c.a.answer, names) : null;
            const b = c.b ? maskNames(c.b.answer, names) : null;
            // 로컬 판독기를 쓰지 않으면(Claude 단독) 교차 검증 없이 decide의 규칙(정답과 비슷한 오답·빈칸 등)만 적용한다
            const single = data.readers?.b == null;
            const aText = a ? a.text.trim() : null;
            const d = decide(it, aText, single ? aText : b ? b.text.trim() : null);
            const pageNote = info[key]?.note ?? "";
            const formNote = c.a?.formDiffers || c.b?.formDiffers ? "판독기가 빈 양식과 인쇄 글자가 다르다고 봄" : "";
            // 잉크가 있어서 보낸 칸인데 두 판독 모두 빈칸이면 흐린 글씨를 놓쳤을 수 있다
            const cellKind = form.cells[c.id]?.kind;
            const inkNote = cellKind === "write" && a && !a.text.trim() && (single || (b && !b.text.trim())) ? "잉크는 있는데 빈칸으로 읽힘" : "";
            // 보기에 ○표를 하고 문제 옆에 다른 번호를 쓰는 식으로 답이 둘이면 교사가 정한다
            const marksNote = c.a?.multipleMarks || c.b?.multipleMarks ? "학생 표시가 둘 이상" : "";
            const note = [pageNote, formNote, inkNote, marksNote, d.note].filter(Boolean).join(" · ");
            const unsure = Boolean(inkNote) || (Boolean(pageNote || formNote || marksNote) && it.kind !== "서술");
            got[c.id] = { answer: d.answer, confidence: unsure ? UNSURE : d.confidence, nameHits: (a?.hits.length ?? 0) + (b?.hits.length ?? 0), note };
            info[key] = { ...info[key], a: a?.text ?? null, b: b?.text ?? null, note };
          }
          // 확인 판독: 주 판독이 "정답"으로 읽은 칸만 다른 계열 모델이 다시 읽는다.
          // 싼 모델은 문제를 풀어 정답을 적는 쪽으로 틀리기 쉬워서, 없는 점수를 주는 오류를 여기서 막는다
          if (health?.cells?.verify) {
            const suspects = payload.filter(p => {
              const it = items.find(x => x.no === p.id)!;
              const r = got[p.id];
              return it.kind !== "서술" && r?.confidence === SURE && gradeItem(it, r.answer).correct === true;
            });
            if (suspects.length) {
              const verifyCells = await Promise.all(suspects.map(async p => {
                const only = noMarkOnOptions.get(p.id);
                if (!only) return p;
                return {
                  id: p.id,
                  hint: "인쇄 글자를 지우고 학생이 손으로 더한 획만 남긴 조각입니다. 손으로 쓴 보기 번호(1~5)가 보일 때만 그 번호를 적고, 동그라미·선·체크만 있으면 빈 문자열",
                  blank: await blobToBase64(await grayToPng(only.blank)),
                  student: await blobToBase64(await grayToPng(fitForReading(only.student))),
                };
              }));
              const vr = await fetch("/api/assessment/cells", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-STATEtistic-Access-Key": accessKey },
                body: JSON.stringify({ cells: verifyCells, verify: true }),
              });
              const vd = await vr.json();
              if (!vr.ok) throw new Error(vd.error ?? "확인 판독에 실패했습니다.");
              usd += Number(vd.usd) || 0;
              for (const c of vd.cells as Array<{ id: string; a: { answer: string } | null }>) {
                const it = items.find(x => x.no === c.id)!;
                const key = reviewKey(s.code, c.id);
                const v = c.a ? maskNames(c.a.answer, names).text.trim() : null;
                if (v != null && gradeItem(it, v).correct === true) continue;
                const why = v == null ? "확인 판독 실패"
                  : noMarkOnOptions.has(c.id) ? `보기에 표시가 없고, 인쇄를 지운 조각에서 쓴 번호가 "${v || "안 보임"}"`
                  : `확인 판독(${vd.reader})은 "${v}"로 읽음`;
                got[c.id] = { ...got[c.id], confidence: UNSURE, note: [got[c.id].note, why].filter(Boolean).join(" · ") };
                info[key] = { ...info[key], b: v, note: [info[key]?.note, why].filter(Boolean).join(" · ") };
              }
            }
          }
        }
        next[s.code] = got;
      } catch (e) {
        failed.push(s.code);
        const message = e instanceof Error ? e.message : String(e);
        errors.push(`${s.code}: ${message}`);
        if (message.includes("접속 코드") || message.includes("설정해 주세요") || message.includes("ANTHROPIC_API_KEY") || message.includes("GEMINI_API_KEY")) {
          failed.push(...todo.slice(i + 1).map(t => t.code));
          break;
        }
      } finally {
        setProgress({ done: i + 1, total: todo.length, errors: [...errors] });
        const spent = usd;
        setCellUsd(v => v + spent);
        usd = 0;
      }
    }
    setReadings(next);
    setCellInfo(info);
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
    className, setClassName, studentCount, setStudentCount, absentText, setAbsentText, label,
    keyName, items, keyError, applyKey, assessmentId, setAssessmentId, source, setSource,
    templateId, setTemplateId, pagesPerStudent, setPagesPerStudent, layoutId, setLayoutId, detectedLayout, processed, students, names,
    pages, pagesByCode, identity, pageError, processing, checked, setChecked, approved: approvedHashes != null,
    handlePhotos, approve, groups, assignGroup, demo, startDemo, readings, failedCodes, progress, runOcr, ocrUsage,
    reviewAll, setReviewAll, readReview, setReadReview, essayReview, setEssayReview,
    essayBusy, essayError, suggestEssay, suggestAllEssays, essayUsage, result, resultCsv,
    form, formName, blankPdf, formError, applyForm, setBlank, useCells, cellInfo, cellUsd,
    draft, draftBusy, draftError, learnFromPdf, setDraftRows, adoptDraft, discardDraft,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
