const cron = require('node-cron');
const SyncService = require('./sync');
const db = require('../db');

class Scheduler {
  constructor() {
    this.syncService = new SyncService();
    this.jobs = new Map(); // Map of channelId -> cron job
  }

  /**
   * Initialize scheduler by loading all enabled channels from database
   */
  async initialize() {
    console.log('Initializing scheduler with channels from database...');

    try {
      const result = await db.query(
        'SELECT id, sync_schedule, api_key FROM channel WHERE sync_enabled = true'
      );

      for (const channel of result.rows) {
        await this.registerChannel(channel.id);
      }

      console.log(`Scheduler initialized with ${result.rows.length} channels`);
    } catch (error) {
      console.error('Error initializing scheduler:', error);
    }
  }

  /**
   * Register a channel for scheduled syncing
   */
  async registerChannel(channelId) {
    try {
      // Get channel details
      const result = await db.query(
        'SELECT id, sync_schedule, api_key, sync_enabled FROM channel WHERE id = $1',
        [channelId]
      );

      if (result.rows.length === 0) {
        console.error(`Channel ${channelId} not found in database`);
        return;
      }

      const channel = result.rows[0];

      if (!channel.sync_enabled) {
        console.log(`Channel ${channelId} sync is disabled, skipping registration`);
        return;
      }

      // Stop existing job if any
      if (this.jobs.has(channelId)) {
        this.jobs.get(channelId).stop();
      }

      const cronTime = channel.sync_schedule || '0 2 * * *';
      console.log(`Scheduling channel ${channelId} with cron: ${cronTime}`);

      const job = cron.schedule(cronTime, async () => {
        console.log(`Starting scheduled incremental sync for ${channelId}...`);
        try {
          await this.syncService.incrementalSync(channelId, channel.api_key);
          console.log(`Scheduled sync completed successfully for ${channelId}`);
        } catch (error) {
          console.error(`Scheduled sync failed for ${channelId}:`, error);
        }
      });

      this.jobs.set(channelId, job);
      console.log(`Channel ${channelId} registered for scheduled syncing`);
    } catch (error) {
      console.error(`Error registering channel ${channelId}:`, error);
    }
  }

  /**
   * Unregister a channel from scheduled syncing
   */
  async unregisterChannel(channelId) {
    if (this.jobs.has(channelId)) {
      this.jobs.get(channelId).stop();
      this.jobs.delete(channelId);
      console.log(`Channel ${channelId} unregistered from scheduled syncing`);
    }
  }

  /**
   * Update a channel's schedule (re-register with new settings)
   */
  async updateChannel(channelId) {
    await this.unregisterChannel(channelId);
    await this.registerChannel(channelId);
  }

  /**
   * Start daily sync at specified time (backward compatibility)
   * This will initialize the scheduler with all channels from the database
   */
  async startDailySync(cronTime = '0 2 * * *') {
    console.log('Starting scheduler (loading channels from database)...');
    await this.initialize();
  }

  /**
   * Trigger manual sync for a specific channel
   */
  async triggerManualSync(syncType = 'incremental', channelId = null) {
    try {
      // If no channelId specified, sync all enabled channels (backward compatibility)
      if (!channelId) {
        console.log(`Triggering manual ${syncType} sync for all enabled channels...`);
        const result = await db.query(
          'SELECT id, api_key FROM channel WHERE sync_enabled = true'
        );

        const results = [];
        for (const channel of result.rows) {
          console.log(`Syncing channel ${channel.id}...`);
          if (syncType === 'full') {
            results.push(await this.syncService.fullSync(channel.id, channel.api_key));
          } else {
            results.push(await this.syncService.incrementalSync(channel.id, channel.api_key));
          }
        }

        return { success: true, channels: results.length };
      }

      // Sync specific channel
      console.log(`Triggering manual ${syncType} sync for channel ${channelId}...`);

      const result = await db.query(
        'SELECT id, api_key FROM channel WHERE id = $1',
        [channelId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Channel ${channelId} not found`);
      }

      const channel = result.rows[0];

      if (syncType === 'full') {
        return await this.syncService.fullSync(channel.id, channel.api_key);
      } else {
        return await this.syncService.incrementalSync(channel.id, channel.api_key);
      }
    } catch (error) {
      console.error('Manual sync failed:', error);
      throw error;
    }
  }

  /**
   * Stop all scheduled jobs
   */
  stopAll() {
    this.jobs.forEach((job, channelId) => {
      job.stop();
      console.log(`Stopped scheduled job for channel ${channelId}`);
    });
    this.jobs.clear();
    console.log('All scheduled jobs stopped');
  }
}

module.exports = Scheduler;
