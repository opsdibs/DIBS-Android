import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';

export const WaitingScreen = ({ message, nextEvent, onTimerFinished }) => {
  const [timeLeft, setTimeLeft] = useState(null);
  const [quip, setQuip] = useState('PREPARING THE AUCTION BLOCK...');

  const QUIPS = [
    'SHARPENING THE GAVEL...',
    'POLISHING THE GOODS...',
    'COUNTING THE COINS...',
    "CALM DOWN, IT'S COMING.",
    'PATIENCE PAYS OFF.',
    'NOT YET, TIGER.',
    'GOOD THINGS TAKE TIME.',
    'LOADING THE DRIP...'
  ];

  useEffect(() => {
    setQuip(QUIPS[Math.floor(Math.random() * QUIPS.length)]);
    const interval = setInterval(() => {
      setQuip(QUIPS[Math.floor(Math.random() * QUIPS.length)]);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!nextEvent) return undefined;
    const interval = setInterval(() => {
      const now = Date.now();
      const target = new Date(nextEvent).getTime();
      const distance = target - now;

      if (distance < 0) {
        clearInterval(interval);
        if (onTimerFinished) onTimerFinished();
      } else {
        const hours = Math.floor(distance / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        setTimeLeft({ h: hours, m: minutes, s: seconds });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [nextEvent, onTimerFinished]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center w-full h-full px-6 z-20 relative text-center space-y-8"
    >
      <Lock className="w-12 h-12 text-white/50" />

      <div className="space-y-6">
        <h1 className="text-5xl font-display font-black text-white uppercase tracking-tight leading-none">
          DOORS
          <br />
          LOCKED
        </h1>
        {timeLeft ? (
          <div className="flex items-center justify-center gap-4 font-mono text-4xl font-bold text-white tabular-nums">
            <div className="flex flex-col items-center">
              <span>{String(timeLeft.h).padStart(2, '0')}</span>
              <span className="text-[10px] opacity-50">HRS</span>
            </div>
            <span className="opacity-50 -mt-4">:</span>
            <div className="flex flex-col items-center">
              <span>{String(timeLeft.m).padStart(2, '0')}</span>
              <span className="text-[10px] opacity-50">MIN</span>
            </div>
            <span className="opacity-50 -mt-4">:</span>
            <div className="flex flex-col items-center text-[#FF6600] bg-white px-2 rounded-lg">
              <span>{String(timeLeft.s).padStart(2, '0')}</span>
              <span className="text-[10px] opacity-50">SEC</span>
            </div>
          </div>
        ) : (
          <div className="animate-pulse font-mono text-xl">CALCULATING...</div>
        )}
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/80 border-t border-b border-white/20 py-4 max-w-xs mx-auto animate-pulse">
          {message || quip}
        </p>
      </div>
    </motion.div>
  );
};
