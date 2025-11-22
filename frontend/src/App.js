import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import VideoGrid from './components/VideoGrid';
import VideoPlayer from './components/VideoPlayer';
import StatsPanel from './components/StatsPanel';
import ChannelManagement from './components/ChannelManagement';
import './App.css';

function App() {
  return (
    <Router>
      <div className="App">
        <Header />
        <div className="main-content">
          <Routes>
            <Route path="/" element={<VideoGrid />} />
            <Route path="/watch/:videoId" element={<VideoPlayer />} />
            <Route path="/stats" element={<StatsPanel />} />
            <Route path="/channels" element={<ChannelManagement />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
