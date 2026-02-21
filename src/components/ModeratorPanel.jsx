import React, { useEffect, useState } from 'react';
import { ref, onValue, update, remove } from 'firebase/database';
import { db } from '../lib/firebase';
import { Shield, MessageSquareOff, Ban, Gavel, XCircle, History, X, UserX, UserCheck } from 'lucide-react'; // CHANGE HERE


export const ModeratorPanel = ({ roomId, onClose }) => {
  const [activeTab, setActiveTab] = useState('users'); // 'users' or 'history'
  const [users, setUsers] = useState([]);
  const [history, setHistory] = useState([]);
  const [onlineIds, setOnlineIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [onlineData, setOnlineData] = useState({});
  const [hostUser, setHostUser] = useState(null); // NEW: latest host session 
  const [hostChatMuted, setHostChatMutedState] = useState(false); // CHANGE HERE: drive active UI state
  const [hostBanned, setHostBannedState] = useState(false);       // CHANGE HERE: drive active UI state

  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;


  // 1. Fetch & Process Audience List
  useEffect(() => {
    const usersRef = ref(db, `rooms/${roomId}/audience_index`); //EFF CHANGE
return onValue(usersRef, (snapshot) => { //EFF CHANGE
  const data = snapshot.val() || {};

  const rawList = Object.entries(data).map(([userId, val]) => ({
    userId,
    dbKey: val.lastSessionKey || null, //EFF CHANGE
    ...val
  }));

  const latestHost =
    rawList
      .filter(u => u.role === 'host')
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))[0] || null;
  setHostUser(latestHost);

  const processed = rawList
    .filter(u => u.role !== 'host' && u.role !== 'moderator')
    .map(user => {
      const presence = onlineData[user.userId];
      return {
        ...user,
        isOnline: !!presence,
        presenceState: presence ? presence.state : 'offline'
      };
    })
    .sort((a, b) => {
      if (a.isOnline === b.isOnline) return (b.lastSeen || 0) - (a.lastSeen || 0);
      return a.isOnline ? -1 : 1;
    });

  setUsers(processed);
});
    
    
  }, [roomId, onlineData]); // Added onlineIds as dependency to re-sort when presence changes

  // 2. Fetch Auction History
  useEffect(() => {
    const historyRef = ref(db, `rooms/${roomId}/auctionHistory`);
    return onValue(historyRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // Sort by timestamp descending
        const histList = Object.values(data).sort((a, b) => b.timestamp - a.timestamp);
        setHistory(histList);
      }
    });
  }, [roomId]);

  // 3. Fetch Online Presence (Real-time)
  useEffect(() => {
    const presenceRef = ref(db, `rooms/${roomId}/viewers`);
    return onValue(presenceRef, (snapshot) => {
      const data = snapshot.val();
      setOnlineData(data || {}); // Store the whole object, not just keys
    });
  }, [roomId]);

  // CHANGE HERE: listen to host moderation flags so buttons can show active/inactive
useEffect(() => {
  const muteRef = ref(db, `rooms/${roomId}/hostModeration/chatMuted`);
  const banRef = ref(db, `rooms/${roomId}/hostModeration/isBanned`);

  const unsubMute = onValue(muteRef, (snap) => setHostChatMutedState(!!snap.val()));
  const unsubBan = onValue(banRef, (snap) => setHostBannedState(!!snap.val()));

  return () => {
    unsubMute();
    unsubBan();
  };
}, [roomId]);

      // --- ACTIONS ---
    const toggleRestriction = (user, type) => {
      const sessionKey = user.lastSessionKey || user.dbKey; //EFF CHANGE
      const updates = {};
      updates[`audience_data/${roomId}/${sessionKey}/restrictions/${type}`] = !user.restrictions?.[type];
      update(ref(db), updates);
    };

    const kickUser = (user) => {
      const sessionKey = user.lastSessionKey || user.dbKey; //EFF CHANGE
      if (!window.confirm(`Kick ${user.userId}?`)) return;
      const updates = {};
      updates[`audience_data/${roomId}/${sessionKey}/restrictions/isKicked`] = true;
      update(ref(db), updates);
    };

  // CHANGE HERE: moderator mutes/unmutes host chat
  const setHostChatMuted = async (enabled) => {
    await update(ref(db), {
      [`rooms/${roomId}/hostModeration/chatMuted`]: enabled,
      ...(hostUser?.dbKey
        ? { [`audience_data/${roomId}/${hostUser.dbKey}/restrictions/isMuted`]: enabled }
        : {}),
    });
  };

  // CHANGE HERE: moderator kicks host (end stream + force host to go home via LiveRoom listener)
  const kickHostNow = async () => {
    const now = Date.now();
    await update(ref(db), {
      [`rooms/${roomId}/hostModeration/kickNow`]: now,
      [`rooms/${roomId}/isLive`]: false,
      ...(hostUser?.dbKey
        ? { [`audience_data/${roomId}/${hostUser.dbKey}/restrictions/isKicked`]: true }
        : {}),
    });
  };

  // CHANGE HERE: moderator bans/unbans host login (ban also kicks host immediately)
  const setHostBanned = async (enabled) => {
    await update(ref(db), {
    [`rooms/${roomId}/hostModeration/isBanned`]: enabled,
    ...(enabled ? {} : { [`rooms/${roomId}/hostModeration/kickNow`]: null }), // CHANGE HERE
  });

  if (enabled) await kickHostNow();
};

  
  // Calculate Stats on the fly based on the processed 'users' list
  const stats = users.reduce((acc, user) => {
      if (user.role === 'spectator') {
          user.isOnline ? acc.activeSpectators++ : acc.inactiveSpectators++;
      } else {
          // Defaults to Audience (Bidders)
          user.isOnline ? acc.activeAudience++ : acc.inactiveAudience++;
      }
      return acc;
  }, { activeAudience: 0, inactiveAudience: 0, activeSpectators: 0, inactiveSpectators: 0 });

  return (
    <div className="absolute top-20 left-4 right-4 bottom-32 bg-black/80 backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden flex flex-col z-50 pointer-events-auto shadow-2xl">
      
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex justify-between items-center bg-zinc-900">
        <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-500" />
            <span className="font-bold text-white uppercase tracking-wider hidden sm:block">Mod Panel</span>
        </div>
        
        <div className="flex items-center gap-2">
            {/* SEARCH BAR (New) */}
            {activeTab === 'users' && (
                <input 
                    type="text" 
                    placeholder="Search user..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="bg-black/50 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-white/30 w-24 sm:w-32 transition-all placeholder:text-zinc-600"
                />
            )}

            <div className="flex bg-black rounded-lg p-1 gap-1">
                <button onClick={() => setActiveTab('users')} className={`px-3 py-1 rounded text-[10px] font-bold uppercase ${activeTab === 'users' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}>Viewers</button>
                <button onClick={() => setActiveTab('history')} className={`px-3 py-1 rounded text-[10px] font-bold uppercase ${activeTab === 'history' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}>History</button>
            </div>
            
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-zinc-400 hover:text-white">
                <X className="w-5 h-5" />
            </button>
        </div>
      </div>

      {/* STATS BAR */}
      <div className="grid grid-cols-4 gap-2 p-4 border-b border-white/10 bg-black/50">
          <StatBox label="Active Bidders" count={stats.activeAudience} color="text-green-500" />
          <StatBox label="Active Specs" count={stats.activeSpectators} color="text-yellow-500" />
          <StatBox label="Offline Bidders" count={stats.inactiveAudience} color="text-zinc-500" />
          <StatBox label="Offline Specs" count={stats.inactiveSpectators} color="text-zinc-600" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {activeTab === 'users' && (
  <div className="bg-white/5 border border-white/10 p-3 rounded-xl">
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col">
        <div className="text-xs font-bold text-white">Host Controls</div>
        <div className="text-[10px] text-zinc-500 font-mono">
          {hostUser ? (hostUser.username || hostUser.userId) : "No host detected"}
        </div>
      </div>

      {/* CHANGE HERE: icon actions, same style as user row */}
      <div className="flex items-center gap-2">
      <button
        onClick={() => setHostChatMuted(!hostChatMuted)}
        disabled={!hostUser}
        className={`p-2 rounded-lg border ${
          !hostUser
            ? 'opacity-40 cursor-not-allowed border-white/10 text-zinc-600'
            : hostChatMuted
              ? 'bg-red-500 border-red-500 text-white'
              : 'border-white/10 text-zinc-400 hover:bg-white/10'
        }`}
        title={hostChatMuted ? "Unmute Host Chat" : "Mute Host Chat"}
        >
        <MessageSquareOff className="w-3 h-3" />
      </button>

        <button
          onClick={() => kickHostNow()}
          disabled={!hostUser}
          className={`p-2 rounded-lg border ${!hostUser ? 'opacity-40 cursor-not-allowed border-red-900/30 text-red-900' : 'border-red-900/30 text-red-500 hover:bg-red-900/20'}`}
          title="Kick Host (End Stream)"
        >
          <Ban className="w-3 h-3" />
        </button>

         <button
          onClick={() => setHostBanned(!hostBanned)}
          className={`p-2 rounded-lg border ${
            hostBanned
              ? 'bg-red-500 border-red-500 text-white'
              : 'border-red-900/30 text-red-500 hover:bg-red-900/20'
          }`}
          title={hostBanned ? "Unban Host Login" : "Ban Host Login"}
        >
          <UserX className="w-3 h-3" />
        </button>
      </div>
    </div>
  </div>
)}
        
        {/* VIEWERS TAB */}
        {activeTab === 'users' && users
            .filter(user => {
                if (!searchTerm) return true;
                const term = searchTerm.toLowerCase();
                  const name = (user.username || user.userId || "").toLowerCase();
                  const id = (user.userId || "").toLowerCase();
                  const email = (user.email || "").toLowerCase();
                  const phone = (user.phone || "").toLowerCase();

                  return (
                    name.includes(term) ||
                    id.includes(term) ||
                    email.includes(term) ||
                    phone.includes(term)
                  );
            }).map(user => {
                const isSpectator = user.role === 'spectator';
                // FIX: Use the property that already exists on the user object
                const isOnline = user.isOnline; 
                
                return (
                    <div 
                        key={user.dbKey} 
                        className={`
                            flex items-center justify-between p-3 rounded-xl border transition-all mb-2 group
                            ${isOnline 
                                ? (isSpectator ? 'bg-yellow-900/10 border-yellow-500/20' : 'bg-zinc-800/50 border-white/10') 
                                : 'bg-black/40 border-white/5 opacity-50'
                            }
                        `}
                    >
                        {/* LEFT: INFO */}
                        <div className="flex items-center gap-3">
                            {/* Status Dot */}
                        <div className={`
                            w-2.5 h-2.5 rounded-full shadow-sm transition-colors
                            ${user.isOnline 
                                ? (user.presenceState === 'idle' 
                                    ? 'bg-orange-500' // Idle
                                    : 'bg-green-500 animate-pulse') // Active 
                                : 'bg-red-900/50' // Offline
                            }
                        `} title={user.presenceState === 'idle' ? "Background/Idle" : "Active"} />
                            
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                    <span className={`font-mono text-sm font-bold ${isOnline ? 'text-white' : 'text-zinc-500'}`}>
                                        {user.username || user.userId} 
                                    </span>
                                    
                                    {/* ROLE BADGE */}
                                    {isSpectator ? (
                                        <span className="px-1.5 py-0.5 bg-yellow-500/10 border border-yellow-500/50 text-yellow-500 text-[9px] font-black uppercase rounded" title="Spectator">
                                            SPEC
                                        </span>
                                    ) : (
                                        <span className="px-1.5 py-0.5 bg-blue-500/10 border border-blue-500/50 text-blue-500 text-[9px] font-black uppercase rounded" title="Bidder">
                                            BIDDER
                                        </span>
                                    )}

                                    {user.restrictions?.isKicked && <span className="text-[10px] bg-red-500 px-1 rounded text-white">KICKED</span>}
                                </div>
                                <div className="text-[10px] text-zinc-500 truncate max-w-[150px] font-mono">
                                    {user.userId} | {user.email}
                                    {!isOnline && <span className="ml-1 italic opacity-50">(Offline)</span>}
                                </div>
                            </div>
                        </div>

                        {/* RIGHT: ACTIONS (Hidden until hover) */}
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                                onClick={() => toggleRestriction(user, 'isMuted')}
                                className={`p-2 rounded-lg border ${user.restrictions?.isMuted ? 'bg-red-500 border-red-500 text-white' : 'border-white/10 text-zinc-400 hover:bg-white/10'}`}
                                title="Mute Chat"
                            >
                                <MessageSquareOff className="w-3 h-3" />
                            </button>

                            {!isSpectator && (
                                <button 
                                    onClick={() => toggleRestriction(user, 'isBidBanned')}
                                    className={`p-2 rounded-lg border ${user.restrictions?.isBidBanned ? 'bg-red-500 border-red-500 text-white' : 'border-white/10 text-zinc-400 hover:bg-white/10'}`}
                                    title="Ban from Bidding"
                                >
                                    <Gavel className="w-3 h-3" />
                                </button>
                            )}

                            <button 
                                onClick={() => kickUser(user)}
                                className="p-2 rounded-lg border border-red-900/30 text-red-500 hover:bg-red-900/20"
                                title="Kick User"
                            >
                                <Ban className="w-3 h-3" />
                            </button>
                        </div>
                    </div>
                );
            })}

        {/* AUCTION HISTORY TAB */}
        {activeTab === 'history' && history.map((item, i) => (
            <div key={i} className="bg-white/5 border border-white/5 p-3 rounded-xl space-y-2">
                <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="font-bold text-white text-sm">
                      {/* CHANGE: prefer snapshot if present */}
                      {item.item?.name || item.itemName}
                    </span>
                    <span className="font-mono text-dibs-neon">Sold: ₹{item.finalPrice}</span>
                </div>
                
                <div className="space-y-1">
                    <span className="text-[10px] uppercase text-zinc-500 font-bold">Top Bidders</span>
                    {item.topBidders && item.topBidders.map((bidder, idx) => (
                        <div key={idx} className="flex justify-between text-xs">
                            <span className="text-zinc-300">
                              {idx + 1}. {bidder.user} {bidder.phone ? `(${bidder.phone})` : ""}
                            </span>
                            <span className="font-mono text-zinc-500">₹{bidder.amount}</span>
                        </div>
                    ))}
                </div>
                <div className="text-[10px] text-right text-zinc-600 font-mono pt-1">
                    Winner: {item.winner}
                </div>
            </div>
        ))}

        {activeTab === 'history' && history.length === 0 && (
            <div className="text-center text-zinc-500 text-xs mt-10">No auctions finished yet.</div>
        )}
      </div>
    </div>
  );
};

// --- ADD AT THE BOTTOM OF THE FILE ---
const StatBox = ({ label, count, color }) => (
    <div className="flex flex-col items-center justify-center bg-white/5 rounded-lg py-2">
        <span className={`font-display font-black text-xl ${color}`}>{count}</span>
        <span className="text-[8px] font-mono uppercase text-zinc-400 text-center leading-tight">{label}</span>
    </div>
);