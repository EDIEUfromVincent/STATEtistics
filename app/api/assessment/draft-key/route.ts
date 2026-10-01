import { STANDARDS } from "../../../lib/assessment/standards";
import { AssessmentApiError, assertAccess, audit, callGemini, errorResponse, geminiConfig } from "../_gemini";

// 빈 시험지 PDF에서 브라우저가 뽑은 "칸 목록 + 문제 글 + 정답·해설 글"로 정답표 초안을 만든다.
// 학생 자료는 받지 않는다. 결과는 초안이며 교사가 확정해야 채점에 쓴다.

type CellIn = { id: string; kind: "number" | "pick" | "write"; line: string; options?: string[]; count?: number };
const KINDS = ["선택형", "복수선택", "기호", "OX", "단답", "서술"];

const codeOf = (s: string) => s.replace(/\s+/g, "");

export async function POST(request: Request) {
  try {
    assertAccess(request);
    const cfg = geminiConfig();
    if (!cfg.apiKey || !cfg.paidTier) throw new AssessmentApiError("GEMINI_API_KEY와 GEMINI_PAID_TIER=true를 설정해 주세요.", 503);
    const body = (await request.json()) as { cells?: unknown; questionText?: unknown; answerText?: unknown };
    const cells = Array.isArray(body.cells) ? (body.cells as CellIn[]).filter(c => typeof c?.id === "string" && /^[\w-]{1,8}$/.test(c.id)).slice(0, 80) : [];
    const questionText = typeof body.questionText === "string" ? body.questionText.slice(0, 40000) : "";
    const answerText = typeof body.answerText === "string" ? body.answerText.slice(0, 30000) : "";
    if (!cells.length) throw new AssessmentApiError("시험지에서 답 칸을 찾지 못했습니다.", 400);

    // 성취기준: 시험지·해설에 적힌 코드가 있으면 그것만, 없으면 앱에 등록된 전체
    const mentioned = [...new Set(`${questionText}\n${answerText}`.match(/\[\s*\d\s*[가-힣]+\s*\d{2}\s*-\s*\d{2}\s*\]/g)?.map(codeOf) ?? [])].filter(c => STANDARDS[c]);
    const standards = Object.fromEntries((mentioned.length ? mentioned : Object.keys(STANDARDS)).map(c => [c, STANDARDS[c].statement]));

    const list = cells.map(c => ({
      칸: c.id,
      종류: c.kind === "number" ? "보기 번호 고르기" : c.kind === "pick" ? "( / ) 중 ○표" : "쓰는 칸",
      "그 칸이 있는 줄": String(c.line ?? "").slice(0, 200),
      ...(c.kind === "pick" && c.options ? { "고를 낱말": c.options.slice(0, 6) } : {}),
      ...(c.kind === "number" && c.count ? { "보기 수": c.count } : {}),
    }));
    const prompt = `초등 시험지의 정답표 초안을 만듭니다. 아래 [칸 목록]의 칸마다 정확히 한 줄을 만드세요.
규칙
- 정답은 [정답·해설 쪽]에 적힌 것만 씁니다. 해설에 없거나 어느 칸의 답인지 확실하지 않으면 정답을 비우고 확신을 "확인필요"로 합니다. 절대 문제를 직접 풀어서 채우지 마세요.
- 한 문항에 칸이 여러 개면 해설의 답을 칸 순서대로 나눕니다 (예: "짧아 / 높아 / 늦다" → 6-1, 6-2, 6-3).
- 유형: 보기 번호 고르기 = 선택형(정답은 ③처럼). ( / ) 중 ○표 = 단답(정답은 고를 낱말 중 하나). 쓰는 칸 = 단답, 기호((가)·㉠), OX, 서술 중 하나. 문장으로 설명하는 칸은 서술.
- 단답 정답에는 같은 뜻으로 인정할 표기를 = 로 이어 적습니다 (예: 짧아=짧아지고=짧아진다). 뜻이 달라질 수 있는 표기는 넣지 말고, 넣었다면 확신을 "확인필요"로 합니다.
- 서술은 정답을 비우고, 채점기준에 해설의 채점 포인트를 1~2문장으로 적습니다 (완전/부분 기준이 있으면 그대로).
- 배점: 시험지에 없으면 단답·선택형 1, 서술 2.
- 성취기준: [성취기준 목록]의 코드 중 하나. 시험지 쪽 머리나 해설의 표시를 근거로 고릅니다.
- 판독안내: 그 칸이 시험지의 어디인지만 (예: "6번 둘째 빈칸 — 기온은 ( )진다"). 정답을 넣지 마세요.
- 근거: 정답을 해설의 어느 부분에서 가져왔는지 짧게 인용.

[성취기준 목록]
${JSON.stringify(standards)}

[칸 목록]
${JSON.stringify(list)}

[시험지 문제 쪽]
${questionText}

[정답·해설 쪽]
${answerText || "(정답·해설 쪽이 없습니다 — 정답은 모두 비우고 확인필요로 하세요)"}`;
    const schema = {
      type: "OBJECT",
      properties: {
        rows: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              문항: { type: "STRING", enum: cells.map(c => c.id) }, 유형: { type: "STRING", enum: KINDS }, 정답: { type: "STRING" },
              배점: { type: "NUMBER" }, 보기수: { type: "NUMBER" }, 채점기준: { type: "STRING" }, 행동영역: { type: "STRING" },
              성취기준: { type: "STRING", enum: Object.keys(standards) }, 판독안내: { type: "STRING" },
              확신: { type: "STRING", enum: ["확인", "확인필요"] }, 근거: { type: "STRING" },
            },
            required: ["문항", "유형", "정답", "배점", "성취기준", "판독안내", "확신", "근거"],
          },
        },
      },
      required: ["rows"],
    };
    const model = process.env.GEMINI_READER_MODEL?.trim() || "gemini-3.8-flash";
    const { data, usage } = await callGemini({ ...cfg, model }, [{ text: prompt }], schema);
    const rows = (Array.isArray(data.rows) ? data.rows : []) as Array<Record<string, unknown>>;
    await audit("assessment_draft_key", { cells: cells.length, rows: rows.length, model, usage });
    const usd = (usage.input * cfg.priceInputPerM + (usage.output + usage.thoughts) * cfg.priceOutputPerM) / 1e6;
    return Response.json({ rows, model, usd });
  } catch (error) {
    return errorResponse(error);
  }
}
