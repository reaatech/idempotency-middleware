import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Koa from 'koa';
import type { Context } from 'koa';
import bodyParser from 'koa-bodyparser';
import request from 'supertest';
import { idempotentKoa } from '../../src/frameworks/koa.js';
import { MemoryAdapter } from '../../src/adapters/MemoryAdapter.js';
import { IdempotencyError, IdempotencyErrorCode } from '../../src/core/IdempotencyError.js';

describe('Koa Middleware E2E', () => {
  let app: Koa;
  let adapter: MemoryAdapter;

  beforeAll(async () => {
    adapter = new MemoryAdapter();
    await adapter.connect();
    app = new Koa();
    app.use(bodyParser());
    app.use(idempotentKoa(adapter, { ttl: 60000 }));

    let counter = 0;
    app.use(async (ctx: Context) => {
      if (ctx.path === '/api/users' && ctx.method === 'POST') {
        counter++;
        ctx.status = 201;
        ctx.body = {
          id: counter,
          name: ctx.request.body,
        };
      } else if (ctx.path === '/api/users' && ctx.method === 'GET') {
        ctx.body = [{ id: 1, name: 'Test' }];
      } else if (ctx.path === '/api/error' && ctx.method === 'POST') {
        ctx.status = 422;
        ctx.body = { error: 'Invalid input' };
      } else {
        ctx.status = 404;
      }
    });
  });

  it('should return same response for duplicate POST requests', async () => {
    const idempotencyKey = 'koa-unique-key-123';

    const response1 = await request(app.callback())
      .post('/api/users')
      .set('Idempotency-Key', idempotencyKey)
      .send({ name: 'John Doe' })
      .expect(201);

    const response2 = await request(app.callback())
      .post('/api/users')
      .set('Idempotency-Key', idempotencyKey)
      .send({ name: 'John Doe' })
      .expect(201);

    expect(response1.body).toEqual(response2.body);
    expect(response1.body).toEqual({ id: 1, name: { name: 'John Doe' } });
  });

  it('should handle concurrent duplicate requests', async () => {
    const idempotencyKey = 'koa-concurrent-key-456';

    const responses = await Promise.all([
      request(app.callback())
        .post('/api/users')
        .set('Idempotency-Key', idempotencyKey)
        .send({ name: 'Jane Doe' })
        .expect(201),
      request(app.callback())
        .post('/api/users')
        .set('Idempotency-Key', idempotencyKey)
        .send({ name: 'Jane Doe' })
        .expect(201),
    ]);

    expect(responses[0].body).toEqual(responses[1].body);
  });

  it('should not cache requests without idempotency key', async () => {
    const response1 = await request(app.callback())
      .post('/api/users')
      .send({ name: 'Test User' })
      .expect(201);

    const response2 = await request(app.callback())
      .post('/api/users')
      .send({ name: 'Test User' })
      .expect(201);

    expect(response1.body.id).not.toBe(response2.body.id);
  });

  it('should skip GET requests by default', async () => {
    const response = await request(app.callback())
      .get('/api/users')
      .set('Idempotency-Key', 'koa-get-key')
      .expect(200);

    expect(response.body).toEqual([{ id: 1, name: 'Test' }]);
  });

  it('should cache error responses', async () => {
    const idempotencyKey = 'koa-error-key-789';

    const response1 = await request(app.callback())
      .post('/api/error')
      .set('Idempotency-Key', idempotencyKey)
      .send({})
      .expect(422);

    const response2 = await request(app.callback())
      .post('/api/error')
      .set('Idempotency-Key', idempotencyKey)
      .send({})
      .expect(422);

    expect(response1.body).toEqual(response2.body);
  });

  it('should use custom error handler for idempotency errors', async () => {
    const customAdapter = new MemoryAdapter();
    await customAdapter.connect();
    const customApp = new Koa();
    customApp.use(bodyParser());

    // Make the adapter throw an IdempotencyError
    customAdapter.get = async () => {
      throw new IdempotencyError(
        IdempotencyErrorCode.STORAGE_ERROR,
        'Storage down'
      );
    };

    customApp.use(
      idempotentKoa(customAdapter, {
        ttl: 60000,
        errorHandler: (ctx, err) => {
          ctx.status = err.getStatusCode();
          ctx.body = { custom: true, message: err.message };
        },
      })
    );

    customApp.use(async (ctx: Context) => {
      if (ctx.path === '/api/test' && ctx.method === 'POST') {
        ctx.body = { ok: true };
      }
    });

    const response = await request(customApp.callback())
      .post('/api/test')
      .set('Idempotency-Key', 'koa-custom-error-key')
      .send({})
      .expect(503);

    expect(response.body).toEqual({ custom: true, message: 'Storage down' });
  });

  it('should use default error handler when no custom handler is set', async () => {
    const defaultAdapter = new MemoryAdapter();
    await defaultAdapter.connect();
    const defaultApp = new Koa();
    defaultApp.use(bodyParser());

    defaultAdapter.get = async () => {
      throw new IdempotencyError(
        IdempotencyErrorCode.STORAGE_ERROR,
        'Storage unavailable'
      );
    };

    defaultApp.use(idempotentKoa(defaultAdapter, { ttl: 60000 }));

    defaultApp.use(async (ctx: Context) => {
      if (ctx.path === '/api/test' && ctx.method === 'POST') {
        ctx.body = { ok: true };
      }
    });

    const response = await request(defaultApp.callback())
      .post('/api/test')
      .set('Idempotency-Key', 'koa-default-error-key')
      .send({})
      .expect(503);

    expect(response.body).toEqual({
      error: 'Storage unavailable',
      code: IdempotencyErrorCode.STORAGE_ERROR,
    });
  });

  it('should propagate non-idempotency errors from downstream middleware', async () => {
    const errorAdapter = new MemoryAdapter();
    await errorAdapter.connect();
    const errorApp = new Koa();
    errorApp.use(bodyParser());
    errorApp.use(idempotentKoa(errorAdapter, { ttl: 60000 }));

    errorApp.use(async (ctx: Context) => {
      if (ctx.path === '/api/boom' && ctx.method === 'POST') {
        throw new Error('Downstream explosion');
      }
    });

    // Koa doesn't have built-in error handling, so the request will fail
    await request(errorApp.callback())
      .post('/api/boom')
      .set('Idempotency-Key', 'koa-boom-key')
      .send({})
      .expect(500);
  });

  it('should not include body hash when includeBodyInKey is false', async () => {
    const noBodyAdapter = new MemoryAdapter();
    await noBodyAdapter.connect();
    const noBodyApp = new Koa();
    noBodyApp.use(bodyParser());
    noBodyApp.use(
      idempotentKoa(noBodyAdapter, { ttl: 60000, includeBodyInKey: false })
    );

    let counter = 0;
    noBodyApp.use(async (ctx: Context) => {
      if (ctx.path === '/api/items' && ctx.method === 'POST') {
        counter++;
        ctx.status = 201;
        ctx.body = { count: counter, body: ctx.request.body };
      }
    });

    const response1 = await request(noBodyApp.callback())
      .post('/api/items')
      .set('Idempotency-Key', 'koa-no-body-key')
      .send({ name: 'first' })
      .expect(201);

    const response2 = await request(noBodyApp.callback())
      .post('/api/items')
      .set('Idempotency-Key', 'koa-no-body-key')
      .send({ name: 'second' })
      .expect(201);

    expect(response1.body).toEqual(response2.body);
    expect(counter).toBe(1);
  });

  it('should return cached response after waiting for lock', async () => {
    const waitAdapter = new MemoryAdapter();
    await waitAdapter.connect();

    // Force lock acquisition to fail, then return cached data after wait
    let acquireCallCount = 0;
    const originalAcquire = waitAdapter.acquireLock.bind(waitAdapter);
    waitAdapter.acquireLock = async (key: string, ttl: number) => {
      acquireCallCount++;
      if (acquireCallCount === 1) {
        // First call: simulate another request holding the lock
        return false;
      }
      return originalAcquire(key, ttl);
    };

    let getCallCount = 0;
    const originalGet = waitAdapter.get.bind(waitAdapter);
    waitAdapter.get = async (key: string) => {
      getCallCount++;
      if (getCallCount <= 1) {
        return null; // Cache miss on first check
      }
      // After wait, return cached result
      return {
        response: { cached: true },
        statusCode: 200,
        createdAt: Date.now(),
        ttl: 60000,
      };
    };

    const waitApp = new Koa();
    waitApp.use(bodyParser());
    waitApp.use(idempotentKoa(waitAdapter, { ttl: 60000, lockPollInterval: 50 }));

    waitApp.use(async (ctx: Context) => {
      if (ctx.path === '/api/wait' && ctx.method === 'POST') {
        ctx.body = { fresh: true };
      }
    });

    const response = await request(waitApp.callback())
      .post('/api/wait')
      .set('Idempotency-Key', 'koa-wait-key')
      .send({})
      .expect(200);

    expect(response.body).toEqual({ cached: true });
  });

  it('should return cached response with headers after waiting for lock', async () => {
    const headerAdapter = new MemoryAdapter();
    await headerAdapter.connect();

    let acquireCallCount = 0;
    const originalAcquire = headerAdapter.acquireLock.bind(headerAdapter);
    headerAdapter.acquireLock = async (key: string, ttl: number) => {
      acquireCallCount++;
      if (acquireCallCount === 1) {
        return false;
      }
      return originalAcquire(key, ttl);
    };

    let getCallCount = 0;
    headerAdapter.get = async (key: string) => {
      getCallCount++;
      if (getCallCount <= 1) {
        return null;
      }
      return {
        response: { cached: true },
        statusCode: 200,
        headers: { 'x-custom-header': 'test-value' },
        createdAt: Date.now(),
        ttl: 60000,
      };
    };

    const headerApp = new Koa();
    headerApp.use(bodyParser());
    headerApp.use(idempotentKoa(headerAdapter, { ttl: 60000, lockPollInterval: 50 }));

    headerApp.use(async (ctx: Context) => {
      if (ctx.path === '/api/header-wait' && ctx.method === 'POST') {
        ctx.body = { fresh: true };
      }
    });

    const response = await request(headerApp.callback())
      .post('/api/header-wait')
      .set('Idempotency-Key', 'koa-header-wait-key')
      .send({})
      .expect(200);

    expect(response.body).toEqual({ cached: true });
    expect(response.headers['x-custom-header']).toBe('test-value');
  });

  it('should return 409 when lock holder crashes without storing', async () => {
    const conflictAdapter = new MemoryAdapter();
    await conflictAdapter.connect();

    conflictAdapter.acquireLock = async () => false;
    conflictAdapter.waitForLock = async () => undefined;
    conflictAdapter.get = async () => null;

    const conflictApp = new Koa();
    conflictApp.use(bodyParser());
    conflictApp.use(idempotentKoa(conflictAdapter, { ttl: 60000 }));

    conflictApp.use(async (ctx: Context) => {
      if (ctx.path === '/api/conflict' && ctx.method === 'POST') {
        ctx.body = { ok: true };
      }
    });

    const response = await request(conflictApp.callback())
      .post('/api/conflict')
      .set('Idempotency-Key', 'koa-conflict-key')
      .send({})
      .expect(409);

    expect(response.body).toEqual({ error: 'Idempotency-Key In Use' });
  });

  it('should skip caching when shouldCache returns false', async () => {
    const skipAdapter = new MemoryAdapter();
    await skipAdapter.connect();
    const skipApp = new Koa();
    skipApp.use(bodyParser());
    skipApp.use(
      idempotentKoa(skipAdapter, {
        ttl: 60000,
        shouldCache: (body) => {
          if (body && typeof body === 'object' && 'transient' in body) return false;
          return true;
        },
      })
    );

    let count = 0;
    skipApp.use(async (ctx: Context) => {
      if (ctx.path === '/api/skip' && ctx.method === 'POST') {
        count++;
        ctx.body = { count, transient: true };
      }
    });

    const r1 = await request(skipApp.callback())
      .post('/api/skip')
      .set('Idempotency-Key', 'koa-skip-key')
      .send({})
      .expect(200);
    const r2 = await request(skipApp.callback())
      .post('/api/skip')
      .set('Idempotency-Key', 'koa-skip-key')
      .send({})
      .expect(200);

    expect(r1.body.count).toBe(1);
    expect(r2.body.count).toBe(2);
  });

  it('should reject keys exceeding maxKeyLength', async () => {
    const longAdapter = new MemoryAdapter();
    await longAdapter.connect();
    const longApp = new Koa();
    longApp.use(bodyParser());
    longApp.use(idempotentKoa(longAdapter, { ttl: 60000, maxKeyLength: 8 }));
    longApp.use(async (ctx: Context) => {
      ctx.body = { ok: true };
    });

    const response = await request(longApp.callback())
      .post('/api/long')
      .set('Idempotency-Key', 'this-is-too-long')
      .send({})
      .expect(400);

    expect(response.body.code).toBe(IdempotencyErrorCode.KEY_REQUIRED);
  });

  it('should accept a custom getKey extractor', async () => {
    const customAdapter = new MemoryAdapter();
    await customAdapter.connect();
    const customApp = new Koa();
    customApp.use(bodyParser());
    customApp.use(
      idempotentKoa(customAdapter, {
        ttl: 60000,
        getKey: (req) => (req as Context).get('X-Custom-Key') || undefined,
      })
    );

    let count = 0;
    customApp.use(async (ctx: Context) => {
      if (ctx.path === '/api/custom' && ctx.method === 'POST') {
        count++;
        ctx.body = { count };
      }
    });

    await request(customApp.callback())
      .post('/api/custom')
      .set('X-Custom-Key', 'aaa')
      .send({})
      .expect(200);
    const r2 = await request(customApp.callback())
      .post('/api/custom')
      .set('X-Custom-Key', 'aaa')
      .send({})
      .expect(200);

    expect(r2.body).toEqual({ count: 1 });
  });
});
