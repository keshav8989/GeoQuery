# GeoQuery — Submission Deliverables

**Natural Language Understanding of RGB Imagery**
Mock Inter IIT Tech Meet 15.0 · IIT Ropar Internal Preparatory Edition

This Google Drive contains all deliverables for the GeoQuery submission. Every
item is listed below so evaluators know exactly what to expect.

> Sharing: this Drive is set to **"Anyone with the link can view."**

---

## 📁 Folder & File Guide

| File / Folder | What it is |
|---------------|-----------|
| `GeoQuery-Presentation.pptx` | **Project presentation** (9 slides, 16:9) — problem, target classes, architecture, vision pipeline, VQA engine, interface compliance, results & future work. |
| `GeoQuery-Technical-Report.md` | **Technical report** — system design, model choices, and results (source of the presentation). A PDF copy is also included. |
| `GeoQuery-Technical-Report.pdf` | PDF export of the technical report for easy viewing. |
| `/source-code/` | Complete frontend source (React + Tailwind SPA). See its own README to run locally. |
| `/demo/` | Screen recording of the 5-minute live demo and sample annotated screenshots. |
| `/sample-images/` | A few sample RGB test images (urban / natural / mixed scenes) used in the demo. |

---

## ▶️ How to Run the App

The app is a static Vite + React project — no backend, database, or API keys.

```bash
cd source-code
pnpm install
pnpm dev        # local development
pnpm build      # emits static assets to dist/ for deployment
```

The production `dist/` can be hosted on any static host (Netlify, Vercel,
GitHub Pages, S3 + CloudFront).

---

## ✅ What GeoQuery Delivers

- **Image captioning** — automatic, factual caption on upload.
- **Object detection** — bounding boxes over six land-cover classes with labels
  and confidence scores.
- **Visual Question Answering** — one unified chat handling binary, numeric, and
  attribute questions, plus multi-turn context.
- **Bonus features** — object-level click queries and exportable PDF report.

No paid commercial vision API is used in the inference path; all analysis runs
in-browser (fully privacy-preserving).

---

## 📌 Notes for Evaluators

- Open the `.pptx` in PowerPoint, Google Slides, or Keynote.
- To reproduce the demo, upload any `.jpg`/`.png` (≤ 1024×1024; larger images
  are auto-resized) and ask questions such as *"mark all vehicles"* or
  *"how many buildings are visible?"*.
