import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Video, Eye, ArrowRight } from 'lucide-react';

export const LoginScreen = () => {
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState("");

  const handleJoin = (role) => {
    if (!roomName) return;
    // Navigate to the Room URL
    navigate(`/room/${roomName}?role=${role}`);
  };

  return (
    <div className="flex flex-col items-center justify-center w-full h-full px-6 z-20 relative">
      <motion.div 
        initial={{ y: 20, opacity: 0 }} 
        animate={{ y: 0, opacity: 1 }} 
        className="w-full max-w-md space-y-8"
      >
        <div className="space-y-2 text-center">
          <h2 className="text-3xl font-display font-black text-white uppercase tracking-tighter">Enter The Pit</h2>
          <p className="text-neutral-500 font-mono text-xs tracking-widest uppercase">Live Auctions / No Reserve</p>
        </div>

        <div className="space-y-4">
          <input
            type="text"
            placeholder="ENTER ROOM NAME"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value.toUpperCase())}
            className="w-full bg-neutral-900 border border-neutral-800 text-white font-mono text-center py-4 focus:outline-none focus:border-white transition-colors placeholder:text-neutral-700"
          />

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => handleJoin('host')}
              className="group flex flex-col items-center justify-center p-6 border border-neutral-800 hover:bg-white hover:text-black transition-colors"
            >
              <Video className="w-6 h-6 mb-2" />
              <span className="font-mono text-[10px] uppercase tracking-widest font-bold">Host</span>
            </button>

            <button
              onClick={() => handleJoin('audience')}
              className="group flex flex-col items-center justify-center p-6 border border-neutral-800 hover:bg-white hover:text-black transition-colors"
            >
              <Eye className="w-6 h-6 mb-2" />
              <span className="font-mono text-[10px] uppercase tracking-widest font-bold">Watch</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};