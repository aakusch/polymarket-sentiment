const { getDb, withDatabaseConfigError } = require('../_lib/db');
const { computeIndicator } = require('../_lib/compute');

module.exports = withDatabaseConfigError(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { id, theme = 'dark', height = '300' } = req.query;
  const sql = getDb();

  const rows = await sql`
    SELECT i.*, u.display_name as creator_name
    FROM indicators i JOIN users u ON i.user_id = u.id
    WHERE i.id = ${id} AND i.is_public = true
  `;

  if (rows.length === 0) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(404).send('<html><body style="background:#111;color:#888;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh"><p>Indicator not found</p></body></html>');
  }

  const indicator = rows[0];
  let result;
  try {
    result = await computeIndicator(indicator);
  } catch (e) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send('<html><body style="background:#111;color:#888">Error</body></html>');
  }

  const { dates, scores, latestScore } = result;

  // Escape HTML to prevent XSS from indicator names
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const safeName = esc(indicator.name);

  const isDark = theme !== 'light';
  const bg = isDark ? '#030712' : '#ffffff';
  const textColor = isDark ? '#e5e7eb' : '#1f2937';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const tickColor = isDark ? '#6b7280' : '#9ca3af';

  // Downsample to max 200 points
  const maxPts = 200;
  const step = Math.max(1, Math.floor(dates.length / maxPts));
  const chartDates = [], chartScores = [];
  for (let i = 0; i < dates.length; i += step) {
    chartDates.push(dates[i]);
    chartScores.push(scores[i]);
  }

  const label = latestScore != null
    ? (latestScore >= 80 ? 'Strongly Bullish' : latestScore >= 60 ? 'Bullish' : latestScore >= 40 ? 'Neutral' : latestScore >= 20 ? 'Bearish' : 'Strongly Bearish')
    : 'N/A';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:${bg};font-family:system-ui,sans-serif;color:${textColor};overflow:hidden}
.wrap{padding:12px 16px;height:${height}px;display:flex;flex-direction:column}
.header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
.name{font-size:13px;font-weight:500}
.score{font-size:18px;font-weight:700}
.label{font-size:11px;color:${tickColor}}
.chart{flex:1;min-height:0}
.footer{text-align:center;padding:6px 0 2px;font-size:10px}
.footer a{color:${isDark ? '#60a5fa' : '#2563eb'};text-decoration:none}
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
</head>
<body>
<div class="wrap">
<div class="header">
  <span class="name">${safeName}</span>
  <div style="text-align:right">
    <span class="score">${latestScore != null ? latestScore.toFixed(1) : '--'}</span>
    <div class="label">${label}</div>
  </div>
</div>
<div class="chart"><canvas id="c"></canvas></div>
<div class="footer">Powered by <a href="https://pmsi.app/i/${id}" target="_blank">PMSI</a></div>
</div>
<script>
const d=${JSON.stringify(chartDates)};
const s=${JSON.stringify(chartScores)};
new Chart(document.getElementById('c'),{
type:'line',
data:{labels:d.map(x=>{const t=new Date(x+'T00:00:00');return t.toLocaleDateString('en-US',{month:'short',day:'numeric'})}),
datasets:[{data:s,borderColor:'#60a5fa',backgroundColor:'rgba(96,165,250,0.08)',borderWidth:2,fill:true,tension:0.3,pointRadius:0}]},
options:{responsive:true,maintainAspectRatio:false,animation:false,
plugins:{legend:{display:false},tooltip:{mode:'index',intersect:false}},
scales:{y:{min:0,max:100,grid:{color:'${gridColor}'},ticks:{color:'${tickColor}',font:{size:10}}},
x:{grid:{display:false},ticks:{color:'${tickColor}',font:{size:10},maxRotation:0,maxTicksLimit:8}}}}});
</script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'public, s-maxage=300');
  res.send(html);
});
