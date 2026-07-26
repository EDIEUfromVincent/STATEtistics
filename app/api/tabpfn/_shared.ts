type Row = Record<string, string | number | null | undefined>;

type UploadInfo = {
  signed_urls: string[];
  required_headers?: Record<string, string>;
};

type PrepareTrainResponse = {
  train_set_upload_id: string;
  x_train_info: UploadInfo;
  y_train_info: UploadInfo;
};

type PrepareTestResponse = {
  test_set_upload_id: string;
  x_test_info: UploadInfo;
};

type PredictionResponse = {
  prediction: unknown;
  metadata?: {
    package_version?: string;
    tabpfn_config?: { model_path?: string };
  };
};

export class TabPFNError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "TabPFNError";
    this.status = status;
  }
}

const API_BASE = "https://api.priorlabs.ai";
const MAX_ROWS = 2_000;
const MAX_FEATURES = 100;

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

async function priorFetch<T>(path: string, apiKey: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new TabPFNError("TabPFN API가 올바르지 않은 응답을 반환했습니다.", 502);
    }
  }

  if (!response.ok) {
    const upstreamMessage =
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.detail === "string"
          ? payload.detail
          : "TabPFN API 요청에 실패했습니다.";
    if (response.status === 401 || response.status === 403) {
      throw new TabPFNError("PRIORLABS_API_KEY가 유효하지 않거나 API 사용 권한이 없습니다.", 503);
    }
    if (response.status === 429) {
      throw new TabPFNError("TabPFN API 사용 한도에 도달했습니다. Prior Labs 사용량을 확인해 주세요.", 429);
    }
    throw new TabPFNError(upstreamMessage, response.status >= 500 ? 502 : 400);
  }

  return payload as T;
}

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(columns: string[], rows: Row[]) {
  return [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n");
}

function encodeCsv(columns: string[], rows: Row[]) {
  return new TextEncoder().encode(toCsv(columns, rows));
}

async function uploadBytes(bytes: Uint8Array, info: UploadInfo) {
  if (!info.signed_urls?.length) {
    throw new TabPFNError("TabPFN 업로드 주소를 받지 못했습니다.", 502);
  }

  const chunkSize = Math.ceil(bytes.byteLength / info.signed_urls.length);
  await Promise.all(
    info.signed_urls.map(async (url, index) => {
      const start = index * chunkSize;
      const end = Math.min(bytes.byteLength, start + chunkSize);
      const response = await fetch(url, {
        method: "PUT",
        headers: info.required_headers ?? {},
        body: bytes.slice(start, end),
      });
      if (!response.ok) {
        throw new TabPFNError("TabPFN 데이터 업로드에 실패했습니다.", 502);
      }
    }),
  );
}

function seededShuffle<T>(items: T[], seed = 42) {
  const result = [...items];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index--) {
    state = (1664525 * state + 1013904223) >>> 0;
    const target = state % (index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function splitRows(rows: Row[], target: string, task: string, testSize: number) {
  if (task !== "classification") {
    const shuffled = seededShuffle(rows);
    const testCount = Math.max(1, Math.min(rows.length - 2, Math.round(rows.length * testSize)));
    return { train: shuffled.slice(testCount), test: shuffled.slice(0, testCount) };
  }

  const groups = new Map<string, Row[]>();
  rows.forEach((row) => {
    const label = String(row[target] ?? "");
    groups.set(label, [...(groups.get(label) ?? []), row]);
  });

  const train: Row[] = [];
  const test: Row[] = [];
  Array.from(groups.entries()).forEach(([label, group], groupIndex) => {
    const shuffled = seededShuffle(group, 42 + groupIndex * 97 + label.length);
    const testCount =
      shuffled.length < 2
        ? 0
        : Math.max(1, Math.min(shuffled.length - 1, Math.round(shuffled.length * testSize)));
    test.push(...shuffled.slice(0, testCount));
    train.push(...shuffled.slice(testCount));
  });

  if (!test.length) {
    throw new TabPFNError("분류 성능을 측정하려면 각 클래스에 최소 2개 이상의 행이 필요합니다.", 400);
  }
  return { train: seededShuffle(train, 2026), test: seededShuffle(test, 2027) };
}

function classificationMetrics(actual: string[], probabilities: number[][], classes: string[]) {
  const predicted = probabilities.map((row) => classes[row.indexOf(Math.max(...row))] ?? classes[0]);
  const accuracy = predicted.filter((value, index) => value === actual[index]).length / actual.length;
  const recalls = classes.map((label) => {
    const indices = actual.map((value, index) => (value === label ? index : -1)).filter((index) => index >= 0);
    if (!indices.length) return null;
    return indices.filter((index) => predicted[index] === label).length / indices.length;
  }).filter((value): value is number => value != null);
  const balancedAccuracy = recalls.reduce((sum, value) => sum + value, 0) / recalls.length;
  return { predicted, accuracy, balancedAccuracy };
}

function regressionMetrics(actual: number[], predicted: number[]) {
  const mean = actual.reduce((sum, value) => sum + value, 0) / actual.length;
  const residual = actual.reduce((sum, value, index) => sum + (value - predicted[index]) ** 2, 0);
  const total = actual.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const mae = actual.reduce((sum, value, index) => sum + Math.abs(value - predicted[index]), 0) / actual.length;
  return {
    r2: total === 0 ? 0 : 1 - residual / total,
    mae,
    rmse: Math.sqrt(residual / actual.length),
  };
}

export async function checkTabPFN(apiKey: string) {
  return priorFetch<Record<string, unknown>>("/tabpfn/get_model_limits", apiKey);
}

export async function analyzeWithTabPFN(payload: unknown, apiKey: string) {
  if (!payload || typeof payload !== "object") {
    throw new TabPFNError("분석 요청 형식이 올바르지 않습니다.", 400);
  }

  const body = payload as {
    rows?: Row[];
    target?: string;
    task?: string;
    test_size?: number;
  };
  const target = String(body.target ?? "");
  const task = body.task === "regression" ? "regression" : "classification";
  const testSize = Math.max(0.15, Math.min(0.4, Number(body.test_size) || 0.25));
  let rows = Array.isArray(body.rows) ? body.rows : [];

  if (rows.length < 8) throw new TabPFNError("TabPFN 분석에는 최소 8개의 행이 필요합니다.", 400);
  if (rows.length > MAX_ROWS) throw new TabPFNError(`한 번에 최대 ${MAX_ROWS.toLocaleString()}개 행을 분석할 수 있습니다.`, 400);
  const columns = Object.keys(rows[0] ?? {});
  if (!target || !columns.includes(target)) throw new TabPFNError("목표 열을 찾을 수 없습니다.", 400);
  const features = columns.filter((column) => column !== target);
  if (!features.length) throw new TabPFNError("목표 열 이외의 특성이 최소 1개 필요합니다.", 400);
  if (features.length > MAX_FEATURES) throw new TabPFNError(`한 번에 최대 ${MAX_FEATURES}개 특성을 분석할 수 있습니다.`, 400);

  rows = rows.filter((row) => String(row[target] ?? "").trim() !== "");
  if (task === "regression") {
    rows = rows.filter((row) => Number.isFinite(Number(row[target])));
    if (rows.length < 8) throw new TabPFNError("회귀 목표 열에 유효한 숫자가 충분하지 않습니다.", 400);
  } else if (new Set(rows.map((row) => String(row[target]))).size < 2) {
    throw new TabPFNError("분류 목표 열에는 최소 2개의 클래스가 필요합니다.", 400);
  }

  const { train, test } = splitRows(rows, target, task, testSize);
  const xTrain = encodeCsv(features, train);
  const yTrain = encodeCsv([target], train);
  const xTest = encodeCsv(features, test);

  const preparedTrain = await priorFetch<PrepareTrainResponse>("/tabpfn/prepare_train_set_upload", apiKey, {
    method: "POST",
    body: JSON.stringify({
      x_train_info: { format: "csv", size_bytes: xTrain.byteLength },
      y_train_info: { format: "csv", size_bytes: yTrain.byteLength },
      description: `STATEtistic ${task} analysis`,
      force_reupload: true,
    }),
  });
  await Promise.all([
    uploadBytes(xTrain, preparedTrain.x_train_info),
    uploadBytes(yTrain, preparedTrain.y_train_info),
  ]);

  const fitted = await priorFetch<{ fitted_train_set_id: string }>("/tabpfn/fit", apiKey, {
    method: "POST",
    body: JSON.stringify({
      train_set_upload_id: preparedTrain.train_set_upload_id,
      task,
      tabpfn_systems: ["preprocessing", "text"],
    }),
  });

  const preparedTest = await priorFetch<PrepareTestResponse>("/tabpfn/prepare_test_set_upload", apiKey, {
    method: "POST",
    body: JSON.stringify({
      fitted_train_set_id: fitted.fitted_train_set_id,
      x_test_info: { format: "csv", size_bytes: xTest.byteLength },
      force_reupload: true,
    }),
  });
  await uploadBytes(xTest, preparedTest.x_test_info);

  const outputType = task === "classification" ? "probas" : "mean";
  const predictionResponse = await priorFetch<PredictionResponse>("/tabpfn/predict", apiKey, {
    method: "POST",
    body: JSON.stringify({
      test_set_upload_id: preparedTest.test_set_upload_id,
      fitted_train_set_id: fitted.fitted_train_set_id,
      task_config: {
        task,
        tabpfn_config: { model_path: "auto" },
        predict_params: { output_type: outputType },
      },
    }),
  });

  const actualValues = test.map((row) => row[target]);
  let metrics: Record<string, number>;
  let predictions: Array<{ actual: string | number; predicted: string | number; confidence?: number }>;

  if (task === "classification") {
    const classes = Array.from(new Set(train.map((row) => String(row[target])))).sort();
    const probabilities = predictionResponse.prediction as number[][];
    if (!Array.isArray(probabilities) || probabilities.some((row) => !Array.isArray(row))) {
      throw new TabPFNError("TabPFN 분류 예측 형식을 해석할 수 없습니다.", 502);
    }
    const actual = actualValues.map(String);
    const result = classificationMetrics(actual, probabilities, classes);
    metrics = { accuracy: result.accuracy, balanced_accuracy: result.balancedAccuracy };
    predictions = result.predicted.map((predicted, index) => ({
      actual: actual[index],
      predicted,
      confidence: Math.max(...probabilities[index]),
    }));
  } else {
    const actual = actualValues.map(Number);
    const predicted = (predictionResponse.prediction as unknown[]).map(Number);
    if (predicted.length !== actual.length || predicted.some((value) => !Number.isFinite(value))) {
      throw new TabPFNError("TabPFN 회귀 예측 형식을 해석할 수 없습니다.", 502);
    }
    metrics = regressionMetrics(actual, predicted);
    predictions = predicted.map((value, index) => ({ actual: actual[index], predicted: value }));
  }

  return {
    task,
    target,
    rows: rows.length,
    features: features.length,
    device: "Prior Labs hosted TabPFN",
    model: predictionResponse.metadata?.tabpfn_config?.model_path ?? "auto",
    metrics,
    predictions,
  };
}
