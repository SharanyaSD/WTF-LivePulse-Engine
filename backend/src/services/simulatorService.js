'use strict';

const pool = require('../db/pool');
const { broadcast } = require('../websocket');

// Base tick interval at speed=1 (milliseconds)
const BASE_INTERVAL_MS = Number(process.env.SIMULATOR_BASE_INTERVAL_MS ?? 2000);

// Probability thresholds
const PAYMENT_PROBABILITY = 0.15;   // 15% chance a tick generates a payment

// Simulator state
const state = {
  running: false,
  speed: 1,
  intervalId: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick a random element from an array, or null if empty. */
function randomItem(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Decide check-in vs check-out probability based on time of day.
 * Peak hours (7-9, 12-13, 17-20) lean check-in; off-peak leans check-out.
 */
function shouldCheckIn(hour) {
  const peakHours = [7, 8, 9, 12, 17, 18, 19];
  return peakHours.includes(hour) ? Math.random() < 0.7 : Math.random() < 0.3;
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------
function start(speed = 1) {
  if (state.running) {
    // Already running — just change speed
    stop();
  }

  state.speed = speed;
  state.running = true;
  const intervalMs = Math.round(BASE_INTERVAL_MS / speed);
  state.intervalId = setInterval(_tick, intervalMs);

  console.info(`[simulator] started at speed=${speed} (${intervalMs} ms/tick)`);
  return { running: state.running, speed: state.speed };
}

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------
function stop() {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  state.running = false;
  console.info('[simulator] stopped');
  return { running: state.running, speed: state.speed };
}

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------
async function reset() {
  stop();

  // Close all open check-ins (preserves history — just stamps the time)
  await pool.query(
    `UPDATE checkins SET checked_out = NOW() WHERE checked_out IS NULL`
  );

  console.info('[simulator] reset — all open check-ins closed');
  return { running: state.running, speed: state.speed };
}

// ---------------------------------------------------------------------------
// _tick  (private)
// Called on every interval tick.
// ---------------------------------------------------------------------------
async function _tick() {
  try {
    // 1. Pick a random active gym
    const { rows: gyms } = await pool.query(
      `SELECT id, name, capacity FROM gyms WHERE status = 'active' ORDER BY RANDOM() LIMIT 1`
    );
    if (gyms.length === 0) return;
    const gym = gyms[0];

    const hour = new Date().getHours();
    const checkIn = shouldCheckIn(hour);

    if (checkIn) {
      await _handleCheckIn(gym);
    } else {
      await _handleCheckOut(gym);
    }

    // 2. With 15% probability, also generate a payment
    if (Math.random() < PAYMENT_PROBABILITY) {
      await _handlePayment(gym);
    }
  } catch (err) {
    console.error('[simulator] tick error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// _handleCheckIn
// ---------------------------------------------------------------------------
async function _handleCheckIn(gym) {
  // Pick a random active member belonging to this gym who is NOT currently checked in
  const { rows: members } = await pool.query(
    `SELECT m.id, m.name
       FROM members m
      WHERE m.gym_id   = $1
        AND m.status   = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM checkins c
           WHERE c.member_id  = m.id
             AND c.checked_out IS NULL
        )
      ORDER BY RANDOM()
      LIMIT 1`,
    [gym.id]
  );

  if (members.length === 0) return; // Everyone is already checked in

  const member = members[0];

  // Insert check-in record (checked_in defaults to NOW() in schema)
  const { rows: inserted } = await pool.query(
    `INSERT INTO checkins (gym_id, member_id)
     VALUES ($1, $2)
     RETURNING id, checked_in`,
    [gym.id, member.id]
  );

  // Update member's last_checkin_at
  await pool.query(
    `UPDATE members SET last_checkin_at = NOW() WHERE id = $1`,
    [member.id]
  );

  // Compute new occupancy
  const { rows: occRow } = await pool.query(
    `SELECT COUNT(*)::int AS occupancy FROM checkins WHERE gym_id = $1 AND checked_out IS NULL`,
    [gym.id]
  );
  const occupancy = occRow[0].occupancy;
  const occupancy_pct = gym.capacity > 0 ? Math.round((occupancy / gym.capacity) * 100) : 0;

  broadcast({
    type: 'CHECKIN_EVENT',
    timestamp: new Date().toISOString(),
    gym_id: gym.id,
    gym_name: gym.name,
    checkin_id: inserted[0].id,
    member_id: member.id,
    member_name: member.name,
    checked_in_at: inserted[0].checked_in,
    occupancy,
    occupancy_pct,
  });
}

// ---------------------------------------------------------------------------
// _handleCheckOut
// ---------------------------------------------------------------------------
async function _handleCheckOut(gym) {
  // Pick the oldest open check-in at this gym
  const { rows } = await pool.query(
    `SELECT c.id, c.member_id, c.checked_in, m.name AS member_name
       FROM checkins c
       JOIN members m ON m.id = c.member_id
      WHERE c.gym_id      = $1
        AND c.checked_out IS NULL
      ORDER BY c.checked_in ASC
      LIMIT 1`,
    [gym.id]
  );

  if (rows.length === 0) return; // Nobody to check out

  const checkin = rows[0];

  await pool.query(
    `UPDATE checkins SET checked_out = NOW() WHERE id = $1`,
    [checkin.id]
  );

  // Compute new occupancy
  const { rows: occRow } = await pool.query(
    `SELECT COUNT(*)::int AS occupancy FROM checkins WHERE gym_id = $1 AND checked_out IS NULL`,
    [gym.id]
  );
  const occupancy = occRow[0].occupancy;
  const occupancy_pct = gym.capacity > 0 ? Math.round((occupancy / gym.capacity) * 100) : 0;

  broadcast({
    type: 'CHECKOUT_EVENT',
    timestamp: new Date().toISOString(),
    gym_id: gym.id,
    gym_name: gym.name,
    checkin_id: checkin.id,
    member_id: checkin.member_id,
    member_name: checkin.member_name,
    checked_out_at: new Date().toISOString(),
    occupancy,
    occupancy_pct,
  });
}

// ---------------------------------------------------------------------------
// _handlePayment
// ---------------------------------------------------------------------------
async function _handlePayment(gym) {
  // Pick a random active member at this gym
  const { rows: members } = await pool.query(
    `SELECT id, name, plan_type
       FROM members
      WHERE gym_id = $1 AND status = 'active'
      ORDER BY RANDOM()
      LIMIT 1`,
    [gym.id]
  );

  if (members.length === 0) return;

  const member = members[0];

  // Determine payment amount based on plan (prices in INR per seed data)
  const amountMap = { monthly: 1499, quarterly: 3999, annual: 11999 };
  const amount = amountMap[member.plan_type] ?? 1499;

  // Randomly choose new vs renewal
  const paymentType = Math.random() < 0.2 ? 'new' : 'renewal';

  const { rows: inserted } = await pool.query(
    `INSERT INTO payments (gym_id, member_id, amount, plan_type, payment_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, paid_at`,
    [gym.id, member.id, amount, member.plan_type, paymentType]
  );

  broadcast({
    type: 'PAYMENT_EVENT',
    timestamp: new Date().toISOString(),
    gym_id: gym.id,
    gym_name: gym.name,
    payment_id: inserted[0].id,
    member_id: member.id,
    member_name: member.name,
    amount,
    plan_type: member.plan_type,
    payment_type: paymentType,
    paid_at: inserted[0].paid_at,
  });
}

module.exports = { start, stop, reset, state };
