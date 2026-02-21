import React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { LiveRoom } from '../components/LiveRoom';
import { AGORA_APP_ID } from '../lib/settings';

const Room = () => {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const role = searchParams.get('role'); // 'host' or 'audience'

  return (
    <LiveRoom 
      appId={AGORA_APP_ID} 
      roomId={roomId} 
      isHost={role === 'host'} 
    />
  );
};

export default Room;