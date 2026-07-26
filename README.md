# STATEtistic

Personal data lab for generating reproducible synthetic CSV datasets, building
custom visualizations, and running local TabPFN classification or regression.

## Features

- Eight deterministic synthetic datasets with individual CSV and ZIP export
- Learning-signal dashboard
- CSV upload and custom scatter, line, bar, and histogram views
- Local TabPFN bridge for classification and regression
- Responsive Korean/English interface

## Start the web app

```powershell
npm install
npm run dev
```

Open `http://localhost:3000` (or the next port printed by the dev server).

## Start TabPFN

The TabPFN source checkout lives in `work/TabPFN`. The launcher creates a
separate Python environment and installs that local checkout on first use:

```powershell
npm run tabpfn
```

Then open `/studio`; the engine badge should show `엔진 연결됨`.

To start the web app and TabPFN together:

```powershell
npm run dev:full
```

The first model run may open Prior Labs authentication so that you can accept
the checkpoint license. Model weights may be limited to non-commercial use;
check the current TabPFN license before use beyond personal research.

## Validation

```powershell
npm run build
```
