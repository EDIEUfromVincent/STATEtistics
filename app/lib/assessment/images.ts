// 브라우저 안에서 사진·스캔 PDF를 읽어 이름 칸을 가린 JPEG로 만든다.
// 캔버스로 다시 그려 저장하므로 EXIF(촬영 위치·기기 정보)가 남지 않는다.
// 원본 사진과 이름 칸 조각은 이 브라우저 메모리에만 있고, 서버로 가는 것은 가린 JPEG뿐이다.

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
    name: "1쪽 맨 위 띠 전체 (이름 칸 위치가 다른 양식)",
    redact: [{ page: 1, region: [0, 0, 1, 0.16] }],
    identity: { page: 1, region: [0, 0, 1, 0.16] },
  },
];

const MAX_SIDE = 2000;
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
};

const naturalKey = (name: string) => name.split(/(\d+)/).map(t => (/^\d+$/.test(t) ? t.padStart(8, "0") : t)).join("");

export function sortFiles(files: File[]) {
  return [...files].sort((a, b) => naturalKey(a.name).localeCompare(naturalKey(b.name)));
}

async function pdfPages(file: File): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: HTMLCanvasElement[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, MAX_SIDE / Math.max(base.width, base.height)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    out.push(canvas);
  }
  await doc.destroy();
  return out;
}

export async function loadPages(files: File[]): Promise<RawPage[]> {
  const pages: RawPage[] = [];
  for (const file of sortFiles(files)) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".pdf") || file.type === "application/pdf") {
      (await pdfPages(file)).forEach((image, index) => pages.push({ source: file.name, index, image }));
      continue;
    }
    try {
      pages.push({ source: file.name, index: 0, image: await createImageBitmap(file, { imageOrientation: "from-image" }) });
    } catch {
      throw new Error(
        /\.(heic|heif)$/.test(lower)
          ? `${file.name}: HEIC 사진은 이 브라우저에서 읽을 수 없습니다. 아이폰 설정 > 카메라 > 포맷 > '높은 호환성'으로 찍거나 스캔 앱에서 PDF로 저장해 주세요.`
          : `${file.name}: 이미지를 읽을 수 없습니다.`,
      );
    }
  }
  return pages;
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
export async function processPage(raw: RawPage, code: string, page: number, template: Template) {
  const canvas = toCanvas(raw.image);
  let identityUrl = "";
  if (template.identity?.page === page) {
    const [x, y, w, h] = box(canvas, template.identity.region);
    const crop = document.createElement("canvas");
    crop.width = w;
    crop.height = h;
    crop.getContext("2d")!.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    identityUrl = URL.createObjectURL(await jpeg(crop));
  }
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "black";
  for (const r of template.redact.filter(r => r.page === page || r.page === 0)) ctx.fillRect(...box(canvas, r.region));
  const blob = await jpeg(canvas);
  const processed: ProcessedPage = {
    file: `${code}_p${page}.jpg`, code, page, source: raw.source, blob, url: URL.createObjectURL(blob),
    sha256: await sha256Hex(await blob.arrayBuffer()), warning: ratioWarning(canvas),
  };
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
