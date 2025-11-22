const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * POST /api/sync/trigger - Trigger a manual sync
 */
router.post('/trigger', async (req, res) => {
  try {
    const { syncType = 'incremental' } = req.body;

    // Get scheduler from app context
    const scheduler = req.app.get('scheduler');

    if (!scheduler) {
      return res.status(500).json({ error: 'Scheduler not initialized' });
    }

    // Don't wait for sync to complete, run in background
    scheduler.triggerManualSync(syncType)
      .then(result => {
        console.log('Manual sync completed:', result);
      })
      .catch(error => {
        console.error('Manual sync error:', error);
      });

    res.json({
      message: `${syncType} sync started`,
      syncType
    });
  } catch (error) {
    console.error('Error triggering sync:', error);
    res.status(500).json({ error: 'Failed to trigger sync' });
  }
});

/**
 * GET /api/sync/status - Get latest sync status
 */
router.get('/status', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM sync_log
       ORDER BY started_at DESC
       LIMIT 10`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching sync status:', error);
    res.status(500).json({ error: 'Failed to fetch sync status' });
  }
});

/**
 * GET /api/sync/progress - Get current sync progress
 */
router.get('/progress', async (req, res) => {
  try {
    const runningSync = await db.query(
      `SELECT * FROM sync_log
       WHERE status = 'running'
       ORDER BY started_at DESC
       LIMIT 1`
    );

    if (runningSync.rows.length === 0) {
      return res.json({ running: false });
    }

    res.json({
      running: true,
      sync: runningSync.rows[0]
    });
  } catch (error) {
    console.error('Error fetching sync progress:', error);
    res.status(500).json({ error: 'Failed to fetch sync progress' });
  }
});

/**
 * POST /api/sync/cancel - Cancel a running sync
 */
router.post('/cancel', async (req, res) => {
  try {
    const { channelId } = req.body;

    // Get sync service from app context
    const syncService = req.app.get('syncService');

    if (!syncService) {
      return res.status(500).json({ error: 'Sync service not initialized' });
    }

    // Set cancellation flag
    syncService.cancelSync(channelId);

    // Update any running sync logs to cancelled
    if (channelId) {
      await db.query(
        `UPDATE sync_log
         SET status = 'cancelled',
             completed_at = CURRENT_TIMESTAMP,
             errors = 'Cancelled by user'
         WHERE channel_id = $1 AND status = 'running'`,
        [channelId]
      );
    } else {
      await db.query(
        `UPDATE sync_log
         SET status = 'cancelled',
             completed_at = CURRENT_TIMESTAMP,
             errors = 'Cancelled by user'
         WHERE status = 'running'`
      );
    }

    res.json({ message: 'Sync cancellation requested' });
  } catch (error) {
    console.error('Error cancelling sync:', error);
    res.status(500).json({ error: 'Failed to cancel sync' });
  }
});

module.exports = router;
