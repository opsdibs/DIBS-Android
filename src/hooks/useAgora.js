import { useState, useEffect, useRef } from 'react';
import AgoraRTC from 'agora-rtc-sdk-ng';

// GLOBAL INSTANCE: Created outside the component to prevent re-initialization
const client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });

export const useAgora = (appId, channelName, role) => {
  const [localVideoTrack, setLocalVideoTrack] = useState(null);
  const [localAudioTrack, setLocalAudioTrack] = useState(null);
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [joinState, setJoinState] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!appId || !channelName) return;

    let mounted = true;

    const initAgora = async () => {
      try {
        // 1. Event Listeners
        client.on("user-published", async (user, mediaType) => {
          await client.subscribe(user, mediaType);
          if (mediaType === "video") {
            setRemoteUsers((prev) => {
              // Avoid duplicates
              const others = prev.filter((u) => u.uid !== user.uid);
              return [...others, user];
            });
          }
          if (mediaType === "audio") {
            user.audioTrack.play();
          }
        });

        client.on("user-unpublished", (user) => {
          setRemoteUsers((prev) => prev.filter((u) => u.uid !== user.uid));
        });

        // 2. Set Role
        // 'host' latency < 200ms, 'audience' latency 1s-2s (ultra low latency mode)
        await client.setClientRole(role, { level: role === 'host' ? 1 : 2 });

        // 3. Join Channel
        // UID is set to null so Agora assigns one automatically
        await client.join(appId, channelName, null, null);

        // 4. Create Tracks (If Host)
        if (role === 'host' && mounted) {
          const [mic, cam] = await AgoraRTC.createMicrophoneAndCameraTracks();
          setLocalAudioTrack(mic);
          setLocalVideoTrack(cam);
          await client.publish([mic, cam]);
        }

        if (mounted) setJoinState(true);

      } catch (err) {
        console.error("Agora Error:", err);
        if (mounted) setError(err);
      }
    };

    initAgora();

    // CLEANUP FUNCTION
    return () => {
      mounted = false;
      localAudioTrack?.close();
      localVideoTrack?.close();
      client.removeAllListeners();
      client.leave();
    };
  }, [appId, channelName, role]);

  return { localVideoTrack, localAudioTrack, remoteUsers, joinState, error };
};