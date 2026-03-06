/**
 * SpecFactory API route handlers for User Story 1
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware.js';
import { callEngine } from '../engine.js';
import { validateUUID, validateDescriptionLength, validateSlackChannelName } from '../../shared/validation.js';
import { ConflictError, NotFoundError, ValidationError, ERROR_CODES } from '../../shared/errors.js';
import { PLUGIN_TYPE } from '../index.js';

const router = Router();

// POST /api/specfactory/start
router.post('/start', asyncHandler(async (req: Request, res: Response) => {
  const { pmUserId, slackChannelId } = req.body;

  if (!pmUserId || !slackChannelId) {
    throw new ValidationError('MISSING_REQUIRED_FIELDS', 'pmUserId and slackChannelId are required');
  }

  // Check for existing active session
  const existingSession = await callEngine<{
    id: string; specId: string; currentStep: string;
  } | null>('get active session', { pmUserId });

  if (existingSession) {
    throw new ConflictError(
      ERROR_CODES.ACTIVE_SESSION_EXISTS,
      'An active spec creation session already exists for this user',
      {
        existingSpecId: existingSession.specId,
        step: existingSession.currentStep,
      }
    );
  }

  // Create new spec and session
  const spec = await callEngine<{ id: string }>('create spec', {
    title: 'Untitled Spec',
    description: 'Pending description',
    pmUserId,
  });

  const session = await callEngine<{ id: string; currentStep: string }>('create session', {
    specId: spec.id,
    pmUserId,
    slackChannelId,
  });

  res.status(201).json({
    specId: spec.id,
    sessionId: session.id,
    step: session.currentStep,
  });
}));

// POST /api/specfactory/analyze
router.post('/analyze', asyncHandler(async (req: Request, res: Response) => {
  const { specId, description } = req.body;

  if (!specId || !description) {
    throw new ValidationError('MISSING_REQUIRED_FIELDS', 'specId and description are required');
  }

  validateUUID(specId);
  validateDescriptionLength(description, 10);

  // Analyze description with LLM
  const analysis = await callEngine<{
    title: string;
    roles: Array<{ name: string; rationale: string }>;
    complexityScore: number;
    estimatedQuestions: number;
  }>('analyze description', { description });

  // Update spec with analysis results
  await callEngine('update spec analysis', {
    specId,
    complexityScore: analysis.complexityScore,
    totalQuestions: analysis.estimatedQuestions,
    title: analysis.title,
  });

  // Create roles from analysis
  const rolesInput = analysis.roles.map((role, index) => ({
    name: role.name,
    rationale: role.rationale,
    sortOrder: index,
  }));
  await callEngine('create roles', { specId, roles: rolesInput });

  // Update session step
  const session = await callEngine<{ id: string } | null>('get active session', { pmUserId: req.body.pmUserId || '' });
  if (session) {
    await callEngine('update session', { sessionId: session.id, step: 'selecting_channel' });
  }

  res.status(200).json({
    specId,
    title: analysis.title,
    roles: analysis.roles,
    complexityScore: analysis.complexityScore,
    estimatedQuestions: analysis.estimatedQuestions,
  });
}));

// POST /api/specfactory/channel-names
router.post('/channel-names', asyncHandler(async (req: Request, res: Response) => {
  const { specId } = req.body;

  if (!specId) {
    throw new ValidationError('MISSING_REQUIRED_FIELDS', 'specId is required');
  }

  validateUUID(specId);

  const spec = await callEngine<{ description: string; title: string } | null>('get spec', { specId });

  if (!spec) {
    throw new NotFoundError('Spec not found');
  }

  const result = await callEngine<{ names: string[] }>('generate channel names', {
    description: spec.description,
    title: spec.title,
  });

  res.status(200).json({
    specId,
    suggestions: result.names,
  });
}));

// POST /api/specfactory/channel
router.post('/channel', asyncHandler(async (req: Request, res: Response) => {
  const { specId, channelName, roles } = req.body;

  if (!specId || !channelName || !roles) {
    throw new ValidationError('MISSING_REQUIRED_FIELDS', 'specId, channelName, and roles are required');
  }

  validateUUID(specId);
  validateSlackChannelName(channelName);

  const spec = await callEngine<{
    id: string; title: string; pmUserId: string; pmDisplayName?: string; totalQuestions?: number;
    roles: Array<{ id: string; name: string }>;
  } | null>('get spec', { specId });

  if (!spec) {
    throw new NotFoundError('Spec not found');
  }

  const skipSlack = PLUGIN_TYPE === 'cli';

  // Create Slack channel (or synthetic channel in CLI mode)
  const slackChannel = await callEngine<{ id: string; name: string }>('create slack channel', {
    name: channelName,
    skipSlack,
  });

  // Add role members to database
  if (skipSlack) {
    for (const roleAssignment of roles) {
      const role = spec.roles.find((r) => r.name === roleAssignment.roleName);
      if (role && roleAssignment.members?.length > 0) {
        const memberInputs = roleAssignment.members.map((userId: string) => ({
          slackUserId: userId,
          displayName: userId,
        }));
        await callEngine('add role members', { roleId: role.id, members: memberInputs });
      }
    }
  } else {
    // TODO(WA-2): Replace with Integrations Mind handle() call
    const { slackApp } = await import('../../../src/plugins/slack/client.js');
    for (const roleAssignment of roles) {
      const role = spec.roles.find((r) => r.name === roleAssignment.roleName);
      if (role && roleAssignment.members?.length > 0) {
        const memberInputs = await Promise.all(
          roleAssignment.members.map(async (userId: string) => {
            try {
              const userInfo = await slackApp.client.users.info({ user: userId });
              return {
                slackUserId: userId,
                displayName: userInfo.user?.real_name || userInfo.user?.name || userId,
              };
            } catch {
              return { slackUserId: userId, displayName: userId };
            }
          })
        );
        await callEngine('add role members', { roleId: role.id, members: memberInputs });
      }
    }
  }

  const { userIds: memberUserIds } = await callEngine<{ userIds: string[] }>('get member user ids', { specId });

  if (memberUserIds.length > 0) {
    await callEngine('invite members', { slackChannelId: slackChannel.id, userIds: memberUserIds, skipSlack });
  }

  await callEngine('create channel record', {
    specId,
    slackChannelId: slackChannel.id,
    name: slackChannel.name,
    nameSuggestions: [],
    isCustomName: slackChannel.name !== channelName,
  });

  await callEngine('post welcome message', {
    slackChannelId: slackChannel.id,
    specTitle: spec.title,
    pmDisplayName: spec.pmDisplayName ?? 'PM',
    skipSlack,
  });

  const session = await callEngine<{ id: string } | null>('get active session', { pmUserId: spec.pmUserId });
  if (session) {
    await callEngine('update session', { sessionId: session.id, step: 'ready' });
  }
  await callEngine('transition spec', { specId, from: 'drafting', to: 'questioning' });

  const firstQuestion = await callEngine<{
    id: string; text: string; options: string[];
  }>('start blind qa', { specId });

  if (!skipSlack) {
    // TODO(WA-2): Replace with Integrations Mind handle() call
    const { postQuestionToChannel } = await import('../../../src/plugins/slack/interactions.js');
    await postQuestionToChannel(
      slackChannel.id,
      { id: firstQuestion.id, text: firstQuestion.text, options: firstQuestion.options, specId },
      { current: 1, total: spec.totalQuestions || 10 }
    );
  }

  res.status(201).json({
    specId,
    channelId: slackChannel.id,
    channelName: slackChannel.name,
  });
}));

export default router;

// POST /api/specfactory/questions/next
router.post('/questions/next', asyncHandler(async (req: Request, res: Response) => {
  const { specId } = req.body;

  if (!specId) {
    throw new ValidationError('MISSING_REQUIRED_FIELDS', 'specId is required');
  }

  validateUUID(specId);

  const { complete } = await callEngine<{ complete: boolean }>('is complete', { specId });

  if (complete) {
    const { answered } = await callEngine<{ answered: number; total: number }>('get question count', { specId });
    res.status(200).json({
      type: 'complete',
      totalAnswered: answered,
      specUrl: `${process.env.SPEC_BASE_URL}/api/spec/${specId}?format=html`,
    });
    return;
  }

  const nextQuestion = await callEngine<{ id: string; text: string; options: string[] } | null>(
    'get next unanswered', { specId }
  );
  const { answered, total } = await callEngine<{ answered: number; total: number }>('get question count', { specId });

  res.status(200).json({
    type: 'question',
    question: {
      id: nextQuestion?.id,
      text: nextQuestion?.text,
      options: nextQuestion?.options,
    },
    progress: { current: answered + 1, total },
  });
}));

// POST /api/specfactory/questions/answer
router.post('/questions/answer', asyncHandler(async (req: Request, res: Response) => {
  const { specId, questionId, selectedOptionIndex, customText } = req.body;

  if (!specId || !questionId) {
    throw new ValidationError('MISSING_REQUIRED_FIELDS', 'specId and questionId are required');
  }

  validateUUID(specId);
  validateUUID(questionId);

  const result = await callEngine<{
    answer: { id: string };
    progress: { answered: number; total: number };
  }>('submit answer', { questionId, specId, selectedOptionIndex, customText });

  const { complete } = await callEngine<{ complete: boolean }>('is complete', { specId });

  if (complete) {
    await callEngine('complete blind qa', { specId });
  } else {
    const questionsData = await callEngine<Array<{
      text: string;
      answer?: { isCustom: boolean; customText?: string; selectedOptionText?: string };
    }>>('get questions with answers', { specId });

    const previousAnswers = questionsData
      .filter(q => q.answer)
      .map(q => ({
        question: q.text,
        answer: q.answer!.isCustom ? q.answer!.customText! : q.answer!.selectedOptionText!,
      }));

    await callEngine('generate next question', { specId, previousAnswers });
  }

  res.status(200).json({
    specId,
    questionId,
    answerId: result.answer.id,
    progress: result.progress,
    isComplete: complete,
  });
}));
