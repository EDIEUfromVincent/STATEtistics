"use client";
/* eslint-disable @next/next/no-img-element -- 미리보기는 브라우저 메모리의 blob URL이라 next/image를 쓸 수 없다 */

import Link from "next/link";
import { TEMPLATES } from "../../lib/assessment/images";
import { useGrading } from "../GradingContext";

export default function PhotosStep() {
  const g = useGrading();
  const ready = g.students.length > 0 && g.items.length > 0;

  return (
    <section className="grading-card">
      <header><span>3</span><h3>사진 넣기 · 가림 확인 · 승인</h3><p>스캔 앱으로 찍은 JPG/PNG/PDF를 번호 순서대로, 한 학생의 쪽을 연달아 선택하세요. 이름 칸은 이 브라우저에서 검게 가리고 촬영 정보(EXIF)는 지웁니다.</p></header>
      {!ready && <p className="warn-note">먼저 <Link href="/grading">명부</Link>와 <Link href="/grading/key">정답표</Link>를 준비하세요.</p>}
      <div className="grading-row">
        <label>이름 칸 양식<select value={g.templateId} onChange={e => g.setTemplateId(e.target.value)}>{TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>학생 1명 쪽수<input type="number" min={1} max={8} value={g.pagesPerStudent} onChange={e => g.setPagesPerStudent(Number(e.target.value))} /></label>
      </div>
      <label className="upload-drop">
        <input type="file" multiple accept="image/jpeg,image/png,.pdf,.heic" disabled={!ready || g.processing} onChange={e => { g.handlePhotos(e.target.files); e.target.value = ""; }} />
        <b>{g.processing ? "이름 칸 가리는 중…" : "사진·스캔 PDF 선택"}</b>
        <span>{ready ? `응시 ${g.students.length}명 × ${g.pagesPerStudent}쪽 = ${g.students.length * g.pagesPerStudent}쪽이 필요합니다` : "명부와 정답표를 먼저 준비하세요"}</span>
      </label>
      {g.pageError && <div className="model-error">{g.pageError}</div>}
      {g.pages.length > 0 && <>
        <ol className="helper-line">
          <li>빨간 테두리(이름 칸, 이 브라우저에만 있음)가 왼쪽 학생과 같은지 확인하세요.</li>
          <li>오른쪽 페이지에서 이름 칸이 검게 가려졌는지 확인하세요. 이 페이지만 판독 서버로 갑니다.</li>
        </ol>
        <div className="preview-list">
          {g.students.map(s => <div className="preview-student" key={s.code}>
            <div className="preview-meta"><b>{s.number}. {s.name}</b><span>{s.code}</span>{g.identity[s.code] && <img className="identity-crop" src={g.identity[s.code]} alt={`${s.code} 이름 칸`} />}</div>
            <div className="preview-pages">{(g.pagesByCode.get(s.code) ?? []).map(p => <figure key={p.file}><img src={p.url} alt={p.file} /><figcaption>{p.page}쪽{p.warning && <em title={p.warning}> ⚠</em>}</figcaption></figure>)}</div>
          </div>)}
        </div>
        <label className="approve-check"><input type="checkbox" checked={g.checked} onChange={e => g.setChecked(e.target.checked)} /> 모든 이름 칸이 가려졌고 학생 순서가 맞습니다</label>
        <div className="grading-actions">
          <button className="primary-action" disabled={!g.checked || g.approved} onClick={g.approve}>{g.approved ? "승인됨" : "전송 승인"}</button>
          {g.approved && <Link className="primary-action" href="/grading/ocr">다음: 판독 →</Link>}
        </div>
      </>}
    </section>
  );
}
