import { ref, push, serverTimestamp, update, increment } from 'firebase/database';
import { db } from './firebase';

// 1. EXPORTED FUNCTION: LOG EVENT
export const logEvent = (roomId, eventName, data = {}) => {
  if (!roomId) return;

  // Log the Raw Event
  push(ref(db, `analytics/${roomId}/events`), {
    event: eventName,
    timestamp: serverTimestamp(),
    ...data
  });

  // Update Aggregate Counters
  const updates = {};
  
  if (eventName === 'BID_PLACED') {
      updates[`analytics/${roomId}/summary/total_bids`] = increment(1);
  }
  if (eventName === 'CHAT_SENT') {
      updates[`analytics/${roomId}/summary/total_messages`] = increment(1);
  }
  if (eventName === 'LOGIN_SUCCESS') {
      updates[`analytics/${roomId}/summary/total_logins`] = increment(1);
  }
  if (eventName === 'LOGIN_FAILURE') {
      updates[`analytics/${roomId}/summary/login_failures`] = increment(1);
  }
  
  if (Object.keys(updates).length > 0) {
      update(ref(db), updates);
  }
};

// 2. EXPORTED FUNCTION: START SESSION
export const startSession = (roomId, userId, role) => {
    const sessionRef = push(ref(db, `analytics/${roomId}/sessions`));
    update(sessionRef, {
        userId,
        role,
        startTime: serverTimestamp(),
        device: navigator.userAgent 
    });
    return sessionRef.key;
};

// 3. EXPORTED FUNCTION: END SESSION
export const endSession = (roomId, sessionKey) => {
    if (!sessionKey) return;
    const sessionRef = ref(db, `analytics/${roomId}/sessions/${sessionKey}`);
    update(sessionRef, {
        endTime: serverTimestamp()
    });
};