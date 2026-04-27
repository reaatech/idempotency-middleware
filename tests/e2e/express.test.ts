import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { idempotentExpress } from '../../src/frameworks/express.js';
import { MemoryAdapter } from '../../src/adapters/MemoryAdapter.js';
import { IdempotencyError, IdempotencyErrorCode } from '../../src/core/IdempotencyError.js';

describe('Express Middleware E2E', () => {
  let app: express.Express;
  let adapter: MemoryAdapter;

  beforeAll(async () => {
    adapter = new MemoryAdapter();
    await adapter.connect();
    app = express();
    app.use(express.json());
    app.use(idempotentExpress(adapter, { ttl: 60000 }));

    let counter = 0;
    app.post('/api/users', (req, res) => {
      counter++;
      res.status(201).json({
        id: counter,
        name: req.body.name,
        email: req.body.email,
      });
    });

    app.put('/api/users/:id', (req, res) => {
      counter++;
      res.json({
        id: req.params.id,
        name: req.body.name,
        email: req.body.email,
      });
    });
  });

  it('should return same response for duplicate POST requests', async () => {
    const idempotencyKey = 'unique-key-123';
    const payload = { name: 'John Doe', email: 'john@example.com' };

    const response1 = await request(app)
      .post('/api/users')
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    const response2 = await request(app)
      .post('/api/users')
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    expect(response1.body).toEqual(response2.body);
    expect(response1.body).toEqual({
      id: 1,
      name: 'John Doe',
      email: 'john@example.com',
    });
  });

  it('should handle concurrent duplicate requests', async () => {
    const idempotencyKey = 'concurrent-key-456';
    const payload = { name: 'Jane Doe', email: 'jane@example.com' };

    const responses = await Promise.all([
      request(app)
        .post('/api/users')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201),
      request(app)
        .post('/api/users')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201),
      request(app)
        .post('/api/users')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201),
    ]);

    // All responses should be identical
    expect(responses[0].body).toEqual(responses[1].body);
    expect(responses[1].body).toEqual(responses[2].body);
  });

  it('should not cache requests without idempotency key', async () => {
    const payload = { name: 'Test User', email: 'test@example.com' };

    const response1 = await request(app)
      .post('/api/users')
      .send(payload)
      .expect(201);

    const response2 = await request(app)
      .post('/api/users')
      .send(payload)
      .expect(201);

    // Without idempotency key, each request should execute independently
    expect(response1.body.id).not.toBe(response2.body.id);
  });

  it('should skip GET requests by default', async () => {
    app.get('/api/users', (_req, res) => {
      res.json([{ id: 1, name: 'Test' }]);
    });

    const response = await request(app)
      .get('/api/users')
      .set('Idempotency-Key', 'get-key')
      .expect(200);

    expect(response.body).toEqual([{ id: 1, name: 'Test' }]);
  });

  it('should cache error responses', async () => {
    const idempotencyKey = 'error-key-789';

    const errorAdapter = new MemoryAdapter();
    await errorAdapter.connect();
    const errorApp = express();
    errorApp.use(express.json());
    errorApp.use(idempotentExpress(errorAdapter, { ttl: 60000 }));

    let callCount = 0;
    errorApp.post('/api/error', (_req, res) => {
      callCount++;
      res.status(422).json({ error: 'Invalid input' });
    });

    const response1 = await request(errorApp)
      .post('/api/error')
      .set('Idempotency-Key', idempotencyKey)
      .send({})
      .expect(422);

    const response2 = await request(errorApp)
      .post('/api/error')
      .set('Idempotency-Key', idempotencyKey)
      .send({})
      .expect(422);

    expect(response1.body).toEqual(response2.body);
    expect(callCount).toBe(1);
  });

  it('should use custom error handler for idempotency errors', async () => {
    const customAdapter = new MemoryAdapter();
    await customAdapter.connect();
    const customApp = express();
    customApp.use(express.json());

    // Make the adapter throw an IdempotencyError
    customAdapter.get = async () => {
      throw new IdempotencyError(
        IdempotencyErrorCode.STORAGE_ERROR,
        'Storage down'
      );
    };

    customApp.use(
      idempotentExpress(customAdapter, {
        ttl: 60000,
        errorHandler: (err, _req, res, _next) => {
          res.status(err.getStatusCode()).json({ custom: true, message: err.message });
        },
      })
    );

    customApp.post('/api/test', (_req, res) => {
      res.json({ ok: true });
    });

    const response = await request(customApp)
      .post('/api/test')
      .set('Idempotency-Key', 'custom-error-key')
      .send({})
      .expect(503);

    expect(response.body).toEqual({ custom: true, message: 'Storage down' });
  });

  it('should respond with the IdempotencyError status when no handler is configured', async () => {
    const defaultAdapter = new MemoryAdapter();
    await defaultAdapter.connect();
    const defaultApp = express();
    defaultApp.use(express.json());

    defaultAdapter.get = async () => {
      throw new IdempotencyError(
        IdempotencyErrorCode.STORAGE_ERROR,
        'Storage unavailable'
      );
    };

    defaultApp.use(idempotentExpress(defaultAdapter, { ttl: 60000 }));

    defaultApp.post('/api/test', (_req, res) => {
      res.json({ ok: true });
    });

    const response = await request(defaultApp)
      .post('/api/test')
      .set('Idempotency-Key', 'default-error-key')
      .send({})
      .expect(503);

    expect(response.body).toEqual({
      error: 'Storage unavailable',
      code: IdempotencyErrorCode.STORAGE_ERROR,
    });
  });

  it('should call next(error) for non-idempotency errors', async () => {
    const crashAdapter = new MemoryAdapter();
    await crashAdapter.connect();
    const crashApp = express();
    crashApp.use(express.json());

    crashAdapter.get = async () => {
      throw new Error('Unexpected crash');
    };

    crashApp.use(idempotentExpress(crashAdapter, { ttl: 60000 }));

    crashApp.post('/api/test', (_req, res) => {
      res.json({ ok: true });
    });

    const response = await request(crashApp)
      .post('/api/test')
      .set('Idempotency-Key', 'crash-key')
      .send({})
      .expect(500);

    expect(response.body).toBeDefined();
  });

  it('should handle storage.set failure gracefully', async () => {
    const failAdapter = new MemoryAdapter();
    await failAdapter.connect();
    const failApp = express();
    failApp.use(express.json());

    // Make set throw unconditionally to hit the .catch() branch
    let setCallCount = 0;
    failAdapter.set = async () => {
      setCallCount++;
      throw new Error('Set failed');
    };

    failApp.use(idempotentExpress(failAdapter, { ttl: 60000 }));

    failApp.post('/api/test', (_req, res) => {
      res.json({ ok: true });
    });

    const response = await request(failApp)
      .post('/api/test')
      .set('Idempotency-Key', 'fail-set-key')
      .send({})
      .expect(200);

    expect(response.body).toEqual({ ok: true });

    // Give the finish callback time to execute for coverage
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('should handle res.end() without body capture', async () => {
    const endAdapter = new MemoryAdapter();
    await endAdapter.connect();
    const endApp = express();
    endApp.use(express.json());
    endApp.use(idempotentExpress(endAdapter, { ttl: 60000 }));

    endApp.post('/api/end', (_req, res) => {
      res.status(204).end();
    });

    const response1 = await request(endApp)
      .post('/api/end')
      .set('Idempotency-Key', 'end-key')
      .send({})
      .expect(204);

    const response2 = await request(endApp)
      .post('/api/end')
      .set('Idempotency-Key', 'end-key')
      .send({})
      .expect(204);

    expect(response1.status).toBe(204);
    expect(response2.status).toBe(204);
  });

  it('should handle res.send() directly', async () => {
    const sendAdapter = new MemoryAdapter();
    await sendAdapter.connect();
    const sendApp = express();
    sendApp.use(express.json());
    sendApp.use(idempotentExpress(sendAdapter, { ttl: 60000 }));

    sendApp.post('/api/send', (_req, res) => {
      res.status(200).send({ sent: true });
    });

    const response1 = await request(sendApp)
      .post('/api/send')
      .set('Idempotency-Key', 'send-key')
      .send({})
      .expect(200);

    const response2 = await request(sendApp)
      .post('/api/send')
      .set('Idempotency-Key', 'send-key')
      .send({})
      .expect(200);

    expect(response1.body).toEqual({ sent: true });
    expect(response2.body).toEqual({ sent: true });
  });

  it('should return cached response after waiting for lock', async () => {
    const waitAdapter = new MemoryAdapter();
    await waitAdapter.connect();

    let acquireCallCount = 0;
    const originalAcquire = waitAdapter.acquireLock.bind(waitAdapter);
    waitAdapter.acquireLock = async (key: string, ttl: number) => {
      acquireCallCount++;
      if (acquireCallCount === 1) {
        return false;
      }
      return originalAcquire(key, ttl);
    };

    let getCallCount = 0;
    waitAdapter.get = async (key: string) => {
      getCallCount++;
      if (getCallCount <= 1) {
        return null;
      }
      return {
        response: { cached: true },
        statusCode: 200,
        headers: { 'x-custom': 'value' },
        createdAt: Date.now(),
        ttl: 60000,
      };
    };

    const waitApp = express();
    waitApp.use(express.json());
    waitApp.use(idempotentExpress(waitAdapter, { ttl: 60000, lockPollInterval: 50 }));

    waitApp.post('/api/wait', (_req, res) => {
      res.json({ fresh: true });
    });

    const response = await request(waitApp)
      .post('/api/wait')
      .set('Idempotency-Key', 'wait-key')
      .send({})
      .expect(200);

    expect(response.body).toEqual({ cached: true });
    expect(response.headers['x-custom']).toBe('value');
  });

  it('should return 409 when lock holder crashes without storing', async () => {
    const conflictAdapter = new MemoryAdapter();
    await conflictAdapter.connect();

    conflictAdapter.acquireLock = async () => false;
    conflictAdapter.waitForLock = async () => undefined;
    conflictAdapter.get = async () => null;

    const conflictApp = express();
    conflictApp.use(express.json());
    conflictApp.use(idempotentExpress(conflictAdapter, { ttl: 60000 }));

    conflictApp.post('/api/conflict', (_req, res) => {
      res.json({ ok: true });
    });

    const response = await request(conflictApp)
      .post('/api/conflict')
      .set('Idempotency-Key', 'conflict-key')
      .send({})
      .expect(409);

    expect(response.body).toEqual({ error: 'Idempotency-Key In Use' });
  });

  it('should skip caching when shouldCache returns false', async () => {
    const adapter2 = new MemoryAdapter();
    await adapter2.connect();
    const app2 = express();
    app2.use(express.json());
    app2.use(
      idempotentExpress(adapter2, {
        ttl: 60000,
        shouldCache: (body) => {
          if (body && typeof body === 'object' && 'transient' in body) return false;
          return true;
        },
      })
    );

    let count = 0;
    app2.post('/api/skip', (_req, res) => {
      count++;
      res.json({ count, transient: true });
    });

    const r1 = await request(app2)
      .post('/api/skip')
      .set('Idempotency-Key', 'skip-key')
      .send({})
      .expect(200);
    const r2 = await request(app2)
      .post('/api/skip')
      .set('Idempotency-Key', 'skip-key')
      .send({})
      .expect(200);

    expect(r1.body.count).toBe(1);
    expect(r2.body.count).toBe(2);
  });

  it('should reject keys exceeding maxKeyLength with 400', async () => {
    const adapter2 = new MemoryAdapter();
    await adapter2.connect();
    const app2 = express();
    app2.use(express.json());
    app2.use(idempotentExpress(adapter2, { ttl: 60000, maxKeyLength: 8 }));
    app2.post('/api/long', (_req, res) => res.json({ ok: true }));

    const response = await request(app2)
      .post('/api/long')
      .set('Idempotency-Key', 'this-is-too-long')
      .send({})
      .expect(400);

    expect(response.body.code).toBe(IdempotencyErrorCode.KEY_REQUIRED);
  });

  it('should accept a custom getKey extractor', async () => {
    const adapter2 = new MemoryAdapter();
    await adapter2.connect();
    const app2 = express();
    app2.use(express.json());
    app2.use(
      idempotentExpress(adapter2, {
        ttl: 60000,
        getKey: (req) => (req as { headers: Record<string, string> }).headers['x-custom-key'],
      })
    );

    let count = 0;
    app2.post('/api/custom', (_req, res) => {
      count++;
      res.json({ count });
    });

    await request(app2)
      .post('/api/custom')
      .set('X-Custom-Key', 'aaa')
      .send({})
      .expect(200);
    const r2 = await request(app2)
      .post('/api/custom')
      .set('X-Custom-Key', 'aaa')
      .send({})
      .expect(200);

    expect(r2.body).toEqual({ count: 1 });
  });

  it('should release the lock on a dropped client connection', async () => {
    const adapter2 = new MemoryAdapter();
    await adapter2.connect();

    let releaseCount = 0;
    const originalRelease = adapter2.releaseLock.bind(adapter2);
    adapter2.releaseLock = async (key: string) => {
      releaseCount++;
      await originalRelease(key);
    };

    const app2 = express();
    app2.use(express.json());
    app2.use(idempotentExpress(adapter2, { ttl: 60000, lockTtl: 60000 }));

    app2.post('/api/slow', async (_req, res) => {
      // Hang briefly so the client can abort
      await new Promise((resolve) => setTimeout(resolve, 100));
      res.json({ ok: true });
    });

    const server = app2.listen(0);
    const port = (server.address() as { port: number }).port;

    const aborter = new AbortController();
    const fetchPromise = fetch(`http://127.0.0.1:${port}/api/slow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'abort-key',
      },
      body: JSON.stringify({}),
      signal: aborter.signal,
    }).catch(() => undefined);

    await new Promise((resolve) => setTimeout(resolve, 20));
    aborter.abort();
    await fetchPromise;

    // Give 'close' time to fire and the cleanup to run
    await new Promise((resolve) => setTimeout(resolve, 200));
    server.close();

    expect(releaseCount).toBeGreaterThan(0);
  });
});
