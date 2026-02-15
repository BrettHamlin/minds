import express from 'express';
import { config } from 'dotenv';
import { requestIdMiddleware, errorHandler } from './routes/middleware.js';
import specfactoryRoutes from './routes/specfactory.js';
import specRoutes from './routes/spec.js';
import { startSessionCleanup } from './services/session-cleanup.js';

config();

// Validate and resolve PLUGIN_TYPE environment variable
const VALID_PLUGIN_TYPES = ['cli', 'slack', 'both'] as const;
type PluginType = typeof VALID_PLUGIN_TYPES[number];

const rawPluginType = process.env.PLUGIN_TYPE || 'both';
if (!VALID_PLUGIN_TYPES.includes(rawPluginType as PluginType)) {
  console.error(
    `Invalid PLUGIN_TYPE="${rawPluginType}". Must be one of: ${VALID_PLUGIN_TYPES.join(', ')}. Defaulting to "both".`
  );
}
export const PLUGIN_TYPE: PluginType = VALID_PLUGIN_TYPES.includes(rawPluginType as PluginType)
  ? (rawPluginType as PluginType)
  : 'both';

const slackEnabled = PLUGIN_TYPE === 'slack' || PLUGIN_TYPE === 'both';

// Conditionally import Slack modules only when Slack is enabled
if (slackEnabled) {
  await import('./plugins/slack/commands.js');    // Register slash commands
  await import('./plugins/slack/interactions.js'); // Register interactive handlers
}

// Start session cleanup task
startSessionCleanup();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(requestIdMiddleware);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'relay', version: '0.1.0', pluginType: PLUGIN_TYPE });
});

// API routes
app.use('/api/specfactory', specfactoryRoutes);
app.use('/api/spec', specRoutes);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start Express server
app.listen(PORT, () => {
  console.log(`Relay server running on port ${PORT} (PLUGIN_TYPE=${PLUGIN_TYPE})`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Start Slack Bolt app only when Slack is enabled
if (slackEnabled) {
  (async () => {
    try {
      const { slackApp } = await import('./plugins/slack/client.js');
      await slackApp.start();
      console.log('Slack Bolt app is running!');
    } catch (error) {
      console.error('Failed to start Slack Bolt app:', error);
      process.exit(1);
    }
  })();
} else {
  console.log(`Slack disabled (PLUGIN_TYPE=${PLUGIN_TYPE}) - skipping Bolt initialization`);
}
