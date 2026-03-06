/**
 * Block Kit message builders for Slack UI
 */

interface Role {
  name: string;
  rationale: string;
}

export function buildDescriptionModal(specId: string) {
  return {
    type: 'modal' as const,
    callback_id: 'feature_description_modal',
    private_metadata: JSON.stringify({ specId }),
    title: {
      type: 'plain_text' as const,
      text: 'New Spec',
    },
    submit: {
      type: 'plain_text' as const,
      text: 'Analyze',
    },
    close: {
      type: 'plain_text' as const,
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
  };
}

export function buildChannelNameSelection(suggestions: string[]) {
  return [
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
          type: 'radio_buttons',
          action_id: 'channel_name_radio',
          options: suggestions.map((name) => ({
            text: {
              type: 'plain_text',
              text: name,
            },
            value: name,
          })),
        },
      ],
    },
    {
      type: 'input',
      block_id: 'custom_channel_name',
      element: {
        type: 'plain_text_input',
        action_id: 'custom_name_input',
        placeholder: {
          type: 'plain_text',
          text: 'Or enter a custom name...',
        },
      },
      label: {
        type: 'plain_text',
        text: 'Custom Channel Name',
      },
      optional: true,
    },
  ];
}

export function buildRoleAssignment(roleName: string, rationale: string) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Assign members to: ${roleName}*\n_${rationale}_`,
      },
    },
    {
      type: 'input',
      block_id: 'role_members',
      element: {
        type: 'multi_users_select',
        action_id: 'select_members',
        placeholder: {
          type: 'plain_text',
          text: 'Select team members...',
        },
      },
      label: {
        type: 'plain_text',
        text: 'Team Members',
      },
    },
  ];
}

export function buildConfirmation(channelName: string, roles: Array<{ name: string; members: string[] }>) {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🎯 Ready to Create Spec Channel',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Channel Name:* ${channelName}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Team Assignments:*',
      },
    },
    ...roles.map((role) => ({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `• *${role.name}*: ${role.members.length} member(s)`,
      },
    })),
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: 'confirm_create',
          text: {
            type: 'plain_text',
            text: 'Create Channel',
          },
          style: 'primary',
        },
        {
          type: 'button',
          action_id: 'cancel_create',
          text: {
            type: 'plain_text',
            text: 'Cancel',
          },
        },
      ],
    },
  ];
}

export function buildWelcomeMessage(specTitle: string, pmName: string, roles: Role[]) {
  return [
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
        text: `Welcome to the coordination channel for this feature specification!\n\n*Initiated by:* ${pmName}\n\nThe Blind QA questioning session will begin shortly.`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Team Roles:*',
      },
    },
    ...roles.map((role) => ({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `• *${role.name}*: ${role.rationale}`,
      },
    })),
    {
      type: 'divider',
    },
  ];
}
