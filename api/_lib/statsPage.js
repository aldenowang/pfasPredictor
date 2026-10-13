// Renders the private usage dashboard (/api/stats?key=...) as a readable HTML page.

const esc = (v) =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmt = (n) => Number(n).toLocaleString("en-US");

function shortDay(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Clean axis maximum and ticks (0, step, 2*step, ...).
function niceScale(max) {
  if (max <= 4) return { top: Math.max(max, 1) <= 2 ? 2 : 4, step: 1 };
  const raw = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { top: Math.ceil(max / step) * step, step };
}

// Single-series column chart (oldest day on the left), rendered as inline SVG.
function columnChart(days, field, label) {
  const W = 600, H = 200, padL = 34, padR = 6, padT = 12, padB = 26;
  const data = [...days].reverse();
  const max = Math.max(0, ...data.map((d) => d[field]));
  const { top, step } = niceScale(max);
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / data.length;
  const barW = Math.min(24, slot - 2); // 2px surface gap between neighbours
  const y = (v) => padT + plotH - (v / top) * plotH;

  let grid = "";
  for (let v = 0; v <= top; v += step) {
    grid += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
    grid += `<text x="${padL - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${fmt(v)}</text>`;
  }

  let bars = "", xLabels = "";
  data.forEach((d, i) => {
    const x = padL + i * slot + (slot - barW) / 2;
    const v = d[field];
    const h = (v / top) * plotH;
    const tip = `${shortDay(d.day)}: ${fmt(v)} ${label}`;
    if (v > 0) {
      const r = Math.min(4, h, barW / 2);
      const yTop = y(v), yBase = padT + plotH;
      // rounded data-end, square at the baseline
      bars += `<path class="bar" d="M${x},${yBase} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yBase} Z"/>`;
    }
    // hit target: the whole column slot, bigger than the mark
    bars += `<rect class="hit" x="${padL + i * slot}" y="${padT}" width="${slot}" height="${plotH}" tabindex="0" data-tip="${esc(tip)}"><title>${esc(tip)}</title></rect>`;
    if ((i % 5 === 0 && i <= data.length - 4) || i === data.length - 1) {
      const last = i === data.length - 1, first = i === 0;
      const lx = first ? padL : last ? padL + plotW : padL + i * slot + slot / 2;
      const anchor = first ? "start" : last ? "end" : "middle";
      xLabels += `<text x="${lx}" y="${H - 8}" class="tick" text-anchor="${anchor}">${esc(shortDay(d.day))}</text>`;
    }
  });

  return `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} per day, last ${data.length} days">
    ${grid}<line x1="${padL}" x2="${W - padR}" y1="${padT + plotH}" y2="${padT + plotH}" class="axis"/>
    ${bars}${xLabels}</svg></div>`;
}

function speciesBars(bySpecies) {
  const rows = Object.entries(bySpecies);
  if (!rows.length) return `<p class="empty">No predictions yet.</p>`;
  const max = Math.max(...rows.map(([, n]) => n));
  return `<ul class="species">${rows
    .map(([name, n]) => `<li><span class="sp-name">${esc(name)}</span><span class="sp-track"><span class="sp-bar" style="width:${Math.max(2, (n / max) * 100)}%"></span></span><span class="sp-val">${fmt(n)}</span></li>`)
    .join("")}</ul>`;
}

export function renderStatsPage(stats) {
  const t = stats.totals;
  const days = stats.lastDaysUTC;
  const tiles = [
    ["People who visited", t.uniqueVisitors, "Each browser counts once, no matter how many times it comes back."],
    ["Page views", t.pageViews, "Every time the main page is opened, including repeat visits."],
    ["Predictions made", t.predictions, "Every time someone pressed Estimate PFAS and got a result."],
    ["People who made a prediction", t.usersWhoPredicted, "Visitors who used the tool at least once."],
  ];
  const tableRows = days
    .map((d) => `<tr><td>${esc(shortDay(d.day))}</td><td>${fmt(d.uniqueVisitors)}</td><td>${fmt(d.pageViews)}</td><td>${fmt(d.predictions)}</td><td>${fmt(d.usersWhoPredicted)}</td></tr>`)
    .join("");
  const updated = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ForeverCatch usage</title>
<style>
  :root { --ink:#1c2733; --muted:#5b6876; --line:#e3e7ec; --surface:#ffffff; --bg:#f3f5f8; --accent:#1a4480; color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 "Public Sans",-apple-system,"Segoe UI",Roboto,Arial,sans-serif; }
  main { max-width: 900px; margin: 0 auto; padding: 32px 16px 48px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 24px; }
  .tiles { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; margin-bottom: 24px; }
  .tile { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:16px; }
  .tile .label { font-size:.9rem; color:var(--muted); }
  .tile .value { font-size:2.2rem; font-weight:600; line-height:1.2; margin:4px 0; font-variant-numeric: tabular-nums; }
  .tile .hint { font-size:.8rem; color:var(--muted); }
  .tile.hero .value { font-size:3rem; }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:18px 18px 12px; margin-bottom:16px; }
  .card h2 { font-size:1.05rem; margin:0 0 2px; }
  .card .note { color:var(--muted); font-size:.85rem; margin:0 0 10px; }
  .charts { display:block; }
  .chart-wrap { overflow-x:auto; }
  .chart-wrap svg { min-width: 520px; }
  svg { width:100%; height:auto; display:block; overflow:visible; }
  .grid { stroke: var(--line); stroke-width:1; }
  .axis { stroke: #c9d0d8; stroke-width:1; }
  .tick { fill: var(--muted); font-size: 12px; }
  .bar { fill: var(--accent); }
  .hit { fill: transparent; cursor: default; outline: none; }
  .hit:hover, .hit:focus { fill: rgba(26,68,128,.07); }
  #tip { position:fixed; pointer-events:none; background:var(--ink); color:#fff; font-size:.82rem; padding:5px 9px; border-radius:6px; white-space:nowrap; transform:translate(-50%, calc(-100% - 10px)); }
  .species { list-style:none; margin:0; padding:0; }
  .species li { display:grid; grid-template-columns: 11em 1fr 3em; align-items:center; gap:10px; padding:5px 0; }
  .sp-name { font-size:.9rem; overflow-wrap:anywhere; }
  .sp-track { height:12px; }
  .sp-bar { display:block; height:12px; background:var(--accent); border-radius:0 4px 4px 0; }
  .sp-val { text-align:right; font-variant-numeric: tabular-nums; color:var(--muted); font-size:.9rem; }
  .empty { color:var(--muted); margin:4px 0 8px; }
  details summary { cursor:pointer; font-weight:600; }
  .table-wrap { overflow-x:auto; }
  table { border-collapse:collapse; width:100%; font-size:.88rem; margin-top:10px; }
  th, td { text-align:right; padding:6px 10px; border-bottom:1px solid var(--line); font-variant-numeric: tabular-nums; }
  th:first-child, td:first-child { text-align:left; }
  th { color:var(--muted); font-weight:600; }
  dl { margin:0; } dt { font-weight:600; margin-top:8px; } dd { margin:2px 0 0; color:var(--muted); font-size:.9rem; }
  footer { color:var(--muted); font-size:.8rem; margin-top:16px; }
  @media (max-width: 720px) { .tiles { grid-template-columns: 1fr 1fr; } .tile.hero .value { font-size:2.4rem; } }
</style>
</head>
<body>
<main>
  <h1>ForeverCatch usage</h1>
  <p class="sub">Private stats since counting started. Only people with your key can see this page.</p>

  <div class="tiles">
    ${tiles.map(([label, value, hint], i) => `<div class="tile${i === 0 ? " hero" : ""}"><div class="label">${label}</div><div class="value">${fmt(value)}</div><div class="hint">${hint}</div></div>`).join("")}
  </div>

  <div class="charts">
    <section class="card">
      <h2>Visitors per day</h2>
      <p class="note">Different people each day, last ${days.length} days</p>
      ${columnChart(days, "uniqueVisitors", "visitors")}
    </section>
    <section class="card">
      <h2>Predictions per day</h2>
      <p class="note">Results shown, last ${days.length} days</p>
      ${columnChart(days, "predictions", "predictions")}
    </section>
  </div>

  <section class="card">
    <h2>Predictions by species</h2>
    <p class="note">Which fish people check most</p>
    ${speciesBars(stats.predictionsBySpecies)}
  </section>

  <section class="card">
    <details>
      <summary>Daily numbers (table)</summary>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Day</th><th>Visitors</th><th>Page views</th><th>Predictions</th><th>People predicting</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </details>
  </section>

  <section class="card">
    <h2>What these numbers mean</h2>
    <dl>
      <dt>People who visited</dt><dd>Each browser gets an anonymous random ID the first time it opens the site, so a person counts once even if they come back many times. The same person on a phone and a laptop counts as two.</dd>
      <dt>Page views</dt><dd>Every load of the main page, including refreshes and repeat visits.</dd>
      <dt>Predictions made</dt><dd>Each result shown. One person checking three fish counts as three.</dd>
      <dt>Days</dt><dd>Days run midnight to midnight UTC, which is 8 p.m. to 8 p.m. Eastern during daylight saving time.</dd>
    </dl>
  </section>

  <footer>Updated ${esc(updated)} UTC. Refresh the page for the latest numbers. Raw data: add <code>&amp;format=json</code> to this link.</footer>
</main>
<div id="tip" hidden></div>
<script>
  (function () {
    // On narrow screens the charts scroll sideways: start at the most recent days.
    document.querySelectorAll(".chart-wrap").forEach(function (w) { w.scrollLeft = w.scrollWidth; });
    var tip = document.getElementById("tip");
    function show(el, x, y) { tip.textContent = el.getAttribute("data-tip"); tip.style.left = x + "px"; tip.style.top = y + "px"; tip.hidden = false; }
    document.querySelectorAll(".hit").forEach(function (el) {
      var t = el.querySelector("title"); if (t) t.remove(); // custom tooltip replaces the native one
      el.addEventListener("pointermove", function (e) { show(el, e.clientX, e.clientY); });
      el.addEventListener("pointerleave", function () { tip.hidden = true; });
      el.addEventListener("focus", function () { var r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top + 20); });
      el.addEventListener("blur", function () { tip.hidden = true; });
    });
  })();
</script>
</body>
</html>`;
}
