import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './components/LoginPage';
import { LiveRoom } from './components/LiveRoom';

function App() {
  return (
    <Router>
      <Routes>
        {/* MODULE 1 CHANGE: Root now points to Unified Login Page */}
        <Route path="/" element={<LoginPage />} />
        
        {/* Legacy/Direct link support */}
        <Route path="/login" element={<LoginPage />} />

        {/* The Live Room (Protected by Login Logic) */}
        <Route path="/room/:roomId" element={<RoomWrapper />} />
      </Routes>
    </Router>
  );
}

// Wrapper to parse params if needed
const RoomWrapper = () => {
    const params = window.location.pathname.split('/');
    const roomId = params[params.length - 1];
    return <LiveRoom roomId={roomId} />;
};

export default App;
