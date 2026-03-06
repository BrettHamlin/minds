/**
 * Slack interactive component handlers for US1
 */

import { slackApp } from './client.js';

// Handle custom answer modal submission
slackApp.view('custom_answer_modal', async ({ ack, body, view, client }) => {
  await ack();

  const metadata = JSON.parse(view.private_metadata);
  const customText = view.state.values.custom_answer_block.custom_answer_input.value;

  try {
    // Submit answer with custom text
    const answerResponse = await fetch('http://localhost:3000/api/specfactory/questions/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        specId: metadata.specId,
        questionId: metadata.questionId,
        customText,
      }),
    });

    const answerData = await answerResponse.json();

    // Update original message to show selected answer
    await client.chat.update({
      channel: metadata.channelId,
      ts: metadata.messageTs,
      text: `✅ Answered: ${customText}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *Answered:* ${customText}`,
          },
        },
      ],
    });

    if (answerData.isComplete) {
      // Fetch spec details for completion summary
      const specResponse = await fetch(`http://localhost:3000/api/spec/${answerData.specId}`, {
        headers: { 'Accept': 'application/json' }
      });
      const specData = await specResponse.json();

      // Post completion summary
      await postCompletionSummary(
        metadata.channelId,
        answerData.specId,
        specData.title,
        `${process.env.SPEC_BASE_URL}/api/spec/${answerData.specId}?format=html`,
        answerData.progress.total,
        specData.complexityScore
      );
    } else {
      // Post next question
      const nextResponse = await fetch('http://localhost:3000/api/specfactory/questions/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specId: answerData.specId }),
      });

      const nextData = await nextResponse.json();

      if (nextData.type === 'question') {
        await postQuestionToChannel(
          metadata.channelId,
          { ...nextData.question, specId: answerData.specId },
          nextData.progress
        );
      }
    }
  } catch (error: any) {
    console.error('Error handling custom answer:', error);
    await client.chat.postMessage({
      channel: metadata.channelId,
      text: `❌ Failed to process custom answer: ${error.message}`,
    });
  }
});

// Handle feature description modal submission
slackApp.view('feature_description_modal', async ({ ack, body, view, client }) => {
  await ack();

  const metadata = JSON.parse(view.private_metadata);
  const description = view.state.values.description_block.description_input.value;

  try {
    // Call analyze endpoint
    const analyzeResponse = await fetch('http://localhost:3000/api/specfactory/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        specId: metadata.specId,
        description,
        pmUserId: body.user.id,
      }),
    });

    const analyzeData = await analyzeResponse.json();

    if (!analyzeResponse.ok) {
      throw new Error(analyzeData.message || 'Analysis failed');
    }

    // Get channel name suggestions
    const channelNamesResponse = await fetch('http://localhost:3000/api/specfactory/channel-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ specId: metadata.specId }),
    });

    const channelNamesData = await channelNamesResponse.json();

    // Send DM with channel name selection
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✨ *${analyzeData.title}*\n\nI've analyzed your feature and identified ${analyzeData.roles.length} team roles needed.\n\n*Complexity Score:* ${analyzeData.complexityScore}/10\n*Estimated Questions:* ${analyzeData.estimatedQuestions}\n\nLet's choose a channel name:`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `✨ ${analyzeData.title}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Complexity:* ${analyzeData.complexityScore}/10 | *Questions:* ~${analyzeData.estimatedQuestions}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Team Roles Identified:*',
          },
        },
        ...analyzeData.roles.map((role: any) => ({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `• *${role.name}*: ${role.rationale}`,
          },
        })),
        {
          type: 'divider',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Choose a channel name:*',
          },
        },
        {
          type: 'actions',
          block_id: 'channel_name_selection',
          elements: [
            {
              type: 'static_select',
              action_id: 'select_channel_name',
              placeholder: {
                type: 'plain_text',
                text: 'Select a channel name',
              },
              options: channelNamesData.suggestions.map((name: string, index: number) => ({
                text: {
                  type: 'plain_text',
                  text: name,
                },
                value: JSON.stringify({ specId: metadata.specId, channelName: name }),
              })),
            },
          ],
        },
        {
          type: 'actions',
          block_id: 'custom_channel_name',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '✏️ Enter Custom Name',
              },
              action_id: 'custom_channel_name_button',
              value: JSON.stringify({ specId: metadata.specId }),
              style: 'primary',
            },
          ],
        },
      ],
      metadata: {
        event_type: 'spec_creation',
        event_payload: {
          specId: metadata.specId,
          step: 'channel_selection',
        },
      },
    });
  } catch (error: any) {
    console.error('Error processing feature description:', error);
    await client.chat.postMessage({
      channel: body.user.id,
      text: `❌ Failed to analyze feature: ${error.message}`,
    });
  }
});

// Handle custom channel name button
slackApp.action('custom_channel_name_button', async ({ ack, body, action, client }) => {
  await ack();

  if (action.type !== 'button') return;

  const { specId } = JSON.parse(action.value);

  // Open modal for custom channel name
  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'custom_channel_name_modal',
      private_metadata: JSON.stringify({ specId }),
      title: {
        type: 'plain_text',
        text: 'Custom Channel Name',
      },
      submit: {
        type: 'plain_text',
        text: 'Continue',
      },
      close: {
        type: 'plain_text',
        text: 'Cancel',
      },
      blocks: [
        {
          type: 'input',
          block_id: 'channel_name_block',
          element: {
            type: 'plain_text_input',
            action_id: 'channel_name_input',
            placeholder: {
              type: 'plain_text',
              text: 'e.g., feature-user-auth',
            },
            min_length: 1,
            max_length: 80,
          },
          label: {
            type: 'plain_text',
            text: 'Channel Name',
          },
          hint: {
            type: 'plain_text',
            text: 'Must be lowercase, use hyphens instead of spaces',
          },
        },
      ],
    },
  });
});

// Handle custom channel name modal submission
slackApp.view('custom_channel_name_modal', async ({ ack, body, view, client }) => {
  await ack();

  const metadata = JSON.parse(view.private_metadata);
  const channelName = view.state.values.channel_name_block.channel_name_input.value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 80);

  // Fetch spec to get roles
  const specResponse = await fetch(`http://localhost:3000/api/spec/${metadata.specId}`, {
    headers: { 'Accept': 'application/json' }
  });
  const spec = await specResponse.json();

  if (!spec.roles || spec.roles.length === 0) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ Channel name: *${channelName}*\n\nNo team roles identified. Creating channel...`,
    });

    // Create channel with no members
    await fetch('http://localhost:3000/api/specfactory/channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ specId: metadata.specId, channelName, roles: [] }),
    });
    return;
  }

  // Start sequential member assignment
  await client.chat.postMessage({
    channel: body.user.id,
    text: `✅ Channel name: *${channelName}*\n\nNow let's assign team members for each role.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ Channel name: *${channelName}*\n\n*Assigning team members...*\n\nRole 1 of ${spec.roles.length}: *${spec.roles[0].name}*\n_${spec.roles[0].rationale}_`,
        },
      },
      {
        type: 'actions',
        block_id: 'member_assignment',
        elements: [
          {
            type: 'multi_users_select',
            action_id: 'assign_members',
            placeholder: {
              type: 'plain_text',
              text: 'Select team members',
            },
          },
        ],
      },
      {
        type: 'actions',
        block_id: 'member_assignment_actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Next Role',
            },
            action_id: 'next_role',
            value: JSON.stringify({
              specId: metadata.specId,
              channelName,
              currentRoleIndex: 0,
              roleAssignments: [],
            }),
            style: 'primary',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Skip This Role',
            },
            action_id: 'skip_role',
            value: JSON.stringify({
              specId: metadata.specId,
              channelName,
              currentRoleIndex: 0,
              roleAssignments: [],
            }),
          },
        ],
      },
    ],
  });
});

// Handle channel name selection
slackApp.action('select_channel_name', async ({ ack, body, action, client }) => {
  await ack();

  if (action.type !== 'static_select') return;

  const { specId, channelName } = JSON.parse(action.selected_option.value);

  // Fetch spec to get roles
  const specResponse = await fetch(`http://localhost:3000/api/spec/${specId}`, {
    headers: { 'Accept': 'application/json' }
  });
  const spec = await specResponse.json();

  if (!spec.roles || spec.roles.length === 0) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ Channel name selected: *${channelName}*\n\nNo team roles identified. Creating channel...`,
    });

    // Create channel with no members
    await fetch('http://localhost:3000/api/specfactory/channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ specId, channelName, roles: [] }),
    });
    return;
  }

  // Start sequential member assignment
  await client.chat.postMessage({
    channel: body.user.id,
    text: `✅ Channel name selected: *${channelName}*\n\nNow let's assign team members for each role.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ Channel name: *${channelName}*\n\n*Assigning team members...*\n\nRole 1 of ${spec.roles.length}: *${spec.roles[0].name}*\n_${spec.roles[0].rationale}_`,
        },
      },
      {
        type: 'actions',
        block_id: 'member_assignment',
        elements: [
          {
            type: 'multi_users_select',
            action_id: 'assign_members',
            placeholder: {
              type: 'plain_text',
              text: 'Select team members',
            },
          },
        ],
      },
      {
        type: 'actions',
        block_id: 'member_assignment_actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Next Role',
            },
            action_id: 'next_role',
            value: JSON.stringify({
              specId,
              channelName,
              currentRoleIndex: 0,
              roleAssignments: [],
            }),
            style: 'primary',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Skip This Role',
            },
            action_id: 'skip_role',
            value: JSON.stringify({
              specId,
              channelName,
              currentRoleIndex: 0,
              roleAssignments: [],
            }),
          },
        ],
      },
    ],
    metadata: {
      event_type: 'member_assignment',
      event_payload: {
        specId,
        channelName,
        currentRoleIndex: 0,
        totalRoles: spec.roles.length,
      },
    },
  });
});

// Handle member assignment next role button
slackApp.action('next_role', async ({ ack, body, action, client }) => {
  await ack();

  if (action.type !== 'button') return;

  const { specId, channelName, currentRoleIndex, roleAssignments } = JSON.parse(action.value);

  // Get selected members from the multi_users_select
  const selectedUsers = body.state?.values?.member_assignment?.assign_members?.selected_users || [];

  // Fetch spec to get roles
  const specResponse = await fetch(`http://localhost:3000/api/spec/${specId}`, {
    headers: { 'Accept': 'application/json' }
  });
  const spec = await specResponse.json();
  const currentRole = spec.roles[currentRoleIndex];

  // Add assignment to list
  const updatedAssignments = [
    ...roleAssignments,
    {
      roleName: currentRole.name,
      members: selectedUsers,
    },
  ];

  const nextRoleIndex = currentRoleIndex + 1;

  // Check if more roles remain
  if (nextRoleIndex < spec.roles.length) {
    const nextRole = spec.roles[nextRoleIndex];

    // Update message with next role
    await client.chat.update({
      channel: body.channel!.id,
      ts: body.message!.ts,
      text: `Assigning members for role ${nextRoleIndex + 1} of ${spec.roles.length}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ Channel name: *${channelName}*\n\n*Assigning team members...*\n\nRole ${nextRoleIndex + 1} of ${spec.roles.length}: *${nextRole.name}*\n_${nextRole.rationale}_`,
          },
        },
        {
          type: 'actions',
          block_id: 'member_assignment',
          elements: [
            {
              type: 'multi_users_select',
              action_id: 'assign_members',
              placeholder: {
                type: 'plain_text',
                text: 'Select team members',
              },
            },
          ],
        },
        {
          type: 'actions',
          block_id: 'member_assignment_actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: nextRoleIndex === spec.roles.length - 1 ? 'Create Channel' : 'Next Role',
              },
              action_id: nextRoleIndex === spec.roles.length - 1 ? 'create_channel' : 'next_role',
              value: JSON.stringify({
                specId,
                channelName,
                currentRoleIndex: nextRoleIndex,
                roleAssignments: updatedAssignments,
              }),
              style: 'primary',
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Skip This Role',
              },
              action_id: 'skip_role',
              value: JSON.stringify({
                specId,
                channelName,
                currentRoleIndex: nextRoleIndex,
                roleAssignments: updatedAssignments,
              }),
            },
          ],
        },
      ],
    });
  } else {
    // All roles assigned, create channel
    await createChannelWithAssignments(client, body, specId, channelName, updatedAssignments);
  }
});

// Handle skip role button
slackApp.action('skip_role', async ({ ack, body, action, client }) => {
  await ack();

  if (action.type !== 'button') return;

  const { specId, channelName, currentRoleIndex, roleAssignments } = JSON.parse(action.value);

  // Fetch spec to get roles
  const specResponse = await fetch(`http://localhost:3000/api/spec/${specId}`, {
    headers: { 'Accept': 'application/json' }
  });
  const spec = await specResponse.json();

  // Add empty assignment for skipped role
  const currentRole = spec.roles[currentRoleIndex];
  const updatedAssignments = [
    ...roleAssignments,
    {
      roleName: currentRole.name,
      members: [],
    },
  ];

  const nextRoleIndex = currentRoleIndex + 1;

  // Check if more roles remain
  if (nextRoleIndex < spec.roles.length) {
    const nextRole = spec.roles[nextRoleIndex];

    // Update message with next role
    await client.chat.update({
      channel: body.channel!.id,
      ts: body.message!.ts,
      text: `Assigning members for role ${nextRoleIndex + 1} of ${spec.roles.length}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ Channel name: *${channelName}*\n\n*Assigning team members...*\n\nRole ${nextRoleIndex + 1} of ${spec.roles.length}: *${nextRole.name}*\n_${nextRole.rationale}_`,
          },
        },
        {
          type: 'actions',
          block_id: 'member_assignment',
          elements: [
            {
              type: 'multi_users_select',
              action_id: 'assign_members',
              placeholder: {
                type: 'plain_text',
                text: 'Select team members',
              },
            },
          ],
        },
        {
          type: 'actions',
          block_id: 'member_assignment_actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: nextRoleIndex === spec.roles.length - 1 ? 'Create Channel' : 'Next Role',
              },
              action_id: nextRoleIndex === spec.roles.length - 1 ? 'create_channel' : 'next_role',
              value: JSON.stringify({
                specId,
                channelName,
                currentRoleIndex: nextRoleIndex,
                roleAssignments: updatedAssignments,
              }),
              style: 'primary',
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Skip This Role',
              },
              action_id: 'skip_role',
              value: JSON.stringify({
                specId,
                channelName,
                currentRoleIndex: nextRoleIndex,
                roleAssignments: updatedAssignments,
              }),
            },
          ],
        },
      ],
    });
  } else {
    // All roles processed, create channel
    await createChannelWithAssignments(client, body, specId, channelName, updatedAssignments);
  }
});

// Handle create channel button (final role assignment)
slackApp.action('create_channel', async ({ ack, body, action, client }) => {
  await ack();

  if (action.type !== 'button') return;

  const { specId, channelName, currentRoleIndex, roleAssignments } = JSON.parse(action.value);

  // Get selected members from the last role
  const selectedUsers = body.state?.values?.member_assignment?.assign_members?.selected_users || [];

  // Fetch spec to get roles
  const specResponse = await fetch(`http://localhost:3000/api/spec/${specId}`, {
    headers: { 'Accept': 'application/json' }
  });
  const spec = await specResponse.json();
  const currentRole = spec.roles[currentRoleIndex];

  // Add final assignment to list
  const updatedAssignments = [
    ...roleAssignments,
    {
      roleName: currentRole.name,
      members: selectedUsers,
    },
  ];

  await createChannelWithAssignments(client, body, specId, channelName, updatedAssignments);
});

// Helper function to create channel with assignments
async function createChannelWithAssignments(
  client: any,
  body: any,
  specId: string,
  channelName: string,
  roleAssignments: Array<{ roleName: string; members: string[] }>
) {
  try {
    // Call channel creation endpoint
    const channelResponse = await fetch('http://localhost:3000/api/specfactory/channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        specId,
        channelName,
        roles: roleAssignments,
      }),
    });

    const channelData = await channelResponse.json();

    if (!channelResponse.ok) {
      throw new Error(channelData.message || 'Channel creation failed');
    }

    // Update message to show success
    await client.chat.update({
      channel: body.channel!.id,
      ts: body.message!.ts,
      text: `✅ Channel created: #${channelData.channelName}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ *Channel Created!*\n\n#${channelData.channelName}\n\nBlind QA has started in the channel. Answer the questions to generate your specification.`,
          },
        },
      ],
    });
  } catch (error: any) {
    console.error('Error creating channel:', error);
    await client.chat.postMessage({
      channel: body.user!.id,
      text: `❌ Failed to create channel: ${error.message}`,
    });
  }
}

export default slackApp;

// --- Blind QA Handlers ---

export async function postQuestionToChannel(
  slackChannelId: string,
  question: { id: string; text: string; options: string[]; specId?: string },
  progress: { current: number; total: number }
) {
  const result = await slackApp.client.chat.postMessage({
    channel: slackChannelId,
    text: `**Question ${progress.current} of ${progress.total}**\n\n${question.text}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Question ${progress.current} of ${progress.total}*\n\n${question.text}`,
        },
      },
      {
        type: 'actions',
        block_id: `question_${question.id}`,
        elements: question.options.map((option, index) => ({
          type: 'button',
          text: {
            type: 'plain_text',
            text: option,
          },
          value: JSON.stringify({ questionId: question.id, optionIndex: index, optionText: option }),
          action_id: `answer_${question.id}_${index}`,
        })),
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Progress: ${Math.round((progress.current / progress.total) * 100)}%`,
          },
        ],
      },
    ],
    metadata: {
      event_type: 'blind_qa_question',
      event_payload: {
        specId: question.specId,
        questionId: question.id,
      },
    },
  });

  return result.ts;
}

// Handle question answer button clicks
slackApp.action(/^answer_.*/, async ({ ack, body, action, client }) => {
  await ack();

  if (action.type !== 'button') return;

  const { questionId, optionIndex, optionText } = JSON.parse(action.value);

  // Check if "Other" was selected
  if (optionText.toLowerCase() === 'other') {
    // Open modal for custom answer
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'custom_answer_modal',
        private_metadata: JSON.stringify({
          specId: body.message?.metadata?.event_payload?.specId,
          questionId,
          messageTs: body.message!.ts,
          channelId: body.channel!.id,
        }),
        title: {
          type: 'plain_text',
          text: 'Custom Answer',
        },
        submit: {
          type: 'plain_text',
          text: 'Submit',
        },
        close: {
          type: 'plain_text',
          text: 'Cancel',
        },
        blocks: [
          {
            type: 'input',
            block_id: 'custom_answer_block',
            element: {
              type: 'plain_text_input',
              action_id: 'custom_answer_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'Enter your custom answer...',
              },
              min_length: 1,
            },
            label: {
              type: 'plain_text',
              text: 'Your Answer',
            },
          },
        ],
      },
    });
    return;
  }

  try {
    // Submit answer
    const answerResponse = await fetch('http://localhost:3000/api/specfactory/questions/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        specId: body.message?.metadata?.event_payload?.specId,
        questionId,
        selectedOptionIndex: optionIndex,
      }),
    });

    const answerData = await answerResponse.json();

    // Update message to show selected answer
    await client.chat.update({
      channel: body.channel!.id,
      ts: body.message!.ts,
      text: `✅ Answered: ${optionText}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `~${body.message!.text}~\n\n✅ *Answered:* ${optionText}`,
          },
        },
      ],
    });

    if (answerData.isComplete) {
      // Fetch spec details for completion summary
      const specResponse = await fetch(`http://localhost:3000/api/spec/${answerData.specId}`, {
        headers: { 'Accept': 'application/json' }
      });
      const specData = await specResponse.json();

      // Post completion summary
      await postCompletionSummary(
        body.channel!.id,
        answerData.specId,
        specData.title,
        `${process.env.SPEC_BASE_URL}/api/spec/${answerData.specId}?format=html`,
        answerData.progress.total,
        specData.complexityScore
      );
    } else {
      // Post next question
      const nextResponse = await fetch('http://localhost:3000/api/specfactory/questions/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specId: answerData.specId }),
      });

      const nextData = await nextResponse.json();

      if (nextData.type === 'question') {
        await postQuestionToChannel(
          body.channel!.id,
          { ...nextData.question, specId: answerData.specId },
          nextData.progress
        );
      }
    }
  } catch (error: any) {
    console.error('Error handling answer:', error);
    await client.chat.postMessage({
      channel: body.channel!.id,
      text: `❌ Failed to process answer: ${error.message}`,
    });
  }
});

// Post completion summary to Slack channel
export async function postCompletionSummary(
  slackChannelId: string,
  specId: string,
  specTitle: string,
  specUrl: string,
  totalQuestions: number,
  complexityScore: number
) {
  await slackApp.client.chat.postMessage({
    channel: slackChannelId,
    text: `🎉 Specification Complete!\n\n${specTitle}\n\nView at: ${specUrl}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🎉 Specification Complete!',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${specTitle}*\n\nYour feature specification has been generated and is ready to view.`,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Questions Answered:*\n${totalQuestions}`,
          },
          {
            type: 'mrkdwn',
            text: `*Complexity Score:*\n${complexityScore}/10`,
          },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '📄 View Full Specification',
            },
            url: specUrl,
            style: 'primary',
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Completed at ${new Date().toLocaleString()} | Generated by SpecFactory`,
          },
        ],
      },
    ],
  });
}
