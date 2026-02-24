import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { LoginPage } from './components/LoginPage';
import { LiveRoom } from './components/LiveRoom';
import { CatalogPage } from './components/CatalogPage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/room/:roomId" element={<RoomWrapper />} />
      </Routes>
    </Router>
  );
}

const RoomWrapper = () => {
  const params = window.location.pathname.split('/');
  const roomId = params[params.length - 1];
  return <LiveRoom roomId={roomId} />;
};

export default App;
