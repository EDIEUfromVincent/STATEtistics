"use client";
/* eslint-disable @next/next/no-img-element -- 시험지는 브라우저 메모리의 blob URL이라 next/image를 쓸 수 없다 */

// 교사 확인·서술형 채점에서 고르는 칸이 학생의 원래 시험지(가린 쪽) 어디인지 바로 보여 준다.
// 칸이 있는 쪽을 크게 띄우고, 칸에 테두리를 치고, 그 위치로 스크롤한다.

import { useEffect, useRef, useState } from "react";
import type { ProcessedPage } from "../lib/assessment/images";

type Where = { page: number; box: [number, number, number, number] };

export function PageFocus({ pages, where, label, onClose }: { pages: ProcessedPage[]; where?: Where; label: string; onClose: () => void }) {
  const [page, setPage] = useState(where?.page ?? pages[0]?.page ?? 1);
  const [big, setBig] = useState(false);
  const mark = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(where);
  if (where !== shown) {
    // 다른 칸을 고르면 그 칸이 있는 쪽으로 넘어간다
    setShown(where);
    if (where) setPage(where.page);
  }
  const current = pages.find(p => p.page === page) ?? pages[0];
  const box = where && where.page === current?.page ? where.box : null;

  useEffect(() => {
    mark.current?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [box, big, current?.file]);

  if (!current) return <div className="page-viewer"><header><b>{label}</b><button className="link-button" onClick={onClose}>닫기</button></header><p className="helper-line">시험지 사진이 없습니다.</p></div>;
  const pad = 0.012;
  return (
    <div className="page-viewer page-focus">
      <header>
        <b>{label}</b>
        <span className="page-tabs">
          {pages.map(p => <button key={p.file} className={`chip ${p.page === current.page ? "on" : ""}`} onClick={() => setPage(p.page)}>{p.page}쪽{where?.page === p.page ? " ●" : ""}</button>)}
          <button className={`chip ${big ? "on" : ""}`} onClick={() => setBig(b => !b)}>{big ? "쪽 맞춤" : "크게 보기"}</button>
          <button className="link-button" onClick={onClose}>닫기</button>
        </span>
      </header>
      <figure className={big ? "focus-figure big" : "focus-figure"}>
        <img src={current.url} alt={`${label} ${current.page}쪽`} />
        {box && <div ref={mark} className="focus-mark" style={{
          left: `${(box[0] - pad) * 100}%`, top: `${(box[1] - pad) * 100}%`,
          width: `${(box[2] - box[0] + 2 * pad) * 100}%`, height: `${(box[3] - box[1] + 2 * pad) * 100}%`,
        }} />}
      </figure>
      <figcaption>{current.page}쪽 · 이름 칸은 가린 사진입니다{box ? " · 빨간 테두리가 이 칸" : where ? ` · 이 칸은 ${where.page}쪽에 있습니다` : ""}</figcaption>
    </div>
  );
}
