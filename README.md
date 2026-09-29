# STATEtistic

Personal data lab for generating reproducible synthetic CSV datasets, building
custom visualizations, and running TabPFN classification or regression through
the Prior Labs API.

## Features

The app has two stages. Data comes in only through stage ①; stage ② reads the
single "current dataset" (kept in this tab's `sessionStorage` only).

1. Data preparation
   - Synthetic generator (`/`), including item-level assessment responses
     linked to 2022 curriculum achievement standards
   - Test-paper grading (`/grading/*`): roster → answer key → photos with
     name-field redaction in the browser → teacher approval → Gemini OCR →
     rule-based scoring → teacher review → result
   - CSV import (`/import`)
2. Analysis
   - Assessment analysis (`/analysis`): item difficulty/discrimination,
     distractors, and per-standard evidence next to the official
     achievement-level descriptors (levels are never auto-assigned)
   - Visualization and TabPFN prediction (`/studio`)

`/dashboard` redirects to `/analysis`.
- Learning-signal dashboard
- CSV upload and custom scatter, line, bar, and histogram views
- Server-side TabPFN API bridge for classification and regression
- Responsive Korean/English interface

## Start the web app

```powershell
npm install
npm run dev
```

Open `http://localhost:3000` (or the next port printed by the dev server).

## Configure TabPFN

Set the Prior Labs API key only in the server environment:

```text
PRIORLABS_API_KEY=your-api-key
```

For a public deployment, also set `STATETISTIC_ACCESS_KEY` to protect API usage.
Visitors enter that separate access code in `/studio`; the Prior Labs key is
never sent to the browser. Uploaded analysis data is sent to the Prior Labs API,
so remove sensitive or personally identifiable information before use.

## Configure grading (Gemini OCR)

Grading handles real student work, so the OCR endpoints fail closed until all
of these Railway variables are set:

```text
STATETISTIC_ACCESS_KEY=shared-access-code
GEMINI_API_KEY=your-paid-tier-key
GEMINI_PAID_TIER=true
GEMINI_MODEL=gemini-2.5-flash   # optional
```

Cost controls: one OCR request per student (all pages together), pages capped
at 1536 px (4 image tiles per A4 page), thinking disabled for
`gemini-2.5-flash*` (override with `GEMINI_THINKING_BUDGET`), results cached by
image hash so re-runs only send failed students, and one essay-suggestion call
per answer. The UI shows an estimate before OCR and the actual token cost
after; tune the estimate with `GEMINI_PRICE_INPUT_PER_M`,
`GEMINI_PRICE_OUTPUT_PER_M`, and `USD_KRW`.

`GEMINI_PAID_TIER=true` is a deliberate acknowledgement: free-tier inputs may be
used to improve Google products, so student data must go through a paid key.

What leaves the browser:

| Data | Where it stays |
|---|---|
| Original photos, roster (names ↔ codes), answer keys | Browser memory only; roster can be saved as a local file |
| Page images with the name field blacked out, EXIF removed | Sent to `/api/assessment/ocr` → Gemini, not stored; only hash/size is logged |
| Essay answers with student names masked (optional AI suggestion) | Sent to `/api/assessment/essay` → Gemini, not stored |
| Correct answers | Never sent to OCR |

Scores for fixed-answer items are computed by rules in the browser. Essay
scores and uncertain readings are confirmed by the teacher. Results contain
student codes only. Publisher answer keys must not be committed to this repo.

## Validation

```powershell
npm run build
node --test tests/assessment.test.ts
```
