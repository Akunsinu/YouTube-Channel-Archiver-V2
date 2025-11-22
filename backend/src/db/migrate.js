require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('Starting database migration...');

    // Run schema migration
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await client.query(schema);

    console.log('Schema migration completed successfully!');

    // Migrate existing channel from environment variables if present
    const channelId = process.env.YOUTUBE_CHANNEL_ID;
    const apiKey = process.env.YOUTUBE_API_KEY;
    const syncSchedule = process.env.SYNC_CRON || '0 2 * * *';

    if (channelId && apiKey) {
      console.log(`Found existing channel configuration in environment variables: ${channelId}`);

      // Check if channel already exists
      const existing = await client.query(
        'SELECT id FROM channel WHERE id = $1',
        [channelId]
      );

      if (existing.rows.length === 0) {
        console.log('Importing channel from environment variables...');

        // Try to fetch channel details using YouTube API
        try {
          const YouTubeAPIService = require('../services/youtube-api');
          const youtubeAPI = new YouTubeAPIService(apiKey);
          const channelDetails = await youtubeAPI.getChannelDetails(channelId);

          await client.query(
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

          console.log(`Successfully imported channel: ${channelDetails.title}`);
        } catch (error) {
          console.error('Failed to fetch channel details from YouTube API:', error.message);
          console.log('Creating channel entry with minimal information...');

          // Insert with minimal data if API call fails
          await client.query(
            `INSERT INTO channel (
              id, title, api_key, sync_enabled, sync_schedule
            ) VALUES ($1, $2, $3, $4, $5)`,
            [channelId, 'Unknown Channel', apiKey, true, syncSchedule]
          );

          console.log('Channel entry created. Metadata will be fetched on first sync.');
        }
      } else {
        console.log('Channel already exists in database. Updating API key and sync schedule...');

        await client.query(
          `UPDATE channel SET api_key = $1, sync_schedule = $2, sync_enabled = true WHERE id = $3`,
          [apiKey, syncSchedule, channelId]
        );

        console.log('Channel configuration updated.');
      }
    } else {
      console.log('No YOUTUBE_CHANNEL_ID and YOUTUBE_API_KEY found in environment variables.');
      console.log('You can add channels via the API: POST /api/channels');
    }

    console.log('\nMigration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
  }
}

runMigration();
