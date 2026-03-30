'use strict';

const { WebSocketServer, OPEN } = require('ws');

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

/**
 * Serialise an event object and send it to every connected WebSocket client.
 *
 * @param {object} eventObj - Plain object that will be JSON-stringified.
 */
function broadcast(eventObj) {
  const payload = JSON.stringify(eventObj);
  let dropped = 0;

  for (const client of clients) {
    if (client.readyState === OPEN) {
      client.send(payload, (err) => {
        if (err) {
          console.warn('[ws] send error, dropping client:', err.message);
          clients.delete(client);
        }
      });
    } else {
      // Socket is closing or closed — clean up eagerly
      clients.delete(client);
      dropped++;
    }
  }

  if (dropped > 0) {
    console.debug(`[ws] removed ${dropped} stale client(s). Active: ${clients.size}`);
  }
}

/**
 * Attach a WebSocketServer to an existing HTTP server, mounting it at /ws.
 *
 * @param {import('http').Server} server - The Node.js HTTP server instance.
 * @returns {WebSocketServer}
 */
function initWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket, req) => {
    clients.add(socket);
    const ip = req.socket.remoteAddress;
    console.info(`[ws] client connected from ${ip}. Total: ${clients.size}`);

    // Send an initial "hello" so the client knows the connection is live
    socket.send(
      JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })
    );

    socket.on('close', (code, reason) => {
      clients.delete(socket);
      console.info(
        `[ws] client disconnected (${code}). Total: ${clients.size}`
      );
    });

    socket.on('error', (err) => {
      console.warn('[ws] socket error:', err.message);
      clients.delete(socket);
    });

    // Pong back to any ping the client sends (keep-alive)
    socket.on('ping', () => {
      try {
        socket.pong();
      } catch (_) {
        // ignore — socket may already be closing
      }
    });
  });

  wss.on('error', (err) => {
    console.error('[ws] server error:', err.message);
  });

  console.info('[ws] WebSocket server initialised on path /ws');
  return wss;
}

module.exports = { broadcast, initWebSocket };
