import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { signOut, onAuthStateChanged } from 'firebase/auth';
import { ref, get, onValue, push, set, update, runTransaction } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { ShoppingCart, Search, Home, ChartLine, Settings, Bell, Moon, Sun, ChevronDown, ChevronLeft } from 'lucide-react';
import { auth, db, storage } from '../lib/firebase';
import { WaitingScreen } from './WaitingScreen';

const SESSION_KEY = 'dibs_auth_context';
const APP_SETTINGS_KEY = 'dibs_app_settings';

const RSVP_STATUS = {
  REGISTERED: 'registered',
  WAITLISTED: 'waitlisted',
  CANCELLED: 'cancelled'
};

const DEFAULT_RSVP_CONFIG = {
  rsvpOpen: true,
  capacity: 100,
  bookedCount: 0,
  waitlistCount: 0
};

const DEFAULT_APP_SETTINGS = {
  notificationsEnabled: true,
  darkMode: true
};

function sanitizePhone(value = '') {
  return String(value).replace(/\D/g, '').slice(-10);
}

function toE164India(value = '') {
  const digits = sanitizePhone(value);
  return digits ? `+91${digits}` : '';
}

function normalizeProfile(base = {}) {
  const phone = sanitizePhone(base.phone || base.phoneE164 || '');
  const firebaseUid = base.firebaseUid || base.uid || '';

  return {
    role: base.role || 'audience',
    userId: base.userId || firebaseUid || (phone ? `USER-${phone}` : ''),
    phone,
    phoneE164: base.phoneE164 || toE164India(phone),
    email: base.email || (phone ? `${phone}@otp.local` : ''),
    unregistered: !!base.unregistered,
    displayName: String(base.displayName || base.username || '').trim(),
    lastRoomId: String(base.lastRoomId || '').trim(),
    photoURL: String(base.photoURL || '').trim(),
    firebaseUid
  };
}

function parseTimeToMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function getRoomWindow(room = {}) {
  const cfg = room.eventConfig || {};
  const startTimeMs = parseTimeToMs(cfg.startTimeMs ?? cfg.startTime);
  const endTimeMs = parseTimeToMs(cfg.endTimeMs ?? cfg.endTime);
  return { startTimeMs, endTimeMs };
}

function getRoomState(room, nowMs) {
  const { startTimeMs, endTimeMs } = getRoomWindow(room);

  if (startTimeMs && nowMs < startTimeMs) return 'upcoming';
  if (endTimeMs && nowMs >= endTimeMs) return 'ended';
  if (room.isLive) return 'current';
  if (startTimeMs && nowMs >= startTimeMs && (!endTimeMs || nowMs < endTimeMs)) return 'current';

  return 'upcoming';
}

function roomStateRank(state) {
  if (state === 'current') return 0;
  if (state === 'upcoming') return 1;
  return 2;
}

function formatCountdown(msRemaining) {
  const ms = Math.max(0, Number(msRemaining) || 0);
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatDateTime(ms) {
  if (!ms) return 'Schedule TBD';
  return new Date(ms).toLocaleString();
}

function isActiveRsvpStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return normalized === RSVP_STATUS.REGISTERED || normalized === RSVP_STATUS.WAITLISTED;
}

export const CatalogPage = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [userRsvps, setUserRsvps] = useState({});
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [joiningRoom, setJoiningRoom] = useState('');
  const [registeringRoom, setRegisteringRoom] = useState('');
  const [selectedRoomForRsvp, setSelectedRoomForRsvp] = useState(null);
  const [selectedLockedRoom, setSelectedLockedRoom] = useState(null);
  const [showSettingsSheet, setShowSettingsSheet] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [appSettings, setAppSettings] = useState(DEFAULT_APP_SETTINGS);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());
  const avatarInputRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(APP_SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setAppSettings((prev) => ({
        ...prev,
        ...parsed
      }));
    } catch (err) {
      console.error('Failed to load app settings', err);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(appSettings));
    } catch (err) {
      console.error('Failed to persist app settings', err);
    }
  }, [appSettings]);

  useEffect(() => {
    let active = true;

    const hydrateAndSetProfile = async (baseProfile) => {
      const merged = normalizeProfile(baseProfile || {});

      if (merged.firebaseUid) {
        try {
          const snap = await get(ref(db, `users/${merged.firebaseUid}`));
          if (snap.exists()) {
            const val = snap.val() || {};
            merged.displayName = String(val.displayName || val.username || merged.displayName).trim();
            merged.role = val.role || merged.role;
            merged.email = val.email || merged.email;
            merged.lastRoomId = String(val.lastRoomId || merged.lastRoomId || '').trim();
            merged.phone = sanitizePhone(val.phone || merged.phone);
            merged.phoneE164 = val.phoneE164 || merged.phoneE164 || toE164India(merged.phone);
            merged.photoURL = String(val.photoURL || merged.photoURL || '').trim();
          }
        } catch (e) {
          console.error('Failed to hydrate profile', e);
        }
      }

      if (!merged.phone) return null;

      localStorage.setItem(SESSION_KEY, JSON.stringify(merged));
      if (active) setProfile(merged);
      return merged;
    };

    const unsub = onAuthStateChanged(auth, async (user) => {
      let stored = null;
      try {
        stored = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      } catch {
        stored = null;
      }

      const storedNorm = stored ? normalizeProfile(stored) : null;

      if (user?.uid) {
        const fallbackPhone = sanitizePhone(user.phoneNumber || '');
        const merged = await hydrateAndSetProfile({
          ...storedNorm,
          firebaseUid: user.uid,
          userId: storedNorm?.userId || user.uid,
          phone: storedNorm?.phone || fallbackPhone,
          phoneE164: user.phoneNumber || storedNorm?.phoneE164 || toE164India(storedNorm?.phone || fallbackPhone),
          email: storedNorm?.email || (fallbackPhone ? `${fallbackPhone}@otp.local` : '')
        });

        if (!merged) {
          localStorage.removeItem(SESSION_KEY);
          if (active) navigate('/login', { replace: true });
        }

        if (active) setAuthReady(true);
        return;
      }

      if (Capacitor.isNativePlatform()) {
        try {
          const native = await FirebaseAuthentication.getCurrentUser();
          const nativeUser = native?.user;

          if (nativeUser?.uid) {
            const fallbackPhone = sanitizePhone(nativeUser.phoneNumber || '');
            const merged = await hydrateAndSetProfile({
              ...storedNorm,
              firebaseUid: nativeUser.uid,
              userId: storedNorm?.userId || nativeUser.uid,
              phone: storedNorm?.phone || fallbackPhone,
              phoneE164:
                nativeUser.phoneNumber ||
                storedNorm?.phoneE164 ||
                toE164India(storedNorm?.phone || fallbackPhone),
              email: storedNorm?.email || (fallbackPhone ? `${fallbackPhone}@otp.local` : '')
            });

            if (merged) {
              if (active) setAuthReady(true);
              return;
            }
          }
        } catch (err) {
          console.error('Native auth fallback check failed', err);
        }
      }

      if (storedNorm?.phone) {
        const merged = await hydrateAndSetProfile(storedNorm);
        if (merged) {
          if (active) setAuthReady(true);
          return;
        }
      }

      localStorage.removeItem(SESSION_KEY);
      if (active) {
        setAuthReady(true);
        navigate('/login', { replace: true });
      }
    });

    return () => {
      active = false;
      unsub();
    };
  }, [navigate]);

  const rsvpOwnerId = profile?.firebaseUid || profile?.userId || (profile?.phone ? `USER-${profile.phone}` : '');

  useEffect(() => {
    if (!rsvpOwnerId) {
      setUserRsvps({});
      return undefined;
    }

    const rsvpsRef = ref(db, `users/${rsvpOwnerId}/rsvps`);
    const unsubscribe = onValue(
      rsvpsRef,
      (snapshot) => {
        setUserRsvps(snapshot.exists() ? snapshot.val() || {} : {});
      },
      (err) => {
        console.error('Failed to load user RSVPs', err);
      }
    );

    return () => unsubscribe();
  }, [rsvpOwnerId]);

  useEffect(() => {
    const roomsRef = ref(db, 'rooms');
    const unsubscribe = onValue(
      roomsRef,
      async (snapshot) => {
        const entries = [];

        if (snapshot.exists()) {
          const data = snapshot.val() || {};
          Object.entries(data).forEach(([id, room]) => {
            entries.push({
              id,
              isLive: !!room?.isLive,
              audienceCount: room?.audience_index ? Object.keys(room.audience_index).length : 0,
              audienceIndex: room?.audience_index || {},
              eventConfig: room?.event_config || {},
              rsvpConfig: {
                ...DEFAULT_RSVP_CONFIG,
                ...(room?.rsvp_config || {})
              }
            });
          });
        }

        if (entries.length === 0) {
          try {
            const activeSnap = await get(ref(db, 'event_config/active_room_id'));
            if (activeSnap.exists()) {
              entries.push({
                id: String(activeSnap.val()),
                isLive: false,
                audienceCount: 0,
                audienceIndex: {},
                eventConfig: {},
                rsvpConfig: { ...DEFAULT_RSVP_CONFIG }
              });
            }
          } catch (e) {
            console.error('Failed to load active room fallback', e);
          }
        }

        entries.sort((a, b) => {
          const stateDiff = roomStateRank(getRoomState(a, Date.now())) - roomStateRank(getRoomState(b, Date.now()));
          if (stateDiff !== 0) return stateDiff;

          const aStart = getRoomWindow(a).startTimeMs || Number.MAX_SAFE_INTEGER;
          const bStart = getRoomWindow(b).startTimeMs || Number.MAX_SAFE_INTEGER;
          if (aStart !== bStart) return aStart - bStart;

          return a.id.localeCompare(b.id);
        });

        setRooms(entries);
        setLoadingRooms(false);
      },
      (err) => {
        console.error(err);
        setError('Failed to load catalog.');
        setLoadingRooms(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const yourShows = useMemo(() => {
    if (!rsvpOwnerId) return [];

    const userRooms = rooms.filter((room) => {
      const joinedViaRsvp = isActiveRsvpStatus(userRsvps?.[room.id]?.status);
      return joinedViaRsvp;
    });

    userRooms.sort((a, b) => {
      if (profile?.lastRoomId) {
        if (a.id === profile.lastRoomId) return -1;
        if (b.id === profile.lastRoomId) return 1;
      }

      const stateDiff = roomStateRank(getRoomState(a, nowMs)) - roomStateRank(getRoomState(b, nowMs));
      if (stateDiff !== 0) return stateDiff;

      const aStart = getRoomWindow(a).startTimeMs || Number.MAX_SAFE_INTEGER;
      const bStart = getRoomWindow(b).startTimeMs || Number.MAX_SAFE_INTEGER;
      if (aStart !== bStart) return aStart - bStart;

      return a.id.localeCompare(b.id);
    });

    return userRooms;
  }, [rooms, profile?.lastRoomId, rsvpOwnerId, userRsvps, nowMs]);

  const yourSet = useMemo(() => new Set(yourShows.map((r) => r.id)), [yourShows]);

  const upcomingShows = useMemo(
    () => rooms.filter((r) => getRoomState(r, nowMs) === 'upcoming' && !yourSet.has(r.id)),
    [rooms, yourSet, nowMs]
  );

  const currentShows = useMemo(
    () => rooms.filter((r) => getRoomState(r, nowMs) === 'current' && !yourSet.has(r.id)),
    [rooms, yourSet, nowMs]
  );

  const handleJoinRoom = async (roomId) => {
    if (!profile) return;

    if (!profile.displayName) {
      setError('Display name missing. Please login again.');
      setNotice('');
      navigate('/login', { replace: true });
      return;
    }

    setError('');
    setNotice('');
    setJoiningRoom(roomId);

    try {
      const finalName = profile.displayName;
      const role = profile.role || 'audience';
      const userId = profile.userId || profile.firebaseUid || `USER-${profile.phone}`;

      const userRef = push(ref(db, `audience_data/${roomId}`));
      await set(userRef, {
        email: profile.email,
        phone: profile.phone,
        role,
        userId,
        username: finalName,
        joinedAt: Date.now(),
        restrictions: { isMuted: false, isBidBanned: false, isKicked: false }
      });

      const indexRef = ref(db, `rooms/${roomId}/audience_index/${userId}`);
      const indexSnap = await get(indexRef);
      const firstSeen = indexSnap.exists() ? indexSnap.val()?.firstSeen : Date.now();

      await update(indexRef, {
        userId,
        username: finalName,
        email: profile.email,
        phone: profile.phone,
        role,
        firstSeen,
        lastSeen: Date.now(),
        lastSessionKey: userRef.key
      });

      if (profile.unregistered) {
        await set(ref(db, `rooms/${roomId}/unregistered/${profile.phone}`), {
          phone: profile.phone,
          email: profile.email,
          timestamp: Date.now(),
          source: 'otp'
        });
      }

      if (profile.firebaseUid) {
        await update(ref(db, `users/${profile.firebaseUid}`), {
          displayName: finalName,
          username: finalName,
          role,
          phone: profile.phone,
          phoneE164: profile.phoneE164 || toE164India(profile.phone),
          email: profile.email,
          lastLoginAt: Date.now(),
          lastRoomId: roomId
        });

        const nextProfile = { ...profile, lastRoomId: roomId };
        setProfile(nextProfile);
        localStorage.setItem(SESSION_KEY, JSON.stringify(nextProfile));
      }

      navigate(`/room/${roomId}?dbKey=${userRef.key}&uid=${userId}&role=${role}`);
    } catch (err) {
      console.error(err);
      setError('Failed to enter room. Please retry.');
      setNotice('');
      setJoiningRoom('');
    }
  };

  const handleRegisterForSelectedRoom = async () => {
    const room = selectedRoomForRsvp;
    if (!profile || !room) return;

    if (!rsvpOwnerId) {
      setError('Unable to resolve user session. Please login again.');
      setNotice('');
      return;
    }

    const stateNow = getRoomState(room, Date.now());
    if (stateNow !== 'upcoming') {
      setSelectedRoomForRsvp(null);
      setError('Registration closed for this room.');
      setNotice('');
      return;
    }

    setError('');
    setNotice('');
    setRegisteringRoom(room.id);

    try {
      const roomId = room.id;
      const existingRef = ref(db, `rooms/${roomId}/rsvps/${rsvpOwnerId}`);
      const existingSnap = await get(existingRef);

      if (existingSnap.exists()) {
        const existing = existingSnap.val() || {};
        if (isActiveRsvpStatus(existing.status)) {
          setSelectedRoomForRsvp(null);
          setNotice(`Already ${existing.status} for ${roomId}.`);
          return;
        }
      }

      const rsvpConfigRef = ref(db, `rooms/${roomId}/rsvp_config`);
      let assignedStatus = '';

      const txResult = await runTransaction(rsvpConfigRef, (current) => {
        const cfg = {
          ...DEFAULT_RSVP_CONFIG,
          ...(current || {})
        };

        if (cfg.rsvpOpen === false) return;

        const capacity = Number(cfg.capacity) || 0;
        const bookedCount = Number(cfg.bookedCount) || 0;
        const waitlistCount = Number(cfg.waitlistCount) || 0;

        if (capacity > 0 && bookedCount >= capacity) {
          assignedStatus = RSVP_STATUS.WAITLISTED;
          cfg.waitlistCount = waitlistCount + 1;
        } else {
          assignedStatus = RSVP_STATUS.REGISTERED;
          cfg.bookedCount = bookedCount + 1;
        }

        return cfg;
      });

      if (!txResult.committed || !assignedStatus) {
        setError('RSVP is currently closed for this room.');
        setNotice('');
        return;
      }

      const now = Date.now();
      const { startTimeMs, endTimeMs } = getRoomWindow(room);

      const roomRsvpPayload = {
        status: assignedStatus,
        createdAt: now,
        phone: profile.phone,
        displayName: profile.displayName,
        userId: rsvpOwnerId
      };

      const userRsvpPayload = {
        status: assignedStatus,
        roomId,
        startTimeMs: startTimeMs || 0,
        endTimeMs: endTimeMs || 0,
        updatedAt: now
      };

      const updates = {
        [`rooms/${roomId}/rsvps/${rsvpOwnerId}`]: roomRsvpPayload,
        [`users/${rsvpOwnerId}/rsvps/${roomId}`]: userRsvpPayload
      };

      await update(ref(db), updates);

      setUserRsvps((prev) => ({
        ...prev,
        [roomId]: userRsvpPayload
      }));

      setSelectedRoomForRsvp(null);

      if (assignedStatus === RSVP_STATUS.REGISTERED) {
        setNotice(`Registered for ${roomId}. It now appears in Your Shows.`);
      } else {
        setNotice(`Added to waitlist for ${roomId}.`);
      }
      setError('');
    } catch (err) {
      console.error(err);
      setError('Failed to register. Please retry.');
      setNotice('');
    } finally {
      setRegisteringRoom('');
    }
  };

  const handleRoomAction = (room) => {
    if (joiningRoom || registeringRoom) return;

    setError('');
    setNotice('');

    const roomState = getRoomState(room, nowMs);
    const isRegistered = isActiveRsvpStatus(userRsvps?.[room.id]?.status);

    if (roomState === 'ended') {
      setError('This show has ended.');
      return;
    }

    if (roomState === 'upcoming') {
      if (!isRegistered) {
        setSelectedLockedRoom(null);
        setSelectedRoomForRsvp(room);
        return;
      }

      setSelectedRoomForRsvp(null);
      setSelectedLockedRoom(room);
      return;
    }

    setSelectedLockedRoom(null);
    handleJoinRoom(room.id);
  };

  const handleLockedTimerFinished = async () => {
    if (!selectedLockedRoom) return;

    const roomId = selectedLockedRoom.id;
    const roomRef = ref(db, `rooms/${roomId}`);

    try {
      const snap = await get(roomRef);
      const latest = snap.exists() ? snap.val() : {};
      const latestRoom = {
        id: roomId,
        isLive: !!latest?.isLive,
        eventConfig: latest?.event_config || selectedLockedRoom.eventConfig || {}
      };

      const latestState = getRoomState(latestRoom, Date.now());
      if (latestState === 'upcoming') {
        setSelectedLockedRoom(null);
        setError('Room is still locked. Please wait a little more.');
        return;
      }

      setSelectedLockedRoom(null);
      await handleJoinRoom(roomId);
    } catch (err) {
      console.error(err);
      setError('Unable to open room right now. Please retry.');
    }
  };

  const handleLogout = async () => {
    await signOut(auth).catch(() => {});
    localStorage.removeItem(SESSION_KEY);
    setShowSettingsSheet(false);
    navigate('/login', { replace: true });
  };

  const handleGoHome = () => {
    setSelectedRoomForRsvp(null);
    setSelectedLockedRoom(null);
    setShowSettingsSheet(false);
    navigate('/catalog', { replace: true });
  };

  const updateSetting = (key, value) => {
    setAppSettings((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const handleAvatarPick = () => {
    if (uploadingAvatar) return;
    avatarInputRef.current?.click();
  };

  const handleAvatarFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !profile) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.');
      setNotice('');
      return;
    }

    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      setError('Image too large. Use max 5MB.');
      setNotice('');
      return;
    }

    const storageUserId = rsvpOwnerId || profile.firebaseUid || profile.userId;
    if (!storageUserId) {
      setError('Unable to resolve account. Please login again.');
      setNotice('');
      return;
    }

    setUploadingAvatar(true);
    setError('');
    setNotice('');

    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const avatarPath = `user_avatars/${storageUserId}/${Date.now()}-${safeName}`;
      const avatarRef = storageRef(storage, avatarPath);
      await uploadBytes(avatarRef, file, { contentType: file.type || 'image/jpeg' });
      const photoURL = await getDownloadURL(avatarRef);

      await update(ref(db, `users/${storageUserId}`), {
        photoURL,
        updatedAt: Date.now()
      });

      const nextProfile = {
        ...profile,
        photoURL
      };
      setProfile(nextProfile);
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextProfile));
      setNotice('Profile photo updated.');
    } catch (err) {
      console.error('Avatar upload failed:', err);
      setError('Failed to upload image. Please retry.');
      setNotice('');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const getActionLabel = (room) => {
    if (joiningRoom === room.id) return 'Entering...';

    const roomState = getRoomState(room, nowMs);
    const rsvpStatus = String(userRsvps?.[room.id]?.status || '').toLowerCase();
    const isRegistered = isActiveRsvpStatus(rsvpStatus);

    if (roomState === 'ended') return 'Show Ended';

    if (roomState === 'upcoming') {
      if (!isRegistered) return 'Register Slot';
      const { startTimeMs } = getRoomWindow(room);
      return startTimeMs ? `Locked - ${formatCountdown(startTimeMs - nowMs)}` : 'Locked';
    }

    if (rsvpStatus === RSVP_STATUS.WAITLISTED) return 'Waitlisted';
    if (room.isLive) return 'Tap to Enter';
    return 'Tap to Enter';
  };

  const RailCard = ({ room }) => {
    const roomState = getRoomState(room, nowMs);
    const statusText = roomState === 'current' ? (room.isLive ? 'Live' : 'Open') : roomState === 'upcoming' ? 'Upcoming' : 'Ended';

    return (
      <button
        onClick={() => handleRoomAction(room)}
        disabled={!!joiningRoom || !!registeringRoom}
        className="w-28 shrink-0 text-left"
      >
        <div className={`h-36 rounded-xl ${cardThemeClass}`} />
        <p className={`text-[12px] mt-2 truncate ${isDarkMode ? 'text-zinc-200' : 'text-[#1f1f1f]'}`}>{room.id}</p>
        <p className={`text-[11px] ${isDarkMode ? 'text-zinc-400' : 'text-[#5c5c5c]'}`}>{statusText}</p>
        <p className="text-[12px] text-orange-300">{getActionLabel(room)}</p>
      </button>
    );
  };

  const CurrentCard = ({ room }) => {
    const roomState = getRoomState(room, nowMs);
    const statusText = room.isLive ? 'Live Now' : roomState === 'current' ? 'Open Now' : 'Upcoming';

    return (
      <button
        onClick={() => handleRoomAction(room)}
        disabled={!!joiningRoom || !!registeringRoom}
        className="w-full text-left"
      >
        <div className={`h-56 rounded-xl ${cardThemeClass}`} />
        <p className={`text-[12px] mt-2 truncate ${isDarkMode ? 'text-zinc-200' : 'text-[#1f1f1f]'}`}>{room.id}</p>
        <p className={`text-[11px] ${isDarkMode ? 'text-zinc-400' : 'text-[#5c5c5c]'}`}>{statusText}</p>
        <p className="text-[12px] text-orange-300">{getActionLabel(room)}</p>
      </button>
    );
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-sm text-zinc-300">Checking session...</div>
      </div>
    );
  }

  if (selectedLockedRoom) {
    const { startTimeMs } = getRoomWindow(selectedLockedRoom);
    const nextEventIso = startTimeMs ? new Date(startTimeMs).toISOString() : null;

    return (
      <div className="w-full h-screen bg-[#FF6600] text-white relative overflow-hidden font-sans">
        <button
          type="button"
          onClick={() => setSelectedLockedRoom(null)}
          className="absolute top-5 left-4 z-30 h-8 w-8 rounded-full border border-white/35 bg-black/15 backdrop-blur-sm flex items-center justify-center text-white/90"
          aria-label="Go back"
          title="Go back"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <WaitingScreen
          message={`${selectedLockedRoom.id} OPENS SOON`}
          nextEvent={nextEventIso}
          onTimerFinished={handleLockedTimerFinished}
        />
      </div>
    );
  }

  const selectedRoomWindow = getRoomWindow(selectedRoomForRsvp || {});
  const selectedRsvpCfg = {
    ...DEFAULT_RSVP_CONFIG,
    ...(selectedRoomForRsvp?.rsvpConfig || {})
  };
  const seatsLeft = Math.max(0, Number(selectedRsvpCfg.capacity || 0) - Number(selectedRsvpCfg.bookedCount || 0));
  const isDarkMode = appSettings.darkMode !== false;
  const pageThemeClass = isDarkMode ? 'bg-black text-white' : 'bg-[#f2ece1] text-[#191919]';
  const cardThemeClass = isDarkMode ? 'bg-[#60626a]' : 'bg-[#b8b9bf]';
  const bottomBarThemeClass = isDarkMode ? 'bg-[#0f1012] border-zinc-800/80' : 'bg-[#ded9ce] border-[#c8c1b5]';
  const navButtonThemeClass = isDarkMode ? 'bg-black text-white' : 'bg-[#f6f3ec] text-[#111] border border-[#c8c1b5]';

  return (
    <div className={`h-screen overflow-y-auto font-ppmori ${pageThemeClass}`}>
      <div className="mx-auto w-full max-w-md min-h-full relative pb-28">
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarFileChange}
          className="hidden"
        />
        <div className="px-6 pt-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-ppmori-semibold leading-none">Hello {profile?.displayName || '{X}'} !</h1>
            <div className="flex items-center gap-4">
              <Bell className={`w-5 h-5 ${isDarkMode ? 'text-white' : 'text-[#111]'}`} />
              <button
                type="button"
                onClick={handleAvatarPick}
                disabled={uploadingAvatar}
                className="relative h-10 w-10 rounded-full overflow-hidden bg-[#d56969] border border-white/20 disabled:opacity-70"
                aria-label="Change profile photo"
                title="Change profile photo"
              >
                {profile?.photoURL ? (
                  <img src={profile.photoURL} alt="Profile" className="h-full w-full object-cover" />
                ) : (
                  <span className="h-full w-full flex items-center justify-center text-white text-sm font-ppmori-semibold">
                    {String(profile?.displayName || 'U').trim().charAt(0).toUpperCase() || 'U'}
                  </span>
                )}
                {uploadingAvatar && (
                  <span className="absolute inset-0 bg-black/45 flex items-center justify-center text-[10px] text-white">...</span>
                )}
              </button>
            </div>
          </div>

          <AnimatePresence mode="popLayout">
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="mb-3 rounded-md border border-red-500/40 bg-red-950/30 px-2 py-2 text-[11px]"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="popLayout">
            {notice && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="mb-3 rounded-md border border-emerald-500/40 bg-emerald-950/30 px-2 py-2 text-[11px]"
              >
                {notice}
              </motion.div>
            )}
          </AnimatePresence>

          {loadingRooms && <div className="text-xs text-zinc-400 mb-4">Loading shows...</div>}

          <section className="mb-6">
            <h2 className="text-[#ff7a00] text-[28px] font-ppmori-semibold leading-none mb-3">Your Shows</h2>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {yourShows.length > 0 ? yourShows.map((room) => <RailCard key={`your-${room.id}`} room={room} />) : (
                <div className={`text-[12px] ${isDarkMode ? 'text-zinc-400' : 'text-[#5c5c5c]'}`}>No RSVP shows yet.</div>
              )}
            </div>
          </section>

          <section className="mb-6">
            <h2 className="text-[#ff7a00] text-[28px] font-ppmori-semibold leading-none mb-3">Upcoming Shows</h2>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {upcomingShows.length > 0 ? upcomingShows.map((room) => <RailCard key={`upcoming-${room.id}`} room={room} />) : (
                <div className={`text-[12px] ${isDarkMode ? 'text-zinc-400' : 'text-[#5c5c5c]'}`}>No upcoming rooms.</div>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-[#ff7a00] text-[28px] font-ppmori-semibold leading-none mb-3">Current Shows</h2>
            <div className="grid grid-cols-2 gap-3 pb-4">
              {currentShows.length > 0 ? currentShows.map((room) => (
                <CurrentCard key={`current-${room.id}`} room={room} />
              )) : (
                <p className={`text-[12px] col-span-2 ${isDarkMode ? 'text-zinc-400' : 'text-[#5c5c5c]'}`}>No current live shows.</p>
              )}
            </div>
          </section>
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-40">
          <div className="mx-auto w-full max-w-md px-3">
            <div className={`w-full border border-b-0 rounded-t-[8px] overflow-hidden ${bottomBarThemeClass}`}>
              <div className="px-3 py-2.5">
              <div className="grid grid-cols-5 gap-3">
              <button type="button" className={`h-10 rounded-lg flex items-center justify-center ${navButtonThemeClass}`} aria-label="nav-cart">
                <ShoppingCart className="w-5 h-5" />
              </button>
              <button type="button" className={`h-10 rounded-lg flex items-center justify-center ${navButtonThemeClass}`} aria-label="nav-search">
                <Search className="w-5 h-5" />
              </button>
              <button type="button" onClick={handleGoHome} className={`h-10 rounded-lg flex items-center justify-center ${navButtonThemeClass}`} aria-label="nav-home">
                <Home className="w-5 h-5" />
              </button>
              <button type="button" className={`h-10 rounded-lg flex items-center justify-center ${navButtonThemeClass}`} aria-label="nav-insights">
                <ChartLine className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setShowSettingsSheet(true)}
                title="App Settings"
                className={`h-10 rounded-lg flex items-center justify-center ${navButtonThemeClass}`}
                aria-label="nav-settings"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
        </div>
        </div>

        <AnimatePresence>
          {showSettingsSheet && (
            <motion.div
              className="fixed inset-0 z-50 bg-black/70 flex items-end"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowSettingsSheet(false)}
            >
              <motion.div
                className={`w-full max-w-md mx-auto rounded-t-2xl border p-5 ${isDarkMode ? 'border-zinc-800 bg-[#111214] text-white' : 'border-[#c8c1b5] bg-[#f6f1e8] text-[#111]'}`}
                initial={{ y: 44, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 44, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.75 }}
                onClick={(e) => e.stopPropagation()}
              >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-ppmori-semibold">App Settings</h3>
                <button
                  type="button"
                  onClick={() => setShowSettingsSheet(false)}
                  className={`h-8 w-8 rounded-full border flex items-center justify-center ${isDarkMode ? 'text-zinc-300 border-zinc-700 bg-black/30' : 'text-[#3d3d3d] border-[#c8c1b5] bg-white/70'}`}
                  aria-label="Close settings"
                  title="Close settings"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.03 }}
                className={`rounded-xl border p-3 mb-3 ${isDarkMode ? 'border-zinc-800 bg-black/30' : 'border-[#c8c1b5] bg-white/60'}`}
              >
                <p className="text-sm font-ppmori-semibold mb-1">Account</p>
                <p className={`text-xs ${isDarkMode ? 'text-zinc-300' : 'text-[#3d3d3d]'}`}>Name: {profile?.displayName || 'N/A'}</p>
                <p className={`text-xs ${isDarkMode ? 'text-zinc-300' : 'text-[#3d3d3d]'}`}>Phone: {profile?.phone || 'N/A'}</p>
                <p className={`text-xs ${isDarkMode ? 'text-zinc-300' : 'text-[#3d3d3d]'}`}>Email: {profile?.email || 'N/A'}</p>
                <p className={`text-[11px] mt-2 ${isDarkMode ? 'text-zinc-400' : 'text-[#5c5c5c]'}`}>Tip: tap the profile circle on top to change photo.</p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.06 }}
                className={`rounded-xl border p-3 mb-3 ${isDarkMode ? 'border-zinc-800 bg-black/30' : 'border-[#c8c1b5] bg-white/60'}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-ppmori-semibold">Notifications</p>
                    <p className={`text-xs ${isDarkMode ? 'text-zinc-400' : 'text-[#5c5c5c]'}`}>Enable app alerts and room reminders</p>
                  </div>
                  <motion.button
                    type="button"
                    onClick={() => updateSetting('notificationsEnabled', !appSettings.notificationsEnabled)}
                    whileTap={{ scale: 0.96 }}
                    className={`relative h-8 w-14 rounded-full border transition-colors ${appSettings.notificationsEnabled ? 'bg-emerald-500/90 border-emerald-300/80' : (isDarkMode ? 'bg-zinc-800 border-zinc-600' : 'bg-[#d8d1c6] border-[#b6aa98]')}`}
                    aria-label="Toggle notifications"
                    title="Toggle notifications"
                  >
                    <motion.span
                      className="absolute top-1 left-1 h-6 w-6 rounded-full bg-white text-black flex items-center justify-center text-[10px] font-semibold"
                      animate={{ x: appSettings.notificationsEnabled ? 24 : 0 }}
                      transition={{ type: 'spring', stiffness: 520, damping: 32 }}
                    >
                      {appSettings.notificationsEnabled ? 'On' : 'Off'}
                    </motion.span>
                  </motion.button>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.09 }}
                className={`rounded-xl border p-3 mb-5 ${isDarkMode ? 'border-zinc-800 bg-black/30' : 'border-[#c8c1b5] bg-white/60'}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-ppmori-semibold">Dark Mode</p>
                    <p className={`text-xs ${isDarkMode ? 'text-zinc-400' : 'text-[#5c5c5c]'}`}>Switch between dark and light theme</p>
                  </div>
                  <motion.button
                    type="button"
                    onClick={() => updateSetting('darkMode', !isDarkMode)}
                    whileTap={{ scale: 0.96 }}
                    className={`relative h-8 w-14 rounded-full border transition-colors ${isDarkMode ? 'bg-[#2d3340] border-[#4e586c]' : 'bg-[#f3d28a] border-[#d8ad4e]'}`}
                    aria-label="Toggle dark mode"
                    title="Toggle dark mode"
                  >
                    <motion.span
                      className={`absolute top-1 left-1 h-6 w-6 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-[#0f1012] text-white' : 'bg-white text-[#111]'}`}
                      animate={{ x: isDarkMode ? 24 : 0 }}
                      transition={{ type: 'spring', stiffness: 520, damping: 32 }}
                    >
                      {isDarkMode ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
                    </motion.span>
                  </motion.button>
                </div>
              </motion.div>

              <motion.button
                type="button"
                onClick={handleLogout}
                className="w-full h-11 rounded-lg bg-orange-500 text-black font-ppmori-semibold"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.12 }}
                whileTap={{ scale: 0.98 }}
              >
                Logout
              </motion.button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {selectedRoomForRsvp && (
            <motion.div
              className="fixed inset-0 z-50 bg-black/70 flex items-end"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setSelectedRoomForRsvp(null)}
            >
              <motion.div
                className="w-full max-w-md mx-auto rounded-t-2xl border border-zinc-800 bg-[#111214] p-5"
                initial={{ y: 48, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 48, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.75 }}
                onClick={(e) => e.stopPropagation()}
              >
              <h3 className="text-lg font-semibold text-white">Register for {selectedRoomForRsvp.id}</h3>
              <p className="text-xs text-zinc-300 mt-2">Starts: {formatDateTime(selectedRoomWindow.startTimeMs)}</p>
              <p className="text-xs text-zinc-300">Ends: {formatDateTime(selectedRoomWindow.endTimeMs)}</p>
              <p className="text-xs text-zinc-400 mt-3">
                Seats left: {seatsLeft} / {selectedRsvpCfg.capacity}
              </p>
              {!selectedRsvpCfg.rsvpOpen && (
                <p className="text-xs text-red-300 mt-1">RSVP is closed for this room.</p>
              )}

              <div className="mt-5 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="h-11 rounded-lg bg-zinc-800 text-white"
                  onClick={() => setSelectedRoomForRsvp(null)}
                  disabled={!!registeringRoom}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="h-11 rounded-lg bg-orange-500 text-black font-semibold disabled:opacity-50"
                  onClick={handleRegisterForSelectedRoom}
                  disabled={!!registeringRoom || selectedRsvpCfg.rsvpOpen === false}
                >
                  {registeringRoom ? 'Registering...' : 'Confirm RSVP'}
                </button>
              </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
