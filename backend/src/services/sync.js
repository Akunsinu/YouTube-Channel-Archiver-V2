const YouTubeAPIService = require('./youtube-api');
const VideoDownloader = require('./downloader');
const db = require('../db');

class SyncService {
  constructor() {
    this.downloader = new VideoDownloader(process.env.VIDEO_STORAGE_PATH || '/data/videos');
  }

  /**
   * Get YouTube API instance for a specific channel
   */
  getYouTubeAPI(apiKey) {
    return new YouTubeAPIService(apiKey);
  }

  /**
   * Full sync: Download all channel data
   */
  async fullSync(channelId, apiKey) {
    const syncLogId = await this.createSyncLog(channelId, 'full_sync', 'running');
    const youtubeAPI = this.getYouTubeAPI(apiKey);

    try {
      console.log(`Starting full channel sync for ${channelId}...`);

      // 1. Get and save channel details
      const channelDetails = await youtubeAPI.getChannelDetails(channelId);
      await this.saveChannelDetails(channelDetails, apiKey);

      // 2. Get all videos from the channel
      const videos = await youtubeAPI.getAllChannelVideos(channelDetails.uploadsPlaylistId);
      console.log(`Found ${videos.length} videos to process`);

      let processedCount = 0;

      // 3. Process each video
      for (const video of videos) {
        await this.processVideo(video, channelId, youtubeAPI);
        processedCount++;

        if (processedCount % 10 === 0) {
          console.log(`Processed ${processedCount}/${videos.length} videos`);
        }
      }

      // 4. Update sync log
      await this.updateSyncLog(syncLogId, 'completed', processedCount, 0);
      console.log(`Full sync completed successfully for ${channelId}`);

      return { success: true, videosProcessed: processedCount };
    } catch (error) {
      console.error(`Full sync failed for ${channelId}:`, error);
      await this.updateSyncLog(syncLogId, 'failed', 0, 0, error.message);
      throw error;
    }
  }

  /**
   * Process a single video: save metadata, download video, fetch comments
   */
  async processVideo(video, channelId, youtubeAPI) {
    try {
      // Save video metadata
      await this.saveVideoMetadata(video, channelId);

      // Check if video already downloaded
      const existingVideo = await db.query(
        'SELECT file_path, download_status FROM videos WHERE id = $1',
        [video.id]
      );

      if (existingVideo.rows.length > 0 && existingVideo.rows[0].download_status === 'completed') {
        console.log(`Video ${video.id} already downloaded, skipping...`);
      } else {
        // Download the video
        await this.downloadAndSaveVideo(video);
      }

      // Fetch and save comments
      await this.fetchAndSaveComments(video.id, youtubeAPI);
    } catch (error) {
      console.error(`Error processing video ${video.id}:`, error.message);
      // Mark video as failed
      await db.query(
        'UPDATE videos SET download_status = $1 WHERE id = $2',
        ['failed', video.id]
      );
    }
  }

  /**
   * Download video and update database
   */
  async downloadAndSaveVideo(video) {
    // Update status to downloading
    await db.query(
      'UPDATE videos SET download_status = $1 WHERE id = $2',
      ['downloading', video.id]
    );

    const result = await this.downloader.downloadVideo(video.id, video.title);

    if (result.success) {
      await db.query(
        'UPDATE videos SET download_status = $1, file_path = $2, downloaded_at = CURRENT_TIMESTAMP WHERE id = $3',
        ['completed', result.filePath, video.id]
      );
      console.log(`Successfully downloaded: ${video.title}`);
    } else {
      await db.query(
        'UPDATE videos SET download_status = $1 WHERE id = $2',
        ['failed', video.id]
      );
      console.error(`Failed to download: ${video.title}`);
    }
  }

  /**
   * Fetch and save comments for a video
   */
  async fetchAndSaveComments(videoId, youtubeAPI) {
    try {
      const comments = await youtubeAPI.getVideoComments(videoId);

      // Delete existing comments for this video
      await db.query('DELETE FROM comments WHERE video_id = $1', [videoId]);

      // Insert new comments
      for (const comment of comments) {
        await db.query(
          `INSERT INTO comments (
            id, video_id, parent_comment_id, author_name, author_channel_id,
            author_profile_image_url, text_display, text_original, like_count,
            published_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO UPDATE SET
            like_count = EXCLUDED.like_count,
            updated_at = EXCLUDED.updated_at`,
          [
            comment.id, comment.videoId, comment.parentCommentId,
            comment.authorName, comment.authorChannelId,
            comment.authorProfileImageUrl, comment.textDisplay,
            comment.textOriginal, comment.likeCount,
            comment.publishedAt, comment.updatedAt
          ]
        );
      }

      // Update comment count
      await db.query(
        'UPDATE videos SET comment_count = $1 WHERE id = $2',
        [comments.length, videoId]
      );
    } catch (error) {
      console.error(`Error fetching comments for video ${videoId}:`, error.message);
    }
  }

  /**
   * Refresh comments for videos from the last 6 months
   */
  async refreshRecentComments(channelId, apiKey) {
    const syncLogId = await this.createSyncLog(channelId, 'comments_refresh', 'running');
    const youtubeAPI = this.getYouTubeAPI(apiKey);

    try {
      console.log(`Refreshing comments for videos from last 6 months (${channelId})...`);

      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const result = await db.query(
        'SELECT id FROM videos WHERE channel_id = $1 AND upload_date >= $2 ORDER BY upload_date DESC',
        [channelId, sixMonthsAgo]
      );

      const videoIds = result.rows.map(row => row.id);
      console.log(`Found ${videoIds.length} videos to refresh comments for`);

      let commentsProcessed = 0;

      for (const videoId of videoIds) {
        const comments = await youtubeAPI.getVideoComments(videoId);
        await this.fetchAndSaveComments(videoId, youtubeAPI);
        commentsProcessed += comments.length;
      }

      await this.updateSyncLog(syncLogId, 'completed', videoIds.length, commentsProcessed);
      console.log(`Comments refresh completed for ${channelId}. Processed ${commentsProcessed} comments`);

      return { success: true, videosProcessed: videoIds.length, commentsProcessed };
    } catch (error) {
      console.error(`Comments refresh failed for ${channelId}:`, error);
      await this.updateSyncLog(syncLogId, 'failed', 0, 0, error.message);
      throw error;
    }
  }

  /**
   * Incremental sync: Only process new videos
   */
  async incrementalSync(channelId, apiKey) {
    const syncLogId = await this.createSyncLog(channelId, 'incremental_sync', 'running');
    const youtubeAPI = this.getYouTubeAPI(apiKey);

    try {
      console.log(`Starting incremental sync for ${channelId}...`);

      const channelDetails = await youtubeAPI.getChannelDetails(channelId);
      const videos = await youtubeAPI.getAllChannelVideos(channelDetails.uploadsPlaylistId);

      let newVideosCount = 0;

      for (const video of videos) {
        const existing = await db.query('SELECT id FROM videos WHERE id = $1', [video.id]);

        if (existing.rows.length === 0) {
          console.log(`New video found: ${video.title}`);
          await this.processVideo(video, channelId, youtubeAPI);
          newVideosCount++;
        }
      }

      // Also refresh comments for recent videos
      await this.refreshRecentComments(channelId, apiKey);

      await this.updateSyncLog(syncLogId, 'completed', newVideosCount, 0);
      console.log(`Incremental sync completed for ${channelId}. Processed ${newVideosCount} new videos`);

      return { success: true, newVideos: newVideosCount };
    } catch (error) {
      console.error(`Incremental sync failed for ${channelId}:`, error);
      await this.updateSyncLog(syncLogId, 'failed', 0, 0, error.message);
      throw error;
    }
  }

  /**
   * Save channel details to database
   */
  async saveChannelDetails(channel, apiKey) {
    await db.query(
      `INSERT INTO channel (
        id, title, description, custom_url, subscriber_count,
        video_count, view_count, thumbnail_url, api_key
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        custom_url = EXCLUDED.custom_url,
        subscriber_count = EXCLUDED.subscriber_count,
        video_count = EXCLUDED.video_count,
        view_count = EXCLUDED.view_count,
        thumbnail_url = EXCLUDED.thumbnail_url,
        api_key = EXCLUDED.api_key,
        updated_at = CURRENT_TIMESTAMP`,
      [
        channel.id, channel.title, channel.description, channel.customUrl,
        channel.subscriberCount, channel.videoCount, channel.viewCount,
        channel.thumbnailUrl, apiKey
      ]
    );
  }

  /**
   * Save video metadata to database
   */
  async saveVideoMetadata(video, channelId) {
    await db.query(
      `INSERT INTO videos (
        id, channel_id, title, description, upload_date, duration,
        view_count, like_count, comment_count, thumbnail_url, tags,
        category_id, privacy_status, download_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        view_count = EXCLUDED.view_count,
        like_count = EXCLUDED.like_count,
        comment_count = EXCLUDED.comment_count,
        updated_at = CURRENT_TIMESTAMP`,
      [
        video.id, channelId, video.title, video.description,
        video.uploadDate, video.duration, video.viewCount, video.likeCount,
        video.commentCount, video.thumbnailUrl, video.tags,
        video.categoryId, video.privacyStatus, 'pending'
      ]
    );
  }

  /**
   * Create a sync log entry
   */
  async createSyncLog(channelId, syncType, status) {
    const result = await db.query(
      'INSERT INTO sync_log (channel_id, sync_type, status) VALUES ($1, $2, $3) RETURNING id',
      [channelId, syncType, status]
    );
    return result.rows[0].id;
  }

  /**
   * Update sync log entry
   */
  async updateSyncLog(id, status, videosProcessed, commentsProcessed, errors = null) {
    await db.query(
      `UPDATE sync_log SET
        status = $1,
        videos_processed = $2,
        comments_processed = $3,
        errors = $4,
        completed_at = CURRENT_TIMESTAMP
      WHERE id = $5`,
      [status, videosProcessed, commentsProcessed, errors, id]
    );
  }
}

module.exports = SyncService;
