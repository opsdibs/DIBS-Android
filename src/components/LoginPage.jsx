import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, ChevronLeft, Mail } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { ref, push, set, get, update } from 'firebase/database';
import { onAuthStateChanged, RecaptchaVerifier, signInAnonymously, signInWithPhoneNumber } from 'firebase/auth';
import { db, auth } from '../lib/firebase';
import { logEvent } from '../lib/analytics';
import { NAME_LIST } from '../lib/username_list';
import { WaitingScreen } from './WaitingScreen';

const CoinStackLoader = ({ onComplete }) => {
  const [coinCount, setCoinCount] = useState(0);
  const [phase, setPhase] = useState('stacking');
  const totalCoins = 5;

  useEffect(() => {
    if (phase !== 'stacking') return undefined;
    const interval = setInterval(() => {
      setCoinCount((prev) => {
        if (prev >= totalCoins) {
          clearInterval(interval);
          setPhase('hammer');
          return prev;
        }
        return prev + 1;
      });
    }, 200);
    return () => clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    if (phase === 'hammer') {
      const timer = setTimeout(() => setPhase('impact'), 400);
      return () => clearTimeout(timer);
    }
    if (phase === 'impact') {
      const timer = setTimeout(() => onComplete(), 1500);
      return () => clearTimeout(timer);
    }
    return undefined;
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
          {phase !== 'impact' &&
            Array.from({ length: coinCount }).map((_, i) => (
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
              transition={{ duration: 0.4, ease: 'backIn' }}
            >
              <div className="relative w-64 h-60">
                <div className="absolute left-1/2 bottom-0 w-4 h-60 bg-white -translate-x-1/2 border-4 border-black" />
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-20 bg-white origin-bottom border-4 border-black" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {phase === 'impact' && (
          <motion.div
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
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

function generateDefaultRoomId() {
  const today = new Date().toISOString().split('T')[0];
  return `DIBS-${today}`;
}

function sanitizePhone(value) {
  return value.replace(/\D/g, '').slice(-10);
}

function formatPhonePretty(value) {
  const digits = sanitizePhone(value);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

function toE164India(value) {
  const digits = sanitizePhone(value);
  return digits ? `+91${digits}` : '';
}

function resolveOtpErrorMessage(code, message = '') {
  switch (code) {
    case 'auth/invalid-phone-number':
      return 'Invalid phone number. Check and retry.';
    case 'auth/invalid-verification-code':
      return 'Incorrect OTP. Please try again.';
    case 'auth/code-expired':
      return 'OTP expired. Request a new code.';
    case 'auth/too-many-requests':
      return 'Too many requests. Try again later.';
    case 'auth/quota-exceeded':
      return 'OTP quota exceeded. Try again later.';
    case 'auth/invalid-app-credential':
      return 'App credential invalid. Reinstall latest APK and retry.';
    default:
      return `OTP failed (${code || 'unknown'}). ${message || 'Please retry.'}`;
  }
}

function isOtpRateLimited(code = '', message = '') {
  const text = `${code} ${message}`.toLowerCase();
  return (
    text.includes('too-many-requests') ||
    text.includes('quota') ||
    text.includes('blocked all requests') ||
    text.includes('unusual activity')
  );
}

function isPermissionDenied(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code.includes('permission') || message.includes('permission_denied');
}

const SESSION_KEY = 'dibs_auth_context';
const TEST_PASS_OTP = import.meta.env.VITE_TEST_PASS_OTP || '123456';
const ENABLE_TEST_PASS = (import.meta.env.VITE_ENABLE_TEST_PASS ?? 'true') === 'true';
const DEFAULT_HOST_ACCESS = {
  status: 'none',
  requestedAt: 0,
  reviewedAt: 0,
  reviewedBy: '',
  reason: ''
};

function normalizeHostAccess(value = {}) {
  const status = String(value?.status || DEFAULT_HOST_ACCESS.status).toLowerCase();
  const allowedStatus = new Set(['none', 'pending', 'approved', 'rejected']);
  return {
    status: allowedStatus.has(status) ? status : DEFAULT_HOST_ACCESS.status,
    requestedAt: Number(value?.requestedAt || 0),
    reviewedAt: Number(value?.reviewedAt || 0),
    reviewedBy: String(value?.reviewedBy || ''),
    reason: String(value?.reason || '')
  };
}

export const LoginPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [roomId, setRoomId] = useState(searchParams.get('room') || generateDefaultRoomId());

  const [currentScreen, setCurrentScreen] = useState('splash');
  const [loginStep, setLoginStep] = useState('landing');
  const [waitingMessage, setWaitingMessage] = useState('');
  const [nextEventTime, setNextEventTime] = useState(null);

  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [otpDigits, setOtpDigits] = useState(Array(6).fill(''));
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [pendingJoin, setPendingJoin] = useState(null);
  const [restoredAuthUser, setRestoredAuthUser] = useState(null);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const otpRefs = useRef([]);
  const confirmationResultRef = useRef(null);
  const recaptchaVerifierRef = useRef(null);
  const otpSessionPhoneRef = useRef('');
  const nativeVerificationIdRef = useRef('');
  const autoSignInHandledRef = useRef(false);
  const isNativePhoneOtp = Capacitor.isNativePlatform();

  const persistSession = (sessionPayload) => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionPayload));
    } catch (err) {
      console.error('Failed to persist auth session', err);
    }
  };

  const navigateToCatalog = (sessionPayload) => {
    persistSession(sessionPayload);
    navigate('/catalog', { replace: true });
  };

  useEffect(() => {
    if (searchParams.get('room')) return;

    const fetchActiveRoom = async () => {
      try {
        const configRef = ref(db, 'event_config/active_room_id');
        const snapshot = await get(configRef);
        if (snapshot.exists()) {
          setRoomId(snapshot.val());
        }
      } catch (err) {
        console.error('Config fetch failed, using default:', roomId, err);
      }
    };

    fetchActiveRoom();
  }, [searchParams]);

  useEffect(() => {
    if (otpCountdown <= 0) return undefined;
    const timer = setTimeout(() => setOtpCountdown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [otpCountdown]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user?.phoneNumber) {
        setRestoredAuthUser(user);
        const restoredPhone = sanitizePhone(user.phoneNumber);
        if (restoredPhone) setPhoneInput(restoredPhone);
      } else {
        setRestoredAuthUser(null);
        autoSignInHandledRef.current = false;
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isNativePhoneOtp) return undefined;

    let phoneCodeSentHandle;
    let phoneVerificationFailedHandle;

    const setupListeners = async () => {
      phoneCodeSentHandle = await FirebaseAuthentication.addListener('phoneCodeSent', (event) => {
        if (event?.verificationId) {
          nativeVerificationIdRef.current = event.verificationId;
        }
      });

      phoneVerificationFailedHandle = await FirebaseAuthentication.addListener(
        'phoneVerificationFailed',
        (event) => {
          const nativeCode = event?.code ? `native/${event.code}` : 'native/phone-verification-failed';
          const nativeMessage = event?.message || '';

          if (ENABLE_TEST_PASS && isOtpRateLimited(nativeCode, nativeMessage)) {
            setOtpDigits(Array(6).fill(''));
            setOtpCountdown(0);
            setLoginStep('otp');
            setTimeout(() => otpRefs.current[0]?.focus(), 0);
            setError(`OTP temporarily blocked. Use Entry Pass: ${TEST_PASS_OTP}`);
          } else {
            setError(resolveOtpErrorMessage(nativeCode, nativeMessage));
          }

          setLoading(false);
        }
      );
    };

    setupListeners();

    return () => {
      phoneCodeSentHandle?.remove();
      phoneVerificationFailedHandle?.remove();
    };
  }, [isNativePhoneOtp]);

  useEffect(() => {
    if (currentScreen !== 'login') return;
    if (!restoredAuthUser?.phoneNumber) return;
    if (autoSignInHandledRef.current) return;

    autoSignInHandledRef.current = true;
    setError('');
    setLoginStep('phone');
    handlePostOtpAuth(restoredAuthUser);
  }, [currentScreen, restoredAuthUser]);

  useEffect(() => {
    return () => {
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
    };
  }, []);

  const getUniqueUsername = async (activeRoomId, userPhone, prefix = '') => {
    const roomRef = ref(db, `audience_data/${activeRoomId}`);
    const snapshot = await get(roomRef);
    let existingName = null;
    const takenNames = new Set();

    if (snapshot.exists()) {
      const data = snapshot.val();
      Object.values(data).forEach((user) => {
        if (user.phone === userPhone) existingName = user.username;
        if (user.username) takenNames.add(user.username);
      });
    }

    if (existingName) return existingName;

    const availableNames = NAME_LIST.filter((name) => !takenNames.has(prefix + name));
    if (availableNames.length > 0) {
      const randomIndex = Math.floor(Math.random() * availableNames.length);
      return prefix + availableNames[randomIndex];
    }

    const baseName = NAME_LIST[Math.floor(Math.random() * NAME_LIST.length)];
    return `${prefix}${baseName}-${Math.floor(100 + Math.random() * 900)}`;
  };

  const resolveUsername = async (phone, desiredName, prefix = '') => {
    const fallback = await getUniqueUsername(roomId, phone, prefix);
    const trimmed = desiredName.trim();
    if (!trimmed) return fallback;

    const safeName = trimmed.replace(/\s+/g, ' ').slice(0, 24);
    if (!safeName) return fallback;

    const roomRef = ref(db, `audience_data/${roomId}`);
    const snapshot = await get(roomRef);
    const taken = new Set();

    if (snapshot.exists()) {
      Object.values(snapshot.val()).forEach((user) => {
        if (user?.username) taken.add(String(user.username).toLowerCase());
      });
    }

    if (!taken.has(safeName.toLowerCase())) return safeName;

    let suffix = 2;
    let candidate = `${safeName}${suffix}`;
    while (taken.has(candidate.toLowerCase())) {
      suffix += 1;
      candidate = `${safeName}${suffix}`;
    }
    return candidate;
  };

  const resetToLanding = () => {
    setError('');
    setOtpDigits(Array(6).fill(''));
    setOtpCountdown(0);
    setPendingJoin(null);
    setDisplayName('');
    setLoginStep('landing');
    confirmationResultRef.current = null;
    otpSessionPhoneRef.current = '';
    nativeVerificationIdRef.current = '';
    resetRecaptcha();
  };

  const resetRecaptcha = () => {
    if (recaptchaVerifierRef.current) {
      recaptchaVerifierRef.current.clear();
      recaptchaVerifierRef.current = null;
    }

    const container = document.getElementById('recaptcha-container');
    if (container) container.innerHTML = '';
  };

  const ensureRecaptcha = async () => {
    if (recaptchaVerifierRef.current) return recaptchaVerifierRef.current;

    recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'invisible'
    });

    await recaptchaVerifierRef.current.render();
    return recaptchaVerifierRef.current;
  };

  const handleSendOtp = async () => {
    const cleanPhone = sanitizePhone(phoneInput);

    if (!acceptedTerms) {
      setError('Please accept Terms & Privacy to continue.');
      return;
    }

    if (cleanPhone.length < 10) {
      setError('Enter a valid 10-digit phone number.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      otpSessionPhoneRef.current = cleanPhone;
      logEvent(roomId, 'OTP_SENT', { phone: cleanPhone });

      if (isNativePhoneOtp) {
        nativeVerificationIdRef.current = '';
        const nativeResult = await FirebaseAuthentication.signInWithPhoneNumber({
          phoneNumber: toE164India(cleanPhone),
          timeout: 60
        });

        if (nativeResult?.verificationId) {
          nativeVerificationIdRef.current = nativeResult.verificationId;
        }

        setOtpDigits(Array(6).fill(''));
        setOtpCountdown(30);
        setLoginStep('otp');
        setTimeout(() => otpRefs.current[0]?.focus(), 0);
        return;
      }

      const verifier = await ensureRecaptcha();
      const confirmation = await signInWithPhoneNumber(auth, toE164India(cleanPhone), verifier);

      confirmationResultRef.current = confirmation;
      setOtpDigits(Array(6).fill(''));
      setOtpCountdown(30);
      setLoginStep('otp');
      setTimeout(() => otpRefs.current[0]?.focus(), 0);
    } catch (err) {
      console.error('OTP send failed:', err);
      const errCode = err?.code || 'native/send-failed';
      const errMessage = err?.message || '';

      if (ENABLE_TEST_PASS && isOtpRateLimited(errCode, errMessage)) {
        setOtpDigits(Array(6).fill(''));
        setOtpCountdown(0);
        setLoginStep('otp');
        setTimeout(() => otpRefs.current[0]?.focus(), 0);
        setError(`OTP temporarily blocked. Use Entry Pass: ${TEST_PASS_OTP}`);
      } else {
        setError(resolveOtpErrorMessage(errCode, errMessage));
      }

      if (!isNativePhoneOtp) resetRecaptcha();
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = async (role, uId, phone, mail, username = null) => {
    try {
      const finalName = username || role.toUpperCase();
      const userRef = push(ref(db, `audience_data/${roomId}`));
      await set(userRef, {
        email: mail,
        phone,
        role,
        userId: uId,
        username: finalName,
        joinedAt: Date.now(),
        restrictions: { isMuted: false, isBidBanned: false, isKicked: false }
      });

      const indexRef = ref(db, `rooms/${roomId}/audience_index/${uId}`);
      const indexSnap = await get(indexRef);
      const firstSeen = indexSnap.exists() ? indexSnap.val().firstSeen : Date.now();

      await update(indexRef, {
        userId: uId,
        username: finalName,
        email: mail,
        phone,
        role,
        firstSeen,
        lastSeen: Date.now(),
        lastSessionKey: userRef.key
      });

      navigate(`/room/${roomId}?dbKey=${userRef.key}&uid=${uId}&role=${role}`);
    } catch (err) {
      console.error(err);
      setError('Failed to join.');
      setLoading(false);
    }
  };

  const handlePostOtpAuth = async (authUser = null) => {
    setError('');
    setLoading(true);

    const cleanPhone = sanitizePhone(authUser?.phoneNumber || phoneInput);
    const phoneE164 = authUser?.phoneNumber || toE164India(cleanPhone);
    const firebaseUid = authUser?.uid || null;

    if (cleanPhone.length < 10) {
      setError('Phone session invalid. Please retry OTP.');
      setLoading(false);
      return;
    }

    try {
      const readPath = async (path) => {
        try {
          return { snapshot: await get(ref(db, path)), denied: false };
        } catch (readErr) {
          if (isPermissionDenied(readErr)) {
            return { snapshot: null, denied: true };
          }
          throw readErr;
        }
      };

      const [blockRead, testRead, guestRead] = await Promise.all([
        readPath(`blocked_users/${cleanPhone}`),
        readPath(`test_allowed_guests/${cleanPhone}`),
        readPath(`allowed_guests/${cleanPhone}`)
      ]);

      if (blockRead.snapshot?.exists()) {
        logEvent(roomId, 'LOGIN_BLOCKED', { phone: cleanPhone });
        setError('ACCESS DENIED. You are blocked.');
        setLoading(false);
        return;
      }

      let role = 'audience';
      let userId = firebaseUid || `USER-${cleanPhone}`;
      let email = `${cleanPhone}@otp.local`;
      let unregistered = false;
      let resolvedDisplayName = '';
      let profileRole = 'audience';
      let hostAccess = { ...DEFAULT_HOST_ACCESS };

      if (testRead.snapshot?.exists()) {
        const testRecord = testRead.snapshot.val() || {};
        if (testRecord.email) email = String(testRecord.email).toLowerCase();
      } else if (guestRead.snapshot?.exists()) {
        const guestRecord = guestRead.snapshot.val() || {};
        if (guestRecord.email) email = String(guestRecord.email).toLowerCase();
      } else {
        // If read is denied by strict rules, allow authenticated OTP users through as audience.
        const allowlistReadDenied = testRead.denied || guestRead.denied;
        if (allowlistReadDenied && firebaseUid) {
          role = 'audience';
          unregistered = false;
        } else {
          role = 'spectator';
          unregistered = true;
          if (!firebaseUid) userId = `SPEC-${cleanPhone}`;
        }
      }

      if (firebaseUid) {
        const userProfileRef = ref(db, `users/${firebaseUid}`);
        const userProfileSnap = await get(userProfileRef);
        const existingUser = userProfileSnap.exists() ? userProfileSnap.val() : {};
        const existingRole = String(existingUser?.role || '').toLowerCase();
        hostAccess = normalizeHostAccess(existingUser?.hostAccess || DEFAULT_HOST_ACCESS);

        resolvedDisplayName = String(existingUser?.displayName || existingUser?.username || '').trim();

        if (existingRole === 'host' && hostAccess.status === 'none') {
          hostAccess = {
            ...hostAccess,
            status: 'approved',
            reviewedAt: Date.now(),
            reviewedBy: 'legacy-host'
          };
        }

        const isApprovedHost = hostAccess.status === 'approved' || existingRole === 'host';
        if (isApprovedHost) {
          role = 'host';
          unregistered = false;
          profileRole = 'host';
        } else if (existingRole === 'host') {
          profileRole = 'audience';
        } else if (existingRole === 'audience' || existingRole === 'user' || existingRole === 'viewer') {
          profileRole = existingRole === 'user' ? 'user' : 'audience';
        } else {
          profileRole = 'audience';
        }

        await update(userProfileRef, {
          uid: firebaseUid,
          phone: cleanPhone,
          phoneE164,
          email,
          role: profileRole,
          hostAccess,
          authProvider: 'phone',
          createdAt: existingUser?.createdAt || Date.now(),
          lastLoginAt: Date.now(),
          lastRoomId: existingUser?.lastRoomId || roomId
        });

        await set(ref(db, `users_by_phone/${phoneE164}`), {
          uid: firebaseUid,
          phone: cleanPhone,
          updatedAt: Date.now()
        });
      }

      if (!resolvedDisplayName) {
        const indexSnap = await get(ref(db, `rooms/${roomId}/audience_index/${userId}`));
        if (indexSnap.exists() && indexSnap.val()?.username) {
          resolvedDisplayName = String(indexSnap.val().username).trim();
        }
      }

      if (resolvedDisplayName) {
        navigateToCatalog({
          role,
          userId,
          phone: cleanPhone,
          phoneE164,
          email,
          unregistered,
          displayName: resolvedDisplayName,
          firebaseUid,
          hostAccess
        });
        setLoading(false);
        return;
      }

      setPendingJoin({
        role,
        profileRole,
        userId,
        phone: cleanPhone,
        phoneE164,
        email,
        unregistered,
        firebaseUid,
        hostAccess
      });
      setDisplayName('');
      setLoginStep('name');
      setLoading(false);
    } catch (err) {
      console.error(err);
      setError('System Error. Try again.');
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const entered = otpDigits.join('');
    if (entered.length !== 6) {
      setError('Enter all 6 OTP digits.');
      return;
    }

    setError('');
    setLoading(true);

    const cleanPhone = sanitizePhone(phoneInput);
    if (ENABLE_TEST_PASS && entered === TEST_PASS_OTP) {
      if (cleanPhone.length < 10) {
        setError('Enter a valid 10-digit phone number.');
        setLoading(false);
        return;
      }

      logEvent(roomId, 'OTP_BYPASS_USED', { phone: cleanPhone });
      let bypassUser = auth.currentUser || null;
      const currentPhone = sanitizePhone(bypassUser?.phoneNumber || '');

      // Entry Pass fallback still needs an authenticated session for strict RTDB rules.
      if (!bypassUser || currentPhone !== cleanPhone) {
        try {
          const anonCredential = await signInAnonymously(auth);
          bypassUser = anonCredential.user;
        } catch (anonErr) {
          console.warn('Anonymous fallback sign-in unavailable:', anonErr);
        }
      }

      await handlePostOtpAuth(
        bypassUser || { uid: null, phoneNumber: toE164India(cleanPhone) }
      );
      return;
    }

    try {
      if (isNativePhoneOtp) {
        if (!nativeVerificationIdRef.current) {
          setError('OTP session not ready. Tap Send Again?');
          setLoading(false);
          return;
        }

        const result = await FirebaseAuthentication.confirmVerificationCode({
          verificationId: nativeVerificationIdRef.current,
          verificationCode: entered
        });

        const verifiedPhone = sanitizePhone(
          result.user?.phoneNumber || otpSessionPhoneRef.current || phoneInput
        );

        if (verifiedPhone) setPhoneInput(verifiedPhone);
        nativeVerificationIdRef.current = '';
        logEvent(roomId, 'OTP_VERIFIED', { phone: verifiedPhone, uid: result.user?.uid });
        await handlePostOtpAuth(result.user);
        return;
      }

      if (!confirmationResultRef.current) {
        setError('OTP session expired. Please request a new OTP.');
        setLoading(false);
        return;
      }

      const credential = await confirmationResultRef.current.confirm(entered);
      const verifiedPhone = sanitizePhone(
        credential.user?.phoneNumber || otpSessionPhoneRef.current || phoneInput
      );

      if (verifiedPhone) setPhoneInput(verifiedPhone);
      confirmationResultRef.current = null;
      logEvent(roomId, 'OTP_VERIFIED', { phone: verifiedPhone, uid: credential.user.uid });
      await handlePostOtpAuth(credential.user);
    } catch (err) {
      console.error('OTP verify failed:', err);
      setError(resolveOtpErrorMessage(err?.code || 'native/verify-failed', err?.message));
      setLoading(false);
    }
  };

  const confirmNameAndJoin = async () => {
    if (!pendingJoin) {
      setError('Session expired. Try OTP again.');
      resetToLanding();
      return;
    }

    setLoading(true);
    setError('');

    try {
      const prefix = pendingJoin.role === 'spectator' ? 'Spec_' : '';
      const finalName = await resolveUsername(pendingJoin.phone, displayName, prefix);
      const isFirebaseUid = !pendingJoin.userId.startsWith('USER-') && !pendingJoin.userId.startsWith('TEST-') && !pendingJoin.userId.startsWith('SPEC-');

      if (isFirebaseUid) {
        const persistedRole =
          pendingJoin.profileRole === 'host'
            ? 'host'
            : pendingJoin.profileRole === 'user'
              ? 'user'
              : 'audience';

        await update(ref(db, `users/${pendingJoin.userId}`), {
          displayName: finalName,
          username: finalName,
          role: persistedRole,
          hostAccess: normalizeHostAccess(pendingJoin.hostAccess || DEFAULT_HOST_ACCESS),
          phone: pendingJoin.phone,
          phoneE164: pendingJoin.phoneE164 || toE164India(pendingJoin.phone),
          email: pendingJoin.email,
          lastLoginAt: Date.now(),
          lastRoomId: roomId
        });
      }

      navigateToCatalog({
        role: pendingJoin.role,
        userId: pendingJoin.userId,
        phone: pendingJoin.phone,
        phoneE164: pendingJoin.phoneE164 || toE164India(pendingJoin.phone),
        email: pendingJoin.email,
        unregistered: pendingJoin.unregistered,
        displayName: finalName,
        firebaseUid: pendingJoin.firebaseUid || (isFirebaseUid ? pendingJoin.userId : null),
        hostAccess: normalizeHostAccess(pendingJoin.hostAccess || DEFAULT_HOST_ACCESS)
      });
    } catch (err) {
      console.error(err);
      setError('Failed to continue. Please retry.');
      setLoading(false);
    }
  };

  const handleOtpInputChange = (index, rawValue) => {
    const value = rawValue.replace(/\D/g, '').slice(-1);
    setOtpDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    if (value && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index, event) => {
    if (event.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
    if (event.key === 'Enter') {
      handleVerifyOtp();
    }
  };

  const handleOtpPaste = (event) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const next = Array(6).fill('');
    pasted.split('').forEach((char, i) => {
      next[i] = char;
    });
    setOtpDigits(next);
    otpRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  const primarySuggestions = NAME_LIST.slice(0, 5);

  const darkGradient = {
    background: 'radial-gradient(circle at center, #ff7200 0%, #f96300 42%, #100400 100%)'
  };

  return (
    <div className="w-full h-screen bg-[#FF6600] text-white relative overflow-hidden font-sans">
      <AnimatePresence mode="wait">
        {currentScreen === 'splash' && (
          <CoinStackLoader key="splash" onComplete={() => setCurrentScreen('login')} />
        )}

        {currentScreen === 'waiting' && (
          <WaitingScreen
            key="waiting"
            message={waitingMessage}
            nextEvent={nextEventTime}
            onTimerFinished={() => {
              setCurrentScreen('login');
              resetToLanding();
              setWaitingMessage('');
            }}
          />
        )}

        {currentScreen === 'login' && (
          <motion.div
            key="otp-login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full h-full"
            style={loginStep === 'landing' ? undefined : darkGradient}
          >
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="absolute top-5 left-4 right-4 z-30 bg-black/40 border border-white/25 rounded-xl px-3 py-2 text-[11px] flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {loginStep === 'landing' && (
              <div className="h-full w-full bg-[#ff6900] flex flex-col items-center justify-center px-7 text-center">
                <div className="mb-10">
                  <h1
                    className="text-6xl font-retro font-black leading-[1] tracking-tight"
                    style={{ textShadow: '5px 5px 0px #000' }}
                  >
                    DIBS!
                  </h1>
                  <p className="text-sm mt-2 font-medium">One Piece One Chance</p>
                </div>

                <div className="w-full max-w-xs space-y-3">
                  <button className="w-full h-12 rounded-xl bg-white/90 text-black font-semibold flex items-center justify-center gap-2 opacity-70 cursor-not-allowed">
                    <span className="font-bold">G</span> Continue with Google
                  </button>
                  <button className="w-full h-12 rounded-xl bg-white/90 text-black font-semibold flex items-center justify-center gap-2 opacity-70 cursor-not-allowed">
                    <span className="font-bold">f</span> Continue with Facebook
                  </button>
                  <button className="w-full h-12 rounded-xl bg-white/90 text-black font-semibold flex items-center justify-center gap-2 opacity-70 cursor-not-allowed">
                    <span className="font-bold">A</span> Continue with Apple
                  </button>
                  <button
                    onClick={() => {
                      if (!acceptedTerms) {
                        setError('Accept Terms & Privacy to continue.');
                        return;
                      }
                      setError('');
                      setLoginStep('phone');
                    }}
                    className="w-full h-12 rounded-xl bg-white text-black font-semibold flex items-center justify-center gap-2"
                  >
                    <Mail className="w-4 h-4" />
                    Continue with OTP
                  </button>
                </div>

                <label className="mt-8 text-[11px] text-white/90 flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    className="h-3.5 w-3.5 accent-black"
                  />
                  <span>By checking this box, I agree to the Terms and Privacy.</span>
                </label>
              </div>
            )}

            {loginStep === 'phone' && (
              <div className="h-full w-full flex items-center justify-center px-7">
                <div className="w-full max-w-sm">
                  <button
                    className="text-xs underline text-white/90 mb-4 flex items-center gap-1"
                    onClick={resetToLanding}
                  >
                    <ChevronLeft className="w-3 h-3" /> Go Back
                  </button>
                  <h2 className="text-3xl font-semibold mb-4">Verify your Phone Number?</h2>
                  <div className="h-12 rounded-xl bg-[#2f3238] flex items-center px-3">
                    <span className="text-sm text-white/90 mr-3">+91</span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      autoFocus
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(sanitizePhone(e.target.value))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSendOtp();
                      }}
                      placeholder="7558051709"
                      className="flex-1 bg-transparent outline-none text-white placeholder:text-white/45 text-sm tracking-wide"
                    />
                    <button
                      onClick={handleSendOtp}
                      disabled={loading}
                      className="ml-3 text-white/80 hover:text-white disabled:opacity-50"
                      aria-label="Send OTP"
                    >
                      {loading ? <span className="text-xs">...</span> : <ArrowRight className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {loginStep === 'otp' && (
              <div className="h-full w-full flex items-center justify-center px-7">
                <div className="w-full max-w-sm">
                  <button
                    className="text-xs underline text-white/90 mb-4 flex items-center gap-1"
                    onClick={() => {
                      setError('');
                      setLoginStep('phone');
                    }}
                  >
                    <ChevronLeft className="w-3 h-3" /> Go Back
                  </button>

                  <h2 className="text-3xl font-semibold mb-3">Enter the OTP</h2>
                  <p className="text-xs text-white/80 mb-4">+91 {formatPhonePretty(phoneInput)}</p>
                  {ENABLE_TEST_PASS && (
                    <p className="text-[11px] text-orange-200 mb-3">Entry Pass (temporary): {TEST_PASS_OTP}</p>
                  )}

                  <div className="flex gap-2 mb-4" onPaste={handleOtpPaste}>
                    {otpDigits.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={(el) => {
                          otpRefs.current[idx] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpInputChange(idx, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                        className="w-11 h-12 text-center rounded-xl bg-[#2f3238] text-white text-xl outline-none"
                      />
                    ))}
                  </div>

                  <div className="flex items-center justify-between">
                    <button
                      className={`text-xs underline ${otpCountdown > 0 || loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                      disabled={otpCountdown > 0 || loading}
                      onClick={handleSendOtp}
                    >
                      Send Again?
                    </button>
                    <span className="text-xs">{`00:${String(Math.max(otpCountdown, 0)).padStart(2, '0')}`}</span>
                  </div>

                  <button
                    onClick={handleVerifyOtp}
                    disabled={loading}
                    className="mt-5 w-full h-11 rounded-xl bg-white text-black font-semibold disabled:opacity-60"
                  >
                    {loading ? 'Verifying...' : 'Verify OTP'}
                  </button>
                </div>
              </div>
            )}

            {loginStep === 'name' && (
              <div className="h-full w-full flex items-center justify-center px-7">
                <div className="w-full max-w-sm">
                  <h2 className="text-3xl font-semibold mb-4">What should we call you ?</h2>
                  <div className="h-12 rounded-xl bg-[#2f3238] flex items-center px-3">
                    <input
                      value={displayName}
                      autoFocus
                      maxLength={24}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Enter display name"
                      className="flex-1 bg-transparent outline-none text-white placeholder:text-white/45 text-sm"
                    />
                  </div>

                  <div className="mt-4">
                    <p className="text-xs text-white/80 mb-2">Suggestions:</p>
                    <div className="flex flex-wrap gap-2">
                      {primarySuggestions.map((name) => (
                        <button
                          key={name}
                          onClick={() => setDisplayName(name)}
                          className="px-3 h-7 rounded-full bg-[#3a3d42] text-[11px]"
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={confirmNameAndJoin}
                    disabled={loading}
                    className="mt-6 w-full h-11 rounded-xl bg-white text-black font-semibold disabled:opacity-60"
                  >
                    {loading ? 'Joining...' : 'Continue'}
                  </button>
                </div>
              </div>
            )}

            <div id="recaptcha-container" className="absolute opacity-0 pointer-events-none" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

