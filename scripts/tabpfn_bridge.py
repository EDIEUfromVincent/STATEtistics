import json
import math
import os
import random
import sys
from typing import Any

import numpy as np
import pandas as pd
from tabpfn_client import TabPFNClassifier, TabPFNRegressor
from tabpfn_client.config import set_access_token


MAX_ROWS = 2_000
MAX_FEATURES = 100


class RequestError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def normalize_frame(rows: list[dict[str, Any]], features: list[str]) -> pd.DataFrame:
    frame = pd.DataFrame(rows, columns=features)
    for column in features:
        values = frame[column].replace("", np.nan)
        numeric = pd.to_numeric(values, errors="coerce")
        if int(numeric.notna().sum()) == int(values.notna().sum()):
            frame[column] = numeric
        else:
            frame[column] = values.where(values.notna(), None)
    return frame


def split_indices(labels: list[str], test_size: float) -> tuple[list[int], list[int]]:
    groups: dict[str, list[int]] = {}
    for index, label in enumerate(labels):
        groups.setdefault(label, []).append(index)

    train: list[int] = []
    test: list[int] = []
    for group_index, (label, indices) in enumerate(sorted(groups.items())):
        shuffled = list(indices)
        random.Random(42 + group_index * 97 + len(label)).shuffle(shuffled)
        count = 0 if len(shuffled) < 2 else max(1, min(len(shuffled) - 1, round(len(shuffled) * test_size)))
        test.extend(shuffled[:count])
        train.extend(shuffled[count:])

    if not test:
        raise RequestError("분류 성능을 측정하려면 각 클래스에 최소 2개 이상의 행이 필요합니다.")
    random.Random(2026).shuffle(train)
    random.Random(2027).shuffle(test)
    return train, test


def regression_split(row_count: int, test_size: float) -> tuple[list[int], list[int]]:
    indices = list(range(row_count))
    random.Random(42).shuffle(indices)
    test_count = max(1, min(row_count - 2, round(row_count * test_size)))
    return indices[test_count:], indices[:test_count]


def classification_metrics(
    actual: list[str], probabilities: np.ndarray, classes: list[str]
) -> tuple[dict[str, float], list[dict[str, Any]]]:
    predicted_indices = np.argmax(probabilities, axis=1)
    predicted = [classes[int(index)] for index in predicted_indices]
    accuracy = sum(value == actual[index] for index, value in enumerate(predicted)) / len(actual)
    recalls = []
    for label in classes:
        indices = [index for index, value in enumerate(actual) if value == label]
        if indices:
            recalls.append(sum(predicted[index] == label for index in indices) / len(indices))
    balanced_accuracy = sum(recalls) / len(recalls)
    rows = [
        {
            "actual": actual[index],
            "predicted": predicted[index],
            "confidence": float(np.max(probabilities[index])),
        }
        for index in range(len(actual))
    ]
    return {"accuracy": accuracy, "balanced_accuracy": balanced_accuracy}, rows


def regression_metrics(
    actual: np.ndarray, predicted: np.ndarray
) -> tuple[dict[str, float], list[dict[str, float]]]:
    residual = float(np.sum((actual - predicted) ** 2))
    total = float(np.sum((actual - float(np.mean(actual))) ** 2))
    metrics = {
        "r2": 0.0 if total == 0 else 1.0 - residual / total,
        "mae": float(np.mean(np.abs(actual - predicted))),
        "rmse": math.sqrt(residual / len(actual)),
    }
    rows = [
        {"actual": float(actual[index]), "predicted": float(predicted[index])}
        for index in range(len(actual))
    ]
    return metrics, rows


def analyze(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise RequestError("분석 요청 형식이 올바르지 않습니다.")
    rows = payload.get("rows")
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise RequestError("분석할 행 데이터가 필요합니다.")
    if len(rows) < 8:
        raise RequestError("TabPFN 분석에는 최소 8개의 행이 필요합니다.")
    if len(rows) > MAX_ROWS:
        raise RequestError(f"한 번에 최대 {MAX_ROWS:,}개의 행을 분석할 수 있습니다.")

    target = str(payload.get("target") or "")
    columns = list(rows[0].keys())
    if not target or target not in columns:
        raise RequestError("목표 열을 찾을 수 없습니다.")
    features = [column for column in columns if column != target]
    if not features:
        raise RequestError("목표 열 이외의 특성이 최소 1개 필요합니다.")
    if len(features) > MAX_FEATURES:
        raise RequestError(f"한 번에 최대 {MAX_FEATURES}개의 특성을 분석할 수 있습니다.")

    task = "regression" if payload.get("task") == "regression" else "classification"
    test_size = max(0.15, min(0.4, float(payload.get("test_size") or 0.25)))
    filtered = [row for row in rows if str(row.get(target, "")).strip()]
    frame = normalize_frame(filtered, features)

    if task == "classification":
        labels = [str(row[target]) for row in filtered]
        classes = sorted(set(labels))
        if len(classes) < 2:
            raise RequestError("분류 목표 열에는 최소 2개의 클래스가 필요합니다.")
        train_indices, test_indices = split_indices(labels, test_size)
        model = TabPFNClassifier(model_path="auto")
        model.fit(frame.iloc[train_indices], np.asarray(labels)[train_indices])
        probabilities = np.asarray(model.predict_proba(frame.iloc[test_indices]), dtype=float)
        actual = [labels[index] for index in test_indices]
        model_classes = [str(label) for label in model.classes_]
        metrics, predictions = classification_metrics(actual, probabilities, model_classes)
    else:
        target_values = pd.to_numeric(
            pd.Series([row.get(target) for row in filtered]), errors="coerce"
        )
        valid = target_values.notna().to_numpy()
        frame = frame.loc[valid].reset_index(drop=True)
        numeric_target = target_values.loc[valid].to_numpy(dtype=float)
        if len(numeric_target) < 8:
            raise RequestError("회귀 목표 열에 유효한 숫자가 충분하지 않습니다.")
        train_indices, test_indices = regression_split(len(numeric_target), test_size)
        model = TabPFNRegressor(model_path="auto")
        model.fit(frame.iloc[train_indices], numeric_target[train_indices])
        predicted = np.asarray(model.predict(frame.iloc[test_indices]), dtype=float)
        actual = numeric_target[test_indices]
        metrics, predictions = regression_metrics(actual, predicted)
        filtered = [filtered[index] for index, keep in enumerate(valid) if keep]

    return {
        "task": task,
        "target": target,
        "rows": len(filtered),
        "features": len(features),
        "device": "Prior Labs hosted TabPFN",
        "model": "auto",
        "metrics": metrics,
        "predictions": predictions,
    }


def main() -> None:
    api_key = os.environ.get("PRIORLABS_API_KEY", "").strip()
    if not api_key:
        raise RequestError("서버에 PRIORLABS_API_KEY가 설정되지 않았습니다.", 503)
    set_access_token(api_key)
    payload = json.load(sys.stdin)
    print(json.dumps(analyze(payload), ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except RequestError as error:
        print(json.dumps({"error": str(error), "status": error.status}, ensure_ascii=False))
        sys.exit(1)
    except Exception as error:
        print(
            json.dumps(
                {"error": str(error) or "TabPFN 분석에 실패했습니다.", "status": 502},
                ensure_ascii=False,
            )
        )
        sys.exit(1)
