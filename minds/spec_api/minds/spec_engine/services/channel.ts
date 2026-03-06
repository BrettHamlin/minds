/**
 * Channel service - manages Slack channels and database records
 *
 * Supports skipSlack mode for CLI plugin (PLUGIN_TYPE=cli):
 * - Records channel metadata in database without calling Slack API
 * - Uses a synthetic channel ID (cli-{name}) when Slack is skipped
 */

import { db } from '../db/index.js';
import { channels } from '../db/schema.js';
import { ConflictError, ERROR_CODES } from '../errors.js';

export async function createChannelRecord(
  specId: string,
  slackChannelId: string,
  name: string,
  nameSuggestions: string[],
  isCustomName: boolean
) {
  const [channel] = await db
    .insert(channels)
    .values({
      specId,
      slackChannelId,
      name,
      nameSuggestions,
      isCustomName,
    })
    .returning();

  return channel;
}

/**
 * Create a Slack channel or return a synthetic channel reference when skipSlack is true.
 *
 * When skipSlack=true, no Slack API calls are made. A synthetic channel ID is
 * generated so the database record can still be created with a valid reference.
 */
export async function createSlackChannel(
  name: string,
  options?: { skipSlack?: boolean }
): Promise<{ id: string; name: string }> {
  if (options?.skipSlack) {
    return {
      id: `cli-${name}`,
      name,
    };
  }

  const { slackApp } = await import('../../../../../src/plugins/slack/client.js');

  let channelName = name;
  let attempt = 1;
  const maxAttempts = 9;

  while (attempt <= maxAttempts) {
    try {
      const result = await slackApp.client.conversations.create({
        name: channelName,
        is_private: false,
      });

      return {
        id: result.channel!.id!,
        name: result.channel!.name!,
      };
    } catch (error: any) {
      if (error.data?.error === 'name_taken' && attempt < maxAttempts) {
        // Try with -2, -3, etc. suffix
        attempt++;
        channelName = `${name}-${attempt}`;
      } else if (error.data?.error === 'name_taken') {
        // All attempts exhausted
        throw new ConflictError(
          ERROR_CODES.CHANNEL_NAME_TAKEN,
          `Channel name "${name}" and all variants (-2 through -${maxAttempts}) are already taken.`,
          { suggestedAlternative: `${name}-${Date.now()}` }
        );
      } else {
        throw error;
      }
    }
  }

  throw new Error('Unexpected error in createSlackChannel');
}

/**
 * Invite members to a Slack channel. No-op when skipSlack is true.
 */
export async function inviteMembers(
  slackChannelId: string,
  userIds: string[],
  options?: { skipSlack?: boolean }
) {
  if (options?.skipSlack) {
    return;
  }

  const { slackApp } = await import('../../../../../src/plugins/slack/client.js');

  try {
    await slackApp.client.conversations.invite({
      channel: slackChannelId,
      users: userIds.join(','),
    });
  } catch (error: any) {
    console.error('Failed to invite members:', error);
    throw new Error(`Failed to invite members to channel: ${error.message}`);
  }
}

/**
 * Post a welcome message to a Slack channel. No-op when skipSlack is true.
 */
export async function postWelcomeMessage(
  slackChannelId: string,
  specTitle: string,
  pmDisplayName: string,
  options?: { skipSlack?: boolean }
) {
  if (options?.skipSlack) {
    return;
  }

  const { slackApp } = await import('../../../../../src/plugins/slack/client.js');

  try {
    await slackApp.client.chat.postMessage({
      channel: slackChannelId,
      text: `*New Spec: ${specTitle}*\n\nStarted by ${pmDisplayName}. Let's get this specified!`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: specTitle,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Welcome to the coordination channel for this feature specification!\n\n*Initiated by:* ${pmDisplayName}\n\nThe Blind QA questioning session will begin shortly.`,
          },
        },
        {
          type: 'divider',
        },
      ],
    });
  } catch (error: any) {
    console.error('Failed to post welcome message:', error);
    throw new Error(`Failed to post welcome message: ${error.message}`);
  }
}
