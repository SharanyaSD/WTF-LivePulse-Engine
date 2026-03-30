'use strict';

const { Router } = require('express');
const simulatorService = require('../services/simulatorService');

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/simulator/start
// Body: { speed: 1 | 5 | 10 }
// ---------------------------------------------------------------------------
router.post('/start', (req, res) => {
  const VALID_SPEEDS = [1, 5, 10];
  const speed = Number(req.body && req.body.speed) || 1;

  if (!VALID_SPEEDS.includes(speed)) {
    return res.status(400).json({
      error: `Invalid speed. Allowed values: ${VALID_SPEEDS.join(', ')}`,
    });
  }

  const state = simulatorService.start(speed);
  res.json({ message: 'Simulator started', ...state });
});

// ---------------------------------------------------------------------------
// POST /api/simulator/stop
// ---------------------------------------------------------------------------
router.post('/stop', (req, res) => {
  const state = simulatorService.stop();
  res.json({ message: 'Simulator paused', ...state });
});

// ---------------------------------------------------------------------------
// POST /api/simulator/reset
// Stops the simulator and marks all open check-ins as checked out.
// ---------------------------------------------------------------------------
router.post('/reset', async (req, res, next) => {
  try {
    const state = await simulatorService.reset();
    res.json({ message: 'Simulator reset. All open check-ins closed.', ...state });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
