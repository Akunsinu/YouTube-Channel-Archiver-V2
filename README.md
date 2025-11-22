# YouTube Channel Archiver

A self-hosted application to download and archive videos from **multiple YouTube channels**, complete with metadata, comments, and a YouTube-like viewing experience.

## Features

- **Multi-Channel Support**: Archive videos from unlimited YouTube channels
- **Channel Management UI**: Add, remove, and configure channels through the web interface
- **Complete Channel Archival**: Downloads all videos from your YouTube channels
- **Metadata Preservation**: Saves titles, descriptions, view counts, likes, tags, and more
- **Comment Archival**: Downloads all comments and replies with full threading support
- **YouTube-like Viewer**: Modern React-based web interface for browsing and watching videos
- **Per-Channel Scheduling**: Configure independent sync schedules for each channel
- **Auto-Sync**: Automated syncing for new videos and comment updates
- **Smart Comment Refresh**: Automatically updates comments for videos from the last 6 months
- **Docker Deployment**: Easy deployment with Docker Compose on Unraid or any Docker host
- **Hybrid Approach**: Uses yt-dlp for reliable video downloads and YouTube API for comprehensive metadata

## Architecture

- **Backend**: Node.js/Express API server
- **Frontend**: React single-page application
- **Database**: PostgreSQL for metadata storage
- **Video Downloads**: yt-dlp
- **Metadata/Comments**: YouTube Data API v3
- **Deployment**: Docker Compose

## Prerequisites

- Docker and Docker Compose
- YouTube Data API v3 key(s) ([Get one here](https://console.cloud.google.com/apis/credentials))
- YouTube Channel ID(s) you want to archive ([Find it here](https://www.youtube.com/account_advanced))
- Sufficient storage space for your videos

## Quick Start

### 1. Clone or Download

Download this project to your Unraid server or Docker host.

### 2. Configure Environment

Copy the example environment file and edit it with your credentials:

```bash
cp .env.example .env
nano .env
```

Required configuration:

```env
# Database password (choose a strong password)
DB_PASSWORD=your_secure_password

# Optional: Import existing channel during migration (backward compatibility)
# If specified, this channel will be automatically added to the database
YOUTUBE_API_KEY=your_youtube_api_key
YOUTUBE_CHANNEL_ID=your_channel_id
SYNC_CRON=0 2 * * *
```

**Note**: The `YOUTUBE_API_KEY` and `YOUTUBE_CHANNEL_ID` environment variables are now optional. You can add and manage channels through the web interface instead! These variables are only used for backward compatibility - if specified, the channel will be automatically imported during database migration.

### 3. Deploy with Docker Compose

```bash
docker-compose up -d
```

This will start three containers:
- **postgres**: PostgreSQL database
- **backend**: Node.js API server
- **frontend**: Nginx web server with React app

### 4. Initialize Database

Run the database migration to create tables:

```bash
docker exec -it youtube-archiver-backend npm run migrate
```

### 5. Add Channels

Open your browser and navigate to:
- **Web Interface**: http://your-server-ip

#### Option A: Add Channels via Web Interface (Recommended)
1. Click "Channels" in the navigation
2. Click "Add Channel"
3. Enter your YouTube Channel ID and API Key
4. Configure sync schedule (optional, defaults to 2 AM daily)
5. Click "Add Channel"
6. Trigger "Full Sync" to start downloading

#### Option B: Automatic Import (If using environment variables)
If you configured `YOUTUBE_CHANNEL_ID` and `YOUTUBE_API_KEY` in `.env`, your channel was automatically imported during migration. Just click "Full Sync" to start!

## Usage

### Web Interface

Access the web interface at `http://your-server-ip`

#### Channel Management
- **View All Channels**: See all configured channels with stats and settings
- **Add New Channels**: Add unlimited YouTube channels to archive
- **Remove Channels**: Delete channels and all associated data
- **Enable/Disable Sync**: Toggle automatic syncing per channel
- **Trigger Manual Syncs**: Start incremental or full syncs for specific channels
- **Per-Channel Scheduling**: Customize sync schedules using cron format

#### Home Page
- Browse all archived videos from all channels in a grid layout
- Search videos by title, description, or comments
- Filter videos by channel
- Sort by upload date, views, or likes
- Click on any downloaded video to watch

#### Video Player
- Watch videos with a custom HTML5 player
- View complete metadata (views, likes, upload date, channel)
- Read all comments with nested replies
- See video tags and description

#### Stats Page
- View overall statistics across all channels
- View per-channel statistics
- Monitor download progress
- Check sync history and status

### Manual Sync

You can trigger syncs manually from the web interface:

**From Header (syncs all enabled channels)**:
- **Sync Now**: Incremental sync (downloads only new videos + refreshes recent comments)
- **Full Sync**: Complete sync (processes all videos)

**From Channel Management (syncs specific channel)**:
- **Incremental Sync**: Download new videos for this channel only
- **Full Sync**: Process all videos for this channel

### API Endpoints

The backend exposes these REST API endpoints:

#### Channel Management
```
GET    /api/channels           - List all channels
GET    /api/channels/:id       - Get specific channel
POST   /api/channels           - Add new channel
PUT    /api/channels/:id       - Update channel settings
DELETE /api/channels/:id       - Remove channel
POST   /api/channels/:id/sync  - Trigger sync for specific channel
```

#### Videos
```
GET  /api/videos                 - List all videos (paginated, supports ?channelId filter)
GET  /api/videos/:id             - Get video details
GET  /api/videos/:id/stream      - Stream video file
GET  /api/videos/:id/comments    - Get video comments
GET  /api/videos/stats/overview  - Get statistics (supports ?channelId filter)
```

#### Sync
```
POST /api/sync/trigger           - Trigger manual sync (all channels or specific channel)
GET  /api/sync/status            - Get sync status
GET  /api/sync/progress          - Get current sync progress
```

#### Health
```
GET  /health                     - Health check
```

## Storage

Videos and database are stored in Docker volumes:

- `video_data`: All downloaded video files
- `postgres_data`: PostgreSQL database

### Backup

To backup your data:

```bash
# Backup videos
docker run --rm -v youtube-archiver_video_data:/data -v $(pwd):/backup alpine tar czf /backup/videos-backup.tar.gz /data

# Backup database
docker exec youtube-archiver-db pg_dump -U postgres youtube_archiver > db-backup.sql
```

### Storage Location

To use a specific directory for videos (e.g., on Unraid), modify `docker-compose.yml`:

```yaml
volumes:
  video_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /mnt/user/appdata/youtube-archiver/videos
```

## Configuration

### Sync Schedule

The sync schedule uses cron format. Edit `.env` to customize:

```env
# Every 6 hours
SYNC_CRON=0 */6 * * *

# Every day at midnight
SYNC_CRON=0 0 * * *

# Every Sunday at 3 AM
SYNC_CRON=0 3 * * 0
```

### YouTube API Quota

The YouTube Data API has a quota of 10,000 units per day **per API key**. This application is designed to work within these limits:

- Fetching channel details: ~3 units
- Fetching video list: ~1 unit per 50 videos
- Fetching video details: ~1 unit per video
- Fetching comments: ~1 unit per 100 comments

For a channel with 500 videos and 10,000 comments, a full sync uses approximately:
- 500 units for video details
- 100 units for comments
- Total: ~600 units (well within daily quota)

#### Multi-Channel Considerations

When archiving multiple channels:
- **Option 1**: Use the same API key for all channels (shares quota)
- **Option 2**: Use different API keys per channel (separate quotas)
- Schedule syncs at different times to spread out API usage
- Use incremental syncs to reduce daily quota usage

## Troubleshooting

### Videos Not Downloading

1. Check backend logs: `docker logs youtube-archiver-backend`
2. Verify yt-dlp is working: `docker exec youtube-archiver-backend yt-dlp --version`
3. Check disk space: `df -h`

### Comments Not Showing

1. Verify API key is correct
2. Check API quota: [Google Cloud Console](https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas)
3. Some videos may have comments disabled

### Database Connection Issues

1. Check postgres is running: `docker ps`
2. Verify credentials in `.env`
3. Check backend logs: `docker logs youtube-archiver-backend`

### Frontend Not Loading

1. Check if frontend is running: `docker ps`
2. Verify port 80 is not in use
3. Check nginx logs: `docker logs youtube-archiver-frontend`

## Development

### Running Locally

Backend:
```bash
cd backend
npm install
cp ../.env.example .env
# Edit .env with your credentials
npm run dev
```

Frontend:
```bash
cd frontend
npm install
REACT_APP_API_URL=http://localhost:3001 npm start
```

Database:
```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:15-alpine
```

### Project Structure

```
youtube-archiver/
├── backend/
│   ├── src/
│   │   ├── db/              # Database connection and schema
│   │   ├── routes/          # API routes
│   │   ├── services/        # Business logic
│   │   └── index.js         # Server entry point
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── App.js
│   │   └── index.js
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml
├── .env.example
└── README.md
```

## Security Considerations

- **API Keys**: Never commit your `.env` file. Keep API keys secure.
- **Database**: Use a strong password for PostgreSQL.
- **Network**: Consider running behind a reverse proxy (Traefik, Nginx Proxy Manager).
- **HTTPS**: Enable HTTPS if exposing publicly.
- **Firewall**: Restrict access to your internal network or VPN.

## License

MIT License - Feel free to modify and use for your own purposes.

## Credits

Built with:
- [Node.js](https://nodejs.org/)
- [React](https://reactjs.org/)
- [PostgreSQL](https://www.postgresql.org/)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [YouTube Data API](https://developers.google.com/youtube/v3)

## Support

For issues, questions, or contributions, please open an issue on GitHub.
