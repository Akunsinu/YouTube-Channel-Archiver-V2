const express = require('express');
const router = express.Router();
const db = require('../db');
const YouTubeAPIService = require('../services/youtube-api');

/**
 * GET /api/channels - Get all channels
 */
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, description, custom_url, subscriber_count,
              video_count, view_count, thumbnail_url, sync_enabled,
              sync_schedule, created_at, updated_at
       FROM channel
       ORDER BY created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching channels:', error);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

/**
 * GET /api/channels/:id - Get a specific channel
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT id, title, description, custom_url, subscriber_count,
              video_count, view_count, thumbnail_url, sync_enabled,
              sync_schedule, created_at, updated_at
       FROM channel
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching channel:', error);
    res.status(500).json({ error: 'Failed to fetch channel' });
  }
});

/**
 * POST /api/channels - Add a new channel
 */
router.post('/', async (req, res) => {
  try {
    const { channelId, apiKey, syncSchedule = '0 2 * * *' } = req.body;

    if (!channelId || !apiKey) {
      return res.status(400).json({ error: 'channelId and apiKey are required' });
    }

    // Validate the channel ID and API key by fetching channel details
    const youtubeAPI = new YouTubeAPIService(apiKey);
    let channelDetails;

    try {
      channelDetails = await youtubeAPI.getChannelDetails(channelId);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid channel ID or API key',
        details: error.message
      });
    }

    // Check if channel already exists
    const existing = await db.query(
      'SELECT id FROM channel WHERE id = $1',
      [channelId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Channel already exists' });
    }

    // Insert channel into database
    await db.query(
      `INSERT INTO channel (
        id, title, description, custom_url, subscriber_count,
        video_count, view_count, thumbnail_url, api_key,
        sync_enabled, sync_schedule
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        channelDetails.id, channelDetails.title, channelDetails.description,
        channelDetails.customUrl, channelDetails.subscriberCount,
        channelDetails.videoCount, channelDetails.viewCount,
        channelDetails.thumbnailUrl, apiKey, true, syncSchedule
      ]
    );

    // Get the scheduler and register this channel
    const scheduler = req.app.get('scheduler');
    if (scheduler) {
      await scheduler.registerChannel(channelId);
    }

    res.status(201).json({
      message: 'Channel added successfully',
      channel: {
        id: channelDetails.id,
        title: channelDetails.title,
        customUrl: channelDetails.customUrl,
        syncEnabled: true,
        syncSchedule
      }
    });
  } catch (error) {
    console.error('Error adding channel:', error);
    res.status(500).json({ error: 'Failed to add channel' });
  }
});

/**
 * PUT /api/channels/:id - Update channel settings
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { syncEnabled, syncSchedule, apiKey } = req.body;

    // Check if channel exists
    const existing = await db.query(
      'SELECT id FROM channel WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Build update query dynamically based on provided fields
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (syncEnabled !== undefined) {
      updates.push(`sync_enabled = $${paramCount++}`);
      values.push(syncEnabled);
    }

    if (syncSchedule !== undefined) {
      updates.push(`sync_schedule = $${paramCount++}`);
      values.push(syncSchedule);
    }

    if (apiKey !== undefined) {
      updates.push(`api_key = $${paramCount++}`);
      values.push(apiKey);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);

    await db.query(
      `UPDATE channel SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount}`,
      values
    );

    // Update scheduler if sync settings changed
    const scheduler = req.app.get('scheduler');
    if (scheduler && (syncEnabled !== undefined || syncSchedule !== undefined)) {
      await scheduler.updateChannel(id);
    }

    res.json({ message: 'Channel updated successfully' });
  } catch (error) {
    console.error('Error updating channel:', error);
    res.status(500).json({ error: 'Failed to update channel' });
  }
});

/**
 * DELETE /api/channels/:id - Remove a channel
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if channel exists
    const existing = await db.query(
      'SELECT id FROM channel WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Delete the channel (cascade will delete related videos, comments, sync logs)
    await db.query('DELETE FROM channel WHERE id = $1', [id]);

    // Unregister from scheduler
    const scheduler = req.app.get('scheduler');
    if (scheduler) {
      await scheduler.unregisterChannel(id);
    }

    res.json({ message: 'Channel deleted successfully' });
  } catch (error) {
    console.error('Error deleting channel:', error);
    res.status(500).json({ error: 'Failed to delete channel' });
  }
});

/**
 * POST /api/channels/:id/sync - Trigger sync for a specific channel
 */
router.post('/:id/sync', async (req, res) => {
  try {
    const { id } = req.params;
    const { syncType = 'incremental' } = req.body;

    // Check if channel exists
    const result = await db.query(
      'SELECT id, api_key FROM channel WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const scheduler = req.app.get('scheduler');
    if (!scheduler) {
      return res.status(500).json({ error: 'Scheduler not initialized' });
    }

    // Trigger sync in background
    scheduler.triggerManualSync(syncType, id)
      .then(result => {
        console.log(`Manual sync completed for ${id}:`, result);
      })
      .catch(error => {
        console.error(`Manual sync error for ${id}:`, error);
      });

    res.json({
      message: `${syncType} sync started for channel ${id}`,
      channelId: id,
      syncType
    });
  } catch (error) {
    console.error('Error triggering channel sync:', error);
    res.status(500).json({ error: 'Failed to trigger channel sync' });
  }
});

module.exports = router;
