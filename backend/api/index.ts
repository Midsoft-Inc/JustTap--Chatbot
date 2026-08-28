import { app, initializeApp } from '../src/server.js';

export default async function handler(
  request: any,
  response: any
) {
  await initializeApp();

  app.server.emit('request', request, response);
}