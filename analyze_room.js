import { initializeApp } from "firebase/app";
import { getDatabase, ref, get } from "firebase/database";
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import Papa from 'papaparse';
import { fileURLToPath } from 'url';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.VITE_FIREBASE_DB_URL,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const roomId = process.argv[2];
const manualStart = process.argv[3]; 
const manualEnd = process.argv[4];

if (!roomId) {
    console.error("❌ Usage: node analyze_room.js <ROOM_ID> [START] [END]");
    process.exit(1);
}

const analyze = async () => {
    console.log(`\n🔍 ANALYZING ROOM: [ ${roomId} ]\n` + "=".repeat(50));

    try {
        // --- 1. LOAD INVENTORY ---
        const inventoryPath = path.join(__dirname, 'src', 'inventory.csv');
        let inventoryMap = new Map();
        if (fs.existsSync(inventoryPath)) {
            const csvData = fs.readFileSync(inventoryPath, 'utf8');
            const parsed = Papa.parse(csvData, { header: true, skipEmptyLines: true });
            parsed.data.forEach(item => {
                const price = item['Price'] ? parseInt(item['Price'].replace(/[^0-9]/g, '')) : 0;
                inventoryMap.set(item['Name'], price);
            });
        }

        // --- 2. FETCH DATA ---
        const [configSnap, metaSnap, audienceSnap, historySnap, analyticsSnap, chatSnap] = await Promise.all([
            get(ref(db, `event_config`)),
            get(ref(db, `rooms/${roomId}/metadata`)),
            get(ref(db, `audience_data/${roomId}`)),
            get(ref(db, `rooms/${roomId}/auctionHistory`)),
            get(ref(db, `analytics/${roomId}`)),
            get(ref(db, `rooms/${roomId}/chat`))
        ]);

        // --- 3. DETERMINE WINDOW ---
        let START_TIME, END_TIME;
        if (manualStart && manualEnd) {
            START_TIME = new Date(manualStart).getTime();
            END_TIME = new Date(manualEnd).getTime();
        } else if (metaSnap.exists()) {
            const meta = metaSnap.val();
            START_TIME = meta.startTime;
            END_TIME = meta.endTime;
        } else {
            const config = configSnap.exists() ? configSnap.val() : {};
            START_TIME = config.startTime ? new Date(config.startTime).getTime() : 0;
            END_TIME = config.endTime ? new Date(config.endTime).getTime() : Date.now();
        }

        // --- 4. AUDIENCE ANALYSIS ---
        const rawAudience = audienceSnap.exists() ? Object.values(audienceSnap.val()) : [];
        const uniqueUsers = new Map();
        
        rawAudience.forEach(user => {
            if (user.role === 'host' || user.role === 'moderator') return;
            if (user.userId && user.userId.startsWith('TEST-')) return;
            // Dedupe by Phone
            if (!uniqueUsers.has(user.phone)) {
                uniqueUsers.set(user.phone, user);
            }
        });

        const realUserCount = uniqueUsers.size;
        // Total Potential Bidders (Everyone in 'audience' role)
        const totalBidders = Array.from(uniqueUsers.values()).filter(u => u.role === 'audience').length;
        const totalSpectators = Array.from(uniqueUsers.values()).filter(u => u.role === 'spectator').length;

        // --- 5. BIDS ANALYSIS (MULTI-SOURCE) ---
        const analyticsData = analyticsSnap.exists() ? analyticsSnap.val() : {};
        const rawEvents = analyticsData.events ? Object.values(analyticsData.events) : []; 
        const rawChat = chatSnap.exists() ? Object.values(chatSnap.val()) : [];

        // Gather ALL valid bids
        const validBids = [];
        
        // A. From Analytics (Structured)
        rawEvents.forEach(e => {
            if ((e.event === 'BID_PLACED' || e.eventType === 'BID_PLACED') &&
                e.timestamp >= START_TIME && e.timestamp <= END_TIME &&
                !e.user?.includes("TEST")) {
                validBids.push({ timestamp: e.timestamp, user: e.user });
            }
        });

        // B. From Chat (Text Parsing)
        rawChat.forEach(msg => {
            if (msg.type === 'bid' && msg.timestamp >= START_TIME && msg.timestamp <= END_TIME) {
                // Regex: Grab everything before " bid ₹"
                const match = msg.text.match(/^(.*?) bid ₹/);
                const extractedUser = match ? match[1].trim() : null; // Added trim()
                
                if (extractedUser) {
                    // Dedupe: Don't add if a bid exists at same timestamp
                    const exists = validBids.some(b => Math.abs(b.timestamp - msg.timestamp) < 100);
                    if (!exists) {
                        validBids.push({ timestamp: msg.timestamp, user: extractedUser });
                    }
                }
            }
        });

        console.log(`📊 Total Bids Found: ${validBids.length}`);

        // --- 6. PARTICIPATION METRICS (THE FIX) ---
        const uniqueBidderNames = new Set();
        validBids.forEach(b => {
            if (b.user) uniqueBidderNames.add(b.user);
        });

        console.log(`👤 Unique Bidder Names Found: ${uniqueBidderNames.size}`);
        
        // FIX: Instead of matching against broken audience list, use the unique names directly
        const activeBidderCount = uniqueBidderNames.size;
        
        // Passive is whatever is left over from the Total Potential Bidders
        const passiveBidderCount = Math.max(0, totalBidders - activeBidderCount); 

        // --- 7. SALES & UNSOLD ---
        const rawHistory = historySnap.exists() ? Object.values(historySnap.val()) : [];
        const eventHistory = rawHistory.filter(h => h.timestamp >= START_TIME && h.timestamp <= END_TIME);
        const soldItems = eventHistory.filter(h => h.winner && h.winner !== "Nobody");
        const unsoldItems = eventHistory.filter(h => !h.winner || h.winner === "Nobody");
        const totalRevenue = soldItems.reduce((sum, h) => sum + (h.finalPrice || 0), 0);

        // --- 8. PRICE INCREASES ---
        let totalPctIncrease = 0;
        let maxPctIncrease = 0;
        soldItems.forEach(item => {
            const startPrice = inventoryMap.get(item.itemName) || 0;
            if (startPrice > 0) {
                const increase = ((item.finalPrice - startPrice) / startPrice) * 100;
                totalPctIncrease += increase;
                if (increase > maxPctIncrease) maxPctIncrease = increase;
            }
        });
        const avgPriceIncrease = soldItems.length > 0 ? (totalPctIncrease / soldItems.length) : 0;

        // --- 9. AVG VIEWERS ---
        let totalSessionTimeMs = 0;
        const sessions = rawEvents.filter(e => e.event === 'SESSION_END' || e.eventType === 'SESSION_END'); 
        sessions.forEach(s => { if (s.duration) totalSessionTimeMs += s.duration; });
        const eventDurationMinutes = (END_TIME - START_TIME) / 1000 / 60;
        const avgViewers = eventDurationMinutes > 0 ? Math.round((totalSessionTimeMs / 1000 / 60) / eventDurationMinutes) : 0;

        // --- 10. UNIQUE WHALES ---
        const whaleSet = new Set();
        eventHistory.forEach(auction => {
            if (auction.topBidders) {
                auction.topBidders.forEach(bid => whaleSet.add(bid.user));
            }
        });
        const uniqueWhales = whaleSet.size;

        // --- 11. GENERATE HTML ---
        const timeLabels = [];
        const bidCounts = [];
        const joinCounts = [];
        const bucket = 5 * 60 * 1000;

        for (let t = START_TIME; t <= END_TIME; t += bucket) {
            timeLabels.push(new Date(t).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}));
            const b = validBids.filter(e => e.timestamp >= t && e.timestamp < t + bucket).length;
            bidCounts.push(b);
            let j = 0;
            uniqueUsers.forEach(u => {
                if (u.joinedAt >= t && u.joinedAt < t + bucket) j++;
            });
            joinCounts.push(j);
        }

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${roomId} Report</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { background: #0a0a0a; color: #e0e0e0; font-family: 'Segoe UI', sans-serif; padding: 20px; }
        .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }
        .card { background: #151515; padding: 20px; border-radius: 12px; border: 1px solid #333; text-align: center; }
        .val { font-size: 24px; font-weight: bold; color: #fff; margin-top: 5px; }
        .lbl { font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: 1px; }
        .highlight { color: #FF6600; }
        .positive { color: #00ff9d; }
        
        .charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .section-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        
        .box { background: #151515; border: 1px solid #333; padding: 20px; border-radius: 12px; }
        h2 { font-size: 14px; text-transform: uppercase; color: #888; margin-top: 0; border-bottom: 1px solid #333; padding-bottom: 10px; margin-bottom: 15px;}
        
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        td, th { padding: 10px; text-align: left; border-bottom: 1px solid #2a2a2a; }
        th { color: #666; font-size: 11px; }
    </style>
</head>
<body>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:30px;">
        <div>
            <h1 style="color:#FF6600; margin:0;">${roomId} <span style="color:#fff; font-weight:300;">ANALYTICS</span></h1>
            <p style="color:#666; font-size:12px; margin-top:5px;">${new Date(START_TIME).toLocaleString()} — ${new Date(END_TIME).toLocaleString()}</p>
        </div>
        <div style="text-align:right;">
            <div style="font-size:32px; font-weight:bold; color:#fff;">₹${totalRevenue.toLocaleString()}</div>
            <div style="font-size:11px; color:#888; text-transform:uppercase;">Total Revenue</div>
        </div>
    </div>

    <div class="grid">
        <div class="card"><div class="lbl">Real Users</div><div class="val">${realUserCount}</div></div>
        <div class="card"><div class="lbl">Items Sold</div><div class="val">${eventHistory.length > 0 ? Math.round((soldItems.length / eventHistory.length) * 100) : 0}%</div></div>
        <div class="card"><div class="lbl">Total Bids</div><div class="val">${validBids.length}</div></div>
        <div class="card"><div class="lbl">Avg Viewers (Live)</div><div class="val">${avgViewers}</div></div>
        
        <div class="card"><div class="lbl">Avg Price Increase</div><div class="val positive">+${Math.round(avgPriceIncrease)}%</div></div>
        <div class="card"><div class="lbl">Highest Increase</div><div class="val positive">+${Math.round(maxPctIncrease)}%</div></div>
        <div class="card"><div class="lbl">Active Bidders</div><div class="val">${activeBidderCount} <span style="color:#666; font-size:12px">/ ${totalBidders}</span></div></div>
        <div class="card"><div class="lbl">Items Showcased</div><div class="val">${eventHistory.length}</div></div>
    </div>

    <div class="box" style="margin-bottom: 20px;">
        <h2>Event Pulse (5 min intervals)</h2>
        <canvas id="pulseChart" height="70"></canvas>
    </div>

    <div class="charts-row">
        <div class="box" style="display: flex; flex-direction: column; align-items: center;">
            <h2>Audience Composition</h2>
            <div style="width: 220px;"><canvas id="splitChart"></canvas></div>
        </div>
        <div class="box" style="display: flex; flex-direction: column; align-items: center;">
            <h2>Bidder Participation</h2>
            <div style="width: 220px;"><canvas id="participationChart"></canvas></div>
        </div>
    </div>

    <div class="section-grid">
        <div class="box">
            <h2>💰 Top Sales</h2>
            <table>
                <tr><th>Item</th><th>Sold Price</th></tr>
                ${soldItems.sort((a,b) => b.finalPrice - a.finalPrice).slice(0,5).map(i => `<tr><td>${i.itemName}</td><td style="color:#FF6600">₹${i.finalPrice.toLocaleString()}</td></tr>`).join('')}
            </table>
        </div>

        <div class="box">
            <h2>🚫 Unsold Items</h2>
             <table>
                <tr><th>Item</th><th>Start Price</th></tr>
                ${unsoldItems.length === 0 ? '<tr><td colspan="2" style="text-align:center; padding:20px; color:#555">All items sold!</td></tr>' : 
                  unsoldItems.map(i => {
                      const price = inventoryMap.get(i.itemName) || 0;
                      return `<tr><td>${i.itemName}</td><td>₹${price}</td></tr>`;
                  }).join('')
                }
            </table>
        </div>
    </div>

    <script>
        new Chart(document.getElementById('pulseChart'), {
            type: 'line',
            data: {
                labels: ${JSON.stringify(timeLabels)},
                datasets: [
                    { label: 'Bids', data: ${JSON.stringify(bidCounts)}, borderColor: '#00ccff', tension: 0.4 },
                    { label: 'New Joins', data: ${JSON.stringify(joinCounts)}, borderColor: '#FF6600', borderDash: [5,5], tension: 0.4 }
                ]
            },
            options: { scales: { y: { grid: { color: '#222'} }, x: { grid: { color: '#222'} } }, plugins: { legend: { labels: { color: '#ccc' } } } }
        });

        new Chart(document.getElementById('splitChart'), {
            type: 'doughnut',
            data: {
                labels: ['Bidders', 'Spectators'],
                datasets: [{ data: [${totalBidders}, ${totalSpectators}], backgroundColor: ['#FF6600', '#333'], borderWidth: 0 }]
            },
            options: { plugins: { legend: { position: 'bottom', labels: { color: '#ccc' } } } }
        });

        new Chart(document.getElementById('participationChart'), {
            type: 'doughnut',
            data: {
                labels: ['Active Bidders', 'Passive Bidders'],
                datasets: [{ data: [${activeBidderCount}, ${passiveBidderCount}], backgroundColor: ['#00ccff', '#333'], borderWidth: 0 }]
            },
            options: { plugins: { legend: { position: 'bottom', labels: { color: '#ccc' } } } }
        });
    </script>
</body>
</html>
        `;

        fs.writeFileSync(`report_${roomId}.html`, html);
        console.log(`✅ Report saved: report_${roomId}.html`);
        process.exit(0);

    } catch (e) {
        console.error(e);
        process.exit(1);
    }
};

analyze();