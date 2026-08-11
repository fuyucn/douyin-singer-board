// Slim KuGou API server: static route table with only the endpoints the app
// uses. esbuild inlines the selected modules and their dependencies into the
// sidecar bundle (see sidecar/scripts/bundle.mjs); pkg then packages that
// single file. Keep this in sync with the routes called from
// src/kugouSession.ts and src/KugouDebugModal.tsx.
'use strict';

const express = require('express');
const decode = require('safe-decode-uri-component');
const { cookieToJson, randomString, getGuid, calculateMid } = require('../kugou-api/util/util');
const { cryptoMd5 } = require('../kugou-api/util/crypto');
const { createRequest } = require('../kugou-api/util/request');

const guid = cryptoMd5(getGuid());
const serverDev = randomString(10).toUpperCase();

const routes = [
  ['/login/qr/key', require('../kugou-api/module/login_qr_key')],
  ['/login/qr/create', require('../kugou-api/module/login_qr_create')],
  ['/login/qr/check', require('../kugou-api/module/login_qr_check')],
  ['/login/token', require('../kugou-api/module/login_token')],
  ['/register/dev', require('../kugou-api/module/register_dev')],
  ['/user/playlist', require('../kugou-api/module/user_playlist')],
  ['/user/listen', require('../kugou-api/module/user_listen')],
  ['/user/detail', require('../kugou-api/module/user_detail')],
  ['/user/history', require('../kugou-api/module/user_history')],
  ['/playlist/add', require('../kugou-api/module/playlist_add')],
  ['/playlist/del', require('../kugou-api/module/playlist_del')],
  ['/playlist/tracks/add', require('../kugou-api/module/playlist_tracks_add')],
  ['/search', require('../kugou-api/module/search')],
];

function constructServer() {
  const app = express();
  const { CORS_ALLOW_ORIGIN } = process.env;
  app.set('trust proxy', true);

  // CORS & preflight, matching the upstream server behavior.
  app.use((req, res, next) => {
    if (req.path !== '/' && !req.path.includes('.')) {
      res.set({
        'Access-Control-Allow-Credentials': true,
        'Access-Control-Allow-Origin': CORS_ALLOW_ORIGIN || req.headers.origin || '*',
        'Access-Control-Allow-Headers': 'Authorization,X-Requested-With,Content-Type,Cache-Control',
        'Access-Control-Allow-Methods': 'PUT,POST,GET,DELETE,OPTIONS',
        'Content-Type': 'application/json; charset=utf-8',
      });
    }
    req.method === 'OPTIONS' ? res.status(204).end() : next();
  });

  // Cookie parser.
  app.use((req, _, next) => {
    req.cookies = {};
    (req.headers.cookie || '').split(/;\s+|(?<!\s)\s+$/g).forEach((pair) => {
      const crack = pair.indexOf('=');
      if (crack < 1 || crack === pair.length - 1) {
        return;
      }
      req.cookies[decode(pair.slice(0, crack)).trim()] = decode(pair.slice(crack + 1)).trim();
    });
    next();
  });

  // Set the platform cookies used by the upstream API client.
  app.use((req, res, next) => {
    const cookies = req.cookies || {};
    const isHttps = req.protocol === 'https';
    const cookieSuffix = isHttps ? '; PATH=/; SameSite=None; Secure' : '; PATH=/';

    const ensureCookie = (key, value) => {
      if (Object.prototype.hasOwnProperty.call(cookies, key)) return;
      cookies[key] = String(value);
      res.append('Set-Cookie', `${key}=${cookies[key]}${cookieSuffix}`);
    };

    const mid = calculateMid(process.env.KUGOU_API_GUID ?? guid);
    ensureCookie('KUGOU_API_PLATFORM', process.env.platform);
    ensureCookie('KUGOU_API_MID', mid);
    ensureCookie('KUGOU_API_GUID', process.env.KUGOU_API_GUID ?? guid);
    ensureCookie('KUGOU_API_DEV', (process.env.KUGOU_API_DEV ?? serverDev).toUpperCase());
    ensureCookie('KUGOU_API_MAC', (process.env.KUGOU_API_MAC ?? '02:00:00:00:00:00').toUpperCase());

    req.cookies = cookies;
    next();
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  // GET requests have no body; upstream routes read req.body unconditionally.
  app.use((req, _res, next) => {
    if (req.body == null) req.body = {};
    next();
  });

  app.get('/', (_req, res) => res.sendStatus(200));

  for (const [route, handler] of routes) {
    app.use(route, async (req, res) => {
      [req.query, req.body].forEach((item) => {
        if (typeof item.cookie === 'string') {
          item.cookie = cookieToJson(decode(item.cookie));
        }
      });

      const { cookie, ...params } = req.query;
      const query = Object.assign({}, { cookie: Object.assign({}, req.cookies, cookie) }, params, { body: req.body });

      const authHeader = req.headers['authorization'];
      if (authHeader) {
        query.cookie = {
          ...query.cookie,
          ...cookieToJson(authHeader),
        };
      }

      try {
        const moduleResponse = await handler(query, (config) => {
          let ip = req.ip;
          if (ip.substring(0, 7) === '::ffff:') {
            ip = ip.substring(7);
          }
          config.ip = ip;
          return createRequest(config);
        });

        console.log('[OK]', decode(req.originalUrl));

        const cookies = moduleResponse.cookie;
        if (!query.noCookie) {
          if (Array.isArray(cookies) && cookies.length > 0) {
            const suffix = req.protocol === 'https' ? 'PATH=/; SameSite=None; Secure' : 'PATH=/';
            res.append(
              'Set-Cookie',
              cookies.map((cookie) => `${cookie}; ${suffix}`),
            );
          }
        }

        res.header(moduleResponse.headers).status(moduleResponse.status).send(moduleResponse.body);
      } catch (e) {
        const moduleResponse = e;
        console.log('[ERR]', decode(req.originalUrl), {
          status: moduleResponse.status,
          body: moduleResponse.body,
        });

        if (!moduleResponse.body) {
          res.status(404).send({
            code: 404,
            data: null,
            msg: 'Not Found',
          });
          return;
        }

        res.header(moduleResponse.headers).status(moduleResponse.status).send(moduleResponse.body);
      }
    });
  }

  return app;
}

let currentServer = null;

async function startKugouServer({ port = 3000, host = '127.0.0.1' } = {}) {
  const app = constructServer();
  await new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      currentServer = server;
      console.log(`server running @ http://${host || 'localhost'}:${port}`);
      resolve();
    });
    server.on('error', reject);
  });
}

async function stopKugouServer() {
  const server = currentServer;
  currentServer = null;
  if (!server) return;
  await new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections?.();
  });
}

module.exports = { startKugouServer, stopKugouServer };
