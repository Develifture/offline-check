import { diagnose, PHASES, PHASE_LABEL, PLAIN } from './diagnose.js';
import { issues, plural, type Issue, type RenderInput, type Row } from './render.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Escape, then turn `code` spans into <code>. */
const rich = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

const VERDICT = { passed: 'Works', failed: 'Broke', unverified: 'Not checked', skipped: 'Not checked' } as const;
/** Project label (browser or device) when a run covers more than one, else empty. */
let where = (_r: Row) => '';

/* ---------- the signal trace: high line = online, low line = offline, a tear where the app broke ---------- */

const X0 = 46, STEP = 107, Y_ON = 24, Y_OFF = 60;
const xs = (i: number) => X0 + i * STEP;

function trace(r: Row, row: number): string {
  const phases = PHASES[r.scenario];
  const cut = phases.indexOf('disconnect');
  const level = (i: number) => (i > cut && phases[i] !== 'reconnect' ? Y_OFF : Y_ON);
  const stopped = !!r.limitation; // the test tool, not the app, stopped here
  const reached = r.status === 'passed' ? phases.length - 1 : r.status === 'failed' || stopped ? Math.max(0, phases.indexOf(r.phase)) : -1;
  const failed = r.status === 'failed';
  // each hop: flat, then a slope to the next level, then flat into the station
  const hop = (a: number) => {
    const x1 = xs(a), x2 = xs(a + 1), w = x2 - x1;
    return `L${x1 + w * 0.38} ${level(a)} L${x1 + w * 0.62} ${level(a + 1)} L${x2} ${level(a + 1)}`;
  };
  const path = (from: number, to: number) => from >= to ? '' : `M${xs(from)} ${level(from)} ` + Array.from({ length: to - from }, (_, k) => hop(from + k)).join(' ');
  const last = phases.length - 1;
  const doneTo = Math.max(reached, 0);
  const offStart = xs(cut) + STEP * 0.38;
  const back = phases.indexOf('reconnect');
  const offEnd = back > 0 ? xs(back - 1) + STEP * 0.62 : xs(last) + 22;

  const nodes = phases.map((p, i) => {
    const x = xs(i), y = level(i);
    if (failed && i === reached) {
      return `<g class="tear"><circle class="halo" cx="${x}" cy="${y}" r="17"/><circle class="bad" cx="${x}" cy="${y}" r="10"/><path class="x" d="M${x - 4} ${y - 4}L${x + 4} ${y + 4}M${x + 4} ${y - 4}L${x - 4} ${y + 4}"/></g>`;
    }
    if (stopped && i === reached) {
      return `<g class="tear"><circle class="halo-q" cx="${x}" cy="${y}" r="16"/><circle class="q" cx="${x}" cy="${y}" r="10"/><text class="qm" x="${x}" y="${y + 4.5}">?</text></g>`;
    }
    const cls = reached >= 0 && i <= reached ? 'ok' : 'idle';
    return `<circle class="${cls}" cx="${x}" cy="${y}" r="5.5"/>`;
  }).join('');
  const labels = phases.map((p, i) => `<text x="${xs(i)}" y="92" class="${failed && i === reached ? 'lbl bad' : stopped && i === reached ? 'lbl stop' : reached >= 0 && i <= reached ? 'lbl' : 'lbl idle'}">${esc(PHASE_LABEL[p] ?? p)}</text>`).join('');
  const desc = r.status === 'failed' ? `Broke at "${PHASE_LABEL[r.phase] ?? r.phase}"` : stopped ? `Test tool could not run "${PHASE_LABEL[r.phase] ?? r.phase}"` : VERDICT[r.status];
  return `<svg class="trace" viewBox="0 0 ${xs(6) + 50} 100" role="img" aria-label="${esc(PLAIN[r.scenario])}: ${esc(desc)}" style="--row:${row}">
<rect class="band" x="${offStart}" y="8" width="${offEnd - offStart}" height="68" rx="6"/><text class="band-lbl" x="${offStart + 8}" y="20">no network</text>
<path class="ghost" d="${path(0, last)}"/>
<path class="done" pathLength="1" d="${path(0, doneTo)}"/>
${nodes}${labels}</svg>`;
}

function signal(rows: Row[]): string {
  return `<ol class="traces">${rows.map((r, i) => `<li class="trace-row ${r.status}">
<div class="trace-name"><b>${esc(PLAIN[r.scenario])}</b>${where(r) ? `<span class="dev">${esc(where(r))}</span>` : ''}<code>${esc(r.scenario)}</code></div>
<div class="trace-wrap">${trace(r, i)}</div>
<span class="verdict ${r.status}">${r.limitation ? 'Not testable' : VERDICT[r.status]}</span></li>`).join('\n')}</ol>`;
}

/* ---------- fixes ---------- */

/** Dim comments in a snippet. Runs on escaped text, line by line. */
const tint = (code: string) => esc(code).split('\n').map((line) => {
  const at = line.search(/(^|\s)\/\/\s/);
  return at < 0 ? line : `${line.slice(0, at)}<span class="cm">${line.slice(at)}</span>`;
}).join('\n');

function evidence(r: Row): string {
  const list = (label: string, xs: string[]) => xs.length ? `<dt>${label}</dt>${xs.map((x) => `<dd><code>${esc(x)}</code></dd>`).join('')}` : '';
  return `<details><summary><b>${esc(r.scenario)}</b> <span>${r.status === 'failed' ? `broke at ${esc(PHASE_LABEL[r.phase] ?? r.phase)}` : esc(VERDICT[r.status].toLowerCase())}</span></summary>
<dl>${r.status === 'failed' ? `<dt>Failed phase</dt><dd><code>${esc(r.phase)}</code></dd>` : ''}${r.error ? `<dt>Error</dt><dd><code>${esc(r.error)}</code></dd>` : ''}${list('Requests that failed', r.failedRequests)}${list('Console errors', r.consoleErrors)}${list('Page errors', r.pageErrors)}
<dt>Steps completed</dt>${(r.exercised.length ? r.exercised : ['none']).map((x) => `<dd>${esc(x)}</dd>`).join('')}
${r.swRegistered !== undefined ? `<dt>Service worker registered</dt><dd>${r.swRegistered ? 'Yes' : 'No'}</dd>` : ''}${r.serviceWorker ? `<dt>Service worker on the offline load</dt><dd>${r.serviceWorker === 'controlled' ? 'Yes' : 'No'}</dd>` : ''}</dl></details>`;
}

function fix({ d, rows }: Issue, n: number, { rerun, image }: RenderInput): string {
  const shotRow = rows.find((r) => r.screenshot);
  const img = shotRow?.screenshot ? image(shotRow.screenshot) : undefined;
  const id = `fix-${n}`;
  return `<article class="fix ${d.severity}" id="${id}" aria-labelledby="${id}-h">
<div class="rail"><span class="num">${n}</span><span class="sev">${d.severity === 'fail' ? 'Must fix' : d.severity === 'warn' ? 'Should fix' : 'No action'}</span></div>
<div class="fix-body">
<h3 id="${id}-h">${rich(d.title)}</h3>
<ul class="breaks" aria-label="${d.severity === 'fail' ? 'Breaks' : 'Affects'}">${rows.map((r) => `<li>${esc(PLAIN[r.scenario])}${where(r) ? `, ${esc(where(r))}` : ''}</li>`).join('')}</ul>
<div class="why">
<section><h4>What happened</h4><p>${rich(d.happened)}</p></section>
<section><h4>Why</h4><p>${rich(d.cause)}</p></section>
</div>
${d.severity === 'info' ? `<h4 class="todo-h">What this means</h4><ul class="notes">${d.steps.map((s) => `<li>${rich(s)}</li>`).join('')}</ul>` : `<h4 class="todo-h">How to fix it</h4>
<ol class="todo">${d.steps.map((s) => `<li><label><input type="checkbox" aria-describedby="${id}-h"><span>${rich(s)}</span></label></li>`).join('')}</ol>`}
${d.snippet ? `<figure class="code"><figcaption><span class="file">${esc(d.snippet.name)}</span><span class="hint">starting point, adapt to your app</span><button type="button" class="copy" data-for="${id}-code">Copy</button></figcaption><pre id="${id}-code"><code>${tint(d.snippet.code)}</code></pre></figure>` : ''}
<div class="proof${img ? ' has-shot' : ''}">
${img ? `<figure class="shot"><img src="${img}" alt="The page when ${esc(PLAIN[shotRow!.scenario].toLowerCase())} broke"><figcaption>The page when it broke. Inputs and the test value are masked.</figcaption></figure>` : ''}
<div class="evidence"><h4>Evidence</h4>${rows.map(evidence).join('')}</div>
</div>
${d.severity === 'fail' ? `<div class="rerun"><span class="rerun-lbl">Check the fix</span><code id="${id}-run">${esc(rerun(rows[0].file))}</code><button type="button" class="copy" data-for="${id}-run">Copy</button></div>` : ''}
</div>
</article>`;
}

function headline(rows: Row[], list: Issue[]) {
  const failed = rows.filter((r) => r.status === 'failed').length;
  const open = rows.filter((r) => (r.status === 'unverified' || r.status === 'skipped') && !r.limitation).length;
  const fixes = list.filter((i) => i.d.severity === 'fail').length;
  if (failed) return { tone: 'failed', h1: list[0].d.title + '.', sub: `${failed} of ${rows.length} offline checks broke. ${fixes === 1 ? 'They share one cause, so one fix covers them.' : `There are ${fixes} separate causes. Fix them in the order below.`}` };
  if (open) return { tone: 'warn', h1: 'Some checks never ran.', sub: `${open} of ${rows.length} checks need more setup in the spec before they can pass.` };
  const warns = list.filter((i) => i.d.severity === 'warn').length;
  if (warns) return { tone: 'warn', h1: 'Works offline, with a caveat.', sub: `All checks that ran passed. ${plural(warns, 'thing')} below could still fail for real users.` };
  if (list.length) return { tone: 'passed', h1: 'Works offline.', sub: `Every check that could run passed. ${plural(rows.length - rows.filter((r) => r.status === 'passed').length, 'check')} could not run because of a test-tool limit; see the note below.` };
  return { tone: 'passed', h1: 'Works offline.', sub: `All ${rows.length} checks passed. The app opens, keeps data and recovers with no network.` };
}

const CSS = `
:root{
  --navy:#0d1b45;--navy-2:#15275c;--navy-3:#1d3270;--ice:#b4c8ff;--ice-dim:#7187c2;--ice-faint:rgba(180,200,255,.09);
  --pink:#ff4f86;--mint:#43dba0;--gold:#ffbd4a;
  --paper:#f5f6fa;--card:#fff;--ink:#0d1b45;--soft:#58627d;--rule:#dde1ec;--tick:#eef1f8;
  --bad:#c2185b;--good:#0e7a55;--warn:#935800;color-scheme:light}
@media (prefers-color-scheme:dark){:root{
  --paper:#0a1128;--card:#101a38;--ink:#e7ecfb;--soft:#98a4c6;--rule:#233163;--tick:#16224a;
  --bad:#ff6f9c;--good:#4fe0a8;--warn:#ffc15e;color-scheme:dark}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif}
.wrap{max-width:70rem;margin:0 auto;padding:0 clamp(1rem,4vw,2.5rem)}
h1,h2,h3,.num,.verdict,.wordmark{font-family:Bahnschrift,"DIN Alternate","Barlow Semi Condensed","Roboto Condensed","Arial Narrow",sans-serif;font-stretch:87.5%;font-weight:600}
code,pre{font-family:"Cascadia Mono","Cascadia Code",Consolas,ui-monospace,monospace;font-variant-ligatures:none}
:focus-visible{outline:3px solid var(--pink);outline-offset:3px;border-radius:3px}
a{color:inherit;text-underline-offset:3px}

/* hero */
.hero{background:var(--navy);color:#fff;padding:1.4rem 0 2.2rem;position:relative;overflow:hidden}
.hero::before{content:"";position:absolute;inset:0;background:radial-gradient(60rem 22rem at 85% -10%,rgba(120,150,255,.16),transparent 70%);pointer-events:none}
.bar{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;position:relative}
.wordmark{display:flex;align-items:center;gap:.5rem;font-size:1.15rem;letter-spacing:.02em}
.wordmark svg{width:1.4rem;height:1rem}
.run{font-size:.85rem;color:var(--ice-dim);text-align:right}.run b{color:var(--ice);font-weight:600}
.hero h1{position:relative;font-size:clamp(2.4rem,6.2vw,4.6rem);line-height:.98;letter-spacing:-.015em;margin:3.2rem 0 0;max-width:18ch;text-wrap:balance}
.hero.failed h1{color:#fff}
.lede{position:relative;font-size:clamp(1.05rem,1.8vw,1.25rem);color:var(--ice);max-width:52ch;margin:1.1rem 0 0}
.traces{position:relative;list-style:none;margin:2.6rem 0 0;padding:0;border-top:1px solid rgba(180,200,255,.18)}
.trace-row{display:grid;grid-template-columns:minmax(10rem,15rem) minmax(0,1fr) 6.5rem;gap:1.2rem;align-items:center;padding:.9rem 0;border-bottom:1px solid rgba(180,200,255,.12)}
.trace-name b{display:block;font-weight:600;line-height:1.3}
.trace-name code{font-size:.78rem;color:var(--ice-dim)}
.trace-name .dev{display:inline-block;margin:.15rem .5rem .1rem 0;font-size:.75rem;font-weight:600;color:var(--navy);background:var(--ice);border-radius:4px;padding:0 .4rem}
.trace-wrap{overflow-x:auto;scrollbar-width:thin}
.trace{display:block;width:100%;min-width:34rem;height:auto;overflow:visible}
.trace .band{fill:var(--ice-faint)}
.trace .band-lbl{font:italic 11px "Segoe UI",sans-serif;fill:var(--ice-dim)}
.trace .ghost{fill:none;stroke:var(--ice-dim);stroke-width:1.5;stroke-dasharray:2 5;stroke-linecap:round;opacity:.55}
.trace .done{fill:none;stroke:var(--ice);stroke-width:3;stroke-linejoin:round;stroke-linecap:round}
.trace circle.ok{fill:var(--ice);stroke:var(--navy);stroke-width:3}
.trace circle.idle{fill:var(--navy);stroke:var(--ice-dim);stroke-width:1.5;opacity:.8}
.trace .halo{fill:var(--pink);opacity:.2}
.trace circle.bad{fill:var(--pink)}
.trace .halo-q{fill:var(--gold);opacity:.18}.trace circle.q{fill:var(--gold)}
.trace .qm{font:800 13px "Segoe UI",sans-serif;fill:var(--navy);text-anchor:middle}
.trace .x{stroke:#fff;stroke-width:2.4;stroke-linecap:round}
.trace .lbl{font:12.5px "Segoe UI",sans-serif;fill:var(--ice);text-anchor:middle}
.trace .lbl.idle{fill:var(--ice-dim);opacity:.8}
.trace .lbl.bad{fill:var(--pink);font-weight:700}.trace .lbl.stop{fill:var(--gold);font-weight:700}
.notes{margin:.5rem 0 0;padding-left:1.2rem;max-width:68ch}.notes li{margin:.35rem 0}
.passed .trace .done{stroke:var(--mint)}.passed .trace circle.ok{fill:var(--mint)}
.verdict{justify-self:end;font-size:1.25rem;letter-spacing:.01em}
.verdict::before{display:inline-block;width:1.1em;font-weight:800}
.verdict.passed{color:var(--mint)}.verdict.passed::before{content:"✓"}
.verdict.failed{color:var(--pink)}.verdict.failed::before{content:"✕"}
.verdict.unverified,.verdict.skipped{color:var(--gold)}.verdict.unverified::before,.verdict.skipped::before{content:"?"}
@media (prefers-reduced-motion:no-preference){
  .trace .done{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1.1s cubic-bezier(.6,0,.3,1) forwards;animation-delay:calc(var(--row) * 140ms + 150ms)}
  .trace .tear{opacity:0;animation:pop .35s ease-out forwards;animation-delay:calc(var(--row) * 140ms + 1.1s)}
}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
.trace .tear{transform-box:fill-box;transform-origin:center}

/* body */
.section-h{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin:3.4rem 0 .4rem}
.section-h h2{font-size:clamp(1.8rem,3.2vw,2.4rem);margin:0;line-height:1.1}
.section-h p{margin:0;color:var(--soft)}
.fix{display:grid;grid-template-columns:5.5rem minmax(0,1fr);gap:1.6rem;padding:2.2rem 0 2.6rem;border-top:2px solid var(--ink)}
.fix+.fix{border-top:1px solid var(--rule)}
.rail{display:flex;flex-direction:column;align-items:flex-start;gap:.4rem}
.num{font-size:4.6rem;line-height:.8;color:var(--bad)}
.fix.warn .num{color:var(--warn)}.fix.info .num{color:var(--soft)}.fix.info{border-top-color:var(--rule)}
.sev{font-size:.8rem;font-weight:600;color:var(--soft)}
.fix h3{font-size:clamp(1.6rem,2.8vw,2.15rem);line-height:1.08;margin:0;max-width:26ch}
.breaks{list-style:none;display:flex;flex-wrap:wrap;gap:.4rem;margin:.9rem 0 0;padding:0}
.breaks li{font-size:.82rem;font-weight:600;padding:.2rem .65rem;border-radius:99px;border:1.5px solid var(--bad);color:var(--bad)}
.fix.warn .breaks li{border-color:var(--warn);color:var(--warn)}.fix.info .breaks li{border-color:var(--soft);color:var(--soft)}
.why{display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin:1.8rem 0 0}
.why section{border-left:3px solid var(--rule);padding-left:1rem}
h4{font-size:.95rem;font-weight:700;margin:0 0 .25rem}
.why p{margin:0;max-width:60ch}
main :not(pre)>code{font-size:.88em;background:var(--tick);border:1px solid var(--rule);padding:.02em .35em;border-radius:4px;overflow-wrap:anywhere}
.todo-h{margin-top:2rem}
.todo{list-style:none;margin:.5rem 0 0;padding:0;max-width:68ch}
.todo li{border-top:1px solid var(--rule)}.todo li:last-child{border-bottom:1px solid var(--rule)}
.todo label{display:grid;grid-template-columns:1.4rem 1fr;gap:.8rem;padding:.7rem .2rem;cursor:pointer}
.todo input{width:1.15rem;height:1.15rem;margin:.22rem 0 0;accent-color:var(--bad);cursor:pointer}
.todo input:checked+span{color:var(--soft);text-decoration:line-through;text-decoration-color:var(--soft)}
.code{margin:1.6rem 0 0;border-radius:12px;overflow:hidden;background:var(--navy);color:#dfe7ff;box-shadow:0 1px 0 rgba(13,27,69,.06),0 12px 32px -18px rgba(13,27,69,.55)}
.code figcaption{display:flex;align-items:center;gap:.8rem;padding:.55rem .6rem .55rem 1.1rem;background:var(--navy-2);font-size:.82rem}
.code .file{font-family:"Cascadia Mono",Consolas,monospace;color:#fff;font-weight:600}
.code .hint{color:var(--ice-dim);margin-right:auto}
.code pre{margin:0;padding:1.1rem 1.2rem 1.3rem;overflow:auto;max-height:26rem;font-size:13px;line-height:1.65;tab-size:2}
.code .cm{color:var(--ice-dim);font-style:italic}
.copy{font:600 .8rem "Segoe UI",system-ui,sans-serif;color:#fff;background:var(--navy-3);border:1px solid rgba(180,200,255,.25);border-radius:7px;padding:.35rem .8rem;cursor:pointer}
.copy:hover{border-color:var(--ice)}
.proof{display:grid;gap:1.6rem;margin-top:2rem}
.proof.has-shot{grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);align-items:start}
.shot{margin:0}
.shot img{display:block;width:100%;height:14rem;object-fit:cover;object-position:top left;border-radius:10px;border:1px solid var(--rule);background:#fff}
.shot figcaption{font-size:.8rem;color:var(--soft);margin-top:.5rem}
.evidence details{border-top:1px solid var(--rule)}.evidence details:last-child{border-bottom:1px solid var(--rule)}
.evidence summary{cursor:pointer;padding:.6rem 0;list-style:none;display:flex;gap:.5rem;align-items:baseline}
.evidence summary::-webkit-details-marker{display:none}
.evidence summary::before{content:"+";width:1rem;font-weight:700;color:var(--soft)}
.evidence details[open] summary::before{content:"−"}
.evidence summary span{color:var(--soft)}
.evidence dl{margin:0 0 .9rem;font-size:.9rem}
.evidence dt{font-weight:600;color:var(--soft);margin-top:.6rem;font-size:.82rem}
.evidence dd{margin:.15rem 0 0}
.evidence dd code{white-space:pre-wrap}
.rerun{display:flex;align-items:center;gap:.9rem;flex-wrap:wrap;margin-top:1.8rem;padding:.7rem .7rem .7rem 1.1rem;border-radius:10px;background:var(--navy);color:#fff}
.rerun-lbl{font-size:.8rem;color:var(--ice-dim)}
.rerun code{margin-right:auto;font-size:.9rem;color:#fff;background:none!important;border:0!important;padding:0!important}
.rerun code::before{content:"$ ";color:var(--mint)}
.works{list-style:none;margin:1rem 0 0;padding:0;border-top:2px solid var(--ink)}
.works li{display:flex;gap:.9rem;align-items:baseline;padding:.8rem 0;border-bottom:1px solid var(--rule)}
.works li::before{content:"✓";color:var(--good);font-weight:800}
.works code{margin-left:auto;white-space:nowrap;color:var(--soft);background:none!important;border:0!important}
.handoff{margin:3.4rem 0 0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1rem 2rem;align-items:center;padding:1.6rem 1.8rem;border-radius:14px;background:var(--card);border:1px solid var(--rule)}
.handoff h2{font-size:1.5rem;margin:0}.handoff p{margin:.3rem 0 0;color:var(--soft);max-width:60ch}
.handoff a{justify-self:start;display:inline-block;font-weight:700;text-decoration:none;color:#fff;background:var(--ink);padding:.7rem 1.2rem;border-radius:9px;white-space:nowrap}
@media (prefers-color-scheme:dark){.handoff a{color:var(--paper)}}
footer{margin:3rem 0 4rem;padding-top:1.2rem;border-top:1px solid var(--rule);font-size:.85rem;color:var(--soft);max-width:72ch}
@media (max-width:760px){
  .trace-row{grid-template-columns:minmax(0,1fr) auto;row-gap:.5rem}.trace-wrap{grid-column:1/-1;grid-row:2}
  .fix{grid-template-columns:minmax(0,1fr);gap:.6rem}.rail{flex-direction:row;align-items:baseline;gap:.8rem}.num{font-size:3rem}
  .why,.proof.has-shot,.handoff{grid-template-columns:minmax(0,1fr)}.run{text-align:left}
}
@media print{.hero{-webkit-print-color-adjust:exact;print-color-adjust:exact}.copy{display:none}.fix{break-inside:avoid}}
`;

const LOGO = `<svg viewBox="0 0 28 20" aria-hidden="true"><path d="M1 5h8l3 10h15" fill="none" stroke="#b4c8ff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="15" r="3.2" fill="#ff4f86"/></svg>`;

export function renderHtml(input: RenderInput): string {
  const { rows, generatedAt } = input;
  const projects = new Set(rows.map((r) => r.project));
  where = (r) => (projects.size > 1 ? r.project + (r.device ? ` (${r.device})` : '') : '');
  const list = issues(rows);
  const h = headline(rows, list);
  const urls = [...new Set(rows.map((r) => r.url))];
  const works = rows.filter((r) => r.status === 'passed' && !diagnose(r));
  const when = generatedAt.replace('T', ' ').slice(0, 16) + ' UTC';
  const failing = list.some((i) => i.d.severity === 'fail');
  const warnOnly = !failing && list.some((i) => i.d.severity === 'warn');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${esc(h.h1)} OfflineCheck</title><style>${CSS}</style></head><body>
<header class="hero ${h.tone}"><div class="wrap">
<div class="bar"><span class="wordmark">${LOGO}OfflineCheck</span><span class="run">Tested <b>${urls.map(esc).join(', ')}</b><br>${[...new Set(rows.map((r) => r.browser))].map(esc).join(', ')}, ${esc(when)}</span></div>
<h1>${esc(h.h1)}</h1>
<p class="lede">${esc(h.sub)}</p>
${signal(rows)}
</div></header>
<main class="wrap">
${list.length ? `<div class="section-h"><h2>${failing ? 'What to fix' : warnOnly ? 'Worth a look' : 'Notes'}</h2><p>${failing ? 'In order. Tick steps off as you go.' : warnOnly ? 'Nothing is broken, but these could be.' : 'Nothing to fix.'}</p></div>
${list.map((it, i) => fix(it, i + 1, input)).join('\n')}` : ''}
${works.length ? `<div class="section-h"><h2>What already works</h2></div><ul class="works">${works.map((r) => `<li>${esc(PLAIN[r.scenario])}<code>${esc(r.scenario)}</code></li>`).join('')}</ul>` : ''}
${list.length ? `<aside class="handoff"><div><h2>Handing this to a coding agent?</h2><p>The fix plan has the same diagnosis as a checklist, with the evidence, rules for the agent, and the command that proves the fix.</p></div><a href="fix-plan.md">Open fix-plan.md</a></aside>` : ''}
<footer>OfflineCheck cuts the browser's network and checks what still works. That is strong evidence for this browser and app state, not a guarantee for every device or deployment. Each diagnosis is the likely cause, inferred from the step that broke and the evidence collected there. Raw data: <a href="results.json">results.json</a>.</footer>
</main>
<script>
document.addEventListener('click', (e) => {
  const b = e.target.closest('.copy'); if (!b) return;
  const t = document.getElementById(b.dataset.for).innerText;
  navigator.clipboard.writeText(t).then(() => { b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1500); }, () => { b.textContent = 'Select to copy'; });
});
</script></body></html>`;
}
