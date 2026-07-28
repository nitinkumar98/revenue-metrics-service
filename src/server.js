require('dotenv').config();
const express = require('express');
const { getSummary, getBreakdown } = require('./metrics/metricsService');

const app = express();

function parseDateRange(req, res) {
  const { start, end } = req.query;
  if (!start || !end) {
    res.status(400).json({ error: 'start and end query params are required (ISO 8601 dates)' });
    return null;
  }
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate) || isNaN(endDate)) {
    res.status(400).json({ error: 'start and end must be valid dates' });
    return null;
  }
  if (endDate <= startDate) {
    res.status(400).json({ error: 'end must be after start' });
    return null;
  }
  return { startDate, endDate };
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/metrics/summary', async (req, res) => {
  const range = parseDateRange(req, res);
  if (!range) return;
  try {
    const result = await getSummary(range.startDate, range.endDate);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to compute summary' });
  }
});

app.get('/metrics/breakdown', async (req, res) => {
  const range = parseDateRange(req, res);
  if (!range) return;
  const granularity = req.query.granularity === 'week' ? 'week' : 'day';
  try {
    const result = await getBreakdown(range.startDate, range.endDate, granularity);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to compute breakdown' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`revenue-metrics-service listening on :${port}`));

module.exports = app;
