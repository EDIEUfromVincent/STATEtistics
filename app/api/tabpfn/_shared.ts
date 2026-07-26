type BridgeResult = Record<string, unknown> & {
  error?: string;
  status?: number;
};

export class TabPFNError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "TabPFNError";
    this.status = status;
  }
}

export function getPriorLabsApiKey() {
  return process.env.PRIORLABS_API_KEY?.trim() || process.env.TABPFN_TOKEN?.trim() || "";
}

export function requiresStudioAccessKey() {
  return Boolean(process.env.STATETISTIC_ACCESS_KEY?.trim());
}

export function hasValidStudioAccessKey(request: Request) {
  const expected = process.env.STATETISTIC_ACCESS_KEY?.trim();
  if (!expected) return true;
  const provided = request.headers.get("x-statetistic-access-key")?.trim() ?? "";
  if (provided.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) {
    difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
  }
  return difference === 0;
}

async function priorFetch(path: string, apiKey: string) {
  const response = await fetch(`https://api.priorlabs.ai${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new TabPFNError("Prior Labs API가 올바르지 않은 응답을 반환했습니다.", 502);
    }
  }
  if (!response.ok) {
    const message =
      typeof payload.detail === "string"
        ? payload.detail
        : typeof payload.message === "string"
          ? payload.message
          : "Prior Labs API 요청에 실패했습니다.";
    if (response.status === 401 || response.status === 403) {
      throw new TabPFNError("PRIORLABS_API_KEY가 유효하지 않거나 API 사용 권한이 없습니다.", 503);
    }
    if (response.status === 429) {
      throw new TabPFNError("TabPFN API 사용 한도에 도달했습니다.", 429);
    }
    throw new TabPFNError(message, response.status >= 500 ? 502 : 400);
  }
  return payload;
}

export async function checkTabPFN(apiKey: string) {
  return priorFetch("/tabpfn/get_model_limits", apiKey);
}

export async function analyzeWithTabPFN(payload: unknown, apiKey: string) {
  const [{ spawn }, { join }] = await Promise.all([
    import("node:child_process"),
    import("node:path"),
  ]);
  const python =
    process.env.TABPFN_PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3");
  const bridgePath = join(process.cwd(), "scripts", "tabpfn_bridge.py");

  return new Promise<BridgeResult>((resolve, reject) => {
    const child = spawn(python, [bridgePath], {
      env: {
        ...process.env,
        PRIORLABS_API_KEY: apiKey,
        TABPFN_CLIENT_CI_MODE: "true",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let outputTooLarge = false;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new TabPFNError("TabPFN 분석 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", 504));
    }, 180_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 4_000_000) {
        outputTooLarge = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(
        new TabPFNError(
          error.message.includes("ENOENT")
            ? "서버에서 TabPFN Python 실행 환경을 찾지 못했습니다."
            : "TabPFN 실행 프로세스를 시작하지 못했습니다.",
          503,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (outputTooLarge) {
        reject(new TabPFNError("TabPFN 응답 크기가 허용 범위를 초과했습니다.", 502));
        return;
      }
      let result: BridgeResult;
      try {
        result = JSON.parse(stdout.trim()) as BridgeResult;
      } catch {
        reject(
          new TabPFNError(
            code === 0
              ? "TabPFN 분석 응답을 해석하지 못했습니다."
              : stderr.trim() || "TabPFN 분석 프로세스가 실패했습니다.",
            502,
          ),
        );
        return;
      }
      if (result.error) {
        reject(new TabPFNError(result.error, result.status || 502));
        return;
      }
      resolve(result);
    });

    child.stdin.end(JSON.stringify(payload));
  });
}
