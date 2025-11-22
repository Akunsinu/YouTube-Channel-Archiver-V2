require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Scheduler = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
const videosRoutes = require('./routes/videos');
const syncRoutes = require('./routes/sync');
const channelsRoutes = require('./routes/channels');

app.use('/api/videos', videosRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/channels', channelsRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize scheduler
const scheduler = new Scheduler();
app.set('scheduler', scheduler);

// Start daily sync scheduler
const CRON_SCHEDULE = process.env.SYNC_CRON || '0 2 * * *'; // Default: 2 AM daily
scheduler.startDailySync(CRON_SCHEDULE);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  scheduler.stopAll();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  scheduler.stopAll();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`YouTube Archiver Backend running on port ${PORT}`);
  console.log(`Scheduled sync: ${CRON_SCHEDULE}`);
  console.log(`YouTube Channel ID: ${process.env.YOUTUBE_CHANNEL_ID}`);
});

module.exports = app;
