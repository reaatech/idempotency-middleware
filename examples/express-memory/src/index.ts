import express from 'express';
import { MemoryAdapter } from '@reaatech/idempotency-middleware';
import { idempotentExpress } from '@reaatech/idempotency-middleware-express';

const adapter = new MemoryAdapter();
await adapter.connect();

const app = express();
app.use(express.json());
app.use(idempotentExpress(adapter, { ttl: 60_000 }));

let counter = 0;
app.post('/charges', (req, res) => {
  counter += 1;
  res.status(201).json({ id: counter, amount: req.body.amount });
});

app.listen(3000, () => {
  console.log('listening on http://localhost:3000');
  console.log(
    'Try: curl -XPOST -H "Content-Type: application/json" -H "Idempotency-Key: abc" -d \'{"amount": 100}\' http://localhost:3000/charges',
  );
});
