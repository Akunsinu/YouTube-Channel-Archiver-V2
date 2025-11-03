const axios = require('axios');

class YouTubeAPIService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://www.googleapis.com/youtube/v3';
  }

  /**
   * Get channel details
   */
  async getChannelDetails(channelId) {
    try {
      const response = await axios.get(`${this.baseUrl}/channels`, {
        params: {
          part: 'snippet,contentDetails,statistics',
          id: channelId,
          key: this.apiKey
        }
      });

      if (response.data.items.length === 0) {
        throw new Error('Channel not found');
      }

      const channel = response.data.items[0];
      return {
        id: channel.id,
        title: channel.snippet.title,
        description: channel.snippet.description,
        customUrl: channel.snippet.customUrl,
        thumbnailUrl: channel.snippet.thumbnails.high.url,
        subscriberCount: parseInt(channel.statistics.subscriberCount),
        videoCount: parseInt(channel.statistics.videoCount),
        viewCount: parseInt(channel.statistics.viewCount),
        uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads
      };
    } catch (error) {
      console.error('Error fetching channel details:', error.message);
      throw error;
    }
  }

  /**
   * Get all video IDs from the channel's uploads playlist
   */
  async getAllVideoIds(uploadsPlaylistId) {
    const videoIds = [];
    let nextPageToken = null;

    try {
      do {
        const response = await axios.get(`${this.baseUrl}/playlistItems`, {
          params: {
            part: 'contentDetails',
            playlistId: uploadsPlaylistId,
            maxResults: 50,
            pageToken: nextPageToken,
            key: this.apiKey
          }
        });

        response.data.items.forEach(item => {
          videoIds.push(item.contentDetails.videoId);
        });

        nextPageToken = response.data.nextPageToken;
      } while (nextPageToken);

      console.log(`Found ${videoIds.length} videos in channel`);
      return videoIds;
    } catch (error) {
      console.error('Error fetching video IDs:', error.message);
      throw error;
    }
  }

  /**
   * Get detailed information for a batch of videos (max 50)
   */
  async getVideoDetails(videoIds) {
    try {
      const response = await axios.get(`${this.baseUrl}/videos`, {
        params: {
          part: 'snippet,contentDetails,statistics',
          id: videoIds.join(','),
          key: this.apiKey
        }
      });

      return response.data.items.map(video => {
        // Parse duration from ISO 8601 format (PT1H2M3S) to seconds
        const duration = this.parseDuration(video.contentDetails.duration);

        return {
          id: video.id,
          title: video.snippet.title,
          description: video.snippet.description,
          uploadDate: new Date(video.snippet.publishedAt),
          duration: duration,
          viewCount: parseInt(video.statistics.viewCount || 0),
          likeCount: parseInt(video.statistics.likeCount || 0),
          commentCount: parseInt(video.statistics.commentCount || 0),
          thumbnailUrl: video.snippet.thumbnails.high.url,
          tags: video.snippet.tags || [],
          categoryId: video.snippet.categoryId,
          privacyStatus: video.status?.privacyStatus || 'public'
        };
      });
    } catch (error) {
      console.error('Error fetching video details:', error.message);
      throw error;
    }
  }

  /**
   * Get all comments for a video (including replies)
   */
  async getVideoComments(videoId) {
    const comments = [];
    let nextPageToken = null;

    try {
      do {
        const response = await axios.get(`${this.baseUrl}/commentThreads`, {
          params: {
            part: 'snippet,replies',
            videoId: videoId,
            maxResults: 100,
            pageToken: nextPageToken,
            key: this.apiKey
          }
        });

        response.data.items.forEach(item => {
          // Top-level comment
          const topComment = item.snippet.topLevelComment.snippet;
          comments.push({
            id: item.snippet.topLevelComment.id,
            videoId: videoId,
            parentCommentId: null,
            authorName: topComment.authorDisplayName,
            authorChannelId: topComment.authorChannelId?.value,
            authorProfileImageUrl: topComment.authorProfileImageUrl,
            textDisplay: topComment.textDisplay,
            textOriginal: topComment.textOriginal,
            likeCount: topComment.likeCount,
            publishedAt: new Date(topComment.publishedAt),
            updatedAt: new Date(topComment.updatedAt)
          });

          // Replies
          if (item.replies) {
            item.replies.comments.forEach(reply => {
              const replySnippet = reply.snippet;
              comments.push({
                id: reply.id,
                videoId: videoId,
                parentCommentId: item.snippet.topLevelComment.id,
                authorName: replySnippet.authorDisplayName,
                authorChannelId: replySnippet.authorChannelId?.value,
                authorProfileImageUrl: replySnippet.authorProfileImageUrl,
                textDisplay: replySnippet.textDisplay,
                textOriginal: replySnippet.textOriginal,
                likeCount: replySnippet.likeCount,
                publishedAt: new Date(replySnippet.publishedAt),
                updatedAt: new Date(replySnippet.updatedAt)
              });
            });
          }
        });

        nextPageToken = response.data.nextPageToken;
      } while (nextPageToken);

      console.log(`Fetched ${comments.length} comments for video ${videoId}`);
      return comments;
    } catch (error) {
      if (error.response?.status === 403 && error.response?.data?.error?.errors?.[0]?.reason === 'commentsDisabled') {
        console.log(`Comments disabled for video ${videoId}`);
        return [];
      }
      console.error(`Error fetching comments for video ${videoId}:`, error.message);
      throw error;
    }
  }

  /**
   * Parse ISO 8601 duration to seconds
   */
  parseDuration(isoDuration) {
    if (!isoDuration) return 0;

    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1] || 0);
    const minutes = parseInt(match[2] || 0);
    const seconds = parseInt(match[3] || 0);
    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Batch process video IDs into chunks of 50
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Get all videos with details from channel
   */
  async getAllChannelVideos(uploadsPlaylistId) {
    const videoIds = await this.getAllVideoIds(uploadsPlaylistId);
    const chunks = this.chunkArray(videoIds, 50);
    const allVideos = [];

    for (const chunk of chunks) {
      const videos = await this.getVideoDetails(chunk);
      allVideos.push(...videos);
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return allVideos;
  }
}

module.exports = YouTubeAPIService;
