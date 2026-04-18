const https = require('https');
const Setting = require('../models/Setting');

const API_URL = 'https://open.er-api.com/v6/latest/MYR';
const REFRESH_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

function fetchRate() {
  return new Promise((resolve, reject) => {
    https.get(API_URL, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.result === 'success' && json.rates?.IDR) {
            resolve(json.rates.IDR);
          } else {
            reject(new Error('Invalid API response'));
          }
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function updateRate() {
  try {
    const rate = await fetchRate();
    await Setting.set('myr_to_idr_rate', rate.toString());
    await Setting.set('rate_last_updated', new Date().toISOString());
    console.log(`✓ Exchange rate updated: 1 MYR = ${rate} IDR`);
    return rate;
  } catch (err) {
    console.error('✗ Rate update failed:', err.message, '— keeping previous rate');
    return null;
  }
}

function startAutoRefresh() {
  // Fetch immediately on startup
  updateRate();
  // Then every 6 hours
  setInterval(updateRate, REFRESH_INTERVAL);
}

module.exports = { updateRate, startAutoRefresh };
