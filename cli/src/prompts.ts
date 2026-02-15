/**
 * T029-T033, T037, T049-T054: Terminal prompts using @clack/prompts.
 *
 * - T029: Feature description input (multi-line, 10-word minimum validation)
 * - T030: Channel name selection (5 suggestions, numeric choice)
 * - T031: QA question display with multiple-choice options
 * - T032: Completion summary display (spec ID, view URL, question count)
 * - T033: Error display with retry option for transient failures
 * - T037: Client-side input validation (description word count, channel name format, option index range)
 * - T049: "Other" option detection
 * - T050: QA loop completion detection
 * - T051: Custom text input for "Other" option
 * - T053: Progress display during QA loop
 * - T061: 409 ACTIVE_SESSION_EXISTS handling
 */
import * as p from '@clack/prompts';
import type {
  QuestionResponse,
  CompletionCheckResponse,
  SubmitAnswerResponse,
  NextQuestionResponse,
} from './client.js';

// ----- T037: Client-side input validation -----

/** Minimum number of words required for a feature description. */
const MIN_DESCRIPTION_WORDS = 10;

/** Channel name pattern from OpenAPI spec. */
const CHANNEL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * Count words in a string by splitting on whitespace.
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Validate that a feature description has at least 10 words.
 */
export function validateDescription(description: string): string | undefined {
  const words = countWords(description);
  if (words < MIN_DESCRIPTION_WORDS) {
    return `Feature description must be at least ${MIN_DESCRIPTION_WORDS} words. You provided ${words} words.`;
  }
  return undefined;
}

/**
 * Validate that a channel name matches Slack naming conventions.
 */
export function validateChannelName(name: string): string | undefined {
  if (!CHANNEL_NAME_PATTERN.test(name)) {
    return 'Channel name must start with a letter or number, contain only lowercase letters, numbers, and hyphens, and be 1-80 characters.';
  }
  return undefined;
}

/**
 * Validate that an option index is within the valid range.
 */
export function validateOptionIndex(
  index: number,
  maxIndex: number
): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index > maxIndex) {
    return `Please select a valid option number (1-${maxIndex + 1}).`;
  }
  return undefined;
}

// ----- T029: Feature description input -----

/**
 * Prompt user for a feature description.
 * Uses multi-line text input with 10-word minimum validation.
 */
export async function promptDescription(): Promise<string> {
  const description = await p.text({
    message: 'Describe the feature you want to specify:',
    placeholder:
      'e.g., Build a user authentication system that supports email login, OAuth integration with Google and GitHub, session management with JWT tokens, and password reset via email.',
    validate(value) {
      const error = validateDescription(value);
      if (error) return error;
      return undefined;
    },
  });

  if (p.isCancel(description)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  return description as string;
}

// ----- T030: Channel name selection -----

/**
 * Prompt user to select a channel name from suggestions.
 * Displays 5 suggestions with numeric choice (1-5) plus custom option (6).
 */
export async function promptChannelSelection(
  suggestions: string[]
): Promise<string> {
  const options = [
    ...suggestions.map((name, i) => ({
      value: name,
      label: `${i + 1}. ${name}`,
    })),
    {
      value: '__custom__',
      label: '6. Enter custom channel name',
    },
  ];

  const selection = await p.select({
    message: 'Select a channel name for this spec:',
    options,
  });

  if (p.isCancel(selection)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  // If user selected custom option, prompt for custom name
  if (selection === '__custom__') {
    const customName = await p.text({
      message: 'Enter custom channel name:',
      placeholder: 'my-feature-name',
      validate: validateChannelName,
    });

    if (p.isCancel(customName)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }

    return customName as string;
  }

  return selection as string;
}

// ----- Team member assignment -----

export interface RoleWithRationale {
  name: string;
  rationale: string;
}

export interface RoleAssignment {
  roleName: string;
  members: string[];
}

/**
 * Prompt user to assign team members to each role.
 * For each role, displays name and rationale, then prompts for members.
 * Supports comma-separated member names/IDs with "Skip Role" option.
 */
export async function promptTeamMembers(
  roles: RoleWithRationale[]
): Promise<RoleAssignment[]> {
  const assignments: RoleAssignment[] = [];

  if (roles.length === 0) {
    return assignments;
  }

  p.note(
    `Assign team members to ${roles.length} role${roles.length === 1 ? '' : 's'}`,
    'Team Member Assignment'
  );

  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    const roleNumber = i + 1;

    p.log.info(
      `\nRole ${roleNumber}/${roles.length}: ${role.name}\n${role.rationale}`
    );

    const action = await p.select({
      message: `Assign members to "${role.name}"?`,
      options: [
        { value: 'assign', label: 'Assign team members' },
        { value: 'skip', label: 'Skip this role' },
      ],
    });

    if (p.isCancel(action)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }

    if (action === 'skip') {
      assignments.push({ roleName: role.name, members: [] });
      continue;
    }

    const membersInput = await p.text({
      message: `Enter member names/IDs for "${role.name}" (comma-separated):`,
      placeholder: 'alice, bob, charlie',
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Please enter at least one member or choose "Skip this role"';
        }
        return undefined;
      },
    });

    if (p.isCancel(membersInput)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }

    const members = (membersInput as string)
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m.length > 0);

    assignments.push({ roleName: role.name, members });
  }

  return assignments;
}

// ----- T031: QA question display -----

/**
 * Display a QA question and prompt for an answer.
 * Shows multiple-choice options with numeric selection.
 * Returns the 0-based option index.
 */
export async function promptQuestion(
  questionData: QuestionResponse
): Promise<{ selectedOptionIndex: number }> {
  const { question, progress } = questionData;

  p.note(
    `Question ${progress.current} of ${progress.total}`,
    'Blind QA Progress'
  );

  const selection = await p.select({
    message: question.text,
    options: question.options.map((opt, i) => ({
      value: i,
      label: `${i + 1}. ${opt}`,
    })),
  });

  if (p.isCancel(selection)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  return { selectedOptionIndex: selection as number };
}

// ----- T032: Completion summary -----

/**
 * Display the completion summary after all questions are answered.
 */
export function displayCompletion(
  specId: string,
  specUrl: string,
  totalQuestions: number,
  title?: string
): void {
  const lines = [
    `Spec ID: ${specId}`,
    title ? `Title: ${title}` : null,
    `Questions answered: ${totalQuestions}`,
    `View spec: ${specUrl}`,
  ]
    .filter(Boolean)
    .join('\n');

  p.note(lines, 'Spec Complete');
}

// ----- T033: Error display -----

/**
 * Display an error message to the user.
 * For transient errors, suggests retrying.
 */
export function displayError(
  message: string,
  isTransient: boolean = false
): void {
  p.log.error(message);

  if (isTransient) {
    p.log.info(
      'This may be a temporary issue. The operation will be retried automatically.'
    );
  }
}

/**
 * Display a step message (informational progress).
 */
export function displayStep(message: string): void {
  p.log.step(message);
}

/**
 * Display a success message.
 */
export function displaySuccess(message: string): void {
  p.log.success(message);
}

/**
 * Display a warning message.
 */
export function displayWarning(message: string): void {
  p.log.warn(message);
}

/**
 * Start the CLI intro banner.
 */
export function displayIntro(): void {
  p.intro('SpecFactory CLI');
}

/**
 * End the CLI session.
 */
export function displayOutro(message?: string): void {
  p.outro(message ?? 'Done.');
}

/**
 * Show a spinner while an async operation runs.
 */
export async function withSpinner<T>(
  message: string,
  fn: () => Promise<T>
): Promise<T> {
  const s = p.spinner();
  s.start(message);

  try {
    const result = await fn();
    s.stop(message + ' - done');
    return result;
  } catch (error) {
    s.stop(message + ' - failed');
    throw error;
  }
}

// ----- T049: "Other" option detection -----

/**
 * Detect if a selected option is the "Other" option (last option containing "other").
 * Only the last option in the list can be an "Other" trigger.
 *
 * @param selectedIndex - 0-based index of the selected option
 * @param options - Array of option strings
 * @returns true if this is the "Other" option requiring custom text input
 */
export function isOtherOption(selectedIndex: number, options: string[]): boolean {
  // Only the last option can be "Other"
  if (selectedIndex !== options.length - 1) return false;

  const lastOption = options[options.length - 1].toLowerCase().trim();
  return lastOption.startsWith('other');
}

// ----- T050: QA loop completion detection -----

/**
 * Detect if the QA loop is complete.
 * Handles both NextQuestionResponse (type:"complete") and SubmitAnswerResponse (isComplete:true).
 */
export function isQAComplete(
  response: NextQuestionResponse | SubmitAnswerResponse | Record<string, unknown>
): boolean {
  // Check NextQuestionResponse format: type:"complete"
  if ('type' in response && response.type === 'complete') return true;

  // Check SubmitAnswerResponse format: isComplete:true
  if ('isComplete' in response && response.isComplete === true) return true;

  return false;
}

// ----- T051: Custom text input for "Other" option -----

/**
 * Prompt user for custom text when "Other" option is selected.
 */
export async function promptCustomText(): Promise<string> {
  const text = await p.text({
    message: 'Enter your custom answer:',
    placeholder: 'Type your answer here...',
    validate(value) {
      if (!value.trim()) return 'Please enter a non-empty answer.';
      return undefined;
    },
  });

  if (p.isCancel(text)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  return text as string;
}

// ----- T053: QA progress display -----

/**
 * Display QA progress information.
 */
export function displayProgress(current: number, total: number): void {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const bar = total > 0
    ? '[' + '#'.repeat(Math.round((current / total) * 20)).padEnd(20, '-') + ']'
    : '[' + '-'.repeat(20) + ']';
  p.log.step(`Progress: ${bar} ${current}/${total} (${pct}%)`);
}

// ----- T061: 409 ACTIVE_SESSION_EXISTS handling -----

/**
 * Display a helpful message when an active session already exists.
 */
export function displayActiveSessionError(existingSpecId: string): void {
  p.log.error(`An active session already exists for this user.`);
  p.log.info(`Existing spec ID: ${existingSpecId}`);
  p.log.info('Resolution options:');
  p.log.info('  1. Wait for the existing session to expire (24 hours)');
  p.log.info('  2. Complete the existing session first');
  p.log.info('  3. Use a different OS user to start a new session');
}
