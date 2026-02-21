import { initializeApp } from "firebase/app";
import { getDatabase, ref, set } from "firebase/database";
import fs from 'fs';
import Papa from 'papaparse';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// 1. Load Environment Variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2. Initialize Firebase (Using the same keys as your frontend)
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

// 3. Configuration
const CSV_PATH = path.join(__dirname, 'src', 'guests.csv'); // Looks in src/guests.csv

async function importGuests() {
  console.log("🚀 Starting Guest List Import...");

  // Check if file exists
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ Error: Could not find file at ${CSV_PATH}`);
    process.exit(1);
  }

  // Read CSV File
  const csvFile = fs.readFileSync(CSV_PATH, 'utf8');

  // Parse CSV
  Papa.parse(csvFile, {
    header: true,
    skipEmptyLines: true,
    complete: async (results) => {
      const guestList = results.data;
      const updates = {};
      let count = 0;
      let skipped = 0;

      console.log(`📄 Found ${guestList.length} rows. Processing...`);

      guestList.forEach(guest => {
        // Cleaning Data
        const rawPhone = (guest.phone_number || '').toString();
        const rawEmail = (guest.email || '').toString().trim().toLowerCase();
        const name = (guest.name || 'Guest').toString().trim();

        // Normalize Phone (Remove symbols, take last 10)
        const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);

        // Validation: Must be 10 digits and have an email
        if (cleanPhone.length === 10 && rawEmail) {
          updates[cleanPhone] = {
            email: rawEmail,
            name: name,
            importedAt: Date.now()
          };
          count++;
        } else {
          skipped++;
          // console.warn(`⚠️ Skipped invalid row: ${rawPhone} | ${rawEmail}`);
        }
      });

      if (count === 0) {
        console.error("❌ No valid data found to upload.");
        process.exit(1);
      }

      console.log(`📤 Uploading ${count} guests to Firebase...`);

      try {
        // Upload to 'allowed_guests' node
        await set(ref(db, 'allowed_guests'), updates);
        console.log(`✅ SUCCESS! Guest list updated.`);
        console.log(`📊 Stats: ${count} imported, ${skipped} skipped.`);
        process.exit(0);
      } catch (error) {
        console.error("❌ Firebase Upload Failed:", error);
        process.exit(1);
      }
    }
  });
}

importGuests();