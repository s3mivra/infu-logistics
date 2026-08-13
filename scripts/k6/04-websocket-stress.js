// Scenario 4/6 — WebSocket stress.
// Many concurrent Socket.io connections per tenant (POS terminals + client-
// portal users) — checks connection-COUNT handling and that no reconnect
// storm occurs. This is not a full socket.io-client — k6's `ws` module speaks
// raw WebSocket, so this hand-rolls the Engine.IO v4 / Socket.io v5 wire
// protocol the server (socket.io v4.x, default config — see server.js's
// `new Server(server, {...})`) actually speaks:
//   1. connect wss://<host>/socket.io/?EIO=4&transport=websocket
//   2. server sends "0{...}" (Engine.IO OPEN)
//   3. client sends "40" (Socket.io CONNECT to the default namespace),
//      optionally "40{"token":"..."}" if verifyToken-style auth is desired
//      (server.js's io.use() reads handshake.auth.token — plain WS can't set
//      that, so this sends it as CONNECT payload instead; anonymous
//      connections are accepted too, per that same handshake middleware)
//   4. server replies "40{"sid":"..."}" (namespace connected)
//   5. server pings ("2") periodically; client must pong ("3") or it times out
// If the server ever changes Engine.IO version or path, update EIO_PARAMS below.
//
// Run:
//   k6 run -e WS_URL=wss://tenant-a.example.com \
//          -e CONNECTIONS=300 -e HOLD_SECONDS=60 \
//          scripts/k6/04-websocket-stress.js
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const WS_URL = (__ENV.WS_URL || 'ws://localhost:5000').replace(/\/$/, '');
const HOLD_SECONDS = Number(__ENV.HOLD_SECONDS) || 60;
const CONNECTIONS = Number(__ENV.CONNECTIONS) || 300;

const opened = new Counter('ws_opened');
const namespaceConnected = new Counter('ws_namespace_connected');
const closedCleanly = new Counter('ws_closed_cleanly');
const errored = new Counter('ws_errored');

export const options = {
  scenarios: {
    connections: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: CONNECTIONS },
        { duration: `${HOLD_SECONDS}s`, target: CONNECTIONS },
        { duration: '15s', target: 0 },
      ],
    },
  },
  thresholds: {
    ws_errored: ['count==0'],
  },
};

export default function () {
  const url = `${WS_URL}/socket.io/?EIO=4&transport=websocket`;
  const res = ws.connect(url, {}, (socket) => {
    let namespaceOk = false;

    socket.on('open', () => {
      opened.add(1);
    });

    socket.on('message', (msg) => {
      const type = msg[0];
      if (type === '0') {
        // Engine.IO OPEN — join the default namespace.
        socket.send('40');
      } else if (type === '4' && msg[1] === '0') {
        // Socket.io CONNECT ack for the default namespace.
        namespaceOk = true;
        namespaceConnected.add(1);
      } else if (type === '2') {
        // Engine.IO PING — must pong or the server times the connection out.
        socket.send('3');
      }
    });

    socket.on('error', () => errored.add(1));

    socket.setTimeout(() => {
      check(null, { 'namespace connected before hold ended': () => namespaceOk });
      socket.close();
    }, HOLD_SECONDS * 1000);

    socket.on('close', () => closedCleanly.add(1));
  });

  check(res, { 'ws handshake status 101': (r) => r && r.status === 101 });
  sleep(1);
}
