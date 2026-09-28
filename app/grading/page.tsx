"use client";
/* eslint-disable @next/next/no-img-element -- 미리보기는 브라우저 메모리의 blob URL이라 next/image를 쓸 수 없다 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "../components/AppHeader";
import { AnswerKeyError, itemsOnPage, loadAnswerKey, ocrSpec, pageCount, type Item } from "../lib/assessment/answerKey";
import { toCsv } from "../lib/assessment/csv";
import { blobToBase64, demoPage, loadPages, processPage, TEMPLATES, type ProcessedPage } from "../lib/assessment/images";
import { createRoster, maskNames, parseRoster, present, rosterToCsv, sha256Hex, type Student } from "../lib/assessment/privacy";
import { buildRows, LONG_COLUMNS, mergePages, pendingCount, reviewKey, type EssayReview, type Readings, type ReadReview } from "../lib/assessment/records";
import { SAMPLE_KEY_CSV, SAMPLE_KEY_NAME } from "../lib/assessment/sampleKey";
import { demoNames, syntheticReadings } from "../lib/assessment/synthetic";
import { downloadBlob } from "../lib/generator";

type Health = { ready: boolean; missing: string[]; model: string } | null;
type Progress = { done: number; total: number; errors: string[] };

export default function GradingPage() {
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
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [pagesPerStudent, setPagesPerStudent] = useState(0);

  const [pages, setPages] = useState<ProcessedPage[]>([]);
  const [identity, setIdentity] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [checked, setChecked] = useState(false);
  const [approved, setApproved] = useState<Record<string, string> | null>(null);

  const [readings, setReadings] = useState<Readings>({});
  const [progress, setProgress] = useState<Progress | null>(null);
  const [demo, setDemo] = useState(false);
  const [readReview, setReadReview] = useState<Record<string, ReadReview>>({});
  const [essayReview, setEssayReview] = useState<Record<string, EssayReview>>({});
  const [essayBusy, setEssayBusy] = useState("");
  const urls = useRef<string[]>([]);

  useEffect(() => {
    fetch("/api/assessment/health", { cache: "no-store" }).then(r => r.json()).then(setHealth).catch(() => setHealth({ ready: false, missing: ["서버 연결"], model: "" }));
    return () => urls.current.forEach(u => URL.revokeObjectURL(u));
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
    setApproved(null);
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
    } catch (e) {
      setRosterError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadRosterFile(file?: File) {
    if (!file) return;
    try {
      const loaded = parseRoster(await file.text());
      setRoster(loaded);
      setNamesText(loaded.map(s => s.name).join("\n"));
      setRosterError("");
      resetPages();
    } catch (e) {
      setRosterError(e instanceof Error ? e.message : String(e));
    }
  }

  function toggleAbsent(code: string) {
    setRoster(rs => rs.map(s => (s.code === code ? { ...s, absent: !s.absent } : s)));
    resetPages();
  }

  function printCards() {
    const w = window.open("", "_blank");
    if (!w) return;
    const doc = w.document;
    doc.title = "학생 코드 카드";
    const style = doc.createElement("style");
    style.textContent = "body{font-family:sans-serif}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.c{border:1px dashed #999;padding:14px;text-align:center}b{display:block;font-size:40px;letter-spacing:6px;margin:6px 0}small{font-size:11px;color:#555}";
    doc.head.append(style);
    const grid = doc.createElement("div");
    grid.className = "g";
    for (const s of roster) {
      const card = doc.createElement("div");
      card.className = "c";
      const name = doc.createElement("div");
      name.textContent = s.name;
      const code = doc.createElement("b");
      code.textContent = s.code;
      const hint = doc.createElement("small");
      hint.textContent = "시험지 이름 칸에 이름 대신 이 코드를 쓰세요";
      card.append(name, code, hint);
      grid.append(card);
    }
    doc.body.append(grid);
    w.print();
  }

  // ---- 2. 정답표 -----------------------------------------------------------
  function applyKey(text: string, name: string) {
    try {
      const loaded = loadAnswerKey(text, name);
      setItems(loaded);
      setKeyName(name);
      setKeyError("");
      setPagesPerStudent(pageCount(loaded));
      if (!assessmentId) setAssessmentId(name.replace(/\.csv$/i, ""));
      resetPages();
    } catch (e) {
      setItems([]);
      setKeyError(e instanceof AnswerKeyError || e instanceof Error ? e.message : String(e));
    }
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
      await processAll(raw.map(r => r.image), raw.map(r => r.source));
    } catch (e) {
      setPageError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }

  async function processAll(images: Array<ImageBitmap | HTMLCanvasElement>, sources: string[]) {
    const out: ProcessedPage[] = [];
    const ids: Record<string, string> = {};
    for (let si = 0; si < students.length; si++) {
      for (let pj = 0; pj < pagesPerStudent; pj++) {
        const k = si * pagesPerStudent + pj;
        const { processed, identityUrl } = await processPage({ source: sources[k], index: 0, image: images[k] }, students[si].code, pj + 1, template);
        out.push(processed);
        urls.current.push(processed.url);
        if (identityUrl) {
          ids[students[si].code] = identityUrl;
          urls.current.push(identityUrl);
        }
      }
    }
    setPages(out);
    setIdentity(ids);
  }

  function approve() {
    setApproved(Object.fromEntries(pages.map(p => [p.file, p.sha256])));
  }

  // ---- 데모 ----------------------------------------------------------------
  async function startDemo() {
    const demoRoster = createRoster(demoNames(25));
    demoRoster[3].absent = true;
    const loaded = loadAnswerKey(SAMPLE_KEY_CSV, SAMPLE_KEY_NAME);
    setRoster(demoRoster);
    setNamesText(demoRoster.map(s => s.name).join("\n"));
    setItems(loaded);
    setKeyName(SAMPLE_KEY_NAME);
    setKeyError("");
    setAssessmentId("demo-6과-2-2");
    setSource("예시(가상)");
    setTemplateId("iscream-unit");
    setPagesPerStudent(pageCount(loaded));
    resetPages();
    setDemo(true);
    setProcessing(true);
    const act = present(demoRoster);
    const n = pageCount(loaded);
    const canvases = act.flatMap(s => Array.from({ length: n }, (_, p) => demoPage(s.number, s.name, p + 1, "과학 6-2  2. 물질의 연소")));
    const out: ProcessedPage[] = [];
    const ids: Record<string, string> = {};
    for (let i = 0; i < canvases.length; i++) {
      const s = act[Math.floor(i / n)];
      const { processed, identityUrl } = await processPage({ source: `가상_${i + 1}.jpg`, index: 0, image: canvases[i] }, s.code, (i % n) + 1, TEMPLATES[0]);
      out.push(processed);
      urls.current.push(processed.url);
      if (identityUrl) {
        ids[s.code] = identityUrl;
        urls.current.push(identityUrl);
      }
    }
    setPages(out);
    setIdentity(ids);
    setProcessing(false);
  }

  // ---- 4. 판독 -------------------------------------------------------------
  async function runOcr() {
    if (!approved) return;
    setProgress({ done: 0, total: pages.length, errors: [] });
    const next: Readings = {};
    const errors: string[] = [];
    if (demo) {
      // 데모는 서버로 아무것도 보내지 않는다
      const fake = syntheticReadings(items, students.map(s => s.code), names, 7);
      setReadings(fake.readings);
      setProgress({ done: pages.length, total: pages.length, errors: [] });
      return;
    }
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const pageItems = itemsOnPage(items, p.page);
      try {
        if (!pageItems.length) continue;
        // 승인한 뒤 바뀐 파일은 보내지 않는다
        if (approved[p.file] !== p.sha256 || (await sha256Hex(await p.blob.arrayBuffer())) !== p.sha256) {
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

  // ---- 6. 결과 ---------------------------------------------------------------
  function resultCsv() {
    return toCsv([...LONG_COLUMNS], result?.rows ?? []);
  }

  function openAnalysis() {
    sessionStorage.setItem("statetistic:assessmentCsv", resultCsv());
    window.location.href = "/analysis";
  }

  const pending = result ? pendingCount(result.rows) : 0;
  const readyForPhotos = students.length > 0 && items.length > 0 && pagesPerStudent > 0;
  const byStudent = useMemo(() => {
    const m = new Map<string, ProcessedPage[]>();
    pages.forEach(p => m.set(p.code, [...(m.get(p.code) ?? []), p]));
    return m;
  }, [pages]);

  return (
    <main>
      <AppHeader active="grading" title="시험지 채점" description="사진을 모은 뒤부터: 이름 칸 가림 → 교사 승인 → 판독 → 규칙 채점 → 분석 데이터" />
      <div className="grading-page">
        <section className="grading-privacy">
          <div>
            <b>이 화면의 보안 원칙</b>
            <p>이름이 적힌 원본 사진과 명부는 이 브라우저 안에만 있습니다. 서버로 가는 것은 이름 칸을 검게 가린 페이지와(판독용), 이름을 가린 서술형 답(선택)뿐이며, 서버는 저장하지 않습니다. 판독에는 정답을 보내지 않습니다.</p>
          </div>
          <button className="secondary-action" onClick={startDemo} disabled={processing}>가상 반으로 체험하기</button>
        </section>

        <section className="grading-card">
          <header><span>00</span><h3>서버 연결</h3></header>
          <div className="grading-row">
            <label className="access-key-control">접속 코드<input type="password" autoComplete="off" value={accessKey} onChange={e => updateAccessKey(e.target.value)} placeholder="이 브라우저에만 저장됩니다" /></label>
            <p className={health?.ready ? "ok-note" : "warn-note"}>
              {health == null ? "확인 중…" : health.ready ? `판독 준비됨 (${health.model})` : `판독 설정 필요: ${health.missing.join(", ")} — 데모는 설정 없이 쓸 수 있습니다`}
            </p>
          </div>
        </section>

        <section className="grading-card">
          <header><span>01</span><h3>학생 코드 명부</h3><p>코드는 출석번호와 무관한 무작위 값입니다. 명부는 서버로 보내지 않으며, 페이지를 닫으면 사라지니 파일로 보관하세요.</p></header>
          <div className="grading-two">
            <div>
              <textarea value={namesText} onChange={e => setNamesText(e.target.value)} rows={8} placeholder={"번호 순서대로 한 줄에 한 명씩\n김민준\n이서윤"} />
              <div className="grading-actions">
                <button className="primary-action" onClick={makeRoster}>코드 만들기</button>
                <label className="secondary-action file-button">명부 파일 불러오기<input type="file" accept=".csv" onChange={e => loadRosterFile(e.target.files?.[0])} /></label>
              </div>
              {rosterError && <div className="model-error">{rosterError}</div>}
            </div>
            <div>
              {roster.length > 0 && <>
                <div className="table-scroll small-table"><table><thead><tr><th>번호</th><th>이름</th><th>코드</th><th>결시</th></tr></thead>
                  <tbody>{roster.map(s => <tr key={s.code}><td>{s.number}</td><td>{s.name}</td><td><b>{s.code}</b></td><td><input type="checkbox" checked={s.absent} onChange={() => toggleAbsent(s.code)} /></td></tr>)}</tbody></table></div>
                <div className="grading-actions">
                  <button className="secondary-action" onClick={() => downloadBlob(`﻿${rosterToCsv(roster)}`, "명부_비공개.csv", "text/csv")}>명부 파일 저장</button>
                  <button className="secondary-action" onClick={printCards}>코드 카드 인쇄</button>
                </div>
              </>}
            </div>
          </div>
        </section>

        <section className="grading-card">
          <header><span>02</span><h3>평가 설정</h3><p>정답표(이원분류표) CSV를 불러옵니다. 출판사 정답표는 이 브라우저에서만 읽고 서버에 올리지 않습니다.</p></header>
          <div className="grading-actions">
            <label className="primary-action file-button">정답표 CSV 불러오기<input type="file" accept=".csv" onChange={async e => { const f = e.target.files?.[0]; if (f) applyKey(await f.text(), f.name); }} /></label>
            <button className="secondary-action" onClick={() => applyKey(SAMPLE_KEY_CSV, SAMPLE_KEY_NAME)}>예시 정답표 쓰기</button>
            <button className="secondary-action" onClick={() => downloadBlob(`﻿${SAMPLE_KEY_CSV}`, SAMPLE_KEY_NAME, "text/csv")}>양식 내려받기</button>
          </div>
          {keyError && <pre className="model-error">{keyError}</pre>}
          {items.length > 0 && <>
            <div className="grading-row">
              <label>평가ID<input value={assessmentId} onChange={e => setAssessmentId(e.target.value)} /></label>
              <label>출처<input value={source} onChange={e => setSource(e.target.value)} placeholder="예: 아이스크림" /></label>
              <label>이름 칸 양식<select value={templateId} onChange={e => { setTemplateId(e.target.value); resetPages(); }}>{TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              <label>학생 1명 쪽수<input type="number" min={1} max={10} value={pagesPerStudent} onChange={e => { setPagesPerStudent(Number(e.target.value)); resetPages(); }} /></label>
            </div>
            <p className="helper-line">{keyName} · 문항 {items.length}개 · 성취기준 {[...new Set(items.map(i => i.standard))].join(", ")}</p>
            {items.some(i => i.mappingStatus && i.mappingStatus !== "확인") && <p className="warn-note">성취기준 매핑이 확인되지 않은 문항: {items.filter(i => i.mappingStatus && i.mappingStatus !== "확인").map(i => i.no).join(", ")} (정답표의 매핑상태를 확인으로 바꾸세요)</p>}
          </>}
        </section>

        <section className={`grading-card ${readyForPhotos ? "" : "locked"}`}>
          <header><span>03</span><h3>사진 넣기 · 가림 확인 · 승인</h3><p>스캔 앱으로 찍은 JPG/PNG/PDF를 번호 순서대로, 한 학생의 쪽을 연달아 선택하세요.</p></header>
          <label className="upload-drop">
            <input type="file" multiple accept="image/jpeg,image/png,.pdf,.heic" disabled={!readyForPhotos || processing} onChange={e => handlePhotos(e.target.files)} />
            <b>{processing ? "이름 칸 가리는 중…" : "사진·스캔 PDF 선택"}</b>
            <span>{readyForPhotos ? `응시 ${students.length}명 × ${pagesPerStudent}쪽 = ${students.length * pagesPerStudent}쪽이 필요합니다` : "명부와 정답표를 먼저 준비하세요"}</span>
          </label>
          {pageError && <div className="model-error">{pageError}</div>}
          {pages.length > 0 && <>
            <ol className="helper-line">
              <li>빨간 테두리(이름 칸, 이 브라우저에만 있음)가 왼쪽 학생과 같은지 확인하세요.</li>
              <li>오른쪽 페이지에서 이름 칸이 검게 가려졌는지 확인하세요. 이 페이지만 판독 서버로 갑니다.</li>
            </ol>
            <div className="preview-list">
              {students.map(s => <div className="preview-student" key={s.code}>
                <div className="preview-meta"><b>{s.number}. {s.name}</b><span>{s.code}</span>{identity[s.code] && <img className="identity-crop" src={identity[s.code]} alt={`${s.code} 이름 칸`} />}</div>
                <div className="preview-pages">{(byStudent.get(s.code) ?? []).map(p => <figure key={p.file}><img src={p.url} alt={p.file} /><figcaption>{p.page}쪽{p.warning && <em title={p.warning}> ⚠</em>}</figcaption></figure>)}</div>
              </div>)}
            </div>
            <label className="approve-check"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> 모든 이름 칸이 가려졌고 학생 순서가 맞습니다</label>
            <button className="primary-action" disabled={!checked || !!approved} onClick={approve}>{approved ? "승인됨" : "전송 승인"}</button>
          </>}
        </section>

        <section className={`grading-card ${approved ? "" : "locked"}`}>
          <header><span>04</span><h3>판독</h3><p>{demo ? "데모: 서버로 보내지 않고 가상 판독 결과를 씁니다." : "가린 페이지를 한 장씩 보내 학생이 쓴 답을 그대로 옮겨 적게 합니다. 정답은 보내지 않습니다."}</p></header>
          <button className="run-model" disabled={!approved || (progress != null && progress.done < progress.total) || (!demo && !accessKey)} onClick={runOcr}>
            {progress && progress.done < progress.total ? `판독 중… ${progress.done}/${progress.total}` : `판독 시작 (가린 페이지 ${pages.length}장)`}<b>→</b>
          </button>
          {progress?.errors.length ? <div className="model-error">{progress.errors.slice(0, 5).map(e => <div key={e}>{e}</div>)}</div> : null}
        </section>

        {result && <>
          <section className="grading-card">
            <header><span>05</span><h3>교사 확인</h3><p>판독이 불확실한 답과 서술형은 교사가 확정합니다. AI 제안은 참고용이며 점수로 들어가지 않습니다.</p></header>
            <h4>판독 확인 ({result.readQueue.length}건 중 {result.readQueue.filter(q => !q.reviewed).length}건 남음)</h4>
            {result.readQueue.length === 0 ? <p className="helper-line">확인할 판독이 없습니다.</p> :
              <div className="table-scroll small-table"><table><thead><tr><th>학생</th><th>문항</th><th>판독</th><th>신뢰도</th><th>맞음</th><th>수정</th></tr></thead><tbody>
                {result.readQueue.map(q => { const k = reviewKey(q.code, q.no); return <tr key={k} className={q.reviewed ? "reviewed-row" : ""}><td>{q.code}</td><td>{q.no}</td><td>{q.answer}</td><td>{q.confidence}</td>
                  <td><input type="checkbox" checked={!!readReview[k]?.confirmed} onChange={e => setReadReview(r => ({ ...r, [k]: { ...r[k], confirmed: e.target.checked } }))} /></td>
                  <td><input className="cell-input" value={readReview[k]?.fixed ?? ""} onChange={e => setReadReview(r => ({ ...r, [k]: { ...r[k], fixed: e.target.value } }))} /></td></tr>; })}
              </tbody></table></div>}
            <h4>서술형 ({result.essayQueue.length}건)</h4>
            {result.essayQueue.length > 0 && <div className="table-scroll small-table"><table><thead><tr><th>학생</th><th>문항</th><th>학생 답</th><th>AI 제안</th><th>확정점수</th></tr></thead><tbody>
              {result.essayQueue.map(q => { const k = reviewKey(q.code, q.no); const r = essayReview[k] ?? {}; return <tr key={k}><td>{q.code}</td><td>{q.no}<small> /{q.item.points}</small></td>
                <td className="essay-cell" title={q.item.rubric}>{q.answer}</td>
                <td>{r.aiScore != null ? <span className={r.aiUnstable ? "warn-note" : ""}>{r.aiScore}점{r.aiUnstable ? " (두 번 채점 불일치)" : ""}<small>{r.aiEvidence ? ` “${r.aiEvidence}”` : ""}</small></span>
                  : <button className="secondary-action" disabled={essayBusy === k || (!demo && !accessKey)} onClick={() => suggestEssay(q.code, q.item, q.answer)}>{essayBusy === k ? "…" : "AI 제안"}</button>}</td>
                <td><input className="cell-input" type="number" min={0} max={q.item.points} value={r.final ?? ""} onChange={e => setEssayReview(v => ({ ...v, [k]: { ...v[k], final: e.target.value === "" ? null : Number(e.target.value) } }))} /></td></tr>; })}
            </tbody></table></div>}
          </section>

          <section className="grading-card">
            <header><span>06</span><h3>결과</h3><p>결과에는 학생 코드만 들어갑니다. 이름으로 되돌릴 때는 보관한 명부 파일을 씁니다.</p></header>
            <div className="kpi-grid">
              <div className="kpi"><span>응시</span><strong>{Object.keys(readings).length}명</strong></div>
              <div className="kpi"><span>채점 행</span><strong>{result.rows.length}</strong></div>
              <div className="kpi"><span>교사 확인 대기</span><strong>{pending}</strong><small className={pending ? "negative" : ""}>{pending ? "확정 전 문항은 정답률을 계산하지 않습니다" : "모두 확정됨"}</small></div>
              <div className="kpi"><span>이름 가림</span><strong>{result.rows.filter(r => r.표시.includes("이름가림")).length}건</strong><small>판독 결과에 나온 학생 이름</small></div>
            </div>
            <div className="grading-actions">
              <button className="primary-action" onClick={openAnalysis}>평가 분석 열기</button>
              <button className="secondary-action" onClick={() => downloadBlob(`﻿${resultCsv()}`, `${assessmentId || "평가"}_응답_long.csv`, "text/csv")}>응답_long.csv 내려받기</button>
            </div>
          </section>
        </>}
      </div>
    </main>
  );
}

