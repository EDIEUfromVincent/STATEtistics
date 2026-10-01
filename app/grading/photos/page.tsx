"use client";
/* eslint-disable @next/next/no-img-element -- 미리보기는 브라우저 메모리의 blob URL이라 next/image를 쓸 수 없다 */

import Link from "next/link";
import { LAYOUTS, TEMPLATES } from "../../lib/assessment/images";
import { studentLabel } from "../../lib/assessment/privacy";
import { DropZone } from "../DropZone";
import { useGrading } from "../GradingContext";

export default function PhotosStep() {
  const g = useGrading();
  const ready = g.students.length > 0 && g.items.length > 0;

  return (
    <section className="grading-card">
      <header><span>3</span><h3>학생 답안 넣기 · 가림 확인 · 승인</h3><p>스캔 앱으로 찍은 JPG/PNG/PDF를 번호 순서대로, 한 학생의 쪽을 연달아 선택하세요. 이름 칸은 이 브라우저에서 검게 가리고 촬영 정보(EXIF)는 지웁니다.</p></header>
      {!ready && <p className="warn-note">먼저 <Link href="/grading">학생 번호</Link>와 <Link href="/grading/key">시험지</Link>를 준비하세요.</p>}
      <div className="grading-row">
        <label>스캔 방식<select value={g.layoutId} onChange={e => g.setLayoutId(e.target.value)}>{LAYOUTS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>이름 칸 양식<select value={g.templateId} onChange={e => g.setTemplateId(e.target.value)}>{TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>학생 1명 쪽수<input type="number" min={1} max={8} value={g.pagesPerStudent} onChange={e => g.setPagesPerStudent(Number(e.target.value))} /></label>
      </div>
      <DropZone accept="image/jpeg,image/png,.pdf,.heic" multiple disabled={!ready || g.processing} onFiles={files => g.handlePhotos(files)}
        title={g.processing ? `이름 칸 가리는 중… ${g.processed ? `${g.processed.done}/${g.processed.total}쪽` : ""}` : ready ? "학생 답안 스캔 PDF(또는 사진)를 여기에 끌어다 놓거나 눌러서 고르세요" : "학생 번호와 시험지를 먼저 준비하세요"}>
        {ready ? `응시 ${g.students.length}명 × ${g.pagesPerStudent}쪽 = ${g.students.length * g.pagesPerStudent}쪽이 필요합니다 · 이름 칸은 이 브라우저에서 검게 가립니다` : ""}
      </DropZone>
      {g.pageError && <div className="model-error">{g.pageError}</div>}
      {g.groups.some(x => x.auto) && (() => {
        const pending = g.groups.filter(x => x.code.startsWith("미정")).length;
        const flagged = g.groups.filter(x => x.problem && !x.code.startsWith("미정")).length;
        const absent = g.roster.filter(s => s.absent).map(s => s.number);
        return <div className="match-box">
          <h4>학생 맞추기 · 스캔 {g.groups.length}명분</h4>
          <p className={pending ? "warn-note" : "ok-note"}>
            {pending ? `학생을 정하지 못한 묶음 ${pending}개가 있습니다. 반·번호 조각을 보고 학생을 골라 주세요.` : "모든 묶음을 학생에게 맞췄습니다."}
            {flagged ? ` 확인할 점이 있는 묶음 ${flagged}개도 한 번 보세요.` : ""}
            {absent.length ? ` 스캔이 없어 결시로 둔 번호: ${absent.join(", ")}` : ""}
          </p>
          <p className="helper-line">스캔 순서와 상관없이, 각 학생 1쪽 머리글의 반·번호 숫자를 읽어 맞췄습니다(이름 칸은 잘라 내고 보냄).</p>
          <div className="table-scroll small-table"><table><thead><tr><th>묶음</th><th>반·번호 조각</th><th>읽은 번호</th><th>학생</th><th>확인할 점</th></tr></thead><tbody>
            {g.groups.map(x => <tr key={x.group} className={x.code.startsWith("미정") || x.problem.includes("애매") ? "warn-row" : ""}>
              <td>{x.group + 1}</td>
              <td>{x.crop ? <img className="number-crop" src={x.crop} alt={`묶음 ${x.group + 1} 반·번호`} /> : <small>없음</small>}</td>
              <td>{x.read ?? "–"}</td>
              <td><select value={x.code} onChange={e => g.assignGroup(x.group, e.target.value)}>
                {x.code.startsWith("미정") && <option value={x.code}>고르세요</option>}
                {g.roster.map(s => <option key={s.code} value={s.code}>{studentLabel(s)}</option>)}
              </select></td>
              <td><small>{x.problem}</small></td>
            </tr>)}
          </tbody></table></div>
        </div>;
      })()}
      {g.pages.length > 0 && <>
        <ol className="helper-line">
          <li>{Object.keys(g.identity).length ? "왼쪽 \"반·번호\" 조각(이름은 잘라 냄)의 번호가 학생 번호와 같은지 확인하세요." : "빈 시험지 PDF를 정답표 단계에서 넣으면, 순서 확인용으로 각 학생의 \"반·번호\" 부분만 잘라 보여 줍니다."}</li>
          <li>오른쪽 페이지에서 이름 칸이 검게 가려졌는지 확인하세요. 이 페이지만 판독 서버로 갑니다.</li>
        </ol>
        <div className="preview-list">
          {g.students.map(s => <div className="preview-student" key={s.code}>
            <div className="preview-meta"><b>{studentLabel(s)}</b>{g.identity[s.code] && <img className="identity-crop" src={g.identity[s.code]} alt={`${studentLabel(s)} 반·번호 칸`} />}</div>
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
