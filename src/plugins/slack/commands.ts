/**
 * Slack slash command handlers
 */

import { slackApp } from './client.js';

// Register /specfactory slash command
slackApp.command('/specfactory', async ({ command, ack, client }) => {
  await ack();

  try {
    // Call internal API to start session
    const startResponse = await fetch('http://localhost:3000/api/specfactory/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pmUserId: command.user_id,
        slackChannelId: command.channel_id,
      }),
    });

    const startData = await startResponse.json();

    if (startResponse.status === 409) {
      // Active session exists
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: `⚠️ You already have an active spec creation session in progress.\n\n*Spec ID:* ${startData.details?.existingSpecId}\n*Current Step:* ${startData.details?.step}`,
      });
      return;
    }

    if (!startResponse.ok) {
      throw new Error(`Failed to start session: ${startData.message || startResponse.statusText}`);
    }

    // Open modal to collect feature description
    await client.views.open({
      trigger_id: command.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'feature_description_modal',
        private_metadata: JSON.stringify({ specId: startData.specId }),
        title: {
          type: 'plain_text',
          text: 'New Spec',
        },
        submit: {
          type: 'plain_text',
          text: 'Analyze',
        },
        close: {
          type: 'plain_text',
          text: 'Cancel',
        },
        blocks: [
          {
            type: 'input',
            block_id: 'description_block',
            element: {
              type: 'plain_text_input',
              action_id: 'description_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'Describe the feature you want to specify...',
              },
            },
            label: {
              type: 'plain_text',
              text: 'Feature Description (at least 10 words)',
            },
          },
        ],
      },
    });
  } catch (error: any) {
    console.error('Error handling /specfactory command:', error);
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: `❌ Failed to start spec creation: ${error.message}`,
    });
  }
});

export default slackApp;
