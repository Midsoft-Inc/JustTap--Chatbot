import app, { initializeApp } from '../src/server.js';

// Cached across warm invocations of the same function instance -- avoids
// re-running initializeApp() (Mongo connection, plugin registration, route
// registration) on every single request. Safe because server.ts's
// isMainModule guard means importing it here never triggers app.listen()
// as a side effect -- only initializeApp() + the exported app instance are
// used, forwarding each request into Fastify directly.
let ready: Promise<unknown> | undefined;

export default async function handler(request: any, response: any) {
  ready ??= initializeApp();
  await ready;

  app.server.emit('request', request, response);
}