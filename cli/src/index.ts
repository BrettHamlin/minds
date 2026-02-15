#!/usr/bin/env node
/**
 * T034-T036, T044-T048, T052, T054, T057: CLI entrypoint for SpecFactory.
 *
 * - T034: Commander setup with --backend-url, --no-slack, --help, --version
 * - T035: Main workflow orchestration
 * - T036: SIGINT handler for clean interruption
 * - T044: --json flag for JSON envelope output
 * - T045: --auto-answer flag for unattended execution
 * - T046: stdin input handling for piped descriptions
 * - T047: Wire JSON output mode through workflow
 * - T048: Exit code logic (0=success, 1=user, 2=backend, 3=network)
 * - T052: QA loop completion detection
 * - T054: Wire custom text through submitAnswer
 * - T057: --verbose flag for request/response logging
 */
import { Command } from 'commander';
import { generateSessionId } from './session.js';
import { SpecFactoryClient, ApiError, getHumanReadableError } from './client.js';
import type {
  AnalyzeResponse,
  QuestionResponse,
  CompletionCheckResponse,
} from './client.js';
import {
  displayIntro,
  displayOutro,
  displayStep,
  displaySuccess,
  displayError,
  promptTeamMembers,
  type RoleWithRationale,
  displayCompletion,
  displayProgress,
  displayActiveSessionError,
  promptDescription,
  promptChannelSelection,
  promptQuestion,
  promptCustomText,
  isOtherOption,
  isQAComplete,
  withSpinner,
} from './prompts.js';
import {
  createSuccessEnvelope,
  createErrorEnvelope,
  printJSON,
  ExitCode,
} from './output.js';

// Read version from package.json at build time
const VERSION = '0.1.0';

// ----- T036: SIGINT Handler -----

let isShuttingDown = false;

function setupSigintHandler(jsonMode: boolean): void {
  process.on('SIGINT', () => {
    if (isShuttingDown) {
      // Second Ctrl+C -- force exit
      process.exit(1);
    }

    isShuttingDown = true;

    if (jsonMode) {
      printJSON(
        createErrorEnvelope('INTERRUPTED', 'User interrupted the workflow', '', {
          retryable: false,
        })
      );
    } else {
      console.log('\nInterrupted. Cleaning up...');
    }
    // Session state on the backend is not corrupted -- it remains in its
    // current step and will expire after 24 hours if not resumed.
    process.exit(0);
  });
}

// ----- T046: stdin handling -----

/**
 * Read description from stdin when input is piped (not a TTY).
 */
async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;

  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      const trimmed = data.trim();
      resolve(trimmed || null);
    });
    // If nothing comes after a reasonable time, resolve null
    setTimeout(() => {
      if (!data) resolve(null);
    }, 1000);
  });
}

// ----- T034, T044, T045, T057: Commander setup -----

function createProgram(): Command {
  const program = new Command();

  program
    .name('specfactory')
    .description(
      'CLI plugin for SpecFactory - test the full specification workflow without Slack'
    )
    .version(VERSION, '-V, --version', 'Display version number')
    .option(
      '--backend-url <url>',
      'Backend server URL (default: SPECFACTORY_BACKEND_URL env or http://localhost:3000)'
    )
    .option('--no-slack', 'Skip Slack operations (channel creation, member invitation)')
    .option('--json', 'Output results as JSON envelopes to stdout')
    .option(
      '--auto-answer',
      'Automatically select the first option at every choice point'
    )
    .option('--verbose', 'Show detailed HTTP request/response logging')
    .action(async (options) => {
      await runWorkflow(options);
    });

  return program;
}

// ----- T035, T047, T048: Main workflow orchestration -----

interface WorkflowOptions {
  backendUrl?: string;
  slack?: boolean;
  json?: boolean;
  autoAnswer?: boolean;
  verbose?: boolean;
}

async function runWorkflow(options: WorkflowOptions): Promise<void> {
  const jsonMode = options.json ?? false;
  const autoAnswer = options.autoAnswer ?? false;
  const verbose = options.verbose ?? false;
  const startTime = Date.now();

  if (!jsonMode) {
    displayIntro();
  }

  setupSigintHandler(jsonMode);

  const client = new SpecFactoryClient({
    backendUrl: options.backendUrl,
    verbose,
  });

  try {
    // Step 1: Health check
    if (!jsonMode) {
      displayStep(`Connecting to backend at ${client.getBackendUrl()}...`);
    }

    try {
      if (jsonMode) {
        await client.healthCheck();
      } else {
        await withSpinner('Checking backend health', () => client.healthCheck());
        displaySuccess('Backend is healthy.');
      }
    } catch (error) {
      const msg = `Cannot reach backend at ${client.getBackendUrl()}. Is the server running?`;
      if (jsonMode) {
        printJSON(
          createErrorEnvelope('NETWORK_ERROR', msg, client.getBackendUrl(), {
            retryable: true,
            duration_ms: Date.now() - startTime,
          })
        );
        process.exit(ExitCode.NETWORK_ERROR);
      }
      displayError(msg);
      process.exit(ExitCode.NETWORK_ERROR);
    }

    // Step 2: Generate session ID and start session
    const pmUserId = generateSessionId();
    if (!jsonMode) {
      displayStep(`Session: ${pmUserId}`);
    }

    let specId: string;
    let sessionId: string;

    try {
      const startResult = jsonMode
        ? await client.startSession(pmUserId)
        : await withSpinner('Starting session', () =>
            client.startSession(pmUserId)
          );
      specId = startResult.specId;
      sessionId = startResult.sessionId;
      if (!jsonMode) {
        displaySuccess(`Session started. Spec ID: ${specId}`);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ACTIVE_SESSION_EXISTS') {
        const existingSpecId =
          (error.details as Record<string, unknown>)?.existingSpecId ?? 'unknown';

        if (jsonMode) {
          printJSON(
            createErrorEnvelope(
              'ACTIVE_SESSION_EXISTS',
              getHumanReadableError('ACTIVE_SESSION_EXISTS'),
              client.getBackendUrl(),
              {
                retryable: false,
                duration_ms: Date.now() - startTime,
                details: { existingSpecId },
              }
            )
          );
          process.exit(ExitCode.USER_ERROR);
        }

        displayActiveSessionError(String(existingSpecId));
        process.exit(ExitCode.USER_ERROR);
      }
      throw error;
    }

    // Step 3: Get description from stdin or interactive prompt
    let description: string;
    const stdinInput = await readStdin();

    if (stdinInput) {
      description = stdinInput;
      if (!jsonMode) {
        displayStep(`Using piped description: "${description.slice(0, 80)}..."`);
      }
    } else if (autoAnswer) {
      // auto-answer mode but no stdin -- error
      const msg =
        'No description provided via stdin. Pipe a description when using --auto-answer.';
      if (jsonMode) {
        printJSON(
          createErrorEnvelope('MISSING_INPUT', msg, client.getBackendUrl(), {
            retryable: false,
            duration_ms: Date.now() - startTime,
          })
        );
        process.exit(ExitCode.USER_ERROR);
      }
      displayError(msg);
      process.exit(ExitCode.USER_ERROR);
    } else {
      description = await promptDescription();
    }

    // Step 4: Analyze description (LLM call)
    let analysisResult: AnalyzeResponse;
    try {
      analysisResult = jsonMode
        ? await client.analyzeDescription(specId, pmUserId, description)
        : await withSpinner('Analyzing feature description', () =>
            client.analyzeDescription(specId, pmUserId, description)
          );

      if (!jsonMode) {
        displaySuccess(`Analysis complete: "${analysisResult.title}"`);
        displayStep(
          `Complexity: ${analysisResult.complexityScore}/10 | Estimated questions: ${analysisResult.estimatedQuestions}`
        );
        displayStep(
          `Roles: ${analysisResult.roles.map((r) => r.name).join(', ')}`
        );
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (jsonMode) {
          printJSON(
            createErrorEnvelope(
              error.code,
              getHumanReadableError(error.code),
              client.getBackendUrl(),
              {
                retryable: error.code === 'LLM_ERROR',
                duration_ms: Date.now() - startTime,
              }
            )
          );
          process.exit(ExitCode.BACKEND_ERROR);
        }
        displayError(`Analysis failed: ${error.message}`);
      }
      throw error;
    }

    // Step 5: Get channel name suggestions (LLM call)
    const channelNamesResult = jsonMode
      ? await client.getChannelNames(specId)
      : await withSpinner('Generating channel name suggestions', () =>
          client.getChannelNames(specId)
        );

    // Step 6: Select channel name
    let selectedChannel: string;
    if (autoAnswer) {
      // Auto-select first suggestion
      selectedChannel = channelNamesResult.suggestions[0];
      if (!jsonMode) {
        displayStep(`Auto-selected channel: ${selectedChannel}`);
      }
    } else {
      selectedChannel = await promptChannelSelection(
        channelNamesResult.suggestions
      );
    }

    // Step 6b: Assign team members to roles
    let roles;
    if (autoAnswer) {
      // Auto-assign empty members in auto-answer mode
      roles = analysisResult.roles.map((r) => ({
        roleName: r.name,
        members: [] as string[],
      }));
    } else {
      // Prompt for team member assignment
      const rolesWithRationale: RoleWithRationale[] = analysisResult.roles.map(
        (r) => ({
          name: r.name,
          rationale: r.rationale,
        })
      );
      const assignments = await promptTeamMembers(rolesWithRationale);
      roles = assignments;
    }

    // Step 7: Select channel (advances workflow to QA)

    if (jsonMode) {
      await client.selectChannel(specId, selectedChannel, roles);
    } else {
      await withSpinner('Setting up channel and starting QA', () =>
        client.selectChannel(specId, selectedChannel, roles)
      );
      displaySuccess(`Channel "${selectedChannel}" recorded.`);
    }

    // Step 8: QA Loop (T052, T054)
    if (!jsonMode) {
      displayStep('Starting Blind QA...');
    }

    let isComplete = false;
    let totalAnswered = 0;
    let specUrl = '';
    let title = analysisResult.title;

    while (!isComplete) {
      // Get next question
      const nextResult = await client.getNextQuestion(specId);

      // T052: Completion detection via type:"complete"
      if (isQAComplete(nextResult)) {
        const completion = nextResult as CompletionCheckResponse;
        totalAnswered = completion.totalAnswered;
        specUrl = completion.specUrl;
        isComplete = true;
        break;
      }

      // Display question and get answer
      const questionData = nextResult as QuestionResponse;

      let selectedOptionIndex: number;
      let customText: string | undefined;

      if (autoAnswer) {
        // T045: Auto-select first option
        selectedOptionIndex = 0;
        if (!jsonMode) {
          displayStep(
            `Q${questionData.progress.current}: Auto-selected "${questionData.question.options[0]}"`
          );
        }
      } else {
        const answer = await promptQuestion(questionData);
        selectedOptionIndex = answer.selectedOptionIndex;

        // T051/T054: Handle "Other" option with custom text
        if (isOtherOption(selectedOptionIndex, questionData.question.options)) {
          customText = await promptCustomText();
        }
      }

      // Submit answer (T054: custom text wiring)
      const submitFn = () =>
        customText !== undefined
          ? client.submitAnswer(
              specId,
              questionData.question.id,
              undefined,
              customText
            )
          : client.submitAnswer(
              specId,
              questionData.question.id,
              selectedOptionIndex
            );

      const answerResult = jsonMode
        ? await submitFn()
        : await withSpinner('Submitting answer', submitFn);

      totalAnswered = answerResult.progress.answered;

      // T053: Progress display
      if (!jsonMode) {
        displayProgress(
          answerResult.progress.answered,
          answerResult.progress.total
        );
      }

      // T052: Completion detection via isComplete:true
      if (isQAComplete(answerResult)) {
        isComplete = true;
        specUrl = `${client.getBackendUrl()}/api/spec/${specId}?format=html`;
      }
    }

    // Step 9: Output results
    if (jsonMode) {
      // T047: JSON output mode
      printJSON(
        createSuccessEnvelope(
          {
            specId,
            specUrl,
            title,
            totalAnswered,
            channelName: selectedChannel,
          },
          client.getBackendUrl(),
          Date.now() - startTime
        )
      );
    } else {
      displayCompletion(specId, specUrl, totalAnswered, title);
      displayOutro('Spec generation complete!');
    }
  } catch (error) {
    // T048: Exit code logic
    if (error instanceof ApiError) {
      const humanMsg = getHumanReadableError(error.code);

      if (jsonMode) {
        const isTransient = [500, 502, 503, 504, 429].includes(error.status);
        printJSON(
          createErrorEnvelope(error.code, humanMsg, client.getBackendUrl(), {
            retryable: isTransient,
            duration_ms: Date.now() - startTime,
            details: error.details,
          })
        );
        process.exit(ExitCode.BACKEND_ERROR);
      }

      displayError(`API Error [${error.code}]: ${humanMsg}`);
      process.exit(ExitCode.BACKEND_ERROR);
    } else if (error instanceof Error) {
      const errWithCode = error as Error & { code?: string };
      const isNetwork = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(
        errWithCode.code ?? ''
      );

      if (jsonMode) {
        printJSON(
          createErrorEnvelope(
            errWithCode.code ?? 'UNKNOWN_ERROR',
            error.message,
            client.getBackendUrl(),
            {
              retryable: isNetwork,
              duration_ms: Date.now() - startTime,
            }
          )
        );
        process.exit(isNetwork ? ExitCode.NETWORK_ERROR : ExitCode.USER_ERROR);
      }

      displayError(`Error: ${error.message}`);
      process.exit(isNetwork ? ExitCode.NETWORK_ERROR : ExitCode.USER_ERROR);
    } else {
      if (jsonMode) {
        printJSON(
          createErrorEnvelope(
            'UNKNOWN_ERROR',
            'An unexpected error occurred',
            client.getBackendUrl(),
            {
              retryable: false,
              duration_ms: Date.now() - startTime,
            }
          )
        );
      } else {
        displayError('An unexpected error occurred.');
      }
      process.exit(ExitCode.USER_ERROR);
    }
  }
}

// ----- Main -----

const program = createProgram();
program.parse();
