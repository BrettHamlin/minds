/**
 * SpecFactory API route handlers for User Story 1
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from './middleware.js';
import { createSpec, updateSpecAnalysis, transitionSpecState } from '../services/spec.js';
import { createSession, getActiveSession, updateSessionStep } from '../services/session.js';
import { createRoles, addRoleMembers, getAllMemberUserIds } from '../services/role.js';
import { createSlackChannel, inviteMembers, postWelcomeMessage, createChannelRecord } from '../services/channel.js';
import { analyzeDescription, generateChannelNames } from '../services/llm.js';
import { validateUUID, validateDescriptionLength, validateSlackChannelName } from '../lib/validation.js';
import { ConflictError, NotFoundError, ValidationError, ERROR_CODES } from '../lib/errors.js';
import { startBlindQA } from '../services/blind-qa.js';
import { PLUGIN_TYPE } from '../index.js';

const router = Router();

// POST /api/specfactory/start
router.post('/start', asyncHandler(async (req: Request, res: Response) => {
  const { pmUserId, slackChannelId } = req.body;

  if (!pmUserId || !slackChannelId) {
    throw new ValidationError('MISSING_REQUIRED_FIELDS', 'pmUserId and slackChannelId are required');
  }

  // Check for existing active session
  const existingSession = await getActiveSession(pmUserId);
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
  const spec = await createSpec('Untitled Spec', 'Pending description', pmUserId);
  const session = await createSession(spec.id, pmUserId, slackChannelId);

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
  const analysis = await analyzeDescription(description);

  // Update spec with analysis results
  await updateSpecAnalysis(specId, analysis.complexityScore, analysis.estimatedQuestions, analysis.title);

  // Create roles from analysis
  const rolesInput = analysis.roles.map((role, index) => ({
    name: role.name,
    rationale: role.rationale,
    sortOrder: index,
  }));
  await createRoles(specId, rolesInput);

  // Update session step
  const session = await getActiveSession(req.body.pmUserId || '');
  if (session) {
    await updateSessionStep(session.id, 'selecting_channel');
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

  // Fetch spec to get title and description
  const { getSpec } = await import('../services/spec.js');
  const spec = await getSpec(specId);
  
  if (!spec) {
    throw new NotFoundError('Spec not found');
  }

  // Generate channel name suggestions
  const suggestions = await generateChannelNames(spec.description, spec.title);

  res.status(200).json({
    specId,
    suggestions,
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

  // Get spec details
  const { getSpec } = await import('../services/spec.js');
  const spec = await getSpec(specId);

  if (!spec) {
    throw new NotFoundError('Spec not found');
  }

  // Determine whether to skip Slack operations based on PLUGIN_TYPE
  const skipSlack = PLUGIN_TYPE === 'cli';

  // Create Slack channel (or synthetic channel in CLI mode)
  const slackChannel = await createSlackChannel(channelName, { skipSlack });

  // Add role members to database
  if (skipSlack) {
    // In CLI mode, store roles without Slack user lookups (members array may be empty)
    for (const roleAssignment of roles) {
      const role = spec.roles.find((r: { name: string }) => r.name === roleAssignment.roleName);
      if (role && roleAssignment.members?.length > 0) {
        const memberInputs = roleAssignment.members.map((userId: string) => ({
          slackUserId: userId,
          displayName: userId, // No Slack lookup in CLI mode
        }));
        await addRoleMembers(role.id, memberInputs);
      }
    }
  } else {
    // In Slack mode, fetch display names from Slack API
    const { slackApp } = await import('../plugins/slack/client.js');
    for (const roleAssignment of roles) {
      const role = spec.roles.find((r: { name: string }) => r.name === roleAssignment.roleName);
      if (role && roleAssignment.members?.length > 0) {
        const memberInputs = await Promise.all(
          roleAssignment.members.map(async (userId: string) => {
            try {
              const userInfo = await slackApp.client.users.info({ user: userId });
              return {
                slackUserId: userId,
                displayName: userInfo.user?.real_name || userInfo.user?.name || userId,
              };
            } catch (error) {
              console.error(`Failed to fetch user info for ${userId}:`, error);
              return {
                slackUserId: userId,
                displayName: userId,
              };
            }
          })
        );
        await addRoleMembers(role.id, memberInputs);
      }
    }
  }

  // Get all unique member user IDs for invitation
  const memberUserIds = await getAllMemberUserIds(specId);

  // Invite all members to channel (skipped in CLI mode)
  if (memberUserIds.length > 0) {
    await inviteMembers(slackChannel.id, memberUserIds, { skipSlack });
  }

  // Create channel record in database (always -- even in CLI mode)
  await createChannelRecord(
    specId,
    slackChannel.id,
    slackChannel.name,
    [],
    slackChannel.name !== channelName
  );

  // Post welcome message (skipped in CLI mode)
  await postWelcomeMessage(slackChannel.id, spec.title, spec.pmDisplayName || 'PM', { skipSlack });

  // Update session and spec state
  const session = await getActiveSession(spec.pmUserId);
  if (session) {
    await updateSessionStep(session.id, 'ready');
  }
  await transitionSpecState(specId, 'drafting', 'questioning');

  // Start Blind QA: Generate first question
  const firstQuestion = await startBlindQA(specId);

  // Post question to Slack channel (skipped in CLI mode)
  if (!skipSlack) {
    const { postQuestionToChannel } = await import('../plugins/slack/interactions.js');
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

  const { isComplete } = await import('../services/blind-qa.js');
  const complete = await isComplete(specId);

  if (complete) {
    const { getQuestionCount } = await import('../services/question.js');
    const { answered } = await getQuestionCount(specId);
    
    res.status(200).json({
      type: 'complete',
      totalAnswered: answered,
      specUrl: `${process.env.SPEC_BASE_URL}/api/spec/${specId}?format=html`,
    });
    return;
  }

  // Generate next question
  const { getNextUnanswered, getQuestionCount } = await import('../services/question.js');
  const nextQuestion = await getNextUnanswered(specId);
  const { answered, total } = await getQuestionCount(specId);

  res.status(200).json({
    type: 'question',
    question: {
      id: nextQuestion?.id,
      text: nextQuestion?.text,
      options: nextQuestion?.options,
    },
    progress: {
      current: answered + 1,
      total,
    },
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

  const { submitAnswer } = await import('../services/answer.js');
  const result = await submitAnswer(questionId, specId, selectedOptionIndex, customText);

  // Check if complete
  const { isComplete, completeBlindQA, generateNextQuestion } = await import('../services/blind-qa.js');
  const complete = await isComplete(specId);

  if (complete) {
    await completeBlindQA(specId);
  } else {
    // Generate next question if not complete
    const { getQuestionsWithAnswers } = await import('../services/question.js');
    const questionsWithAnswers = await getQuestionsWithAnswers(specId);
    const previousAnswers = questionsWithAnswers
      .filter(q => q.answer)
      .map(q => ({
        question: q.text,
        answer: q.answer!.isCustom ? q.answer!.customText! : q.answer!.selectedOptionText!
      }));

    await generateNextQuestion(specId, previousAnswers);
  }

  res.status(200).json({
    specId,
    questionId,
    answerId: result.answer.id,
    progress: result.progress,
    isComplete: complete,
  });
}));
