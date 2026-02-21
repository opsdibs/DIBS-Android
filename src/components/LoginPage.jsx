import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, AlertCircle, Key, Mail, Lock, X } from 'lucide-react';
import { ref, push, set, get, update } from 'firebase/database';
import { db } from '../lib/firebase';
import { logEvent } from '../lib/analytics';
import { NAME_LIST } from '../lib/username_list';

// --- 1. COIN STACK ANIMATION (Unchanged) ---
const CoinStackLoader = ({ onComplete }) => {
  const [coinCount, setCoinCount] = useState(0);
  const [phase, setPhase] = useState('stacking');
  const totalCoins = 5;

  useEffect(() => {
    if (phase === 'stacking') {
        const interval = setInterval(() => {
            setCoinCount(prev => {
                if (prev >= totalCoins) {
                    clearInterval(interval);
                    setPhase('hammer');
                    return prev;
                }
                return prev + 1;
            });
        }, 200);
        return () => clearInterval(interval);
    }
  }, [phase]);

  useEffect(() => {
    if (phase === 'hammer') {
        const timer = setTimeout(() => { setPhase('impact'); }, 400); 
        return () => clearTimeout(timer);
    }
    if (phase === 'impact') {
        const timer = setTimeout(() => { onComplete(); }, 1500);
        return () => clearTimeout(timer);
    }
  }, [phase, onComplete]);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-[#FF6600] text-white overflow-hidden">
       <motion.div
         className="font-mono text-[10px] uppercase tracking-[0.3em] text-white mb-4 absolute top-24"
         animate={{ opacity: phase === 'impact' ? 0 : [0.4, 1, 0.4] }}
       >
         LOADING
       </motion.div>

       <div className="relative h-64 w-full flex items-end justify-center mt-10">
         <AnimatePresence>
           {phase !== 'impact' && Array.from({ length: coinCount }).map((_, i) => (
             <motion.div
                key={i}
                initial={{ y: -100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ scale: 0, opacity: 0, transition: { duration: 0.1 } }}
                className="absolute w-48 h-12 bg-white"
                style={{ 
                    bottom: i * 14, 
                    zIndex: i,
                    clipPath: 'polygon(10% 0, 90% 0, 100% 20%, 100% 80%, 90% 100%, 10% 100%, 0 80%, 0 20%)',
                    boxShadow: '0 0 0 2px #FF6600 inset, 0 0 0 4px white inset'
                }} 
            />
           ))}
         </AnimatePresence>

         <AnimatePresence>
           {phase === 'hammer' && (
               <motion.div
                    className="absolute -right-4 bottom-0 origin-bottom z-50"
                    initial={{ rotate: 25, opacity: 0, scale: 0.9 }}
                    animate={{ rotate: -64, opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.1 }}
                    transition={{ duration: 0.4, ease: "backIn" }}
                >
                    <div className="relative w-64 h-60">
                        <div className="absolute left-1/2 bottom-0 w-4 h-60 bg-white -translate-x-1/2 border-4 border-black"></div>
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-20 bg-white origin-bottom border-4 border-black"></div>
                    </div>
                </motion.div>
           )}
         </AnimatePresence>

         {phase === 'impact' && (
           <motion.div
               initial={{ scale: 0, rotate: -10 }}
               animate={{ scale: 1, rotate: 0 }}
               transition={{ type: "spring", stiffness: 400, damping: 15 }}
               className="absolute inset-0 flex items-center justify-center z-50"
           >
               <h1 
                className="text-8xl font-display font-retro leading-[1] tracking-tight text-white select-none mix-blend-normal"
                style={{ textShadow: '8px 8px 0px #000000' }}
               >
                DIBS!
               </h1>
           </motion.div>
         )}
       </div>
    </div>
  );
};

// --- 2. WAITING ROOM SCREEN ---
const WaitingScreen = ({ message, nextEvent, onTimerFinished }) => {
    const [timeLeft, setTimeLeft] = useState(null);
    const [quip, setQuip] = useState("PREPARING THE AUCTION BLOCK...");

    const QUIPS = [
    "SHARPENING THE GAVEL...", "POLISHING THE GOODS...", "COUNTING THE COINS...",
    "CALM DOWN, IT'S COMING.", "PATIENCE PAYS OFF.", "NOT YET, TIGER.",
    "GOOD THINGS TAKE TIME.", "STEAMING THE SILK...", "DIGGING IN THE BINS...",
    "UNTANGLING HANGERS...", "CHECKING THE POCKETS...", "DUSTING OFF THE GRAILS...",
    "LOADING THE DRIP...", "WALLETS AT THE READY...", "PREPPING THE SNIPE...",
    "HOLD YOUR HORSES...", "SECURE THE BAG...", "HYPE INCOMING...",
    "THRIFT GODS ARE BUSY...", "DON'T BLINK...", "WAKING THE AUCTIONEER...",
    "CURATING THE CHAOS..."
    ];

    useEffect(() => {
        setQuip(QUIPS[Math.floor(Math.random() * QUIPS.length)]);
        const interval = setInterval(() => {
            setQuip(QUIPS[Math.floor(Math.random() * QUIPS.length)]);
        }, 10000); 
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!nextEvent) return;
        const interval = setInterval(() => {
            const now = new Date().getTime();
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
                    DOORS<br/>LOCKED
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
                    {quip}
                </p>
            </div>
            {nextEvent && (
                <div className="absolute bottom-10 font-mono text-[10px] text-white/40 uppercase">
                    Event Starts: {new Date(nextEvent).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </div>
            )}
        </motion.div>
    );
};

function generateDefaultRoomId() {
      const today = new Date().toISOString().split('T')[0]; // Returns "2023-10-27"
      return `DIBS-${today}`; 
  }

// --- 3. MAIN LOGIN PAGE ---
export const LoginPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [roomId, setRoomId] = useState(searchParams.get('room') || generateDefaultRoomId());

  const [currentScreen, setCurrentScreen] = useState('splash'); 
  const [waitingMessage, setWaitingMessage] = useState("");
  const [nextEventTime, setNextEventTime] = useState(null);

  // Form State
  const [email, setEmail] = useState("");
  const [authKey, setAuthKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  
  // Spectator Modal State
  const [showSpectatorModal, setShowSpectatorModal] = useState(false);
  const [tempCredentials, setTempCredentials] = useState({ email: "", phone: "" });

  const validateEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  useEffect(() => {
      // If URL param is present, strictly obey it (Manual Override)
      if (searchParams.get('room')) return;

      const fetchActiveRoom = async () => {
          try {
              // Check the central config for the "Live" room
              const configRef = ref(db, 'event_config/active_room_id');
              const snapshot = await get(configRef);
              
              if (snapshot.exists()) {
                  setRoomId(snapshot.val()); // Use the Admin-set room
              }
              // Else: It stays as the Date-based default we set in useState
          } catch (err) {
              console.error("Config fetch failed, using default:", roomId);
          }
      };
      
      fetchActiveRoom();
  }, [searchParams]);

  // --- UNIQUE NAMING LOGIC (Refactored for Prefixes) ---
  const getUniqueUsername = async (roomId, userPhone, prefix = "") => {
      const roomRef = ref(db, `audience_data/${roomId}`);
      
      // 1. Snapshot: Get all current users
      const snapshot = await get(roomRef);
      let existingName = null;
      let takenNames = new Set();

      if (snapshot.exists()) {
          const data = snapshot.val();
          Object.values(data).forEach(user => {
              // Persistence Check: If this phone already has a name, return it
              if (user.phone === userPhone) {
                  existingName = user.username;
              }
              // Collect ALL taken names in the room
              if (user.username) {
                  takenNames.add(user.username);
              }
          });
      }

      // If they already have a name (e.g. Spec_NeonTiger), return it immediately
      if (existingName) return existingName;

      // 2. Filter available names
      // We check: Is "Prefix + Name" (e.g. "Spec_NeonTiger") already taken?
      const availableNames = NAME_LIST.filter(name => !takenNames.has(prefix + name));

      // 3. Pick Random or Fallback
      if (availableNames.length > 0) {
          const randomIndex = Math.floor(Math.random() * availableNames.length);
          return prefix + availableNames[randomIndex];
      } else {
          // Fallback: List is full, add random number
          // Result: "Spec_NeonTiger-104"
          const baseName = NAME_LIST[Math.floor(Math.random() * NAME_LIST.length)];
          return `${prefix}${baseName}-${Math.floor(100 + Math.random() * 900)}`;
      }
  };

  const handleSmartLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const inputEmail = email.trim().toLowerCase();
    const inputKey = authKey.trim().toLowerCase(); // CHANGE: lowercase host/mod input


    // --- 1. FORMAT VALIDATION ---
    if (!validateEmail(inputEmail)) { 
        setError("Invalid Email Format"); 
        setLoading(false); return; 
    }
    if (!inputKey) {
        setError("Please enter Phone Number or Password");
        setLoading(false); return;
    }

    // Credentials
   const HOST_EMAIL = (import.meta.env.VITE_HOST_EMAIL || "").toLowerCase();
    const HOST_PWD = (import.meta.env.VITE_HOST_PWD || "").toLowerCase(); // CHANGE: normalize stored host pwd
    const MOD_EMAIL = (import.meta.env.VITE_MODERATOR_EMAIL || "").toLowerCase();
    const MOD_PWD = (import.meta.env.VITE_MODERATOR_PWD || "").toLowerCase(); // CHANGE: normalize stored mod pwd

    // --- 2. HOST/MOD CHECK (Bypass Everything) ---
if (inputEmail === HOST_EMAIL && inputKey === HOST_PWD) {
     // CHANGE HERE: prevent host login if moderator banned host
     const banSnap = await get(ref(db, `rooms/${roomId}/hostModeration/isBanned`));
     if (banSnap.exists() && banSnap.val() === true) {
        setError("Host access has been disabled by the moderator.");
        setLoading(false);
        return;
     }

     await joinRoom('host', 'HOST', 'N/A', inputEmail); return;
}

    if (inputEmail === MOD_EMAIL && inputKey === MOD_PWD) {
         await joinRoom('moderator', 'MODERATOR', 'N/A', inputEmail); return;
    }

    // --- 3. PHONE CLEANING ---
    const cleanPhone = inputKey.replace(/\D/g, '').slice(-10);
    if (cleanPhone.length < 10) {
        logEvent(roomId, 'LOGIN_ERROR', { error: 'Invalid Phone', phone: inputKey });
        setError("Invalid Phone Number"); setLoading(false); return;
    }

    // ============================================================
    // 🛠️ DEV BYPASS: Force Spectator Mode for Testing
    // Type '0000000000' as phone to skip DB/Time checks
    if (cleanPhone === "1212121212") {
        console.log("⚠️ DEV MODE: Forcing Spectator Modal");
        setTempCredentials({ email: inputEmail, phone: cleanPhone });
        setLoading(false);
        setShowSpectatorModal(true); 
        return;
    }
    // ============================================================

    // 1. Log the Attempt
    logEvent(roomId, 'LOGIN_ATTEMPT', { email: inputEmail, phone: cleanPhone });

    try {
  const [blockSnap, testSnapshot, configSnap, guestSnap] = await Promise.all([ //EFF CHANGE
    get(ref(db, `blocked_users/${cleanPhone}`)),
    get(ref(db, `test_allowed_guests/${cleanPhone}`)),
    get(ref(db, "event_config")),
    get(ref(db, `allowed_guests/${cleanPhone}`)),
  ]);

  // --- 4. BLOCK LIST CHECK (Global Ban) ---
  if (blockSnap.exists()) {
    logEvent(roomId, 'LOGIN_BLOCKED', { phone: cleanPhone });
    setError("ACCESS DENIED. You are blocked.");
    setLoading(false);
    return;
  }

  // --- 5. TEST USER CHECK (Bypass Time) ---
  if (testSnapshot.exists()) {
    if (testSnapshot.val().email.toLowerCase() === inputEmail) {
      const uniqueName = await getUniqueUsername(roomId, cleanPhone);
      await joinRoom('audience', `TEST-${cleanPhone}`, cleanPhone, inputEmail, uniqueName);
      return;
    } else {
      setError("Test Email mismatch."); setLoading(false); return;
    }
  }

  // --- 6. TIME GATE (Applies to Registered AND Spectators) ---
  if (configSnap.exists()) {
    const config = configSnap.val();
    const now = new Date();
    const start = new Date(config.startTime);
    const end = new Date(config.endTime);

    if (config.isMaintenanceMode) {
      setWaitingMessage("SYSTEM UNDER MAINTENANCE.");
      setCurrentScreen('waiting'); setLoading(false); return;
    }
    if (now < start) {
      setWaitingMessage("WAIT FOR THE NEXT DROP.");
      setNextEventTime(config.startTime);
      setCurrentScreen('waiting'); setLoading(false); return;
    }
    if (now > end) {
      setWaitingMessage("THIS EVENT HAS ENDED.");
      setCurrentScreen('waiting'); setLoading(false); return;
    }
  }

  // --- 7. ALLOWED GUEST CHECK ---
  if (guestSnap.exists()) {
    if (guestSnap.val().email.toLowerCase() !== inputEmail) {
      setError("Email does not match records."); setLoading(false); return;
    }
    const uniqueName = await getUniqueUsername(roomId, cleanPhone);
    logEvent(roomId, 'LOGIN_SUCCESS', { role: 'audience', phone: cleanPhone });
    await joinRoom('audience', `USER-${cleanPhone}`, cleanPhone, inputEmail, uniqueName);
  } else {
    setTempCredentials({ email: inputEmail, phone: cleanPhone });
    setLoading(false);
    logEvent(roomId, 'LOGIN_UNKNOWN_USER', { phone: cleanPhone });
    setShowSpectatorModal(true); 
  }
} catch (err) {
  console.error(err);
  setError("System Error. Try again.");
  setLoading(false);
}
  };

  const confirmSpectatorJoin = async () => {
      setShowSpectatorModal(false);
      setLoading(true);

      const { email, phone } = tempCredentials;
      const specId = `SPEC-${phone}`;

      try {
          // Record Spectator for Analytics
          logEvent(roomId, 'SPECTATOR_CONVERSION', { phone: tempCredentials.phone });
          
          const unregisteredRef = ref(db, `rooms/${roomId}/unregistered/${phone}`);
          await set(unregisteredRef, {
              email: email,
              phone: phone,
              timestamp: Date.now()
          });

          // --- NAME GENERATION ---
          // Use "Spec_" prefix for spectators so they don't clash with Bidders
          const uniqueName = await getUniqueUsername(roomId, phone, "Spec_");

          // Join with role='spectator' AND pass the name
          await joinRoom('spectator', specId, phone, email, uniqueName);

      } catch (err) {
          console.error("Spectator Join Failed", err);
          setError("Failed to enter as spectator.");
          setLoading(false);
      }
  };

  const joinRoom = async (role, uId, phone, mail, username = null) => {
    try {
        // If no username passed (e.g. Host), default to role
        const finalName = username || role.toUpperCase();

        const userRef = push(ref(db, `audience_data/${roomId}`));
        await set(userRef, {
            email: mail, 
            phone: phone, 
            role: role, 
            userId: uId, 
            username: finalName, // <--- SAVE TO DB
            joinedAt: Date.now(),
            restrictions: { isMuted: false, isBidBanned: false, isKicked: false }
        });
        const indexRef = ref(db, `rooms/${roomId}/audience_index/${uId}`); //EFF CHANGE
        const indexSnap = await get(indexRef); //EFF CHANGE
        const firstSeen = indexSnap.exists() ? indexSnap.val().firstSeen : Date.now(); //EFF CHANGE

        await update(indexRef, { //EFF CHANGE
            userId: uId,
            username: finalName,
            email: mail,
            phone: phone,
            role: role,
            firstSeen,
            lastSeen: Date.now(),
            lastSessionKey: userRef.key,
        });
        navigate(`/room/${roomId}?dbKey=${userRef.key}&uid=${uId}&role=${role}`);
    } catch (err) {
        setError("Failed to join."); setLoading(false);
    }
  };

  return (
    <div className="w-full h-screen bg-[#FF6600] text-white relative overflow-hidden font-sans">
      <AnimatePresence mode="wait">
        
        {/* SCREEN 1: SPLASH */}
        {currentScreen === 'splash' && (
           <CoinStackLoader key="splash" onComplete={() => setCurrentScreen('login')} />
        )}
        
        {/* SCREEN 2: WAITING ROOM */}
        {currentScreen === 'waiting' && (
            <WaitingScreen 
                key="waiting" 
                message={waitingMessage} 
                nextEvent={nextEventTime}
                onTimerFinished={() => {
                    setCurrentScreen('login');
                    setWaitingMessage("");
                }}
            />
        )}

        {/* SCREEN 3: LOGIN FORM */}
        {currentScreen === 'login' && (
            <motion.div 
                key="form"
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                className="flex flex-col items-center justify-center w-full h-full px-6 z-20 relative"
            >
                <div className="flex-1 flex flex-col items-center justify-center w-full relative px-6 space-y-2">
                    
                    <h1 
                        className="text-9xl font-retro font-black leading-[1] tracking-tight text-white select-none mix-blend-normal"
                        style={{ textShadow: '8px 8px 0px #000000' }}
                    >
                    DIBS!
                    </h1>
                    <p className="text-sm font-bold tracking-[0.3em] text-white uppercase font-sans opacity-90">
                    ONE PIECE ONE CHANGE
                    </p>

                    <div className="w-full max-w-xs mt-12 space-y-4">
                        <input
                            type="email"
                            placeholder="EMAIL ADDRESS"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-white/20 border-b-2 border-white text-white font-mono text-center py-4 focus:outline-none focus:bg-white/30 transition-colors placeholder:text-white/60"
                        />
                        
                        <input
                            type="text"
                            placeholder="PHONE NUMBER"
                            value={authKey}
                            onChange={(e) => setAuthKey(e.target.value)}
                            className="w-full bg-white/20 border-b-2 border-white text-white font-mono text-center py-4 focus:outline-none focus:bg-white/30 transition-colors uppercase placeholder:text-white/60"
                        />

                        <AnimatePresence>
                            {error && (
                                <motion.div 
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="flex items-center justify-center gap-2 text-white bg-black/20 p-2 border border-white/20"
                                >
                                    <AlertCircle className="w-3 h-3" />
                                    <span className="text-[10px] font-bold uppercase tracking-wider">{error}</span>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <button 
                            onClick={handleSmartLogin}
                            disabled={loading}
                            className="w-full py-4 border-2 border-white hover:bg-white hover:text-[#FF6600] transition-colors flex flex-col items-center gap-2 group mt-4"
                        >
                            {loading ? (
                                <span className="font-mono text-[10px] tracking-widest uppercase font-bold animate-pulse">CHECKING STATUS...</span>
                            ) : (
                                <>
                                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                    <span className="font-mono text-[10px] tracking-widest uppercase font-bold">ENTER ROOM</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* --- SPECTATOR MODAL --- */}
                <AnimatePresence>
                    {showSpectatorModal && (
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center px-6"
                        >
                            <motion.div 
                                initial={{ scale: 0.9, y: 20 }}
                                animate={{ scale: 1, y: 0 }}
                                className="bg-[#FF6600] border-2 border-white p-6 w-full max-w-sm text-center shadow-2xl relative"
                            >
                                <AlertCircle className="w-12 h-12 text-white mx-auto mb-4" />
                                <h3 className="font-display font-black text-2xl text-white uppercase leading-none mb-2">
                                    UNREGISTERED<br/>USER
                                </h3>
                                <p className="font-mono text-xs text-white/90 leading-relaxed mb-6 border-y border-white/20 py-3">
                                    That phone number is not on the guest list. You can enter in <strong>Spectator Mode</strong> (No Bidding), or retry.
                                </p>
                                
                                <div className="flex flex-col gap-3">
                                    <button 
                                        onClick={confirmSpectatorJoin}
                                        className="w-full py-3 bg-white text-[#FF6600] font-black uppercase tracking-widest text-xs hover:bg-zinc-100 transition-colors"
                                    >
                                        Yes, Enter as Spectator
                                    </button>
                                    
                                    <button 
                                        onClick={() => setShowSpectatorModal(false)}
                                        className="w-full py-3 border border-white text-white font-bold uppercase tracking-widest text-xs hover:bg-white/10 transition-colors"
                                    >
                                        Retry Login
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

            </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};