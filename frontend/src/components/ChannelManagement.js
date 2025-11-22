import React, { useState, useEffect } from 'react';
import './ChannelManagement.css';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function ChannelManagement() {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newChannel, setNewChannel] = useState({
    channelId: '',
    apiKey: '',
    syncSchedule: '0 2 * * *'
  });
  const [addingChannel, setAddingChannel] = useState(false);

  useEffect(() => {
    fetchChannels();
  }, []);

  const fetchChannels = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/channels`);
      if (!response.ok) throw new Error('Failed to fetch channels');
      const data = await response.json();
      setChannels(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddChannel = async (e) => {
    e.preventDefault();
    setAddingChannel(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/channels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newChannel)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add channel');
      }

      await fetchChannels();
      setShowAddForm(false);
      setNewChannel({
        channelId: '',
        apiKey: '',
        syncSchedule: '0 2 * * *'
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingChannel(false);
    }
  };

  const handleDeleteChannel = async (channelId) => {
    if (!window.confirm('Are you sure you want to delete this channel? All associated videos and data will be removed.')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/channels/${channelId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to delete channel');

      await fetchChannels();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleSync = async (channelId, currentEnabled) => {
    try {
      const response = await fetch(`${API_BASE}/api/channels/${channelId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ syncEnabled: !currentEnabled })
      });

      if (!response.ok) throw new Error('Failed to update channel');

      await fetchChannels();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleTriggerSync = async (channelId, syncType = 'incremental') => {
    try {
      const response = await fetch(`${API_BASE}/api/channels/${channelId}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ syncType })
      });

      if (!response.ok) throw new Error('Failed to trigger sync');

      const data = await response.json();
      alert(data.message);
    } catch (err) {
      setError(err.message);
    }
  };

  const formatNumber = (num) => {
    if (!num) return '0';
    return num.toLocaleString();
  };

  if (loading) {
    return <div className="channel-management"><div className="loading">Loading channels...</div></div>;
  }

  return (
    <div className="channel-management">
      <div className="channel-header">
        <h1>Channel Management</h1>
        <button
          className="btn btn-primary"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? 'Cancel' : 'Add Channel'}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {showAddForm && (
        <div className="add-channel-form">
          <h2>Add New Channel</h2>
          <form onSubmit={handleAddChannel}>
            <div className="form-group">
              <label>YouTube Channel ID</label>
              <input
                type="text"
                value={newChannel.channelId}
                onChange={(e) => setNewChannel({ ...newChannel, channelId: e.target.value })}
                placeholder="UCxxxxxxxxxxxxxxxxxx"
                required
              />
              <small>Find it in the channel URL: youtube.com/channel/[CHANNEL_ID]</small>
            </div>

            <div className="form-group">
              <label>YouTube API Key</label>
              <input
                type="password"
                value={newChannel.apiKey}
                onChange={(e) => setNewChannel({ ...newChannel, apiKey: e.target.value })}
                placeholder="Your YouTube Data API v3 key"
                required
              />
            </div>

            <div className="form-group">
              <label>Sync Schedule (Cron)</label>
              <input
                type="text"
                value={newChannel.syncSchedule}
                onChange={(e) => setNewChannel({ ...newChannel, syncSchedule: e.target.value })}
                placeholder="0 2 * * *"
              />
              <small>Default: 0 2 * * * (Every day at 2:00 AM)</small>
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={addingChannel}
              >
                {addingChannel ? 'Adding...' : 'Add Channel'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="channels-grid">
        {channels.length === 0 ? (
          <div className="no-channels">
            <p>No channels configured yet.</p>
            <p>Click "Add Channel" to get started.</p>
          </div>
        ) : (
          channels.map((channel) => (
            <div key={channel.id} className="channel-card">
              <div className="channel-header-section">
                {channel.thumbnail_url && (
                  <img src={channel.thumbnail_url} alt={channel.title} className="channel-thumbnail" />
                )}
                <div className="channel-info">
                  <h3>{channel.title}</h3>
                  {channel.custom_url && (
                    <a
                      href={`https://youtube.com/${channel.custom_url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="channel-url"
                    >
                      {channel.custom_url}
                    </a>
                  )}
                </div>
              </div>

              <div className="channel-stats">
                <div className="stat">
                  <span className="stat-label">Subscribers</span>
                  <span className="stat-value">{formatNumber(channel.subscriber_count)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Videos</span>
                  <span className="stat-value">{formatNumber(channel.video_count)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Views</span>
                  <span className="stat-value">{formatNumber(channel.view_count)}</span>
                </div>
              </div>

              <div className="channel-settings">
                <div className="setting">
                  <span>Sync Schedule:</span>
                  <code>{channel.sync_schedule}</code>
                </div>
                <div className="setting">
                  <span>Auto-sync:</span>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={channel.sync_enabled}
                      onChange={() => handleToggleSync(channel.id, channel.sync_enabled)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>

              <div className="channel-actions">
                <button
                  className="btn btn-sm btn-success"
                  onClick={() => handleTriggerSync(channel.id, 'incremental')}
                >
                  Incremental Sync
                </button>
                <button
                  className="btn btn-sm btn-info"
                  onClick={() => handleTriggerSync(channel.id, 'full')}
                >
                  Full Sync
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDeleteChannel(channel.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ChannelManagement;
