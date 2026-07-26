export type GeneratorOptions = {
  school: string;
  subject: string;
  grade: number;
  classNo: number;
  unit: number;
  students: number;
  weeks: number;
  tests: number;
  seed: number;
};

export type DatasetId =
  | "achievement"
  | "lms"
  | "formative"
  | "ai"
  | "affective"
  | "portfolio"
  | "observation"
  | "collaboration";

export type GeneratedDataset = {
  id: DatasetId;
  label: string;
  description: string;
  filename: string;
  columns: string[];
  rows: Array<Array<string | number>>;
};

export const datasetCatalog: Array<{ id: DatasetId; label: string; description: string }> = [
  { id: "achievement", label: "성취도평가", description: "회차별 영역점수·총점·성취수준·오답유형" },
  { id: "lms", label: "LMS 학습로그", description: "주차별 접속·영상시청·자료열람·질문 행동" },
  { id: "formative", label: "형성평가(문항단위)", description: "차시별 문항 정오답·풀이시간·재시도·성취기준" },
  { id: "ai", label: "AI 도구 활용로그", description: "도구·활용목적·프롬프트유형·수용률·검토 여부" },
  { id: "affective", label: "정의적 영역 설문", description: "사전·사후 학습동기·자기효능감·AI수용도" },
  { id: "portfolio", label: "포트폴리오/프로젝트", description: "루브릭·동료평가·프로젝트 산출물" },
  { id: "observation", label: "관찰기록", description: "주차별 참여도·이해도·정성 메모" },
  { id: "collaboration", label: "협업활동", description: "모둠·역할·기여도·상호작용" },
];

const firstNames = ["서윤", "도윤", "하린", "민준", "시우", "지우", "유진", "은호", "예린", "선우", "하율", "주원", "윤서", "지민", "현우", "다은", "수빈", "준서", "아인", "태윤"];
const lastNames = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권"];
const areas: Record<string, string[]> = {
  국어: ["듣기말하기", "읽기", "쓰기", "문법", "문학"],
  수학: ["수와연산", "도형", "측정", "규칙성", "자료와가능성"],
  과학: ["운동에너지", "물질", "생명", "지구우주", "과학사회"],
  사회: ["지리", "일반사회", "역사", "문화", "지속가능성"],
  영어: ["듣기", "말하기", "읽기", "쓰기", "어휘"],
  실과: ["인간발달", "가정생활", "기술활용", "진로", "안전"],
  음악: ["표현", "감상", "생활화", "창작", "이해"],
  미술: ["체험", "표현", "감상", "시각문화", "조형"],
  체육: ["건강", "도전", "경쟁", "표현", "안전"],
};

function createRandom(seed: number) {
  let state = Math.abs(Math.trunc(seed)) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pick<T>(items: T[], random: () => number) {
  return items[Math.floor(random() * items.length)];
}

function between(min: number, max: number, random: () => number) {
  return Math.round(min + random() * (max - min));
}

function decimal(min: number, max: number, random: () => number, digits = 1) {
  return Number((min + random() * (max - min)).toFixed(digits));
}

function dateFor(week: number, offset = 0) {
  const date = new Date(Date.UTC(2026, 2, 2 + week * 7 + offset));
  return date.toISOString().slice(0, 10);
}

function studentId(options: GeneratorOptions, index: number) {
  return `S${options.grade}${String(options.classNo).padStart(2, "0")}${String(index + 1).padStart(2, "0")}`;
}

function studentName(index: number, random: () => number) {
  return `${lastNames[index % lastNames.length]}${pick(firstNames, random)}`;
}

function performance(score: number) {
  if (score >= 88) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  return "D";
}

function common(options: GeneratorOptions, index: number, random: () => number) {
  return [
    studentId(options, index),
    studentName(index, random),
    random() > 0.5 ? "여" : "남",
    options.school,
    options.grade,
    options.classNo,
    options.subject,
  ];
}

function achievement(options: GeneratorOptions, random: () => number): GeneratedDataset {
  const subjectAreas = areas[options.subject] ?? areas.국어;
  const columns = ["학생ID", "학생명", "성별", "학교급", "학년", "반", "과목", "회차", "평가일", ...subjectAreas.map(v => `${v}점수`), "총점", "평균", "수업참여도", "과제제출률", "주당학습시간(분)", "AI도구활용도", "자기주도학습지수", "오답유형태그", "성취수준"];
  const rows: GeneratedDataset["rows"] = [];
  for (let test = 1; test <= options.tests; test++) {
    for (let i = 0; i < options.students; i++) {
      const ability = between(48, 93, random) + test * between(0, 3, random);
      const scores = subjectAreas.map(() => Math.max(20, Math.min(100, ability + between(-13, 13, random))));
      const total = scores.reduce((a, b) => a + b, 0);
      const average = Number((total / scores.length).toFixed(1));
      const weak = `${subjectAreas[scores.indexOf(Math.min(...scores))]}취약`;
      const extra = random() > 0.68 ? `;${pick(["개념이해부족", "계산실수", "문제해석오류"], random)}` : "";
      rows.push([...common(options, i, random), test, dateFor(test * 3), ...scores, total, average, decimal(1, 5, random), between(55, 100, random), between(45, 330, random), decimal(1, 5, random), between(8, 94, random), weak + extra, performance(average)]);
    }
  }
  return { id: "achievement", label: "성취도평가", description: datasetCatalog[0].description, filename: "achievement_assessment.csv", columns, rows };
}

function lms(options: GeneratorOptions, random: () => number): GeneratedDataset {
  const columns = ["학생ID", "학교급", "학년", "반", "과목", "주차", "기준일", "접속횟수", "학습시간(분)", "영상완주율", "자료열람수", "질문수", "토론글수", "야간접속수"];
  const rows: GeneratedDataset["rows"] = [];
  for (let week = 1; week <= options.weeks; week++) for (let i = 0; i < options.students; i++) rows.push([studentId(options, i), options.school, options.grade, options.classNo, options.subject, week, dateFor(week), between(2, 18, random), between(25, 280, random), between(32, 100, random), between(0, 18, random), between(0, 6, random), between(0, 5, random), between(0, 4, random)]);
  return { id: "lms", label: "LMS 학습로그", description: datasetCatalog[1].description, filename: "lms_learning_log.csv", columns, rows };
}

function formative(options: GeneratorOptions, random: () => number): GeneratedDataset {
  const columns = ["학생ID", "학교급", "학년", "반", "과목", "단원", "평가회차", "문항번호", "성취영역", "정답여부", "풀이시간(초)", "재시도수", "자신감", "오답유형"];
  const rows: GeneratedDataset["rows"] = [];
  const subjectAreas = areas[options.subject] ?? areas.국어;
  for (let test = 1; test <= options.tests; test++) for (let i = 0; i < options.students; i++) for (let q = 1; q <= 5; q++) {
    const correct = random() > 0.28;
    rows.push([studentId(options, i), options.school, options.grade, options.classNo, options.subject, options.unit, test, q, subjectAreas[(q - 1) % subjectAreas.length], correct ? 1 : 0, between(18, 190, random), correct ? between(0, 1, random) : between(1, 3, random), decimal(1, 5, random), correct ? "" : pick(["개념 오해", "문제 해석", "계산 실수", "과정 누락"], random)]);
  }
  return { id: "formative", label: "형성평가(문항단위)", description: datasetCatalog[2].description, filename: "formative_item_log.csv", columns, rows };
}

function aiLog(options: GeneratorOptions, random: () => number): GeneratedDataset {
  const columns = ["학생ID", "학교급", "학년", "반", "과목", "주차", "도구", "활용목적", "프롬프트유형", "활용횟수", "결과수용률", "교사검토", "자기평가"];
  const rows: GeneratedDataset["rows"] = [];
  for (let week = 1; week <= options.weeks; week++) for (let i = 0; i < options.students; i++) if (random() > 0.32) rows.push([studentId(options, i), options.school, options.grade, options.classNo, options.subject, week, pick(["대화형 AI", "번역 AI", "이미지 AI", "코딩 AI"], random), pick(["개념질문", "문제풀이", "초안작성", "피드백", "자료탐색"], random), pick(["질문형", "역할부여형", "단계형", "예시제공형"], random), between(1, 12, random), between(20, 100, random), random() > 0.56 ? "Y" : "N", decimal(1, 5, random)]);
  return { id: "ai", label: "AI 도구 활용로그", description: datasetCatalog[3].description, filename: "ai_tool_usage.csv", columns, rows };
}

function affective(options: GeneratorOptions, random: () => number): GeneratedDataset {
  const columns = ["학생ID", "학교급", "학년", "반", "과목", "시점", "학습동기", "자기효능감", "성장마인드셋", "협업선호", "AI수용도", "학업스트레스", "수업만족도", "자기조절"];
  const rows: GeneratedDataset["rows"] = [];
  for (let i = 0; i < options.students; i++) for (const phase of ["사전", "사후"]) rows.push([studentId(options, i), options.school, options.grade, options.classNo, options.subject, phase, decimal(1.5, 5, random), decimal(1.4, 5, random), decimal(1.8, 5, random), decimal(1.2, 5, random), decimal(1, 5, random), decimal(1, 5, random), decimal(1.8, 5, random), decimal(1.5, 5, random)]);
  return { id: "affective", label: "정의적 영역 설문", description: datasetCatalog[4].description, filename: "affective_survey.csv", columns, rows };
}

function portfolio(options: GeneratorOptions, random: () => number): GeneratedDataset {
  const columns = ["학생ID", "학교급", "학년", "반", "과목", "단원", "프로젝트명", "창의성", "논리성", "성찰", "협업", "완성도", "동료평가", "교사평가", "제출일"];
  const rows = Array.from({ length: options.students }, (_, i) => [studentId(options, i), options.school, options.grade, options.classNo, options.subject, options.unit, `${options.subject} 탐구 프로젝트`, between(8, 20, random), between(8, 20, random), between(8, 20, random), between(8, 20, random), between(8, 20, random), decimal(2, 5, random), decimal(2, 5, random), dateFor(options.weeks)]);
  return { id: "portfolio", label: "포트폴리오/프로젝트", description: datasetCatalog[5].description, filename: "portfolio_rubric.csv", columns, rows };
}

function observation(options: GeneratorOptions, random: () => number): GeneratedDataset {
  const columns = ["학생ID", "학교급", "학년", "반", "과목", "주차", "수업태도", "이해정도", "질문빈도", "협력태도", "지원필요도", "관찰메모"];
  const notes = ["과제 수행이 안정적임", "질문을 통해 개념을 확장함", "모둠 활동에 적극적임", "추가 설명 후 이해도가 향상됨", "학습 계획 점검이 필요함"];
  const rows: GeneratedDataset["rows"] = [];
  for (let week = 1; week <= options.weeks; week++) for (let i = 0; i < options.students; i++) rows.push([studentId(options, i), options.school, options.grade, options.classNo, options.subject, week, decimal(1, 5, random), decimal(1, 5, random), between(0, 6, random), decimal(1, 5, random), decimal(1, 5, random), pick(notes, random)]);
  return { id: "observation", label: "관찰기록", description: datasetCatalog[6].description, filename: "observation_notes.csv", columns, rows };
}

function collaboration(options: GeneratorOptions, random: () => number): GeneratedDataset {
  const columns = ["학생ID", "학교급", "학년", "반", "과목", "주차", "모둠", "역할", "발화수", "아이디어제안수", "기여도", "동료평가", "갈등조정"];
  const rows: GeneratedDataset["rows"] = [];
  for (let week = 1; week <= options.weeks; week++) for (let i = 0; i < options.students; i++) rows.push([studentId(options, i), options.school, options.grade, options.classNo, options.subject, week, `${(i % Math.max(2, Math.ceil(options.students / 5))) + 1}모둠`, pick(["리더", "기록", "발표", "자료", "시간관리"], random), between(2, 32, random), between(0, 8, random), decimal(1, 5, random), decimal(1, 5, random), between(0, 4, random)]);
  return { id: "collaboration", label: "협업활동", description: datasetCatalog[7].description, filename: "collaboration_activity.csv", columns, rows };
}

export function generateDatasets(options: GeneratorOptions, selected: DatasetId[]) {
  const makers: Record<DatasetId, (options: GeneratorOptions, random: () => number) => GeneratedDataset> = {
    achievement,
    lms,
    formative,
    ai: aiLog,
    affective,
    portfolio,
    observation,
    collaboration,
  };
  return selected.map((id, index) => makers[id](options, createRandom(options.seed + index * 977)));
}

function escapeCsv(value: string | number) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function datasetToCsv(dataset: GeneratedDataset) {
  return [dataset.columns, ...dataset.rows].map(row => row.map(escapeCsv).join(",")).join("\r\n");
}

export function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
