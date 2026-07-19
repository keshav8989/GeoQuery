// Renders the technical report markdown into a simple, readable PDF.
import { jsPDF } from "jspdf";
import { readFileSync } from "node:fs";

const md = readFileSync("src/imports/pasted_text/geoquery-technical-report.md", "utf8");
const doc = new jsPDF({ unit: "pt", format: "a4" });
const pageW = doc.internal.pageSize.getWidth();
const pageH = doc.internal.pageSize.getHeight();
const margin = 48;
let y = margin;

const nl = (h) => { y += h; if (y > pageH - margin) { doc.addPage(); y = margin; } };

for (const rawLine of md.split("\n")) {
  const line = rawLine.replace(/\*\*/g, "").replace(/`/g, "");
  if (line.trim() === "---") { nl(6); continue; }
  if (line.startsWith("### ")) { doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(30, 30, 60); wrap(line.slice(4), 13); continue; }
  if (line.startsWith("## ")) { nl(6); doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(31, 58, 147); wrap(line.slice(3), 17); continue; }
  if (line.startsWith("# ")) { doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(31, 58, 147); wrap(line.slice(2), 24); continue; }
  if (line.trim() === "") { nl(6); continue; }
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(40, 40, 40);
  wrap(line, 13);
}

function wrap(text, lh) {
  const lines = doc.splitTextToSize(text, pageW - margin * 2);
  for (const l of lines) { doc.text(l, margin, y); nl(lh); }
}

doc.save("deliverables/GeoQuery-Technical-Report.pdf");
import { writeFileSync } from "node:fs";
writeFileSync("deliverables/GeoQuery-Technical-Report.pdf", Buffer.from(doc.output("arraybuffer")));
console.log("Wrote deliverables/GeoQuery-Technical-Report.pdf");
