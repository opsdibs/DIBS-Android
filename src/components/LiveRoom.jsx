import React, { useEffect, useRef, useState } from 'react';
import AgoraRTC from 'agora-rtc-sdk-ng';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { X, Mic, MicOff, Video as VideoIcon, VideoOff, Radio, RefreshCw, Shield, Square } from 'lucide-react';
import { AGORA_APP_ID, AGORA_TOKEN } from '../lib/settings';
import { InteractionLayer } from './InteractionLayer';
import { ModeratorPanel } from './ModeratorPanel';
import { ref, get, onValue, update } from 'firebase/database';
import { db } from '../lib/firebase';
import { startSession, endSession } from '../lib/analytics';

export const LiveRoom = ({ roomId }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // --- SECURITY: VERIFY ROLE FROM DB ---
  const dbKey = searchParams.get('dbKey');
  const [verifiedRole, setVerifiedRole] = useState(null);
  const [isVerifying, setIsVerifying] = useState(true);
  const [currentUsername, setCurrentUsername] = useState(null); // <--- NEW

  // --- STATE FOR REACTIVE CONNECTION ---
  const [isChannelLive, setIsChannelLive] = useState(false); 
  const [streamId, setStreamId] = useState(0); // Forces DOM reset on new stream

  useEffect(() => {
    const verifyUserSession = async () => {
        if (!dbKey) { navigate('/'); return; }
        try {
            const snapshot = await get(ref(db, `audience_data/${roomId}/${dbKey}`));
            if (snapshot.exists()) {
                const data = snapshot.val();
                setVerifiedRole(data.role);
                setCurrentUsername(data.username); // <--- NEW: Capture username
            } else {
                navigate('/'); 
            }
        } catch (error) {
            console.error("Verification failed:", error);
            navigate('/');
        } finally {
            setIsVerifying(false);
        }
    };
    verifyUserSession();
  }, [roomId, dbKey, navigate]);

  // Derived Permissions
  const isHost = verifiedRole === 'host';
  const isModerator = verifiedRole === 'moderator';
  const isSpectator = verifiedRole === 'spectator'; 
  
  // Connection States
  const [joined, setJoined] = useState(false);     
  const [isStreaming, setIsStreaming] = useState(false); 
  const [videoReady, setVideoReady] = useState(false);   
  const [status, setStatus] = useState("INITIALIZING...");

  // UI States
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [cameras, setCameras] = useState([]);
  const [cameraFacingMode, setCameraFacingMode] = useState("environment"); // rear="environment" | front="user"
  const [showModPanel, setShowModPanel] = useState(false);

  // Refs
  const clientRef = useRef(null);
  const localTracksRef = useRef({ audio: null, video: null });
  const analyticsSessionKey = useRef(null);
  const lastKickNowRef = useRef(null); // CHANGE HERE: ignore old kickNow


  useEffect(() => {
    document.body.style.backgroundColor = "black";
    return () => { document.body.style.backgroundColor = ""; };
  }, []);

  // --- 1. LISTENER: TRACK HOST STATUS ---
  useEffect(() => {
    const liveStatusRef = ref(db, `rooms/${roomId}/isLive`);
    const unsub = onValue(liveStatusRef, (snapshot) => {
        const liveStatus = snapshot.val();
        setIsChannelLive(!!liveStatus);
        
        // If going Live, increment ID to force-refresh the viewer's video player
        if (liveStatus) {
            setStreamId(prev => prev + 1);
        }
    });
    return () => unsub();
  }, [roomId]);
  // CHANGE HERE: host kick listener (leave stream + go home)
useEffect(() => {
  if (!isHost) return;

  const kickRef = ref(db, `rooms/${roomId}/hostModeration/kickNow`);
  return onValue(kickRef, async (snap) => {
    const kickedAt = snap.val();

    // CHANGE HERE: ignore the initial onValue() fire and ignore repeats
    if (lastKickNowRef.current === null) {
    lastKickNowRef.current = kickedAt;
    return;
    }
    if (!kickedAt || kickedAt === lastKickNowRef.current) return;
    lastKickNowRef.current = kickedAt;

    try {
      const client = clientRef.current;
      const tracks = [localTracksRef.current.audio, localTracksRef.current.video].filter(Boolean);

      // CHANGE HERE: stop publish + leave agora
      if (client) {
        try { await client.unpublish(tracks); } catch {}
        try { await client.leave(); } catch {}
      }

      // CHANGE HERE: make room not live
      try { await update(ref(db, `rooms/${roomId}`), { isLive: false }); } catch {}

      // CHANGE HERE: send host to home
      navigate('/');
    } catch {
      navigate('/'); // CHANGE HERE: fallback
    }
  });
}, [isHost, roomId, navigate]);

  // --- 2. ANALYTICS SESSION ---
  useEffect(() => {
      if (joined && !analyticsSessionKey.current) {
          analyticsSessionKey.current = startSession(roomId, verifiedRole || 'unknown', verifiedRole);
      }
      return () => {
          if (analyticsSessionKey.current) {
              endSession(roomId, analyticsSessionKey.current);
              analyticsSessionKey.current = null;
          }
      };
  }, [joined, roomId, verifiedRole]);

  // --- NEW: AUTO-ARCHIVE EVENT CONFIG ---
  useEffect(() => {
      // Only the Host performs this administrative task
      if (!isHost || !roomId) return;

      const archiveConfig = async () => {
          try {
              // 1. Check if we already saved the time for this room
              const metaRef = ref(db, `rooms/${roomId}/metadata`);
              const metaSnap = await get(metaRef);

              if (!metaSnap.exists()) {
                  // 2. If not, fetch the GLOBAL config
                  const configRef = ref(db, `event_config`);
                  const configSnap = await get(configRef);

                  if (configSnap.exists()) {
                      const { startTime, endTime } = configSnap.val();
                      
                      // 3. FREEZE it into the room's history
                      await update(ref(db, `rooms/${roomId}/metadata`), {
                          startTime: new Date(startTime).getTime(),
                          endTime: new Date(endTime).getTime(),
                          archivedAt: Date.now()
                      });
                      console.log("✅ Event Config Archived for Analytics");
                  }
              }
          } catch (err) {
              console.error("Failed to archive config", err);
          }
      };

      archiveConfig();
  }, [isHost, roomId]);

  // --- 3. MAIN CONNECTION LOGIC ---
  useEffect(() => {
    // A. GUARD CLAUSE: If Host is Offline, Audience waits here.
    if (!isHost && !isChannelLive) {
        setStatus("WAITING FOR HOST...");
        setJoined(false);
        setIsStreaming(false);
        setVideoReady(false);
        return; 
    }

    let myClient = null;
    let isActive = true;

    const initAgora = async () => {
      try {
        setStatus("CONNECTING...");
        
        let token = null;

        // Try API first
        try {
            const response = await fetch(`/api/token?channelName=${roomId}`);
            if (response.ok) {
                const data = await response.json();
                if (data.token) token = data.token;
            } 
        } catch (err) {
            console.warn("API Token Failed, using fallback");
        }

        // Fallback
        if (!token) token = AGORA_TOKEN; 
        if (!token) throw new Error("No Agora Token found");

        myClient = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
        clientRef.current = myClient;

        if (isHost) {
          await myClient.setClientRole("host");
          try { setCameras(await AgoraRTC.getCameras()); } catch (e) {}
        } else {
          await myClient.setClientRole("audience", { level: 1 });
        }

        myClient.on("user-published", async (user, mediaType) => {
        if (!isActive) return;
        await myClient.subscribe(user, mediaType);
        if (mediaType === "video") {
            const remoteContainer = document.getElementById("remote-video-container");
            if (remoteContainer) {
            remoteContainer.innerHTML = ''; 
            user.videoTrack.play(remoteContainer, { mirror: true }); // CHANGE: mirror viewer playback
            setVideoReady(true);
            setIsStreaming(true);
            }
        }
        if (mediaType === "audio") user.audioTrack.play();
        });

        myClient.on("user-unpublished", (user, mediaType) => {
             if (mediaType === 'video') setIsStreaming(false);
        });

        await myClient.join(AGORA_APP_ID, roomId, token, null);
        
        if (isActive) {
            setJoined(true);
            setStatus(isHost ? "READY TO AIR" : "LIVE");
        }

        // --- HOST CAMERA SETUP ---
        if (isHost) {
          setStatus("STARTING CAMERA...");
          let micTrack, camTrack;
          
          try {
             // FIX: Use standard HD preset instead of aggressive 60fps
             // This prevents "Timeout starting video source" errors
             const tracks = await AgoraRTC.createMicrophoneAndCameraTracks(
                 { echoCancellation: true, noiseSuppression: true },
                 {
                facingMode: cameraFacingMode,
                encoderConfig: {
                    width: 1280,
                    height: 720,
                    frameRate: 30,
                    bitrateMax: 800,   // cap
                    bitrateMin: 500 // optional
                },
                optimizationMode: "motion"
                }

             );
             micTrack = tracks[0];
             camTrack = tracks[1];
          } catch (e) {
             console.warn("HD failed, retrying SD...", e);
             const tracks = await AgoraRTC.createMicrophoneAndCameraTracks(
                undefined,
                { facingMode: cameraFacingMode }
             );
             micTrack = tracks[0];
             camTrack = tracks[1];
          }

          if (!isActive) { 
              micTrack?.close(); camTrack?.close(); return; 
          }

          localTracksRef.current = { audio: micTrack, video: camTrack };
          
          const localContainer = document.getElementById("local-video-container");
          if (localContainer) {
              camTrack.play(localContainer, { mirror: true });
              setVideoReady(true);
              setStatus("READY TO AIR");
          }
        }

      } catch (error) {
        console.error("INIT ERROR:", error);
        if (isActive) setStatus(`ERROR: ${error.message}`);
      }
    };

    initAgora();

    return () => {
      isActive = false;
      const cleanup = async () => {
          if (localTracksRef.current.audio) localTracksRef.current.audio.close();
          if (localTracksRef.current.video) localTracksRef.current.video.close();
          localTracksRef.current = { audio: null, video: null };

          if (myClient) {
              await myClient.unpublish().catch(() => {});
              await myClient.leave().catch(() => {});
              myClient.removeAllListeners();
          }
          clientRef.current = null;
      };
      cleanup();
    };

  // --- FIX: DEPENDENCY TRICK ---
  // If I am Host, ignore 'isChannelLive' changes (don't re-run init).
  // If I am Audience, re-run init when 'isChannelLive' changes.
  }, [roomId, isHost, isHost ? -1 : isChannelLive]); 

  const handleToggleStream = async () => {
      if (!clientRef.current) return;
      const tracks = [localTracksRef.current.audio, localTracksRef.current.video].filter(Boolean);

      try {
          if (isStreaming) {
              setStatus("STOPPING...");
              await clientRef.current.unpublish(tracks);
              setIsStreaming(false);
              setStatus("READY TO AIR");
              await update(ref(db, `rooms/${roomId}`), { isLive: false });
          } else {
              setStatus("PUBLISHING...");
              if (localTracksRef.current.audio) await localTracksRef.current.audio.setEnabled(true);
              await clientRef.current.publish(tracks);
              setIsStreaming(true);
              setStatus("LIVE");
              await update(ref(db, `rooms/${roomId}`), { isLive: true });
          }
      } catch (err) {
          console.error("Toggle Error:", err);
          setStatus("ERROR: " + err.message);
      }
  };

const switchCamera = async () => {
  if (!localTracksRef.current.video) return;

  try {
    const currentTrack = localTracksRef.current.video;
    const nextFacingMode = cameraFacingMode === "environment" ? "user" : "environment";

    // Enforce exactly two states: rear (environment) <-> front (user), both at 1x
    await currentTrack.setDevice({ facingMode: nextFacingMode });
    setCameraFacingMode(nextFacingMode);

    // Ensure preview stays non-mirrored after switching
    const localContainer = document.getElementById("local-video-container");
    if (localContainer) {
      localContainer.innerHTML = "";
      currentTrack.play(localContainer, { mirror: true });
    }
  } catch (err) {
    console.error("Camera switch failed", err);
  }
};

  const toggleMic = async () => {
      if (localTracksRef.current.audio) {
          const newState = !isMicOn;
          await localTracksRef.current.audio.setEnabled(newState);
          setIsMicOn(newState);
      }
  };
  const toggleCam = async () => {
      if (localTracksRef.current.video) {
          const newState = !isCamOn;
          await localTracksRef.current.video.setEnabled(newState);
          setIsCamOn(newState);
      }
  };

  const isLoading = isHost ? !videoReady : (!joined && isChannelLive);

  if (isVerifying) {
      return (
          <div className="w-full h-screen bg-black flex items-center justify-center text-white">
              <div className="flex flex-col items-center gap-4">
                  <div className="w-8 h-8 border-4 border-t-transparent border-[#FF6600] rounded-full animate-spin"></div>
                  <span className="font-mono text-xs uppercase tracking-widest">Verifying Access...</span>
              </div>
          </div>
      );
  }

  return (
    <div className="fixed inset-0 w-full h-[100dvh] bg-black text-white overflow-hidden supports-[height:100dvh]:h-[100dvh]">
      
      {/* LAYER 1: VIDEO */}
      <div className="absolute inset-0 z-0 max-w-md mx-auto w-full bg-black">
        <div id="local-video-container" className={`w-full h-full ${!isHost ? 'hidden' : ''}`}></div>
        
        {/* FIX: key={streamId} forces a fresh DIV for viewers on stream restart */}
        <div 
            key={streamId} 
            id="remote-video-container" 
            className={`w-full h-full ${isHost ? 'hidden' : ''}`}
        ></div>
        
        {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black z-20 flex-col gap-4">
                <span className="font-mono text-xs animate-pulse">CONNECTING...</span>
                <span className="font-mono text-[10px] text-yellow-500 uppercase">{status}</span>
            </div>
        )}

        {!isHost && !isChannelLive && (
             <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 z-10 flex-col gap-4">
                <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse shadow-[0_0_10px_red]"></div>
                <span className="font-display font-black text-2xl uppercase text-zinc-500">OFF AIR</span>
                <span className="font-mono text-xs text-zinc-600 tracking-widest">WAITING FOR SIGNAL...</span>
             </div>
        )}
      </div>

      {/* LAYER 2: INTERACTION */}
      <InteractionLayer 
          roomId={roomId} 
          isHost={isHost} 
          isModerator={isModerator}
          isSpectator={isSpectator} 
          assignedUsername={currentUsername} // <--- NEW PROP
      />

      {/* LAYER 3: SYSTEM CONTROLS */}
      <div className="absolute inset-0 z-50 pointer-events-none p-4 pt-[calc(1rem+env(safe-area-inset-top))] flex flex-col justify-between max-w-md mx-auto w-full">
        
        <div className="flex justify-between items-start pointer-events-auto">
            <div className="flex flex-col items-start gap-0.5">
                <img src="/Dibs. (1).svg" alt="Dibs" className="w-28 -ml-4 -mt-7 block"/>
                <div className={`-mt-5 px-2 py-0.5 rounded-sm flex items-center gap-2 ${isStreaming ? 'bg-red-600' : 'bg-neutral-800'}`}>
                    <span className="font-display font-black text-xs camelcase tracking-widest text-white">
                        {isStreaming ? 'LIVE' : 'OFFLINE'}
                    </span>
                </div>
            </div>
            
            <div className="flex items-center gap-2">
                 {isModerator && (
                     <button 
                        onClick={() => setShowModPanel(!showModPanel)} 
                        className={`p-2 rounded-full transition-colors ${showModPanel ? 'bg-white text-black' : 'bg-black/50 text-white hover:bg-white hover:text-black'}`}
                        title="Toggle Mod Panel"
                     >
                        <Shield className="w-4 h-4" />
                     </button>
                 )}
                 {isHost && (
                     <>
                        {cameras.length > 1 && (
                            <button onClick={switchCamera} className="bg-black/50 p-2 rounded-full hover:bg-white hover:text-black transition-colors">
                                <RefreshCw className="w-4 h-4" />
                            </button>
                        )}
                        <button onClick={toggleMic} className="bg-black/50 p-2 rounded-full hover:bg-white hover:text-black transition-colors">
                            {isMicOn ? <Mic className="w-4 h-4"/> : <MicOff className="w-4 h-4 text-red-500"/>}
                        </button>
                        <button onClick={toggleCam} className="bg-black/50 p-2 rounded-full hover:bg-white hover:text-black transition-colors">
                            {isCamOn ? <VideoIcon className="w-4 h-4"/> : <VideoOff className="w-4 h-4 text-red-500"/>}
                        </button>
                     </>
                 )}
                 <button onClick={() => navigate('/')} className="bg-black/50 p-2 rounded-full hover:bg-white hover:text-black transition-colors">
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>

        {isHost && videoReady && (
            <button
              onClick={handleToggleStream}
              className={`absolute right-4 pointer-events-auto h-14 w-14 rounded-full transition-transform hover:scale-105 shadow-2xl flex items-center justify-center z-[60] ${
                isStreaming
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-white text-black hover:bg-zinc-100'
              }`}
              style={{ bottom: 'calc(6.25rem + env(safe-area-inset-bottom))' }}
              title={isStreaming ? 'End Stream' : 'Go Live'}
              aria-label={isStreaming ? 'End Stream' : 'Go Live'}
            >
              {isStreaming ? (
                <Square className="w-5 h-5 fill-current" />
              ) : (
                <Radio className="w-5 h-5 text-red-600 animate-pulse" />
              )}
            </button>
        )}
        
        {isModerator && showModPanel && (
          <ModeratorPanel roomId={roomId} onClose={() => setShowModPanel(false)} />
        )}
      </div>
    </div>
  );
};
