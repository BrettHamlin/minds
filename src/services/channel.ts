/**
 * Channel service - manages Slack channels and database records
 */

import { db } from '../db/index.js';
import { channels } from '../db/schema.js';
import { slackApp } from '../plugins/slack/client.js';
import { ConflictError, ERROR_CODES } from '../lib/errors.js';

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

export async function createSlackChannel(name: string): Promise<{ id: string; name: string }> {
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

export async function inviteMembers(slackChannelId: string, userIds: string[]) {
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

export async function postWelcomeMessage(
  slackChannelId: string,
  specTitle: string,
  pmDisplayName: string
) {
  try {
    await slackApp.client.chat.postMessage({
      channel: slackChannelId,
      text: `🎯 *New Spec: ${specTitle}*\n\nStarted by ${pmDisplayName}. Let's get this specified!`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `🎯 ${specTitle}`,
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
