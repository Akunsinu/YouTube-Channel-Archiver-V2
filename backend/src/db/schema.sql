-- YouTube Archiver Database Schema

-- Channel information (supports multiple channels)
CREATE TABLE IF NOT EXISTS channel (
    id VARCHAR(255) PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    custom_url VARCHAR(255),
    subscriber_count INTEGER,
    video_count INTEGER,
    view_count BIGINT,
    thumbnail_url TEXT,
    api_key VARCHAR(500), -- YouTube API key for this channel
    sync_enabled BOOLEAN DEFAULT true, -- Whether to sync this channel
    sync_schedule VARCHAR(50) DEFAULT '0 2 * * *', -- Cron schedule for syncing
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Videos table
CREATE TABLE IF NOT EXISTS videos (
    id VARCHAR(255) PRIMARY KEY,
    channel_id VARCHAR(255) REFERENCES channel(id),
    title VARCHAR(500) NOT NULL,
    description TEXT,
    upload_date TIMESTAMP NOT NULL,
    duration INTEGER, -- in seconds
    view_count BIGINT DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    file_path TEXT,
    thumbnail_url TEXT,
    tags TEXT[], -- array of tags
    category_id VARCHAR(50),
    privacy_status VARCHAR(50),
    download_status VARCHAR(50) DEFAULT 'pending', -- pending, downloading, completed, failed
    downloaded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Comments table (supports nested replies)
CREATE TABLE IF NOT EXISTS comments (
    id VARCHAR(255) PRIMARY KEY,
    video_id VARCHAR(255) REFERENCES videos(id) ON DELETE CASCADE,
    parent_comment_id VARCHAR(255) REFERENCES comments(id) ON DELETE CASCADE,
    author_name VARCHAR(255),
    author_channel_id VARCHAR(255),
    author_profile_image_url TEXT,
    text_display TEXT,
    text_original TEXT,
    like_count INTEGER DEFAULT 0,
    published_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sync log to track download history
CREATE TABLE IF NOT EXISTS sync_log (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(255) REFERENCES channel(id) ON DELETE CASCADE,
    sync_type VARCHAR(50) NOT NULL, -- full_sync, incremental_sync, comments_refresh
    status VARCHAR(50) NOT NULL, -- running, completed, failed
    videos_processed INTEGER DEFAULT 0,
    comments_processed INTEGER DEFAULT 0,
    errors TEXT,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_upload_date ON videos(upload_date DESC);
CREATE INDEX IF NOT EXISTS idx_videos_download_status ON videos(download_status);
CREATE INDEX IF NOT EXISTS idx_comments_video_id ON comments(video_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_published_at ON comments(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_channel_id ON sync_log(channel_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_started_at ON sync_log(started_at DESC);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to auto-update updated_at
CREATE TRIGGER update_channel_updated_at BEFORE UPDATE ON channel
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_videos_updated_at BEFORE UPDATE ON videos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
