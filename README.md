# STATEtistic

Personal data lab for generating reproducible synthetic CSV datasets, building
custom visualizations, and running TabPFN classification or regression through
the Prior Labs API.

## Features

- Eight deterministic synthetic datasets with individual CSV and ZIP export
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

## Validation

```powershell
npm run build
```
