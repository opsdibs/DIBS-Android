import agoraToken from 'agora-access-token';
const { RtcTokenBuilder, RtcRole } = agoraToken;

export default function handler(req, res) {
  try {
    // 1. Log for debugging
    console.log("Token Request Received:", req.query);

    // 2. Get Secrets
    // Vercel might put secrets in different places, so we check both standard and VITE_ prefix
    const appID = process.env.VITE_AGORA_APP_ID || process.env.AGORA_APP_ID; 
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appID) {
        console.error("Missing App ID");
        return res.status(500).json({ error: 'Server Error: Missing AGORA_APP_ID' });
    }
    if (!appCertificate) {
        console.error("Missing App Certificate");
        return res.status(500).json({ error: 'Server Error: Missing AGORA_APP_CERTIFICATE' });
    }

    // 3. Prepare Params
    const channelName = req.query.channelName;
    const uid = 0;
    const role = RtcRole.PUBLISHER;
    const expirationTimeInSeconds = 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    console.log(`Generating token for: ${channelName}`);

    // 4. Build Token
    const token = RtcTokenBuilder.buildTokenWithUid(
      appID,
      appCertificate,
      channelName,
      uid,
      role,
      privilegeExpiredTs
    );

    return res.status(200).json({ token });

  } catch (error) {
    console.error("Token Gen Failed:", error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}