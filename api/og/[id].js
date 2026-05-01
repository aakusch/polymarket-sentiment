const { ImageResponse } = require('@vercel/og');
const { getDb, withDatabaseConfigError } = require('../_lib/db');
const { computeIndicator } = require('../_lib/compute');

module.exports = withDatabaseConfigError(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { id } = req.query;
  const sql = getDb();

  try {
    const rows = await sql`
      SELECT i.*, u.display_name as creator_name
      FROM indicators i JOIN users u ON i.user_id = u.id
      WHERE i.id = ${id} AND i.is_public = true
    `;

    if (rows.length === 0) {
      return new ImageResponse(
        { type: 'div', props: { style: { display: 'flex', background: '#030712', color: '#6b7280', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', fontSize: 32 }, children: 'Indicator not found' } },
        { width: 1200, height: 630 }
      );
    }

    const indicator = rows[0];
    const result = await computeIndicator(indicator);
    const { latestScore, config, scores, dates } = result;

    const scoreStr = latestScore != null ? latestScore.toFixed(1) : '--';
    const label = latestScore != null
      ? (latestScore >= 80 ? 'Strongly Bullish' : latestScore >= 60 ? 'Bullish' : latestScore >= 40 ? 'Neutral' : latestScore >= 20 ? 'Bearish' : 'Strongly Bearish')
      : 'N/A';

    const scoreColor = latestScore != null
      ? (latestScore >= 60 ? '#4ade80' : latestScore >= 40 ? '#fbbf24' : '#f87171')
      : '#6b7280';

    // Generate mini sparkline as SVG path
    const last60 = scores.slice(-60).filter(s => s != null);
    let sparkPath = '';
    if (last60.length > 1) {
      const w = 400, h = 100;
      const points = last60.map((s, i) => {
        const x = (i / (last60.length - 1)) * w;
        const y = h - ((s / 100) * h);
        return `${x},${y}`;
      });
      sparkPath = 'M' + points.join(' L');
    }

    const image = new ImageResponse(
      {
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            background: '#030712',
            width: '100%',
            height: '100%',
            padding: '60px 80px',
            fontFamily: 'system-ui, sans-serif',
          },
          children: [
            // Header
            {
              type: 'div',
              props: {
                style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '40px' },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: { display: 'flex', flexDirection: 'column' },
                      children: [
                        { type: 'div', props: { style: { fontSize: 42, fontWeight: 600, color: '#e5e7eb' }, children: indicator.name } },
                        { type: 'div', props: { style: { fontSize: 22, color: '#6b7280', marginTop: '8px' }, children: `by ${indicator.creator_name || 'Anonymous'} · ${config.asset}` } },
                      ],
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
                      children: [
                        { type: 'div', props: { style: { fontSize: 64, fontWeight: 700, color: scoreColor }, children: scoreStr } },
                        { type: 'div', props: { style: { fontSize: 22, color: '#9ca3af' }, children: label } },
                      ],
                    },
                  },
                ],
              },
            },
            // Sparkline
            sparkPath ? {
              type: 'svg',
              props: {
                width: 400,
                height: 100,
                viewBox: '0 0 400 100',
                style: { marginTop: '20px' },
                children: [
                  { type: 'path', props: { d: sparkPath, stroke: '#60a5fa', strokeWidth: 3, fill: 'none' } },
                  { type: 'line', props: { x1: 0, y1: 50, x2: 400, y2: 50, stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '4,4' } },
                ],
              },
            } : null,
            // Footer
            {
              type: 'div',
              props: {
                style: { display: 'flex', alignItems: 'center', marginTop: 'auto', gap: '12px' },
                children: [
                  { type: 'div', props: { style: { fontSize: 24, fontWeight: 600, color: '#60a5fa' }, children: 'PMSI' } },
                  { type: 'div', props: { style: { fontSize: 18, color: '#4b5563' }, children: 'Polymarket Sentiment Indicators' } },
                ],
              },
            },
          ].filter(Boolean),
        },
      },
      { width: 1200, height: 630 }
    );

    // Forward the response from ImageResponse
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    const buffer = await image.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('OG image error:', err);
    res.status(500).end();
  }
});

module.exports.config = { runtime: 'edge' };
