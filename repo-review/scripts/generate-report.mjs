#!/usr/bin/env node
// Generate a self-contained HTML scorecard from a findings JSON.
// Usage: node scripts/generate-report.mjs findings.json > docs/audit-report.html
//        cat findings.json | node scripts/generate-report.mjs > out.html
//
// findings.json shape (see examples/findings.example.json):
// {
//   "project": "Name", "date": "2026-06-15", "tags": ["repoA","repoB"],
//   "metrics": [{ "n": "116", "l": "issues filed" }, ...],
//   "dimensions": [{ "name": "Security & secrets", "weight": 25, "score": 35, "note": "..." }, ...],
//   "critical": [{ "title":"...", "area":"...", "impact":"...", "status":"fixed|open|partial" }],
//   "fixes":     [{ "title":"...", "sev":"crit|high|med|low", "evidence":"..." }],
//   "next":      ["...", "..."]
// }
// Weights normally sum to 100 (the rubric); if they don't, the generator still
// produces a valid report (score = weight-normalized average) but warns on stderr.
// Security & data-integrity should be scored as the weakest component (a system is
// only as safe as its weakest half), not an average.
import { readFileSync } from 'node:fs';

const src = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : readFileSync(0, 'utf8');
const d = JSON.parse(src);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dims = d.dimensions || [];
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clamp = (n) => Math.max(0, Math.min(100, n));
const weightSum = dims.reduce((s, x) => s + num(x.weight), 0);
// Weights need not sum to exactly 100 (the score is a weighted average), but the
// rubric is defined at 100 — warn so a typo/missing dimension doesn't pass silently.
if (dims.length && Math.round(weightSum) !== 100) {
  process.stderr.write(`warning: dimension weights sum to ${weightSum}, not 100 — score normalized by the actual sum; check findings.json against rubric.md\n`);
}
// Normalize by the actual weight sum so a partial/over rubric still yields a fair 0-100.
const total = clamp(Math.round(weightSum > 0 ? dims.reduce((s, x) => s + num(x.score) * num(x.weight), 0) / weightSum : 0));
const grade = total >= 85 ? ['A', 'g-a'] : total >= 70 ? ['B', 'g-b'] : total >= 55 ? ['C', 'g-c'] : total >= 40 ? ['D', 'g-d'] : ['F', 'g-f'];
const verdict = total >= 85 ? 'Production-grade.' : total >= 70 ? 'Solid; ship after a short list.' : total >= 55 ? 'Works, but notable gaps — not production-safe without work.' : total >= 40 ? 'Significant defects — substantial rework before deploy.' : 'Critical/systemic failures — do not deploy.';
const band = (s) => (s >= 85 ? 'g-a' : s >= 70 ? 'g-b' : s >= 55 ? 'g-c' : s >= 40 ? 'g-d' : 'g-f');
const sevBadge = { crit: 'b-crit', high: 'b-high', med: 'b-med', low: 'b-low', info: 'b-info' };
const sevLabel = { crit: 'CRIT', high: 'HIGH', med: 'MED', low: 'LOW', info: 'INFO' };
const statusPill = { fixed: ['p-fixed', 'Fixed'], open: ['p-open', 'Open'], partial: ['p-partial', 'Partial'] };

const metrics = (d.metrics || []).map((m) => `<div class="metric"><div class="n">${esc(m.n)}</div><div class="l">${esc(m.l)}</div></div>`).join('');
const dimRows = dims.map((x) => { const sc = clamp(num(x.score)); return `<tr><td>${esc(x.name)}</td><td>${num(x.weight)}%</td><td><span class="bartrack"><span class="num" style="width:34px;display:inline-block">${sc}</span><span class="sc-bar ${band(sc)}" style="width:${sc}%"></span></span></td><td class="small muted">${esc(x.note)}</td></tr>`; }).join('');
const critRows = (d.critical || []).map((c) => { const [pc, pl] = statusPill[c.status] || ['p-open', esc(c.status)]; return `<tr><td><strong>${esc(c.title)}</strong></td><td>${esc(c.area)}</td><td>${esc(c.impact)}</td><td><span class="pill ${pc}">${pl}</span></td></tr>`; }).join('');
const fixRows = (d.fixes || []).map((f) => `<tr><td>${esc(f.title)}</td><td><span class="badge ${sevBadge[f.sev] || 'b-info'}">${sevLabel[f.sev] || 'INFO'}</span></td><td class="small muted">${esc(f.evidence)}</td></tr>`).join('');
const nextItems = (d.next || []).map((n) => `<li>${esc(n)}</li>`).join('');
const tags = (d.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');

process.stdout.write(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.project || 'Repo')} — Deep Review Scorecard</title>
<style>
:root{--ink:#0f172a;--muted:#475569;--line:#e2e8f0;--primary:#2563eb;--card:#fff;--bgpage:#f8fafc}
*{box-sizing:border-box}body{margin:0;font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bgpage)}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px 64px}
header{background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff;padding:40px 0 32px;margin-bottom:28px}
header .wrap{padding:0 20px}h1{margin:0 0 6px;font-size:30px;letter-spacing:-.5px}.sub{color:#cbd5e1}
.tag{display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:2px 10px;font-size:12px;margin:10px 6px 0 0}
h2{font-size:20px;margin:38px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--line)}h3{font-size:14px;margin:18px 0 6px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:-44px}
.metric{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.metric .n{font-size:30px;font-weight:700;color:var(--primary);line-height:1}.metric .l{color:var(--muted);font-size:13px;margin-top:6px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:14px 0;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.card.system{background:#0f172a;color:#fff;border-color:#0f172a}.card.system .muted{color:#cbd5e1}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}tr:last-child td{border-bottom:none}
.badge{display:inline-block;border-radius:6px;padding:1px 8px;font-size:12px;font-weight:600;color:#fff}
.b-crit{background:#b60205}.b-high{background:#d93f0b}.b-med{background:#d97706}.b-low{background:#16a34a}.b-info{background:#0ea5e9}
.pill{display:inline-block;border-radius:999px;padding:1px 9px;font-size:12px;font-weight:600}
.p-fixed{background:#dcfce7;color:#166534}.p-open{background:#fee2e2;color:#991b1b}.p-partial{background:#fef3c7;color:#92400e}
.grade{display:inline-block;font-size:15px;font-weight:700;border-radius:8px;padding:2px 12px;color:#fff}
.g-a{background:#16a34a}.g-b{background:#65a30d}.g-c{background:#d97706}.g-d{background:#d93f0b}.g-f{background:#b60205}
.score{font-size:52px;font-weight:800;line-height:1;margin:6px 0}.label{font-size:13px;color:#cbd5e1;font-weight:600}
.bartrack{display:flex;align-items:center;gap:8px;min-width:120px}.sc-bar{height:8px;border-radius:4px;display:inline-block}
.num{font-variant-numeric:tabular-nums;font-weight:700}.small{font-size:13px}.muted{color:var(--muted)}ul{margin:6px 0;padding-left:20px}
.foot{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
</style></head><body>
<header><div class="wrap"><h1>${esc(d.project || 'Repo')} — Deep Review Scorecard</h1>
<div class="sub">${esc(d.subtitle || 'Enterprise deep review: security, sync, data, API, code-quality, tests, UX.')}</div>
<div>${tags}${d.date ? `<span class="tag">${esc(d.date)}</span>` : ''}</div></div></header>
<div class="wrap">
${metrics ? `<div class="metrics">${metrics}</div>` : ''}
<h2>Overall score</h2>
<div class="card system"><div style="display:flex;align-items:center;gap:26px;flex-wrap:wrap">
<div style="text-align:center;min-width:150px"><div class="label">${esc(d.scopeNote || 'whole system')}</div>
<div class="score">${total}<span style="font-size:22px;color:#94a3b8">/100</span></div><span class="grade ${grade[1]}">Grade ${grade[0]}</span></div>
<div style="flex:1;min-width:240px"><div style="font-size:17px;font-weight:700;margin-bottom:4px">${esc(verdict)}</div>
<div class="small muted">Score is <strong>as-built</strong>. Security &amp; data-integrity scored as the weakest component, not an average.${d.remediatedNote ? ' ' + esc(d.remediatedNote) : ''}</div></div></div></div>
<h2>Scorecard (weighted)</h2><div class="card"><table>
<tr><th>Dimension</th><th>Weight</th><th style="min-width:170px">As-built</th><th>Driver</th></tr>
${dimRows}
<tr style="border-top:2px solid var(--line)"><td><strong>Weighted total</strong></td><td><strong>${num(weightSum)}%</strong></td><td><span class="num" style="font-size:18px">${total} / 100</span> <span class="grade ${grade[1]}" style="font-size:12px">${grade[0]}</span></td><td class="small muted">Single system score.</td></tr>
</table></div>
${critRows ? `<h2>Critical findings</h2><div class="card" style="border-left:5px solid #b60205;background:#fef2f2"><table><tr><th>Finding</th><th>Area</th><th>Impact</th><th>Status</th></tr>${critRows}</table></div>` : ''}
${fixRows ? `<h2>Fixes shipped</h2><div class="card"><table><tr><th>Fix</th><th>Sev</th><th>Evidence</th></tr>${fixRows}</table></div>` : ''}
${nextItems ? `<h2>Recommended next steps</h2><div class="card"><ol>${nextItems}</ol></div>` : ''}
<div class="foot">Generated by repo-review/generate-report.mjs${d.date ? ' · ' + esc(d.date) : ''}. Automated + LLM-assisted review; not a substitute for human sign-off on Critical findings.</div>
</div></body></html>
`);
