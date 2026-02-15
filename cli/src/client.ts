/**
 * T021-T028, T055-T060: HTTP client for SpecFactory backend API.
 *
 * Implements all client methods for the SpecFactory workflow:
 * - T021: HTTP client with retry, timeouts, and backend URL resolution
 * - T022: startSession
 * - T023: analyzeDescription
 * - T024: getChannelNames
 * - T025: selectChannel
 * - T026: getNextQuestion
 * - T027: submitAnswer
 * - T028: healthCheck
 * - T055: Verbose request/response logging
 * - T056: Error message formatting
 * - T058-T059: Verbose request/response detail logging
 * - T060: Error code to human-readable message mapping
 *
 * Timeouts:
 * - LLM endpoints (/analyze, /channel-names, /questions/answer): 60s
 * - All other endpoints: 10s
 *
 * Backend URL resolution: flag > SPECFACTORY_BACKEND_URL env > http://localhost:3000
 */
import { withRetry, type RetryOptions } from './retry.js';

// ----- Types -----

export interface StartSessionRequest {
  pmUserId: string;
  slackChannelId: string;
}

export interface StartSessionResponse {
  specId: string;
  sessionId: string;
  step: 'awaiting_description';
}

export interface AnalyzeRequest {
  specId: string;
  pmUserId?: string;
  description: string;
}

export interface AnalyzeResponse {
  specId: string;
  title: string;
  roles: Array<{ name: string; rationale: string }>;
  complexityScore: number;
  estimatedQuestions: number;
}

export interface ChannelNamesRequest {
  specId: string;
}

export interface ChannelNamesResponse {
  specId: string;
  suggestions: string[];
}

export interface ChannelSelectRequest {
  specId: string;
  channelName: string;
  roles: Array<{ roleName: string; members: string[] }>;
}

export interface ChannelSelectResponse {
  specId: string;
  channelId: string;
  channelName: string;
}

export interface NextQuestionRequest {
  specId: string;
}

export interface QuestionResponse {
  type: 'question';
  question: {
    id: string;
    text: string;
    options: string[];
  };
  progress: {
    current: number;
    total: number;
  };
}

export interface CompletionCheckResponse {
  type: 'complete';
  totalAnswered: number;
  specUrl: string;
}

export type NextQuestionResponse = QuestionResponse | CompletionCheckResponse;

export interface SubmitAnswerRequest {
  specId: string;
  questionId: string;
  selectedOptionIndex?: number;
  customText?: string;
}

export interface SubmitAnswerResponse {
  specId: string;
  questionId: string;
  answerId: string;
  progress: {
    answered: number;
    total: number;
  };
  isComplete: boolean;
}

export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
}

export interface ErrorResponse {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

// ----- HTTP Error -----

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(response: ErrorResponse) {
    super(response.message);
    this.name = 'ApiError';
    this.status = response.statusCode;
    this.code = response.code;
    this.details = response.details;
  }
}

// ----- Client -----

/** LLM-powered endpoints that need longer timeouts. */
const LLM_ENDPOINTS = ['/analyze', '/channel-names', '/questions/answer'];

/** Default timeout for standard endpoints (10 seconds). */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Timeout for LLM-powered endpoints (60 seconds). */
const LLM_TIMEOUT_MS = 60_000;

/**
 * Resolve the backend URL from available sources.
 * Priority: explicit flag > SPECFACTORY_BACKEND_URL env > default localhost:3000
 */
export function resolveBackendUrl(flagUrl?: string): string {
  if (flagUrl) {
    return flagUrl.replace(/\/$/, '');
  }
  if (process.env.SPECFACTORY_BACKEND_URL) {
    return process.env.SPECFACTORY_BACKEND_URL.replace(/\/$/, '');
  }
  return 'http://localhost:3000';
}

export interface SpecFactoryClientOptions {
  backendUrl?: string;
  verbose?: boolean;
  retryOptions?: RetryOptions;
}

export class SpecFactoryClient {
  private readonly baseUrl: string;
  private readonly verbose: boolean;
  private readonly retryOptions: RetryOptions;

  constructor(options: SpecFactoryClientOptions = {}) {
    this.baseUrl = resolveBackendUrl(options.backendUrl);
    this.verbose = options.verbose ?? false;
    this.retryOptions = options.retryOptions ?? {};
  }

  /** Get the resolved backend URL. */
  getBackendUrl(): string {
    return this.baseUrl;
  }

  /**
   * Make an HTTP request to the backend with retry and timeout handling.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const isLlm = LLM_ENDPOINTS.some((ep) => path.includes(ep));
    const timeoutMs = isLlm ? LLM_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

    const makeRequest = async (): Promise<T> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        if (this.verbose) {
          console.error(
            `[HTTP] ${method} ${url}${body ? ` body=${JSON.stringify(body).slice(0, 500)}` : ''}`
          );
        }

        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        if (this.verbose) {
          console.error(`[HTTP] ${response.status} ${response.statusText}`);
        }

        if (!response.ok) {
          let errorBody: ErrorResponse;
          try {
            errorBody = (await response.json()) as ErrorResponse;
          } catch {
            errorBody = {
              code: 'UNKNOWN_ERROR',
              message: `HTTP ${response.status}: ${response.statusText}`,
              statusCode: response.status,
            };
          }

          if (this.verbose) {
            console.error(
              `[HTTP] Error: ${JSON.stringify(errorBody).slice(0, 500)}`
            );
          }

          throw new ApiError(errorBody);
        }

        const data = (await response.json()) as T;

        if (this.verbose) {
          console.error(
            `[HTTP] Response: ${JSON.stringify(data).slice(0, 500)}`
          );
        }

        return data;
      } catch (error) {
        if (error instanceof ApiError) throw error;

        // Convert abort/timeout errors
        if (error instanceof Error && error.name === 'AbortError') {
          const timeoutError = Object.assign(
            new Error(`Request timed out after ${timeoutMs}ms: ${method} ${path}`),
            { code: 'ETIMEDOUT' }
          );
          throw timeoutError;
        }

        // Re-throw network errors with code if available
        if (error instanceof Error) {
          const networkError = error as Error & { cause?: { code?: string } };
          if (networkError.cause?.code) {
            Object.assign(error, { code: networkError.cause.code });
          }
          throw error;
        }

        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    };

    return withRetry(makeRequest, {
      maxAttempts: this.retryOptions.maxAttempts ?? 3,
      baseDelay: this.retryOptions.baseDelay ?? 1000,
      onRetry: (attempt, delay, error) => {
        if (this.verbose) {
          console.error(
            `[RETRY] Attempt ${attempt}, waiting ${delay}ms. Error: ${error.message}`
          );
        }
      },
    });
  }

  // ----- T022: startSession -----

  async startSession(
    pmUserId: string,
    slackChannelId: string = 'cli-local'
  ): Promise<StartSessionResponse> {
    return this.request<StartSessionResponse>(
      'POST',
      '/api/specfactory/start',
      { pmUserId, slackChannelId }
    );
  }

  // ----- T023: analyzeDescription -----

  async analyzeDescription(
    specId: string,
    pmUserId: string,
    description: string
  ): Promise<AnalyzeResponse> {
    return this.request<AnalyzeResponse>('POST', '/api/specfactory/analyze', {
      specId,
      pmUserId,
      description,
    });
  }

  // ----- T024: getChannelNames -----

  async getChannelNames(specId: string): Promise<ChannelNamesResponse> {
    return this.request<ChannelNamesResponse>(
      'POST',
      '/api/specfactory/channel-names',
      { specId }
    );
  }

  // ----- T025: selectChannel -----

  async selectChannel(
    specId: string,
    channelName: string,
    roles: Array<{ roleName: string; members: string[] }>
  ): Promise<ChannelSelectResponse> {
    return this.request<ChannelSelectResponse>(
      'POST',
      '/api/specfactory/channel',
      { specId, channelName, roles }
    );
  }

  // ----- T026: getNextQuestion -----

  async getNextQuestion(specId: string): Promise<NextQuestionResponse> {
    return this.request<NextQuestionResponse>(
      'POST',
      '/api/specfactory/questions/next',
      { specId }
    );
  }

  // ----- T027: submitAnswer -----

  async submitAnswer(
    specId: string,
    questionId: string,
    selectedOptionIndex?: number,
    customText?: string
  ): Promise<SubmitAnswerResponse> {
    const body: SubmitAnswerRequest = { specId, questionId };

    if (customText !== undefined) {
      body.customText = customText;
    } else if (selectedOptionIndex !== undefined) {
      body.selectedOptionIndex = selectedOptionIndex;
    }

    return this.request<SubmitAnswerResponse>(
      'POST',
      '/api/specfactory/questions/answer',
      body
    );
  }

  // ----- T028: healthCheck -----

  async healthCheck(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/health');
  }
}

// ----- T055/T058: Verbose request formatting -----

/**
 * Format a verbose log line for an HTTP request.
 * Body is truncated at 500 characters.
 */
export function formatVerboseRequest(
  method: string,
  url: string,
  body?: unknown
): string {
  let line = `[HTTP] ${method} ${url}`;
  if (body !== undefined) {
    const bodyStr = JSON.stringify(body);
    const truncated =
      bodyStr.length > 500 ? bodyStr.slice(0, 500) + '...' : bodyStr;
    line += ` body=${truncated}`;
  }
  return line;
}

// ----- T055/T059: Verbose response formatting -----

/**
 * Format a verbose log line for an HTTP response.
 * Body is truncated at 500 characters.
 */
export function formatVerboseResponse(
  status: number,
  body: unknown,
  durationMs: number
): string {
  const bodyStr = JSON.stringify(body);
  const truncated =
    bodyStr.length > 500 ? bodyStr.slice(0, 500) + '...' : bodyStr;
  return `[HTTP] ${status} (${durationMs}ms) ${truncated}`;
}

// ----- T056/T060: Error code to human-readable message mapping -----

const ERROR_MESSAGES: Record<string, string> = {
  MISSING_REQUIRED_FIELDS:
    'Required fields are missing from the request. Please check your input and try again.',
  INVALID_UUID:
    'An invalid UUID was provided. This usually indicates a corrupted session. Please restart the CLI.',
  DESCRIPTION_TOO_SHORT:
    'The feature description is too short. Please provide at least 10 words describing the feature.',
  ACTIVE_SESSION_EXISTS:
    'An active session already exists for this user. Wait for it to expire or use a different user.',
  SPEC_NOT_FOUND:
    'The spec was not found. It may have expired or been deleted. Please start a new session.',
  LLM_ERROR:
    'The AI service encountered an error. This is usually temporary -- please try again in a moment.',
  INVALID_CHANNEL_NAME:
    'The channel name is invalid. It must start with a letter or number, use only lowercase letters, numbers, and hyphens.',
  INVALID_OPTION_INDEX:
    'The selected option index is out of range. Please select a valid option number.',
};

/**
 * Map an error code to a human-readable message.
 * Returns the original code with a generic message for unknown codes.
 */
export function getHumanReadableError(code: string): string {
  return (
    ERROR_MESSAGES[code] ??
    `An unexpected error occurred (${code}). Please try again or report this issue.`
  );
}
