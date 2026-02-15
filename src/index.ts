import express from 'express';
import { config } from 'dotenv';
import { requestIdMiddleware, errorHandler } from './routes/middleware.js';
import { slackApp } from './plugins/slack/client.js';
import specfactoryRoutes from './routes/specfactory.js';
import specRoutes from './routes/spec.js';
import { startSessionCleanup } from './services/session-cleanup.js';
import './plugins/slack/commands.js'; // Register slash commands
import './plugins/slack/interactions.js'; // Register interactive handlers

config();

// Start session cleanup task
startSessionCleanup();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(requestIdMiddleware);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'relay', version: '0.1.0' });
});

// API routes
app.use('/api/specfactory', specfactoryRoutes);
app.use('/api/spec', specRoutes);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start Express server
app.listen(PORT, () => {
  console.log(`🚀 Relay server running on port ${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
});

// Start Slack Bolt app
(async () => {
  try {
    await slackApp.start();
    console.log('⚡️ Slack Bolt app is running!');
  } catch (error) {
    console.error('Failed to start Slack Bolt app:', error);
    process.exit(1);
  }
})();
