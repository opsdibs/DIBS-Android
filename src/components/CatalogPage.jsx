import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut, onAuthStateChanged } from 'firebase/auth';
import { ref, get, onValue, push, set, update } from 'firebase/database';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { ShoppingCart, Search, Home, ChartLine, Settings, Bell } from 'lucide-react';
import { auth, db } from '../lib/firebase';

const SESSION_KEY = 'dibs_auth_context';

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
    firebaseUid
  };
}

export const CatalogPage = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [joiningRoom, setJoiningRoom] = useState('');
  const [error, setError] = useState('');

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
              audienceIndex: room?.audience_index || {}
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
                audienceIndex: {}
              });
            }
          } catch (e) {
            console.error('Failed to load active room fallback', e);
          }
        }

        entries.sort((a, b) => {
          if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
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

  const profileUserId = profile?.userId || profile?.firebaseUid || '';

  const yourShows = useMemo(() => {
    if (!profileUserId) return [];

    const userRooms = rooms.filter((room) => !!room.audienceIndex?.[profileUserId]);

    if (profile?.lastRoomId) {
      userRooms.sort((a, b) => {
        if (a.id === profile.lastRoomId) return -1;
        if (b.id === profile.lastRoomId) return 1;
        if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
        return a.id.localeCompare(b.id);
      });
      return userRooms;
    }

    return userRooms;
  }, [rooms, profileUserId, profile?.lastRoomId]);

  const yourSet = useMemo(() => new Set(yourShows.map((r) => r.id)), [yourShows]);

  const upcomingShows = useMemo(
    () => rooms.filter((r) => !r.isLive && !yourSet.has(r.id)),
    [rooms, yourSet]
  );

  const currentShows = useMemo(
    () => rooms.filter((r) => r.isLive && !yourSet.has(r.id)),
    [rooms, yourSet]
  );

  const handleJoinRoom = async (roomId) => {
    if (!profile) return;

    if (!profile.displayName) {
      setError('Display name missing. Please login again.');
      navigate('/login', { replace: true });
      return;
    }

    setError('');
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
      setJoiningRoom('');
    }
  };

  const handleLogout = async () => {
    await signOut(auth).catch(() => {});
    localStorage.removeItem(SESSION_KEY);
    navigate('/login', { replace: true });
  };

  const RailCard = ({ room }) => (
    <button
      onClick={() => handleJoinRoom(room.id)}
      disabled={!!joiningRoom}
      className="w-28 shrink-0 text-left"
    >
      <div className="h-36 rounded-xl bg-[#60626a]" />
      <p className="text-[12px] mt-2 text-zinc-200 truncate">{room.id}</p>
      <p className="text-[12px] text-orange-300">{joiningRoom === room.id ? 'Entering...' : 'Tap to Enter'}</p>
    </button>
  );

  const CurrentCard = ({ room }) => (
    <button
      onClick={() => handleJoinRoom(room.id)}
      disabled={!!joiningRoom}
      className="w-full text-left"
    >
      <div className="h-56 rounded-xl bg-[#60626a]" />
      <p className="text-[12px] mt-2 text-zinc-200 truncate">{room.id}</p>
      <p className="text-[12px] text-orange-300">{joiningRoom === room.id ? 'Entering...' : 'Tap to Enter'}</p>
    </button>
  );

  if (!authReady) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-sm text-zinc-300">Checking session...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto w-full max-w-md min-h-screen relative pb-28">
        <div className="px-6 pt-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-4xl font-semibold leading-none">Hello {profile?.displayName || '{X}'} !</h1>
            <div className="flex items-center gap-4">
              <Bell className="w-5 h-5 text-white" />
              <div className="h-10 w-10 rounded-full bg-[#d56969]" />
            </div>
          </div>

          {error && (
            <div className="mb-3 rounded-md border border-red-500/40 bg-red-950/30 px-2 py-2 text-[11px]">{error}</div>
          )}

          {loadingRooms && <div className="text-xs text-zinc-400 mb-4">Loading shows...</div>}

          <section className="mb-6">
            <h2 className="text-[#ff7a00] text-[40px] font-bold leading-none mb-3">Your Shows</h2>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {yourShows.length > 0 ? yourShows.map((room) => <RailCard key={`your-${room.id}`} room={room} />) : (
                <div className="text-[12px] text-zinc-400">No rooms joined yet.</div>
              )}
            </div>
          </section>

          <section className="mb-6">
            <h2 className="text-[#ff7a00] text-[40px] font-bold leading-none mb-3">Upcoming Shows</h2>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {upcomingShows.length > 0 ? upcomingShows.map((room) => <RailCard key={`upcoming-${room.id}`} room={room} />) : (
                <div className="text-[12px] text-zinc-400">No upcoming rooms.</div>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-[#ff7a00] text-[40px] font-bold leading-none mb-3">Current Shows</h2>
            <div className="grid grid-cols-2 gap-3 pb-4">
              {currentShows.length > 0 ? currentShows.map((room) => (
                <CurrentCard key={`current-${room.id}`} room={room} />
              )) : (
                <p className="text-[12px] text-zinc-400 col-span-2">No current live shows.</p>
              )}
            </div>
          </section>
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-[#0f1012] border-t border-zinc-800/80">
          <div className="mx-auto w-full max-w-md px-6 py-3">
            <div className="grid grid-cols-5 gap-3">
              <button type="button" className="h-10 rounded-lg bg-black flex items-center justify-center" aria-label="nav-cart">
                <ShoppingCart className="w-5 h-5 text-white" />
              </button>
              <button type="button" className="h-10 rounded-lg bg-black flex items-center justify-center" aria-label="nav-search">
                <Search className="w-5 h-5 text-white" />
              </button>
              <button type="button" className="h-10 rounded-lg bg-black flex items-center justify-center" aria-label="nav-home">
                <Home className="w-5 h-5 text-white" />
              </button>
              <button type="button" className="h-10 rounded-lg bg-black flex items-center justify-center" aria-label="nav-insights">
                <ChartLine className="w-5 h-5 text-white" />
              </button>
              <button type="button" onClick={handleLogout} title="Logout" className="h-10 rounded-lg bg-black flex items-center justify-center" aria-label="nav-settings">
                <Settings className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
