"use client";

import { useMemo, useState } from "react";

const schoolLevels = ["초등", "중학", "고등", "특수"];
const subjects = ["국어", "수학", "과학", "사회", "영어", "실과", "음악", "미술", "체육"];
const domains: Record<string, string[]> = {
  국어: ["듣기·말하기", "읽기", "쓰기", "문법", "문학", "매체"],
  수학: ["수와연산", "도형", "측정", "규칙성", "자료와가능성"],
  과학: ["운동과에너지", "물질", "생명", "지구와우주", "과학과사회"],
  사회: ["지리", "일반사회", "역사", "문화", "지속가능성"],
  영어: ["듣기", "말하기", "읽기", "쓰기", "어휘"],
  실과: ["인간발달", "가정생활", "기술활용", "진로", "안전"],
  음악: ["표현", "감상", "생활화", "창작", "이해"],
  미술: ["체험", "표현", "감상", "시각문화", "조형"],
  체육: ["건강", "도전", "경쟁", "표현", "안전"],
};

const colors = ["#3157d5", "#6c85ea", "#24a3a6", "#f0a44a", "#e36e62"];

function seeded(seed: number, salt: number) {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function LineChart({ seed, labels }: { seed: number; labels: string[] }) {
  const series = labels.slice(0, 5).map((_, s) =>
    Array.from({ length: 5 }, (__, i) => 30 + seeded(seed + s * 7, i) * 50),
  );
  const points = (vals: number[]) =>
    vals.map((v, i) => `${32 + i * 86},${150 - v * 1.2}`).join(" ");
  return (
    <svg className="viz" viewBox="0 0 400 180" role="img" aria-label="회차별 평균 점수 추이">
      {[0, 1, 2, 3].map((i) => <line key={i} x1="30" x2="385" y1={26 + i * 38} y2={26 + i * 38} className="gridline" />)}
      {series.map((vals, i) => <polyline key={i} points={points(vals)} fill="none" stroke={colors[i]} strokeWidth="2.4" />)}
      {series.map((vals, s) => vals.map((v, i) => <circle key={`${s}-${i}`} cx={32 + i * 86} cy={150 - v * 1.2} r="3" fill={colors[s]} />))}
      {[1, 2, 3, 4, 5].map((v, i) => <text key={v} x={32 + i * 86} y="174" className="axis">{v}회</text>)}
    </svg>
  );
}

function BoxChart({ seed, labels }: { seed: number; labels: string[] }) {
  return (
    <svg className="viz" viewBox="0 0 400 180" role="img" aria-label="성취영역별 점수 분포">
      {[0, 1, 2, 3].map((i) => <line key={i} x1="30" x2="390" y1={25 + i * 37} y2={25 + i * 37} className="gridline" />)}
      {labels.slice(0, 5).map((label, i) => {
        const mid = 55 + seeded(seed, i) * 48;
        const x = 48 + i * 72;
        return <g key={label}><line x1={x} x2={x} y1={145 - mid} y2={110 - mid} stroke="#3157d5" /><rect x={x - 18} y={118 - mid} width="36" height="24" rx="3" fill="#dfe6ff" stroke="#3157d5" /><line x1={x - 18} x2={x + 18} y1={130 - mid} y2={130 - mid} stroke="#3157d5" /><text x={x} y="171" className="axis">{label.slice(0, 5)}</text></g>;
      })}
    </svg>
  );
}

function Heatmap({ seed }: { seed: number }) {
  return (
    <div className="heatmap" role="img" aria-label="요일별 주차별 평균 접속시간">
      {Array.from({ length: 40 }, (_, i) => <span key={i} style={{ background: `rgba(49,87,213,${0.12 + seeded(seed, i) * 0.82})` }} title={`${Math.round(5 + seeded(seed, i) * 48)}분`} />)}
    </div>
  );
}

function Bars({ seed, horizontal = false }: { seed: number; horizontal?: boolean }) {
  const vals = Array.from({ length: horizontal ? 6 : 12 }, (_, i) => 25 + seeded(seed, i) * 70);
  if (horizontal) return <div className="hbars">{vals.map((v, i) => <div key={i}><b>{["개념질문", "문제풀이", "초안작성", "피드백", "자료탐색", "번역"][i]}</b><span><i style={{ width: `${v}%` }} /></span><em>{Math.round(v)}</em></div>)}</div>;
  return <div className="bars" role="img" aria-label="분포 막대 차트">{vals.map((v, i) => <i key={i} style={{ height: `${v}%`, background: colors[i % colors.length] }} />)}</div>;
}

function Donut({ seed }: { seed: number }) {
  const values = [25, 18, 20, 14, 13, 10].map((v, i) => v + Math.round(seeded(seed, i) * 7));
  const total = values.reduce((a, b) => a + b, 0);
  let acc = 0;
  const stops = values.map((v, i) => { const a = acc; acc += (v / total) * 100; return `${colors[i % colors.length]} ${a}% ${acc}%`; });
  return <div className="donut-wrap"><div className="donut" style={{ background: `conic-gradient(${stops.join(",")})` }}><span>{total}<small>오류</small></span></div><div className="legend compact">{["계산 실수", "개념 오해", "문제 해석", "단위 오류", "과정 누락", "기타"].map((v, i) => <span key={v}><i style={{ background: colors[i % colors.length] }} />{v}</span>)}</div></div>;
}

function Radar({ seed }: { seed: number }) {
  const polygon = (offset: number) => Array.from({ length: 8 }, (_, i) => {
    const angle = -Math.PI / 2 + i * Math.PI / 4;
    const r = 32 + seeded(seed + offset, i) * 30;
    return `${100 + Math.cos(angle) * r},${90 + Math.sin(angle) * r}`;
  }).join(" ");
  return <svg className="radar" viewBox="0 0 200 180" role="img" aria-label="정의적 영역 사전 사후 레이더 차트">
    {[25, 45, 65].map(r => <polygon key={r} points={Array.from({ length: 8 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 4; return `${100 + Math.cos(a) * r},${90 + Math.sin(a) * r}`; }).join(" ")} fill="none" className="gridpoly" />)}
    <polygon points={polygon(0)} fill="rgba(49,87,213,.12)" stroke="#3157d5" strokeWidth="2" />
    <polygon points={polygon(19)} fill="rgba(36,163,166,.12)" stroke="#24a3a6" strokeWidth="2" />
  </svg>;
}

export default function Home() {
  const [school, setSchool] = useState("초등");
  const [subject, setSubject] = useState("수학");
  const [students, setStudents] = useState(26);
  const [weeks, setWeeks] = useState(8);
  const [tests, setTests] = useState(3);
  const [seed, setSeed] = useState(2026);
  const effectiveSeed = seed + schoolLevels.indexOf(school) * 100 + subjects.indexOf(subject) * 10 + students + weeks + tests;
  const data = useMemo(() => {
    const score = 69 + seeded(effectiveSeed, 1) * 12;
    return {
      score: score.toFixed(1),
      diff: ((seeded(effectiveSeed, 2) - .54) * 5).toFixed(1),
      high: Math.round(48 + seeded(effectiveSeed, 3) * 24),
      time: Math.round(155 + seeded(effectiveSeed, 4) * 75),
      ai: (2.7 + seeded(effectiveSeed, 5) * 1.1).toFixed(1),
    };
  }, [effectiveSeed]);
  const domainList = domains[subject];

  return (
    <main>
      <header className="topbar">
        <div className="brand">서울대학교 미래교육혁신센터</div>
        <div className="heading"><h1>교실 학습데이터 대시보드 <span>(예시)</span></h1><p>학교급·과목을 선택하면 8종 학습데이터를 바탕으로 구성한 데모 대시보드를 확인할 수 있습니다.</p></div>
        <nav><a href="/">데이터 생성기</a><a className="active" href="/dashboard">대시보드</a></nav>
      </header>

      <div className="page-shell">
        <aside className="filters">
          <div className="eyebrow">학습 맥락</div>
          <FilterButtons label="학교급" values={schoolLevels} value={school} onChange={setSchool} />
          <FilterButtons label="과목" values={subjects} value={subject} onChange={setSubject} />
          <div className="eyebrow section-gap">표본 설정</div>
          <RangeControl label="학생 수" value={students} min={12} max={40} onChange={setStudents} />
          <RangeControl label="운영 주차" value={weeks} min={4} max={16} onChange={setWeeks} />
          <RangeControl label="평가 회차" value={tests} min={2} max={5} onChange={setTests} />
          <label className="seed-label">난수 시드<input type="number" value={seed} onChange={e => setSeed(Number(e.target.value) || 0)} /></label>
          <p className="helper">같은 시드는 같은 데이터를 생성합니다. 실제 학생 정보가 아닌 합성 데이터입니다. 생성 CSV가 필요하면 상단 “데이터 생성기”로 이동하세요.</p>
        </aside>

        <section className="dashboard">
          <div className="context"><strong>{subject}</strong><span>·</span><span>분류 일반 교과</span><span>·</span><span>성취영역</span>{domainList.map(d => <b key={d}>{d}</b>)}</div>
          <div className="kpi-grid">
            <Kpi title="평균 점수 (최근 회차)" value={`${data.score}점`} note={`${Number(data.diff) >= 0 ? "▲" : "▼"} ${Math.abs(Number(data.diff))}점 (1회차 대비)`} negative={Number(data.diff) < 0} />
            <Kpi title="A·B 성취수준 비율" value={`${data.high}%`} note="상위 성취 학생 비중" />
            <Kpi title="주당 평균 학습시간" value={`${data.time}분`} note="분 단위" />
            <Kpi title="AI 도구 활용도" value={`${data.ai} / 5`} note="1~5 척도" />
          </div>
          <div className="chart-grid">
            <Chart title="성취영역별 점수 분포" subtitle="최근 회차 기준 · 영역별 사분위 분포" legend={domainList.slice(0,5)}><BoxChart seed={effectiveSeed} labels={domainList} /></Chart>
            <Chart title="회차별 평균 점수 추이" subtitle="성취영역별 회차 평균 라인" legend={domainList.slice(0,5)}><LineChart seed={effectiveSeed} labels={domainList} /></Chart>
            <Chart title="LMS 학습 행동 히트맵" subtitle="요일 × 주차별 평균 접속시간 (분)"><Heatmap seed={effectiveSeed} /></Chart>
            <Chart title="영상 완주율 분포" subtitle="학생 단위 평균 완주율 (%)"><Bars seed={effectiveSeed} /></Chart>
            <Chart title="AI 도구별 활용 횟수" subtitle="도구 × 활용목적 누적 빈도"><Bars seed={effectiveSeed + 4} horizontal /></Chart>
            <Chart title="형성평가 오류유형" subtitle="오답 원인별 비율"><Donut seed={effectiveSeed} /></Chart>
            <Chart title="정의적 영역 사전 · 사후" subtitle="학급 평균 8개 축 변화 (학업스트레스는 낮을수록 양호)"><Radar seed={effectiveSeed} /></Chart>
            <Chart title="포트폴리오 루브릭 평균" subtitle="5축 평균 (만점 20)" legend={["창의성", "논리성", "성찰", "협업", "완성도"]}><BoxChart seed={effectiveSeed + 12} labels={["창의성", "논리성", "성찰", "협업", "완성도"]} /></Chart>
          </div>
        </section>
      </div>
    </main>
  );
}

function FilterButtons({ label, values, value, onChange }: { label: string; values: string[]; value: string; onChange: (v: string) => void }) {
  return <div className="filter-block"><label>{label}</label><div className="chips">{values.map(v => <button key={v} className={v === value ? "selected" : ""} onClick={() => onChange(v)}>{v}</button>)}</div></div>;
}

function RangeControl({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return <label className="range-label"><span>{label}<b>{value}</b></span><input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} /></label>;
}

function Kpi({ title, value, note, negative }: { title: string; value: string; note: string; negative?: boolean }) {
  return <article className="kpi"><span>{title}</span><strong>{value}</strong><small className={negative ? "negative" : ""}>{note}</small></article>;
}

function Chart({ title, subtitle, legend, children }: { title: string; subtitle: string; legend?: string[]; children: React.ReactNode }) {
  return <article className="chart-card"><header><div><h3>{title}</h3><p>{subtitle}</p></div>{legend && <div className="legend">{legend.map((v, i) => <span key={v}><i style={{ background: colors[i] }} />{v}</span>)}</div>}</header><div className="chart">{children}</div></article>;
}
