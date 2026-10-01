// 브라우저 안에서 사진·스캔 PDF를 읽어 이름 칸을 가린 JPEG로 만든다.
// 캔버스로 다시 그려 저장하므로 EXIF(촬영 위치·기기 정보)가 남지 않는다.
// 원본 사진과 이름 칸 조각은 이 브라우저 메모리에만 있고, 서버로 가는 것은 가린 JPEG뿐이다.

import { PROFILE_H, PROFILE_W, rowProfile, shiftRegion } from "./align.ts";
import { sha256Hex } from "./privacy.ts";

export type Region = [number, number, number, number]; // [왼쪽, 위, 오른쪽, 아래] 비율
// page 0 = 모든 쪽
export type Template = { id: string; name: string; redact: Array<{ page: number; region: Region }>; identity?: { page: number; region: Region } };

const ISCREAM_HEADER: Region = [0.66, 0.03, 0.97, 0.142];

export const TEMPLATES: Template[] = [
  {
    id: "iscream-unit",
    name: "아이스크림 단원평가 (1쪽 오른쪽 위 이름 칸)",
    redact: [{ page: 1, region: ISCREAM_HEADER }],
    identity: { page: 1, region: ISCREAM_HEADER },
  },
  {
    id: "iscream-every-page",
    name: "모든 쪽 오른쪽 위 이름 칸 (쪽마다 이름을 쓰는 학습지)",
    redact: [{ page: 0, region: ISCREAM_HEADER }],
    identity: { page: 1, region: ISCREAM_HEADER },
  },
  {
    id: "top-band",
    name: "1쪽 맨 위 띠 전체 + 모든 쪽 위 여백 (직접 만든 양식 등)",
    // 학생은 1쪽 이름 칸 말고도 다른 쪽 위 여백에 이름을 쓰곤 한다. 모든 쪽의 위 여백·머리말을 함께 가린다
    redact: [{ page: 1, region: [0, 0, 1, 0.16] }, { page: 0, region: [0, 0, 1, 0.044] }],
    identity: { page: 1, region: [0, 0, 1, 0.16] },
  },
];

// 1536px이면 A4 한 쪽이 Gemini 과금 조각 4개(768px×2×2)에 들어간다. 2000px이면 6개로 약 1.5배
const MAX_SIDE = 1536;
const A4_RATIO = 297 / 210;

export type RawPage = { source: string; index: number; image: ImageBitmap | HTMLCanvasElement };
export type ProcessedPage = {
  file: string; // 학생코드_p쪽.jpg — 파일 이름에 이름이 들어가지 않는다
  code: string;
  page: number;
  source: string;
  blob: Blob;
  url: string;
  sha256: string;
  warning: string;
  width: number;
  height: number;
};

const naturalKey = (name: string) => name.split(/(\d+)/).map(t => (/^\d+$/.test(t) ? t.padStart(8, "0") : t)).join("");

export function sortFiles(files: File[]) {
  return [...files].sort((a, b) => naturalKey(a.name).localeCompare(naturalKey(b.name)));
}

// 스캔 방식. 모아 찍기(한 면에 두 쪽)를 90° 돌려 스캔한 경우가 흔하다.
// rotate는 반시계 방향 각도. 돌린 뒤 split이 2면 왼쪽 절반 = 앞쪽, 오른쪽 절반 = 뒤쪽.
export type ScanLayout = { id: string; name: string; rotate: 0 | 90 | 180 | 270; split: 1 | 2 };

export const LAYOUTS: ScanLayout[] = [
  { id: "single", name: "한 장에 한 쪽 (세로로 스캔)", rotate: 0, split: 1 },
  { id: "2up-ccw", name: "한 장에 두 쪽 모아 찍기 · 양식 위쪽이 스캔 오른쪽을 향함", rotate: 90, split: 2 },
  { id: "2up-cw", name: "한 장에 두 쪽 모아 찍기 · 양식 위쪽이 스캔 왼쪽을 향함", rotate: 270, split: 2 },
  { id: "2up-landscape", name: "한 장에 두 쪽 모아 찍기 · 가로로 바로 스캔", rotate: 0, split: 2 },
  { id: "upside-down", name: "한 장에 한 쪽 · 거꾸로 스캔", rotate: 180, split: 1 },
];

export type PageSource = { source: string; index: number; load: () => Promise<ImageBitmap | HTMLCanvasElement> };

/**
 * 스캔을 한 장씩 필요할 때 읽는다. 72쪽 PDF를 한꺼번에 그리면 브라우저 메모리가 부족하다.
 * 모아 찍기는 반으로 자르므로 두 배 해상도로 읽어야 한 쪽이 MAX_SIDE가 된다.
 */
export async function openPages(files: File[], split: 1 | 2): Promise<{ pages: PageSource[]; close: () => Promise<void> }> {
  const pages: PageSource[] = [];
  const docs: Array<{ destroy: () => Promise<void> }> = [];
  const target = MAX_SIDE * split;
  for (const file of sortFiles(files)) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".pdf") || file.type === "application/pdf") {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      docs.push(doc);
      for (let n = 1; n <= doc.numPages; n++) {
        pages.push({
          source: file.name, index: n - 1,
          load: async () => {
            const page = await doc.getPage(n);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(4, target / Math.max(base.width, base.height)) });
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            await page.render({ canvas, viewport }).promise;
            page.cleanup();
            return canvas;
          },
        });
      }
      continue;
    }
    if (/\.(heic|heif)$/.test(lower)) {
      throw new Error(`${file.name}: HEIC 사진은 이 브라우저에서 읽을 수 없습니다. 아이폰 설정 > 카메라 > 포맷 > '높은 호환성'으로 찍거나 스캔 앱에서 PDF로 저장해 주세요.`);
    }
    pages.push({
      source: file.name, index: 0,
      load: () => createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => { throw new Error(`${file.name}: 이미지를 읽을 수 없습니다.`); }),
    });
  }
  return { pages, close: async () => { await Promise.all(docs.map(d => d.destroy())); } };
}

/** 반시계 방향으로 돌리고, 모아 찍기면 왼쪽·오른쪽 두 쪽으로 나눈다 */
export function applyLayout(image: ImageBitmap | HTMLCanvasElement, layout: ScanLayout): HTMLCanvasElement[] {
  const quarter = layout.rotate === 90 || layout.rotate === 270;
  const rotated = document.createElement("canvas");
  rotated.width = quarter ? image.height : image.width;
  rotated.height = quarter ? image.width : image.height;
  const ctx = rotated.getContext("2d")!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, rotated.width, rotated.height);
  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate((-layout.rotate * Math.PI) / 180); // 캔버스는 시계 방향이 양수
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  if (layout.split === 1) return [rotated];
  const half = Math.floor(rotated.width / 2);
  return [0, 1].map(k => {
    const part = document.createElement("canvas");
    part.width = k === 0 ? half : rotated.width - half;
    part.height = rotated.height;
    part.getContext("2d")!.drawImage(rotated, k * half, 0, part.width, part.height, 0, 0, part.width, part.height);
    return part;
  });
}

function toCanvas(image: ImageBitmap | HTMLCanvasElement) {
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const box = (c: HTMLCanvasElement, [x0, y0, x1, y1]: Region) =>
  [Math.floor(x0 * c.width), Math.floor(y0 * c.height), Math.ceil((x1 - x0) * c.width), Math.ceil((y1 - y0) * c.height)] as const;

function ratioWarning(c: HTMLCanvasElement) {
  const r = Math.max(c.width, c.height) / Math.min(c.width, c.height);
  return Math.abs(r - A4_RATIO) > 0.12 ? `종이 비율이 A4와 다릅니다(${r.toFixed(2)}). 가림 위치가 어긋날 수 있으니 스캔 앱을 권장합니다` : "";
}

function jpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("이미지 저장 실패"))), "image/jpeg", 0.88));
}

/** 한 쪽을 정리한다: 크기 줄이기 → (로컬용) 이름 칸 조각 → 가림 → JPEG */
/** 위치 맞춤용 행 잉크 모양 (작게 줄여서 잰다) */
export function canvasProfile(canvas: HTMLCanvasElement) {
  const small = document.createElement("canvas");
  small.width = PROFILE_W;
  small.height = PROFILE_H;
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, PROFILE_W, PROFILE_H);
  ctx.drawImage(canvas, 0, 0, PROFILE_W, PROFILE_H);
  return rowProfile(ctx.getImageData(0, 0, PROFILE_W, PROFILE_H).data);
}

/**
 * 1쪽은 반 전체를 본 뒤에 가려야 하므로 잠시 가리지 않은 채 이 브라우저 메모리에만 둔다
 * (이름 칸 조각과 같은 수준). 위치 모양도 함께 잰다.
 */
export async function stagePage(raw: RawPage) {
  const canvas = toCanvas(raw.image);
  const profile = canvasProfile(canvas);
  const blob = await jpeg(canvas);
  canvas.width = canvas.height = 0;
  return { blob, profile };
}

export async function processStaged(blob: Blob, source: string, code: string, page: number, template: Template, shift: number) {
  const image = await createImageBitmap(blob);
  try {
    return await processPage({ source, index: 0, image }, code, page, template, shift);
  } finally {
    image.close();
  }
}

/** 한 쪽을 정리한다: 크기 줄이기 → (로컬용) 이름 칸 조각 → 가림 → JPEG. shift만큼 가림 영역을 늘린다 */
export async function processPage(raw: RawPage, code: string, page: number, template: Template, shift = 0) {
  const canvas = toCanvas(raw.image);
  let identityUrl = "";
  if (template.identity?.page === page) {
    const [x, y, w, h] = box(canvas, shiftRegion(template.identity.region, shift));
    const crop = document.createElement("canvas");
    crop.width = w;
    crop.height = h;
    crop.getContext("2d")!.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    identityUrl = URL.createObjectURL(await jpeg(crop));
  }
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "black";
  for (const r of template.redact.filter(r => r.page === page || r.page === 0)) ctx.fillRect(...box(canvas, shiftRegion(r.region, shift)));
  const blob = await jpeg(canvas);
  const warnings = [ratioWarning(canvas)];
  if (Math.abs(shift) >= 0.03) warnings.push(`스캔 위치가 ${Math.round(Math.abs(shift) * 100)}% ${shift > 0 ? "아래로" : "위로"} 밀려 가림 띠를 그만큼 늘렸습니다. 이름이 모두 가려졌는지 꼭 보세요`);
  const processed: ProcessedPage = {
    file: `${code}_p${page}.jpg`, code, page, source: raw.source, blob, url: URL.createObjectURL(blob),
    sha256: await sha256Hex(await blob.arrayBuffer()), warning: warnings.filter(Boolean).join(" · "),
    width: canvas.width, height: canvas.height,
  };
  canvas.width = canvas.height = 0;
  return { processed, identityUrl };
}

export async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** 데모용 가상 시험지. 머리글에 가짜 이름이 들어 있어 가림이 되는지 눈으로 확인할 수 있다. */
export function demoPage(number: number, name: string, page: number, title: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1240, 1754);
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 3;
  ctx.strokeRect(60, 70, 1120, 150);
  ctx.fillStyle = "#222";
  ctx.font = "bold 44px sans-serif";
  ctx.fillText(title, 110, 150);
  if (page === 1) {
    // 실제 단원평가처럼 이름 칸은 1쪽에만 있다
    ctx.font = "30px sans-serif";
    ctx.fillText(`6학년 2반 ${number}번`, 870, 120);
    ctx.fillText(`이름: ${name}`, 870, 185);
  }
  ctx.strokeStyle = "#ccc";
  for (let y = 300; y < 1680; y += 90) ctx.strokeRect(80, y, 1080, 1);
  ctx.fillStyle = "#666";
  ctx.font = "26px sans-serif";
  ctx.fillText(`- ${page} -`, 590, 1720);
  return canvas;
}
