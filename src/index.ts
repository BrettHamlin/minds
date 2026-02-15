import express from 'express';
import { config } from 'dotenv';

config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'relay', version: '0.1.0' });
});

app.listen(PORT, () => {
  console.log(`🚀 Relay server running on port ${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
});
