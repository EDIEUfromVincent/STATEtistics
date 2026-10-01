"use client";

// 큰 파일 넣기 칸: 눌러서 고르거나 끌어다 놓는다.
import { useState, type ReactNode } from "react";

export function DropZone({ accept, multiple, disabled, onFiles, title, children }: {
  accept: string; multiple?: boolean; disabled?: boolean; onFiles: (files: FileList) => void; title: ReactNode; children?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`upload-drop drop-zone ${over ? "over" : ""} ${disabled ? "disabled" : ""}`}
      onDragOver={e => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); if (!disabled && e.dataTransfer.files.length) onFiles(e.dataTransfer.files); }}
    >
      <input type="file" accept={accept} multiple={multiple} disabled={disabled} onChange={e => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ""; }} />
      <span className="drop-icon" aria-hidden>📄</span>
      <b>{title}</b>
      {children && <span>{children}</span>}
    </label>
  );
}
