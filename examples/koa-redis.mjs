import Koa from "koa";
import bodyParser from "koa-bodyparser";
import Redis from "ioredis";
import { RedisAdapter } from "@reaatech/idempotency-middleware/redis";
import { idempotentKoa } from "@reaatech/idempotency-middleware/koa";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const adapter = new RedisAdapter(redis);
await adapter.connect();

const app = new Koa();
app.use(bodyParser());
app.use(idempotentKoa(adapter, { ttl: 24 * 60 * 60 * 1000 }));

let counter = 0;
app.use((ctx) => {
  if (ctx.method === "POST" && ctx.path === "/charges") {
    counter += 1;
    ctx.status = 201;
    ctx.body = { id: counter, amount: ctx.request.body?.amount };
  }
});

app.listen(3000, () => {
  console.log("listening on http://localhost:3000");
});
