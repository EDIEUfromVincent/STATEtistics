"""Local HTTP bridge between the STATEtistic web UI and TabPFN."""

from __future__ import annotations

import importlib.metadata
import json
import math
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


HOST = "127.0.0.1"
PORT = 8765


def json_safe(value: Any) -> Any:
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def analyze(payload: dict[str, Any]) -> dict[str, Any]:
    import numpy as np
    import pandas as pd
    import torch
    from sklearn.metrics import (
        accuracy_score,
        balanced_accuracy_score,
        mean_absolute_error,
        mean_squared_error,
        r2_score,
    )
    from sklearn.model_selection import train_test_split
    from tabpfn import TabPFNClassifier, TabPFNRegressor

    rows = payload.get("rows")
    target = str(payload.get("target", ""))
    task = str(payload.get("task", "classification"))
    test_size = float(payload.get("test_size", 0.25))
    if not isinstance(rows, list) or len(rows) < 8:
        raise ValueError("TabPFN 분석에는 최소 8개 행이 필요합니다.")

    frame = pd.DataFrame(rows)
    if target not in frame.columns:
        raise ValueError(f"목표 열 '{target}'을 찾을 수 없습니다.")

    frame = frame.replace("", np.nan).dropna(subset=[target]).reset_index(drop=True)
    y = frame.pop(target)
    X = frame.copy()
    for column in X.columns:
        numeric = pd.to_numeric(X[column], errors="coerce")
        if numeric.notna().mean() >= 0.9:
            X[column] = numeric
        else:
            X[column] = pd.factorize(X[column].fillna("__MISSING__"))[0]

    if task == "regression":
        y = pd.to_numeric(y, errors="coerce")
        valid = y.notna()
        X, y = X.loc[valid], y.loc[valid]
        if len(y) < 8:
            raise ValueError("회귀 목표 열에 유효한 숫자 데이터가 부족합니다.")
        stratify = None
    else:
        y = y.astype(str)
        if y.nunique() < 2:
            raise ValueError("분류 목표 열에는 최소 2개 클래스가 필요합니다.")
        counts = y.value_counts()
        stratify = y if counts.min() >= 2 and y.nunique() <= max(2, int(len(y) * test_size)) else None

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=max(0.15, min(0.4, test_size)),
        random_state=42,
        stratify=stratify,
    )

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if task == "regression":
        model = TabPFNRegressor(device=device)
        model.fit(X_train, y_train)
        prediction = model.predict(X_test)
        metrics = {
            "r2": r2_score(y_test, prediction),
            "mae": mean_absolute_error(y_test, prediction),
            "rmse": mean_squared_error(y_test, prediction) ** 0.5,
        }
        confidence = [None] * len(prediction)
    else:
        model = TabPFNClassifier(device=device)
        model.fit(X_train, y_train)
        prediction = model.predict(X_test)
        probabilities = model.predict_proba(X_test)
        confidence = probabilities.max(axis=1).tolist()
        metrics = {
            "accuracy": accuracy_score(y_test, prediction),
            "balanced_accuracy": balanced_accuracy_score(y_test, prediction),
        }

    prediction_rows = [
        {
            "actual": json_safe(actual),
            "predicted": json_safe(predicted),
            "confidence": json_safe(conf),
        }
        for actual, predicted, conf in zip(y_test.tolist(), prediction.tolist(), confidence, strict=True)
    ]
    return {
        "task": task,
        "target": target,
        "rows": len(frame),
        "features": X.shape[1],
        "device": device,
        "metrics": {key: json_safe(value) for key, value in metrics.items()},
        "predictions": prediction_rows,
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_json(200, {"ok": True})

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            version = importlib.metadata.version("tabpfn")
        except importlib.metadata.PackageNotFoundError:
            version = None
        self.send_json(200 if version else 503, {"ok": bool(version), "tabpfn_version": version})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/analyze":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            self.send_json(200, analyze(payload))
        except Exception as exc:  # UI receives a safe message; traceback stays local.
            traceback.print_exc()
            self.send_json(400, {"error": str(exc)})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[STATEtistic TabPFN] {format % args}")


if __name__ == "__main__":
    print(f"STATEtistic TabPFN engine: http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
