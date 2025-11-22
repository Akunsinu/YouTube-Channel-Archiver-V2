const express = require('express');
const router = express.Router();
const db = require('../db');
const fs = require('fs');
const path = require('path');

/**
 * GET /api/videos - Get all videos with pagination and search
 * searchIn options: 'all', 'title', 'description', 'comments'
 */
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      searchIn = 'all',
      sortBy = 'upload_date',
      order = 'DESC',
      channelId = ''
    } = req.query;

    const offset = (page - 1) * limit;

    let query = '';
    let countQuery = '';
    const queryParams = [];
    const countParams = [];

    // Build query based on searchIn parameter
    if (search && searchIn === 'comments') {
      // Search only in comments
      query = `
        SELECT DISTINCT
          v.id, v.title, v.description, v.upload_date, v.duration, v.view_count,
          v.like_count, v.comment_count, v.thumbnail_url, v.tags, v.download_status,
          v.file_path, v.downloaded_at, v.channel_id
        FROM videos v
        INNER JOIN comments c ON v.id = c.video_id
        WHERE c.text_display ILIKE $1
      `;
      queryParams.push(`%${search}%`);

      countQuery = `
        SELECT COUNT(DISTINCT v.id)
        FROM videos v
        INNER JOIN comments c ON v.id = c.video_id
        WHERE c.text_display ILIKE $1
      `;
      countParams.push(`%${search}%`);

      // Add channel filter if provided
      if (channelId) {
        query += ` AND v.channel_id = $${queryParams.length + 1}`;
        countQuery += ` AND v.channel_id = $${countParams.length + 1}`;
        queryParams.push(channelId);
        countParams.push(channelId);
      }
    } else {
      // Search in videos (title, description, or both)
      query = `
        SELECT
          id, title, description, upload_date, duration, view_count,
          like_count, comment_count, thumbnail_url, tags, download_status,
          file_path, downloaded_at, channel_id
        FROM videos
        WHERE 1=1
      `;

      countQuery = 'SELECT COUNT(*) FROM videos WHERE 1=1';

      // Add channel filter if provided
      if (channelId) {
        query += ` AND channel_id = $${queryParams.length + 1}`;
        countQuery += ` AND channel_id = $${countParams.length + 1}`;
        queryParams.push(channelId);
        countParams.push(channelId);
      }

      if (search) {
        if (searchIn === 'title') {
          query += ` AND title ILIKE $${queryParams.length + 1}`;
          countQuery += ` AND title ILIKE $${countParams.length + 1}`;
        } else if (searchIn === 'description') {
          query += ` AND description ILIKE $${queryParams.length + 1}`;
          countQuery += ` AND description ILIKE $${countParams.length + 1}`;
        } else {
          // searchIn === 'all' - search in title, description, and comments
          query = `
            SELECT DISTINCT
              v.id, v.title, v.description, v.upload_date, v.duration, v.view_count,
              v.like_count, v.comment_count, v.thumbnail_url, v.tags, v.download_status,
              v.file_path, v.downloaded_at, v.channel_id
            FROM videos v
            LEFT JOIN comments c ON v.id = c.video_id
            WHERE (v.title ILIKE $${queryParams.length + 1} OR v.description ILIKE $${queryParams.length + 1} OR c.text_display ILIKE $${queryParams.length + 1})
          `;
          countQuery = `
            SELECT COUNT(DISTINCT v.id)
            FROM videos v
            LEFT JOIN comments c ON v.id = c.video_id
            WHERE (v.title ILIKE $${countParams.length + 1} OR v.description ILIKE $${countParams.length + 1} OR c.text_display ILIKE $${countParams.length + 1})
          `;

          // Add channel filter to the 'all' search as well
          if (channelId) {
            query += ` AND v.channel_id = $${queryParams.length + 2}`;
            countQuery += ` AND v.channel_id = $${countParams.length + 2}`;
            queryParams.push(`%${search}%`, channelId);
            countParams.push(`%${search}%`, channelId);
          } else {
            queryParams.push(`%${search}%`);
            countParams.push(`%${search}%`);
          }
        }

        if (searchIn !== 'all') {
          queryParams.push(`%${search}%`);
          countParams.push(`%${search}%`);
        }
      }
    }

    query += ` ORDER BY ${sortBy} ${order} LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(parseInt(limit), offset);

    const result = await db.query(query, queryParams);
    const countResult = await db.query(countQuery, countParams);
    const totalCount = parseInt(countResult.rows[0].count);

    res.json({
      videos: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

/**
 * GET /api/videos/:id - Get single video details
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      'SELECT * FROM videos WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching video:', error);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

/**
 * GET /api/videos/:id/stream - Stream video file
 */
router.get('/:id/stream', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      'SELECT file_path FROM videos WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0 || !result.rows[0].file_path) {
      return res.status(404).json({ error: 'Video file not found' });
    }

    const filePath = result.rows[0].file_path;

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Video file not found on disk' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Handle range request for video seeking
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      };

      res.writeHead(206, head);
      file.pipe(res);
    } else {
      // No range, send entire file
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      };

      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    console.error('Error streaming video:', error);
    res.status(500).json({ error: 'Failed to stream video' });
  }
});

/**
 * GET /api/videos/:id/comments - Get comments for a video
 */
router.get('/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;

    // Get top-level comments
    const topLevelComments = await db.query(
      `SELECT * FROM comments
       WHERE video_id = $1 AND parent_comment_id IS NULL
       ORDER BY published_at DESC`,
      [id]
    );

    // Get all replies
    const replies = await db.query(
      `SELECT * FROM comments
       WHERE video_id = $1 AND parent_comment_id IS NOT NULL
       ORDER BY published_at ASC`,
      [id]
    );

    // Organize replies under their parent comments
    const commentsWithReplies = topLevelComments.rows.map(comment => ({
      ...comment,
      replies: replies.rows.filter(reply => reply.parent_comment_id === comment.id)
    }));

    res.json(commentsWithReplies);
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

/**
 * GET /api/videos/stats - Get overall statistics
 * Supports optional channelId query parameter for channel-specific stats
 */
router.get('/stats/overview', async (req, res) => {
  try {
    const { channelId } = req.query;

    let statsQuery = `
      SELECT
        COUNT(*) as total_videos,
        SUM(view_count) as total_views,
        SUM(like_count) as total_likes,
        SUM(comment_count) as total_comments,
        COUNT(CASE WHEN download_status = 'completed' THEN 1 END) as downloaded_videos,
        COUNT(CASE WHEN download_status = 'pending' THEN 1 END) as pending_videos,
        COUNT(CASE WHEN download_status = 'failed' THEN 1 END) as failed_videos
      FROM videos
    `;

    let stats;
    if (channelId) {
      statsQuery += ' WHERE channel_id = $1';
      stats = await db.query(statsQuery, [channelId]);
    } else {
      stats = await db.query(statsQuery);
    }

    // Get channel info (either specific channel or all channels)
    let channelInfo;
    if (channelId) {
      channelInfo = await db.query(
        'SELECT id, title, description, custom_url, subscriber_count, video_count, view_count, thumbnail_url FROM channel WHERE id = $1',
        [channelId]
      );
    } else {
      channelInfo = await db.query(
        'SELECT id, title, description, custom_url, subscriber_count, video_count, view_count, thumbnail_url FROM channel ORDER BY created_at DESC'
      );
    }

    res.json({
      stats: stats.rows[0],
      channels: channelInfo.rows
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
